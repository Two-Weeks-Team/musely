// Personal authentication route adapter only. A valid login never creates an actor or inherits legacy owner powers.
import {originAllowed} from './owner-session.ts';
import type {PersonalBinding} from './personal-registration.ts';
import type {ActorProfile} from '../../src/identity/participant.ts';
import {personalAuthorizeUrl, personalThreadsIdentity, type PersonalThreadsConfig} from './threads.ts';
import {
  PERSONAL_COOKIE, PERSONAL_FLOW_COOKIE, PERSONAL_CALLBACK, PERSONAL_STATE_PREFIX, PERSONAL_FLOW_TTL_MS,
  personalNonce, personalDigest, personalCookieValue, personalCookie, clearPersonalCookie, flowCookie, clearFlowCookie,
  readPersonalProof, signPersonalSession, type PersonalFlow, type PersonalSessionRow, type PersonalProof,
} from './personal-session.ts';

type MaybePromise<T> = T | Promise<T>;
export interface PersonalAuthStub {
  personalDraftRegister(binding: PersonalBinding, input: unknown): MaybePromise<ActorProfile>;
  personalProfileRead(binding: PersonalBinding): MaybePromise<ActorProfile | null>;
  personalProfilePatch(binding: PersonalBinding, input: unknown): MaybePromise<ActorProfile>;
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
// An incoming empty HTTP write can have a non-null, already closed body stream.
async function emptyWriteBody(request: Request): Promise<boolean> {
  if (!request.body) return true;
  const reader = request.body.getReader(); let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body_deadline')), 1000); });
  try {
    for (let i = 0; i < 8; i++) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) return true;
      if (part.value.byteLength) return false;
    }
    return false;
  } catch { return false; } finally { if (timer !== undefined) clearTimeout(timer); void reader.cancel().catch(() => {}); }
}
export async function personalRoutes(request: Request, url: URL, cfg: PersonalConfig, stub: PersonalAuthStub): Promise<Response> {
  try {
    const now = cfg.now ?? Date.now;
    const routes = new Map([[START, 'POST'], [PERSONAL_CALLBACK, 'GET'], [BASE + '/me', 'GET'], [BASE + '/session', 'DELETE'], [BASE + '/draft', 'POST'], [BASE + '/profile', request.method === 'PATCH' ? 'PATCH' : 'GET']]);
    const method = routes.get(url.pathname);
    if (!method) return failure('not_found', 404);
    if (request.method !== method) { const r = failure('method_not_allowed', 405); r.headers.set('allow', url.pathname === BASE + '/profile' ? 'GET, PATCH' : method); return r; }
    if (method !== 'GET' && !originAllowed(request, [cfg.origin])) return failure('origin_not_allowed', 403);
    const profileWrite = url.pathname === BASE + '/draft' || (url.pathname === BASE + '/profile' && request.method === 'PATCH');
    if (method !== 'GET' && !profileWrite && !await emptyWriteBody(request)) return failure('body_not_allowed', 400);
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
    if (url.pathname === BASE + '/draft' || url.pathname === BASE + '/profile') {
      if (!sessionReady) return failure('registration_unavailable', 503);
      const p = await current();
      if (!p) return failure('personal_session_required', 401);
      const binding: PersonalBinding = {sidDigest: await personalDigest('sid', p.sid), appId: cfg.appId!, proof: {principalId: p.principalId, authVersion: p.authVersion, issuedAt: p.issuedAt, expiresAt: p.expiresAt}};
      let input: unknown;
      if (profileWrite) {
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !request.body) return failure('invalid_registration', 400);
        const reader = request.body.getReader(), bytes: number[] = []; let complete = false;
        try {
          for (;;) { const part = await reader.read(); if (part.done) { complete = true; break; } if (bytes.length + part.value.length > 4096) return failure('invalid_registration', 400); for (const b of part.value) bytes.push(b); }
          input = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(new Uint8Array(bytes)));
        } catch { return failure('invalid_registration', 400); } finally { if (!complete) void reader.cancel().catch(() => {}); }
      }
      try {
        const profile = url.pathname === BASE + '/draft' ? await stub.personalDraftRegister(binding, input) : profileWrite ? await stub.personalProfilePatch(binding, input) : await stub.personalProfileRead(binding);
        return json({profile, entry: {state: profile ? 'registered' : 'viewing'}});
      } catch (e) {
        // RPC preserves serializable name/code, not a custom Error's prototype (compat >=2026-04-21).
        const code = e && typeof e === 'object' && 'name' in e && e.name === 'PersonalRegistryError' && 'code' in e && typeof e.code === 'string' ? e.code : null;
        if (code === 'personal_session_required') return failure(code, 401);
        if (code === 'invalid_registration') return failure(code, 400);
        if (code && ['operation_conflict', 'actor_exists', 'binding_conflict', 'draft_required', 'revision_conflict'].includes(code)) return failure(code, 409);
        return failure('registration_unavailable', 503);
      }
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
