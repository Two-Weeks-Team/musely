// Shared-world heartbeat inside the world Durable Object (direction v2, 8.7).
// - Commit point: state, events and the tick record are written in one synchronous block; a tick that
//   is already recorded is never committed again (alarms are at-least-once and may retry).
// - Budget: the spotlight call reserves its maximum cost with a deterministic id (world:day:tick), so a
//   retried alarm cannot reserve twice; the answer settles the real cost.
// - Late answers: if the world version moved or the actor's delegation was revoked while the model was
//   thinking, the answer is logged and not executed. Timed-out calls are aborted and charged in full.
// - Every commit runs inside the storage transaction (transactionSync): a throw anywhere rolls all of it back.
import {createWorld, tick, spotlightFor, spotlightInput, TICK_MS, type WorldState, type WorldEvent, type Decision, type Hooks} from '../../src/engine/world.ts';
import {validate, buildMessages, maxCostUsd, actualCostUsd, failureCostUsd, checkOutput} from './actions.ts';
import {callModel, type ModelConfig} from './model.ts';
import {replayFor} from './replay.ts';
import {isConnected} from '../../src/engine/inbox.ts';
import {COMMANDS_TABLE, type CommandResult} from './commands.ts';
import type {Ledger, Sql} from './ledger.ts';

/** The world's SQL handle plus the Durable Object storage transaction (ctx.storage.transactionSync). */
export type TxSql = Sql & {transactionSync<T>(fn: () => T): T};
/** Repeats of one refusal inside this window collapse into its first event (the count is kept in `refusals`). */
export const REFUSAL_WINDOW_MS = 10 * 60_000;

export type RuntimeOptions = {
  worldId: string;
  model: (Omit<ModelConfig, 'key'> & {key: string | undefined}) | null;
  ledger: Ledger;
  hooks?: Hooks;
  /** Delegation check for an actor at commit time (owner/connected Muses); residents are always valid. */
  delegationValid?: (museId: string) => boolean;
  /** Test seam: runs between the model answer and the commit (e.g. to simulate a concurrent commit). */
  beforeCommit?: () => void;
  /**
   * Checks Agent Cards and delegations before the tick (async crypto) and returns the synchronous gate the
   * engine consults before each meeting. Missing → nobody meets (fail closed); 'off' only for tests.
   */
  meetingGate: ((s: WorldState, now: number) => Promise<NonNullable<Hooks['canMeet']>>) | 'off';
};
type Emit = (e: Omit<WorldEvent, 'id' | 'tick'>) => void;
export type CommandRow = {payloadHash: string; result: CommandResult; output: unknown};
export type HeartbeatResult = {status: 'committed' | 'skipped_duplicate' | 'skipped_early'; tick: number; events: number; spotlight?: {muse: string; source: string; reason?: string}};

/** A transaction callback must finish synchronously; an async mutation would commit half-done. */
const synchronous = <T>(r: T): T => {
  if (r && typeof (r as {then?: unknown}).then === 'function') throw new Error('commit mutations must be synchronous');
  return r;
};

export class WorldRuntime {
  private sql: TxSql;
  private opts: RuntimeOptions;
  /** Commands between their lookup and their commit, per actor:commandId (one DO instance runs them all). */
  readonly pending = new Set<string>();
  constructor(sql: TxSql, opts: RuntimeOptions) { this.sql = sql; this.opts = opts; }
  get worldId() { return this.opts.worldId; }

  init(now: number) {
    this.sql.exec('CREATE TABLE IF NOT EXISTS world (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, version INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS ticks (day TEXT NOT NULL, tick INTEGER NOT NULL, committed_at INTEGER NOT NULL, spotlight TEXT, PRIMARY KEY (day, tick))');
    // Append-only run log (8.6): no UPDATE or DELETE statements touch this table.
    this.sql.exec('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, muse TEXT, other TEXT, place TEXT, line TEXT, data TEXT, tags TEXT NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS events_tags ON events (tags) WHERE tags != \'[]\'');
    this.sql.exec(COMMANDS_TABLE);
    this.sql.exec('CREATE TABLE IF NOT EXISTS refusals (key TEXT PRIMARY KEY, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, count INTEGER NOT NULL)');
    if (!this.sql.exec('SELECT id FROM world WHERE id = 1').toArray().length) {
      const s = createWorld(this.opts.worldId, now);
      this.sql.exec('INSERT INTO world (id, state, version) VALUES (1, ?, ?)', JSON.stringify(s), s.version);
    }
  }

  state(): WorldState { return JSON.parse(String(this.sql.exec('SELECT state FROM world WHERE id = 1').toArray()[0].state)); }

  /** One heartbeat. Safe to call again after a crash or an alarm retry. */
  async heartbeat(now: number): Promise<HeartbeatResult> {
    const before = this.state();
    if (now - before.lastTickAt < TICK_MS * 0.9 && before.tick > 0) return {status: 'skipped_early', tick: before.tick, events: 0};
    // A second run for the same tick (alarm retry while the first is still waiting) stops here,
    // before any model call: the tick is committed or its spotlight reservation already exists.
    if (this.tickTaken(before)) return {status: 'skipped_duplicate', tick: before.tick, events: 0};
    try {
      const spot = spotlightFor(before, now);
      const [{decision, info}, canMeet] = await Promise.all([this.liveSpotlight(before, spot.muse, spot.freedom, now), this.meetingGate(before, now)]);
      this.opts.beforeCommit?.();
      // Commit point: everything below is synchronous and one storage transaction.
      return this.sql.transactionSync(() => {
      const current = this.state();
      if (current.tick !== before.tick || current.day !== before.day || this.sql.exec('SELECT 1 FROM ticks WHERE day = ? AND tick = ?', before.day, before.tick).toArray().length) return {status: 'skipped_duplicate', tick: before.tick, events: 0};
      let usable = decision;
      const late: Omit<WorldEvent, 'id' | 'tick'>[] = [];
      if (decision && current.version !== before.version) { late.push({at: now, source: decision.source, kind: 'decision_discarded', muse: decision.muse, data: {reason: 'world changed while the model was answering', evidence: decision.evidence ?? null}, tags: []}); usable = null; }
      if (decision && this.opts.delegationValid && !this.opts.delegationValid(decision.muse)) { late.push({at: now, source: decision.source, kind: 'decision_discarded', muse: decision.muse, data: {reason: 'delegation revoked before commit', evidence: decision.evidence ?? null}, tags: []}); usable = null; }
      const {state, events} = tick(current, {now, decision: usable}, canMeet ? {...this.opts.hooks, canMeet: this.dedupMeetings(canMeet)} : this.opts.hooks);
      // Refusal windows that closed (here or during the tick) leave one summary with their repeat count.
      const repeats = [...this.closedRepeats.splice(0), ...this.closeRefusalWindows(now)].map((e, i) => ({...e, id: `${current.day}:${current.tick}:repeats${i}`, tick: current.tick}));
      const all = [...events, ...late.map((e, i) => ({...e, id: `${current.day}:${current.tick}:late${i}`, tick: current.tick})), ...repeats];
      if (!usable && info.reason) all.push({at: now, source: info.source as WorldEvent['source'], kind: 'spotlight_fallback', muse: spot.muse, data: {reason: info.reason}, tags: [], id: `${current.day}:${current.tick}:fallback`, tick: current.tick});
      this.sql.exec('UPDATE world SET state = ?, version = ? WHERE id = 1', JSON.stringify(state), state.version);
      this.sql.exec('INSERT INTO ticks (day, tick, committed_at, spotlight) VALUES (?, ?, ?, ?)', current.day, current.tick, now, JSON.stringify({muse: spot.muse, ...info}));
      for (const e of all) this.sql.exec('INSERT OR IGNORE INTO events (id, tick, at, source, kind, muse, other, place, line, data, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', e.id, e.tick, e.at, e.source, e.kind, e.muse, e.other ?? null, e.place ?? null, e.line ?? null, JSON.stringify(e.data ?? {}), JSON.stringify(e.tags));
      return {status: 'committed' as const, tick: current.tick, events: all.length, spotlight: {muse: spot.muse, ...info}};
      });
    } finally {
      this.inFlight.delete(this.reservationId(before));
    }
  }

  private async meetingGate(s: WorldState, now: number): Promise<Hooks['canMeet']> {
    if (this.opts.meetingGate === 'off') return undefined;
    // Verification is never skipped and the world never stops: if the check cannot run, nobody meets this tick.
    const closed = (reason: string): NonNullable<Hooks['canMeet']> => (_s, a, b, place, at) => ({ok: false, event: {at, source: 'live', kind: 'meeting_refused', muse: a.id, other: b.id, place: place.id, line: 'Meeting paused: credentials could not be checked', data: {stage: 'verify', reason, dedup_key: `meeting:${[a.id, b.id].sort().join('|')}:${reason}:verify`}, tags: ['meeting_refused']}});
    if (typeof this.opts.meetingGate !== 'function') return closed('verification_not_configured');
    try { return await this.opts.meetingGate(s, now); } catch (e) {
      console.error('meeting gate failed', e);
      return closed('verification_unavailable');
    }
  }
  /** A refused meeting is logged once per pair and reason per window, across restarts. */
  private dedupMeetings(gate: NonNullable<Hooks['canMeet']>): NonNullable<Hooks['canMeet']> {
    return (st, a, b, place, at) => {
      const r = gate(st, a, b, place, at);
      const key = r.event?.data?.dedup_key;
      return !r.ok && typeof key === 'string' && !this.noteRefusal(key, at) ? {ok: false, event: null} : r;
    };
  }
  /** Summaries of windows closed inside a tick (the meeting gate cannot emit them itself). */
  private closedRepeats: Omit<WorldEvent, 'id' | 'tick'>[] = [];
  /** Deletes windows that ended; each one that suppressed repeats becomes a refusal_repeats event (repeat_count = occurrences). */
  private closeRefusalWindows(now: number): Omit<WorldEvent, 'id' | 'tick'>[] {
    const closed = this.sql.exec('SELECT key, first_at, last_at, count FROM refusals WHERE first_at <= ?', now - REFUSAL_WINDOW_MS).toArray();
    if (!closed.length) return [];
    this.sql.exec('DELETE FROM refusals WHERE first_at <= ?', now - REFUSAL_WINDOW_MS);
    return closed.filter(r => Number(r.count) > 1).map(r => ({at: now, source: 'live', kind: 'refusal_repeats', muse: null, line: null, data: {dedup_key: String(r.key), repeat_count: Number(r.count), suppressed: Number(r.count) - 1, first_at: Number(r.first_at), last_at: Number(r.last_at)}, tags: []}));
  }
  /** Counts a refusal; true when it opens a new window (log an event), false for a repeat inside the window. */
  noteRefusal(key: string, now: number) {
    this.closedRepeats.push(...this.closeRefusalWindows(now));
    const r = this.sql.exec('SELECT first_at FROM refusals WHERE key = ?', key).toArray()[0];
    if (r) { this.sql.exec('UPDATE refusals SET count = count + 1, last_at = ? WHERE key = ?', now, key); return false; }
    this.sql.exec('INSERT INTO refusals (key, first_at, last_at, count) VALUES (?, ?, ?, 1)', key, now, now);
    return true;
  }
  /**
   * The one refusal commit. It never moves the version (a refused request cannot make concurrent valid plans
   * stale) and writes nothing when nothing changed. With `dedup` (default) a repeat of `key` inside the window
   * is only counted; `dedup: false` always logs (evidence flows such as P0 must keep every event).
   */
  commitRefusal(now: number, label: string, key: string, mutate: (s: WorldState, emit: Emit) => void, dedup = true) {
    return this.commit(now, label, (st, emit) => {
      const fresh = this.noteRefusal(key, now);
      for (const e of this.closedRepeats.splice(0)) emit(e);
      if (!fresh && dedup) return;
      mutate(st, e => emit({...e, data: {...(e.data ?? {}), dedup_key: key}}));
    }, () => false).events;
  }
  refusalCount(key: string) { return Number(this.sql.exec('SELECT count FROM refusals WHERE key = ?', key).toArray()[0]?.count ?? 0); }

  private reservationId(s: WorldState) { return `${this.opts.worldId}:${s.day}:${s.tick}:spotlight`; }
  private inFlight = new Set<string>();
  private tickTaken(s: WorldState) {
    const id = this.reservationId(s);
    if (this.inFlight.has(id)) return true;
    if (this.sql.exec('SELECT 1 FROM ticks WHERE day = ? AND tick = ?', s.day, s.tick).toArray().length) return true;
    this.inFlight.add(id);
    return false;
  }

  private async liveSpotlight(s: WorldState, muse: string, freedom: Decision['freedom'], now: number): Promise<{decision: Decision | null; info: {source: string; reason?: string; requestId?: string | null}}> {
    // The world must never stop on one bad input: if the spotlight input cannot be built, the scenario continues.
    let input;
    try { input = validate('spotlight', spotlightInput(s, muse, freedom, now)); }
    catch (e) { return {decision: null, info: {source: 'scripted', reason: 'input_invalid: ' + String((e as Error).message).slice(0, 80)}}; }
    const fallback = (reason: string) => {
      const r = replayFor('spotlight', input);
      const out = r.output as Decision['output'] & {freedom?: string};
      // A recorded answer is used only if it was made for this freedom; otherwise the scenario continues.
      if (r.source === 'replay' && out?.freedom === freedom && (r.recorded as {muse?: string} | null)?.muse === muse) return {decision: {muse, freedom, source: 'replay' as const, output: out, evidence: {replayOf: r.recorded}}, info: {source: 'replay', reason}};
      return {decision: null, info: {source: 'scripted', reason}};
    };
    // A connected Muse thinks in its owner's runtime (8.8): the team key never decides for it.
    if (isConnected(s.inbox, muse, now)) return {decision: null, info: {source: 'scripted', reason: 'connected_muse'}};
    if (!this.opts.model?.key) return fallback('not_connected');
    const messages = buildMessages('spotlight', input);
    const id = this.reservationId(s);
    const res = this.opts.ledger.reserve({id, tier: 'world', session: 'world', ip: '', action: 'spotlight', maxCostUsd: maxCostUsd('spotlight', messages)});
    if (!res.ok) return fallback(res.reason);
    const result = await callModel({...this.opts.model, key: this.opts.model.key}, 'spotlight', messages);
    if (!result.ok) { this.opts.ledger.settle(id, failureCostUsd(result), result.kind === 'timeout' ? 'timeout' : 'error'); return fallback(result.kind); }
    const problem = checkOutput('spotlight', input, result.output);
    this.opts.ledger.settle(id, actualCostUsd(result.usage), problem ? 'rejected' : 'live');
    if (problem) return fallback('output_rejected:' + problem);
    const evidence = {model: this.opts.model.model, requestId: result.requestId, responseId: result.responseId, latencyMs: result.latencyMs, reservationId: id};
    return {decision: {muse, freedom, source: 'live', output: result.output as Decision['output'], evidence}, info: {source: 'live', requestId: result.requestId}};
  }

  /**
   * Commit point for actions outside the heartbeat (A2A trades, revocations, demo checks): the mutator runs
   * synchronously on the current state, then state, version and events are written together.
   */
  commitExternal(now: number, label: string, mutate: (s: WorldState, emit: Emit) => void) {
    return this.commit(now, label, mutate, () => true).events;
  }
  /**
   * Command commit point (C03), one transaction: `guard` runs first (stored-row re-check, nonce claim) and
   * may abort with a code before anything is written; then the mutation, the version (a refused rule bumps it
   * only when the state really changed), the events and the stored result row.
   */
  commitCommand(now: number, label: string, c: {guard: () => string | null; mutate: (s: WorldState, emit: Emit) => {ok: boolean}; record: (version: number, events: WorldEvent[]) => {actorId: string; commandId: string; action: string; row: CommandRow}}): {aborted: string} | {aborted: null; events: WorldEvent[]; row: CommandRow} {
    return this.sql.transactionSync(() => {
      const aborted = c.guard();
      if (aborted) return {aborted};
      let ok = false, row: CommandRow | null = null;
      const done = this.write(now, label, (s, emit) => { ok = synchronous(c.mutate(s, emit)).ok; }, changed => ok || changed, (s, events) => {
        const rec = c.record(s.version, events);
        this.sql.exec('INSERT INTO commands (actor_id, command_id, payload_hash, action, result, output, at) VALUES (?, ?, ?, ?, ?, ?, ?)', rec.actorId, rec.commandId, rec.row.payloadHash, rec.action, JSON.stringify(rec.row.result), JSON.stringify(rec.row.output ?? null), now);
        row = rec.row;
      });
      return {aborted: null, events: done.events, row: row!};
    });
  }
  commandRow(actorId: string, commandId: string): CommandRow | null {
    const r = this.sql.exec('SELECT payload_hash, result, output FROM commands WHERE actor_id = ? AND command_id = ?', actorId, commandId).toArray()[0];
    return r ? {payloadHash: String(r.payload_hash), result: JSON.parse(String(r.result)), output: JSON.parse(String(r.output))} : null;
  }

  private commit(now: number, label: string, mutate: (s: WorldState, emit: Emit) => void, bump: (changed: boolean) => boolean) {
    return this.sql.transactionSync(() => this.write(now, label, mutate, bump));
  }
  /** The body of a commit; callers hold the transaction (never nested). */
  private write(now: number, label: string, mutate: (s: WorldState, emit: Emit) => void, bump: (changed: boolean) => boolean, after?: (s: WorldState, events: WorldEvent[]) => void) {
    const raw = String(this.sql.exec('SELECT state FROM world WHERE id = 1').toArray()[0].state);
    const s: WorldState = JSON.parse(raw), out: WorldEvent[] = [];
    let n = 0;
    synchronous(mutate(s, e => out.push({...e, id: `${s.day}:${s.tick}:${label}:${now}:${n++}`, tick: s.tick})) as unknown);
    const changed = JSON.stringify(s) !== raw, bumped = bump(changed);
    if (bumped) s.version += 1;
    if (changed || bumped) this.sql.exec('UPDATE world SET state = ?, version = ? WHERE id = 1', JSON.stringify(s), s.version);
    for (const e of out) this.sql.exec('INSERT OR IGNORE INTO events (id, tick, at, source, kind, muse, other, place, line, data, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', e.id, e.tick, e.at, e.source, e.kind, e.muse, e.other ?? null, e.place ?? null, e.line ?? null, JSON.stringify(e.data ?? {}), JSON.stringify(e.tags));
    after?.(s, out);
    return {state: s, events: out};
  }

  /** Events after `sinceSeq` in order; with `day` only that world day (ids start with the day); with `tail` the newest N. */
  events(sinceSeq = 0, limit = 200, opts: {day?: string; tail?: number} = {}) {
    if (opts.tail) {
      return this.sql.exec('SELECT seq, id, tick, at, source, kind, muse, other, place, line, data, tags FROM events ORDER BY seq DESC LIMIT ?', Math.min(500, opts.tail)).toArray().reverse()
        .map(r => ({...r, data: JSON.parse(String(r.data)), tags: JSON.parse(String(r.tags))}) as WorldEvent & {seq: number});
    }
    const day = opts.day && /^\d{4}-\d{2}-\d{2}$/.test(opts.day) ? opts.day + ':%' : '%';
    return this.sql.exec('SELECT seq, id, tick, at, source, kind, muse, other, place, line, data, tags FROM events WHERE seq > ? AND id LIKE ? ORDER BY seq LIMIT ?', sinceSeq, day, limit).toArray()
      .map(r => ({...r, data: JSON.parse(String(r.data)), tags: JSON.parse(String(r.tags))}) as WorldEvent & {seq: number});
  }
  eventsOfKind(tick: number, kind: string) {
    return this.sql.exec('SELECT seq, id, tick, at, source, kind, muse, other, place, line, data, tags FROM events WHERE tick = ? AND kind = ? ORDER BY seq', tick, kind).toArray()
      .map(r => ({...r, data: JSON.parse(String(r.data)), tags: JSON.parse(String(r.tags))}) as WorldEvent & {seq: number});
  }
  highlights(limit = 100) {
    return this.sql.exec("SELECT seq, id, tick, at, source, kind, muse, other, place, line, data, tags FROM events WHERE tags != '[]' ORDER BY seq DESC LIMIT ?", limit).toArray()
      .map(r => ({...r, data: JSON.parse(String(r.data)), tags: JSON.parse(String(r.tags))}));
  }
  /** Compact public view for clients: positions, current beats, inventories, spotlight. */
  view(now: number) {
    const s = this.state();
    return {worldId: s.worldId, day: s.day, tick: s.tick, version: s.version, lastTickAt: s.lastTickAt, nextSpotlight: spotlightFor(s, now), muses: s.muses.map(m => ({id: m.id, place: m.place, travel: m.travel, beat: m.beat, inventory: m.inventory, reflection: m.reflection, wants: m.wants}))};
  }
}
