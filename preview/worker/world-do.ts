// The single shared world Durable Object. In this step it owns the budget and quota ledger;
// the heartbeat, commit point and run log join it in later steps (direction v2, 8.7).
import {DurableObject} from 'cloudflare:workers';
import {Ledger, type ReserveRequest, type Outcome, type Tier} from './core/ledger.ts';
import type {Env} from './env.ts';
import type {ClaimRecord} from './core/threads.ts';
import {WorldRuntime} from './core/world-runtime.ts';
import {TICK_MS} from '../src/engine/world.ts';

export class WorldDO extends DurableObject<Env> {
  private ledger: Ledger;
  private runtime: WorldRuntime;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ledger = new Ledger(ctx.storage.sql, {dailyCapUsd: Number(env.DAILY_BUDGET_USD) || 20});
    this.runtime = new WorldRuntime(ctx.storage.sql, {
      worldId: 'musely-preview',
      ledger: this.ledger,
      model: {base: env.MODEL_BASE, key: env.MODEL_API_KEY, model: env.MODEL_ID, timeoutMs: 8000},
    });
    ctx.blockConcurrencyWhile(async () => {
      this.ledger.init();
      this.runtime.init(Date.now());
      // The heartbeat (direction v2, 8.7): one alarm per minute keeps the shared world running.
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 5_000);
      // Owner claims. The Threads token stays inside this object; no method returns it over HTTP.
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS claims (agent TEXT PRIMARY KEY, record TEXT NOT NULL, token TEXT)');
    });
  }
  reserve(r: ReserveRequest) { return this.ledger.reserve(r); }
  settle(id: string, costUsd: number, outcome: Outcome) { return this.ledger.settle(id, costUsd, outcome); }
  status() { this.ledger.prune(); return this.ledger.status(); }
  quota(session: string, tier: Tier) { return this.ledger.quotaFor(session, tier); }
  async alarm() {
    try {
      const r = await this.runtime.heartbeat(Date.now());
      if (r.status === 'committed') console.log('heartbeat', r.tick, r.spotlight?.muse, r.spotlight?.source, r.spotlight?.reason ?? '');
    } finally {
      // Always schedule the next beat, even if this one threw (the runtime is idempotent per tick).
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }
  worldView() { return this.runtime.view(Date.now()); }
  worldEvents(since: number, limit: number) { return this.runtime.events(since, Math.min(500, Math.max(1, limit))); }
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
