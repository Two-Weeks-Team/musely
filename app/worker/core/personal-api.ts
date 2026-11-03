// Personal authentication route adapter only. A valid login never creates an actor or inherits legacy owner powers.
import {originAllowed} from './owner-session.ts';
import {personalAuthorizeUrl, personalThreadsIdentity, type PersonalThreadsConfig} from './threads.ts';
import {
  PERSONAL_COOKIE, PERSONAL_FLOW_COOKIE, PERSONAL_CALLBACK, PERSONAL_STATE_PREFIX, PERSONAL_FLOW_TTL_MS,
  personalNonce, personalDigest, personalCookieValue, personalCookie, clearPersonalCookie, flowCookie, clearFlowCookie,
  readPersonalProof, signPersonalSession, type PersonalFlow, type PersonalSessionRow, type PersonalProof,
} from './personal-session.ts';

type MaybePromise<T> = T | Promise<T>;
export interface PersonalAuthStub {
  personalAuthBegin(flow: PersonalFlow): MaybePromise<boolean>;
  personalAuthConsume(binding: Pick<PersonalFlow, 'stateDigest' | 'browserDigest' | 'appId' | 'redirectUri'>, now: number): MaybePromise<boolean>;
  personalAuthComplete(stateDigest: string, appId: string, subject: string, sidDigest: string, now: number): MaybePromise<PersonalSessionRow | null>;
  personalAuthActive(sidDigest: string, proof: PersonalSessionRow, appId: string, now: number): MaybePromise<boolean>;
  personalAuthRevoke(sidDigest: string, proof: PersonalSessionRow, appId: string, now: number): MaybePromise<boolean>;
}
export type PersonalConfig = {secret: string; origin: string; appId?: string; appSecret?: string; rateLimit?: () => Promise<boolean>; fetcher?: typeof fetch; now?: () => number};
const BASE = '/api/personal';
const START = BASE + '/auth/threads/start';
const VIEWING = {entry: {state: 'viewing'}};
const headers = () => new Headers({'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-type': 'application/json; charset=utf-8'});
const json = (value: unknown, status = 200, cookie?: string) => { const h = headers(); if (cookie) h.append('set-cookie', cookie); return new Response(JSON.stringify(value), {status, headers: h}); };
const failure = (error: string, status: number, clearFlow = false) => json({error}, status, clearFlow ? clearFlowCookie : undefined);
function redirect(result: 'authenticated' | 'failed' | 'declined', session?: string) {
  const h = headers(); h.set('location', '/?personal=' + result); h.append('set-cookie', clearFlowCookie);
  if (session) h.append('set-cookie', personalCookie(session));
  return new Response(null, {status: 303, headers: h});
}
const nonceValid = (v: string | null): v is string => !!v && /^[A-Za-z0-9_-]{43}$/.test(v);
/** Cookie presence never selects the handler. Ambiguous mixed states are routed here and rejected. */
export const isPersonalCallback = (url: URL) => url.pathname === PERSONAL_CALLBACK && url.searchParams.getAll('state').some(s => s.startsWith(PERSONAL_STATE_PREFIX));
/** Every exception is reduced to a fixed category here, before the legacy API's general logging handler. */
export async function personalRoutes(request: Request, url: URL, cfg: PersonalConfig, stub: PersonalAuthStub): Promise<Response> {
  try {
    const now = cfg.now ?? Date.now;
    const routes = new Map([[START, 'POST'], [PERSONAL_CALLBACK, 'GET'], [BASE + '/me', 'GET'], [BASE + '/session', 'DELETE']]);
    const method = routes.get(url.pathname);
    if (!method) return failure('not_found', 404);
    if (request.method !== method) { const r = failure('method_not_allowed', 405); r.headers.set('allow', method); return r; }
    if (method !== 'GET' && !originAllowed(request, [cfg.origin])) return failure('origin_not_allowed', 403);
    if (method !== 'GET' && request.body) return failure('body_not_allowed', 400);
    if (url.pathname !== PERSONAL_CALLBACK && url.search) return failure('bad_query', 400);
    const sessionReady = !!cfg.secret && typeof cfg.appId === 'string' && /^[0-9]{1,32}$/.test(cfg.appId);
    const ready = sessionReady && !!cfg.appSecret;
    const providerCfg = (): PersonalThreadsConfig => ({appId: cfg.appId!, appSecret: cfg.appSecret!, redirectUri: cfg.origin + PERSONAL_CALLBACK, fetcher: cfg.fetcher});
    async function current(): Promise<PersonalProof | null> {
      if (!sessionReady) return null;
      const p = await readPersonalProof(cfg.secret, personalCookieValue(request, PERSONAL_COOKIE), now());
      if (!p || !await stub.personalAuthActive(await personalDigest('sid', p.sid), p, cfg.appId!, now())) return null;
      return p;
    }
    if (url.pathname === BASE + '/me') {
      const p = await current();
      return json(p ? {authenticated: true, expiresAt: p.expiresAt, ...VIEWING} : {authenticated: false, ...VIEWING});
    }
    if (url.pathname === BASE + '/session') {
      // Do not report a successful durable logout when local verification/binding config is unavailable.
      if (!sessionReady && personalCookieValue(request, PERSONAL_COOKIE)) return failure('personal_auth_unavailable', 503);
      const p = await current();
      if (p) await stub.personalAuthRevoke(await personalDigest('sid', p.sid), p, cfg.appId!, now());
      return json({authenticated: false, ...VIEWING}, 200, clearPersonalCookie);
    }
    if (!ready) return failure('personal_auth_not_configured', 503);
    if (url.pathname === START) {
      if (cfg.rateLimit && !await cfg.rateLimit()) return failure('slow_down', 429);
      const state = PERSONAL_STATE_PREFIX + personalNonce(), verifier = personalNonce(), createdAt = now();
      const flow = {stateDigest: await personalDigest('state', state), browserDigest: await personalDigest('browser', verifier), appId: cfg.appId!, redirectUri: providerCfg().redirectUri, createdAt, expiresAt: createdAt + PERSONAL_FLOW_TTL_MS};
      if (!await stub.personalAuthBegin(flow)) return failure('auth_flow_unavailable', 429);
      return json({authorizationUrl: personalAuthorizeUrl(providerCfg(), state)}, 200, flowCookie(verifier));
    }
    const q = url.searchParams;
    if ([...q.keys()].some(k => !['state', 'code', 'error', 'error_reason', 'error_description'].includes(k)) || q.getAll('state').length !== 1 || q.getAll('code').length > 1 || q.getAll('error').length > 1 || (q.has('code') && q.has('error'))) return failure('auth_flow_invalid', 400, true);
    const state = q.get('state'), verifier = personalCookieValue(request, PERSONAL_FLOW_COOKIE);
    if (!state?.startsWith(PERSONAL_STATE_PREFIX) || !nonceValid(state.slice(PERSONAL_STATE_PREFIX.length)) || !nonceValid(verifier)) return failure('auth_flow_invalid', 400, true);
    const stateDigest = await personalDigest('state', state);
    if (!await stub.personalAuthConsume({stateDigest, browserDigest: await personalDigest('browser', verifier), appId: cfg.appId!, redirectUri: providerCfg().redirectUri}, now())) return failure('auth_flow_invalid', 400, true);
    if (q.has('error')) return redirect('declined');
    const code = q.get('code');
    if (!code || code.length > 4096 || /[\u0000-\u001f\u007f]/.test(code)) return failure('auth_code_invalid', 400, true);
    try {
      const {subject} = await personalThreadsIdentity(providerCfg(), code);
      const sid = personalNonce(), row = await stub.personalAuthComplete(stateDigest, cfg.appId!, subject, await personalDigest('sid', sid), now());
      if (!row) return failure('auth_flow_invalid', 400, true);
      const token = await signPersonalSession(cfg.secret, {v: 1, sid, ...row}, now());
      return redirect('authenticated', token);
    } catch { return redirect('failed'); }
  } catch { return failure('personal_auth_unavailable', 503); }
}
