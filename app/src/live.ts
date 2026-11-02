// Client side of the Muse Spark proxy (direction v2, 15). The browser never holds a model key:
// it gets a 24-hour session from Turnstile (or a judge link) and calls /api/muse with structured input.
import {isolation} from './ui/isolation';
import {BLOCKED} from './ui/resource-state';

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

let turnstileScript: Promise<void> | null = null;
function loadTurnstile() {
  turnstileScript ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error('Turnstile unavailable'));
    document.head.append(s);
  });
  return turnstileScript;
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
    await loadTurnstile();
    const host = document.createElement('div');
    host.className = 'turnstile-host';
    document.body.append(host);
    const token = await new Promise<string>((resolve, reject) => {
      (window as any).turnstile.render(host, {sitekey: status.turnstile.sitekey, callback: resolve, 'error-callback': () => reject(new Error('Turnstile failed')), appearance: 'interaction-only'});
    }).finally(() => setTimeout(() => host.remove(), 500));
    body = {turnstile: token};
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
