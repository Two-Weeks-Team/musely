// Client side of the Muse Spark proxy (direction v2, 15). The browser never holds a model key:
// it gets a 24-hour session from Turnstile (or a judge link) and calls /api/muse with structured input.
import {isolation} from './ui/isolation';
import {BLOCKED} from './ui/resource-state';
import {verifyVisitor} from './ui/session-verification';

export type SparkStatus = {
  model: {id: string; connected: boolean; live: boolean};
  budget: {day: string; capUsd: number; spentUsd: number; reservedUsd: number; liveCalls: number; remainingUsd: number};
  turnstile: {sitekey: string; configured: boolean};
  session: {tier: 'visitor' | 'judge'; expiresAt: number; quota: {perHour: number; usedThisHour: number}} | null;
  aiGateway: boolean;
};
export type MuseAction = 'spotlight' | 'encounter' | 'trade' | 'negotiate' | 'challenge';
export type MuseResult = {source: 'live' | 'replay' | 'scripted'; action: MuseAction; output: any; reason?: string; evidence?: {model: string; responseId: string | null; requestId: string | null; latencyMs: number; costUsd: number}; recorded?: {recordedAt: string; requestId: string | null} | null};

export async function sparkStatus(): Promise<SparkStatus | null> {
  try {
    const res = await fetch('/api/status', {cache: 'no-store'});
    return res.ok ? await res.json() : null;
  } catch {
    return null; // static preview without the Worker (local dist server)
  }
}

type TurnstileLoad = {promise: Promise<void>; script: HTMLScriptElement; pending: boolean; users: number; abandon: () => void};
let turnstileScript: TurnstileLoad | null = null;
function loadTurnstile(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Verification cancelled'));
  if (!turnstileScript) {
    const script = document.createElement('script');
    let accept!: () => void, refuse!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => { accept = resolve; refuse = reject; });
    const entry: TurnstileLoad = {promise, script, pending: true, users: 0, abandon: () => complete(new Error('Verification cancelled'))};
    function complete(error?: Error) {
      if (!entry.pending) return;
      entry.pending = false;
      script.onload = null; script.onerror = null;
      if (error) {
        // A late callback for this generation cannot clear a newer load.
        if (turnstileScript === entry) turnstileScript = null;
        script.remove(); refuse(error);
      } else accept();
    }
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => complete();
    script.onerror = () => complete(new Error('Turnstile unavailable'));
    turnstileScript = entry;
    document.head.append(script);
  }
  const entry = turnstileScript;
  entry.users++;
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true; signal.removeEventListener('abort', aborted); entry.users--;
      if (error) reject(error); else resolve();
      // Only the last pending consumer owns removal. Loaded SDK stays cached.
      if (entry.pending && entry.users === 0) entry.abandon();
    };
    const aborted = () => finish(new Error('Verification cancelled'));
    signal.addEventListener('abort', aborted, {once: true});
    entry.promise.then(() => signal.aborted ? aborted() : finish(), () => finish(new Error('Turnstile unavailable')));
    if (signal.aborted) aborted();
  });
}

/** Opens a session: judge link token if present in the URL (then removed from the address bar), else Turnstile. */
export async function ensureSession(status: SparkStatus): Promise<SparkStatus['session']> {
  // The fixture replay makes no requests. Refuse before the judge token is taken out of the address bar, so a refused call never uses it up.
  if (isolation.replay) throw new Error(BLOCKED);
  if (status.session) return status.session;
  const params = new URLSearchParams(location.search), judge = params.get('judge');
  let body: Record<string, string>;
  if (judge) {
    params.delete('judge');
    history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '') + location.hash);
    body = {judge};
  } else {
    return verifyVisitor(status.turnstile.sitekey, loadTurnstile, async (token, signal) => {
      const res = await fetch('/api/session', {method: 'POST', signal, headers: {'content-type': 'application/json'}, body: JSON.stringify({turnstile: token})});
      if (!res.ok) throw new Error('Session refused');
      const s = await res.json();
      return {tier: s.tier, expiresAt: s.expiresAt, quota: s.quota};
    });
  }
  const res = await fetch('/api/session', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  if (!res.ok) throw new Error('Session refused: ' + res.status);
  const s = await res.json();
  return {tier: s.tier, expiresAt: s.expiresAt, quota: s.quota};
}

export async function callMuse(action: MuseAction, input: unknown): Promise<MuseResult> {
  const res = await fetch('/api/muse', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action, input})});
  if (!res.ok) throw new Error('Muse call refused: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

/** Short honest label for the header: connection state only; the world itself stays scripted until it runs live. */
export function statusLabel(s: SparkStatus | null): {text: string; title: string; state: 'live' | 'replay' | 'offline'} {
  if (!s) return {text: 'Muse Spark · not connected', title: 'The Worker status could not be read just now (no Worker proxy in this copy, or it did not answer). Shared world state is separate from model availability. Story mode remains a labelled local script.', state: 'offline'};
  if (!s.model.connected) return {text: 'Muse Spark · not connected', title: 'The model key is not configured. Live calls fall back to recorded replays.', state: 'offline'};
  if (!s.model.live) return {text: 'Muse Spark · replay', title: `Today's budget ($${s.budget.capUsd}) is used up. Live calls fall back to recorded replays.`, state: 'replay'};
  return {text: 'Muse Spark · connected', title: `Server proxy ready (${s.model.id}). ${s.budget.liveCalls} live calls today. The model key never reaches this page.`, state: 'live'};
}
