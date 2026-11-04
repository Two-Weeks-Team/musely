import {apiFetcher} from './api-fetch.ts';
import {judgeMuseAccess} from './judge-muse-access.ts';
// UI transport only. The server proves adoption/current personal authority; a public name never grants ownership.
export const PERSONAL_OWNER_BASE='/api/personal/owner';
type Options={judgeMode?:()=>boolean;fetcher?:typeof fetch;now?:()=>number;setTimer?:(fn:()=>void,ms:number)=>unknown;clearTimer?:(timer:unknown)=>void};
type PersonalState={authenticated:boolean|null;profile:{actorId:string}|null};
const ownerSuffix=/^\/(?:session|inbox|approvals|location|notifications|revoke|redelegate|profile|social-status)$/;
function ownerPath(path:string):string|null{
 if(path.startsWith(PERSONAL_OWNER_BASE+'/'))return path;
 const split=path.indexOf('?'),base=split<0?path:path.slice(0,split),query=split<0?'':path.slice(split);
 if(base.startsWith('/api/owner/')&&ownerSuffix.test(base.slice('/api/owner'.length)))return PERSONAL_OWNER_BASE+base.slice('/api/owner'.length)+query;
 if(/^\/api\/agent-keys(?:\/[^/?#]+)?$/.test(base))return PERSONAL_OWNER_BASE+base.slice('/api'.length)+query;
 if(['/api/p0/run','/api/claim/permalink','/api/ritual/start','/api/ritual/record','/api/muse'].includes(base))return PERSONAL_OWNER_BASE+base.slice('/api'.length)+query;
 return null;
}
const denied=()=>new Response(JSON.stringify({error:'owner_session_required'}),{status:401,headers:{'content-type':'application/json'}});
/** Separate from the emergency owner cookie. Invalidation fences both HTTP and delayed JSON; it never retries or falls back. */
export function createPersonalOwnerAccess(options:Options={}){
 const now=options.now??Date.now,fetcher=apiFetcher(options.fetcher),setTimer=options.setTimer??((fn,ms)=>setTimeout(fn,ms)),clearTimer=options.clearTimer??(timer=>clearTimeout(timer as ReturnType<typeof setTimeout>));
 let blocked=false,generation=0,disposed=false,expiry=0,timer:unknown,loggingOut=0;let judgeContext:Promise<boolean>|null=null;
 const listeners=new Set<(reason:string)=>void>();
 const notify=(reason:string)=>{for(const listener of listeners)try{listener(reason);}catch{}};
 function invalidate(reason='session_lost'){
  clearTimer(timer);timer=undefined;expiry=0;if(blocked)return;blocked=true;generation++;notify(reason);
 }
 const checkExpiry=()=>{if(expiry&&expiry<=now())invalidate('expired');};
 const request:typeof fetch=async(input,init)=>{
  const raw=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const url=new URL(raw,typeof location==='undefined'?'https://musely.invalid':location.origin),path=url.pathname+url.search,mapped=ownerPath(path),method=(init?.method??(typeof input==='object'&&'method'in input?input.method:'GET')).toUpperCase();
  if(url.origin!==(typeof location==='undefined'?'https://musely.invalid':location.origin))return denied();
  if(disposed)return denied();
  if(judgeContext&&(mapped||path.startsWith('/api/personal/'))&&!await judgeContext)return denied();
  if((options.judgeMode?.()??judgeMuseAccess.state().mode)&&(mapped||path.startsWith('/api/personal/')))return denied();
  if(path==='/api/personal/auth/threads/start'&&method==='POST'&&loggingOut)return new Response(JSON.stringify({error:'logout_pending'}),{status:409,headers:{'content-type':'application/json'}});
  if(path==='/api/personal/session'&&method==='DELETE'){loggingOut++;invalidate('logout');try{const r=await fetcher(input,init),data=await r.json().catch(()=>null);return new Response(JSON.stringify(data),{status:r.status,headers:{'content-type':'application/json'}});}finally{loggingOut--;notify('logout_settled');}}
  if(!mapped){const r=await fetcher(input,init);if((options.judgeMode?.()??judgeMuseAccess.state().mode)&&path.startsWith('/api/personal/'))return denied();if(path.startsWith('/api/personal/')&&r.status===401)invalidate('http401');return r;}
  checkExpiry();if(blocked)return denied();
  if(mapped===PERSONAL_OWNER_BASE+'/session'&&method==='POST')return new Response(JSON.stringify({error:'personal_sign_in_required'}),{status:403,headers:{'content-type':'application/json'}});
  if(mapped===PERSONAL_OWNER_BASE+'/session'&&method==='DELETE'){loggingOut++;invalidate('logout');}
  const mine=generation,logout=method==='DELETE'&&mapped===PERSONAL_OWNER_BASE+'/session';
  if(!logout&&!(mapped===PERSONAL_OWNER_BASE+'/session'&&method==='GET')&&!expiry)return denied();
  try{
  const r=await fetcher(mapped,{...init,method,mode:'same-origin',credentials:'same-origin',redirect:'error',cache:'no-store'});
  if(r.redirected){invalidate('owner_unavailable');return denied();}
  const data=await r.json().catch(()=>null);
  if(disposed||mine!==generation||blocked&&!logout||(options.judgeMode?.()??judgeMuseAccess.state().mode))return denied();
  checkExpiry();if(blocked&&!logout)return denied();
  if(r.status===401){invalidate('http401');return denied();}
  if(r.status===403){invalidate('owner_unavailable');return new Response(JSON.stringify(data),{status:403,headers:{'content-type':'application/json'}});}
  if(mapped===PERSONAL_OWNER_BASE+'/session'&&method==='GET'){
   const o=data?.owner,valid=o&&o.principal==='owner'&&typeof o.ownerId==='string'&&!!o.ownerId&&typeof o.label==='string'&&o.demo===false&&Array.isArray(o.muses)&&o.muses.length===1&&o.muses[0]==='00-jolly'&&Number.isSafeInteger(o.expiresAt)&&o.expiresAt>now();
   const delegations=data?.delegation===undefined||Array.isArray(data.delegation)&&data.delegation.every((d:unknown)=>!!d&&typeof d==='object'&&!Array.isArray(d)&&(d as {muse?:unknown}).muse==='00-jolly'&&['active','revoked'].includes(String((d as {status?:unknown}).status)));
   if(!r.ok||!valid||!delegations){invalidate('owner_unavailable');return denied();}
   expiry=o.expiresAt;clearTimer(timer);timer=setTimer(()=>checkExpiry(),Math.max(1,expiry-now()));
  }
  if(logout&&r.ok&&(!data||data.owner!==null||Object.keys(data).length!==1))return new Response(JSON.stringify({error:'invalid_owner_logout'}),{status:503,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify(data),{status:r.status,headers:{'content-type':'application/json'}});
  }finally{if(logout){loggingOut--;notify('logout_settled');}}
 };
 const stopJudge=judgeMuseAccess.subscribe(()=>{if(judgeMuseAccess.state().mode)invalidate('judge_mode');});
 // A private profile can permit a new session check, but never grants owner reads/writes before its owner DTO.
 return{fetch:request,setJudgeContext(check:Promise<boolean>){let timeout:ReturnType<typeof setTimeout>;judgeContext=Promise.race([check.catch(()=>false),new Promise<boolean>(resolve=>{timeout=setTimeout(()=>resolve(false),8000);})]).finally(()=>clearTimeout(timeout));},invalidate,isLoggingOut:()=>loggingOut>0,syncPersonal(state:PersonalState){if(disposed)return;if(options.judgeMode?.()??judgeMuseAccess.state().mode){invalidate('judge_mode');return;}if(loggingOut){invalidate('personal_state');return;}if(state.authenticated!==true||state.profile?.actorId!=='00-jolly'){invalidate('personal_state');return;}if(blocked){blocked=false;generation++;notify('available');}},subscribe(listener:(reason:string)=>void){listeners.add(listener);return()=>listeners.delete(listener);},dispose(){if(disposed)return;invalidate('disposed');disposed=true;stopJudge();listeners.clear();}};
}
export const personalOwnerAccess=createPersonalOwnerAccess();
