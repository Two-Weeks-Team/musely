import {apiFetcher} from './api-fetch.ts';
import {uiLanguage} from './i18n.ts';
import {isSocialMode,isSocialStatus,type SocialMode,type SocialStatus} from '../engine/social-status.ts';
export type OwnSocialStatus={muse:string;mode:SocialMode;revision:number;status:SocialStatus};
type OwnerState={authenticated:boolean|null;muse:string|null;busy?:boolean};
type Options={language?:'ko'|'en';fetcher?:typeof fetch;endpoint?:(muse:string)=>string;onSessionLost?:()=>void;onWriteBusy?:(busy:boolean)=>void};
const texts={ko:{title:'내 Muse 상태',detail:'주민에게 이 상태만 보여요. 이유나 실제 위치는 보내지 않아요.',auto:'활동에 맞추기',welcoming:'대화 환영',busy:'바쁨',do_not_disturb:'방해 금지',save:'상태 바꾸기',refresh:'다시 확인',signedout:'내 Muse를 연결하면 상태를 바꿀 수 있어요.',checking:'상태를 확인하고 있어요.',saving:'상태를 바꾸고 있어요.',error:'상태를 확인하지 못했어요. 다시 확인해 주세요.',conflict:'다른 화면에서 상태가 바뀌었어요. 다시 확인해 주세요.',saved:'상태를 바꿨어요.',unavailable:'상태 설정을 아직 사용할 수 없어요. 계속 둘러보세요.'},
 en:{title:'My Muse status',detail:'Neighbors see only this status. No reason or real location is sent.',auto:'Follow my activity',welcoming:'Open to chat',busy:'Busy',do_not_disturb:'Do not disturb',save:'Change status',refresh:'Check again',signedout:'Connect your Muse to change its status.',checking:'Checking status…',saving:'Changing status…',error:'Could not check the status. Please check again.',conflict:'The status changed in another window. Please check again.',saved:'Status changed.',unavailable:'Status settings aren’t available yet. Keep exploring.'}} as const;
export const socialStatusLabel=(status:SocialStatus,language:'ko'|'en'='en')=>texts[language][status];
/** Render only the availability in the supplied live or recorded snapshot. Never consult current private settings. */
export function paintAvailabilityLabel(host:HTMLElement,value:unknown,language:'ko'|'en'='en'):void {
 const status=value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&'status'in value?value.status:null;
 host.hidden=!isSocialStatus(status);host.textContent=isSocialStatus(status)?socialStatusLabel(status,language):'';
}
export function parseOwnSocialStatus(value:unknown,muse:string):OwnSocialStatus {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='mode,muse,revision,status')throw Error('invalid_social_status');
 const x=value as OwnSocialStatus;
 if(x.muse!==muse||!isSocialMode(x.mode)||!isSocialStatus(x.status)||!Number.isSafeInteger(x.revision)||x.revision<0||(x.mode!=='auto'&&x.mode!==x.status))throw Error('invalid_social_status');
 return{muse:x.muse,mode:x.mode,revision:x.revision,status:x.status};
}
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
/** Explicit mount only. Fetches no personal identity and never logs in, grants or emits world actions. */
export function mountSocialStatus(host:HTMLElement,options:Options={}){
 const language=options.language??uiLanguage(),t=texts[language];
 const root=element('section');root.className='id-card social-status';host.append(root);
 let owner:OwnerState={authenticated:null,muse:null},data:OwnSocialStatus|null=null,selected:SocialMode='auto',phase:'idle'|'reading'|'writing'|'error'='idle';
 let visible=true,externalBusy=false,disposed=false,generation=0,controller:AbortController|null=null,notice='';
 const foreground=()=>document.visibilityState!=='hidden';
 const eligible=()=>!disposed&&visible&&foreground()&&!externalBusy&&!owner.busy&&owner.authenticated===true&&typeof owner.muse==='string'&&owner.muse.length>0;
 const notifyBusy=(value:boolean)=>{try{options.onWriteBusy?.(value);}catch{}};
 const invalidate=()=>{generation++;controller?.abort();controller=null;if(phase==='writing')notifyBusy(false);phase='idle';};
 const state=()=>({data:data?{...data}:null,phase,selected});
 const path=(muse:string)=>{
  const p=options.endpoint?.(muse)??'/api/owner/social-status?muse='+encodeURIComponent(muse);
  if(typeof p!=='string'||!p.startsWith('/api/')||p.includes('#'))throw Error('invalid_social_endpoint');
  const u=new URL(p,'https://musely.invalid');
  if(u.origin!=='https://musely.invalid'||!['/api/owner/social-status','/api/personal/owner/social-status','/api/personal/social-status'].includes(u.pathname))throw Error('invalid_social_endpoint');
  if(['/api/owner/social-status','/api/personal/owner/social-status'].includes(u.pathname)&&(u.searchParams.getAll('muse').length!==1||u.searchParams.get('muse')!==muse||[...u.searchParams.keys()].some(k=>k!=='muse')))throw Error('invalid_social_endpoint');
  if(u.pathname==='/api/personal/social-status'&&u.search)throw Error('invalid_social_endpoint');return p;
 };
 function render(){
  if(disposed)return;root.hidden=!visible;root.replaceChildren(element('h4',t.title),element('p',t.detail));
  const result=element('p');result.className='muted';result.setAttribute('role','status');result.setAttribute('aria-live','polite');
  if(owner.authenticated!==true||!owner.muse){result.textContent=t.signedout;root.append(result);return;}
  if(data){const label=element('p',socialStatusLabel(data.status,language));label.className='src';root.append(label);
   const field=element('label'),caption=element('span',t.title),select=element('select');select.dataset.action='mode';select.setAttribute('aria-label',t.title);select.setAttribute('style','display:block;max-width:100%;min-height:44px');
   for(const mode of['auto','welcoming','busy','do_not_disturb'] as const){const option=element('option',t[mode]);option.value=mode;select.append(option);}select.value=selected;
   select.disabled=phase==='reading'||phase==='writing'||!eligible();select.onchange=()=>{if(isSocialMode(select.value)){selected=select.value;render();}};field.append(caption,select);root.append(field);
   const save=element('button',t.save);save.type='button';save.className='primary';save.dataset.action='save';save.setAttribute('style','min-height:44px');save.disabled=!eligible()||phase==='reading'||phase==='writing'||selected===data.mode;save.onclick=()=>saveSelected();root.append(save);
  }
  result.textContent=phase==='reading'?t.checking:phase==='writing'?t.saving:notice;root.append(result);
  const refresh=element('button',t.refresh);refresh.type='button';refresh.className='secondary';refresh.dataset.action='refresh';refresh.setAttribute('style','min-height:44px');refresh.disabled=!eligible()||phase==='reading'||phase==='writing';refresh.onclick=()=>read();root.append(refresh);
 }
 async function request(method:'GET'|'PATCH',intent?:{mode:SocialMode;expectedRevision:number}){
  if(!eligible()||phase==='writing'||phase==='reading')return;
  const muse=owner.muse!,mine=++generation;controller=new AbortController();const abort=controller;phase=method==='PATCH'?'writing':'reading';notice='';if(method==='PATCH')notifyBusy(true);render();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('social_status_timeout'));},10000);});
  try{
   const r=await Promise.race([apiFetcher(options.fetcher)(path(muse),{method,mode:'same-origin',credentials:'same-origin',redirect:'error',cache:'no-store',signal:abort.signal,...(intent?{headers:{'content-type':'application/json'},body:JSON.stringify(intent)}:{})}),deadline]);
   if(mine!==generation||!eligible())return;
   if(r.status===401){data=null;owner={authenticated:false,muse:null};notice='';try{options.onSessionLost?.();}catch{}return;}
   if(!r.ok||r.redirected){data=null;phase='error';notice=r.status===409?t.conflict:r.status===503?t.unavailable:t.error;return;}
   const answer=parseOwnSocialStatus(await Promise.race([r.json(),deadline]),muse);
   if(mine!==generation||!eligible())return;
   if(intent&&(answer.mode!==intent.mode||answer.revision!==intent.expectedRevision+1))throw Error('invalid_social_status');
   data=answer;selected=answer.mode;phase='idle';notice=method==='PATCH'?t.saved:'';
  }catch{if(mine===generation){data=null;phase='error';notice=t.error;}}
  finally{if(timer!==undefined)clearTimeout(timer);if(mine===generation){controller=null;if(phase==='writing'||phase==='reading')phase='idle';if(method==='PATCH')notifyBusy(false);render();}}
 }
 const read=()=>request('GET');
 const saveSelected=()=>{if(!data||selected===data.mode)return Promise.resolve();return request('PATCH',{mode:selected,expectedRevision:data.revision});};
 const visibility=()=>{if(disposed)return;if(!foreground()){invalidate();data=null;notice='';render();}else if(visible&&eligible())void read();};document.addEventListener('visibilitychange',visibility);render();
 return{state,refresh:read,async syncOwner(next:OwnerState){if(disposed)return;const same=next.authenticated===owner.authenticated&&next.muse===owner.muse&&!!next.busy===!!owner.busy;if(same)return;invalidate();owner={...next};data=null;notice='';render();if(eligible())await read();},setVisible(value:boolean){if(disposed||visible===value)return;visible=value;invalidate();data=null;notice='';render();if(eligible())void read();},setExternalBusy(value:boolean){if(disposed||externalBusy===value)return;externalBusy=value;invalidate();data=null;render();if(eligible())void read();},dispose(){if(disposed)return;invalidate();disposed=true;data=null;document.removeEventListener('visibilitychange',visibility);root.remove();}};
}
