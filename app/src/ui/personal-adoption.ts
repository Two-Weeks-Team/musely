import {uiText} from './i18n.ts';
// Existing-Muse account binding only. Never creates a key, grant or MCP world-entry command.
import {MUSE_VARIANTS} from '../character-kit/catalog.ts';
import type {ActorProfile} from '../identity/participant.ts';
import type {EntryProjection} from './personal-connection.ts';
type LegacyEntry=Omit<EntryProjection,'receipt'>&{receipt:(NonNullable<EntryProjection['receipt']>&{kind:'legacy_adoption'})|null};
export type PersonalAdoption={available:boolean;adopted:boolean;profile:ActorProfile|null;connection:{connected:boolean;lastSeenAt:number|null};entry:LegacyEntry|null};
type ProfileState={authenticated:boolean|null;profile:ActorProfile|null;busy:boolean};
type Mode='observer'|'checking'|'available'|'adopted'|'new'|'error';
export type AdoptionState={mode:Mode;data:PersonalAdoption|null;busy:boolean;alias:boolean;blocksSetup:boolean};
type Options={fetcher?:typeof fetch;getWorldId?:()=>string|null;newOperationId?:()=>string;onState?:(state:AdoptionState)=>void;onWriteBusy?:(busy:boolean)=>void;onSessionLost?:()=>void;onAdopted?:()=>void|Promise<void>;onWatch?:()=>void};
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const stamp=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const ref=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(v)&&!v.startsWith('msly_');
function need(v:unknown):asserts v{if(!v)throw Error('invalid_legacy_muse_response');}
export function parsePersonalAdoption(v:unknown,worldId:string|null):PersonalAdoption{
 need(exact(v,['available','adopted','profile','connection','entry'])&&typeof v.available==='boolean'&&typeof v.adopted==='boolean'&&!(v.available&&v.adopted));
 const c=v.connection;need(exact(c,['connected','lastSeenAt'])&&typeof c.connected==='boolean'&&(c.connected?stamp(c.lastSeenAt)&&c.lastSeenAt>0:c.lastSeenAt===null));
 let p:ActorProfile|null=null;if(v.profile!==null){const o=v.profile;need(exact(o,['actorId','displayName','appearanceId','revision'])&&o.actorId==='00-jolly'&&typeof o.displayName==='string'&&o.displayName.trim()===o.displayName&&!!o.displayName&&[...o.displayName].length<=40&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(o.displayName)&&stamp(o.revision)&&(!v.adopted||o.revision>0));const appearance=MUSE_VARIANTS.find(x=>x.id===o.appearanceId);need(appearance);p={actorId:'00-jolly',displayName:o.displayName,appearanceId:appearance.id,revision:o.revision};}
 need(v.available||v.adopted?!!p:p===null&&v.entry===null&&!c.connected);
 let e:LegacyEntry|null=null;if(v.entry!==null){need(v.adopted&&p);const o=v.entry;need(exact(o,['state','actor','attempt','receipt','reason'])&&['viewing','joined'].includes(String(o.state))&&o.attempt===null&&(o.reason===null||['signed_out','setup_required','waiting_connector','expired','paused','unavailable'].includes(String(o.reason))));e={state:o.state as LegacyEntry['state'],actor:null,attempt:null,receipt:null,reason:o.reason as LegacyEntry['reason']};
  if(o.actor!==null){const a=o.actor;need(exact(a,['id','displayName','appearanceId','profileRevision'])&&a.id===p.actorId&&a.displayName===p.displayName&&a.appearanceId===p.appearanceId&&a.profileRevision===p.revision);e.actor={id:p.actorId,displayName:p.displayName,appearanceId:p.appearanceId,profileRevision:p.revision};}
  if(o.receipt!==null){const r=o.receipt;need(exact(r,['kind','id','actorId','worldId','committedAt'])&&r.kind==='legacy_adoption'&&typeof r.id==='string'&&/^lad_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(r.id)&&r.actorId==='00-jolly'&&ref(r.worldId)&&stamp(r.committedAt));e.receipt={kind:'legacy_adoption',id:r.id,actorId:'00-jolly',worldId:r.worldId,committedAt:r.committedAt};}
  if(e.state==='joined')need(e.actor&&e.receipt&&worldId&&e.receipt.worldId===worldId&&e.reason===null);
 }
 if(!v.adopted)need(e===null);
 return{available:v.available,adopted:v.adopted,profile:p,connection:{connected:c.connected,lastSeenAt:c.lastSeenAt as number|null},entry:e};
}
class Failure extends Error{readonly status:number;constructor(status=0){super('personal_adoption_unavailable');this.status=status;}}
export function mountPersonalAdoption(host:HTMLElement,options:Options={}){
 const fetcher=options.fetcher??fetch,newId=options.newOperationId??(()=>crypto.randomUUID());const root=document.createElement('section');root.className='personal-adoption';host.append(root);
 let profile:ProfileState={authenticated:null,profile:null,busy:true},mode:Mode='observer',data:PersonalAdoption|null=null,alias=false,choiceNew=false,visible=true,disposed=false,busy=false,writing=false,externalBusy=false,generation=0,controller:AbortController|null=null,intent:{body:string;id:string}|null=null;
 const eligible=()=>profile.authenticated===true&&!profile.busy&&(!profile.profile||profile.profile.actorId==='00-jolly');
 const foreground=()=>document.visibilityState!=='hidden';
 const state=():AdoptionState=>({mode,data:data?structuredClone(data):null,busy,alias,blocksSetup:alias||eligible()&&!choiceNew&&['checking','available','adopted','error'].includes(mode)});
 const notify=()=>{try{options.onState?.(state());}catch{}};
 const writeBusy=(value:boolean)=>{if(writing===value)return;writing=value;try{options.onWriteBusy?.(value);}catch{}};
 const invalidate=()=>{generation++;controller?.abort();controller=null;busy=false;writeBusy(false);};
 type Context={generation:number;controller:AbortController};
 const current=(c:Context)=>!disposed&&visible&&foreground()&&eligible()&&c.generation===generation&&!c.controller.signal.aborted;
 function begin(write=false):Context|null{if(disposed||!visible||!foreground()||!eligible()||busy||externalBusy||choiceNew)return null;controller?.abort();controller=new AbortController();generation++;busy=true;writeBusy(write);mode='checking';data=null;render();notify();return{generation,controller};}
 async function request(method:string,c:Context,body?:unknown){const timer=setTimeout(()=>c.controller.abort(),12000);try{const r=await fetcher('/api/personal/legacy-muse',{method,mode:'same-origin',credentials:'same-origin',cache:'no-store',redirect:'error',signal:c.controller.signal,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});if(!r.ok)throw new Failure(r.status);if(r.redirected)throw new Failure();const answer:unknown=await r.json();if(c.controller.signal.aborted)throw new Failure();const next=parsePersonalAdoption(answer,options.getWorldId?.()??null);if(profile.profile?.actorId==='00-jolly'&&!next.adopted)throw new Failure();return next;}finally{clearTimeout(timer);}}
 function accept(next:PersonalAdoption){data=next;alias=next.adopted;mode=next.adopted?'adopted':next.available?'available':'new';busy=false;render();notify();}
 function fail(error:unknown,c:Context){if(disposed||generation!==c.generation)return;busy=false;writeBusy(false);data=null;mode='error';if(error instanceof Failure&&error.status===401){alias=false;profile={authenticated:false,profile:null,busy:false};mode='observer';intent=null;choiceNew=false;try{options.onSessionLost?.();}catch{}}render();notify();}
 async function refresh(){const c=begin();if(!c)return;try{const next=await request('GET',c);if(current(c))accept(next);}catch(e){fail(e,c);}}
 async function adopt(){if(!data?.available||busy||externalBusy||!eligible())return;const p=data.profile!;const input={displayName:p.displayName,appearanceId:p.appearanceId,expectedRevision:p.revision};const body=JSON.stringify(input);try{if(intent?.body!==body){const id=newId();need(ref(id));intent={body,id};}}catch{mode='error';data=null;render();notify();return;}
  const c=begin(true);if(!c)return;try{const next=await request('POST',c,{operationId:intent!.id,...input});if(!current(c))return;need(next.adopted);intent=null;writeBusy(false);accept(next);try{await options.onAdopted?.();}catch{/* Binding truth remains the server response; profile refresh reports its own failure. */}}catch(e){fail(e,c);}
 }
 function chooseNew(){if(disposed||busy||externalBusy||alias||profile.profile)return;invalidate();choiceNew=true;data=null;mode='new';render();notify();}
 function render(){if(disposed)return;root.replaceChildren();root.hidden=!eligible()||choiceNew||mode==='new';if(root.hidden)return;
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const button=(id:string,text:string,fn:()=>void|Promise<void>,primary=false)=>{const b=el('button',text);b.type='button';b.dataset.action=id;b.className=primary?'primary':'secondary';b.disabled=busy||externalBusy;const g=generation;b.onclick=()=>{if(disposed||g!==generation||b.disabled||externalBusy)return;return fn();};return b;};
  root.append(el('h3',uiText('내 Muse 이어서 연결하기 / Continue with my Muse')));
  if(data?.profile)root.append(el('p',data.profile.displayName));
  const status=el('p',mode==='checking'?uiText('기존 Muse를 확인하고 있어요… / Checking your existing Muse…'):mode==='error'?uiText('연결 여부를 확인하지 못했어요. 다시 확인하거나 관람을 계속할 수 있어요. / Could not confirm the connection. Check again or keep watching.'):data?.adopted?data.entry?.state==='joined'?uiText('이미 생활 중인 Muse를 이 계정에 연결했어요. 새로 입장시키거나 키를 만들지 않았어요. / Your existing Muse is now connected to this account. No new entry or key was created.'):data.entry?.reason==='paused'?uiText('이 계정에 연결됐지만 활동이 멈춰 있어요. 지금 입장 완료로 표시하지 않아요. / Connected to this account, but activity is paused. Current entry is not confirmed.'):uiText('이 계정에 연결됐지만 지금 세계의 활동 상태를 확인하지 못했어요. / Connected to this account, but current activity in the world could not be confirmed.'):uiText('기존 이름과 모습을 그대로 이어서 사용할 수 있어요. 이 선택 전에는 아직 이 계정에 연결된 것이 아니에요. / Keep the existing name and appearance. It is not connected to this account until you choose it.'));status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
  if(data?.available)root.append(button('adopt-legacy',uiText`Connect my existing Muse: ${data.profile!.displayName}`,adopt,true));
  else if(mode==='error'||data?.adopted&&data.entry?.state!=='joined')root.append(button('check-legacy',uiText('다시 확인 / Check again'),refresh,true));
  if(data?.adopted)root.append(button('watch-legacy',uiText('내 Muse 보러가기 / Watch my Muse'),()=>options.onWatch?.(),data.entry?.state==='joined'));
  if(!alias&&!profile.profile&&mode!=='checking')root.append(button('new-muse',uiText('새 Muse 만들기 / Create a new Muse'),chooseNew));
 }
 const visibility=()=>{if(disposed)return;if(!foreground()){invalidate();data=null;if(mode!=='new')mode='checking';render();notify();}else if(visible&&eligible()&&!choiceNew)void refresh();};document.addEventListener('visibilitychange',visibility);render();
 return{state,refresh,async syncProfile(next:ProfileState){if(disposed)return;const key=(p:ProfileState)=>JSON.stringify([p.authenticated,p.profile?.actorId,p.profile?.revision,p.busy]);if(key(next)===key(profile))return;invalidate();profile={...next,profile:next.profile?{...next.profile}:null};data=null;mode='observer';if(next.authenticated===false||next.profile&&next.profile.actorId!=='00-jolly'){alias=false;intent=null;choiceNew=false;}render();notify();if(eligible()&&visible&&!choiceNew)await refresh();},setVisible(value:boolean){if(disposed||visible===value)return;visible=value;if(!value){invalidate();render();notify();}else if(eligible()&&!choiceNew)void refresh();},setExternalBusy(value:boolean){externalBusy=value;render();},dispose(){if(disposed)return;invalidate();disposed=true;data=null;document.removeEventListener('visibilitychange',visibility);root.remove();}};
}
