import {uiText} from './i18n.ts';
// Request health for the live world surface (P-06, criterion A; contract C02). A request does not just "succeed or give
// null": HTTP errors, a broken body and a network failure are different, an empty list is a real answer, and a failure after
// an earlier success means the screen shows older data. Pure module: no DOM, so Node tests can drive it with a fake fetch.

/** Message of a request the fixture replay refused: the replay makes none. It is not a failure of the world and is never tracked as one. */
export const BLOCKED = 'Paused while the replay is open';

export type Fetched<T> = {ok: true; data: T; at: number} | {ok: false; error: string; at: number};
export type Health = {lastOkAt: number | null; lastErrorAt: number | null; error: string | null};
/** loading: nothing answered yet · ready: the last request worked · stale: the last request failed but older data is on screen · error: it failed and there is nothing to show. */
export type ResState = 'loading' | 'ready' | 'stale' | 'error';

export async function fetchJson<T>(path: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<Fetched<T>> {
  let r: Response;
  try { r = await fetcher(path, {cache: 'no-store', ...init}); } catch (e) { return {ok: false, error: (e as Error)?.message === BLOCKED ? BLOCKED : uiText('Network error'), at: Date.now()}; }
  if (!r.ok) return {ok: false, error: uiText`HTTP ${r.status}`, at: Date.now()};
  try { return {ok: true, data: (await r.json()) as T, at: Date.now()}; } catch { return {ok: false, error: uiText('Invalid response'), at: Date.now()}; }
}

export function newHealth(): Health { return {lastOkAt: null, lastErrorAt: null, error: null}; }

/** Records one result. A success clears the error and keeps the time of the last good answer. */
export function track(h: Health, r: Fetched<unknown>): Health {
  if (!r.ok && r.error === BLOCKED) return h;
  if (r.ok) { h.lastOkAt = r.at; h.error = null; } else { h.lastErrorAt = r.at; h.error = r.error; }
  return h;
}

export function resState(h: Health | undefined, hasData: boolean): ResState {
  if (!h || (h.lastOkAt === null && h.lastErrorAt === null)) return 'loading';
  if (!h.error) return 'ready';
  return hasData ? 'stale' : 'error';
}

/** One plain sentence per state. `clock` formats a time the way the panel shows times. */
export function stateText(s: ResState, h: Health | undefined, clock: (ms: number) => string): string {
  const when = h?.lastOkAt ? uiText` · last good answer ${clock(h.lastOkAt)}` : '';
  if (s === 'loading') return uiText('Connecting to the shared world…');
  if (s === 'ready') return uiText('Connected · live data from the shared world');
  if (s === 'stale') return uiText`Not responding (${h?.error}) · showing the last data we received${when}`;
  return uiText`Unavailable (${h?.error}) · there is no live data to show yet`;
}

export type LogLoad<T> = {rows: T[]; error: string | null; capped: boolean};
/** Pages through an append-only log (`pageSize` rows per call, at most `maxPages` calls). A failed page ends the load and keeps the
 *  rows read so far; reaching the page limit with a full last page is reported as `capped`, never as a complete log. */
export async function loadLog<T extends {seq: number}>(page: (since: number) => Promise<Fetched<T[]>>, pageSize = 2000, maxPages = 40): Promise<LogLoad<T>> {
  const rows: T[] = []; let since = 0;
  for (let i = 0; i < maxPages; i++) {
    const r = await page(since);
    if (!r.ok) return {rows, error: r.error, capped: false};
    if (!r.data.length) return {rows, error: null, capped: false};
    rows.push(...r.data); since = r.data[r.data.length - 1].seq;
    if (r.data.length < pageSize) return {rows, error: null, capped: false};
  }
  return {rows, error: null, capped: true};
}
