// Threads owner claim (direction v2, 6.3). Default path: the Worker exchanges the OAuth code with the
// app secret (a Worker secret), publishes the owner-approved claim text and reads the post back to match
// the fingerprint. The secret and tokens never reach the bundle or the repository.
// In development mode only users with the Threads Tester role can authorize the app.
// Owner-direct posting (no secret) is offered as an alternative, but as of 2026-11-01 Threads does not
// expose a post's text without a token (oEmbed returns an embed shell; public pages render client-side),
// so that path is shown as a visual check and never marked machine-verified.

export type ThreadsConfig = {appId: string; appSecret: string; redirectUri: string; graph?: string; authorize?: string; fetcher?: typeof fetch};
export type ClaimRecord = {
  agent: string; status: 'pending_claim' | 'claimed' | 'claim_revoked' | 'mismatch';
  path: 'worker_token' | 'owner_direct' | 'prerecorded'; handle: string; fingerprint: string;
  permalink: string | null; mediaId: string | null; postedText: string | null; verifiedAt: number | null; checkedAt: number | null;
  machineVerified: boolean; note?: string;
};

const GRAPH = 'https://graph.threads.net', AUTH = 'https://threads.net/oauth/authorize';
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export function authorizeUrl(cfg: ThreadsConfig, state: string) {
  return `${cfg.authorize ?? AUTH}?${q({client_id: cfg.appId, redirect_uri: cfg.redirectUri, scope: 'threads_basic,threads_content_publish', response_type: 'code', state})}`;
}

async function call<T>(cfg: ThreadsConfig, method: 'GET' | 'POST', path: string, params: Record<string, string>): Promise<T> {
  const url = `${cfg.graph ?? GRAPH}${path}`;
  const res = method === 'GET'
    ? await (cfg.fetcher ?? fetch)(`${url}?${q(params)}`)
    : await (cfg.fetcher ?? fetch)(url, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: q(params)});
  const body = await res.json().catch(() => ({})) as any;
  if (!res.ok || body.error) throw new ThreadsError(body.error?.message ?? `HTTP ${res.status}`, res.status, body.error?.code, body.error?.error_subcode, body.error?.type);
  return body as T;
}
export class ThreadsError extends Error {
  status: number; code?: number; subcode?: number; type?: string;
  constructor(m: string, s: number, code?: number, subcode?: number, type?: string) { super(m); this.status = s; this.code = code; this.subcode = subcode; this.type = type; }
  /** Expired, invalid or revoked token (Graph error 190 / OAuthException): says nothing about the post. */
  get isAuth() { return this.code === 190 || this.code === 102 || this.status === 401 || (this.type === 'OAuthException' && this.code !== 100); }
  /** The post itself is gone: 404, or Graph "object does not exist" (code 100, subcode 33). */
  get isMissingPost() { return !this.isAuth && (this.status === 404 || (this.code === 100 && this.subcode === 33)); }
}

export async function exchangeCode(cfg: ThreadsConfig, code: string) {
  const short = await call<{access_token: string; user_id: string | number}>(cfg, 'POST', '/oauth/access_token', {client_id: cfg.appId, client_secret: cfg.appSecret, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri, code});
  // Long-lived (60 days) so the Worker can re-check the post later; falls back to the short token.
  const long = await call<{access_token: string; expires_in: number}>(cfg, 'GET', '/access_token', {grant_type: 'th_exchange_token', client_secret: cfg.appSecret, access_token: short.access_token}).catch(() => null);
  return {token: long?.access_token ?? short.access_token, userId: String(short.user_id), expiresIn: long?.expires_in ?? 3600};
}

export const me = (cfg: ThreadsConfig, token: string) => call<{id: string; username: string}>(cfg, 'GET', '/v1.0/me', {fields: 'id,username', access_token: token});

export async function publishText(cfg: ThreadsConfig, token: string, userId: string, text: string) {
  const container = await call<{id: string}>(cfg, 'POST', `/v1.0/${userId}/threads`, {media_type: 'TEXT', text, access_token: token});
  const post = await call<{id: string}>(cfg, 'POST', `/v1.0/${userId}/threads_publish`, {creation_id: container.id, access_token: token});
  return post.id;
}

export const readPost = (cfg: ThreadsConfig, token: string, mediaId: string) =>
  call<{id: string; text?: string; permalink?: string; username?: string; timestamp?: string}>(cfg, 'GET', `/v1.0/${mediaId}`, {fields: 'id,text,permalink,username,timestamp', access_token: token});

/** The post must come from the claimed handle and contain the displayed fingerprint verbatim. */
export function matchClaim(post: {text?: string; username?: string}, expected: {handle: string; display: string}) {
  const handleOk = (post.username ?? '').toLowerCase() === expected.handle.toLowerCase();
  const textOk = (post.text ?? '').replace(/\s+/g, ' ').includes(expected.display);
  return {ok: handleOk && textOk, handleOk, textOk};
}

export type ClaimStep = 'exchange' | 'identity' | 'find_existing' | 'publish' | 'read_back';
export class ClaimStepError extends Error {
  step: ClaimStep; cause: unknown;
  constructor(step: ClaimStep, cause: unknown) { super(`${step}: ${cause instanceof Error ? cause.message : String(cause)}`); this.step = step; this.cause = cause; }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function step<T>(name: ClaimStep, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { throw e instanceof ClaimStepError ? e : new ClaimStepError(name, e); }
}
async function retry<T>(fn: () => Promise<T>, tries: number, delayMs: number): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (e instanceof ThreadsError && e.isAuth) break; if (i < tries - 1) await wait(delayMs * (i + 1)); }
  }
  throw last;
}

/** The owner's recent posts, to reuse an existing claim post instead of posting twice. */
// Reuse needs the whole approved text, so a post made for another deployment (same fingerprint) is never reused.
const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().includes(b.replace(/\s+/g, ' ').trim());

export const recentPosts = (cfg: ThreadsConfig, token: string) =>
  call<{data?: {id: string; text?: string; permalink?: string; username?: string; timestamp?: string}[]}>(cfg, 'GET', '/v1.0/me/threads', {fields: 'id,text,permalink,username,timestamp', limit: '25', access_token: token});

/**
 * Full default path: code → token → identity check → reuse or publish the approved text → read back → match.
 * `onPublished` persists the media id and token before the read-back, so a retry never posts twice.
 */
export async function claimViaWorker(cfg: ThreadsConfig, code: string, expected: {agent: string; handle: string; display: string; text: string}, now = Date.now(), hooks: {onPublished?: (mediaId: string, token: string) => Promise<void> | void; readDelayMs?: number} = {}): Promise<{record: ClaimRecord; token: string; reused: boolean}> {
  const t = await step('exchange', () => exchangeCode(cfg, code));
  const who = await step('identity', () => me(cfg, t.token));
  if (who.username.toLowerCase() !== expected.handle.toLowerCase()) throw new ClaimStepError('identity', new ThreadsError(`Signed in as @${who.username}, not the claimed owner @${expected.handle}`, 403));
  const existing = await step('find_existing', async () => (await recentPosts(cfg, t.token).catch(() => ({data: []}))).data?.find(p => matchClaim({...p, username: p.username ?? who.username}, expected).textOk && sameText(p.text ?? '', expected.text)) ?? null);
  const mediaId = existing?.id ?? await step('publish', () => retry(() => publishText(cfg, t.token, who.id, expected.text), 3, 1500));
  await hooks.onPublished?.(mediaId, t.token);
  const post = existing?.permalink && existing.text ? {...existing, username: existing.username ?? who.username} : await step('read_back', () => retry(() => readPost(cfg, t.token, mediaId), 4, hooks.readDelayMs ?? 1500));
  const m = matchClaim(post, expected);
  return {
    token: t.token, reused: !!existing,
    record: {agent: expected.agent, status: m.ok ? 'claimed' : 'mismatch', path: 'worker_token', handle: who.username, fingerprint: expected.display, permalink: post.permalink ?? null, mediaId, postedText: post.text ?? null, verifiedAt: m.ok ? now : null, checkedAt: now, machineVerified: m.ok},
  };
}

/** Periodic re-check: a deleted post revokes the claim; an unreachable API keeps the last state. */
export async function recheck(cfg: ThreadsConfig, token: string, record: ClaimRecord, now = Date.now()): Promise<ClaimRecord> {
  if (!record.mediaId) return record;
  try {
    const post = await readPost(cfg, token, record.mediaId);
    const m = matchClaim(post, {handle: record.handle, display: record.fingerprint});
    return {...record, status: m.ok ? 'claimed' : 'mismatch', checkedAt: now, machineVerified: m.ok};
  } catch (e) {
    // Only a confirmed missing post revokes the claim. Token problems keep the last verified state.
    if (e instanceof ThreadsError && e.isMissingPost) return {...record, status: 'claim_revoked', checkedAt: now, machineVerified: false, note: 'post deleted'};
    const auth = e instanceof ThreadsError && e.isAuth;
    return {...record, checkedAt: now, note: (auth ? 'recheck paused: Threads token expired or invalid; last verified state kept' : 'recheck failed: ' + String((e as Error).message).slice(0, 80))};
  }
}

/** Owner-direct path: only checks that the permalink is a Threads post by the claimed handle. */
export function ownerDirectRecord(agent: string, handle: string, display: string, permalink: string, now = Date.now()): ClaimRecord | null {
  const m = /^https:\/\/www\.threads\.(?:net|com)\/@([a-z0-9._]{1,30})\/post\/([A-Za-z0-9_-]{5,20})\/?$/i.exec(permalink.trim());
  if (!m || m[1].toLowerCase() !== handle.toLowerCase()) return null;
  return {agent, status: 'pending_claim', path: 'owner_direct', handle, fingerprint: display, permalink: `https://www.threads.com/@${m[1]}/post/${m[2]}`, mediaId: null, postedText: null, verifiedAt: null, checkedAt: now, machineVerified: false, note: 'Visual check only: Threads does not expose post text without a token.'};
}

/** Personal login is separate from the legacy publishing claim above. No refresh, publish or token persistence. */
export type PersonalThreadsConfig = {appId: string; appSecret: string; redirectUri: string; fetcher?: typeof fetch; timeoutMs?: number};
export function personalAuthorizeUrl(cfg: Pick<PersonalThreadsConfig, 'appId' | 'redirectUri'>, state: string) {
  return 'https://threads.com/oauth/authorize?' + q({client_id: cfg.appId, redirect_uri: cfg.redirectUri, scope: 'threads_basic', response_type: 'code', state});
}
export class ThreadsLoginError extends Error {
  constructor() { super('threads_login_failed'); this.name = 'ThreadsLoginError'; }
}
/** One total bounded deadline for the short exchange + app-scoped me read. All raw data dies in this call. */
export async function personalThreadsIdentity(cfg: PersonalThreadsConfig, code: string): Promise<{subject: string}> {
  const controller = new AbortController();
  const timeout = cfg.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 10_000 || typeof code !== 'string' || !code || code.length > 4096 || /[\u0000-\u001f\u007f]/.test(code)) throw new ThreadsLoginError();
  const deadline = Date.now() + timeout;
  const timer = setTimeout(() => controller.abort(), timeout);
  const signal = controller.signal;
  const checkDeadline = () => { if (Date.now() >= deadline) controller.abort(); signal.throwIfAborted(); };
  const bounded = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => reject(new ThreadsLoginError());
    // Attach both handlers even when already expired: late fetch/read rejection must not become unhandled.
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, () => { signal.removeEventListener('abort', abort); reject(new ThreadsLoginError()); });
    if (Date.now() >= deadline) controller.abort();
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, {once: true});
  });
  async function json(path: string, init: RequestInit) {
    checkDeadline();
    // Workers have no ambient browser cookie jar; explicitly omit credentials in the shared fetch DI too.
    const options: RequestInit & {credentials: 'omit'} = {...init, credentials: 'omit', redirect: 'manual', cache: 'no-store', signal};
    const pending = (cfg.fetcher ?? fetch)('https://graph.threads.com' + path, options).then(res => {
      try { checkDeadline(); } catch { void res.body?.cancel().catch(() => {}); throw new ThreadsLoginError(); }
      return res;
    });
    const res = await bounded(pending);
    try { checkDeadline(); } catch { void res.body?.cancel().catch(() => {}); throw new ThreadsLoginError(); }
    if (res.status !== 200 || res.redirected || !res.body) { void res.body?.cancel().catch(() => {}); throw new ThreadsLoginError(); }
    const reader = res.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0, done = false;
    try {
      for (;;) {
        const part = await bounded(reader.read());
        checkDeadline();
        if (part.done) { done = true; break; }
        length += part.value.byteLength;
        if (length > 65_536) throw new ThreadsLoginError();
        chunks.push(part.value);
      }
      checkDeadline();
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const value = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(bytes)) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.error) throw new ThreadsLoginError();
      return value;
    } finally { if (!done) void reader.cancel().catch(() => {}); }
  }
  try {
    const token = await json('/oauth/access_token', {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: q({client_id: cfg.appId, client_secret: cfg.appSecret, code, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri})});
    if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 8192 || (token.token_type !== undefined && token.token_type !== 'bearer')) throw new ThreadsLoginError();
    const who = await json('/v1.0/me?' + q({fields: 'id', access_token: token.access_token}), {method: 'GET'});
    if (typeof who.id !== 'string' || !/^[0-9]{1,128}$/.test(who.id)) throw new ThreadsLoginError();
    checkDeadline();
    return {subject: who.id};
  } catch { throw new ThreadsLoginError(); }
  finally { clearTimeout(timer); controller.abort(); }
}
