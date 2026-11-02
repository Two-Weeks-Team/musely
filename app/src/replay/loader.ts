// Loading is separate from the pure player. Only these three GET endpoints can be requested, up to a frozen prefix.
import {assertCompatible, ReplayRecordError, type LoadedRun} from './player.ts';
export type RunReader = (path: string, init: {method: 'GET'; cache: 'no-store'; signal?: AbortSignal}) => Promise<{ok: boolean; status: number; json(): Promise<unknown>}>;
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
export async function loadRecordedRun(read: RunReader, selected?: string, signal?: AbortSignal): Promise<LoadedRun> {
  const id = selected || (await listRecordedRuns(read, signal)).runId;
  const header = await readRunJson(read, `/api/world/run?runId=${encodeURIComponent(id)}&snapshot=1`, signal);
  assertCompatible(header);
  const head = header as LoadedRun;
  if (head.runId !== id || !head.readThrough || !(['inputSeq', 'eventSeq', 'inputs', 'events'] as const).every(k => Number.isSafeInteger(head.readThrough[k]) && head.readThrough[k] >= 0)) throw new ReplayRecordError('invalid_record', 'run identity/read boundary missing');
  const collect = async (path: string, through: number, expected: number, limit: number, max: number) => {
    if (expected > max) throw new ReplayRecordError('record_too_large', 'too many recorded rows');
    const out: any[] = []; let since = 0;
    while (since < through) {
      const page = await readRunJson(read, `${path}?runId=${encodeURIComponent(id)}&since=${since}&limit=${limit}`, signal);
      if (!Array.isArray(page)) throw new ReplayRecordError('invalid_record', 'record page is not an array');
      if (!page.length) throw new ReplayRecordError('incomplete_record', 'a record page ended before its frozen boundary');
      for (const row of page) {
        if (!row || !Number.isSafeInteger(row.seq) || row.seq <= since || row.runId !== id) throw new ReplayRecordError('invalid_record', 'record page order/run mismatch');
        since = row.seq;
        if (row.seq <= through) out.push(row);
        if (out.length > max) throw new ReplayRecordError('record_too_large', 'too many recorded rows');
        if (since >= through) break;
      }
    }
    if (out.length !== expected) throw new ReplayRecordError('incomplete_record', 'frozen record count differs');
    return out;
  };
  const inputs = await collect('/api/world/run/inputs', head.readThrough.inputSeq, head.readThrough.inputs, 25, 4096);
  const events = await collect('/api/world/events', head.readThrough.eventSeq, head.readThrough.events, 500, 50000);
  return {...head, inputs, events};
}
