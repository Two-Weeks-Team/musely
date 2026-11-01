// Musely preview Worker: static assets plus the /api surface (direction v2, 15 and 20.2).
import {handleMuse} from './core/proxy.ts';
import {issueSession, readSession, cookieValue, sessionCookie, hashIp, timingSafeEqual, verifyTurnstile} from './core/session.ts';
import type {Env} from './env.ts';
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

  return json({error: 'not_found'}, 404);
}

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
