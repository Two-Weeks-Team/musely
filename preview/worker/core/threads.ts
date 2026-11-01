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
  if (!res.ok || body.error) throw new ThreadsError(body.error?.message ?? `HTTP ${res.status}`, res.status);
  return body as T;
}
export class ThreadsError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }

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

/** Full default path: code → token → identity check → publish approved text → read back → match. */
export async function claimViaWorker(cfg: ThreadsConfig, code: string, expected: {agent: string; handle: string; display: string; text: string}, now = Date.now()): Promise<{record: ClaimRecord; token: string}> {
  const t = await exchangeCode(cfg, code);
  const who = await me(cfg, t.token);
  if (who.username.toLowerCase() !== expected.handle.toLowerCase()) throw new ThreadsError(`Signed in as @${who.username}, not the claimed owner @${expected.handle}`, 403);
  const mediaId = await publishText(cfg, t.token, who.id, expected.text);
  const post = await readPost(cfg, t.token, mediaId);
  const m = matchClaim(post, expected);
  return {
    token: t.token,
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
    if (e instanceof ThreadsError && (e.status === 400 || e.status === 404)) return {...record, status: 'claim_revoked', checkedAt: now, machineVerified: false, note: 'post no longer readable'};
    return {...record, note: 'recheck failed: ' + String((e as Error).message).slice(0, 80)};
  }
}

/** Owner-direct path: only checks that the permalink is a Threads post by the claimed handle. */
export function ownerDirectRecord(agent: string, handle: string, display: string, permalink: string, now = Date.now()): ClaimRecord | null {
  const m = /^https:\/\/www\.threads\.(?:net|com)\/@([a-z0-9._]{1,30})\/post\/([A-Za-z0-9_-]{5,20})\/?$/i.exec(permalink.trim());
  if (!m || m[1].toLowerCase() !== handle.toLowerCase()) return null;
  return {agent, status: 'pending_claim', path: 'owner_direct', handle, fingerprint: display, permalink: `https://www.threads.com/@${m[1]}/post/${m[2]}`, mediaId: null, postedText: null, verifiedAt: null, checkedAt: now, machineVerified: false, note: 'Visual check only: Threads does not expose post text without a token.'};
}
