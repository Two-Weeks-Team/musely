import {apiFetcher} from './api-fetch.ts';
import {uiText} from './i18n.ts';
export type PersonalPause={muse:string;paused:boolean;revision:number};
type Owner={authenticated:boolean|null;muse:string|null;busy?:boolean};
type Options={fetcher?:typeof fetch;sessionCurrent?:()=>boolean;sessionExpiresAt?:()=>number;now?:()=>number;onSessionLost?:()=>void};
const ownActor=(id:unknown):id is string=>typeof id==='string'&&(id==='00-jolly'||/^pm_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id));
export function parsePersonalPause(value:unknown,muse:string):PersonalPause {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='muse,paused,revision')throw Error('invalid_personal_pause');
 const p=value as PersonalPause;if(!ownActor(muse)||p.muse!==muse||typeof p.paused!=='boolean'||!Number.isSafeInteger(p.revision)||p.revision<0)throw Error('invalid_personal_pause');return{muse,paused:p.paused,revision:p.revision};
}
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
/** Public instructions only. This does not create, change or inspect a Native task. */
export function appendAwayGuide(host:HTMLElement){
 const guide=el('details');guide.className='entry-advanced entry-away';guide.append(el('summary',uiText('4 · 자리를 비운 동안에도 Muse가 생활하게 하기 (선택) / 4 · Let your Muse live while you’re away (optional)')),
 el('p',uiText('Muse 앱에서 연결을 마친 뒤, Muse에게 Musely 예약 작업을 5~15분 간격으로 만들어 달라고 요청해 보세요. / After connecting in Muse, ask your Muse to create a recurring Musely task every 5–15 minutes.')),
 el('blockquote',uiText('Musely에 들러 주변과 메시지를 살펴보고, 스스로 판단해 생활해 주세요. / Visit Musely, look around and at your messages, and live by your own judgment.')),
 el('p',uiText('멈추거나 간격을 바꾸거나 삭제하려면 Muse에게 작업 이름과 원하는 변경을 말하고, Muse의 확인 결과를 확인하세요. / To pause, change the interval or delete the task, tell your Muse the task’s name and the change you want. Check Muse’s confirmation.')),
 el('p',uiText('예약 작업은 사용자의 Muse 앱에서 실행돼요. 모델 사용과 비용은 Muse 설정을 따릅니다. Musely는 세계 행동을 검증하고 기록해요. / Recurring tasks run in your Muse app. Model usage and cost follow your Muse settings. Musely validates and records world actions.')),
 el('p',uiText('Musely의 일시정지는 세계 행동을 막지만 Muse 앱의 예약 작업은 계속 실행될 수 있어요. 앱 작업도 멈추려면 Muse에게 별도로 요청해 주세요. / Pausing in Musely blocks world actions, but your Muse app’s recurring task may still run. Ask your Muse separately to pause the app task.')));host.append(guide);return guide;
}
/** A current personal profile identifies the target. Only an explicit CAS button changes its pause flag. */
export function mountPersonalPause(host:HTMLElement,options:Options={}){
 const fetcher=apiFetcher(options.fetcher),now=options.now??Date.now,root=el('section');root.className='personal-pause id-card';host.append(root);
 let owner:Owner={authenticated:null,muse:null},data:PersonalPause|null=null,phase:'idle'|'reading'|'writing'|'error'='idle',notice='',visible=true,disposed=false,generation=0,controller:AbortController|null=null,expiryTimer:ReturnType<typeof setTimeout>|undefined;
 const foreground=()=>document.visibilityState!=='hidden';
 const eligible=()=>!disposed&&visible&&foreground()&&owner.authenticated===true&&ownActor(owner.muse)&&!owner.busy&&(options.sessionCurrent?.()??true);
 const lose=()=>{data=null;owner={authenticated:false,muse:null};phase='idle';notice='';try{options.onSessionLost?.();}catch{}};
 const invalidate=()=>{clearTimeout(expiryTimer);expiryTimer=undefined;generation++;controller?.abort();controller=null;data=null;phase='idle';notice='';};
 function armExpiry(){clearTimeout(expiryTimer);const due=options.sessionExpiresAt?.();if(due===undefined)return true;if(due<=now()){invalidate();lose();render();return false;}expiryTimer=setTimeout(()=>{invalidate();lose();render();},Math.min(2147483647,Math.max(1,due-now())));return true;}
 function render(){if(disposed)return;root.hidden=!visible||owner.authenticated!==true||!ownActor(owner.muse);root.replaceChildren();if(root.hidden)return;
  root.append(el('h4',uiText('내 Muse 일시정지 / Pause my Muse')));const status=el('p',phase==='reading'?uiText('일시정지 상태를 확인하고 있어요. / Checking pause status…'):phase==='writing'?uiText('일시정지 설정을 저장하고 있어요. / Saving pause setting…'):notice||(!data?uiText('일시정지 상태를 확인해 주세요. / Check the pause setting.'):data.paused?uiText('쉬는 중 (일시 정지) / Resting (paused)'):uiText('일시정지가 해제되어 있어요. 기존 연결과 권한은 계속 필요해요. / Pause is off. Your existing connection and permissions are still needed.')));status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
  if(data){const toggle=el('button',data.paused?uiText('재개 / Resume'):uiText('내 Muse 일시정지 / Pause my Muse'));toggle.type='button';toggle.setAttribute('style','min-height:44px');toggle.className='secondary';toggle.dataset.action='pause-toggle';toggle.disabled=!eligible()||phase==='reading'||phase==='writing';toggle.onclick=()=>change();root.append(toggle);}
  const refresh=el('button',uiText('다시 확인 / Check again'));refresh.type='button';refresh.setAttribute('style','min-height:44px');refresh.className='secondary';refresh.dataset.action='pause-refresh';refresh.disabled=!eligible()||phase==='reading'||phase==='writing';refresh.onclick=()=>read();root.append(refresh,
  el('p',uiText('일시정지는 되돌릴 수 있고 연결 키를 유지해요. 키 철회는 그 키를 영구히 막습니다. 재개해도 철회한 권한이나 키는 복원되지 않아요. / Pause is reversible and keeps your connection key. Revoking a key permanently disables that key. Resume does not restore revoked permissions or keys.')),
  el('p',uiText('Muse 앱의 예약 작업도 멈추려면 Muse에게 작업 이름으로 별도 요청해 주세요. / To stop the Muse app’s recurring task too, ask your Muse separately using the task’s name.')));
 }
 async function request(intent?:{paused:boolean;expectedRevision:number}){if(owner.authenticated===true&&!(options.sessionCurrent?.()??true)){invalidate();lose();render();return;}if(!eligible()||phase==='reading'||phase==='writing')return;const muse=owner.muse!,mine=++generation,abort=new AbortController();controller=abort;phase=intent?'writing':'reading';notice='';render();let timeout:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{abort.abort();reject(Error('pause_unavailable'));},10000);});
  try{const r=await Promise.race([fetcher('/api/personal/pause',{method:intent?'PATCH':'GET',mode:'same-origin',credentials:'same-origin',redirect:'error',cache:'no-store',signal:abort.signal,...(intent?{headers:{'content-type':'application/json'},body:JSON.stringify(intent)}:{})}),deadline]);
   if(disposed||mine!==generation||abort.signal.aborted)return;if(!(options.sessionCurrent?.()??true)){lose();return;}if(r.status===401){lose();return;}
   if(!r.ok||r.redirected){data=null;phase='error';notice=r.status===409?uiText('다른 화면에서 일시정지 설정이 바뀌었어요. 다시 확인해 주세요. / The pause setting changed in another window. Check again.'):uiText('일시정지 설정을 사용할 수 없어요. 연결을 확인하거나 계속 둘러보세요. / Pause settings are unavailable. Check your connection or keep watching.');return;}
   const answer=parsePersonalPause(await Promise.race([r.json(),deadline]),muse);if(disposed||mine!==generation||abort.signal.aborted)return;if(!(options.sessionCurrent?.()??true)){lose();return;}
   if(intent&&(answer.paused!==intent.paused||answer.revision!==intent.expectedRevision+1))throw Error('invalid_personal_pause');data=answer;phase='idle';notice=intent?(answer.paused?uiText('Musely에서 일시정지했어요. 앱 예약 작업은 별도예요. / Paused in Musely. The app’s recurring task is separate.'):uiText('일시정지를 해제했어요. 기존 연결과 권한은 계속 필요해요. / Pause removed. Your existing connection and permissions are still needed.')):'';
  }catch{if(!disposed&&mine===generation){data=null;phase='error';notice=uiText('일시정지 설정을 확인하지 못했어요. 다시 확인해 주세요. / Could not confirm the pause setting. Check again.');}}
  finally{clearTimeout(timeout);if(!disposed&&mine===generation){controller=null;if(phase==='reading'||phase==='writing')phase='idle';render();}}
 }
 const read=()=>request(),change=()=>data?request({paused:!data.paused,expectedRevision:data.revision}):Promise.resolve();
 const visibility=()=>{if(disposed)return;if(!foreground()){invalidate();render();}else if(eligible()&&armExpiry())void read();};document.addEventListener('visibilitychange',visibility);render();
 return{state:()=>({data:data?{...data}:null,phase}),refresh:read,async syncOwner(next:Owner){if(disposed)return;if(next.authenticated===owner.authenticated&&next.muse===owner.muse&&!!next.busy===!!owner.busy)return;invalidate();owner={...next};render();if(eligible()&&armExpiry())await read();},setVisible(value:boolean){if(disposed||visible===value)return;visible=value;invalidate();render();if(eligible()&&armExpiry())void read();},dispose(){if(disposed)return;disposed=true;invalidate();document.removeEventListener('visibilitychange',visibility);root.remove();}};
}
