// Shared-world heartbeat inside the world Durable Object (direction v2, 8.7).
// - Commit point: state, events and the tick record are written in one synchronous block; a tick that
//   is already recorded is never committed again (alarms are at-least-once and may retry).
// - Budget: the spotlight call reserves its maximum cost with a deterministic id (world:day:tick), so a
//   retried alarm cannot reserve twice; the answer settles the real cost.
// - Late answers: if the world version moved or the actor's delegation was revoked while the model was
//   thinking, the answer is logged and not executed. Timed-out calls are aborted and charged in full.
import {createWorld, tick, spotlightFor, spotlightInput, TICK_MS, type WorldState, type WorldEvent, type Decision, type Hooks} from '../../src/engine/world.ts';
import {validate, buildMessages, maxCostUsd, actualCostUsd, failureCostUsd, checkOutput} from './actions.ts';
import {callModel, type ModelConfig} from './model.ts';
import {replayFor} from './replay.ts';
import type {Ledger, Sql} from './ledger.ts';

export type RuntimeOptions = {
  worldId: string;
  model: (Omit<ModelConfig, 'key'> & {key: string | undefined}) | null;
  ledger: Ledger;
  hooks?: Hooks;
  /** Delegation check for an actor at commit time (owner/connected Muses); residents are always valid. */
  delegationValid?: (museId: string) => boolean;
  /** Test seam: runs between the model answer and the commit (e.g. to simulate a concurrent commit). */
  beforeCommit?: () => void;
};
export type HeartbeatResult = {status: 'committed' | 'skipped_duplicate' | 'skipped_early'; tick: number; events: number; spotlight?: {muse: string; source: string; reason?: string}};

export class WorldRuntime {
  private sql: Sql;
  private opts: RuntimeOptions;
  constructor(sql: Sql, opts: RuntimeOptions) { this.sql = sql; this.opts = opts; }

  init(now: number) {
    this.sql.exec('CREATE TABLE IF NOT EXISTS world (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, version INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS ticks (day TEXT NOT NULL, tick INTEGER NOT NULL, committed_at INTEGER NOT NULL, spotlight TEXT, PRIMARY KEY (day, tick))');
    // Append-only run log (8.6): no UPDATE or DELETE statements touch this table.
    this.sql.exec('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, muse TEXT, other TEXT, place TEXT, line TEXT, data TEXT, tags TEXT NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS events_tags ON events (tags) WHERE tags != \'[]\'');
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
      const {decision, info} = await this.liveSpotlight(before, spot.muse, spot.freedom, now);
      this.opts.beforeCommit?.();
      // Commit point: everything below is synchronous, so no other request interleaves.
      const current = this.state();
      if (current.tick !== before.tick || current.day !== before.day || this.sql.exec('SELECT 1 FROM ticks WHERE day = ? AND tick = ?', before.day, before.tick).toArray().length) return {status: 'skipped_duplicate', tick: before.tick, events: 0};
      let usable = decision;
      const late: Omit<WorldEvent, 'id' | 'tick'>[] = [];
      if (decision && current.version !== before.version) { late.push({at: now, source: decision.source, kind: 'decision_discarded', muse: decision.muse, data: {reason: 'world changed while the model was answering', evidence: decision.evidence ?? null}, tags: []}); usable = null; }
      if (decision && this.opts.delegationValid && !this.opts.delegationValid(decision.muse)) { late.push({at: now, source: decision.source, kind: 'decision_discarded', muse: decision.muse, data: {reason: 'delegation revoked before commit', evidence: decision.evidence ?? null}, tags: []}); usable = null; }
      const {state, events} = tick(current, {now, decision: usable}, this.opts.hooks);
      const all = [...events, ...late.map((e, i) => ({...e, id: `${current.day}:${current.tick}:late${i}`, tick: current.tick}))];
      if (!usable && info.reason) all.push({at: now, source: info.source as WorldEvent['source'], kind: 'spotlight_fallback', muse: spot.muse, data: {reason: info.reason}, tags: [], id: `${current.day}:${current.tick}:fallback`, tick: current.tick});
      this.sql.exec('UPDATE world SET state = ?, version = ? WHERE id = 1', JSON.stringify(state), state.version);
      this.sql.exec('INSERT INTO ticks (day, tick, committed_at, spotlight) VALUES (?, ?, ?, ?)', current.day, current.tick, now, JSON.stringify({muse: spot.muse, ...info}));
      for (const e of all) this.sql.exec('INSERT OR IGNORE INTO events (id, tick, at, source, kind, muse, other, place, line, data, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', e.id, e.tick, e.at, e.source, e.kind, e.muse, e.other ?? null, e.place ?? null, e.line ?? null, JSON.stringify(e.data ?? {}), JSON.stringify(e.tags));
      return {status: 'committed', tick: current.tick, events: all.length, spotlight: {muse: spot.muse, ...info}};
    } finally {
      this.inFlight.delete(this.reservationId(before));
    }
  }

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
    const input = validate('spotlight', spotlightInput(s, muse, freedom, now));
    const fallback = (reason: string) => {
      const r = replayFor('spotlight', input);
      const out = r.output as Decision['output'] & {freedom?: string};
      // A recorded answer is used only if it was made for this freedom; otherwise the scenario continues.
      if (r.source === 'replay' && out?.freedom === freedom && (r.recorded as {muse?: string} | null)?.muse === muse) return {decision: {muse, freedom, source: 'replay' as const, output: out, evidence: {replayOf: r.recorded}}, info: {source: 'replay', reason}};
      return {decision: null, info: {source: 'scripted', reason}};
    };
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

  events(sinceSeq = 0, limit = 200) {
    return this.sql.exec('SELECT seq, id, tick, at, source, kind, muse, other, place, line, data, tags FROM events WHERE seq > ? ORDER BY seq LIMIT ?', sinceSeq, limit).toArray()
      .map(r => ({...r, data: JSON.parse(String(r.data)), tags: JSON.parse(String(r.tags))}));
  }
  highlights(limit = 100) {
    return this.sql.exec("SELECT seq, id, tick, at, source, kind, muse, other, place, line, data, tags FROM events WHERE tags != '[]' ORDER BY seq DESC LIMIT ?", limit).toArray()
      .map(r => ({...r, data: JSON.parse(String(r.data)), tags: JSON.parse(String(r.tags))}));
  }
  /** Compact public view for clients: positions, current beats, inventories, spotlight. */
  view(now: number) {
    const s = this.state();
    return {worldId: s.worldId, day: s.day, tick: s.tick, version: s.version, lastTickAt: s.lastTickAt, nextSpotlight: spotlightFor(s, now), muses: s.muses.map(m => ({id: m.id, place: m.place, travel: m.travel, beat: m.beat, inventory: m.inventory, reflection: m.reflection}))};
  }
}
