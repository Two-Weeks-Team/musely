// Loading is separate from the pure player. Only these three GET endpoints can be requested, up to a frozen prefix.
import {assertCompatible, ReplayRecordError, type LoadedRun} from './player.ts';
import {MAX_REPLAY_SNAPSHOT_BYTES, MAX_RUN_REPLAY_BYTES} from './versions.ts';
export type RunReader = (path: string, init: {method: 'GET'; cache: 'no-store'; signal?: AbortSignal}) => Promise<{ok: boolean; status: number; json(): Promise<unknown>}>;
// 4096 inputs / 16 rows needs 256 pages (~13 rate windows). The 64 MiB checkpoint budget keeps
// byte-bounded pages finite; allow transfer/backoff headroom, then fail explicitly rather than wait forever.
export const REPLAY_LOAD_DEADLINE_MS = 30 * 60 * 1000;
const RATE_WAIT_MS = 60_000;
const READ_TIMEOUT_MS = 20_000;
export type ReplayLoadProgress = {phase: 'header' | 'inputs' | 'events' | 'waiting'; loaded: number; total: number; waitMs?: number};
export type ReplayLoadOptions = {onProgress?(progress: ReplayLoadProgress): void};
function loadingScope(read: RunReader, parent: AbortSignal | undefined, options: ReplayLoadOptions) {
  const controller = new AbortController(), signal = controller.signal;
  const deadline = new ReplayRecordError('load_failed', 'record loading deadline exceeded');
  const timer = setTimeout(() => controller.abort(deadline), REPLAY_LOAD_DEADLINE_MS);
  const cancel = () => controller.abort(parent?.reason);
  if (parent?.aborted) cancel(); else parent?.addEventListener('abort', cancel, {once: true});
  let progress: ReplayLoadProgress = {phase: 'header', loaded: 0, total: 0};
  const report = (p: ReplayLoadProgress) => { progress = p; options.onProgress?.({...p}); };
  const reason = () => signal.reason instanceof Error ? signal.reason : new DOMException('Record loading cancelled', 'AbortError');
  const bounded = <T>(operation: () => Promise<T>, readTimeout = false): Promise<T> => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(reason()); return; }
    const timeout = readTimeout ? setTimeout(() => controller.abort(new ReplayRecordError('load_failed', 'record read timed out')), READ_TIMEOUT_MS) : undefined;
    const cleanup = () => { signal.removeEventListener('abort', abort); if (timeout !== undefined) clearTimeout(timeout); };
    const abort = () => { cleanup(); reject(reason()); };
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve().then(() => { if (signal.aborted) throw reason(); return operation(); }).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); });
  });
  const guarded: RunReader = async (path, init) => {
    for (;;) {
      const response = await bounded(() => read(path, {...init, signal}), true);
      if (response.status !== 429) return {ok: response.ok, status: response.status, json: () => bounded(() => response.json(), true)};
      report({...progress, phase: 'waiting', waitMs: RATE_WAIT_MS});
      let wait: ReturnType<typeof setTimeout> | undefined;
      try { await bounded(() => new Promise<void>(resolve => { wait = setTimeout(resolve, RATE_WAIT_MS); })); }
      finally { if (wait !== undefined) clearTimeout(wait); }
    }
  };
  return {read: guarded, signal, report, close() { clearTimeout(timer); parent?.removeEventListener('abort', cancel); }};
}
export async function readRunJson(read: RunReader, path: string, signal?: AbortSignal): Promise<any> {
  try {
    const r = await read(path, {method: 'GET', cache: 'no-store', signal});
    if (!r.ok) throw new ReplayRecordError('load_failed', `HTTP ${r.status}`);
    return await r.json();
  } catch (e) { if (e instanceof ReplayRecordError) throw e; throw new ReplayRecordError('load_failed', e instanceof Error ? e.message : 'record read failed'); }
}
export async function listRecordedRuns(read: RunReader, signal?: AbortSignal) {
  const s = await readRunJson(read, '/api/world/run', signal);
  if (!s || typeof s.runId !== 'string' || !Array.isArray(s.runs)) throw new ReplayRecordError('invalid_record', 'run list is malformed');
  return s as {runId: string; runs: {runId: string; startedAt: number; schemaVersion: string; engineVersion: string}[]};
}
export async function loadRecordedRun(read: RunReader, selected?: string, signal?: AbortSignal, options: ReplayLoadOptions = {}): Promise<LoadedRun> {
  const scope = loadingScope(read, signal, options);
  try {
    const id = selected || (await listRecordedRuns(scope.read, scope.signal)).runId;
    const header = await readRunJson(scope.read, `/api/world/run?runId=${encodeURIComponent(id)}&snapshot=1`, scope.signal);
    assertCompatible(header);
    const head = header as LoadedRun;
    if (head.runId !== id || !head.readThrough || !(['inputSeq', 'eventSeq', 'inputs', 'events'] as const).every(k => Number.isSafeInteger(head.readThrough[k]) && head.readThrough[k] >= 0)) throw new ReplayRecordError('invalid_record', 'run identity/read boundary missing');
    const snapshotBytes = (snapshot: unknown) => {
      const body = (snapshot as {body?: unknown} | null)?.body;
      if (typeof body !== 'string') throw new ReplayRecordError('invalid_record', 'snapshot body missing');
      if (body.length > MAX_REPLAY_SNAPSHOT_BYTES) throw new ReplayRecordError('record_too_large', 'snapshot exceeds supported size');
      const bytes = new TextEncoder().encode(body).byteLength;
      if (bytes > MAX_REPLAY_SNAPSHOT_BYTES) throw new ReplayRecordError('record_too_large', 'snapshot exceeds supported size');
      return bytes;
    };
    let bytes = snapshotBytes(head.initialSnapshot);
    const collect = async (path: string, through: number, expected: number, limit: number, max: number) => {
      if (expected > max) throw new ReplayRecordError('record_too_large', 'too many recorded rows');
      const out: any[] = []; let since = 0;
      const phase = path.endsWith('/inputs') ? 'inputs' : 'events';
      scope.report({phase, loaded: 0, total: expected});
      while (since < through) {
        const page = await readRunJson(scope.read, `${path}?runId=${encodeURIComponent(id)}&since=${since}&limit=${limit}`, scope.signal);
        if (!Array.isArray(page)) throw new ReplayRecordError('invalid_record', 'record page is not an array');
        if (!page.length) throw new ReplayRecordError('incomplete_record', 'a record page ended before its frozen boundary');
        for (const row of page) {
          if (!row || !Number.isSafeInteger(row.seq) || row.seq <= since || row.runId !== id) throw new ReplayRecordError('invalid_record', 'record page order/run mismatch');
          since = row.seq;
          if (row.seq <= through) {
            if (phase === 'inputs') {
              if (!row.afterSnapshot || row.afterSnapshotError) throw new ReplayRecordError('incomplete_record', `commit #${row.seq}: ${row.afterSnapshotError ?? 'missing_after_snapshot'}`);
              bytes += snapshotBytes(row.afterSnapshot);
              if (bytes > MAX_RUN_REPLAY_BYTES + MAX_REPLAY_SNAPSHOT_BYTES) throw new ReplayRecordError('record_too_large', 'run snapshot budget exceeded');
            }
            out.push(row);
          }
          if (out.length > max) throw new ReplayRecordError('record_too_large', 'too many recorded rows');
          if (since >= through) break;
        }
        scope.report({phase, loaded: out.length, total: expected});
      }
      if (out.length !== expected) throw new ReplayRecordError('incomplete_record', 'frozen record count differs');
      return out;
    };
    const inputs = await collect('/api/world/run/inputs', head.readThrough.inputSeq, head.readThrough.inputs, 25, 4096);
    const events = await collect('/api/world/events', head.readThrough.eventSeq, head.readThrough.events, 500, 50000);
    return {...head, inputs, events};
  } finally { scope.close(); }
}
