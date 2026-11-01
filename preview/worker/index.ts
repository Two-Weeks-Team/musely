// Musely preview Worker: static assets plus the /api surface (direction v2, 15 and 20.2).
import {handleMuse} from './core/proxy.ts';
import {issueSession, readSession, cookieValue, sessionCookie, hashIp, timingSafeEqual, verifyTurnstile} from './core/session.ts';
import type {Env} from './env.ts';
import {authorizeUrl, claimViaWorker, recheck, ownerDirectRecord, ThreadsError, ClaimStepError, type ThreadsConfig} from './core/threads.ts';
import ownerClaim from '../fixtures/owner-claim.json' with {type: 'json'};
export {WorldDO} from './world-do.ts';

const MODEL_TIMEOUT_MS = 8000;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers}});
const world = (env: Env) => env.WORLD.get(env.WORLD.idFromName('world'));

async function readJson(request: Request, limit: number) {
  const text = await request.text();
  if (text.length > limit) throw new RangeError('body too large');
  return text ? JSON.parse(text) : {};
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const session = await readSession(env.SESSION_SECRET ?? '', cookieValue(request.headers.get('cookie')));

  if (url.pathname === '/api/status' && request.method === 'GET') {
    const budget = await world(env).status();
    return json({
      model: {id: env.MODEL_ID, connected: !!env.MODEL_API_KEY, live: !!env.MODEL_API_KEY && budget.remainingUsd > 0},
      budget,
      turnstile: {sitekey: env.TURNSTILE_SITEKEY, configured: !!env.TURNSTILE_SECRET},
      session: session ? {tier: session.tier, expiresAt: session.exp, quota: await world(env).quota(session.sid, session.tier)} : null,
      aiGateway: env.MODEL_BASE.includes('gateway.ai.cloudflare.com'),
    });
  }

  if (url.pathname === '/api/session' && request.method === 'POST') {
    if (!env.SESSION_SECRET) return json({error: 'not_configured'}, 503);
    let body: {turnstile?: string; judge?: string};
    try { body = await readJson(request, 4096); } catch { return json({error: 'bad_request'}, 400); }
    let tier: 'visitor' | 'judge';
    if (body.judge) {
      if (!env.JUDGE_TOKEN || !timingSafeEqual(body.judge, env.JUDGE_TOKEN)) return json({error: 'judge_link_invalid'}, 403);
      tier = 'judge';
    } else {
      const check = await verifyTurnstile(env.TURNSTILE_SECRET ?? '', body.turnstile ?? '', ip, env.ALLOWED_HOSTS.split(','));
      if (!check.ok) return json({error: 'turnstile_failed', codes: check.codes}, 403);
      tier = 'visitor';
    }
    const {token, session: s} = await issueSession(env.SESSION_SECRET, tier);
    return json({tier, expiresAt: s.exp, quota: await world(env).quota(s.sid, tier)}, 200, {'set-cookie': sessionCookie(token)});
  }

  if (url.pathname === '/api/muse' && request.method === 'POST') {
    let body: unknown;
    try { body = await readJson(request, 1_300_000); } catch { return json({error: 'bad_request'}, 400); }
    const stub = world(env);
    return handleMuse(body, session, await hashIp(env.SESSION_SECRET ?? 'unset', ip), {
      ledger: {reserve: r => stub.reserve(r), settle: (id, cost, outcome) => stub.settle(id, cost, outcome)},
      model: {base: env.MODEL_BASE, key: env.MODEL_API_KEY, model: env.MODEL_ID, timeoutMs: MODEL_TIMEOUT_MS},
      burst: env.BURST ? async key => (await env.BURST!.limit({key})).success : undefined,
    });
  }

  // Shared world (direction v2, 8): read-only views for every visitor.
  if (url.pathname === '/api/world' && request.method === 'GET') return json(await world(env).worldView());
  if (url.pathname === '/api/world/events' && request.method === 'GET') return json(await world(env).worldEvents(Number(url.searchParams.get('since')) || 0, Number(url.searchParams.get('limit')) || 200));
  if (url.pathname === '/api/world/highlights' && request.method === 'GET') return json(await world(env).worldHighlights(Number(url.searchParams.get('limit')) || 100));

  // Owner claim (direction v2, 6.3). Only the owner Muse's claim exists in the demo.
  const claimMatch = /^\/api\/claim\/([a-z-]{1,40})$/.exec(url.pathname);
  if (claimMatch && request.method === 'GET') {
    const agent = claimMatch[1];
    if (agent !== ownerClaim.agent) return json({error: 'unknown_agent'}, 404);
    let record = await world(env).getClaim(agent);
    const token = record?.path === 'worker_token' ? await world(env).claimToken(agent) : null;
    const cfg = threadsConfig(env, url);
    // Re-read the post at most every 10 minutes; a deleted post becomes claim_revoked.
    if (record && token && cfg && (!record.checkedAt || Date.now() - record.checkedAt > 600_000)) record = await world(env).setClaim(agent, await recheck(cfg, token, record));
    return json({agent, handle: ownerClaim.handle, fingerprint: ownerClaim.fingerprint_display, fingerprintFull: ownerClaim.fingerprint, claimText: ownerClaim.claim_text, record: record ?? {status: 'pending_claim'}, workerTokenPath: !!cfg});
  }

  if (url.pathname === '/api/threads/start' && request.method === 'GET') {
    const cfg = threadsConfig(env, url);
    if (!cfg || !env.SESSION_SECRET) return json({error: 'threads_not_configured'}, 503);
    const nonce = crypto.randomUUID();
    const state = nonce + '.' + (await hashIp(env.SESSION_SECRET, 'threads-state:' + nonce));
    return new Response(null, {status: 302, headers: {location: authorizeUrl(cfg, state), 'set-cookie': `musely_ts=${nonce}; Path=/api/threads; Max-Age=600; HttpOnly; Secure; SameSite=Lax`, 'cache-control': 'no-store'}});
  }

  if (url.pathname === '/api/threads/callback' && request.method === 'GET') {
    const cfg = threadsConfig(env, url);
    if (!cfg || !env.SESSION_SECRET) return json({error: 'threads_not_configured'}, 503);
    const [nonce, mac] = (url.searchParams.get('state') ?? '').split('.');
    const cookieNonce = cookieValue(request.headers.get('cookie'), 'musely_ts');
    if (!nonce || !mac || nonce !== cookieNonce || !timingSafeEqual(mac, await hashIp(env.SESSION_SECRET, 'threads-state:' + nonce))) return json({error: 'state_mismatch'}, 400);
    const code = url.searchParams.get('code');
    if (!code) return redirectHome('claim=declined');
    const stub = world(env), expected = {agent: ownerClaim.agent, handle: ownerClaim.handle, display: ownerClaim.fingerprint_display, text: ownerClaim.claim_text};
    try {
      const {record, token, reused} = await claimViaWorker(cfg, code, expected, Date.now(), {
        // Persist the post id first: if the read-back fails, a retry reuses this post instead of posting again.
        onPublished: async (mediaId, token) => { await stub.setClaim(ownerClaim.agent, {agent: ownerClaim.agent, status: 'pending_claim', path: 'worker_token', handle: ownerClaim.handle, fingerprint: ownerClaim.fingerprint_display, permalink: null, mediaId, postedText: null, verifiedAt: null, checkedAt: Date.now(), machineVerified: false, note: 'published; read-back pending'}, token); },
      });
      await stub.setClaim(ownerClaim.agent, reused ? {...record, note: 'existing claim post reused'} : record, token);
      return redirectHome('claim=' + record.status);
    } catch (e) {
      const stepName = e instanceof ClaimStepError ? e.step : 'unknown';
      const cause = e instanceof ClaimStepError ? e.cause : e;
      const g = cause instanceof ThreadsError ? {status: cause.status, code: cause.code, subcode: cause.subcode, type: cause.type} : {};
      console.error('threads claim failed', JSON.stringify({step: stepName, message: cause instanceof Error ? cause.message : String(cause), ...g}));
      return redirectHome(`claim=failed&step=${stepName}${g.code ? '&code=' + g.code : ''}`);
    }
  }

  if (url.pathname === '/api/claim/permalink' && request.method === 'POST') {
    let body: {permalink?: string};
    try { body = await readJson(request, 2048); } catch { return json({error: 'bad_request'}, 400); }
    const record = ownerDirectRecord(ownerClaim.agent, ownerClaim.handle, ownerClaim.fingerprint_display, body.permalink ?? '');
    if (!record) return json({error: 'not_a_post_by_owner'}, 400);
    return json({record: await world(env).setClaim(ownerClaim.agent, record)});
  }

  return json({error: 'not_found'}, 404);
}

function threadsConfig(env: Env, url: URL): ThreadsConfig | null {
  if (!env.THREADS_APP_ID || !env.THREADS_APP_SECRET) return null;
  return {appId: env.THREADS_APP_ID, appSecret: env.THREADS_APP_SECRET, redirectUri: `${url.origin}/api/threads/callback`};
}
const redirectHome = (query: string) => new Response(null, {status: 302, headers: {location: '/?' + query, 'set-cookie': 'musely_ts=; Path=/api/threads; Max-Age=0; HttpOnly; Secure; SameSite=Lax', 'cache-control': 'no-store'}});

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (e) {
        console.error('api error', e);
        return json({error: 'internal'}, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
