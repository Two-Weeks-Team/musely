// Personal explicit claim only. Token return is trusted server memory, never a public DTO.
import {threadsPermalink as permalink} from '../../src/identity/threads-permalink.ts';
export interface ClaimProviderConfig {appId: string; appSecret: string; redirectUri: string; fetcher?: typeof fetch; timeoutMs?: number}
export type ClaimExpected = {subject: string; display: string; text: string; postId?: string | null};
export type ClaimProviderFailure = 'invalid_input' | 'missing' | 'mismatch' | 'reauth_required' | 'unavailable';
export class PersonalClaimProviderError extends Error {
  readonly code: ClaimProviderFailure;
  constructor(code: ClaimProviderFailure) { super('personal_claim_provider_failed'); this.name = 'PersonalClaimProviderError'; this.code = code; }
}
const GRAPH = 'https://graph.threads.com', FIELDS = 'id,text,permalink,owner,username,timestamp';
const MAX_TOKEN_SECONDS = 60 * 24 * 3600;
function fail(code: ClaimProviderFailure): never { throw new PersonalClaimProviderError(code); }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numericId = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{1,128}$/.test(v);
const tokenValid = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 8192 && !/[\u0000-\u0020\u007f]/.test(v);
const normalize = (s: string) => s.replace(/\s+/gu, ' ').trim();
const q = (v: Record<string, string>) => new URLSearchParams(v).toString();
function configuration(cfg: ClaimProviderConfig, now: number) {
  if (!cfg || typeof cfg.appId !== 'string' || !/^[0-9]{1,32}$/.test(cfg.appId) || !tokenValid(cfg.appSecret) || typeof cfg.redirectUri !== 'string' || cfg.redirectUri.length > 2048 || !Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - MAX_TOKEN_SECONDS * 1000 - 10_000) fail('invalid_input');
  try { const u = new URL(cfg.redirectUri); if (u.protocol !== 'https:' || u.username || u.password || u.hash) fail('invalid_input'); } catch { fail('invalid_input'); }
  const timeout = cfg.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 10_000 || (cfg.fetcher !== undefined && typeof cfg.fetcher !== 'function')) fail('invalid_input');
  return timeout;
}
function expectation(e: ClaimExpected) {
  if (!e || !numericId(e.subject) || typeof e.display !== 'string' || !e.display || e.display.length > 256 || typeof e.text !== 'string' || !e.text || e.text.length > 4096 || (e.postId != null && !numericId(e.postId))) fail('invalid_input');
  const display = normalize(e.display), text = normalize(e.text);
  if (!display || !text.includes(display)) fail('invalid_input');
  return {subject: e.subject, display, text, postId: e.postId ?? null};
}
/** One controller/deadline for headers AND all response streams; no retry or pagination. */
class Provider {
  private controller = new AbortController();
  private start = Date.now();
  private timer: ReturnType<typeof setTimeout>;
  private calls = 0;
  private cfg: ClaimProviderConfig;
  private now: number;
  private timeout: number;
  private maxCalls: number;
  constructor(cfg: ClaimProviderConfig, now: number, timeout: number, maxCalls: number) {
    this.cfg = cfg; this.now = now; this.timeout = timeout; this.maxCalls = maxCalls;
    this.timer = setTimeout(() => this.controller.abort(), timeout);
  }
  at() { return this.now + Math.max(0, Date.now() - this.start); }
  check() { if (Date.now() - this.start >= this.timeout) this.controller.abort(); if (this.controller.signal.aborted) fail('unavailable'); }
  close() { clearTimeout(this.timer); this.controller.abort(); }
  private bounded<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const signal = this.controller.signal, abort = () => reject(new PersonalClaimProviderError('unavailable'));
      // Retain rejection handlers even for transports/streams that ignore abort and settle late.
      promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, () => { signal.removeEventListener('abort', abort); reject(new PersonalClaimProviderError('unavailable')); });
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, {once: true});
    });
  }
  async json(path: string, init: RequestInit, missingPost = false) {
    this.check(); if (++this.calls > this.maxCalls) fail('unavailable');
    const pending = (this.cfg.fetcher ?? fetch)(GRAPH + path, {...init, credentials: 'omit', redirect: 'manual', cache: 'no-store', signal: this.controller.signal} as RequestInit & {credentials: 'omit'}).then(res => {
      try { this.check(); } catch { void res.body?.cancel().catch(() => {}); fail('unavailable'); }
      return res;
    });
    const res = await this.bounded(pending);
    if (res.redirected || (res.status >= 300 && res.status < 400)) { void res.body?.cancel().catch(() => {}); fail('unavailable'); }
    // Only a stored-post read can establish missing; a /me or exchange 404 says nothing about that post.
    if (missingPost && res.status === 404) { void res.body?.cancel().catch(() => {}); fail('missing'); }
    if (res.status === 401) { void res.body?.cancel().catch(() => {}); fail('reauth_required'); }
    if (!res.body) fail('unavailable');
    const reader = res.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0, done = false;
    try {
      for (;;) {
        const part = await this.bounded(reader.read()); this.check();
        if (part.done) { done = true; break; }
        length += part.value.byteLength; if (length > 65_536) fail('unavailable'); chunks.push(part.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const data: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(bytes));
      if (!object(data)) fail('unavailable');
      if (data.error || res.status !== 200) {
        const error = object(data.error) ? data.error : null;
        if (error?.code === 190) fail('reauth_required');
        if (missingPost && res.status === 400 && error?.code === 100 && error.error_subcode === 33) fail('missing');
        fail('unavailable');
      }
      this.check(); return data;
    } finally { if (!done) void reader.cancel().catch(() => {}); }
  }
}
type Expected = ReturnType<typeof expectation>;
function identity(who: Record<string, unknown>, subject: string) {
  if (!numericId(who.id)) fail('unavailable');
  if (who.id !== subject) fail('mismatch');
}
function validPost(post: Record<string, unknown>, e: Expected) {
  return numericId(post.id) && (!e.postId || post.id === e.postId) && object(post.owner) && post.owner.id === e.subject && typeof post.text === 'string' && normalize(post.text) === e.text && normalize(post.text).includes(e.display);
}
function safeFailure(error: unknown): PersonalClaimProviderError {
  return error instanceof PersonalClaimProviderError ? error : new PersonalClaimProviderError('unavailable');
}

export async function verifyPersonalClaim(cfg: ClaimProviderConfig, code: string, expected: ClaimExpected, now = Date.now()): Promise<{subject: string; postId: string; permalink: string | null; checkedAt: number; token: string; tokenExpiresAt: number}> {
  let provider: Provider | undefined;
  try {
    const timeout = configuration(cfg, now), e = expectation(expected);
    if (typeof code !== 'string' || !code || code.length > 4096 || /[\u0000-\u001f\u007f]/.test(code)) fail('invalid_input');
    provider = new Provider(cfg, now, timeout, 4);
    const short = await provider.json('/oauth/access_token', {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: q({client_id: cfg.appId, client_secret: cfg.appSecret, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri, code})});
    if (!tokenValid(short.access_token) || (short.token_type !== undefined && short.token_type !== 'bearer')) fail('unavailable');
    identity(await provider.json('/v1.0/me?' + q({fields: 'id,username', access_token: short.access_token}), {method: 'GET'}), e.subject);
    const posts = await provider.json('/v1.0/me/threads?' + q({fields: FIELDS, limit: '25', access_token: short.access_token}), {method: 'GET'});
    if (!Array.isArray(posts.data) || posts.data.length > 25 || !posts.data.every(object)) fail('unavailable');
    const candidates = posts.data.filter(p => e.postId ? p.id === e.postId : typeof p.text === 'string' && normalize(p.text) === e.text);
    if (!candidates.length) fail('missing');
    const post = candidates.find(p => validPost(p, e)); if (!post) fail('mismatch');
    // Only a successful owned readback permits long-lived exchange. No publish, refresh or fallback token.
    const long = await provider.json('/access_token?' + q({grant_type: 'th_exchange_token', client_secret: cfg.appSecret, access_token: short.access_token}), {method: 'GET'});
    if (!tokenValid(long.access_token) || (long.token_type !== undefined && long.token_type !== 'bearer') || typeof long.expires_in !== 'number' || !Number.isSafeInteger(long.expires_in) || long.expires_in <= 0 || long.expires_in > MAX_TOKEN_SECONDS) fail('unavailable');
    provider.check(); const checkedAt = provider.at(), tokenExpiresAt = checkedAt + long.expires_in * 1000;
    if (!Number.isSafeInteger(tokenExpiresAt)) fail('unavailable');
    return {subject: e.subject, postId: post.id as string, permalink: permalink(post.permalink), checkedAt, token: long.access_token, tokenExpiresAt};
  } catch (error) { throw safeFailure(error); }
  finally { provider?.close(); }
}

export async function recheckPersonalClaim(cfg: ClaimProviderConfig, credential: {subject: string; postId: string; display: string; text: string; token: string; tokenExpiresAt: number}, now = Date.now()): Promise<{status: 'verified' | 'missing' | 'mismatch' | 'reauth_required' | 'unavailable'; checkedAt: number}> {
  let provider: Provider | undefined;
  try {
    const timeout = configuration(cfg, now), e = expectation(credential);
    if (!e.postId || !Number.isSafeInteger(credential.tokenExpiresAt)) fail('invalid_input');
    const token = credential.token, expiresAt = credential.tokenExpiresAt;
    if (!tokenValid(token) || expiresAt <= now) fail('reauth_required');
    provider = new Provider(cfg, now, timeout, 2);
    const current = () => { if (expiresAt <= provider!.at()) fail('reauth_required'); };
    identity(await provider.json('/v1.0/me?' + q({fields: 'id,username', access_token: token}), {method: 'GET'}), e.subject);
    current();
    const post = await provider.json('/v1.0/' + e.postId + '?' + q({fields: FIELDS, access_token: token}), {method: 'GET'}, true);
    current(); if (!validPost(post, e)) fail('mismatch');
    provider.check(); return {status: 'verified', checkedAt: provider.at()};
  } catch (error) { const code = safeFailure(error).code; return {status: code === 'invalid_input' ? 'unavailable' : code, checkedAt: provider?.at() ?? (Number.isSafeInteger(now) && now >= 0 ? now : Date.now())}; }
  finally { provider?.close(); }
}
