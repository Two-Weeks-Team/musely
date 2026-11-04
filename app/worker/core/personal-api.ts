// Personal authentication route adapter only. A valid login never creates an actor or inherits legacy owner powers.
import {originAllowed,OWNER_COOKIE} from './owner-session.ts';
import type {DecisionOutcome} from './tasks.ts';
import type {PersonalBinding} from './personal-registration.ts';
import type {ActorProfile} from '../../src/identity/participant.ts';
import {isSocialMode} from '../../src/engine/social-status.ts';
import {personalAuthorizeUrl, personalThreadsIdentity, type PersonalThreadsConfig} from './threads.ts';
import {
  PERSONAL_CLAIM_FLOW_COOKIE,PERSONAL_CLAIM_STATE_PREFIX,claimFlowCookie,clearClaimFlowCookie,
  PERSONAL_COOKIE, PERSONAL_FLOW_COOKIE, PERSONAL_CALLBACK, PERSONAL_STATE_PREFIX, PERSONAL_FLOW_TTL_MS,
  personalNonce, personalDigest, personalCookieValue, personalCookie, clearPersonalCookie, flowCookie, clearFlowCookie,
  readPersonalProof, signPersonalSession, type PersonalFlow, type PersonalSessionRow, type PersonalProof,
} from './personal-session.ts';

type MaybePromise<T> = T | Promise<T>;
export interface PersonalAuthStub {
  personalSocialStatusGet?(binding:PersonalBinding):MaybePromise<unknown>;
  personalSocialStatusSet?(binding:PersonalBinding,input:unknown):MaybePromise<unknown>;
  personalLegacyView(binding:PersonalBinding,ownerCookie:string|null):MaybePromise<unknown>;
  personalLegacyAdopt(binding:PersonalBinding,ownerCookie:string|null,input:unknown):MaybePromise<unknown>;
  personalLegacyInbox(binding:PersonalBinding):MaybePromise<unknown>;
  personalLegacyApprove(binding:PersonalBinding,input:unknown):MaybePromise<DecisionOutcome>;
  personalClaimRead(binding:PersonalBinding):MaybePromise<unknown>;
  personalClaimRevoke(binding:PersonalBinding,input:unknown):MaybePromise<unknown>;
  personalClaimBegin(binding:PersonalBinding,input:unknown,flow:PersonalFlow):MaybePromise<boolean>;
  personalClaimComplete(binding:Pick<PersonalFlow,'stateDigest'|'browserDigest'|'appId'|'redirectUri'>,code:string|null):MaybePromise<string>;
  personalLocation(binding:PersonalBinding):MaybePromise<unknown>;
  personalLocationSet(binding:PersonalBinding,input:unknown):MaybePromise<unknown>;
  personalStatus(binding: PersonalBinding | null): MaybePromise<unknown>;
  personalAuthorityOwn(binding: PersonalBinding): MaybePromise<unknown>;
  personalAuthorityGrant(binding: PersonalBinding,input: unknown): MaybePromise<unknown>;
  personalAuthorityRevoke(binding: PersonalBinding,input: unknown): MaybePromise<unknown>;
  personalKeyIssue(binding: PersonalBinding,input: unknown): MaybePromise<unknown>;
  personalKeys(binding: PersonalBinding): MaybePromise<unknown>;
  personalKeyRevoke(binding: PersonalBinding,id:string): MaybePromise<unknown>;
  personalAttemptCreate(binding: PersonalBinding,input:unknown): MaybePromise<unknown>;
  personalAttemptRead(binding: PersonalBinding,id:string): MaybePromise<unknown>;
  personalAttemptCancel(binding: PersonalBinding,id:string): MaybePromise<unknown>;
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
export const isPersonalCallback = (url: URL) => url.pathname === PERSONAL_CALLBACK && url.searchParams.getAll('state').some(s => (s.startsWith(PERSONAL_STATE_PREFIX)||s.startsWith(PERSONAL_CLAIM_STATE_PREFIX)));
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
const bootstrapMethods = (path:string):string[]|null => path===BASE+'/social-status'?['GET','PATCH']:path===BASE+'/claim'?['GET','DELETE']:path===BASE+'/claim/start'?['POST']:path===BASE+'/location'?['GET','POST']:path===BASE+'/status'?['GET']:path===BASE+'/authority'?['GET','POST','DELETE']:path===BASE+'/keys'?['GET','POST']:/^\/api\/personal\/keys\/pak_[a-f0-9-]{36}$/.test(path)?['DELETE']:path===BASE+'/entry-attempts'?['POST']:/^\/api\/personal\/entry-attempts\/pea_[a-f0-9-]{36}$/.test(path)?['GET','DELETE']:null;
async function bootstrapJSON(request:Request,limit=4096):Promise<unknown>{
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')||!request.body)throw Error('invalid_entry');
 const reader=request.body.getReader(),parts:number[]=[];let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('invalid_entry')),1000);});
 try{let reads=0;for(;;){if(++reads>limit+1)throw Error('invalid_entry');const p=await Promise.race([reader.read(),timeout]);if(p.done)break;if(parts.length+p.value.length>limit)throw Error('invalid_entry');for(const b of p.value)parts.push(b);}return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(new Uint8Array(parts)));}finally{if(timer!==undefined)clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
export async function personalRoutes(request: Request, url: URL, cfg: PersonalConfig, stub: PersonalAuthStub): Promise<Response> {
  try {
    const now = cfg.now ?? Date.now;
    const routes = new Map([[START, 'POST'], [PERSONAL_CALLBACK, 'GET'], [BASE + '/me', 'GET'], [BASE + '/session', 'DELETE'], [BASE + '/draft', 'POST'], [BASE + '/profile', request.method === 'PATCH' ? 'PATCH' : 'GET']]);
    const bootstrap=url.pathname===BASE+'/legacy-muse'?['GET','POST']:url.pathname===BASE+'/inbox'?['GET']:url.pathname===BASE+'/approvals'?['POST']:bootstrapMethods(url.pathname);
    const method = routes.get(url.pathname)??(bootstrap?.includes(request.method)?request.method:bootstrap?.[0]);
    if (!method) return failure('not_found', 404);
    if (request.method !== method) { const r = failure('method_not_allowed', 405); r.headers.set('allow', bootstrap?bootstrap.join(', '):url.pathname === BASE + '/profile' ? 'GET, PATCH' : method); return r; }
    if (method !== 'GET' && !originAllowed(request, [cfg.origin])) return failure('origin_not_allowed', 403);
    const profileWrite = url.pathname === BASE + '/draft' || (url.pathname === BASE + '/profile' && request.method === 'PATCH');
    const bootstrapWrite=!!bootstrap&&(request.method==='POST'||url.pathname===BASE+'/social-status'&&request.method==='PATCH'||([BASE+'/authority',BASE+'/claim'].includes(url.pathname)&&request.method==='DELETE'));
    if (method !== 'GET' && !profileWrite && !bootstrapWrite && !await emptyWriteBody(request)) return failure('body_not_allowed', 400);
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
    if(bootstrap){
      const p=await current();
      if(!p){if(url.pathname===BASE+'/status')return json({profile:null,authority:null,keys:[],connection:{connected:false,lastSeenAt:null},entry:{state:'viewing',actor:null,attempt:null,receipt:null,reason:'signed_out'}});return failure('personal_session_required',401);}
      const binding:PersonalBinding={sidDigest:await personalDigest('sid',p.sid),appId:cfg.appId!,proof:{principalId:p.principalId,authVersion:p.authVersion,issuedAt:p.issuedAt,expiresAt:p.expiresAt}};
      const social=url.pathname===BASE+'/social-status';
      let input:unknown;if(bootstrapWrite){try{input=await bootstrapJSON(request,social?512:4096);}catch{return failure(social?'invalid_social_status':'invalid_entry',400);}}
      if(social){
       if(request.method==='PATCH'){
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='expectedRevision,mode')return failure('invalid_social_status',400);
        const x=input as {mode:unknown;expectedRevision:unknown};if(!isSocialMode(x.mode)||typeof x.expectedRevision!=='number'||!Number.isSafeInteger(x.expectedRevision)||x.expectedRevision<0||x.expectedRevision>=Number.MAX_SAFE_INTEGER)return failure('invalid_social_status',400);
       }
       try{
        if(request.method==='GET'){if(!stub.personalSocialStatusGet)return failure('social_status_unavailable',503);return json(await stub.personalSocialStatusGet(binding));}
        if(!stub.personalSocialStatusSet)return failure('social_status_unavailable',503);return json(await stub.personalSocialStatusSet(binding,input));
       }catch(e){
        let name:unknown,code:unknown;try{if(e&&typeof e==='object'){name='name'in e?e.name:null;code='code'in e?e.code:null;}}catch{}
        if(name==='PersonalRegistryError'&&code==='personal_session_required')return failure('personal_session_required',401);
        if(name==='SocialStatusError'&&code==='social_status_forbidden')return failure('social_status_forbidden',403);
        if(name==='SocialStatusError'&&code==='invalid_social_status')return failure('invalid_social_status',400);
        if(name==='SocialStatusError'&&code==='social_status_conflict')return failure('social_status_conflict',409);
        return failure('social_status_unavailable',503);
       }
      }
      try{
       if(url.pathname===BASE+'/legacy-muse'){const ownerCookie=personalCookieValue(request,OWNER_COOKIE);return json(request.method==='GET'?await stub.personalLegacyView(binding,ownerCookie):await stub.personalLegacyAdopt(binding,ownerCookie,input));}
       if(url.pathname===BASE+'/inbox')return json(await stub.personalLegacyInbox(binding));
       if(url.pathname===BASE+'/approvals'){const r=await stub.personalLegacyApprove(binding,input);return r.ok?json({ok:true,decision:(input as {decision:string}).decision,duplicate:r.duplicate,confirmed:r.confirmed,task:r.task}):json({error:r.code,retryable:r.retryable,...(r.extra??{})},r.status);}
       if(url.pathname===BASE+'/claim')return json(request.method==='GET'?await stub.personalClaimRead(binding):await stub.personalClaimRevoke(binding,input));
       if(url.pathname===BASE+'/claim/start'){
        if(!ready)return failure('personal_auth_not_configured',503);
        if(cfg.rateLimit&&!await cfg.rateLimit())return failure('slow_down',429);
        const state=PERSONAL_CLAIM_STATE_PREFIX+personalNonce(),verifier=personalNonce(),createdAt=now();
        const flow={stateDigest:await personalDigest('state',state),browserDigest:await personalDigest('browser',verifier),appId:cfg.appId!,redirectUri:providerCfg().redirectUri,createdAt,expiresAt:createdAt+PERSONAL_FLOW_TTL_MS};
        if(!await stub.personalClaimBegin(binding,input,flow))return failure('auth_flow_unavailable',429);
        return json({authorizationUrl:personalAuthorizeUrl(providerCfg(),state)},200,claimFlowCookie(verifier));
       }
       if(url.pathname===BASE+'/location')return json(request.method==='GET'?await stub.personalLocation(binding):await stub.personalLocationSet(binding,input));
       if(url.pathname===BASE+'/status')return json(await stub.personalStatus(binding));
       if(url.pathname===BASE+'/authority'){const authority=request.method==='GET'?await stub.personalAuthorityOwn(binding):request.method==='POST'?await stub.personalAuthorityGrant(binding,input):await stub.personalAuthorityRevoke(binding,input);return json({authority});}
       if(url.pathname===BASE+'/keys')return request.method==='GET'?json({keys:await stub.personalKeys(binding)}):json(await stub.personalKeyIssue(binding,input));
       if(url.pathname.startsWith(BASE+'/keys/'))return json({key:await stub.personalKeyRevoke(binding,url.pathname.split('/').at(-1)!)});
       const result=url.pathname===BASE+'/entry-attempts'?await stub.personalAttemptCreate(binding,input):request.method==='GET'?await stub.personalAttemptRead(binding,url.pathname.split('/').at(-1)!):await stub.personalAttemptCancel(binding,url.pathname.split('/').at(-1)!);
       return json(result);
      }catch(e){const code=e&&typeof e==='object'&&'name'in e&&typeof e.name==='string'&&['PersonalRegistryError','PersonalAdoptionError','PersonalLegacyError','LegacyProfileError'].includes(e.name)&&'code'in e&&typeof e.code==='string'?e.code:null;
       if(code==='personal_session_required')return failure(code,401);
       if(code==='owner_session_required'||code==='not_your_muse'||code==='adoption_required')return failure(code,403);
       if(code&&['invalid_adoption','invalid_approval','invalid_profile'].includes(code))return failure(code,400);
       if(code&&['adoption_conflict','adoption_changed','profile_conflict'].includes(code))return failure(code,409);
       if(code&&['invalid_authority','invalid_entry','invalid_registration','invalid_location','invalid_claim'].includes(code))return failure(code,400);
       if(code&&['key_not_found','entry_attempt_not_found'].includes(code))return failure(code,404);
       if(code&&['claim_changed','claim_binding_invalid','authority_conflict','authority_changed','authority_required','operation_conflict','entry_key_invalid','entry_version_conflict','entry_profile_conflict','entry_world_conflict','entry_paused','entry_already_activated','draft_required'].includes(code))return failure(code,409);
       return failure('personal_entry_unavailable',503);
      }
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
        const code = e && typeof e === 'object' && 'name' in e && typeof e.name==='string' && ['PersonalRegistryError','PersonalAdoptionError','PersonalLegacyError','LegacyProfileError'].includes(e.name) && 'code' in e && typeof e.code === 'string' ? e.code : null;
        if (code === 'personal_session_required') return failure(code, 401);
        if (code === 'invalid_registration'||code==='invalid_profile') return failure(code, 400);
        if (code && ['operation_conflict', 'actor_exists', 'binding_conflict', 'draft_required', 'revision_conflict','adoption_conflict','adoption_changed','profile_conflict'].includes(code)) return failure(code, 409);
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
    if(q.getAll('state').some(x=>x.startsWith(PERSONAL_CLAIM_STATE_PREFIX))){
      const bad=()=>json({error:'auth_flow_invalid'},400,clearClaimFlowCookie);
      if([...q.keys()].some(k=>!['state','code','error','error_reason','error_description'].includes(k))||q.getAll('state').length!==1||q.getAll('code').length>1||q.getAll('error').length>1||(q.has('code')&&q.has('error')))return bad();
      const state=q.get('state'),verifier=personalCookieValue(request,PERSONAL_CLAIM_FLOW_COOKIE);
      if(!state?.startsWith(PERSONAL_CLAIM_STATE_PREFIX)||!nonceValid(state.slice(PERSONAL_CLAIM_STATE_PREFIX.length))||!nonceValid(verifier))return bad();
      const code=q.has('error')?null:q.get('code');
      if(!q.has('error')&&(!code||code.length>4096||/[\u0000-\u001f\u007f]/.test(code)))return bad();
      const result=await stub.personalClaimComplete({stateDigest:await personalDigest('state',state),browserDigest:await personalDigest('browser',verifier),appId:cfg.appId!,redirectUri:providerCfg().redirectUri},code);
      if(result==='invalid')return bad();
      const safe=['claimed','declined','not_found','failed'].includes(result)?result:'failed',h=headers();h.set('location','/?personalClaim='+safe);h.append('set-cookie',clearClaimFlowCookie);return new Response(null,{status:303,headers:h});
    }

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
