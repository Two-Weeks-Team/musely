import {beginJudgeSession,type SparkStatus} from '../live.ts';
import {uiText} from './i18n.ts';
/** A judge link opens only its visitor/judge session, never personal or owner authority. */
export function mountJudgeEntry(actions:{watch:()=>void;camera:()=>void;demo:()=>void;judge?:()=>void}) {
 const box=document.createElement('aside');box.id='judge-entry';box.className='judge-entry';box.hidden=true;box.setAttribute('aria-live','polite');
 let pending=false,failed=false,expires=0,disposed=false,generation=0,timer:ReturnType<typeof setTimeout>|undefined;
 const el=(tag:string,text:string)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const button=(text:string,action:()=>void)=>{const n=el('button',text) as HTMLButtonElement;n.type='button';n.className='link-button';n.onclick=action;return n;};
 function paint(session:SparkStatus['session']) {
  if(pending||failed)return;clearTimeout(timer);expires=session?.tier==='judge'?session.expiresAt:0;box.hidden=!expires||expires<=Date.now();box.replaceChildren();if(box.hidden)return;
  const details=document.createElement('details'),summary=el('summary',uiText('심사 세션 · 시간당 라이브 행동 120회 / Judge session · 120 live actions/hour')),steps=document.createElement('ol');
  for(const [text,action] of [[uiText('1 · 실시간 세계 관람 / 1 · Watch the live world'),actions.watch],[uiText('2 · 카메라 본인 확인 / 2 · Camera welcome check'),actions.camera],[uiText('3 · P0 데모: 사칭 · 지시 주입 · P0 실행 / 3 · P0 demo: impostor · instruction injection · P0 run'),actions.demo]] as const){const li=document.createElement('li');li.append(button(text,action));steps.append(li);}
  details.append(summary,steps);box.append(details);timer=setTimeout(()=>paint(null),Math.max(1,expires-Date.now()));
 }
 const start=beginJudgeSession();pending=start.attempted;if(pending){box.hidden=false;box.append(el('span',uiText('심사 링크 확인 중… / Checking judge link…')));}
 const initial=generation;const ready=start.result.then(session=>{if(disposed||initial!==generation)return;pending=false;if(start.attempted){paint(session);if(session?.tier==='judge')actions.judge?.();}}).catch(()=>{if(disposed||initial!==generation)return;pending=false;failed=true;box.hidden=false;box.replaceChildren(el('p',uiText('이 심사 링크는 유효하지 않아요. / This judge link is not valid')),button(uiText('계속 둘러보기 / Keep watching'),actions.watch));});
 async function openPublic(result:Promise<NonNullable<SparkStatus['session']>>){
  const mine=++generation;pending=true;failed=false;expires=0;clearTimeout(timer);box.hidden=false;box.replaceChildren(el('span',uiText('심사 입장 확인 중… / Opening judge access…')));
  try{const session=await result;if(disposed||mine!==generation)return null;pending=false;paint(session);actions.judge?.();return session;}
  catch(error){if(disposed||mine!==generation)return null;pending=false;failed=true;box.hidden=false;const code=error instanceof Error?error.message:'';const message=code==='judge_access_ended'?uiText('심사 입장이 종료되었어요. 관람은 누구나 할 수 있어요. / Judge access has ended — watching is open to everyone.'):code==='judge_access_limited'?uiText('잠시 뒤 심사 입장을 다시 선택해 주세요. 지금도 관람할 수 있어요. / Please try Judge access again shortly. You can keep watching.'):uiText('지금 심사 입장을 열지 못했어요. 잠시 뒤 다시 선택하거나 계속 관람해 주세요. / Judge access is unavailable right now. Try again shortly or keep watching.');box.replaceChildren(el('p',message),button(uiText('계속 둘러보기 / Keep watching'),actions.watch));return null;}
 }
 return {box,ready,attempted:start.attempted,openPublic,sync(session:SparkStatus['session']){if(session?.tier==='judge')failed=false;if(session?.tier==='judge'||expires<=Date.now())paint(session);if(session?.tier==='judge')actions.judge?.();},dispose(){disposed=true;generation++;clearTimeout(timer);box.remove();}};
}
