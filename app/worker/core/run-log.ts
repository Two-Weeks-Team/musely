// Versioned run log (direction v2, 8.1 and 8.6; contracts C08, C09). The world keeps one append-only record per run:
//   runs        one row per run: schema / engine / harness / catalog versions, seed, the public initial snapshot (hash
//               and body) and when it started. A run opens when the world is created, when the code versions change
//               (a deploy) and, once, for the world that was already running before this log existed ("pre-run-log").
//   run_inputs  one row per commit, in commit order: heartbeat ticks (spotlight and meeting answers: model outputs with
//               their request ids, rule fallbacks and why), commands (actor, command id, action, redacted payload,
//               result: approvals and answers are commands), refusals and other commits. Each row carries the public
//               world-state hash before and after the commit and the item-history chain head (I-06) after it, an anchor
//               kept outside the world state.
//   events      (world-runtime.ts) every event names its run (run_id) and the input row that committed it (input_seq).
// The model's answers, approvals and asynchronous answers cannot be rebuilt from the seed (8.1, C05); this log keeps them.
// Never stored: camera frames (they never reach the world) and private conditions: the owner's location (cell, preset,
// target, a Muse's anchor cell) and meetup candidate time/place details (inbox candidates, owner notification details).
// No statement in this file updates or deletes a row of runs or run_inputs.
import {ENGINE_VERSION, type WorldState, type WorldEvent} from '../../src/engine/world.ts';
import {HARNESSES} from '../../src/engine/harness.ts';
import {ITEMS} from '../../src/engine/items.ts';
import {BEATS} from '../../src/engine/beats.ts';
import {PLACES} from '../../src/engine/places.ts';
import {canonicalize} from '../../src/identity/jcs.ts';
import {sha256Hex} from '../../src/engine/sha256.ts';
import type {Sql} from './ledger.ts';

/** Version of the run-log and event record format. Bump it when a stored field changes meaning. */
export const RUN_SCHEMA_VERSION = 'run-log-1';
/** C03: who acted. `system` = a world resident or a world process, `connected` = a person's own Muse or owner, `trial` = a visitor or judge session. */
export const ACTOR_ORIGINS = ['system', 'connected', 'trial'] as const;
export type ActorOrigin = (typeof ACTOR_ORIGINS)[number];
export type RunOrigin = 'fresh' | 'pre-run-log' | 'version_change';
export type RunVersions = {schemaVersion: string; engineVersion: string; harnessVersion: string; catalogVersion: string};
export type InputKind = 'tick' | 'command' | 'refusal' | 'external';
/** Kept in place of every private value in a snapshot or an input. */
export const PRIVATE = 'private (not recorded)';

export type RunRecord = RunVersions & {
  runId: string; worldId: string; seed: string;
  initialSnapshot: {hash: string; body: string};
  startedAt: number; origin: RunOrigin; prevRunId: string | null;
  /** pre-run-log only: the events written before this log existed (they carry no run id and belong to this run). */
  legacy: {events: number; lastSeq: number; note: string} | null;
};
export type RunInput = {seq: number; runId: string; at: number; kind: InputKind; label: string; day: string; tick: number; versionBefore: number; versionAfter: number; beforeHash: string; afterHash: string; itemsHead: string | null; itemsSeq: number | null; events: number; input: Record<string, unknown> | null};

const SNAPSHOT_PREFIX = 'musely-run-state-v1\n';
let versions: RunVersions | null = null;
/** The versions of the code now running. Harness and catalog versions are content hashes, so a data change is a new version. */
export function currentVersions(): RunVersions {
  return (versions ??= {
    schemaVersion: RUN_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    harnessVersion: 'harness-' + sha256Hex(canonicalize(HARNESSES)).slice(0, 12),
    catalogVersion: 'catalog-' + sha256Hex(canonicalize({items: ITEMS, beats: BEATS, places: PLACES})).slice(0, 12),
  });
}
const sameVersions = (a: RunVersions, b: RunVersions) => a.schemaVersion === b.schemaVersion && a.engineVersion === b.engineVersion && a.harnessVersion === b.harnessVersion && a.catalogVersion === b.catalogVersion;

/**
 * The world state without private conditions: the owner location (cell, preset, target), each Muse's anchor cell
 * (it is the owner's cell), meetup candidate details and owner notification details. Everything else is kept.
 */
export function publicState(s: WorldState): Record<string, unknown> {
  const {owner, inbox, muses, ...rest} = s;
  return {
    ...rest,
    muses: muses.map(m => (m.anchor ? {...m, anchor: PRIVATE} : m)),
    owner: owner ? {source: owner.source, muse: owner.muse, verified: owner.verified, setAt: owner.setAt, location: PRIVATE} : null,
    inbox: inbox ? {...inbox, tasks: inbox.tasks.map(t => (t.candidate ? {...t, candidate: PRIVATE} : t)), notifications: inbox.notifications.map(n => (n.detail ? {...n, detail: PRIVATE} : n))} : null,
  };
}
/** The body stored as a run's initial snapshot, and the hash every commit records before and after (C09 beforeHash/afterHash). */
export const snapshotBody = (s: WorldState) => JSON.stringify(publicState(s));
export const bodyHash = (body: string) => sha256Hex(SNAPSHOT_PREFIX + body);
export const stateHash = (s: WorldState) => bodyHash(snapshotBody(s));

/** Keys whose values are private conditions wherever they appear in a recorded payload. */
const PRIVATE_KEYS = new Set(['candidate', 'detail', 'details', 'cell', 'preset', 'target', 'anchor', 'lat', 'lng', 'latitude', 'longitude', 'coords', 'frames', 'frame', 'image', 'images']);
/** A copy of a payload with private values replaced (depth-limited; strings longer than 500 characters are cut). */
export function redact(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 500 ? v.slice(0, 500) + '…' : v;
  if (depth > 6) return PRIVATE;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, PRIVATE_KEYS.has(k) ? PRIVATE : redact(x, depth + 1)]));
}
/** Model evidence kept in an input row: model and ids only (a replay keeps the recorded request's ids). */
export function evidenceIds(ev: unknown): Record<string, unknown> | null {
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as Record<string, unknown>, r = e.replayOf;
  const rep = typeof r === 'string' ? {requestId: r} : r && typeof r === 'object' ? {requestId: (r as Record<string, unknown>).requestId ?? null, responseId: (r as Record<string, unknown>).responseId ?? null, model: (r as Record<string, unknown>).model ?? null} : null;
  return {model: e.model ?? null, requestId: e.requestId ?? null, responseId: e.responseId ?? null, ...(e.reservationId ? {reservationId: e.reservationId} : {}), ...(rep ? {replayOf: rep} : {})};
}

const RUN_COLS = 'run_id, world_id, n, schema_version, engine_version, harness_version, catalog_version, seed, snapshot_hash, snapshot, started_at, origin, prev_run_id, legacy';
const INPUT_COLS = 'seq, run_id, at, kind, label, day, tick, version_before, version_after, before_hash, after_hash, items_head, items_seq, events, input';
const toRun = (r: Record<string, unknown>): RunRecord => ({runId: String(r.run_id), worldId: String(r.world_id), schemaVersion: String(r.schema_version), engineVersion: String(r.engine_version), harnessVersion: String(r.harness_version), catalogVersion: String(r.catalog_version), seed: String(r.seed), initialSnapshot: {hash: String(r.snapshot_hash), body: String(r.snapshot)}, startedAt: Number(r.started_at), origin: String(r.origin) as RunOrigin, prevRunId: r.prev_run_id == null ? null : String(r.prev_run_id), legacy: r.legacy == null ? null : JSON.parse(String(r.legacy))});
const toInput = (r: Record<string, unknown>): RunInput => ({seq: Number(r.seq), runId: String(r.run_id), at: Number(r.at), kind: String(r.kind) as InputKind, label: String(r.label), day: String(r.day), tick: Number(r.tick), versionBefore: Number(r.version_before), versionAfter: Number(r.version_after), beforeHash: String(r.before_hash), afterHash: String(r.after_hash), itemsHead: r.items_head == null ? null : String(r.items_head), itemsSeq: r.items_seq == null ? null : Number(r.items_seq), events: Number(r.events), input: r.input == null ? null : JSON.parse(String(r.input))});

export type CommitRecord = {at: number; kind: InputKind; label: string; beforeRaw: string; before: WorldState; after: WorldState; changed: boolean; events: WorldEvent[]; input?: Record<string, unknown> | null};

export class RunLog {
  private sql: Sql;
  private worldId: string;
  private run: RunRecord | null = null;
  /** The last hashed state (raw JSON → public hash): the next commit's before-state is usually the last after-state. */
  private cache: {raw: string; hash: string} | null = null;
  constructor(sql: Sql, worldId: string) { this.sql = sql; this.worldId = worldId; }

  /** Tables, and the two event columns added to worlds stored before this log (CREATE/ALTER only when missing). */
  init() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, n INTEGER NOT NULL UNIQUE, schema_version TEXT NOT NULL, engine_version TEXT NOT NULL, harness_version TEXT NOT NULL, catalog_version TEXT NOT NULL, seed TEXT NOT NULL, snapshot_hash TEXT NOT NULL, snapshot TEXT NOT NULL, started_at INTEGER NOT NULL, origin TEXT NOT NULL, prev_run_id TEXT, legacy TEXT)`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS run_inputs (seq INTEGER PRIMARY KEY, run_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, day TEXT NOT NULL, tick INTEGER NOT NULL, version_before INTEGER NOT NULL, version_after INTEGER NOT NULL, before_hash TEXT NOT NULL, after_hash TEXT NOT NULL, items_head TEXT, items_seq INTEGER, events INTEGER NOT NULL, input TEXT)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS run_inputs_run ON run_inputs (run_id, seq)');
    // The events table belongs to world-runtime.ts; an older world gets the two columns (existing rows keep NULL).
    for (const [col, type] of [['run_id', 'TEXT'], ['input_seq', 'INTEGER']]) {
      try { this.sql.exec(`SELECT ${col} FROM events LIMIT 0`).toArray(); } catch { this.sql.exec(`ALTER TABLE events ADD COLUMN ${col} ${type}`); }
    }
    this.sql.exec('CREATE INDEX IF NOT EXISTS events_run_at ON events (run_id, at)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS events_at ON events (at)');
  }

  /**
   * The current run, opened if needed: the first start of a new world (`fresh`), the first start of a world that ran
   * before this log (`pre-run-log`: its earlier events are counted as legacy), or a start whose code versions differ
   * from the last run's (`version_change`). The initial snapshot is the public state at that moment.
   */
  open(s: WorldState, now: number, existedBefore: boolean): RunRecord {
    const last = this.sql.exec(`SELECT ${RUN_COLS} FROM runs ORDER BY n DESC LIMIT 1`).toArray()[0];
    const v = currentVersions();
    if (last) {
      const prev = toRun(last);
      if (sameVersions(prev, v)) return (this.run = prev);
      return (this.run = this.insertRun(s, now, 'version_change', prev.runId, Number(last.n) + 1, null));
    }
    let legacy: RunRecord['legacy'] = null;
    if (existedBefore) {
      const r = this.sql.exec('SELECT COUNT(*) AS n, COALESCE(MAX(seq), 0) AS last FROM events WHERE run_id IS NULL').toArray()[0];
      legacy = {events: Number(r?.n ?? 0), lastSeq: Number(r?.last ?? 0), note: 'Events written before the run log: their code versions, seed history and model inputs were not recorded. The snapshot is the state when the run log started.'};
    }
    return (this.run = this.insertRun(s, now, existedBefore ? 'pre-run-log' : 'fresh', null, 1, legacy));
  }
  private insertRun(s: WorldState, now: number, origin: RunOrigin, prevRunId: string | null, n: number, legacy: RunRecord['legacy']): RunRecord {
    const body = snapshotBody(s), hash = bodyHash(body), v = currentVersions();
    const runId = `run-${n}-${now.toString(36)}-${hash.slice(0, 8)}`;
    this.sql.exec(`INSERT INTO runs (${RUN_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, runId, this.worldId, n, v.schemaVersion, v.engineVersion, v.harnessVersion, v.catalogVersion, s.seed, hash, body, now, origin, prevRunId, legacy ? JSON.stringify(legacy) : null);
    return {runId, worldId: this.worldId, ...v, seed: s.seed, initialSnapshot: {hash, body}, startedAt: now, origin, prevRunId, legacy};
  }
  get current(): RunRecord {
    if (!this.run) throw new Error('run log not opened');
    return this.run;
  }

  private hashRaw(raw: string, s: WorldState) {
    if (this.cache?.raw === raw) return this.cache.hash;
    return stateHash(s);
  }

  /**
   * Records one commit (call inside the commit's transaction, before its events are inserted). Nothing is recorded
   * for a commit that changed nothing and logged nothing. The events are completed in place: `actorOrigin` defaults to
   * system (the world's own processes; other origins are set where the event is made), and every ability_change event
   * gets the commit's beforeHash/afterHash. Returns the run id and input seq the events are stored with.
   */
  commit(c: CommitRecord): {runId: string; seq: number} | null {
    if (!c.changed && !c.events.length) return null;
    const run = this.current;
    const beforeHash = this.hashRaw(c.beforeRaw, c.before);
    const afterRaw = JSON.stringify(c.after);
    const afterHash = c.changed ? stateHash(c.after) : beforeHash;
    this.cache = {raw: afterRaw, hash: afterHash};
    const seq = Number(this.sql.exec('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM run_inputs').toArray()[0].n);
    const chain = c.after.items?.chain;
    this.sql.exec(`INSERT INTO run_inputs (${INPUT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, seq, run.runId, c.at, c.kind, c.label.slice(0, 160), c.after.day, c.after.tick, c.before.version, c.after.version, beforeHash, afterHash, chain?.head ?? null, chain?.seq ?? null, c.events.length, c.input ? JSON.stringify(c.input) : null);
    for (const e of c.events) {
      const data = (e.data ??= {});
      if (!ACTOR_ORIGINS.includes(data.actorOrigin as ActorOrigin)) data.actorOrigin = 'system';
      if (e.tags.includes('ability_change')) { data.beforeHash = beforeHash; data.afterHash = afterHash; }
    }
    return {runId: run.runId, seq};
  }

  // ---------- reads ----------
  runs(): RunRecord[] { return this.sql.exec(`SELECT ${RUN_COLS} FROM runs ORDER BY n`).toArray().map(toRun); }
  runById(runId: string): RunRecord | null { const r = this.sql.exec(`SELECT ${RUN_COLS} FROM runs WHERE run_id = ?`, runId).toArray()[0]; return r ? toRun(r) : null; }
  inputs(runId: string, sinceSeq = 0, limit = 200): RunInput[] {
    return this.sql.exec(`SELECT ${INPUT_COLS} FROM run_inputs WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?`, runId, sinceSeq, Math.min(1000, Math.max(1, limit))).toArray().map(toInput);
  }
  input(seq: number): RunInput | null { const r = this.sql.exec(`SELECT ${INPUT_COLS} FROM run_inputs WHERE seq = ?`, seq).toArray()[0]; return r ? toInput(r) : null; }
  lastInput(): RunInput | null { const r = this.sql.exec(`SELECT ${INPUT_COLS} FROM run_inputs ORDER BY seq DESC LIMIT 1`).toArray()[0]; return r ? toInput(r) : null; }
  /** The run an event belongs to: its stored run id, or the pre-run-log run for an event written before the log. */
  runOfEvent(runId: string | null): string | null {
    if (runId) return runId;
    return this.runs().find(r => r.origin === 'pre-run-log')?.runId ?? null;
  }

  /**
   * The item-history head outside the world state (I-06): the head recorded by the last commit must equal the head the
   * stored state carries now. A difference means the state was changed without a commit (or a commit was lost).
   */
  itemsAnchor(s: WorldState): {recorded: string | null; state: string | null; seq: number | null; matches: boolean | null} {
    const last = this.lastInput(), head = s.items?.chain?.head ?? null;
    if (!last || last.itemsHead === null) return {recorded: null, state: head, seq: null, matches: null};
    return {recorded: last.itemsHead, state: head, seq: last.itemsSeq, matches: last.itemsHead === head && last.itemsSeq === (s.items?.chain?.seq ?? null)};
  }

  /** GET /api/world/run: the current run without the snapshot body (its size instead), and every run in order. */
  summary(s: WorldState) {
    const run = this.current, counts = this.sql.exec('SELECT COUNT(*) AS n, COALESCE(MAX(seq), 0) AS last, MAX(at) AS at FROM run_inputs WHERE run_id = ?', run.runId).toArray()[0];
    const legacyClause = run.origin === 'pre-run-log' ? ' OR run_id IS NULL' : '';
    const events = Number(this.sql.exec(`SELECT COUNT(*) AS n FROM events WHERE run_id = ?${legacyClause}`, run.runId).toArray()[0]?.n ?? 0);
    const {initialSnapshot, ...rest} = run;
    return {
      ...rest, initialSnapshot: {hash: initialSnapshot.hash, bytes: initialSnapshot.body.length},
      versionsNow: currentVersions(),
      inputs: {count: Number(counts?.n ?? 0), lastSeq: Number(counts?.last ?? 0), lastAt: counts?.at == null ? null : Number(counts.at)},
      events, itemsAnchor: this.itemsAnchor(s), stateHash: stateHash(s),
      runs: this.runs().map(r => ({runId: r.runId, origin: r.origin, startedAt: r.startedAt, engineVersion: r.engineVersion, harnessVersion: r.harnessVersion, catalogVersion: r.catalogVersion, schemaVersion: r.schemaVersion, prevRunId: r.prevRunId})),
    };
  }
}
