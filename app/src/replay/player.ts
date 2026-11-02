// I-11: exact public checkpoint projection. There is no engine tick, command executor, model or transport here.
import {scheduleCues} from '../ui/live-scene-core.ts';
import {createPlayer, type Speed} from '../ui/replay-core.ts';
import type {AutoEvent} from '../ui/autonomy.ts';
import {sha256Hex} from '../engine/sha256.ts';
import {currentVersions, MAX_REPLAY_SNAPSHOT_BYTES, MAX_RUN_REPLAY_BYTES, type RunVersions} from './versions.ts';
import type {RunRecord, RunInput, RunBoundary} from '../../worker/core/run-log.ts';
export type RecordErrorCode = 'incompatible_record' | 'invalid_record' | 'incomplete_record' | 'record_too_large' | 'load_failed';
export class ReplayRecordError extends Error {
  code: RecordErrorCode;
  constructor(code: RecordErrorCode, detail: string) { super(`${code}: ${detail}`); this.name = 'ReplayRecordError'; this.code = code; }
}
export type RunEvent = AutoEvent & {seq: number; tick: number; runId: string; inputSeq: number; place?: string | null; line?: string | null};
export type LoadedRun = RunRecord & {readThrough: RunBoundary; inputs: RunInput[]; events: RunEvent[]};
export type RecordedEvidence = {runId: string; versions: RunVersions; input: Pick<RunInput, 'seq' | 'kind' | 'label' | 'beforeHash' | 'afterHash' | 'itemsHead'>};
export type RecordedEvent = RunEvent & {recorded: RecordedEvidence};
export type RecordedFrame = {replay: true; runId: string; worldId: string; recordedAt: number; snapshotAt: number; snapshotHash: string; publicState: Record<string, any>; events: RecordedEvent[]; inputs: Omit<RunInput, 'afterSnapshot'>[]; empty: boolean; playout: boolean; timeOrderAdjusted: boolean};
function bad(detail: string): never { throw new ReplayRecordError('invalid_record', detail); }
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
// Geographic distance yields fractional arrival milliseconds; preserve the recorded ETA without rounding.
const arrivalTime = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
export const recordedStateHash = (body: string) => sha256Hex('musely-run-state-v1\n' + body);
export function assertCompatible(r: unknown, expected: RunVersions = currentVersions()): asserts r is RunRecord {
  if (!obj(r)) bad('run header is not an object');
  for (const key of ['schemaVersion', 'engineVersion', 'harnessVersion', 'catalogVersion'] as const) {
    if (typeof r[key] !== 'string') bad(`missing ${key}`);
    if (r[key] !== expected[key]) throw new ReplayRecordError('incompatible_record', `${key} ${r[key]} (player ${expected[key]})`);
  }
}
function readSnapshot(s: unknown, worldId: string): Record<string, any> {
  if (!obj(s) || typeof s.body !== 'string' || typeof s.hash !== 'string') bad('snapshot body/hash missing');
  if (new TextEncoder().encode(s.body).byteLength > MAX_REPLAY_SNAPSHOT_BYTES) throw new ReplayRecordError('record_too_large', 'snapshot exceeds supported size');
  if (recordedStateHash(s.body) !== s.hash) bad('snapshot hash mismatch');
  let state: any; try { state = JSON.parse(s.body); } catch { bad('snapshot is not JSON'); }
  if (!obj(state) || state.worldId !== worldId || typeof state.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.day) || !integer(state.tick) || !integer(state.lastTickAt) || !Array.isArray(state.muses) || !integer(state.version)) bad('snapshot is not this world public state');
  const ids = state.muses.map((m: any) => obj(m) && typeof m.id === 'string' && typeof m.place === 'string' && Array.isArray(m.inventory) && m.inventory.every((i: unknown) => typeof i === 'string') ? m.id : bad('invalid Muse in snapshot'));
  if (new Set(ids).size !== ids.length) bad('duplicate Muse in snapshot');
  for (const m of state.muses) {
    if (m.travel !== null && m.travel !== undefined && (!obj(m.travel) || typeof m.travel.to !== 'string' || !integer(m.travel.departAt) || !arrivalTime(m.travel.arriveAt) || m.travel.arriveAt < m.travel.departAt || typeof m.travel.speed !== 'string')) bad('invalid travel in snapshot');
    if (m.beat !== null && m.beat !== undefined && (!obj(m.beat) || typeof m.beat.id !== 'string' || !integer(m.beat.startedAt) || !integer(m.beat.endsAt) || (m.beat.clip != null && typeof m.beat.clip !== 'string'))) bad('invalid beat in snapshot');
  }
  return state;
}
export function loadRun(raw: unknown, expected: RunVersions = currentVersions()) {
  assertCompatible(raw, expected);
  const value = raw as LoadedRun;
  if (typeof value.runId !== 'string' || !value.runId || typeof value.worldId !== 'string' || !integer(value.startedAt) || !Array.isArray(value.inputs) || !Array.isArray(value.events) || !obj(value.readThrough)) bad('run metadata or ordered rows missing');
  const boundary = value.readThrough;
  if (![boundary.inputSeq, boundary.eventSeq, boundary.inputs, boundary.events].every(integer)) bad('invalid read boundary');
  if (value.inputs.length > 4096 || value.events.length > 50000) throw new ReplayRecordError('record_too_large', 'run has too many rows');
  if (value.inputs.length !== boundary.inputs || value.events.length !== boundary.events) throw new ReplayRecordError('incomplete_record', 'the frozen input/event prefix is incomplete');
  const r: LoadedRun = structuredClone(value);
  const initial = readSnapshot(r.initialSnapshot, r.worldId);
  if (typeof r.seed !== 'string' || initial.seed !== r.seed) bad('initial seed does not match the run');
  const checkpoints: {time: number; at: number; hash: string; state: Record<string, any>; input: RunInput | null}[] = [{time: r.startedAt, at: r.startedAt, hash: r.initialSnapshot.hash, state: initial, input: null}];
  const bySeq = new Map<number, number>(); let seq = 0, priorHash = r.initialSnapshot.hash, priorVersion = initial.version, bytes = new TextEncoder().encode(r.initialSnapshot.body).length, adjusted = false;
  for (const i of r.inputs) {
    if (!obj(i) || !integer(i.seq) || i.seq <= seq || i.runId !== r.runId || !integer(i.at) || !integer(i.events) || i.versionBefore !== priorVersion || typeof i.afterHash !== 'string' || i.beforeHash !== priorHash) bad('input order, world version or hash chain mismatch');
    if (!i.afterSnapshot || i.afterSnapshotError) throw new ReplayRecordError('incomplete_record', `commit #${i.seq}: ${i.afterSnapshotError ?? 'missing_after_snapshot'}`);
    if (i.afterSnapshot.hash !== i.afterHash) bad('after-snapshot does not match commit hash');
    const state = readSnapshot(i.afterSnapshot, r.worldId);
    if (state.version !== i.versionAfter) bad('after-snapshot world version mismatch');
    bytes += new TextEncoder().encode(i.afterSnapshot.body).length;
    if (bytes > MAX_RUN_REPLAY_BYTES + MAX_REPLAY_SNAPSHOT_BYTES) throw new ReplayRecordError('record_too_large', 'run snapshot budget exceeded');
    const previous = checkpoints.at(-1)!.time;
    if (i.at < previous) adjusted = true;
    const time = Math.max(previous, i.at); // preserve commit order; the original source at is never changed
    bySeq.set(i.seq, checkpoints.length); checkpoints.push({time, at: i.at, hash: i.afterHash, state, input: i});
    seq = i.seq; priorHash = i.afterHash; priorVersion = i.versionAfter;
  }
  if (seq !== boundary.inputSeq) throw new ReplayRecordError('incomplete_record', 'input boundary not reached');
  const eventIds = new Set<string>(), eventCounts = new Map<number, number>(); seq = 0;
  for (const e of r.events) {
    if (!obj(e) || !integer(e.seq) || e.seq <= seq || e.runId !== r.runId || !bySeq.has(e.inputSeq) || typeof e.id !== 'string' || eventIds.has(e.id) || !integer(e.at) || !integer(e.tick) || typeof e.kind !== 'string' || (e.muse !== null && typeof e.muse !== 'string') || !Array.isArray(e.tags) || !e.tags.every((t: unknown) => typeof t === 'string') || !['live', 'rule', 'scripted', 'replay'].includes(e.source)) bad('event order, run, commit or identity mismatch');
    eventIds.add(e.id); eventCounts.set(e.inputSeq, (eventCounts.get(e.inputSeq) ?? 0) + 1); seq = e.seq;
  }
  if (seq !== boundary.eventSeq) throw new ReplayRecordError('incomplete_record', 'event boundary not reached');
  for (const i of r.inputs) if ((eventCounts.get(i.seq) ?? 0) !== i.events) throw new ReplayRecordError('incomplete_record', `events for commit #${i.seq} are incomplete`);
  const lastCommitAt = checkpoints.at(-1)!.time;
  // Public cues may begin after the final commit (the shared renderer delays their display for polling).
  // Hold the exact last checkpoint through that visual tail; never tick the world to fill it.
  const endAt = scheduleCues(r.events).reduce((end, cue) => Math.max(end, cue.end), lastCommitAt);
  const duration = (endAt - r.startedAt) / 1000, clock = createPlayer(duration);
  const versions = Object.fromEntries(['schemaVersion', 'engineVersion', 'harnessVersion', 'catalogVersion'].map(k => [k, r[k as keyof LoadedRun]])) as RunVersions;
  return {
    getState: clock.getState, play: clock.play, pause: clock.pause, seek: clock.seek, setSpeed: clock.setSpeed, restart: clock.restart, advance: clock.advance,
    getFrame(): RecordedFrame {
      const time = r.startedAt + clock.getState().cursor * 1000;
      let index = 0; for (let k = 1; k < checkpoints.length && checkpoints[k].time <= time; k++) index = k;
      const c = checkpoints[index], inputs = r.inputs.slice(0, index).map(({afterSnapshot, ...i}) => i);
      const events: RecordedEvent[] = r.events.filter(e => bySeq.get(e.inputSeq)! <= index).map(e => {
        const i = checkpoints[bySeq.get(e.inputSeq)!].input!;
        return {...e, recorded: {runId: r.runId, versions, input: {seq: i.seq, kind: i.kind, label: i.label, beforeHash: i.beforeHash, afterHash: i.afterHash, itemsHead: i.itemsHead}}};
      });
      return structuredClone({replay: true, runId: r.runId, worldId: r.worldId, recordedAt: time, snapshotAt: c.at, snapshotHash: c.hash, publicState: c.state, events, inputs, empty: !r.inputs.length && !r.events.length, playout: time > lastCommitAt, timeOrderAdjusted: adjusted});
    },
  };
}
export type RecordedPlayer = ReturnType<typeof loadRun>;
export type {Speed};
