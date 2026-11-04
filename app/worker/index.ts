import {isInstalledResidentId} from './core/world-life-controller.ts';
import {serveCriticalAsset} from './asset-encoding.ts';
// Musely main product Worker (musely.net): static assets plus the /api surface (direction v2, 15 and 20.2).
import {handleMuse} from './core/proxy.ts';
import {issueSession, readSession, cookieValue, sessionCookie, hashIp, timingSafeEqual, verifyTurnstile} from './core/session.ts';
import type {Env} from './env.ts';
import {authorizeUrl, claimViaWorker, recheck, ownerDirectRecord, ThreadsError, ClaimStepError, type ThreadsConfig} from './core/threads.ts';
import ownerClaim from '../fixtures/owner-claim.json' with {type: 'json'};
import {connectedRoutes, requireOwner, type OwnerConfig} from './core/owner-api.ts';
import {readOwnerSession, ownerOrigins, originAllowed, OWNER_COOKIE, type OwnerTokens} from './core/owner-session.ts';
import {handleMcpHttp} from './core/mcp-server.ts';
import {OWNER_SLOT} from './core/trust.ts';
import {HARNESS_IDS} from '../src/engine/harness.ts';
import {personalRoutes, isPersonalCallback} from './core/personal-api.ts';
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
  // Separate namespace, cookie, proof and durable auth store. Never inferred from owner/judge/visitor cookies.
  if (url.pathname.startsWith('/api/personal/') || isPersonalCallback(url)) return personalRoutes(request, url, {
    secret: env.SESSION_SECRET ?? '', origin: new URL(env.PUBLIC_ORIGIN).origin,
    appId: env.THREADS_APP_ID, appSecret: env.THREADS_APP_SECRET,
    rateLimit: env.BURST ? async () => (await env.BURST!.limit({key: 'personal-auth:' + await hashIp(env.SESSION_SECRET ?? 'unset', ip)})).success : undefined,
  }, world(env));
  const session = await readSession(env.SESSION_SECRET ?? '', cookieValue(request.headers.get('cookie')));
  // The owner session (C06) is a separate cookie and a separate check; a judge session is never an owner.
  const tokens: OwnerTokens = {owner: env.OWNER_CONTROL_TOKEN, peer: env.DEMO_PEER_CONTROL_TOKEN, reviewer: env.REVIEWER_CONTROL_TOKEN, judge: env.JUDGE_TOKEN};
  const owner = await readOwnerSession(env.SESSION_SECRET ?? '', cookieValue(request.headers.get('cookie'), OWNER_COOKIE), tokens);
  const ownerCfg: OwnerConfig = {secret: env.SESSION_SECRET ?? '', tokens, origins: ownerOrigins(env.PUBLIC_ORIGIN, env.ALLOWED_HOSTS), rateLimit: env.BURST ? async key => (await env.BURST!.limit({key})).success : undefined, clientKey: url.pathname === '/api/owner/session' ? await hashIp(env.SESSION_SECRET ?? 'unset', ip) : undefined};
  const realOwner = owner?.principal === 'owner';
  // Anything decided by the owner cookie is an owner write: it must come from one of our origins (CSRF). The judge path keeps its rules.
  const ownerWrite = realOwner && originAllowed(request, ownerCfg.origins);

  if (url.pathname === '/api/status' && request.method === 'GET') {
    const budget = await world(env).status();
    return json({
      model: {id: env.MODEL_ID, connected: !!env.MODEL_API_KEY, live: !!env.MODEL_API_KEY && (budget.residentBudget?.interactive.availableUsd ?? budget.remainingUsd) > 0},
      budget,
      turnstile: {sitekey: env.TURNSTILE_SITEKEY, configured: !!env.TURNSTILE_SECRET},
      session: session ? {tier: session.tier, expiresAt: session.exp, quota: await world(env).quota(session.sid, session.tier)} : null,
      owner: owner ? {principal: owner.principal, expiresAt: owner.exp} : null,
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

  // Welcome ritual (6.4): the server picks the three steps; the client never chooses them.
  if (url.pathname === '/api/ritual/start' && request.method === 'POST') {
    if (!session) return json({error: 'session_required'}, 401);
    if (env.BURST && !(await env.BURST.limit({key: 'ritual:' + session.sid})).success) return json({error: 'slow_down'}, 429);
    const started = await world(env).ritualStart(session.sid);
    return started ? json(started) : json({error: 'too_many_open_rituals', detail: 'Finish or let an open ritual expire (3 minutes) first.'}, 429);
  }
  if (url.pathname === '/api/ritual/record' && request.method === 'GET') return json({record: await world(env).ritualOwnerRecord()});

  if (url.pathname === '/api/muse' && request.method === 'POST') {
    let body: any;
    try { body = await readJson(request, 1_300_000); } catch { return json({error: 'bad_request'}, 400); }
    const stub = world(env);
    const isRitual = body?.action === 'challenge';
    if (isRitual) {
      if (!session) return json({error: 'session_required'}, 401);
      const steps = await stub.ritualTake(String(body?.input?.challengeId ?? ''), session.sid);
      if (!steps) return json({error: 'ritual_expired_or_used'}, 400);
      body = {action: 'challenge', input: {steps, frames: body?.input?.frames}};
    }
    const res = await handleMuse(body, session, await hashIp(env.SESSION_SECRET ?? 'unset', ip), {
      ledger: {reserve: r => stub.reserve(r), settle: (id, cost, outcome) => stub.settle(id, cost, outcome)},
      model: {base: env.MODEL_BASE, key: env.MODEL_API_KEY, model: env.MODEL_ID, timeoutMs: MODEL_TIMEOUT_MS},
      burst: env.BURST ? async key => (await env.BURST!.limit({key})).success : undefined,
    });
    if (!isRitual || !session) return res;
    const out = await res.clone().json().catch(() => null) as any;
    const results = Array.isArray(out?.output?.results) ? out.output.results.map((r: any) => ({step: String(r.step).slice(0, 40), passed: r.passed === true, confidence: Number(r.confidence) || 0})) : [];
    if (out && results.length === 3) await stub.ritualRecord({at: Date.now(), passed: out.source === 'live' && results.every((r: any) => r.passed), results, requestId: out.evidence?.requestId ?? null, model: out.evidence?.model ?? null, tier: ownerWrite ? 'owner' : session.tier}, session.sid.slice(0, 6), ownerWrite);
    return res;
  }

  // Shared world (direction v2, 8): read-only views for every visitor.
  if (url.pathname === '/api/world' && request.method === 'GET') return json(await world(env).worldView());
  if (url.pathname === '/api/world/life' && request.method === 'GET') {const view=await world(env).worldLifeView();return view?json(view):json({error:'not_found'},404);}
  if (url.pathname === '/api/world/events' && request.method === 'GET') return json(await world(env).worldEvents(Number(url.searchParams.get('since')) || 0, Number(url.searchParams.get('limit')) || 200, {runId: url.searchParams.get('runId') ?? undefined, day: url.searchParams.get('day') ?? undefined, tail: Number(url.searchParams.get('tail')) || undefined}));
  // Visitor priority (8.2): a session asks for a Muse's next spotlight turn, ahead of the rotation (3 per hour for visitors).
  if (url.pathname === '/api/world/spotlight' && request.method === 'POST') {
    if (!session) return json({error: 'session_required'}, 401);
    if (env.BURST && !(await env.BURST.limit({key: 'spotlight:' + session.sid})).success) return json({error: 'slow_down'}, 429);
    let body: {muse?: unknown};
    try { body = await readJson(request, 1024); } catch { return json({error: 'bad_request'}, 400); }
    if (typeof body.muse !== 'string' || !HARNESS_IDS.includes(body.muse)) return json({error: 'unknown_muse'}, 400);
    // The public event carries an opaque requester id, never the session id.
    const requester = (await hashIp(env.SESSION_SECRET ?? 'unset', 'spotlight:' + session.sid)).slice(0, 16);
    const r = await world(env).requestSpotlight(body.muse, session.tier, requester);
    if (r.ok) return json({queued: true, muse: r.muse, position: r.position, already: r.already});
    return json({error: r.reason}, r.reason === 'paused' || r.reason === 'self_directed' ? 409 : r.reason === 'model_unavailable' ? 503 : r.reason === 'unknown_muse' ? 400 : 429);
  }
  // Highlights, one page at a time: `before` (cursor: the seq of the last row of the previous page) and the period `from`/`to` (ms).
  // A value that is not a non-negative integer, or from >= to, is a 400 (never silently ignored).
  if (url.pathname === '/api/world/highlights' && request.method === 'GET') {
    const q = msParams(url, ['before', 'from', 'to']);
    if (!q) return json({error: 'bad_query', detail: 'before, from and to are non-negative integers (ms; before is a seq)'}, 400);
    if (q.from !== null && q.to !== null && q.to <= q.from) return json({error: 'bad_period', detail: 'to must be after from'}, 400);
    return json(await world(env).worldHighlights(Number(url.searchParams.get('limit')) || 100, q));
  }
  // Run log reads (8.6, C08, C09): public, so each answer is cached for 30 seconds (one DO read per URL per edge) and a
  // client past the burst limit gets a 429 on a cache miss.
  if (RUN_LOG_PATHS.has(url.pathname) && request.method === 'GET') return cachedRead(request, env, ip, () => runLogRead(env, url));

  // Identity (direction v2, 6): signed A2A Agent Cards and the P0 / demo checks.
  const candidateCard = /^\/api\/agents\/([^/]+)\/card$/.exec(url.pathname);
  const cardMatch=candidateCard && (/^(0\d-[a-z]+|pm_[a-f0-9-]{36})$/.test(candidateCard[1])||isInstalledResidentId(candidateCard[1]))?candidateCard:null;
  if (cardMatch && request.method === 'GET') { const card = await world(env).agentCard(cardMatch[1]); return card ? json(card) : json({error: 'unknown_agent'}, 404); }
  // P0 demonstration (judge link or the owner). It never revokes or delegates: those are the owner's own actions.
  if (url.pathname === '/api/p0/run' && request.method === 'POST') {
    if (session?.tier !== 'judge') {
      if (!realOwner) return json({error: 'judge_session_required'}, 403);
      if (!ownerWrite) return json({error: 'origin_not_allowed'}, 403);
    }
    return json(await world(env).p0(session?.tier === 'judge' ? 'judge' : 'owner'));
  }
  const demo = /^\/api\/demo\/(impostor|injection)$/.exec(url.pathname);
  if (demo && request.method === 'POST') {
    if (!session) return json({error: 'session_required'}, 401);
    if (env.BURST && !(await env.BURST.limit({key: 'demo:' + session.sid})).success) return json({error: 'slow_down'}, 429);
    const muses = ['01-sunny', '02-moss', '03-ripple', '04-ember', '05-bloom', '06-ink', '07-tempo', '08-orbit', '09-copper'];
    const pick = muses[Math.floor(Math.random() * muses.length)];
    const events = demo[1] === 'impostor' ? await world(env).impostor(pick) : await world(env).injection(muses[(muses.indexOf(pick) + 3) % muses.length], pick, Math.floor(Math.random() * 3));
    return json({events});
  }

  // Connected Muse (direction v2, 7.2, 12.3, 13.1): owner location, agent keys, owner notifications.
  const connected = await connectedRoutes(request, url, {owner}, world(env), ownerCfg);
  if (connected) return connected;

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

  // Owner-direct claim (visual check only): the real owner's session, from our origin. A visitor cannot write the claim record.
  if (url.pathname === '/api/claim/permalink' && request.method === 'POST') {
    const gate = requireOwner(request, {owner}, ownerCfg, {write: true, muse: OWNER_SLOT});
    if (gate instanceof Response) return gate;
    let body: {permalink?: string};
    try { body = await readJson(request, 2048); } catch { return json({error: 'bad_request'}, 400); }
    const record = ownerDirectRecord(ownerClaim.agent, ownerClaim.handle, ownerClaim.fingerprint_display, body.permalink ?? '');
    if (!record) return json({error: 'not_a_post_by_owner'}, 400);
    return json({record: await world(env).setClaim(ownerClaim.agent, record)});
  }

  return json({error: 'not_found'}, 404);
}

/** Non-negative integer query parameters (milliseconds or a cursor); absent ones are null, any invalid one makes it null. */
function msParams<K extends string>(url: URL, names: K[]): Record<K, number | null> | null {
  const out = {} as Record<K, number | null>;
  for (const k of names) {
    const v = url.searchParams.get(k);
    if (v === null || v === '') { out[k] = null; continue; }
    const n = Number(v);
    if (!/^\d+$/.test(v) || !Number.isSafeInteger(n)) return null;
    out[k] = n;
  }
  return out;
}

const RUN_LOG_PATHS = new Set(['/api/world/run', '/api/world/run/inputs', '/api/world/event', '/api/world/autonomy']);
export const RUN_LOG_CACHE_SECONDS = 30;
/** The answer of one run-log read (no cache or limit here). */
async function runLogRead(env: Env, url: URL): Promise<Response> {
  if (url.pathname === '/api/world/run') {
    const r = await world(env).worldRun(url.searchParams.get('runId'), url.searchParams.get('snapshot') === '1');
    return r ? json(r) : json({error: 'unknown_run'}, 404);
  }
  if (url.pathname === '/api/world/run/inputs') {
    const q = msParams(url, ['since', 'limit']);
    if (!q) return json({error: 'bad_query'}, 400);
    const runId = url.searchParams.get('runId') ?? '';
    const rows = runId ? await world(env).worldRunInputs(runId, q.since ?? 0, q.limit ?? 200) : null;
    return rows ? json(rows) : json({error: 'unknown_run'}, 404);
  }
  if (url.pathname === '/api/world/event') {
    const r = await world(env).worldEvent((url.searchParams.get('id') ?? '').slice(0, 200));
    return r ? json(r) : json({error: 'unknown_event'}, 404);
  }
  // C09 server recount over a period (`from`/`to` ms; default the last 24 hours) or one world `day`. The DO limits the
  // period to 48 hours and the sample to 20,000 events and answers `partial: true` beyond either.
  const day = url.searchParams.get('day');
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({error: 'bad_day'}, 400);
  const q = msParams(url, ['from', 'to']);
  if (!q) return json({error: 'bad_query', detail: 'from and to are non-negative integers (ms)'}, 400);
  if (q.from !== null && q.to !== null && q.to <= q.from) return json({error: 'bad_period', detail: 'to must be after from'}, 400);
  const now = Date.now();
  const from = q.from ?? (day ? null : (q.to ?? now) - 86_400_000), to = q.to ?? (day ? null : now);
  return json(await world(env).worldAutonomy({from, to, day, runId: url.searchParams.get('runId')}));
}
/** A 30-second public cache in front of a run-log read (Cache API when the runtime has one), and the burst limit on a miss. */
async function cachedRead(request: Request, env: Env, ip: string, read: () => Promise<Response>): Promise<Response> {
  const cache = typeof caches !== 'undefined' ? (caches as unknown as {default?: Cache}).default : undefined;
  const key = new Request(request.url, {method: 'GET'});
  const hit = cache ? await cache.match(key) : undefined;
  // The zone's browser cache TTL is applied to stored copies (a HIT came back with max-age=14400): answer a hit with
  // the run-log TTL again, so browsers never keep a run summary longer than RUN_LOG_CACHE_SECONDS.
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('cache-control', `public, max-age=${RUN_LOG_CACHE_SECONDS}`);
    return new Response(hit.body, {status: hit.status, headers});
  }
  if (env.BURST && !(await env.BURST.limit({key: 'runlog:' + ip})).success) return json({error: 'slow_down'}, 429);
  const r = await read();
  if (r.status !== 200) return r;
  const out = new Response(r.body, {status: 200, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${RUN_LOG_CACHE_SECONDS}`}});
  if (cache) await cache.put(key, out.clone());
  return out;
}

function threadsConfig(env: Env, url: URL): ThreadsConfig | null {
  if (!env.THREADS_APP_ID || !env.THREADS_APP_SECRET) return null;
  return {appId: env.THREADS_APP_ID, appSecret: env.THREADS_APP_SECRET, redirectUri: `${url.origin}/api/threads/callback`};
}
const redirectHome = (query: string) => new Response(null, {status: 302, headers: {location: '/?' + query, 'set-cookie': 'musely_ts=; Path=/api/threads; Max-Age=0; HttpOnly; Secure; SameSite=Lax', 'cache-control': 'no-store'}});

/** Requests to any other allowed host (www) go to the canonical origin; 308 keeps POST bodies for MCP clients. */
export function canonicalRedirect(url: URL, publicOrigin: string): Response | null {
  const canonical = new URL(publicOrigin);
  if (url.host === canonical.host) return null;
  return new Response(null, {status: 308, headers: {location: canonical.origin + url.pathname + url.search, 'cache-control': 'public, max-age=3600'}});
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const moved = canonicalRedirect(url, env.PUBLIC_ORIGIN);
    if (moved) return moved;
    const jwks = /^\/\.well-known\/jwks\/([A-Za-z0-9_-]{20,64})\.json$/.exec(url.pathname);
    if (jwks) { const set = await world(env).jwks(jwks[1]); return set ? json(set, 200, {'cache-control': 'public, max-age=300'}) : json({error: 'unknown_key'}, 404); }
    // Musely MCP server (Streamable HTTP: 2026-07-28, and 2025-11-25/2025-06-18/2025-03-26 with initialize) for custom connectors; auth is a Musely agent key.
    if (url.pathname === '/mcp') {
      try {
        return await handleMcpHttp(request, world(env), {allowedHosts: [...env.ALLOWED_HOSTS.split(','), ...(env.MCP_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)], rateLimit: env.BURST ? async key => (await env.BURST!.limit({key})).success : undefined});
      } catch (e) {
        console.error('mcp error', e);
        return json({jsonrpc: '2.0', id: null, error: {code: -32603, message: 'Internal error'}}, 500);
      }
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (e) {
        console.error('api error', e);
        return json({error: 'internal'}, 500);
      }
    }
    return serveCriticalAsset(request, env.ASSETS);
  },
} satisfies ExportedHandler<Env>;
