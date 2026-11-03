// Personal authentication only. No actor, world entry, agent key or legacy owner authority is created here.
import {b64url, unb64url, hmac, timingSafeEqual} from './session.ts';
import {PersonalOwners, type PersonalStorage} from './personal-owners.ts';

export const PERSONAL_COOKIE = 'musely_p';
export const PERSONAL_FLOW_COOKIE = 'musely_pf';
export const PERSONAL_SESSION_TTL_MS = 3_600_000;
export const PERSONAL_FLOW_TTL_MS = 600_000;
// Reuse the already-registered product callback; prefix is routing only, never authentication.
export const PERSONAL_CALLBACK = '/api/threads/callback';
export const PERSONAL_STATE_PREFIX = 'personal-v1.';
const enc = new TextEncoder();
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export const personalNonce = random;
const digestPattern = /^[a-f0-9]{64}$/;
const noncePattern = /^[A-Za-z0-9_-]{43}$/;
const principalPattern = /^pp_[a-f0-9-]{36}$/;
const appPattern = /^[0-9]{1,32}$/;
const time = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const personalDigest = async (kind: 'state' | 'browser' | 'sid', value: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('musely-personal-' + kind + ':' + value)))].map(x => x.toString(16).padStart(2, '0')).join('');
export type PersonalFlow = {stateDigest: string; browserDigest: string; appId: string; redirectUri: string; createdAt: number; expiresAt: number};
export type PersonalProof = {v: 1; sid: string; principalId: string; authVersion: number; issuedAt: number; expiresAt: number};
export type PersonalSessionRow = Omit<PersonalProof, 'v' | 'sid'>;
const sign = (secret: string, body: string) => hmac(secret, 'personal-session-v1.' + body).then(b64url);
function proofValid(p: PersonalProof, now: number) {
  return p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).sort().join(',') === 'authVersion,expiresAt,issuedAt,principalId,sid,v'
    && p.v === 1 && noncePattern.test(p.sid) && principalPattern.test(p.principalId)
    && Number.isSafeInteger(p.authVersion) && p.authVersion >= 1 && time(now) && time(p.issuedAt) && time(p.expiresAt)
    && p.issuedAt <= now && p.expiresAt > now && p.expiresAt - p.issuedAt === PERSONAL_SESSION_TTL_MS;
}
export async function signPersonalSession(secret: string, proof: PersonalProof, now = Date.now()): Promise<string> {
  if (!secret || !proofValid(proof, now)) throw new Error('personal_session_invalid');
  const body = b64url(enc.encode(JSON.stringify(proof)));
  return body + '.' + await sign(secret, body);
}
/** Signature/schema only; callers must ALSO read the active sid and current registry authVersion from SQL. */
export async function readPersonalProof(secret: string, token: string | null, now = Date.now()): Promise<PersonalProof | null> {
  if (!secret || !token || token.length > 1024) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(body) || !noncePattern.test(signature)) return null;
  if (!timingSafeEqual(signature, await sign(secret, body))) return null;
  try {
    const proof = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(unb64url(body))) as PersonalProof;
    return proofValid(proof, now) ? proof : null;
  } catch { return null; }
}
/** Duplicate cookies are ambiguous; do not silently authenticate with the first value. */
export function personalCookieValue(request: Request, name: string): string | null {
  const values = (request.headers.get('cookie') ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}
export const personalCookie = (token: string) => `${PERSONAL_COOKIE}=${token}; Path=/api/personal; Max-Age=3600; HttpOnly; Secure; SameSite=Strict`;
export const clearPersonalCookie = `${PERSONAL_COOKIE}=; Path=/api/personal; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
export const flowCookie = (verifier: string) => `${PERSONAL_FLOW_COOKIE}=${verifier}; Path=/api/threads; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
export const clearFlowCookie = `${PERSONAL_FLOW_COOKIE}=; Path=/api/threads; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** Private additive SQL store; synchronous transactions are the consume/issue/revoke linearization points. */
export class PersonalAuthStore {
  readonly owners: PersonalOwners;
  private storage: PersonalStorage;
  constructor(storage: PersonalStorage) { this.storage = storage; this.owners = new PersonalOwners(storage); }
  init() {
    this.owners.init();
    this.storage.transactionSync(() => {
      this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_auth_flows (state_digest TEXT PRIMARY KEY, browser_digest TEXT NOT NULL, app_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, purpose TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, completed_at INTEGER)');
      this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_auth_sessions (sid_digest TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES personal_principals(id), app_id TEXT NOT NULL, auth_version INTEGER NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER)');
    });
  }
  begin(flow: PersonalFlow): boolean {
    if (!flow || !digestPattern.test(flow.stateDigest) || !digestPattern.test(flow.browserDigest) || !appPattern.test(flow.appId) || !time(flow.createdAt) || flow.expiresAt !== flow.createdAt + PERSONAL_FLOW_TTL_MS || !this.redirectValid(flow.redirectUri)) return false;
    return this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM personal_auth_flows WHERE expires_at <= ?', flow.createdAt);
      this.storage.sql.exec('DELETE FROM personal_auth_sessions WHERE expires_at <= ?', flow.createdAt);
      if (Number(this.storage.sql.exec('SELECT count(*) n FROM personal_auth_flows').toArray()[0].n) >= 256) return false;
      if (this.storage.sql.exec('SELECT state_digest FROM personal_auth_flows WHERE state_digest = ?', flow.stateDigest).toArray().length) return false;
      this.storage.sql.exec('INSERT INTO personal_auth_flows (state_digest,browser_digest,app_id,redirect_uri,purpose,created_at,expires_at) VALUES (?,?,?,?,?,?,?)', flow.stateDigest, flow.browserDigest, flow.appId, flow.redirectUri, 'login', flow.createdAt, flow.expiresAt);
      return true;
    });
  }
  private redirectValid(value: unknown) {
    try { const u = new URL(String(value)); return u.protocol === 'https:' && !u.username && !u.password && u.pathname === PERSONAL_CALLBACK && !u.search && !u.hash; } catch { return false; }
  }
  /** A correct browser/TTL/purpose/app/redirect consumes once, before any provider await. */
  consume(binding: Pick<PersonalFlow, 'stateDigest' | 'browserDigest' | 'appId' | 'redirectUri'>, now = Date.now()): boolean {
    if (!binding || !time(now) || !digestPattern.test(binding.stateDigest) || !digestPattern.test(binding.browserDigest)) return false;
    return this.storage.transactionSync(() => {
      const r = this.storage.sql.exec('SELECT * FROM personal_auth_flows WHERE state_digest = ?', binding.stateDigest).toArray()[0];
      if (!r || r.browser_digest !== binding.browserDigest || r.app_id !== binding.appId || r.redirect_uri !== binding.redirectUri || r.purpose !== 'login' || r.consumed_at !== null || Number(r.created_at) > now || Number(r.expires_at) <= now) return false;
      this.storage.sql.exec('UPDATE personal_auth_flows SET consumed_at = ? WHERE state_digest = ? AND consumed_at IS NULL', now, binding.stateDigest);
      return true;
    });
  }
  /** Only the trusted Worker provider adapter calls this, with verified me.id, never a browser-supplied subject. */
  complete(stateDigest: string, appId: string, subject: string, sidDigest: string, now = Date.now()): PersonalSessionRow | null {
    if (!digestPattern.test(stateDigest) || !appPattern.test(appId) || typeof subject !== 'string' || !/^[0-9]{1,128}$/.test(subject) || !digestPattern.test(sidDigest) || !time(now)) return null;
    return this.storage.transactionSync(() => {
      const f = this.storage.sql.exec('SELECT * FROM personal_auth_flows WHERE state_digest = ?', stateDigest).toArray()[0];
      if (!f || f.app_id !== appId || f.purpose !== 'login' || f.consumed_at === null || f.completed_at !== null || Number(f.consumed_at) > now || Number(f.expires_at) <= now) return null;
      const p = this.owners.ensurePrincipal({provider: 'threads', subject: appId + ':' + subject}, now);
      this.storage.sql.exec('INSERT INTO personal_auth_sessions (sid_digest,principal_id,app_id,auth_version,issued_at,expires_at) VALUES (?,?,?,?,?,?)', sidDigest, p.id, appId, p.authVersion, now, now + PERSONAL_SESSION_TTL_MS);
      this.storage.sql.exec('UPDATE personal_auth_flows SET completed_at = ? WHERE state_digest = ?', now, stateDigest);
      return {principalId: p.id, authVersion: p.authVersion, issuedAt: now, expiresAt: now + PERSONAL_SESSION_TTL_MS};
    });
  }
  /** Pure read: no pruning, provider fetch, claim recheck, or world/presence mutation. */
  active(sidDigest: string, proof: PersonalSessionRow, appId: string, now = Date.now()): boolean {
    if (!digestPattern.test(sidDigest) || !proof || !time(now)) return false;
    const r = this.storage.sql.exec('SELECT * FROM personal_auth_sessions WHERE sid_digest = ?', sidDigest).toArray()[0];
    if (!r || r.app_id !== appId || r.revoked_at !== null || Number(r.expires_at) <= now || Number(r.issued_at) > now || r.principal_id !== proof.principalId || Number(r.auth_version) !== proof.authVersion || Number(r.issued_at) !== proof.issuedAt || Number(r.expires_at) !== proof.expiresAt) return false;
    return this.owners.principal(proof.principalId)?.authVersion === proof.authVersion;
  }
  revoke(sidDigest: string, proof: PersonalSessionRow, appId: string, now = Date.now()): boolean {
    return this.storage.transactionSync(() => {
      if (!this.active(sidDigest, proof, appId, now)) return false;
      this.storage.sql.exec('UPDATE personal_auth_sessions SET revoked_at = ? WHERE sid_digest = ?', now, sidDigest);
      return true;
    });
  }
}
