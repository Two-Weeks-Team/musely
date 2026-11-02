// Set while the fixture replay is on screen (P-06): replay makes no requests. The polls wait on this flag, and because a request
// chain that started before the replay opened (a button that fetches status, then posts; a paged log read) would otherwise
// continue, same-origin /api and /.well-known requests are also refused at the fetch layer while the flag is set.
import {BLOCKED} from './resource-state';

export const isolation = {replay: false};

let enforced = false;
export function enforceIsolation() {
  if (enforced || typeof window === 'undefined') return;
  enforced = true;
  const real = window.fetch.bind(window);
  recordTransport = real;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (isolation.replay) {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin === location.origin && (url.pathname.startsWith('/api/') || url.pathname === '/mcp' || url.pathname.startsWith('/.well-known/'))) return Promise.reject(new Error(BLOCKED));
    }
    return real(input, init);
  };
}

// Explicit record preparation is the sole replay read path. Playback/evidence use only the cached record afterward.
// This cannot call a model, credential endpoint or command: fixed GET, same origin, three public log paths only.
let recordTransport: typeof fetch | null = null;
export function readRecordedApi(path: string, signal?: AbortSignal) {
  const url = new URL(path, location.href);
  const allowed = ['/api/world/run', '/api/world/run/inputs', '/api/world/events'];
  if (url.origin !== location.origin || !allowed.includes(url.pathname) || (url.pathname !== '/api/world/run' && !url.searchParams.get('runId'))) return Promise.reject(new Error('record_read_not_allowed'));
  return (recordTransport ?? window.fetch.bind(window))(url.href, {method: 'GET', cache: 'no-store', signal});
}
