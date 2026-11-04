import {JUDGE_MUSE} from '../../src/engine/judge-muse.ts';
// Owner sessions (contract C06): owner control is separate from the judge tier. A Worker secret per principal
// (OWNER_CONTROL_TOKEN for the real owner, DEMO_PEER_CONTROL_TOKEN for the team-controlled demo peer,
// REVIEWER_CONTROL_TOKEN for the connector directory reviewer's Muse) is
// exchanged at POST /api/owner/session for a 1-hour HttpOnly/Secure/SameSite=Strict cookie bound to that
// principal's owner id and Muses. The cookie is signed in its own HMAC domain, so a visitor or judge session
// can never be read as an owner session (and the other way round). It also carries a tag of the control token
// it was issued for: rotating the secret ends every session issued with the old one. Writes check Origin.
import {b64url, unb64url, hmac, timingSafeEqual} from './session.ts';

export const OWNER_COOKIE = 'musely_o';
export const OWNER_SESSION_TTL_MS = 3_600_000;

export type PrincipalId = 'owner' | 'demo-peer' | 'reviewer' | 'shared-judge';
export type Principal = {id: PrincipalId; ownerId: string; muses: string[]; label: string; demo: boolean; note: string};
/** The Muse kept for the connector directory review (G-08): a resident, not the owner's Muse or the demo peer's. */
export const REVIEWER_MUSE = '04-ember';
/** The principals of this deployment. Each owns its own Muse; none can act on another's. */
export const PRINCIPALS: Record<PrincipalId, Principal> = {
 'shared-judge':{id:'shared-judge',ownerId:'system:shared-judge',muses:[JUDGE_MUSE.id],label:JUDGE_MUSE.label,demo:true,note:'A shared judge account provided by the team; its Muse acts autonomously.'},
  owner: {id: 'owner', ownerId: 'owner:kim-sejun', muses: ['00-jolly'], label: "Kim Sejun · owner of Jolly", demo: false, note: 'The real owner of this deployment.'},
  'demo-peer': {id: 'demo-peer', ownerId: 'system:demo-peer', muses: ['09-copper'], label: 'Demo peer · system principal (team-controlled)', demo: true, note: 'A system principal the team controls for the two-owner checks. It is not a second real Meta account or person.'},
  reviewer: {id: 'reviewer', ownerId: 'system:reviewer', muses: [REVIEWER_MUSE], label: 'Directory reviewer · system principal (team-controlled)', demo: true, note: 'A system principal the team controls for the connector directory review. Its Muse is a resident the operators reset on request; it is not a real person\'s Muse.'},
};
const PRINCIPAL_IDS:readonly PrincipalId[] = ['owner','demo-peer','reviewer'];
export const ownsMuse = (s: OwnerSession, museId: string) => PRINCIPALS[s.principal].muses.includes(museId);

export type OwnerSession = {sid: string; principal: PrincipalId; ownerId: string; exp: number; tk: string};
/** `judge`: the judge link token, given only so a control token equal to it is refused. An unset `reviewer` only disables the reviewer. */
export type OwnerTokens = {owner?: string; peer?: string; reviewer?: string; judge?: string};
export const MIN_TOKEN_LENGTH = 32;

const tokenOf = (tokens: OwnerTokens, p: PrincipalId) => (p === 'owner' ? tokens.owner : p === 'demo-peer' ? tokens.peer : p==='reviewer'?tokens.reviewer:undefined) || '';
const tokenTag = async (secret: string, token: string) => b64url(await hmac(secret, 'owner-token:' + token)).slice(0, 22);
const sign = async (secret: string, body: string) => b64url(await hmac(secret, 'owner-session.' + body));

const usable = (x: string, judge?: string) => x.length >= MIN_TOKEN_LENGTH && !(judge && x === judge);
/** Owner and demo peer (the existing rule): at least one is set; each is at least 32 characters and not the judge link token; they differ. */
function coreConfigured(t: OwnerTokens) {
  const set = [t.owner, t.peer].filter((x): x is string => !!x);
  if (!set.length || set.some(x => !usable(x, t.judge))) return false;
  return !(t.owner && t.peer && t.owner === t.peer);
}
/** An owner or demo-peer token is set but breaks the rule: owner control as a whole is off (fail closed). */
const coreBroken = (t: OwnerTokens) => !!(t.owner || t.peer) && !coreConfigured(t);
/**
 * The reviewer is on only with its own valid token: at least 32 characters, not the judge link token, not equal to the
 * owner's or the demo peer's. A missing or invalid reviewer token turns off the reviewer alone; owner control goes on.
 */
export function reviewerConfigured(t: OwnerTokens) {
  const r = t.reviewer;
  return !!r && usable(r, t.judge) && r !== t.owner && r !== t.peer && !coreBroken(t);
}
/** The token that currently signs a principal in, or '' when that principal is off. */
const activeToken = (t: OwnerTokens, p: PrincipalId) => (p==='shared-judge'?'':p === 'reviewer' ? (reviewerConfigured(t) ? t.reviewer! : '') : coreConfigured(t) ? tokenOf(t, p) : '');

/**
 * A usable setup: the owner/demo-peer rule holds, or only a valid reviewer token is set. Otherwise no owner session is
 * issued or read (503 not_configured).
 */
export function tokensConfigured(t: OwnerTokens) {
  return coreConfigured(t) || reviewerConfigured(t);
}

/**
 * Ownership is stable even when its control token is missing or broken. An unavailable owner still has to approve:
 * configuration failure must never turn an owned Muse into a resident whose consent can be supplied by rule.
 */
export function ownerIdForMuse(_tokens: OwnerTokens, museId: string): string | null {
  const p = PRINCIPAL_IDS.find(id => PRINCIPALS[id].muses.includes(museId));
  return p ? PRINCIPALS[p].ownerId : null;
}

/** Which principal a presented control token belongs to (constant-time compare), or null. */
export function principalForToken(tokens: OwnerTokens, presented: unknown): PrincipalId | null {
  if (typeof presented !== 'string' || !presented || presented.length > 512 || !tokensConfigured(tokens)) return null;
  let found: PrincipalId | null = null;
  for (const p of PRINCIPAL_IDS) { const t = activeToken(tokens, p); if (t && timingSafeEqual(presented, t)) found = p; }
  return found;
}

export async function issueOwnerSession(secret: string, tokens: OwnerTokens, principal: PrincipalId, now = Date.now()): Promise<{token: string; session: OwnerSession}> {
  if(!PRINCIPAL_IDS.includes(principal))throw Error('owner_principal_required');
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
    const current = activeToken(tokens, s.principal);
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
