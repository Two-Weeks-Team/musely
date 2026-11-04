import {JUDGE_MUSE} from './judge-muse.ts';
/** In-world public speech only. Never owner coordinates, private inbox, identity or authority. */
import type {MuseState,WorldState} from './world.ts';
import {placeById} from './places.ts';
import {participantName} from './participants.ts';
export const CONVERSATION_RANGE_M=50;
export function publicActorPosition(actor:MuseState,now:number):{x:number;z:number}|null {
 if(!Number.isSafeInteger(now)||now<0)return null;
 if(actor.id===JUDGE_MUSE.id&&Number.isSafeInteger(actor.residentFrozenAt))now=Math.min(now,actor.residentFrozenAt!);
 try{const from=placeById(actor.place),t=actor.travel;if(!t)return{x:from.x,z:from.z};
  if(![t.departAt,t.arriveAt].every(n=>Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER)||t.arriveAt<=t.departAt)return null;
  const to=placeById(t.to),progress=Math.max(0,Math.min(1,(now-t.departAt)/(t.arriveAt-t.departAt)));
  return{x:from.x+(to.x-from.x)*progress,z:from.z+(to.z-from.z)*progress};
 }catch{return null;}
}
export function withinConversationRange(a:MuseState,b:MuseState,now:number):boolean {
 const p=publicActorPosition(a,now),q=publicActorPosition(b,now);return!!p&&!!q&&Math.hypot(p.x-q.x,p.z-q.z)<=CONVERSATION_RANGE_M;
}
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Name recognition only requires an explicit recipient; it never infers or chooses that recipient. */
export function mentionsOtherMuse(s:WorldState,actorId:string,line:string):boolean {
 const text=line.normalize('NFKC');
 return s.muses.some(actor=>{if(actor.id===actorId)return false;const name=participantName(s,actor.id).normalize('NFKC');
  return new RegExp('(^|[^\\p{L}\\p{N}_])'+escape(name)+'(?=$|[^\\p{L}\\p{N}_]|(?:님|씨|야|아|에게|한테|은|는|이|가|와|과)(?=$|[^\\p{L}\\p{N}_]))','iu').test(text);
 });
}
