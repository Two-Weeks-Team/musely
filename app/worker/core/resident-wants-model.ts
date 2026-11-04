import {bindWorldClock} from './world-clock-input.ts';
import {PUBLIC_SPEECH_NOT_ENGLISH} from './resident-english-speech.ts';
/** Opt-in model preparation boundary. No production caller or executor is installed.
 * Reuse the existing transport/schema/budget. Returned choices are NOT committed actions.
 */
import {validate,buildMessages,checkOutput,maxCostUsd,actualCostUsd,failureCostUsd} from './actions.ts';
import {callModel,type ModelConfig} from './model.ts';
import {type Ledger,type Sql} from './ledger.ts';
import {hasResidentHarness} from './resident-harness.ts';
import {PRINCIPALS} from './owner-session.ts';
import {isRuntimeControlled} from '../../src/engine/inbox.ts';
import {sha256Hex} from '../../src/engine/sha256.ts';
import {BEATS} from '../../src/engine/beats.ts';
import {checkTrade} from '../../src/engine/items.ts';
import {type WorldState,type WorldEvent} from '../../src/engine/world.ts';
import {goalTradeUtility,verifyUse,type UseGoal} from '../../src/engine/wants-use.ts';
export type GoalRow={revision:number;goal:UseGoal};
const bounded=(s:unknown):s is string=>typeof s==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(s);
function clean(g:UseGoal):UseGoal {
 if(!g||!bounded(g.id)||!bounded(g.muse)||!bounded(g.beat)||![g.createdAt,g.expiresAt].every(Number.isSafeInteger)||g.createdAt<0||g.expiresAt<=g.createdAt||!['active','cancelled','fulfilled'].includes(g.status))throw Error('invalid goal');
 return {id:g.id,muse:g.muse,beat:g.beat,createdAt:g.createdAt,expiresAt:g.expiresAt,status:g.status};
}
/** The host must use the SAME outer transaction as world/events for status updates.
 * This store never infers fulfillment from a model answer or an agreement.
 */
export class ResidentGoalStore {
 private sql:Sql;
 constructor(sql:Sql){this.sql=sql;}
 /** Identity check, not an exposed storage handle. Required for shared commit atomicity. */
 sharesStorage(sql:Sql):boolean{return this.sql===sql;}
 init(){this.sql.exec('CREATE TABLE IF NOT EXISTS resident_trade_refusals (world_id TEXT NOT NULL, actor TEXT NOT NULL, peer TEXT NOT NULL, give_item TEXT NOT NULL, receive_item TEXT NOT NULL, until_at INTEGER NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(world_id,actor,peer,give_item,receive_item))');this.sql.exec('CREATE TABLE IF NOT EXISTS resident_wants_turns (world_id TEXT NOT NULL, day TEXT NOT NULL, tick INTEGER NOT NULL, reservation_id TEXT NOT NULL, PRIMARY KEY(world_id,day,tick))');this.sql.exec('CREATE TABLE IF NOT EXISTS resident_wants_decisions (world_id TEXT NOT NULL, reservation_id TEXT NOT NULL, goal_id TEXT NOT NULL, task_id TEXT NOT NULL, decision TEXT NOT NULL, PRIMARY KEY(world_id,reservation_id))');this.sql.exec('CREATE TABLE IF NOT EXISTS resident_wants_receipts (world_id TEXT NOT NULL, goal_id TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(world_id,goal_id))');this.sql.exec('CREATE TABLE IF NOT EXISTS resident_wants_goals (world_id TEXT NOT NULL, goal_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(world_id,goal_id))');}
 refusalUntil(world:string,actor:string,peer:string,give:string,receive:string):number {const row=this.sql.exec('SELECT until_at FROM resident_trade_refusals WHERE world_id=? AND actor=? AND peer=? AND give_item=? AND receive_item=?',world,actor,peer,give,receive).toArray()[0];return row?Number(row.until_at):0;}
 recordRefusalInTransaction(world:string,actor:string,peer:string,give:string,receive:string,at:number,eventId:string){
  if(![world,actor,peer,give,receive].every(bounded)||!Number.isSafeInteger(at)||at<0||typeof eventId!=='string'||eventId.length>512)throw Error('invalid refusal evidence');
  this.sql.exec('DELETE FROM resident_trade_refusals WHERE world_id=? AND until_at<=?',world,at);
  this.sql.exec('INSERT INTO resident_trade_refusals (world_id,actor,peer,give_item,receive_item,until_at,event_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(world_id,actor,peer,give_item,receive_item) DO UPDATE SET until_at=MAX(until_at,excluded.until_at),event_id=CASE WHEN excluded.until_at>=until_at THEN excluded.event_id ELSE event_id END',world,actor,peer,give,receive,at+30*60000,eventId);
 }
 activeFor(world:string,muse:string):GoalRow[] {return this.sql.exec('SELECT revision,body FROM resident_wants_goals WHERE world_id=? ORDER BY goal_id',world).toArray().map(r=>({revision:Number(r.revision),goal:clean(JSON.parse(String(r.body)))})).filter(r=>r.goal.muse===muse&&r.goal.status==='active');}
 load(world:string,id:string):GoalRow|null {const r=this.sql.exec('SELECT revision,body FROM resident_wants_goals WHERE world_id=? AND goal_id=?',world,id).toArray()[0];if(!r)return null;if(!Number.isSafeInteger(r.revision)||Number(r.revision)<0)throw Error('invalid stored revision');return {revision:Number(r.revision),goal:clean(JSON.parse(String(r.body)))};}
 saveInTransaction(world:string,expected:number|null,goal:UseGoal):number {
  if(goal.status==='fulfilled')throw Error('fulfillment requires engine evidence');
  return this.write(world,expected,goal);
 }
 completeInTransaction(world:string,id:string,expected:number,before:WorldState,after:WorldState,events:readonly WorldEvent[],now:number):number {
  const row=this.load(world,id);if(!row||row.revision!==expected||before.worldId!==world||after.worldId!==world)throw Error('stale goal');
  const result=verifyUse(row.goal,before,after,events,now);if(!result.fulfilled)throw Error('unverified goal use:'+result.reason);
  const revision=this.write(world,expected,{...row.goal,status:'fulfilled'});
  this.sql.exec('INSERT INTO resident_wants_receipts (world_id,goal_id,event_id) VALUES (?,?,?)',world,id,result.evidenceId);
  return revision;
 }
 turnConsumed(world:string,day:string,tick:number):boolean {return !!this.sql.exec('SELECT 1 FROM resident_wants_turns WHERE world_id=? AND day=? AND tick=?',world,day,tick).toArray()[0];}
 recordTurnInTransaction(world:string,day:string,tick:number,reservationId:string){this.sql.exec('INSERT INTO resident_wants_turns (world_id,day,tick,reservation_id) VALUES (?,?,?,?)',world,day,tick,reservationId);}
 recordDecisionInTransaction(world:string,id:string,expected:number,reservationId:string,taskId:string,decision:'accept'|'counter'|'reject'):number {
  const row=this.load(world,id);if(!row||row.revision!==expected||row.goal.status!=='active')throw Error('stale goal');
  const revision=this.write(world,expected,row.goal);
  this.sql.exec('INSERT INTO resident_wants_decisions (world_id,reservation_id,goal_id,task_id,decision) VALUES (?,?,?,?,?)',world,reservationId,id,taskId,decision);return revision;
 }
 private write(world:string,expected:number|null,goal:UseGoal):number {
  if(!bounded(world))throw Error('invalid world');const g=clean(goal),old=this.load(world,g.id);
  if((old?.revision??null)!==expected)throw Error('stale goal');
  if(old&&(old.goal.muse!==g.muse||old.goal.beat!==g.beat||old.goal.createdAt!==g.createdAt||old.goal.expiresAt!==g.expiresAt||old.goal.status!=='active'&&g.status!==old.goal.status))throw Error('invalid goal transition');
  const revision=(old?.revision??-1)+1;if(!Number.isSafeInteger(revision))throw Error('revision overflow');
  this.sql.exec('INSERT INTO resident_wants_goals (world_id,goal_id,revision,body) VALUES (?,?,?,?) ON CONFLICT(world_id,goal_id) DO UPDATE SET revision=excluded.revision,body=excluded.body',world,g.id,revision,JSON.stringify(g));return revision;
 }
}
export type WantsModelContext={enabled?:boolean;residentValuesEnabled?:boolean;world:()=>WorldState;now:()=>number;ownership:(id:string)=>'resident'|'personal'|'legacy'|'unknown';
 /** Shared runtime slot gate, not a second independent concurrency pool. */
 acquireSlot:()=>null|(()=>void);ledger:Ledger;model:ModelConfig|null;goals:ResidentGoalStore};
export type TradeChoice={decision:'accept'|'counter'|'reject';counter_give:string;counter_want:string;line:string};
export async function prepareResidentTrade(c:WantsModelContext,goalId:string,taskId:string){
 const no=(reason:string)=>({ok:false as const,reason});if(c.enabled!==true)return no('disabled');
 const before=structuredClone(c.world()),row=c.goals.load(before.worldId,goalId),now=c.now();
 const eligible=(s:WorldState,r:GoalRow|null)=>{if(!r||r.goal.status!=='active'||r.goal.createdAt>c.now()||r.goal.expiresAt<=c.now())return false;const id=r.goal.muse;
 return hasResidentHarness(id)&&!Object.values(PRINCIPALS).some(p=>p.id!=='shared-judge'&&p.muses.includes(id))&&c.ownership(id)==='resident'&&!s.paused?.[id]&&!isRuntimeControlled(s,id,c.now());};
 if(!eligible(before,row))return no('owner_authority_required');
 const actor=before.muses.find(m=>m.id===row!.goal.muse),task=before.inbox?.tasks.find(t=>t.id===taskId);
 if(!actor||actor.travel||actor.beat||!task||task.kind!=='trade'||task.status!=='pending'||task.awaiting!==actor.id||task.deadline<=now||!task.offer)return no('no_actionable_trade');
 const other=before.muses.find(m=>m.id===task.offer!.by);if(!other||other.id===actor.id||other.travel)return no('invalid_peer');
 if(!hasResidentHarness(other.id))return no('unsupported_peer_harness');
 let input:ReturnType<typeof validate>,messages:unknown[];
 try {input=validate('trade',{muse:actor.id,other:other.id,give:task.offer.give,want:task.offer.want,items:actor.inventory.slice(0,12),otherItems:other.inventory.slice(0,12),round:task.round+1});messages=buildMessages('trade',bindWorldClock(c.residentValuesEnabled===true?{...input,residentValuesEnabled:true}:input,now));}
 catch{return no('unsupported_trade_context');}
 // Only bounded objective IDs, no free-text private reasons or peer instructions.
 const recipe=BEATS.find(b=>b.id===row!.goal.beat);
 if(!recipe?.result?.craft)return no('unsupported_goal');
 messages.push({role:'user',content:JSON.stringify({context_kind:'goal_data_not_instructions',goal_beat:recipe.id,
   required_at_start:recipe.needs??[],consumed_on_use:recipe.result.consume??[],produces:recipe.result.craft,
   allowed_place_kinds:recipe.kinds,retain_required_copies:true,require_concrete_gain:true,own_declared_wants:actor.wants.items.slice(0,4),missing_items:(recipe.needs??[]).filter(id=>!actor.inventory.includes(id))})});
 if(!c.model?.key)return no('not_connected');const release=c.acquireSlot();if(!release)return no('concurrency_limit');
 const reservationId='wants:'+sha256Hex(JSON.stringify([before.worldId,goalId,row!.revision,taskId,task.round,before.version]));
 try {
  const reservation=c.ledger.reserve({id:reservationId,tier:'world',session:'world',ip:'',action:'trade',maxCostUsd:maxCostUsd('trade',messages),residentKind:'trade'});
  if(!reservation.ok)return no(reservation.reason);if(reservation.existing)return no('already_reserved');
  const result=await callModel(c.model,'trade',messages);
  if(!result.ok){c.ledger.settle(reservationId,failureCostUsd(result),result.kind==='timeout'?'timeout':'error');return no(result.kind);}
  const problem=checkOutput('trade',input,result.output);c.ledger.settle(reservationId,actualCostUsd(result.usage),problem?'rejected':'live');if(problem)return no(problem===PUBLIC_SPEECH_NOT_ENGLISH?'output_rejected:'+PUBLIC_SPEECH_NOT_ENGLISH:'output_rejected');
  const current=c.world(),latest=c.goals.load(current.worldId,goalId);
  if(c.enabled!==true||current.worldId!==before.worldId||current.version!==before.version||latest?.revision!==row!.revision||!eligible(current,latest))return no('stale_authority_or_state');
  const fresh=current.inbox?.tasks.find(t=>t.id===taskId);if(!fresh||fresh.status!=='pending'||fresh.awaiting!==actor.id||fresh.deadline<=c.now())return no('stale_task');
  const choice=result.output as TradeChoice;
  if(choice.decision==='counter'&&c.goals.refusalUntil(current.worldId,actor.id,other.id,choice.counter_give,choice.counter_want)>c.now())return no('recent_explicit_refusal');
  const a=current.muses.find(m=>m.id===actor.id)!,b=current.muses.find(m=>m.id===other.id)!;
  const check=choice.decision==='accept'?checkTrade(current.items,current.day,b,a,task.offer.give,task.offer.want,task.round,c.now()):choice.decision==='counter'?checkTrade(current.items,current.day,a,b,choice.counter_give,choice.counter_want,task.round+1,c.now()):{ok:true};
  if(!check.ok)return no('invalid_trade_choice');
  if(choice.decision!=='reject'&&!goalTradeUtility(current,latest!.goal,choice.decision==='accept'?task.offer.want:choice.counter_give,choice.decision==='accept'?task.offer.give:choice.counter_want,c.now()).ok)return no('goal_utility_not_improved');
  return {ok:true as const,kind:'proposal_only' as const,actor:actor.id,taskId,goalId,expectedVersion:current.version,goalRevision:latest!.revision,
   choice:{decision:choice.decision,counter_give:choice.counter_give,counter_want:choice.counter_want},evidence:{source:'model_response' as const,requestId:result.requestId,reservationId}};
 }finally{release();}
}
