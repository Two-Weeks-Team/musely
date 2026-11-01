// Visitor sessions (direction v2, 15): a Turnstile token (single use, 5 minutes) is verified on the
// server, then a self-issued 24-hour session is signed with HMAC-SHA256. A judge link token gives the
// judge tier instead. Session ids are random; IPs are only kept as salted hashes for quota counting.
import type {Tier} from './ledger.ts';

export const SESSION_COOKIE = 'musely_s';
export const SESSION_TTL_MS = 24 * 3_600_000;
export type Session = {sid: string; tier: Exclude<Tier, 'world'>; exp: number};

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), c => c.charCodeAt(0));

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export function timingSafeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function issueSession(secret: string, tier: Session['tier'], now = Date.now()): Promise<{token: string; session: Session}> {
  const session: Session = {sid: b64url(crypto.getRandomValues(new Uint8Array(16))), tier, exp: now + SESSION_TTL_MS};
  const body = b64url(enc.encode(JSON.stringify(session)));
  return {token: body + '.' + b64url(await hmac(secret, body)), session};
}

export async function readSession(secret: string, token: string | null | undefined, now = Date.now()): Promise<Session | null> {
  if (!token || !secret) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  if (!timingSafeEqual(sig, b64url(await hmac(secret, body)))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(unb64url(body))) as Session;
    if (typeof s.sid !== 'string' || (s.tier !== 'visitor' && s.tier !== 'judge') || typeof s.exp !== 'number' || s.exp <= now) return null;
    return s;
  } catch {
    return null;
  }
}

export const cookieValue = (header: string | null, name = SESSION_COOKIE) =>
  header?.split(/;\s*/).find(p => p.startsWith(name + '='))?.slice(name.length + 1) ?? null;

export const sessionCookie = (token: string) =>
  `${SESSION_COOKIE}=${token}; Path=/api; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Strict`;

export async function hashIp(secret: string, ip: string) {
  return b64url(await hmac(secret, 'ip:' + ip)).slice(0, 22);
}

export type TurnstileResult = {ok: boolean; codes: string[]; hostname?: string};
export async function verifyTurnstile(secret: string, token: string, ip: string, allowedHosts: string[], fetcher: typeof fetch = fetch): Promise<TurnstileResult> {
  if (!secret || !token || token.length > 2048) return {ok: false, codes: ['missing-input']};
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {method: 'POST', body: form});
  const data = (await res.json().catch(() => ({}))) as {success?: boolean; hostname?: string; 'error-codes'?: string[]};
  const hostOk = !!data.hostname && allowedHosts.includes(data.hostname);
  return {ok: !!data.success && hostOk, codes: data['error-codes'] ?? (hostOk ? [] : ['hostname-mismatch']), hostname: data.hostname};
}
