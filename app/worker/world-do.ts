// The single shared world Durable Object: budget and quota ledger, the heartbeat and commit point,
// the append-only run log, the trust registry and the owner claim (direction v2, 6, 8.7, 15).
import {DurableObject} from 'cloudflare:workers';
import {Ledger, type ReserveRequest, type Outcome, type Tier} from './core/ledger.ts';
import type {Env} from './env.ts';
import type {ClaimRecord} from './core/threads.ts';
import {WorldRuntime} from './core/world-runtime.ts';
import {WorldLifeController,worldLifeEnabled,WORLD_LIFE_PLACES} from './core/world-life-controller.ts';
import {TICK_MS} from '../src/engine/world.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {Trust, OWNER_SLOT} from './core/trust.ts';
import {runP0, impostorCheck, injectionCheck, MeetingCheck, type Ctx} from './core/a2a.ts';
import {ConnectedHost} from './core/connected.ts';
import {RitualStore, type RitualRecord} from './core/ritual.ts';
import {revokeMuse, redelegateMuse, reconcilePaused, delegationStatus} from './core/owner-control.ts';
import {resetMuse} from './core/muse-reset.ts';
import {initRetention, pruneCommands, RETENTION_CHECK_MS} from './core/data-retention.ts';
import {migrateTaskStore, type DecisionInput} from './core/tasks.ts';
import {ownerIdForMuse} from './core/owner-session.ts';
import {PersonalAuthStore, type PersonalFlow, type PersonalSessionRow} from './core/personal-session.ts';
import {PersonalRegistration, type PersonalBinding} from './core/personal-registration.ts';

export class WorldDO extends DurableObject<Env> {
  private ledger: Ledger;
  private personalAuth: PersonalAuthStore;
  private personalRegistration: PersonalRegistration;
  private runtime: WorldRuntime;
  private worldLife: WorldLifeController|null=null;
  private trust: Trust;
  private ritual: RitualStore;
  private ownerRoot: JsonWebKey | null;
  private connected: ConnectedHost;
  private origin: string;
  private meetings = new MeetingCheck(() => this.ctx_());
  private retentionAt = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.origin = env.PUBLIC_ORIGIN;
    if (!this.origin) throw new Error('PUBLIC_ORIGIN is not set');
    this.personalAuth = new PersonalAuthStore(ctx.storage);
    this.personalRegistration = new PersonalRegistration(ctx.storage, this.personalAuth);
    this.ledger = new Ledger(ctx.storage.sql, {dailyCapUsd: Number(env.DAILY_BUDGET_USD) || 20});
    this.trust = new Trust(ctx.storage.sql);
    this.ritual = new RitualStore(ctx.storage.sql);
    this.ownerRoot = env.OWNER_ROOT_JWK ? JSON.parse(env.OWNER_ROOT_JWK) : null;
    const hooks = makeHooks();
    // The runtime commits inside the storage transaction; every other store shares the same SQL handle.
    const txSql = {exec: (q: string, ...b: unknown[]) => ctx.storage.sql.exec(q, ...b), transactionSync: <T>(fn: () => T) => ctx.storage.transactionSync(fn)};
    const tokens = {owner: env.OWNER_CONTROL_TOKEN, peer: env.DEMO_PEER_CONTROL_TOKEN, reviewer: env.REVIEWER_CONTROL_TOKEN, judge: env.JUDGE_TOKEN};
    const active=()=>worldLifeEnabled(env.WORLD_LIFE_MODE);
    if(active())this.worldLife=new WorldLifeController(txSql,this.personalAuth.owners,this.trust,this.ledger,env.MODEL_API_KEY?{base:env.MODEL_BASE,key:env.MODEL_API_KEY,model:env.MODEL_ID,timeoutMs:8000}:null,muse=>ownerIdForMuse(tokens,muse),active);
    this.runtime = new WorldRuntime(txSql, {
      ...this.worldLife?.runtimeOptions(),
      // Live decisions for a Muse whose delegation was revoked (and not re-issued) are discarded.
      delegationValid: museId => !this.trust.suspended(museId),
      // Every meeting: both Agent Cards and delegations are verified before any greeting or trade.
      meetingGate: async (s, now) => {const gate=await this.meetings.prepare(s,now);this.worldLife?.acceptMeetingGate(s,now,gate);return gate;},
      worldId: 'musely',
      ledger: this.ledger,
      hooks,
      model: {base: env.MODEL_BASE, key: env.MODEL_API_KEY, model: env.MODEL_ID, timeoutMs: 8000},
    });
    // A Muse has an owner for meetup approvals only when that owner can sign in here (its control token is set); otherwise
    // it is a resident and its side is approved by rule (I-07).
    this.worldLife?.bind(this.runtime);
    this.connected = new ConnectedHost({campfires:this.worldLife?{get enabled(){return active();},placeIds:WORLD_LIFE_PLACES}:undefined,sql: ctx.storage.sql, trust: this.trust, runtime: this.runtime, hooks, baseUrl: this.origin, ownerRoot: () => this.ownerRoot, ownerClaimed: () => this.getClaim('owner-muse')?.status === 'claimed', ownerOf: muse => ownerIdForMuse(tokens, muse)});
    ctx.blockConcurrencyWhile(async () => {
      this.ledger.init();
      this.personalAuth.init();
      this.personalRegistration.init();
      this.runtime.init(Date.now());
      this.worldLife?.init();
      // Task records version 2 (C06, I-07): migrates a stored version 1 inbox once, before any other commit; a restart writes nothing.
      migrateTaskStore(this.runtime, Date.now());
      initRetention(ctx.storage.sql);
      // The heartbeat (direction v2, 8.7): one alarm per minute keeps the shared world running.
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 5_000);
      // Owner claims. The Threads token stays inside this object; no method returns it over HTTP.
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS claims (agent TEXT PRIMARY KEY, record TEXT NOT NULL, token TEXT)');
      this.trust.init();
      this.connected.init();
      this.ritual.init();
      await this.trust.ensureAgents(this.ownerRoot);
      // The world's paused Muses always match the registry's revoked ones (C06).
      reconcilePaused({trust: this.trust, runtime: this.runtime});
      // The owner's Muse arrives with a small welcome gift so it has something to trade (logged as a rule).
      const owner = this.runtime.state().muses.find(m => m.id === OWNER_SLOT);
      if (owner && owner.inventory.length === 0) this.runtime.commitExternal(Date.now(), 'welcome', (st, emit) => { st.muses.find(m => m.id === OWNER_SLOT)!.inventory.push('coffee', 'postage_stamp'); emit({at: Date.now(), source: 'rule', kind: 'welcome_gift', muse: OWNER_SLOT, line: 'Welcome gift: Coffee and a Postage Stamp', data: {items: ['coffee', 'postage_stamp']}, tags: []}); });
    });
  }
  // Private auth RPCs; no provider token/code crosses into DO storage or any world commit.
  personalDraftRegister(binding: PersonalBinding, input: unknown) { return this.personalRegistration.register(binding, input); }
  personalProfileRead(binding: PersonalBinding) { return this.personalRegistration.profile(binding); }
  personalProfilePatch(binding: PersonalBinding, input: unknown) { return this.personalRegistration.patch(binding, input); }
  personalAuthBegin(flow: PersonalFlow) { return this.personalAuth.begin(flow); }
  personalAuthConsume(binding: Pick<PersonalFlow, 'stateDigest' | 'browserDigest' | 'appId' | 'redirectUri'>, now: number) { return this.personalAuth.consume(binding, now); }
  personalAuthComplete(stateDigest: string, appId: string, subject: string, sidDigest: string, now: number) { return this.personalAuth.complete(stateDigest, appId, subject, sidDigest, now); }
  personalAuthActive(sidDigest: string, proof: PersonalSessionRow, appId: string, now: number) { return this.personalAuth.active(sidDigest, proof, appId, now); }
  personalAuthRevoke(sidDigest: string, proof: PersonalSessionRow, appId: string, now: number) { return this.personalAuth.revoke(sidDigest, proof, appId, now); }
  reserve(r: ReserveRequest) { return this.ledger.reserve(r); }
  settle(id: string, costUsd: number, outcome: Outcome) { return this.ledger.settle(id, costUsd, outcome); }
  status() { this.ledger.prune(); return this.ledger.status(); }
  quota(session: string, tier: Tier) { return this.ledger.quotaFor(session, tier); }
  async alarm() {
    try {
      if(this.worldLife){const s=this.runtime.state(),now=Date.now();this.worldLife.acceptMeetingGate(s,now,await this.meetings.prepare(s,now));}
      const r = await this.runtime.heartbeat(Date.now());
      if (r.status === 'committed') console.log('heartbeat', r.tick, r.spotlight?.muse, r.spotlight?.source, r.spotlight?.reason ?? '', 'replies', r.replies?.live ?? 0, 'live', r.replies?.rule ?? 0, 'rule');
    } finally {
      // Retention (G-09): command result rows older than 7 days go, checked at most once an hour.
      try { const now = Date.now(); if (now - this.retentionAt >= RETENTION_CHECK_MS) { this.retentionAt = now; pruneCommands(this.ctx.storage.sql, now); } } catch (e) { console.error('retention failed', e); }
      // Always schedule the next beat, even if this one threw (the runtime is idempotent per tick).
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }
  }
  private ctx_(): Ctx {
    const claim = this.getClaim('owner-muse');
    return {trust: this.trust, runtime: this.runtime, ownerRoot: this.ownerRoot, ownerClaimed: claim?.status === 'claimed', baseUrl: this.origin};
  }
  p0(by?: 'judge' | 'owner') { return runP0({...this.ctx_(), requestedBy: by}); }
  impostor(target: string) { return impostorCheck(this.ctx_(), target); }
  injection(from: string, to: string, i: number) { return injectionCheck(this.ctx_(), from, to, i); }
  async agentCard(museId: string) {
    if (!this.trust.agentByMuse(museId)) return null;
    const claim = this.getClaim('owner-muse');
    return this.trust.card(museId, this.ownerRoot, {claimed: claim?.status === 'claimed', fingerprint: museId === OWNER_SLOT ? claim?.fingerprint ?? null : null}, this.origin);
  }
  jwks(kid: string) { const a = this.trust.agentById(kid); return a ? {keys: [{...a.rootJwk, kid: a.agentId, alg: 'ES256', use: 'sig'}]} : null; }
  ritualStart(session: string) { return this.ritual.start(session); }
  ritualTake(id: string, session: string) { return this.ritual.take(id, session); }
  ritualOwnerRecord() { return this.ritual.ownerRecord(); }
  /**
   * Logs a judged ritual (verdicts only, never frames). Only a passing live run made with the real owner's session
   * becomes the owner's recorded ritual; a judge link or a visitor never writes it, and the record grants nothing.
   */
  ritualRecord(rec: RitualRecord, sessionTag: string, byOwner = false) {
    if (byOwner && rec.passed) this.ritual.saveOwnerRecord(rec);
    // A unique label: two rituals judged in the same millisecond must not share an event id (the second would be dropped).
    return this.runtime.commitExternal(Date.now(), 'ritual-' + Math.random().toString(36).slice(2, 10), (_s, emit) => emit({at: Date.now(), source: rec.requestId ? 'live' : 'replay', kind: 'ritual_judged', muse: null, line: rec.passed ? 'Welcome ritual passed' : 'Welcome ritual not passed', data: {passed: rec.passed, results: rec.results, evidence: rec.requestId ? {model: rec.model, requestId: rec.requestId} : null, who: byOwner ? 'owner (owner session)' : rec.tier === 'judge' ? 'judge link ' + sessionTag : 'visitor ' + sessionTag, framesStored: false, ...(byOwner ? {actor: 'owner'} : {actorOrigin: 'trial'})}, tags: ['ritual']}));
  }
  worldView() { return this.runtime.view(Date.now()); }
  worldLifeView() { return worldLifeEnabled(this.env.WORLD_LIFE_MODE)?this.worldLife?.view()??null:null; }
  /** A visitor's priority spotlight request (8.2); the Worker route checks the session and passes an opaque requester id. */
  requestSpotlight(muse: string, origin: 'visitor' | 'judge', requester: string) {
    if (this.trust.suspended(muse)) return {ok: false as const, reason: 'paused' as const};
    return this.runtime.requestSpotlight(muse, Date.now(), {origin, requester});
  }
  worldEvents(since: number, limit: number, opts: {day?: string; tail?: number; runId?: string} = {}) { return this.runtime.events(since, Math.min(2000, Math.max(1, limit)), opts); }
  /** One page of highlights (at most 300), newest first; `before` is the cursor of the next page, `from`/`to` the period. */
  worldHighlights(limit: number, opts: {before?: number | null; from?: number | null; to?: number | null} = {}) { return this.runtime.highlights(Math.min(300, Math.max(1, limit)), opts); }
  // Run log (8.6, C08, C09): the current run, its ordered inputs, one event with its commit, the server recount.
  worldRun(runId?: string | null, snapshot = false) {
    const s = this.runtime.state(), log = this.runtime.runLog;
    if (!runId) return log.summary(s);
    const r = log.runById(runId);
    if (!r) return null;
    const readThrough = log.boundary(runId);
    return snapshot ? {...r, readThrough} : {...r, readThrough, initialSnapshot: {hash: r.initialSnapshot.hash, bytes: r.initialSnapshot.body.length}};
  }
  worldRunInputs(runId: string, since: number, limit: number) {
    const log = this.runtime.runLog, record = log.runById(runId);
    if (!record) return null;
    // V2 rows carry a checkpoint: bound a public response as well as each row/run. Callers page by seq, not page length.
    const rows = log.inputs(runId, since, record.schemaVersion === 'run-log-2' ? Math.min(16, limit) : limit);
    let bytes = 2; const out: typeof rows = [];
    for (const row of rows) {
      const size = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
      if (out.length && bytes + size > 2 * 1024 * 1024) break;
      out.push(row); bytes += size;
    }
    return out;
  }
  worldEvent(id: string) { return this.runtime.eventRecord(id); }
  worldAutonomy(q: {from?: number | null; to?: number | null; day?: string | null; runId?: string | null}) { return this.runtime.autonomy(q); }
  // Connected Muse (direction v2, 7.2, 12.3, 13.1): MCP dispatch, agent keys, owner location, notifications.
  mcp(keyHash: string, method: string, params: unknown, isNotification: boolean) { return this.connected.mcp(keyHash, method, params, isNotification); }
  mcpAuth(keyHash: string) { return this.connected.authenticate(keyHash); }
  issueAgentKey(muse: string) { return this.connected.issueKey(muse); }
  listAgentKeys(muse: string) { return this.connected.listKeys(muse); }
  agentKeyMuse(id: string) { return this.connected.keyMuse(id); }
  revokeAgentKey(id: string) { return this.connected.revokeKey(id); }
  purgeAgentKey(id: string, by: string) { return this.connected.purgeKey(id, by); }
  // Reviewer Muse reset (G-08); the Worker route checks the reviewer session.
  resetMuse(muse: string, by: string) { return resetMuse({trust: this.trust, runtime: this.runtime}, muse, by); }
  // Owner control (C06, I-02): revocation and the separate re-delegation; the Worker route checks the owner session.
  ownerRevoke(muse: string, by: string) { return revokeMuse({trust: this.trust, runtime: this.runtime}, muse, by); }
  ownerRedelegate(muse: string, by: string) { return redelegateMuse({trust: this.trust, runtime: this.runtime}, muse, by); }
  delegationStatus(muses: string[]) { return delegationStatus({trust: this.trust, runtime: this.runtime}, muses); }
  taskParticipants(taskId: string) { const t = this.runtime.state().inbox?.tasks.find(x => x.id === taskId); return t ? {from: t.from, to: t.to, status: t.status} : null; }
  // Owner approvals and the owner inbox (C06, I-07); the Worker route checks the owner session and the Muse.
  ownerApprove(input: DecisionInput) { return this.connected.ownerApprove(input); }
  ownerInbox(muses: string[]) { return this.connected.ownerInbox(muses); }
  ownerLocation() { return this.connected.ownerLocation(); }
  setOwnerLocation(input: unknown) { return this.connected.setOwnerLocation(input); }
  ownerNotifications(detailFor: string[]) { return this.connected.notifications(detailFor); }
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
