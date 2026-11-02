// Owner sessions (contract C06): owner control is separate from the judge tier. A Worker secret per principal
// (OWNER_CONTROL_TOKEN for the real owner, DEMO_PEER_CONTROL_TOKEN for the team-controlled demo peer) is
// exchanged at POST /api/owner/session for a 1-hour HttpOnly/Secure/SameSite=Strict cookie bound to that
// principal's owner id and Muses. The cookie is signed in its own HMAC domain, so a visitor or judge session
// can never be read as an owner session (and the other way round). It also carries a tag of the control token
// it was issued for: rotating the secret ends every session issued with the old one. Writes check Origin.
import {b64url, unb64url, hmac, timingSafeEqual} from './session.ts';

export const OWNER_COOKIE = 'musely_o';
export const OWNER_SESSION_TTL_MS = 3_600_000;

export type PrincipalId = 'owner' | 'demo-peer';
export type Principal = {id: PrincipalId; ownerId: string; muses: string[]; label: string; demo: boolean; note: string};
/** The two principals of this deployment. Each owns its own Muse; neither can act on the other's. */
export const PRINCIPALS: Record<PrincipalId, Principal> = {
  owner: {id: 'owner', ownerId: 'owner:kim-sejun', muses: ['00-jolly'], label: "Kim Sejun · owner of Jolly", demo: false, note: 'The real owner of this deployment.'},
  'demo-peer': {id: 'demo-peer', ownerId: 'system:demo-peer', muses: ['09-copper'], label: 'Demo peer · system principal (team-controlled)', demo: true, note: 'A system principal the team controls for the two-owner checks. It is not a second real Meta account or person.'},
};
export const ownsMuse = (s: OwnerSession, museId: string) => PRINCIPALS[s.principal].muses.includes(museId);

export type OwnerSession = {sid: string; principal: PrincipalId; ownerId: string; exp: number; tk: string};
/** `judge`: the judge link token, given only so a control token equal to it is refused. */
export type OwnerTokens = {owner?: string; peer?: string; judge?: string};
export const MIN_TOKEN_LENGTH = 32;

const tokenOf = (tokens: OwnerTokens, p: PrincipalId) => (p === 'owner' ? tokens.owner : tokens.peer) || '';
const tokenTag = async (secret: string, token: string) => b64url(await hmac(secret, 'owner-token:' + token)).slice(0, 22);
const sign = async (secret: string, body: string) => b64url(await hmac(secret, 'owner-session.' + body));

/**
 * A usable setup: at least one control token; every configured one is at least 32 characters and is not the judge link
 * token; the two differ. Anything else is misconfigured and no owner session is issued or read (503 not_configured).
 */
export function tokensConfigured(t: OwnerTokens) {
  const set = [t.owner, t.peer].filter((x): x is string => !!x);
  if (!set.length || set.some(x => x.length < MIN_TOKEN_LENGTH || (!!t.judge && x === t.judge))) return false;
  return !(t.owner && t.peer && t.owner === t.peer);
}

/** Which principal a presented control token belongs to (constant-time compare), or null. */
export function principalForToken(tokens: OwnerTokens, presented: unknown): PrincipalId | null {
  if (typeof presented !== 'string' || !presented || presented.length > 512 || !tokensConfigured(tokens)) return null;
  let found: PrincipalId | null = null;
  for (const p of ['owner', 'demo-peer'] as const) { const t = tokenOf(tokens, p); if (t && timingSafeEqual(presented, t)) found = p; }
  return found;
}

export async function issueOwnerSession(secret: string, tokens: OwnerTokens, principal: PrincipalId, now = Date.now()): Promise<{token: string; session: OwnerSession}> {
  const session: OwnerSession = {sid: b64url(crypto.getRandomValues(new Uint8Array(16))), principal, ownerId: PRINCIPALS[principal].ownerId, exp: now + OWNER_SESSION_TTL_MS, tk: await tokenTag(secret, tokenOf(tokens, principal))};
  const body = b64url(new TextEncoder().encode(JSON.stringify(session)));
  return {token: body + '.' + (await sign(secret, body)), session};
}

/** Server-side check of an owner cookie: signature, principal, owner id, expiry (at most 1 h) and the current control token. */
export async function readOwnerSession(secret: string, token: string | null | undefined, tokens: OwnerTokens, now = Date.now()): Promise<OwnerSession | null> {
  if (!token || !secret || token.length > 1024 || !tokensConfigured(tokens)) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  if (!timingSafeEqual(sig, await sign(secret, body))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(unb64url(body))) as OwnerSession;
    const p = PRINCIPALS[s.principal as PrincipalId];
    if (!p || s.ownerId !== p.ownerId || typeof s.sid !== 'string' || typeof s.exp !== 'number' || s.exp <= now || s.exp - now > OWNER_SESSION_TTL_MS + 60_000) return null;
    const current = tokenOf(tokens, s.principal);
    if (!current || typeof s.tk !== 'string' || !timingSafeEqual(s.tk, await tokenTag(secret, current))) return null;
    return s;
  } catch {
    return null;
  }
}

export const ownerCookie = (token: string) => `${OWNER_COOKIE}=${token}; Path=/api; Max-Age=${OWNER_SESSION_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Strict`;
export const clearOwnerCookie = `${OWNER_COOKIE}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

/** Origins a browser may send owner writes from: the canonical origin and every allowed host over https. */
export const ownerOrigins = (publicOrigin: string, allowedHosts: string) => [...new Set([new URL(publicOrigin).origin, ...allowedHosts.split(',').map(h => h.trim()).filter(Boolean).map(h => 'https://' + h)])];

/** CSRF check for owner writes: the Origin header must be present and one of ours; a cross-site fetch is refused. */
export function originAllowed(request: Request, origins: string[]) {
  const origin = request.headers.get('origin');
  if (!origin || !origins.includes(origin)) return false;
  const site = request.headers.get('sec-fetch-site');
  return !site || site === 'same-origin';
}

/** Public description of a session for the owner's own screen. */
export const ownerSessionView = (s: OwnerSession) => {
  const p = PRINCIPALS[s.principal];
  return {principal: p.id, ownerId: p.ownerId, label: p.label, demo: p.demo, note: p.note, muses: p.muses, expiresAt: s.exp};
};
