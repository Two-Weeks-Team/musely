/** Shared judge UI capability. The visitor cookie never becomes an owner cookie. */
import {JUDGE_MUSE,judgeMuseEnabled} from '../../src/engine/judge-muse.ts';
import {cookieValue,readSession,type Session} from './session.ts';
import {originAllowed} from './owner-session.ts';
import {socialBody} from './owner-api.ts';
export class JudgeMuseError extends Error {
 readonly code:'judge_session_required'|'judge_muse_unavailable';
 constructor(code:JudgeMuseError['code']){super(code);this.code=code;}
}
export interface JudgeStub {judgeCall(session:Session,operation:'muse'|'social-status-get'|'social-status-set'|'inbox'|'notifications',input?:unknown):unknown|Promise<unknown>}
const json=(body:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
export async function judgeRoutes(request:Request,url:URL,cfg:{secret:string;mode?:string;origins:string[]},stub:JudgeStub):Promise<Response>{
 try{
  if(!judgeMuseEnabled(cfg.mode))return json({error:'judge_muse_unavailable'},404);
  const path=url.pathname.slice('/api/judge/'.length),allowed=path==='social-status'?['GET','PATCH']:['muse','inbox','notifications'].includes(path)?['GET']:null;
  if(!allowed)return json({error:'not_found'},404);
  if(!allowed.includes(request.method))return json({error:'method_not_allowed'},405,{allow:allowed.join(', ')});
  // Reject ambiguous duplicate cookies rather than using the first of two identities.
  const cookies=request.headers.get('cookie'),count=(cookies?.split(/;\s*/).filter(p=>p.startsWith('musely_s=')).length??0);
  const session=count===1?await readSession(cfg.secret,cookieValue(cookies)):null;
  if(!session||session.tier!=='judge')return json({error:'judge_session_required'},401);
  if([...url.searchParams.keys()].some(k=>k!=='muse')||url.searchParams.getAll('muse').length>1)return json({error:'bad_query'},400);
  if(url.searchParams.has('muse')&&url.searchParams.get('muse')!==JUDGE_MUSE.id)return json({error:'not_your_muse'},403);
  if(request.method==='PATCH'&&!originAllowed(request,cfg.origins))return json({error:'origin_not_allowed'},403);
  let input:unknown;
  if(request.method==='PATCH'){try{input=await socialBody(request);}catch{return json({error:'invalid_social_status'},400);}}
  const operation=path==='social-status'?(request.method==='PATCH'?'social-status-set':'social-status-get'):path as 'muse'|'inbox'|'notifications';
  return json(await stub.judgeCall(session,operation,input));
 }catch(e){const code=e&&typeof e==='object'&&'code'in e?e.code:null;
  if(code==='judge_session_required')return json({error:code},401);
  if(code==='judge_muse_unavailable')return json({error:code},404);
  if(code==='social_status_conflict')return json({error:code},409);
  if(code==='invalid_social_status')return json({error:code},400);
  if(code==='social_status_forbidden')return json({error:'judge_session_required'},401);
  return json({error:'judge_muse_unavailable'},503);
 }
}
