import {apiFetcher} from './api-fetch.ts';
import type {SparkStatus} from '../live.ts';
type Session=NonNullable<SparkStatus['session']>;
type Options={fetcher?:typeof fetch;now?:()=>number;setTimer?:(fn:()=>void,ms:number)=>unknown;clearTimer?:(id:unknown)=>void;onEntry?:(result:Promise<Session>)=>void;path?:()=>string;returnHome?:()=>void;tokenAttempted?:boolean};
/** Public discovery only. The server alone grants the existing restricted judge session. */
export function createJudgeOpenAccess(options:Options={}){
 const fetcher=apiFetcher(options.fetcher),now=options.now??Date.now,setTimer=options.setTimer??((fn,ms)=>setTimeout(fn,ms)),clearTimer=options.clearTimer??(id=>clearTimeout(id as ReturnType<typeof setTimeout>));
 let open=false,until:number|null=null,timer:unknown,pending:Promise<Session>|null=null,controller:AbortController|null=null,disposed=false,began=false;
 const listeners=new Set<()=>void>(),available=()=>!disposed&&open&&until!==null&&now()<until;
 const notify=()=>{if(!disposed)for(const listener of listeners)try{listener();}catch{}};
 function sync(status:Pick<SparkStatus,'judgeAccess'>|null){clearTimer(timer);timer=undefined;const access=status?.judgeAccess;until=Number.isSafeInteger(access?.until)&&Number(access?.until)>0?Number(access!.until):null;open=access?.open===true&&until!==null&&now()<until;if(available())timer=setTimer(()=>{open=false;notify();},Math.min(2147483647,Math.max(1,until!-now())));notify();}
 function start(direct=false):Promise<Session>{
  if(pending)return pending;
  if(disposed||!direct&&!available()){const rejected=Promise.reject<Session>(Error('judge_access_ended'));void rejected.catch(()=>{});return rejected;}
  controller=new AbortController();const abort=controller;let deadline:ReturnType<typeof setTimeout>|undefined,reason='judge_access_unavailable';
  const result=(async()=>{try{
   const timeout=new Promise<never>((_,reject)=>{deadline=setTimeout(()=>{abort.abort();reject(Error('judge_access_unavailable'));},10000);});
   const r=await Promise.race([fetcher('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({judgeOpen:true}),credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:abort.signal}),timeout]);
   if(!r.ok||r.redirected){reason=r.status===403?'judge_access_ended':r.status===429?'judge_access_limited':'judge_access_unavailable';if(r.status===403){open=false;clearTimer(timer);notify();}throw Error(reason);}
   const value=await Promise.race([r.json(),timeout]);
   if(disposed||abort.signal.aborted||value?.tier!=='judge'||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now()||value.quota?.perHour!==120||!Number.isSafeInteger(value.quota.usedThisHour)||value.quota.usedThisHour<0)throw Error(reason);
   return {tier:'judge' as const,expiresAt:value.expiresAt,quota:{perHour:120,usedThisHour:value.quota.usedThisHour}};
  }catch{throw Error(reason);}finally{clearTimeout(deadline);controller=null;pending=null;notify();}})();
  pending=result;void result.catch(()=>{});try{options.onEntry?.(result);}catch{}notify();return result;
 }
 return {available,sync,enter:()=>start(),subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);},begin(){
  if(began||disposed||(options.path?.()??location.pathname)!=='/judge')return Promise.resolve(null);began=true;
  const token=options.tokenAttempted===true||(typeof window!=='undefined'&&window.__muselyJudgeEntry?.attempted===true)||typeof location!=='undefined'&&new URLSearchParams(location.search).has('judge');
  if(options.returnHome)options.returnHome();else{const params=new URLSearchParams(location.search);params.delete('judge');history.replaceState(null,'','/'+(params.size?'?'+params:'')+location.hash);}
  return token?Promise.resolve(null):start(true);
 },dispose(){disposed=true;open=false;clearTimer(timer);controller?.abort();listeners.clear();}};
}
export type JudgeOpenAccess=ReturnType<typeof createJudgeOpenAccess>;
