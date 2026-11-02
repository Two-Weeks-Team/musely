// HTTP routes for the owner location source (13.1), Musely agent keys (7.2) and owner notifications (12.3).
// Writes need the judge (owner) session, like /api/p0/run. The agent key is returned once and never stored.
import type {Session} from './session.ts';

type MaybePromise<T> = T | Promise<T>;
export interface ConnectedStub {
  ownerLocation(): MaybePromise<unknown>;
  setOwnerLocation(input: unknown): MaybePromise<{ok: boolean; reason?: string}>;
  issueAgentKey(): MaybePromise<unknown>;
  listAgentKeys(): MaybePromise<unknown>;
  revokeAgentKey(id: string): MaybePromise<unknown | null>;
  ownerNotifications(full: boolean): MaybePromise<unknown>;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});

export async function connectedRoutes(request: Request, url: URL, session: Session | null, stub: ConnectedStub): Promise<Response | null> {
  const judge = session?.tier === 'judge';
  const p = url.pathname, method = request.method;

  if (p === '/api/owner/location' && method === 'GET') return json(await stub.ownerLocation());
  if (p === '/api/owner/location' && method === 'POST') {
    if (!judge) return json({error: 'judge_session_required'}, 403);
    let body: unknown;
    try { const text = await request.text(); if (text.length > 1024) throw new RangeError('too large'); body = JSON.parse(text || '{}'); } catch { return json({error: 'bad_request'}, 400); }
    const r = await stub.setOwnerLocation(body);
    return r.ok ? json(r) : json({error: 'invalid_location', reason: r.reason}, 400);
  }
  if (p === '/api/owner/notifications' && method === 'GET') return json(await stub.ownerNotifications(judge));

  if (p === '/api/agent-keys' && method === 'POST') {
    if (!judge) return json({error: 'judge_session_required'}, 403);
    return json(await stub.issueAgentKey(), 201);
  }
  if (p === '/api/agent-keys' && method === 'GET') {
    if (!judge) return json({error: 'judge_session_required'}, 403);
    return json({keys: await stub.listAgentKeys()});
  }
  const del = /^\/api\/agent-keys\/(ak_[A-Za-z0-9_-]{6,20})$/.exec(p);
  if (del && method === 'DELETE') {
    if (!judge) return json({error: 'judge_session_required'}, 403);
    const r = await stub.revokeAgentKey(del[1]);
    return r ? json(r) : json({error: 'unknown_key'}, 404);
  }
  return null;
}
