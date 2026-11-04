/** Life03 scheduling and conversation accounting over authoritative snapshots/committed events.
 * Pure data only: no timers, model, key, private owner state, or world mutation.
 */
import {hasActorHarness} from '../../src/engine/harness.ts';
import {isRuntimeControlled} from '../../src/engine/inbox.ts';
import {lastConversationAt,socialDistance,type ConversationReceipt,type WorldEvent,type WorldState} from '../../src/engine/world.ts';
import type {ResidentOwnershipKind} from './resident-life-adapter.ts';
export type OperatingResidentControl=(id:string,now:number)=>'resident'|'connected'|'unknown';
const operating=(id:string)=>id==='04-ember'||id==='09-copper';
export function residentEligible(world:WorldState,id:string,now:number,ownership:(id:string)=>ResidentOwnershipKind,control?:OperatingResidentControl):boolean {
 const m=world.muses.find(x=>x.id===id);
 if(!m||id==='00-jolly'||id.startsWith('pm_')||!hasActorHarness(id)||m.profile||m.controlMode==='personal'||world.paused?.[id]||ownership(id)!=='resident')return false;
 // Only the server's current active-key/presence handoff can supersede an old operator lease.
 if(operating(id))return control?.(id,now)==='resident';
 return !isRuntimeControlled(world,id,now);
}
export function dueResidents(world:WorldState,now:number,ownership:(id:string)=>ResidentOwnershipKind,control?:OperatingResidentControl):string[] {
 return world.muses.filter(m=>residentEligible(world,m.id,now,ownership,control)&&(!m.travel||m.travel.arriveAt<=now)&&(!m.beat||m.beat.endsAt<=now)&&!m.intent
  &&!world.inbox?.tasks.some(t=>t.status==='pending'&&(t.from===m.id||t.to===m.id))
  &&!(world.inbox?.invites??[]).some(i=>i.status==='open'&&(i.from===m.id||i.to.includes(m.id))))
  .map(m=>m.id).sort();
}
/** Input projection only; the real tick must still commit the actual arrival/finish first. */
export function decisionWorld(world:WorldState,id:string,now:number):WorldState {
 const next=structuredClone(world),m=next.muses.find(x=>x.id===id);
 if(!m)throw Error('unknown resident');
 if(m.travel&&m.travel.arriveAt<=now){m.place=m.travel.to;m.travel=null;}
 if(m.beat&&m.beat.endsAt<=now)m.beat=null;
 return next;
}
export {restoreDialogues,type Dialogue} from '../../src/engine/resident-life.ts';
import {restoreDialogues,type Dialogue} from '../../src/engine/resident-life.ts';
export const DIALOGUE_MAX_MESSAGES=8,PAIR_COOLDOWN_MS=30*60000,AFTER_DIALOGUE_MS=2*60000;
const bounded=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=160&&!/[\u0000-\u001f<>]/.test(s);
const at=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
function pair(a:string,b:string){if(!bounded(a)||!bounded(b)||a===b)throw Error('invalid dialogue actor');return[a,b].sort();}
export function canReply(input:readonly Dialogue[],from:string,to:string,now:number):boolean {
 const rows=restoreDialogues(input),[a,b]=pair(from,to);if(!at(now))throw Error('invalid dialogue time');
 const r=rows.find(r=>r.a===a&&r.b===b);
 if(r&&now<r.lastAt)return false;
 if(rows.some(x=>(x.a===from||x.b===from||x.a===to||x.b===to)&&x.closedAt!==null&&now-x.closedAt<AFTER_DIALOGUE_MS))return false;
 if(r?.closedAt!==null&&r?.closedAt!==undefined)return now-r.startedAt>=PAIR_COOLDOWN_MS;
 if(r)return r.messages<DIALOGUE_MAX_MESSAGES&&r.lastSpeaker!==from;
 return !rows.some(x=>x.closedAt===null&&(x.a===from||x.b===from||x.a===to||x.b===to));
}
/** Count only a committed public greeting/reply. Extra event fields are never retained. */
export function recordDialogue(input:readonly Dialogue[],event:{id:string;from:string;to:string;at:number}):Dialogue[]{
 const rows=restoreDialogues(input),[a,b]=pair(event.from,event.to);if(!bounded(event.id)||!at(event.at))throw Error('invalid dialogue event');
 const prior=rows.find(r=>r.eventIds.includes(event.id));
 if(prior){if(prior.a!==a||prior.b!==b)throw Error('dialogue event conflict');return rows;}
 if(!canReply(rows,event.from,event.to,event.at))throw Error('dialogue limit');
 let r=rows.find(x=>x.a===a&&x.b===b);
 if(!r){if(rows.length>=256)throw Error('dialogue capacity');r={a,b,startedAt:event.at,lastAt:event.at,lastSpeaker:event.from,messages:0,closedAt:null,eventIds:[]};rows.push(r);}
 if(r.closedAt!==null){r.startedAt=event.at;r.messages=0;r.eventIds=[];r.closedAt=null;}
 r.lastAt=event.at;r.lastSpeaker=event.from;r.messages++;r.eventIds.push(event.id);
 if(r.messages===DIALOGUE_MAX_MESSAGES)r.closedAt=event.at;
 return restoreDialogues(rows);
}
export function closeDialogue(input:readonly Dialogue[],from:string,to:string,now:number):Dialogue[]{
 const rows=restoreDialogues(input),[a,b]=pair(from,to),r=rows.find(x=>x.a===a&&x.b===b);
 if(!at(now)||r&&now<r.lastAt)throw Error('invalid dialogue close');
 if(r&&r.closedAt===null)r.closedAt=now;
 return rows;
}
export type SocialStatus='welcoming'|'busy'|'do_not_disturb';
export type ReactionCandidate={muse:string;other:string;place:string;triggerId:string;encounterId:string;incoming:string|null;kind:'reply'|'wave'};
export function reactionCandidates(world:WorldState,events:readonly WorldEvent[],input:readonly Dialogue[],now:number,
 ownership:(id:string)=>ResidentOwnershipKind,status:(world:WorldState,id:string,now:number)=>SocialStatus,control?:OperatingResidentControl,respectAvailability=false,conversationHistory?:readonly ConversationReceipt[]):{candidates:ReactionCandidate[];dialogues:Dialogue[]}{
 let rows=settleDialogues(input,world,now);const candidates:ReactionCandidate[]=[];
 for(const e of events){
  if(!e.muse||!e.other||e.at<world.lastTickAt||e.at>now||!(e.kind==='greet'&&e.data?.public===true||e.kind==='encounter_reply')||!residentEligible(world,e.other,now,ownership,control)||world.paused?.[e.muse])continue;
  const a=world.muses.find(m=>m.id===e.other),b=world.muses.find(m=>m.id===e.muse);if(!a||!b||socialDistance(world,a.id,b.id,now)>100||candidates.some(c=>c.muse===a.id))continue;
  if(status(world,a.id,now)==='do_not_disturb'||status(world,b.id,now)==='do_not_disturb')continue;
  const recorded=rows.find(r=>r.eventIds.includes(e.id));
  if(recorded&&recorded.eventIds.at(-1)!==e.id)continue;
  if(!recorded){try{rows=recordDialogue(rows,{id:e.id,from:b.id,to:a.id,at:e.at});}catch{continue;}}
  if(!canReply(rows,a.id,b.id,now))continue;
  const personal=b.controlMode==='personal'||!hasActorHarness(b.id)||b.id==='00-jolly'||ownership(b.id)==='personal';
  const busy=!!a.travel||!!b.travel||status(world,a.id,now)==='busy'||status(world,b.id,now)==='busy';
  candidates.push({muse:a.id,other:b.id,place:a.place,triggerId:e.id,encounterId:`reply:${e.id}`,incoming:typeof e.line==='string'?e.line.slice(0,400):null,kind:(respectAvailability&&(status(world,a.id,now)==='busy'||status(world,b.id,now)==='busy')||busy&&!personal)?'wave':'reply'});
 }
 // Passing is a public world fact, not a hello or answer chosen for the other Muse.
 const personal=(id:string)=>id==='00-jolly'||world.muses.find(m=>m.id===id)?.controlMode==='personal'||ownership(id)==='personal';
 for(const actor of world.muses){
  if(candidates.some(c=>c.muse===actor.id)||!residentEligible(world,actor.id,now,ownership,control)||status(world,actor.id,now)==='do_not_disturb')continue;
  const peers=world.muses.filter(other=>other.id!==actor.id&&!world.paused?.[other.id]&&(actor.travel&&actor.travel.arriveAt>now||other.travel&&other.travel.arriveAt>now)
   &&status(world,other.id,now)!=='do_not_disturb'&&socialDistance(world,actor.id,other.id,now)<=100
   &&now-lastConversationAt(world,actor.id,other.id,now,conversationHistory,events)>=PAIR_COOLDOWN_MS&&canReply(rows,actor.id,other.id,now))
   .sort((a,b)=>Number(personal(b.id))-Number(personal(a.id))||socialDistance(world,actor.id,a.id,now)-socialDistance(world,actor.id,b.id,now)||a.id.localeCompare(b.id));
  const peer=peers[0];if(!peer)continue;
  const triggerId=`passby:${world.day}:${world.tick}:${[actor.id,peer.id].sort().join('|')}`;
  candidates.push({muse:actor.id,other:peer.id,place:actor.place,triggerId,encounterId:triggerId,incoming:null,kind:personal(peer.id)&&(!respectAvailability||status(world,actor.id,now)==='welcoming'&&status(world,peer.id,now)==='welcoming')?'reply':'wave'});
 }
 return{candidates,dialogues:rows};
}

/** Commit this copy and its RULE events together; never infer handoff merely from key expiry. */
export function handoffOperatingResidents(world:WorldState,now:number,ownership:(id:string)=>ResidentOwnershipKind,control:OperatingResidentControl):{world:WorldState;changed:boolean;events:Omit<WorldEvent,'id'|'tick'>[]}{
 const next=structuredClone(world),events:Omit<WorldEvent,'id'|'tick'>[]=[];
 for(const id of ['04-ember','09-copper']){
  if(!residentEligible(next,id,now,ownership,control)||next.inbox?.connected[id]===undefined)continue;
  delete next.inbox.connected[id];
  events.push({at:now,source:'rule',kind:'resident_control_handoff',muse:id,data:{from:'operator_presence',to:'resident_life'},tags:[]});
 }
 return{world:next,changed:events.length>0,events};
}
/** Only public departure/availability facts end an unfinished conversation; no fictional reply is inserted. */
export function settleDialogues(input:readonly Dialogue[],world:WorldState,now:number):Dialogue[]{
 if(!at(now))throw Error('invalid dialogue time');
 return restoreDialogues(input).map(r=>r.closedAt===null&&(world.paused?.[r.a]||world.paused?.[r.b]||socialDistance(world,r.a,r.b,now)>100)?{...r,closedAt:Math.max(now,r.lastAt)}:r)
  .filter(r=>r.closedAt===null||now<Math.max(r.startedAt+PAIR_COOLDOWN_MS,r.closedAt+AFTER_DIALOGUE_MS));
}
