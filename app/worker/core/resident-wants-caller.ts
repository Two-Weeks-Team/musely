/** Feature-OFF autonomous resident trade caller. Host supplies fresh ownership and
 * verified meeting/card/delegation authority. Never exposes a personal-Muse executor.
 */
import {prepareResidentTrade,type WantsModelContext} from './resident-wants-model.ts';
import {completeTrade} from './mcp-tools.ts';
import {goalTradeUtility} from '../../src/engine/wants-use.ts';
import {checkTrade,historyFault,sweepExpired} from '../../src/engine/items.ts';
import {isRuntimeControlled,TASK_TTL_MS} from '../../src/engine/inbox.ts';
import {hasResidentHarness} from './resident-harness.ts';
import {PRINCIPALS} from './owner-session.ts';
import {type WorldRuntime} from './world-runtime.ts';
import {type WorldState,spotlightFor} from '../../src/engine/world.ts';
import {type OwnerOf} from './tasks.ts';
export type ResidentWantsCallerPolicy={
 enabled?:boolean;
 /** Required server-only synchronous recheck from verified cards/delegations.
  * Called before any model spend AND within actual commit. No default allow. */
 authorize:(world:WorldState,actor:string,peer:string,at:number)=>boolean;
 ownerOf:OwnerOf;ownerMuse:string;
 /** Registry/store resolution only; never free-form client requested identity. */
 goalFor:(actor:string)=>string|null;
 context:Omit<WantsModelContext,'world'|'acquireSlot'>;
};
class StaleTrade extends Error {}
/** One selected resident turn. The caller must share runtime storage with the goal store.
 * Actual WorldRuntime commitExternal atomically stores state/events/runlog plus goal receipt.
 * This function executes model accept/counter/reject; it does not move/craft or mark goals fulfilled.
 */
export async function runResidentWantsTurn(runtime:WorldRuntime,policy:ResidentWantsCallerPolicy,now:number){
 const no=(reason:string)=>({ok:false as const,reason});
 if(policy.enabled!==true||policy.context.enabled!==true)return no('disabled');
 if(!runtime.ownsResidentGoalStore(policy.context.goals))return no('storage_mismatch');
 const before=runtime.state();if(historyFault(structuredClone(before.items),false,now))return no('history_tamper');if(policy.context.goals.turnConsumed(before.worldId,before.day,before.tick))return no('turn_already_consumed');const spot=spotlightFor(before,now);if(spot.priority)return no('visitor_priority');
 const actor=before.muses.find(m=>m.id===spot.muse),id=actor?.id;
 if(!id||!hasResidentHarness(id)||Object.values(PRINCIPALS).some(p=>p.muses.includes(id))||policy.context.ownership(id)!=='resident'||before.paused?.[id]||isRuntimeControlled(before,id,now))return no('owner_authority_required');
 const goalId=policy.goalFor(id),task=before.inbox?.tasks.find(t=>t.kind==='trade'&&t.status==='pending'&&t.awaiting===id&&t.deadline>now&&t.offer);
 if(!goalId||!task?.offer)return no('no_pending_goal_trade');
 const peer=task.offer.by;if(!policy.authorize(before,id,peer,now))return no('authority_refused');
 const prepared=await prepareResidentTrade({...policy.context,world:()=>runtime.state(),acquireSlot:()=>runtime.modelSlot()},goalId,task.id);
 if(!prepared.ok)return prepared;
 try {
  const events=runtime.commitExternal(policy.context.now(),`resident-wants-${prepared.evidence.reservationId}`,(s,emit)=>{
   const at=policy.context.now(),currentSpot=spotlightFor(s,at),row=policy.context.goals.load(s.worldId,goalId);
   const a=s.muses.find(m=>m.id===id),t=s.inbox?.tasks.find(q=>q.id===task.id),b=s.muses.find(m=>m.id===peer);
   if(policy.enabled!==true||policy.context.enabled!==true||s.version!==prepared.expectedVersion||currentSpot.priority||currentSpot.muse!==id||policy.context.ownership(id)!=='resident'||s.paused?.[id]||isRuntimeControlled(s,id,at)||!policy.authorize(s,id,peer,at)||!row||row.revision!==prepared.goalRevision||row.goal.status!=='active'||row.goal.expiresAt<=at||!a||!b||a.travel||a.beat||b.travel||!t||t.kind!=='trade'||t.status!=='pending'||t.awaiting!==id||t.deadline<=at||!t.offer||t.offer.by!==peer)throw new StaleTrade('stale_authority_or_state');
   if(historyFault(s.items,false,at))throw new StaleTrade('history_tamper');
   for(const e of sweepExpired(s,at))emit({...e,source:'rule'});
   const choice=prepared.choice;
   if(choice.decision==='counter'&&policy.context.goals.refusalUntil(s.worldId,id,peer,choice.counter_give,choice.counter_want)>at)throw new StaleTrade('recent_explicit_refusal');
   const checked=choice.decision==='accept'?checkTrade(s.items,s.day,b,a,t.offer.give,t.offer.want,t.round,at):choice.decision==='counter'?checkTrade(s.items,s.day,a,b,choice.counter_give,choice.counter_want,t.round+1,at):{ok:true};
   if(!checked.ok)throw new StaleTrade('trade_precondition_changed');
   if(choice.decision!=='reject'&&!goalTradeUtility(s,row.goal,choice.decision==='accept'?t.offer.want:choice.counter_give,choice.decision==='accept'?t.offer.give:choice.counter_want,at).ok)throw new StaleTrade('goal_utility_not_improved');
   const modelEmit:typeof emit=e=>emit({...e,source:'live',data:{...e.data,actorOrigin:'system',decisionSource:'resident_model',evidence:prepared.evidence}});
   if(choice.decision==='accept')completeTrade(s,t,id,modelEmit,emit,at,policy.ownerMuse,'live',policy.ownerOf);
   else if(choice.decision==='reject'){t.status='rejected';t.awaiting=null;t.updatedAt=at;t.history.push({by:id,action:'reject',at,via:'live'});modelEmit({at,source:'live',kind:'trade_rejected',muse:id,other:peer,place:a.place,line:null,data:{task_id:t.id,stage:'negotiate'},tags:['trade_rejected']});}
   else {t.round++;t.offer={by:id,give:choice.counter_give,want:choice.counter_want};t.awaiting=peer;t.updatedAt=at;t.deadline=at+TASK_TTL_MS;t.history.push({by:id,action:'counter',at,give:choice.counter_give,want:choice.counter_want,via:'live'});modelEmit({at,source:'live',kind:'trade_countered',muse:id,other:peer,place:a.place,line:null,data:{task_id:t.id,give:choice.counter_give,want:choice.counter_want,round:t.round,stage:'negotiate'},tags:[]});}
   policy.context.goals.recordTurnInTransaction(s.worldId,s.day,s.tick,prepared.evidence.reservationId);
   policy.context.goals.recordDecisionInTransaction(s.worldId,goalId,prepared.goalRevision,prepared.evidence.reservationId,t.id,choice.decision);
  },()=>({action:'resident_trade_decision',payload:{goalId,taskId:task.id,decision:prepared.choice.decision}}));
  return {ok:true as const,kind:'committed' as const,decision:prepared.choice.decision,events:events.map(e=>e.id),reservationId:prepared.evidence.reservationId};
 }catch(e){if(e instanceof StaleTrade)return no(e.message);throw e;}
}
