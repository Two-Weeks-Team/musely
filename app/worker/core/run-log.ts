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
// No free text either: greetings, postcard notes, wants goals, model lines and reasons, reflections and memories are
// stored as a SHA-256 of the text (the public events keep the text, and the key purge in data-retention.ts can anonymize
// them there); command payloads keep only their hash and the per-action id fields (COMMAND_FIELDS). So nothing here is
// a purge target and both tables stay append-only. No statement in this file updates or deletes a row of runs or
// run_inputs (run_counts is a counter cache, not part of the record).
import type {WorldState, WorldEvent} from '../../src/engine/world.ts';
import {canonicalize} from '../../src/identity/jcs.ts';
import {sha256Hex} from '../../src/engine/sha256.ts';
import type {Sql} from './ledger.ts';

/** Version of the run-log and event record format. Bump it when a stored field changes meaning. */
import {RUN_SCHEMA_VERSION, currentVersions, MAX_REPLAY_SNAPSHOT_BYTES, MAX_RUN_REPLAY_BYTES, type RunVersions} from '../../src/replay/versions.ts';
export {RUN_SCHEMA_VERSION, currentVersions};
export type {RunVersions};
/** C03: who acted. `system` = a world resident or a world process, `connected` = a person's own Muse or owner, `trial` = a visitor or judge session. */
export const ACTOR_ORIGINS = ['system', 'connected', 'trial'] as const;
export type ActorOrigin = (typeof ACTOR_ORIGINS)[number];
export type RunOrigin = 'fresh' | 'pre-run-log' | 'version_change';
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
export type RunBoundary = {inputSeq: number; eventSeq: number; inputs: number; events: number};
export type ReplaySnapshotError = 'snapshot_too_large' | 'replay_storage_limit';
export type RunInput = {seq: number; runId: string; at: number; kind: InputKind; label: string; day: string; tick: number; versionBefore: number; versionAfter: number; beforeHash: string; afterHash: string; itemsHead: string | null; itemsSeq: number | null; events: number; input: Record<string, unknown> | null; afterSnapshot: {hash: string; body: string} | null; afterSnapshotError: ReplaySnapshotError | null};

const SNAPSHOT_PREFIX = 'musely-run-state-v1\n';
const sameVersions = (a: RunVersions, b: RunVersions) => a.schemaVersion === b.schemaVersion && a.engineVersion === b.engineVersion && a.harnessVersion === b.harnessVersion && a.catalogVersion === b.catalogVersion;

/** A SHA-256 of a free text (null stays null): the run log names a text without keeping it. */
export const textHash = (t: unknown) => (typeof t === 'string' ? 'text-sha256:' + sha256Hex('musely-run-text-v1\n' + t) : t === undefined ? null : t);
/** A single id-like token (Muse, item, place, task ids, enum values): kept as is. Anything with spaces is not an id. */
const ID_RE = /^[A-Za-z0-9_.:\/|@#-]{1,96}$/;
const isId = (v: unknown) => typeof v === 'string' && ID_RE.test(v);

type Rule = 'copy' | 'text' | 'texts' | 'private' | ((v: any) => unknown);
type Table = Record<string, Rule>;
const pick = (o: Record<string, unknown> | null | undefined, t: Table): Record<string, unknown> | null => {
  if (!o || typeof o !== 'object') return (o ?? null) as null;
  const out: Record<string, unknown> = {};
  for (const [k, rule] of Object.entries(t)) {
    if (!(k in o) || o[k] === undefined) continue;
    const v = o[k];
    out[k] = rule === 'copy' ? v : rule === 'text' ? textHash(v) : rule === 'texts' ? (Array.isArray(v) ? v.map(textHash) : textHash(v)) : rule === 'private' ? PRIVATE : rule(v);
  }
  return out;
};
const each = (t: Table) => (v: unknown) => (Array.isArray(v) ? v.map(x => pick(x as Record<string, unknown>, t)) : null);
/**
 * Allow-lists of the public snapshot: every field of the world state is named here with what is kept. A field that is
 * not listed is left out; scripts/run-log.test.mjs fails when the state has a field none of these tables names.
 */
export const SNAPSHOT_FIELDS: Record<'state' | 'muse' | 'wants' | 'beat' | 'owner' | 'inbox' | 'task' | 'help' | 'message' | 'mail' | 'notification' | 'invite', Table> = {
  state: {} as Table, muse: {} as Table,
  wants: {goal: 'text', items: 'copy', source: 'copy', updatedAt: 'copy'},
  beat: {id: 'copy', clip: 'copy', startedAt: 'copy', endsAt: 'copy', line: 'text'},
  // The owner location (cell, preset, target) is private; whether it is set and verified is not.
  owner: {source: 'copy', muse: 'copy', verified: 'copy', setAt: 'copy', cell: 'private', preset: 'private', target: 'private', area: 'private'},
  inbox: {} as Table,
  task: {id: 'copy', kind: 'copy', from: 'copy', to: 'copy', status: 'copy', awaiting: 'copy', createdAt: 'copy', deadline: 'copy', updatedAt: 'copy', offer: 'copy', round: 'copy', candidate: 'private', answers: 'copy', history: 'copy',
    // Version 2 (I-07): the meetup candidates, the hash that fingerprints them, the owner decisions, who decides and
    // the chosen candidate are private; the revision, the record version and the stage are not.
    schema: 'copy', revision: 'copy', contentHash: 'private', candidates: 'private', approvals: 'private', stage: 'copy', owners: 'private', confirmed: 'private'},
  // A help request (I-13): ids as they are, the request line by its hash.
  help: {service: 'copy', item: 'copy', part: 'copy', asked: 'copy', result: 'copy', note: 'text'},
  message: {id: 'copy', from: 'copy', to: 'copy', kind: 'copy', at: 'copy', text: 'text', item: 'copy', blocked: 'copy', read: 'copy', encounter: (v: unknown) => pick(v as Record<string, unknown>, {id: 'copy', place: 'copy', first_contact: 'copy'})},
  mail: {id: 'copy', from: 'copy', to: 'copy', item: 'copy', text: 'text', sentAt: 'copy', deliverAt: 'copy', crossRegion: 'copy', timed: 'copy'},
  notification: {id: 'copy', kind: 'copy', at: 'copy', line: 'text', ref: 'copy', other: 'copy', muse: 'copy', detail: 'private'},
  // A campfire invite (I-13): ids, answers and times as they are, the invitation line by its hash.
  invite: {id: 'copy', from: 'copy', to: 'copy', place: 'copy', note: 'text', at: 'copy', expiresAt: 'copy', status: 'copy', answers: 'copy', closedAt: 'copy', gathered: 'copy'},
};
const F = SNAPSHOT_FIELDS;
// A Muse's anchor is the owner's cell (13.1): private.
Object.assign(F.muse, {id: 'copy', place: 'copy', travel: 'copy', beat: (v: unknown) => pick(v as Record<string, unknown>, F.beat), inventory: 'copy', memory: 'texts', reflection: 'text', lastMet: 'copy', introductions: 'copy', controlMode: 'copy', intent: 'copy', wants: (v: unknown) => pick(v as Record<string, unknown>, F.wants), anchor: 'private'} satisfies Table);
Object.assign(F.task, {help: (v: unknown) => pick(v as Record<string, unknown>, F.help)} satisfies Table);
Object.assign(F.inbox, {version: 'copy', tasks: each(F.task), messages: each(F.message), mail: each(F.mail), notifications: each(F.notification), invites: each(F.invite), connected: 'copy', encounters: 'copy', sent: 'copy', seq: 'copy'} satisfies Table);
Object.assign(F.state, {worldId: 'copy', day: 'copy', seed: 'copy', tick: 'copy', version: 'copy', lastTickAt: 'copy', spotlight: 'copy', items: 'copy', paused: 'copy', muses: each(F.muse), owner: (v: unknown) => pick(v as Record<string, unknown>, F.owner), inbox: (v: unknown) => pick(v as Record<string, unknown>, F.inbox)} satisfies Table);

/**
 * The world state as the run log keeps it: only the allow-listed fields, private conditions (owner location, a Muse's
 * anchor cell, meetup candidate details, owner notification details) replaced by PRIVATE, free text by its hash.
 */
export function publicState(s: WorldState): Record<string, unknown> { return pick(s as unknown as Record<string, unknown>, F.state)!; }
/** The body stored as a run's initial snapshot, and the hash every commit records before and after (the world-state hashes). */
export const snapshotBody = (s: WorldState) => JSON.stringify(publicState(s));
export const bodyHash = (body: string) => sha256Hex(SNAPSHOT_PREFIX + body);
export const stateHash = (s: WorldState) => bodyHash(snapshotBody(s));

/**
 * C09 ability state of the Muses an ability_change event is about (its muse and other): their inventory and item
 * expiry clocks only. A tagged event whose before and after hashes are equal changed no ability.
 */
export function abilityHash(s: WorldState, muses: readonly string[]): string {
  const body = [...new Set(muses)].sort().map(id => {
    const m = s.muses.find(x => x.id === id);
    const expiry = (s.items?.expiry?.[id] ?? []).map(x => ({item: x.item, at: x.at, expiresAt: x.expiresAt})).sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : a.at - b.at));
    return {id, inventory: m ? [...m.inventory].sort() : null, expiry};
  });
  return sha256Hex('musely-ability-v1\n' + canonicalize(body));
}

/** Command payload fields kept per action (ids and enum values only; free text such as a greeting or a goal never). */
export const COMMAND_FIELDS: Record<string, readonly string[]> = {
  owner_approval: ['taskId', 'museId', 'decision', 'revision', 'approvalRef'],
  tasks_migrated: ['from', 'to', 'migrated', 'failedToCancelled', 'candidatesMoved', 'tasks'],
  move: ['kind', 'to', 'mode'], discover: ['kind'], craft: ['kind', 'recipe'], greet: ['kind', 'to'], say_hello: ['kind', 'to'],
  propose_trade: ['kind', 'to', 'give', 'want'], counter_trade: ['kind', 'task_id', 'give', 'want'], accept_trade: ['kind', 'task_id'], reject_trade: ['kind', 'task_id'],
  send_postcard: ['kind', 'to', 'item'], give_gift: ['kind', 'to', 'item'], propose_meetup: ['kind', 'to'], answer_candidate: ['kind', 'task_id', 'answer'], update_wants: ['kind', 'items'],
  // I-13: the invitation and request lines (`text`) are never kept.
  invite_campfire: ['kind', 'to'], answer_campfire: ['kind', 'invite_id', 'answer'], propose_help: ['kind', 'to', 'item', 'needs'], answer_help: ['kind', 'task_id', 'answer', 'item'],
};
/** The allowed fields of a command payload whose values are ids (or lists of ids); every other key is only named in `omitted`. */
export function commandFields(action: string, payload: unknown): {fields: Record<string, unknown>; omitted: string[]} {
  const allowed = new Set(COMMAND_FIELDS[action] ?? []), fields: Record<string, unknown> = {}, omitted: string[] = [];
  for (const [k, v] of Object.entries(payload && typeof payload === 'object' ? payload as Record<string, unknown> : {})) {
    const ok = allowed.has(k) && (v === null || typeof v === 'boolean' || typeof v === 'number' || isId(v) || (Array.isArray(v) && v.length <= 8 && v.every(isId)));
    if (ok) fields[k] = v; else omitted.push(k);
  }
  return {fields, omitted: omitted.sort()};
}
/** Free-text fields of a model answer (spotlight, meeting answer): kept as hashes. */
const OUTPUT_TEXT = new Set(['line', 'public_reason', 'reason', 'text', 'goal', 'note']);
/** A model answer for the run log: ids, enum values and booleans as they are, every other string hashed. */
export function outputFields(o: unknown): Record<string, unknown> | null {
  if (!o || typeof o !== 'object') return null;
  return Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? (OUTPUT_TEXT.has(k) || !isId(v) ? (v === '' ? '' : textHash(v)) : v) : typeof v === 'boolean' || typeof v === 'number' || v === null ? v : textHash(JSON.stringify(v))]));
}
/** The code of a fallback or discard reason ("input_invalid: …" → "input_invalid"); the text after it is not kept. */
export const reasonCode = (r: unknown) => (typeof r === 'string' && r ? (r.split(':')[0].trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'other') : null);
/** Model evidence kept in an input row: model and ids only (a replay keeps the recorded request's ids). */
export function evidenceIds(ev: unknown): Record<string, unknown> | null {
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as Record<string, unknown>, r = e.replayOf;
  const rep = typeof r === 'string' ? {requestId: r} : r && typeof r === 'object' ? {requestId: (r as Record<string, unknown>).requestId ?? null, responseId: (r as Record<string, unknown>).responseId ?? null, model: (r as Record<string, unknown>).model ?? null} : null;
  return {model: e.model ?? null, requestId: e.requestId ?? null, responseId: e.responseId ?? null, ...(e.reservationId ? {reservationId: e.reservationId} : {}), ...(rep ? {replayOf: rep} : {})};
}

const RUN_COLS = 'run_id, world_id, n, schema_version, engine_version, harness_version, catalog_version, seed, snapshot_hash, snapshot, started_at, origin, prev_run_id, legacy';
const INPUT_COLS = 'seq, run_id, at, kind, label, day, tick, version_before, version_after, before_hash, after_hash, items_head, items_seq, events, input, after_snapshot, after_snapshot_error';
const toRun = (r: Record<string, unknown>): RunRecord => ({runId: String(r.run_id), worldId: String(r.world_id), schemaVersion: String(r.schema_version), engineVersion: String(r.engine_version), harnessVersion: String(r.harness_version), catalogVersion: String(r.catalog_version), seed: String(r.seed), initialSnapshot: {hash: String(r.snapshot_hash), body: String(r.snapshot)}, startedAt: Number(r.started_at), origin: String(r.origin) as RunOrigin, prevRunId: r.prev_run_id == null ? null : String(r.prev_run_id), legacy: r.legacy == null ? null : JSON.parse(String(r.legacy))});
const toInput = (r: Record<string, unknown>): RunInput => ({seq: Number(r.seq), runId: String(r.run_id), at: Number(r.at), kind: String(r.kind) as InputKind, label: String(r.label), day: String(r.day), tick: Number(r.tick), versionBefore: Number(r.version_before), versionAfter: Number(r.version_after), beforeHash: String(r.before_hash), afterHash: String(r.after_hash), itemsHead: r.items_head == null ? null : String(r.items_head), itemsSeq: r.items_seq == null ? null : Number(r.items_seq), events: Number(r.events), input: r.input == null ? null : JSON.parse(String(r.input)), afterSnapshot: r.after_snapshot == null ? null : {hash: String(r.after_hash), body: String(r.after_snapshot)}, afterSnapshotError: (r.after_snapshot_error ?? null) as ReplaySnapshotError | null});

export type CommitRecord = {at: number; kind: InputKind; label: string; beforeRaw: string; before: WorldState; after: WorldState; afterRaw?: string; changed: boolean; events: WorldEvent[]; input?: Record<string, unknown> | null};
export type PreparedInput = {runId: string; seq: number; c: CommitRecord; beforeHash: string; afterHash: string; afterSnapshot: string | null; afterSnapshotError: ReplaySnapshotError | null};

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
    // Lossless v1 migration: nullable snapshots distinguish old rows from replayable v2 rows. No stored row is rewritten.
    for (const [col, type] of [['after_snapshot', 'TEXT'], ['after_snapshot_error', 'TEXT']]) {
      try { this.sql.exec(`SELECT ${col} FROM run_inputs LIMIT 0`).toArray(); } catch { this.sql.exec(`ALTER TABLE run_inputs ADD COLUMN ${col} ${type}`); }
    }
    this.sql.exec('CREATE INDEX IF NOT EXISTS run_inputs_run ON run_inputs (run_id, seq)');
    // Counter cache per run (inputs and stored events), kept in the commit transaction so reads need no COUNT(*).
    this.sql.exec('CREATE TABLE IF NOT EXISTS run_counts (run_id TEXT PRIMARY KEY, inputs INTEGER NOT NULL, events INTEGER NOT NULL)');
    try { this.sql.exec('SELECT replay_bytes FROM run_counts LIMIT 0').toArray(); } catch { this.sql.exec('ALTER TABLE run_counts ADD COLUMN replay_bytes INTEGER NOT NULL DEFAULT 0'); }
    // The events table belongs to world-runtime.ts; an older world gets the two columns (existing rows keep NULL).
    for (const [col, type] of [['run_id', 'TEXT'], ['input_seq', 'INTEGER']]) {
      try { this.sql.exec(`SELECT ${col} FROM events LIMIT 0`).toArray(); } catch { this.sql.exec(`ALTER TABLE events ADD COLUMN ${col} ${type}`); }
    }
    this.sql.exec('CREATE INDEX IF NOT EXISTS events_run_at ON events (run_id, at)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS events_run_seq ON events (run_id, seq)');
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
      if (sameVersions(prev, v)) { this.ensureCounts(prev); return (this.run = prev); }
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
    this.sql.exec('INSERT OR IGNORE INTO run_counts (run_id, inputs, events) VALUES (?, 0, ?)', runId, legacy?.events ?? 0);
    return {runId, worldId: this.worldId, ...v, seed: s.seed, initialSnapshot: {hash, body}, startedAt: now, origin, prevRunId, legacy};
  }
  /** A run stored without a counter row (opened by an earlier build): counted once. */
  private ensureCounts(r: RunRecord) {
    if (this.sql.exec('SELECT 1 FROM run_counts WHERE run_id = ?', r.runId).toArray().length) return;
    const inputs = Number(this.sql.exec('SELECT COUNT(*) AS n FROM run_inputs WHERE run_id = ?', r.runId).toArray()[0]?.n ?? 0);
    const events = Number(this.sql.exec(`SELECT COUNT(*) AS n FROM events WHERE run_id = ?${r.origin === 'pre-run-log' ? ' OR run_id IS NULL' : ''}`, r.runId).toArray()[0]?.n ?? 0);
    const replayBytes = Number(this.sql.exec('SELECT COALESCE(SUM(LENGTH(CAST(after_snapshot AS BLOB))), 0) AS n FROM run_inputs WHERE run_id = ?', r.runId).toArray()[0]?.n ?? 0);
    this.sql.exec('INSERT INTO run_counts (run_id, inputs, events, replay_bytes) VALUES (?, ?, ?, ?)', r.runId, inputs, events, replayBytes);
  }
  get current(): RunRecord {
    if (!this.run) throw new Error('run log not opened');
    return this.run;
  }

  /**
   * Prepares the record of one commit (inside the commit's transaction, before its events are inserted). Null for a
   * commit that changed nothing and logged nothing. The events are completed in place: `actorOrigin` is `system` for
   * the world's own processes when the maker set neither an origin nor an `actor` (C03 values only; an owner's act
   * keeps `data.actor` and no origin), and every ability_change event gets the before/after hash of the ability state
   * (inventory and expiry) of the Muses it is about. Call append() with the number of event rows really inserted.
   */
  prepare(c: CommitRecord): PreparedInput | null {
    if (!c.changed && !c.events.length) return null;
    const run = this.current;
    const beforeHash = this.cache?.raw === c.beforeRaw ? this.cache.hash : stateHash(c.before);
    const afterBody = snapshotBody(c.after), afterBytes = new TextEncoder().encode(afterBody).byteLength;
    const afterHash = c.changed ? bodyHash(afterBody) : beforeHash;
    this.cache = {raw: c.afterRaw ?? JSON.stringify(c.after), hash: afterHash};
    const seq = Number(this.sql.exec('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM run_inputs').toArray()[0].n);
    for (const e of c.events) {
      const data = (e.data ??= {});
      if (!ACTOR_ORIGINS.includes(data.actorOrigin as ActorOrigin)) { if (data.actor === undefined) data.actorOrigin = 'system'; else delete data.actorOrigin; }
      if (e.tags.includes('ability_change')) {
        const of = [e.muse, e.other].filter((x): x is string => !!x);
        data.abilityOf = of; data.beforeHash = abilityHash(c.before, of); data.afterHash = abilityHash(c.after, of);
      }
    }
    return {runId: run.runId, seq, c, beforeHash, afterHash, afterSnapshot: afterBytes <= MAX_REPLAY_SNAPSHOT_BYTES ? afterBody : null, afterSnapshotError: afterBytes <= MAX_REPLAY_SNAPSHOT_BYTES ? null : 'snapshot_too_large'};
  }
  /** Appends the prepared row with the number of event rows the commit really inserted (a repeated event id is not stored). */
  append(p: PreparedInput, inserted: number) {
    const {c} = p, chain = c.after.items?.chain;
    const used = Number(this.sql.exec('SELECT replay_bytes FROM run_counts WHERE run_id = ?', p.runId).toArray()[0]?.replay_bytes ?? 0);
    let body = p.afterSnapshot, error = p.afterSnapshotError, bytes = body === null ? 0 : new TextEncoder().encode(body).byteLength;
    if (used + bytes > MAX_RUN_REPLAY_BYTES) { body = null; bytes = 0; error = 'replay_storage_limit'; }
    this.sql.exec(`INSERT INTO run_inputs (${INPUT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, p.seq, p.runId, c.at, c.kind, c.label.slice(0, 160), c.after.day, c.after.tick, c.before.version, c.after.version, p.beforeHash, p.afterHash, chain?.head ?? null, chain?.seq ?? null, inserted, c.input ? JSON.stringify(c.input) : null, body, error);
    this.sql.exec('UPDATE run_counts SET inputs = inputs + 1, events = events + ?, replay_bytes = replay_bytes + ? WHERE run_id = ?', inserted, bytes, p.runId);
  }

  // ---------- reads ----------
  runs(): RunRecord[] { return this.sql.exec(`SELECT ${RUN_COLS} FROM runs ORDER BY n`).toArray().map(toRun); }
  runById(runId: string): RunRecord | null { const r = this.sql.exec(`SELECT ${RUN_COLS} FROM runs WHERE run_id = ?`, runId).toArray()[0]; return r ? toRun(r) : null; }
  inputs(runId: string, sinceSeq = 0, limit = 200): RunInput[] {
    return this.sql.exec(`SELECT ${INPUT_COLS} FROM run_inputs WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?`, runId, sinceSeq, Math.min(1000, Math.max(1, limit))).toArray().map(toInput);
  }
  /** A stable read boundary captured with the run header, so a growing live run loads a finite committed prefix. */
  boundary(runId: string): RunBoundary {
    const i = this.sql.exec('SELECT COALESCE(MAX(seq), 0) AS seq, COUNT(*) AS n FROM run_inputs WHERE run_id = ?', runId).toArray()[0];
    const e = this.sql.exec('SELECT COALESCE(MAX(seq), 0) AS seq, COUNT(*) AS n FROM events WHERE run_id = ?', runId).toArray()[0];
    return {inputSeq: Number(i.seq), eventSeq: Number(e.seq), inputs: Number(i.n), events: Number(e.n)};
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
    // Counters from run_counts and the newest input row (index on run_id, seq): no full-table count on a public read.
    const run = this.current, counts = this.sql.exec('SELECT inputs, events FROM run_counts WHERE run_id = ?', run.runId).toArray()[0];
    const last = this.sql.exec('SELECT seq, at FROM run_inputs WHERE run_id = ? ORDER BY seq DESC LIMIT 1', run.runId).toArray()[0];
    const events = Number(counts?.events ?? 0);
    const {initialSnapshot, ...rest} = run;
    return {
      ...rest, initialSnapshot: {hash: initialSnapshot.hash, bytes: initialSnapshot.body.length},
      versionsNow: currentVersions(),
      inputs: {count: Number(counts?.inputs ?? 0), lastSeq: Number(last?.seq ?? 0), lastAt: last?.at == null ? null : Number(last.at)},
      events, itemsAnchor: this.itemsAnchor(s), stateHash: stateHash(s),
      runs: this.runs().map(r => ({runId: r.runId, origin: r.origin, startedAt: r.startedAt, engineVersion: r.engineVersion, harnessVersion: r.harnessVersion, catalogVersion: r.catalogVersion, schemaVersion: r.schemaVersion, prevRunId: r.prevRunId})),
    };
  }
}
