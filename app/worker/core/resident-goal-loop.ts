/** Feature-OFF catalog-goal loop. Goal selection is deterministic server policy, not an LLM claim. */
import {BEATS} from '../../src/engine/beats.ts';
import {HARNESS_IDS} from '../../src/engine/harness.ts';
import {emptyInbox,isRuntimeControlled,nextId,TASK_TTL_MS} from '../../src/engine/inbox.ts';
import {historyFault,sweepExpired,checkTrade} from '../../src/engine/items.ts';
import {planUse,verifyUse} from '../../src/engine/wants-use.ts';
import {spotlightFor,startResidentGoalActivity,updateWants,type WorldState,type WorldEvent,type Hooks} from '../../src/engine/world.ts';
import {PRINCIPALS} from './owner-session.ts';
import {ResidentGoalStore} from './resident-wants-model.ts';
import {type WorldRuntime} from './world-runtime.ts';
export type ResidentGoalLoopPolicy={enabled?:boolean;goals:ResidentGoalStore;ownership:(id:string)=>'resident'|'personal'|'legacy'|'unknown';authorize:(s:WorldState,actor:string,peer:string|null,at:number)=>boolean;goalBeatsFor:(actor:string)=>readonly string[]};
const eligible=(s:WorldState,id:string,p:ResidentGoalLoopPolicy,now:number)=>HARNESS_IDS.includes(id)&&!Object.values(PRINCIPALS).some(x=>x.muses.includes(id))&&p.ownership(id)==='resident'&&!s.paused?.[id]&&!isRuntimeControlled(s,id,now)&&p.authorize(s,id,null,now);
/** Receipts are emitted only from authoritative committed craft evidence, in caller's shared SQL transaction. */
export function completeResidentGoalsInTransaction(p:ResidentGoalLoopPolicy,before:WorldState,after:WorldState,events:readonly WorldEvent[],now:number){
 if(p.enabled!==true)return;
 for(const m of after.muses){if(!eligible(after,m.id,p,now))continue;for(const row of p.goals.activeFor(after.worldId,m.id)){if(verifyUse(row.goal,before,after,events,now).fulfilled)p.goals.completeInTransaction(after.worldId,row.goal.id,row.revision,before,after,events,now);}}
}
export function runResidentGoalTurn(runtime:WorldRuntime,p:ResidentGoalLoopPolicy,now:number,hooks:Hooks={}){
 const no=(reason:string)=>({ok:false as const,reason});
 if(p.enabled!==true)return no('disabled');if(!runtime.ownsResidentGoalStore(p.goals))return no('storage_mismatch');
 const before=runtime.state(),spot=spotlightFor(before,now),id=spot.muse,m=before.muses.find(x=>x.id===id);
 if(spot.priority||!m||!eligible(before,id,p,now))return no('owner_authority_required');
 if(p.goals.turnConsumed(before.worldId,before.day,before.tick))return no('turn_already_consumed');
 if(m.travel||m.beat||m.intent)return no('busy');
 if(historyFault(structuredClone(before.items),false,now))return no('history_tamper');
 let row=p.goals.activeFor(before.worldId,id).find(x=>x.goal.expiresAt>now);
 // Daily stable ID and existing terminal records prevent endless re-creation after success/cancellation.
 const recipe=!row?BEATS.find(b=>p.goalBeatsFor(id).includes(b.id)&&b.result?.craft&&!p.goals.load(before.worldId,`goal:${before.day}:${id}:${b.id}`)):null;
 if(!row&&!recipe)return no('no_catalog_goal');
 const pending=before.inbox?.tasks.some(t=>t.status==='pending'&&(t.from===id||t.to===id));
 if(row&&pending)return no('awaiting_trade');
 if(row){const plan=planUse(before,row.goal,now);if(plan.candidates.length&&plan.candidates.every(c=>p.goals.refusalUntil(before.worldId,id,c.peer,c.give,c.want)>now))return no('recent_explicit_refusal');}
 if(row){const plan=planUse(before,row.goal,now);if(plan.state==='ask'&&m.wants.goal===`Use ${row.goal.beat.replace(/_/g,' ')}`&&JSON.stringify(m.wants.items)===JSON.stringify([...new Set(plan.missing.slice(0,4))]))return no('need_already_declared');}
 let result='created';
 runtime.commitExternal(now,`resident-goal-${id}`,(s,emit)=>{
  if(s.version!==before.version||!eligible(s,id,p,now)||spotlightFor(s,now).priority||spotlightFor(s,now).muse!==id)throw Error('stale resident goal authority');
  const actor=s.muses.find(x=>x.id===id)!;
  if(!row){const goal={id:`goal:${s.day}:${id}:${recipe!.id}`,muse:id,beat:recipe!.id,createdAt:now,expiresAt:now+86400000,status:'active' as const};p.goals.saveInTransaction(s.worldId,null,goal);row={revision:0,goal};emit({at:now,source:'rule',kind:'resident_goal_created',muse:id,line:null,data:{goalId:goal.id,beat:goal.beat,selection:'server_catalog_policy'},tags:[]});}
  if(historyFault(s.items,false,now))throw Error('history_tamper');for(const e of sweepExpired(s,now))emit({...e,source:'rule'});
  const plan=planUse(s,row!.goal,now);
  if(plan.state==='ready'||plan.state==='move')result=startResidentGoalActivity(s,id,row!.goal.beat,now,emit,hooks)??'blocked';
  else if(!pending&&(plan.state==='ask'||plan.state==='trade_candidate')){
   const text=`Use ${row!.goal.beat.replace(/_/g,' ')}`;updateWants(actor,{goal:text,items:plan.missing.slice(0,4)},'harness',now);
   emit({at:now,source:'rule',kind:'resident_need_declared',muse:id,place:actor.place,line:null,data:{goalId:row!.goal.id,items:plan.missing.slice(0,4)},tags:[]});result='declared';
   s.inbox??=emptyInbox();
   const c=plan.candidates.find(c=>p.goals.refusalUntil(s.worldId,id,c.peer,c.give,c.want)<=now&&p.authorize(s,id,c.peer,now));
   if(c){const peer=s.muses.find(x=>x.id===c.peer)!;if(!peer.id.startsWith('pm_')&&checkTrade(s.items,s.day,actor,peer,c.give,c.want,0,now).ok){const task={id:nextId(s.inbox,'task'),kind:'trade' as const,from:id,to:peer.id,status:'pending' as const,awaiting:peer.id,createdAt:now,deadline:now+TASK_TTL_MS,updatedAt:now,round:0,offer:{by:id,give:c.give,want:c.want},history:[{by:id,action:'propose' as const,at:now,give:c.give,want:c.want,via:'rule' as const}]};s.inbox.tasks.push(task);emit({at:now,source:'rule',kind:'trade_proposed',muse:id,other:peer.id,place:actor.place,line:null,data:{task_id:task.id,give:c.give,want:c.want,goalId:row!.goal.id,stage:'propose'},tags:[]});result='proposed';}}
  }
  p.goals.recordTurnInTransaction(s.worldId,s.day,s.tick,`goal:${row!.goal.id}:${s.tick}`);
 });
 return {ok:true as const,kind:result};
}

/** Dependency-inversion seam for an independently shipped WorldDO controller. */
export function createResidentServices(sql:ConstructorParameters<typeof ResidentGoalStore>[0],config:{enabled:boolean;world:()=>WorldState;ownership:ResidentGoalLoopPolicy['ownership'];authorize:ResidentGoalLoopPolicy['authorize'];goalBeatsFor:ResidentGoalLoopPolicy['goalBeatsFor'];ledger:import('./ledger.ts').Ledger;model:import('./model.ts').ModelConfig|null;ownerOf:import('./tasks.ts').OwnerOf;ownerMuse:string;now:()=>number}){
 const goals=new ResidentGoalStore(sql);goals.init();
 const residentGoals:ResidentGoalLoopPolicy={enabled:config.enabled,goals,ownership:config.ownership,authorize:config.authorize,goalBeatsFor:config.goalBeatsFor};
 const residentWants:import('./resident-wants-caller.ts').ResidentWantsCallerPolicy={enabled:config.enabled,authorize:config.authorize,ownerOf:config.ownerOf,ownerMuse:config.ownerMuse,goalFor:id=>goals.activeFor(config.world().worldId,id).find(r=>r.goal.expiresAt>config.now())?.goal.id??null,context:{enabled:config.enabled,goals,ownership:config.ownership,ledger:config.ledger,model:config.model,now:config.now}};
 return {residentGoals,residentWants,onCommit:(_before:WorldState,_after:WorldState,_events:readonly WorldEvent[],_now:number)=>{}};
}

export function residentGoalIdleIds(p:ResidentGoalLoopPolicy|undefined,s:WorldState,now:number):string[]{
 if(p?.enabled!==true)return [];return s.muses.filter(m=>eligible(s,m.id,p,now)&&(p.goals.activeFor(s.worldId,m.id).some(r=>r.goal.expiresAt>now)||BEATS.some(b=>p.goalBeatsFor(m.id).includes(b.id)&&b.result?.craft&&!p.goals.load(s.worldId,`goal:${s.day}:${m.id}:${b.id}`)))).map(m=>m.id);
}

/** Classifies only authoritative server commit events, never browser/model supplied JSON.
 * No refusal reason/text is stored. The key is one direction, peer and exact item pair. */
export function recordResidentTradeRefusalsInTransaction(goals:ResidentGoalStore,before:WorldState,after:WorldState,events:readonly WorldEvent[],now:number,canRecord:(actor:string)=>boolean){
 if(before.worldId!==after.worldId)return;
 for(const e of events){
  if(e.kind!=='trade_rejected'||e.source!=='live'||!e.muse||!Number.isSafeInteger(e.at)||e.at>now)continue;
  const env=e.data?.envelope as Record<string,unknown>|undefined;
  const explicitSigned=e.data?.actorOrigin==='connected'&&e.data?.tool==='reject_trade'&&env?.scope==='world_item_trade'&&typeof env.message_id==='string'&&env.message_id.length>0;
  const explicitModel=e.data?.actorOrigin==='system'&&e.data?.decisionSource==='resident_model'&&typeof (e.data?.evidence as Record<string,unknown>|undefined)?.reservationId==='string';
  if(!explicitSigned&&!explicitModel)continue;
  const old=before.inbox?.tasks.find(t=>t.id===e.data?.task_id),next=after.inbox?.tasks.find(t=>t.id===e.data?.task_id);
  if(!old||old.kind!=='trade'||old.status!=='pending'||old.awaiting!==e.muse||!old.offer||old.offer.by===e.muse||e.other!==old.offer.by||e.at<old.createdAt||!next||next.status!=='rejected'||next.offer?.by!==old.offer.by||next.offer?.give!==old.offer.give||next.offer?.want!==old.offer.want||next.updatedAt!==e.at||next.history.at(-1)?.action!=='reject'||next.history.at(-1)?.by!==e.muse)continue;
  if(!canRecord(old.offer.by))continue;
  goals.recordRefusalInTransaction(before.worldId,old.offer.by,e.muse,old.offer.give,old.offer.want,e.at,e.id);
 }
}
