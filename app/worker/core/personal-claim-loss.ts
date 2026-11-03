// Confirmed personal claim loss closes social consent, independently of delegation or movement.
import {cancelTasksFor} from '../../src/engine/inbox.ts';
import type {PersonalClaimStatus} from './personal-claim-state.ts';
import type {WorldRuntime} from './world-runtime.ts';
import type {Trust} from './trust.ts';

/** Called synchronously inside PersonalClaims' loss transaction. Errors must reach that transaction. */
export function losePersonalClaim(runtime:WorldRuntime,trust:Trust,actorId:string,status:PersonalClaimStatus,version:number,now:number):void{
 if(!['claim_revoked','mismatch'].includes(status)||trust.agentByMuse(actorId)?.kind!=='personal')return;
 const affected=(s:ReturnType<WorldRuntime['state']>)=>s.inbox?.tasks.some(t=>t.status==='pending'&&(t.from===actorId||t.to===actorId))||s.inbox?.invites?.some(i=>i.status==='open'&&(i.from===actorId||(i.to.includes(actorId)&&i.answers[actorId]?.answer!=='unavailable')));
 if(!affected(runtime.state()))return;
 const reason=status==='mismatch'?'claim_mismatch':'claim_revoked';
 // All stores share ctx.storage: nested synchronous world SQL remains in the caller's transaction.
 // https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync
 runtime.commitExternal(now,`personal-claim-loss-${actorId}-${version}`,(s,emit)=>{
  for(const t of cancelTasksFor(s.inbox!,actorId,now,'musely'))emit({at:now,source:'rule',kind:'task_cancelled',muse:actorId,other:t.from===actorId?t.to:t.from,line:null,data:{task_id:t.id,task:t.kind,reason},tags:[]});
  for(const i of s.inbox?.invites??[]){
   if(i.status!=='open')continue;
   if(i.from===actorId){i.status='cancelled';i.closedAt=now;emit({at:now,source:'rule',kind:'campfire_invite_cancelled',muse:actorId,place:i.place,line:null,data:{invite_id:i.id,reason},tags:[]});}
   else if(i.to.includes(actorId)&&i.answers[actorId]?.answer!=='unavailable'){
    i.answers[actorId]={answer:'unavailable',via:null,at:now};
    emit({at:now,source:'rule',kind:'campfire_invite_answer',muse:actorId,other:i.from,place:i.place,line:null,data:{invite_id:i.id,answer:'unavailable',reason},tags:[]});
   }
  }
 });
}
