// The single shared world Durable Object: budget and quota ledger, the heartbeat and commit point,
// the append-only run log, the trust registry and the owner claim (direction v2, 6, 8.7, 15).
import {DurableObject} from 'cloudflare:workers';
import {Ledger, type ReserveRequest, type Outcome, type Tier} from './core/ledger.ts';
import type {Env} from './env.ts';
import type {ClaimRecord} from './core/threads.ts';
import {WorldRuntime} from './core/world-runtime.ts';
import {TICK_MS} from '../src/engine/world.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {Trust, OWNER_SLOT} from './core/trust.ts';
import {runP0, verifyMeeting, impostorCheck, injectionCheck, type Ctx} from './core/a2a.ts';

export class WorldDO extends DurableObject<Env> {
  private ledger: Ledger;
  private runtime: WorldRuntime;
  private trust: Trust;
  private ownerRoot: JsonWebKey | null;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ledger = new Ledger(ctx.storage.sql, {dailyCapUsd: Number(env.DAILY_BUDGET_USD) || 20});
    this.trust = new Trust(ctx.storage.sql);
    this.ownerRoot = env.OWNER_ROOT_JWK ? JSON.parse(env.OWNER_ROOT_JWK) : null;
    this.runtime = new WorldRuntime(ctx.storage.sql, {
      // Live decisions for a Muse whose delegation was revoked (and not re-issued) are discarded.
      delegationValid: museId => !this.trust.suspended(museId),
      worldId: 'musely-preview',
      ledger: this.ledger,
      hooks: makeHooks(),
      model: {base: env.MODEL_BASE, key: env.MODEL_API_KEY, model: env.MODEL_ID, timeoutMs: 8000},
    });
    ctx.blockConcurrencyWhile(async () => {
      this.ledger.init();
      this.runtime.init(Date.now());
      // The heartbeat (direction v2, 8.7): one alarm per minute keeps the shared world running.
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 5_000);
      // Owner claims. The Threads token stays inside this object; no method returns it over HTTP.
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS claims (agent TEXT PRIMARY KEY, record TEXT NOT NULL, token TEXT)');
      this.trust.init();
      await this.trust.ensureAgents(this.ownerRoot);
      // The owner's Muse arrives with a small welcome gift so it has something to trade (logged as a rule).
      const owner = this.runtime.state().muses.find(m => m.id === OWNER_SLOT);
      if (owner && owner.inventory.length === 0) this.runtime.commitExternal(Date.now(), 'welcome', (st, emit) => { st.muses.find(m => m.id === OWNER_SLOT)!.inventory.push('coffee', 'postage_stamp'); emit({at: Date.now(), source: 'rule', kind: 'welcome_gift', muse: OWNER_SLOT, line: 'Welcome gift: Coffee and a Postage Stamp', data: {items: ['coffee', 'postage_stamp']}, tags: []}); });
    });
  }
  reserve(r: ReserveRequest) { return this.ledger.reserve(r); }
  settle(id: string, costUsd: number, outcome: Outcome) { return this.ledger.settle(id, costUsd, outcome); }
  status() { this.ledger.prune(); return this.ledger.status(); }
  quota(session: string, tier: Tier) { return this.ledger.quotaFor(session, tier); }
  async alarm() {
    try {
      const r = await this.runtime.heartbeat(Date.now());
      if (r.status === 'committed') {
        console.log('heartbeat', r.tick, r.spotlight?.muse, r.spotlight?.source, r.spotlight?.reason ?? '');
        // Every meeting in this tick: both Agent Cards are verified for real before anything else happens.
        const met = this.runtime.eventsOfKind(r.tick, 'encounter').slice(0, 4);
        for (const e of met) await verifyMeeting(this.ctx_(), String(e.muse), String(e.other), e.place ? String(e.place) : null);
      }
    } finally {
      // Always schedule the next beat, even if this one threw (the runtime is idempotent per tick).
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }
  private ctx_(): Ctx {
    const claim = this.getClaim('owner-muse');
    return {trust: this.trust, runtime: this.runtime, ownerRoot: this.ownerRoot, ownerClaimed: claim?.status === 'claimed', baseUrl: 'https://preview.musely.net'};
  }
  p0() { return runP0(this.ctx_()); }
  impostor(target: string) { return impostorCheck(this.ctx_(), target); }
  injection(from: string, to: string, i: number) { return injectionCheck(this.ctx_(), from, to, i); }
  async agentCard(museId: string) {
    if (!this.trust.agentByMuse(museId)) return null;
    const claim = this.getClaim('owner-muse');
    return this.trust.card(museId, this.ownerRoot, {claimed: claim?.status === 'claimed', fingerprint: museId === OWNER_SLOT ? claim?.fingerprint ?? null : null}, 'https://preview.musely.net');
  }
  jwks(kid: string) { const a = this.trust.agentById(kid); return a ? {keys: [{...a.rootJwk, kid: a.agentId, alg: 'ES256', use: 'sig'}]} : null; }
  worldView() { return this.runtime.view(Date.now()); }
  worldEvents(since: number, limit: number, opts: {day?: string; tail?: number} = {}) { return this.runtime.events(since, Math.min(2000, Math.max(1, limit)), opts); }
  worldHighlights(limit: number) { return this.runtime.highlights(Math.min(300, Math.max(1, limit))); }
  getClaim(agent: string): ClaimRecord | null {
    const r = this.ctx.storage.sql.exec('SELECT record FROM claims WHERE agent = ?', agent).toArray()[0];
    return r ? JSON.parse(String(r.record)) : null;
  }
  /** Worker-internal: the token is used for re-checks inside the Worker and never sent to clients. */
  claimToken(agent: string): string | null {
    const r = this.ctx.storage.sql.exec('SELECT token FROM claims WHERE agent = ?', agent).toArray()[0];
    return r?.token ? String(r.token) : null;
  }
  setClaim(agent: string, record: ClaimRecord, token?: string | null) {
    // A machine-verified claim is never downgraded by an owner-direct submission.
    const prev = this.getClaim(agent);
    if (prev?.machineVerified && record.path === 'owner_direct') return prev;
    this.ctx.storage.sql.exec('INSERT INTO claims (agent, record, token) VALUES (?, ?, ?) ON CONFLICT(agent) DO UPDATE SET record = excluded.record, token = COALESCE(excluded.token, claims.token)', agent, JSON.stringify(record), token ?? null);
    return record;
  }
}
