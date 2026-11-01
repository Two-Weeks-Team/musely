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
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (isolation.replay) {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin === location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/'))) return Promise.reject(new Error(BLOCKED));
    }
    return real(input, init);
  };
}
