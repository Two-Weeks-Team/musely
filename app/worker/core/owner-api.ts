import type {LegacyOwnerProof} from './legacy-profile.ts';
// Owner control HTTP routes (contract C06, I-02): the owner session, revocation and re-delegation, approvals and the
// owner inbox (I-07), the owner location source (13.1), Musely agent keys (7.2) with the key purge (G-09), owner
// notifications (12.3) and the reviewer Muse reset (G-08).
// Owner actions need an owner session (POST /api/owner/session with a control token) for the Muse in question, and
// every owner write must come from one of our origins (CSRF). A judge session is not an owner: it keeps reads and the
// P0 demonstration only. The owner id comes from the session, never from the request body. Agent keys are shown once.
import {
  PRINCIPALS, ownsMuse, principalForToken, issueOwnerSession, ownerCookie, clearOwnerCookie, originAllowed, ownerSessionView, tokensConfigured, reviewerConfigured,
  type OwnerSession, type OwnerTokens,
} from './owner-session.ts';
import {OWNER_MUSE} from '../../src/engine/world.ts';
import type {DecisionInput, DecisionOutcome} from './tasks.ts';

type MaybePromise<T> = T | Promise<T>;
export interface ConnectedStub {
  legacyProfileGet(owner:LegacyOwnerProof):MaybePromise<unknown>;
  legacyProfilePatch(owner:LegacyOwnerProof,input:unknown):MaybePromise<unknown>;
  ownerLocation(): MaybePromise<unknown>;
  setOwnerLocation(input: unknown): MaybePromise<{ok: boolean; reason?: string}>;
  issueAgentKey(muse: string): MaybePromise<unknown>;
  listAgentKeys(muse: string): MaybePromise<unknown>;
  agentKeyMuse(id: string): MaybePromise<string | null>;
  revokeAgentKey(id: string): MaybePromise<unknown | null>;
  purgeAgentKey(id: string, by: string): MaybePromise<unknown | null>;
  resetMuse(muse: string, by: string): MaybePromise<{ok: boolean; reason?: string}>;
  ownerNotifications(detailFor: string[]): MaybePromise<unknown>;
  ownerRevoke(muse: string, by: string): MaybePromise<{ok: boolean; reason?: string}>;
  ownerRedelegate(muse: string, by: string): MaybePromise<{ok: boolean; reason?: string}>;
  delegationStatus(muses: string[]): MaybePromise<unknown>;
  taskParticipants(taskId: string): MaybePromise<{from: string; to: string; status: string} | null>;
  ownerApprove(input: DecisionInput): MaybePromise<DecisionOutcome>;
  ownerInbox(muses: string[]): MaybePromise<unknown>;
}
/** Who is asking: the verified owner session, if any. A judge or visitor session never appears here. */
export type OwnerAuth = {owner: OwnerSession | null};
export type OwnerConfig = {secret: string; tokens: OwnerTokens; origins: string[]; rateLimit?: (key: string) => Promise<boolean>; clientKey?: string};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers}});
const MUSE_ID = /^\d{2}-[a-z]{2,12}$/;
/** The fields POST /api/owner/approvals reads (C06). */
export const APPROVAL_FIELDS = ['taskId', 'revision', 'contentHash', 'decision', 'candidate'];

async function body(request: Request, limit: number): Promise<Record<string, unknown> | null> {
  try { const text = await request.text(); if (text.length > limit) return null; const v = JSON.parse(text || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

// Bounded bytes/time for the new profile write; other legacy routes keep their existing parsers.
async function profileBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !request.body) throw Error('invalid_profile');
  const reader=request.body.getReader(), bytes:number[]=[];let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('invalid_profile')),1000);});
  try { for(let reads=0;reads<4097;reads++){const part=await Promise.race([reader.read(),deadline]);if(part.done)return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(new Uint8Array(bytes)));if(bytes.length+part.value.byteLength>4096)throw Error('invalid_profile');for(const byte of part.value)bytes.push(byte);}throw Error('invalid_profile'); }
  finally {if(timer!==undefined)clearTimeout(timer);void reader.cancel().catch(()=>{});}
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

  if(p==='/api/owner/profile'){
    if(!['GET','PATCH'].includes(method))return json({error:'method_not_allowed'},405,{allow:'GET, PATCH'});
    const owner=gate({write:method==='PATCH',muse:OWNER_MUSE});if(owner instanceof Response)return owner;
    if(url.search)return json({error:'bad_query'},400);
    const proof:LegacyOwnerProof={principal:owner.principal,ownerId:owner.ownerId,exp:owner.exp};
    let input:unknown;if(method==='PATCH'){try{input=await profileBody(request);}catch{return json({error:'invalid_profile'},400);}}
    try{return json({profile:method==='GET'?await stub.legacyProfileGet(proof):await stub.legacyProfilePatch(proof,input)});}
    catch(e){const code=e&&typeof e==='object'&&'name'in e&&e.name==='LegacyProfileError'&&'code'in e&&typeof e.code==='string'?e.code:null;
      const status=code==='owner_session_required'?401:code==='not_your_muse'?403:code==='invalid_profile'?400:code==='profile_conflict'?409:503;
      return json({error:status===503?'profile_unavailable':code},status);
    }
  }

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

  // ----- reviewer Muse reset (G-08): the reviewer session only, for its own Muse -----
  if (p === '/api/owner/reset' && method === 'POST') {
    if (!originAllowed(request, cfg.origins)) return json({error: 'origin_not_allowed'}, 403);
    if (!reviewerConfigured(cfg.tokens)) return json({error: 'not_configured', detail: 'The reviewer principal is not configured: REVIEWER_CONTROL_TOKEN is missing or invalid.'}, 503);
    const pre = gate({write: true});
    if (pre instanceof Response) return pre;
    if (pre.principal !== 'reviewer') return json({error: 'reviewer_only', detail: 'Only the reviewer session can reset its Muse.'}, 403);
    const b = await body(request, 512);
    if (!b) return json({error: 'bad_request'}, 400);
    const muse = b.muse === undefined ? PRINCIPALS.reviewer.muses[0] : String(b.muse);
    const s = gate({write: true, muse});
    if (s instanceof Response) return s;
    const r = await stub.resetMuse(muse, s.ownerId);
    if (r.ok) return json(r);
    return r.reason === 'delegation_revoked' ? json({error: 'delegation_revoked', detail: 'The Muse is revoked. Delegate it again (POST /api/owner/redelegate) before a reset.'}, 409) : json({error: r.reason ?? 'refused'}, 404);
  }

  // ----- owner approvals (C06, I-07): {taskId, revision, contentHash, decision, candidate?} -----
  if (p === '/api/owner/approvals' && method === 'POST') {
    const b = await body(request, 2048);
    if (!b) return json({error: 'bad_request'}, 400);
    // Only these fields are read. Anything else (a free-text reason, say) refuses the whole request before any of it is
    // used, stored or logged: a decision never carries a reason.
    if (Object.keys(b).some(k => !APPROVAL_FIELDS.includes(k))) return json({error: 'unexpected_field', detail: `Only ${APPROVAL_FIELDS.join(', ')} are accepted. A decision carries no reason.`}, 400);
    const taskId = String(b.taskId ?? '');
    if (!/^task_[0-9a-z]{1,10}$/.test(taskId) || !['approve', 'reject'].includes(String(b.decision))) return json({error: 'bad_request'}, 400);
    const pre = gate({write: true});
    if (pre instanceof Response) return pre;
    const task = await stub.taskParticipants(taskId);
    if (!task) return json({error: 'unknown_task'}, 404);
    const mine = PRINCIPALS[pre.principal].muses.find(m => m === task.from || m === task.to);
    if (!mine) return json({error: 'not_your_muse', detail: 'This owner session controls only its own Muse.'}, 403);
    const decision = b.decision as 'approve' | 'reject';
    if (!Number.isSafeInteger(b.revision) || (b.revision as number) < 1 || typeof b.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(b.contentHash)) return json({error: 'bad_request', detail: 'revision (from 1) and contentHash (64 hex) of the Task you decide on are required.'}, 400);
    if (b.candidate !== undefined && (decision !== 'approve' || typeof b.candidate !== 'string' || !/^c[1-5]$/.test(b.candidate))) return json({error: 'bad_request', detail: 'candidate is a candidate id (c1…c5), only with approve.'}, 400);
    const r = await stub.ownerApprove({taskId, muse: mine, ownerId: pre.ownerId, revision: b.revision as number, contentHash: b.contentHash, decision, candidate: (b.candidate as string | undefined) ?? null});
    if (r.ok) return json({ok: true, decision, duplicate: r.duplicate, confirmed: r.confirmed, task: r.task});
    return json({error: r.code, retryable: r.retryable, ...(r.extra ?? {})}, r.status);
  }
  // ----- the owner inbox (C06, 12.3): separate from the agent inbox (heartbeat_check) -----
  if (p === '/api/owner/inbox' && method === 'GET') {
    const s = gate({write: false});
    if (s instanceof Response) return s;
    const principal = PRINCIPALS[s.principal];
    return json({owner: ownerSessionView(s), demo_limits: principal.demo ? principal.note : null, ...(await stub.ownerInbox(principal.muses)) as object});
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
  // Details (meetup candidate time and place) only for the owner of the Muse each notification belongs to.
  if (p === '/api/owner/notifications' && method === 'GET') return json(await stub.ownerNotifications(auth.owner ? PRINCIPALS[auth.owner.principal].muses : []));

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
  // DELETE revokes the key; with ?purge=1 it also deletes or anonymizes what was made under it (G-09).
  const del = /^\/api\/agent-keys\/(ak_[A-Za-z0-9_-]{6,20})$/.exec(p);
  if (del && method === 'DELETE') {
    const purge = url.searchParams.get('purge');
    if (purge !== null && purge !== '1') return json({error: 'bad_request', detail: 'purge must be 1'}, 400);
    const pre = gate({write: true});
    if (pre instanceof Response) return pre;
    const muse = await stub.agentKeyMuse(del[1]);
    if (!muse) return json({error: 'unknown_key'}, 404);
    if (!ownsMuse(pre, muse)) return json({error: 'not_your_muse', detail: 'This owner session controls only its own Muse.'}, 403);
    const r = purge === '1' ? await stub.purgeAgentKey(del[1], pre.ownerId) : await stub.revokeAgentKey(del[1]);
    return r ? json(r) : json({error: 'unknown_key'}, 404);
  }
  return null;
}
