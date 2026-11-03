// Optional account proof, independent of connector permissions and committed world entry.
import {claimText} from '../identity/fingerprint.ts';
import {threadsPermalink} from '../identity/threads-permalink.ts';
import type {ActorProfile} from '../identity/participant.ts';

type ClaimStatus = 'pending_claim' | 'claimed' | 'claim_revoked' | 'mismatch' | 'reauth_required' | 'unavailable';
export type PersonalClaim = {actorId:string;status:ClaimStatus;claimed:boolean;version:number;fingerprint:string;display:string;text:string;permalink:string|null;verifiedAt:number|null;checkedAt:number|null};
type ProfileState = {authenticated:boolean|null;profile:ActorProfile|null;busy:boolean};
export type PersonalClaimOptions = {fetcher?:typeof fetch;clipboard?:{writeText:(text:string)=>Promise<void>};navigate?:(url:string)=>void|Promise<void>;onExpanded?:(value:boolean)=>void;onWriteBusy?:(value:boolean)=>void;onSessionLost?:()=>void};
class Failure extends Error {readonly status:number;constructor(status=0){super('personal_claim_unavailable');this.status=status;}}
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const timestamp=(v:unknown)=>v===null||Number.isSafeInteger(v)&&Number(v)>0;
const statuses:ClaimStatus[]=['pending_claim','claimed','claim_revoked','mismatch','reauth_required','unavailable'];
export function parsePersonalClaim(v:unknown,actorId:string):PersonalClaim {
 if(!exact(v,['actorId','status','claimed','version','fingerprint','display','text','permalink','verifiedAt','checkedAt'])||v.actorId!==actorId||!statuses.includes(v.status as ClaimStatus)||v.claimed!==(v.status==='claimed')||!Number.isSafeInteger(v.version)||Number(v.version)<0||typeof v.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.fingerprint)||v.display!==v.fingerprint.slice(0,16).match(/.{4}/g)!.join(' ')||v.text!==claimText(String(v.display))||!timestamp(v.verifiedAt)||!timestamp(v.checkedAt)||v.claimed&&v.verifiedAt===null)throw new Failure();
 if(v.permalink!==null&&threadsPermalink(v.permalink)===null)throw new Failure();
 return {actorId,status:v.status as ClaimStatus,claimed:v.claimed as boolean,version:Number(v.version),fingerprint:v.fingerprint,display:String(v.display),text:String(v.text),permalink:v.permalink as string|null,verifiedAt:v.verifiedAt as number|null,checkedAt:v.checkedAt as number|null};
}
function authorize(v:unknown):string {
 if(!exact(v,['authorizationUrl'])||typeof v.authorizationUrl!=='string'||!/^https:\/\/threads\.com\/oauth\/authorize\?[^#]+$/.test(v.authorizationUrl))throw new Failure();
 const url=new URL(v.authorizationUrl),q=url.searchParams;
 if(url.origin!=='https://threads.com'||url.pathname!=='/oauth/authorize'||url.username||url.password||url.hash||['scope','response_type','state'].some(k=>q.getAll(k).length!==1)||q.get('scope')!=='threads_basic'||q.get('response_type')!=='code'||!/^personal-claim-v1\.[A-Za-z0-9_-]+$/.test(q.get('state')??''))throw new Failure();
 return url.href;
}

/** Mount is inert; a certain own profile enables a pure GET. Only explicit controls write. */
export function mountPersonalClaim(host:HTMLElement,options:PersonalClaimOptions={}) {
 const fetcher=options.fetcher??fetch,navigate=options.navigate??(url=>window.location.assign(url));
 const root=document.createElement('section');root.className='personal-claim';host.append(root);
 let context:ProfileState={authenticated:null,profile:null,busy:true},data:PersonalClaim|null=null,phase:'observer'|'loading'|'ready'|'error'='observer';
 let disposed=false,visible=true,externalBusy=false,busy=false,writing=false,copying=false,generation=0,controller:AbortController|null=null,expanded:boolean|null=null;
 let step:'copy'|'publish'|'verify'='copy',message='';
 const state=()=>({phase,claim:data?{...data}:null,expanded:expanded===true,busy,joined:false as const});
 const active=()=>context.authenticated===true&&!!context.profile&&!context.busy;
 const foreground=()=>document.visibilityState!=='hidden';
 const notify=(fn:(()=>void)|undefined)=>{try{fn?.();}catch{}};
 const writeBusy=(value:boolean)=>{if(writing===value)return;writing=value;notify(()=>options.onWriteBusy?.(value));};
 function invalidate(){generation++;controller?.abort();controller=null;busy=false;copying=false;writeBusy(false);}
 type Context={generation:number;actorId:string;controller:AbortController};
 const current=(c:Context)=>!disposed&&visible&&foreground()&&c.generation===generation&&!c.controller.signal.aborted&&active()&&context.profile!.actorId===c.actorId;
 function begin(write=false):Context|null {
  if(disposed||!visible||!foreground()||!active()||busy||copying||externalBusy)return null;
  controller?.abort();controller=new AbortController();generation++;busy=true;writeBusy(write);phase='loading';message='';render();
  return{generation,actorId:context.profile!.actorId,controller};
 }
 async function request(method:string,c:Context,body?:unknown){
  const timer=setTimeout(()=>c.controller.abort(),12000);
  try{const response=await fetcher('/api/personal/claim'+(method==='POST'?'/start':''),{method,mode:'same-origin',credentials:'same-origin',cache:'no-store',redirect:'error',signal:c.controller.signal,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
   if(!response.ok)throw new Failure(response.status);if(response.redirected)throw new Failure();
   const value:unknown=await response.json();if(c.controller.signal.aborted)throw new Failure();return value;
  }finally{clearTimeout(timer);}
 }
 function failure(error:unknown,c:Context){
  if(disposed||generation!==c.generation)return;busy=false;writeBusy(false);data=null;phase='error';message='다시 확인해 주세요. 관람과 연결 설정은 계속할 수 있어요. / Check again. You can keep watching or setting up your connection.';
  if(error instanceof Failure&&error.status===401){phase='observer';context={authenticated:false,profile:null,busy:false};message='다시 로그인해 주세요. / Sign in again.';notify(options.onSessionLost);}
  if(expanded===null)setExpanded(true,false);render();
 }
 function accept(value:unknown,c:Context){data=parsePersonalClaim(value,c.actorId);phase='ready';busy=false;if(expanded===null)setExpanded(!data.claimed,false);render();}
 async function refresh(){const c=begin();if(!c)return;try{const value=await request('GET',c);if(!current(c))return;accept(value,c);}catch(e){failure(e,c);}}
 async function verify(){
  if(!data)return;const version=data.version,c=begin(true);if(!c)return;
  try{const answer=await request('POST',c,{expectedVersion:version});if(!current(c))return;const url=authorize(answer);await navigate(url);if(!current(c))return;busy=false;writeBusy(false);phase='ready';message='Threads에서 확인한 뒤 돌아와 주세요. 돌아오면 현재 결과를 다시 확인해요. / Return after checking in Threads; we will read the current result here.';render();}
  catch(e){failure(e,c);}
 }
 async function cancel(){
  if(!data)return;const previous=data.version,c=begin(true);if(!c)return;
  try{const answer=await request('DELETE',c,{expectedVersion:previous});if(!current(c))return;const next=parsePersonalClaim(answer,c.actorId);if(next.claimed||next.version!==previous+1)throw new Failure();writeBusy(false);step='copy';accept(next,c);message='계정 확인을 취소하고 검증용 연결정보를 삭제했어요. / Account verification cancelled and its verification connection removed.';render();}
  catch(e){failure(e,c);}
 }
 async function copy(){
  if(!data||!active()||disposed||!visible||!foreground()||busy||copying||externalBusy)return;const g=generation,text=data.text;copying=true;render();
  try{await(options.clipboard??navigator.clipboard).writeText(text);if(disposed||generation!==g||!visible)return;step='publish';message='복사했어요. 이 공개 문안을 직접 Threads에 게시해 주세요. / Copied. Publish this public text on Threads yourself.';}
  catch{if(disposed||generation!==g||!visible)return;message='복사하지 못했어요. 아래 공개 문안을 직접 선택해 복사해 주세요. / Select and copy the public text below.';}
  finally{if(!disposed&&generation===g){copying=false;render();}}
 }
 function setExpanded(value:boolean,load=true){if(disposed)return;expanded=value;notify(()=>options.onExpanded?.(value));render();if(value&&load&&!data&&!busy)void refresh();}
 function render(){
  if(disposed)return;root.replaceChildren();root.hidden=!active();root.dataset.state=phase;root.dataset.claimed=String(data?.claimed===true);if(!active())return;
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const button=(id:string,text:string,fn:()=>void|Promise<void>,primary=false)=>{const b=el('button',text);b.type='button';b.dataset.action=id;b.className=primary?'primary':'secondary';b.disabled=busy||copying||externalBusy;const g=generation;b.onclick=()=>{if(disposed||generation!==g||b.disabled||externalBusy)return;return fn();};return b;};
  const toggle=button('toggle-claim',data?.claimed?'Threads 계정 확인됨 / Threads account verified':'Threads 계정 확인 / Verify your Threads account',()=>setExpanded(!expanded));toggle.disabled=busy||copying||externalBusy;toggle.setAttribute('aria-expanded',String(expanded===true));toggle.setAttribute('aria-controls','personal-claim-content');root.append(toggle);
  if(expanded!==true){root.append(el('p',data?.claimed?'계정 확인됨. 세계 입장과 Muse 연결은 별도예요. / Account verified. World entry and your Muse connection are separate.':'계정 확인은 세계 입장과 별개예요. 미확인 상태에서는 거래 등 일부 행동이 제한돼요. / Account verification is separate from entry. Some actions, including trades, stay limited until verified.'));return;}
  const content=el('div');content.id='personal-claim-content';root.append(content);content.append(el('h3','내 Threads 계정으로 확인하기 / Verify with your Threads account'),el('p',context.profile!.displayName));
  content.append(el('p','일반 로그인만으로 연결정보를 보관하지 않아요. ‘게시글 확인’을 선택하면 검증용 연결정보만 서버에 암호화해 보관하고, 확인 취소 시 삭제해요. 게시글은 직접 올리며 Musely가 대신 게시하지 않아요. / Ordinary sign-in does not retain this connection. Choosing “Check my post” stores only the verification connection encrypted on the server; cancelling verification deletes it. You publish the post yourself. Musely never publishes for you.'));
  const status=el('p',message||(!data?'계정 확인 상태를 읽고 있어요. / Reading your account verification.':({pending_claim:'공개 문안을 복사해 직접 게시한 뒤 확인해 주세요. / Copy and publish the public text, then check it.',claimed:'계정 확인됨. 세계 입장과 Muse 연결은 별도예요. / Account verified. World entry and your Muse connection are separate.',claim_revoked:'계정 확인을 취소했어요. 필요하면 다시 확인할 수 있어요. / Verification cancelled. You can verify again when ready.',mismatch:'같은 Threads 계정의 최근 게시글 25개 안에서 문안을 확인하지 못했어요. 계정과 게시글을 확인해 다시 시도해 주세요. / The text was not found in the latest 25 posts of this Threads account. Check the account and post, then try again.',reauth_required:'Threads에 다시 로그인해 게시글을 확인해 주세요. / Sign in to Threads again to check your post.',unavailable:'지금 확인하지 못했어요. 잠시 후 다시 확인해 주세요. / Verification is unavailable. Check again later.'} as Record<ClaimStatus,string>)[data.status]));status.setAttribute('role','status');status.setAttribute('aria-live','polite');content.append(status);
  if(!data){content.append(button('refresh-claim','다시 확인 / Check again',refresh,true));}
  else{
   if(!data.claimed){const text=el('textarea');text.readOnly=true;text.rows=3;text.value=data.text;text.setAttribute('aria-label','직접 게시할 공개 문안 / Public text to post');content.append(text);
    content.append(button('copy-claim','1 · 공개 문안 복사 / Copy public text',copy,step==='copy'));
    const publish=el('a','2 · Threads에 직접 게시 / Publish on Threads yourself');publish.dataset.action='publish-claim';publish.href='https://www.threads.com/';publish.target='_blank';publish.rel='noopener noreferrer';publish.className=step==='publish'?'primary':'secondary';const g=generation;publish.onclick=e=>{if(disposed||generation!==g||busy||copying||externalBusy){e?.preventDefault();return;}step='verify';render();};content.append(publish);
    content.append(button('verify-claim','3 · 게시글 확인 / Check my post',verify,step==='verify'));
   }
   if(data.permalink){const link=el('a','확인한 게시글 보기 / View the checked post');link.href=data.permalink;link.target='_blank';link.rel='noopener noreferrer';content.append(link);}
   const more=el('details');more.className='entry-advanced';more.append(el('summary','다시 확인·취소 / Recheck or cancel'),button('refresh-claim','현재 결과 다시 확인 / Check current result',refresh),button('cancel-claim','계정 확인 취소·검증정보 삭제 / Cancel verification and delete its connection',cancel));content.append(more);
  }
  content.append(button('later-claim','나중에 · 연결 설정으로 돌아가기 / Later · Back to connection setup',()=>setExpanded(false)));
 }
 const visibility=()=>{if(disposed)return;if(!foreground()){invalidate();data=null;message='';render();}else if(visible&&active())void refresh();};
 document.addEventListener('visibilitychange',visibility);
 render();
 return{state,refresh,setExpanded,isExpanded:()=>expanded===true,async syncProfile(next:ProfileState){if(disposed)return;const key=(p:ProfileState)=>JSON.stringify([p.authenticated,p.profile?.actorId,p.profile?.revision,p.busy]);if(key(next)===key(context))return;const previous=context.profile?.actorId;invalidate();context={...next,profile:next.profile?{...next.profile}:null};data=null;message='';phase='observer';if(previous!==next.profile?.actorId){expanded=null;step='copy';notify(()=>options.onExpanded?.(false));}render();if(active()&&visible)await refresh();},setVisible(value:boolean){if(disposed||value===visible)return;visible=value;if(!value){invalidate();data=null;render();}else if(active())void refresh();},setExternalBusy(value:boolean){if(disposed)return;externalBusy=value;render();},dispose(){if(disposed)return;invalidate();disposed=true;document.removeEventListener('visibilitychange',visibility);data=null;context={authenticated:false,profile:null,busy:false};root.remove();}};
}
