// Request health for the live world surface (P-06, criterion A; contract C02). A request does not just "succeed or give
// null": HTTP errors, a broken body and a network failure are different, an empty list is a real answer, and a failure after
// an earlier success means the screen shows older data. Pure module: no DOM, so Node tests can drive it with a fake fetch.

export type Fetched<T> = {ok: true; data: T; at: number} | {ok: false; error: string; at: number};
export type Health = {lastOkAt: number | null; lastErrorAt: number | null; error: string | null};
/** loading: nothing answered yet · ready: the last request worked · stale: the last request failed but older data is on screen · error: it failed and there is nothing to show. */
export type ResState = 'loading' | 'ready' | 'stale' | 'error';

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<Fetched<T>> {
  let r: Response;
  try { r = await fetch(path, {cache: 'no-store', ...init}); } catch { return {ok: false, error: 'Network error', at: Date.now()}; }
  if (!r.ok) return {ok: false, error: `HTTP ${r.status}`, at: Date.now()};
  try { return {ok: true, data: (await r.json()) as T, at: Date.now()}; } catch { return {ok: false, error: 'Invalid response', at: Date.now()}; }
}

export function newHealth(): Health { return {lastOkAt: null, lastErrorAt: null, error: null}; }

/** Records one result. A success clears the error and keeps the time of the last good answer. */
export function track(h: Health, r: Fetched<unknown>): Health {
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
  const when = h?.lastOkAt ? ` · last good answer ${clock(h.lastOkAt)}` : '';
  if (s === 'loading') return 'Connecting to the shared world…';
  if (s === 'ready') return 'Connected · live data from the shared world';
  if (s === 'stale') return `Not responding (${h?.error}) · showing the last data we received${when}`;
  return `Unavailable (${h?.error}) · there is no live data to show yet`;
}
