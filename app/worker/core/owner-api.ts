// Owner control HTTP routes (contract C06, I-02): the owner session, revocation and re-delegation, approvals, the owner
// location source (13.1), Musely agent keys (7.2) and owner notifications (12.3).
// Owner actions need an owner session (POST /api/owner/session with a control token) for the Muse in question, and
// every owner write must come from one of our origins (CSRF). A judge session is not an owner: it keeps reads and the
// P0 demonstration only. The owner id comes from the session, never from the request body. Agent keys are shown once.
import {
  PRINCIPALS, ownsMuse, principalForToken, issueOwnerSession, ownerCookie, clearOwnerCookie, originAllowed, ownerSessionView, tokensConfigured,
  type OwnerSession, type OwnerTokens,
} from './owner-session.ts';
import {OWNER_MUSE} from '../../src/engine/world.ts';

type MaybePromise<T> = T | Promise<T>;
export interface ConnectedStub {
  ownerLocation(): MaybePromise<unknown>;
  setOwnerLocation(input: unknown): MaybePromise<{ok: boolean; reason?: string}>;
  issueAgentKey(muse: string): MaybePromise<unknown>;
  listAgentKeys(muse: string): MaybePromise<unknown>;
  agentKeyMuse(id: string): MaybePromise<string | null>;
  revokeAgentKey(id: string): MaybePromise<unknown | null>;
  ownerNotifications(full: boolean): MaybePromise<unknown>;
  ownerRevoke(muse: string, by: string): MaybePromise<{ok: boolean; reason?: string}>;
  ownerRedelegate(muse: string, by: string): MaybePromise<{ok: boolean; reason?: string}>;
  delegationStatus(muses: string[]): MaybePromise<unknown>;
  taskParticipants(taskId: string): MaybePromise<{from: string; to: string; status: string} | null>;
}
/** Who is asking: the verified owner session, if any. A judge or visitor session never appears here. */
export type OwnerAuth = {owner: OwnerSession | null};
export type OwnerConfig = {secret: string; tokens: OwnerTokens; origins: string[]; rateLimit?: (key: string) => Promise<boolean>; clientKey?: string};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers}});
const MUSE_ID = /^\d{2}-[a-z]{2,12}$/;

async function body(request: Request, limit: number): Promise<Record<string, unknown> | null> {
  try { const text = await request.text(); if (text.length > limit) return null; const v = JSON.parse(text || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

/**
 * The owner gate. `write` adds the CSRF Origin check. With `muse`, the session's principal must own that Muse: another
 * principal's session is refused (not_your_muse), so two owners can never approve or revoke for each other.
 */
export function requireOwner(request: Request, auth: OwnerAuth, cfg: Pick<OwnerConfig, 'origins'>, opts: {write: boolean; muse?: string}): Response | OwnerSession {
  if (opts.write && !originAllowed(request, cfg.origins)) return json({error: 'origin_not_allowed'}, 403);
  if (!auth.owner) return json({error: 'owner_session_required'}, 401);
  if (opts.muse && !ownsMuse(auth.owner, opts.muse)) return json({error: 'not_your_muse', detail: 'This owner session controls only its own Muse.'}, 403);
  return auth.owner;
}

export async function connectedRoutes(request: Request, url: URL, auth: OwnerAuth, stub: ConnectedStub, cfg: OwnerConfig): Promise<Response | null> {
  const p = url.pathname, method = request.method;
  const gate = (opts: {write: boolean; muse?: string}) => requireOwner(request, auth, cfg, opts);

  // ----- owner session (C06) -----
  if (p === '/api/owner/session' && method === 'POST') {
    if (!originAllowed(request, cfg.origins)) return json({error: 'origin_not_allowed'}, 403);
    if (!cfg.secret || !tokensConfigured(cfg.tokens)) return json({error: 'not_configured'}, 503);
    if (cfg.rateLimit && !(await cfg.rateLimit('owner-session:' + (cfg.clientKey ?? '')))) return json({error: 'slow_down'}, 429);
    const b = await body(request, 2048);
    if (!b) return json({error: 'bad_request'}, 400);
    // Only the control token counts. A claim permalink, a fingerprint, a ritual record or a judge link is not an owner credential.
    const principal = principalForToken(cfg.tokens, b.token);
    if (!principal) return json({error: 'owner_token_invalid'}, 403);
    const {token, session} = await issueOwnerSession(cfg.secret, cfg.tokens, principal);
    return json({owner: ownerSessionView(session), delegation: await stub.delegationStatus(PRINCIPALS[principal].muses)}, 200, {'set-cookie': ownerCookie(token)});
  }
  if (p === '/api/owner/session' && method === 'GET') {
    if (!auth.owner) return json({owner: null});
    return json({owner: ownerSessionView(auth.owner), delegation: await stub.delegationStatus(PRINCIPALS[auth.owner.principal].muses)});
  }
  if (p === '/api/owner/session' && method === 'DELETE') {
    if (!originAllowed(request, cfg.origins)) return json({error: 'origin_not_allowed'}, 403);
    return json({owner: null}, 200, {'set-cookie': clearOwnerCookie});
  }

  // ----- revocation and the separate re-delegation (direction v2, 7; C04) -----
  if ((p === '/api/owner/revoke' || p === '/api/owner/redelegate') && method === 'POST') {
    const pre = gate({write: true});
    if (pre instanceof Response) return pre;
    const b = await body(request, 1024);
    if (!b) return json({error: 'bad_request'}, 400);
    const muse = b.muse === undefined ? PRINCIPALS[pre.principal].muses[0] : String(b.muse);
    if (!MUSE_ID.test(muse)) return json({error: 'bad_request'}, 400);
    const s = gate({write: true, muse});
    if (s instanceof Response) return s;
    const r = p === '/api/owner/revoke' ? await stub.ownerRevoke(muse, s.ownerId) : await stub.ownerRedelegate(muse, s.ownerId);
    return r.ok ? json(r) : json({error: r.reason ?? 'refused'}, 404);
  }

  // ----- owner approvals (C06): the authorization is here; the Task workflow behind it belongs to I-07 -----
  if (p === '/api/owner/approvals' && method === 'POST') {
    const b = await body(request, 2048);
    if (!b) return json({error: 'bad_request'}, 400);
    const taskId = String(b.taskId ?? '');
    if (!/^task_[0-9a-z]{1,10}$/.test(taskId) || !['approve', 'reject'].includes(String(b.decision))) return json({error: 'bad_request'}, 400);
    const pre = gate({write: true});
    if (pre instanceof Response) return pre;
    const task = await stub.taskParticipants(taskId);
    if (!task) return json({error: 'unknown_task'}, 404);
    const mine = PRINCIPALS[pre.principal].muses.find(m => m === task.from || m === task.to);
    if (!mine) return json({error: 'not_your_muse', detail: 'This owner session controls only its own Muse.'}, 403);
    // Not yet implemented: the revision/contentHash approval and the two-owner completion are I-07. Never a fake success.
    return json({error: 'capability_not_ready', detail: 'Owner approval of Tasks arrives with I-07. Nothing was approved.', muse: mine}, 501);
  }

  // ----- owner location (13.1): the real owner's Muse only -----
  if (p === '/api/owner/location' && method === 'GET') return json(await stub.ownerLocation());
  if (p === '/api/owner/location' && method === 'POST') {
    const s = gate({write: true, muse: OWNER_MUSE});
    if (s instanceof Response) return s;
    const b = await body(request, 1024);
    if (!b) return json({error: 'bad_request'}, 400);
    const r = await stub.setOwnerLocation(b);
    return r.ok ? json(r) : json({error: 'invalid_location', reason: r.reason}, 400);
  }
  // Details (meetup candidate time and place) only for the owner of the Muse they belong to.
  if (p === '/api/owner/notifications' && method === 'GET') return json(await stub.ownerNotifications(!!auth.owner && ownsMuse(auth.owner, OWNER_MUSE)));

  // ----- Musely agent keys (7.2): for the session's own Muse -----
  if (p === '/api/agent-keys' && method === 'POST') {
    const pre = gate({write: true});
    if (pre instanceof Response) return pre;
    const b = await body(request, 512);
    if (!b) return json({error: 'bad_request'}, 400);
    const muse = b.muse === undefined ? PRINCIPALS[pre.principal].muses[0] : String(b.muse);
    const s = gate({write: true, muse});
    if (s instanceof Response) return s;
    return json(await stub.issueAgentKey(muse), 201);
  }
  if (p === '/api/agent-keys' && method === 'GET') {
    const s = gate({write: false});
    if (s instanceof Response) return s;
    const keys = [];
    for (const muse of PRINCIPALS[s.principal].muses) for (const k of (await stub.listAgentKeys(muse)) as unknown[]) keys.push({...(k as object), muse});
    return json({keys});
  }
  const del = /^\/api\/agent-keys\/(ak_[A-Za-z0-9_-]{6,20})$/.exec(p);
  if (del && method === 'DELETE') {
    const pre = gate({write: true});
    if (pre instanceof Response) return pre;
    const muse = await stub.agentKeyMuse(del[1]);
    if (!muse) return json({error: 'unknown_key'}, 404);
    if (!ownsMuse(pre, muse)) return json({error: 'not_your_muse', detail: 'This owner session controls only its own Muse.'}, 403);
    const r = await stub.revokeAgentKey(del[1]);
    return r ? json(r) : json({error: 'unknown_key'}, 404);
  }
  return null;
}
