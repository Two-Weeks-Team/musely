// Personal browser authority for the one dual-proof legacy adoption. No owner cookie is issued.
import {connectedRoutes,type ConnectedStub} from './owner-api.ts';
import {originAllowed,type OwnerSession} from './owner-session.ts';
import {PERSONAL_COOKIE,personalCookieValue,readPersonalProof,personalDigest,clearPersonalCookie,type PersonalSessionRow} from './personal-session.ts';
import type {PersonalBinding} from './personal-registration.ts';
export type PersonalOwnerIdentity={session:OwnerSession;displayName:string};
type MaybePromise<T>=T|Promise<T>;
export interface PersonalOwnerStub {
 personalAuthActive(sid:string,proof:PersonalSessionRow,app:string,now:number):MaybePromise<boolean>;
 personalAuthRevoke(sid:string,proof:PersonalSessionRow,app:string,now:number):MaybePromise<boolean>;
 personalOwnerSession?(binding:PersonalBinding):MaybePromise<PersonalOwnerIdentity|null>;
 personalOwnerCall?(binding:PersonalBinding,operation:string,args:unknown[]):MaybePromise<unknown>;
}
export type PersonalOwnerConfig={secret:string;origin:string;appId?:string;now?:()=>number;ownerSpecial?:(request:Request,path:string,binding:PersonalBinding)=>Promise<Response>};
const BASE='/api/personal/owner';
const json=(body:unknown,status=200,cookie?:string)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(cookie?{'set-cookie':cookie}:{})}});
const methods=['ownerSocialStatusGet','ownerSocialStatusSet','legacyProfileGet','legacyProfilePatch','ownerLocation','setOwnerLocation','issueAgentKey','listAgentKeys','agentKeyMuse','revokeAgentKey','purgeAgentKey','resetMuse','ownerNotifications','ownerRevoke','ownerRedelegate','delegationStatus','taskParticipants','ownerApprove','ownerInbox'] as const;
export async function personalOwnerRoutes(request:Request,url:URL,cfg:PersonalOwnerConfig,stub:PersonalOwnerStub):Promise<Response>{
 try{
  const path=url.pathname.slice(BASE.length),now=cfg.now??Date.now;
  if(request.method!=='GET'&&!originAllowed(request,[cfg.origin]))return json({error:'origin_not_allowed'},403);
  if(path==='/session'&&!['GET','DELETE'].includes(request.method))return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json','cache-control':'no-store',allow:'GET, DELETE'}});
  const token=personalCookieValue(request,PERSONAL_COOKIE),ready=!!cfg.secret&&typeof cfg.appId==='string'&&/^\d{1,32}$/.test(cfg.appId);
  const proof=ready?await readPersonalProof(cfg.secret,token,now()):null;
  const binding:PersonalBinding|null=proof?{sidDigest:await personalDigest('sid',proof.sid),appId:cfg.appId!,proof:{principalId:proof.principalId,authVersion:proof.authVersion,issuedAt:proof.issuedAt,expiresAt:proof.expiresAt}}:null;
  const active=binding&&await stub.personalAuthActive(binding.sidDigest,binding.proof,binding.appId,now())?binding:null;
  if(path==='/session'&&request.method==='DELETE'){
   if(url.search)return json({error:'bad_query'},400);
   if(!ready&&token)return json({error:'personal_auth_unavailable'},503);
   if(request.body){const text=await request.text();if(text)return json({error:'body_not_allowed'},400);}
   if(active)await stub.personalAuthRevoke(active.sidDigest,active.proof,active.appId,now());
   return json({owner:null},200,clearPersonalCookie);
  }
  if(!active)return path==='/session'&&request.method==='GET'?json({owner:null}):json({error:'personal_session_required'},401);
  if(!stub.personalOwnerSession||!stub.personalOwnerCall)return json({error:'owner_unavailable'},503);
  const identity=await stub.personalOwnerSession(active);
  if(!identity)return path==='/session'&&request.method==='GET'?json({owner:null}):json({error:'adoption_required'},403);
  const special=['/p0/run','/claim/permalink','/ritual/start','/ritual/record','/muse','/status'].includes(path);
  let response:Response|null;
  if(special)response=cfg.ownerSpecial?await cfg.ownerSpecial(request,path,active):json({error:'owner_unavailable'},503);
  else{
    if(path==='/session'&&url.search)return json({error:'bad_query'},400);
    const target=path.startsWith('/agent-keys')?'/api'+path:'/api/owner'+path;
    const allowed=/^\/api\/owner\/(session|social-status|profile|revoke|redelegate|reset|approvals|inbox|location|notifications)$/.test(target)||/^\/api\/agent-keys(?:\/ak_[A-Za-z0-9_-]{6,20})?$/.test(target);
    if(!allowed)return json({error:'not_found'},404);
    const wrapped=Object.fromEntries(methods.map(operation=>[operation,(...args:unknown[])=>stub.personalOwnerCall!(active,operation,args)])) as unknown as ConnectedStub;
    const translated=new URL(url);translated.pathname=target;
    response=await connectedRoutes(request,translated,{owner:identity.session},wrapped,{secret:'',tokens:{},origins:[cfg.origin]});
  }
  // Both reused and special routes can await. The same final personal check prevents
  // stale owner responses and preserves 401 after legacy handlers catch service errors.
  if(!await stub.personalOwnerSession(active))return json({error:'adoption_required'},403);
  if(!response)return json({error:'not_found'},404);
  if(special||!response.ok)return response;
  const body=await response.json() as {owner?:{label:string}};if(body.owner)body.owner.label=identity.displayName+' · owner';
  return json(body,response.status);
 }catch(e){const code=e&&typeof e==='object'&&'code'in e&&typeof e.code==='string'?e.code:null;
  return json({error:code==='personal_session_required'?code:code==='adoption_required'||code==='not_your_muse'?code:'owner_unavailable'},code==='personal_session_required'?401:code==='adoption_required'||code==='not_your_muse'?403:503);
 }
}
