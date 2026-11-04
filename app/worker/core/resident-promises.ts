/** Server-only projection of accepted gathering invitations. No model, IO, or world mutation.
 * Inputs must be committed server events and their authoritative post-commit world snapshot.
 * Text is never parsed into an agreement, and personal actors never receive resident promises.
 */
import {isRuntimeControlled, type CampfireInvite} from '../../src/engine/inbox.ts';
import {closePromise, recordPromise, remember, restoreLife, saveLife, type LifeState} from '../../src/engine/resident-life.ts';
import {sha256Hex} from '../../src/engine/sha256.ts';
import type {WorldEvent, WorldState} from '../../src/engine/world.ts';

const MAX_PROMISES = 32;
const validRef = (x:unknown):x is string => typeof x==='string' && x.length>0 && x.length<=160 && !/[\u0000-\u001f<>]/.test(x);
const time = (x:unknown):x is number => typeof x==='number' && Number.isFinite(x) && x>=0;
const ref = (id:string) => validRef(id)?id:`event-sha256:${sha256Hex(id)}`;
const promiseId = (inv:CampfireInvite,id:string) => `invite:${sha256Hex(JSON.stringify([inv.id,inv.at,inv.from,id]))}`;
const terminal = (inv:CampfireInvite) => inv.status==='gathered'||inv.status==='expired'||inv.status==='cancelled';

export function projectResidentPromises(life:LifeState, world:WorldState, events:readonly WorldEvent[], now:number,
  allowed:(id:string)=>boolean,before?:WorldState):LifeState {
  let next=restoreLife(saveLife(life));
  if(!time(now))return next;
  const eligible=(id:string)=>allowed(id)&&world.muses.some(m=>m.id===id&&!m.profile&&m.controlMode!=='personal')
    &&!world.paused?.[id]&&!isRuntimeControlled(world,id,now)&&next.residents.some(r=>r.id===id);
  const invites=(world.inbox?.invites??[]).filter(inv=>validRef(inv.id)&&validRef(inv.from)&&validRef(inv.place)
    &&time(inv.at)&&time(inv.expiresAt)&&inv.at<=now&&inv.expiresAt>inv.at);
  const committed=events.filter(e=>time(e.at)&&e.at<=now&&Number.isSafeInteger(e.tick)&&e.tick<=world.tick&&typeof e.id==='string');
  // The inbox's closed-retention cap can remove an older invitation in the very commit
  // that closes it. A before snapshot alone never proves closure: require its actual
  // terminal event from this same transaction, and never infer attendance from positions.
  if(before?.worldId===world.worldId&&before.version<world.version)for(const old of before.inbox?.invites??[]){
    if(old.status!=='open'||invites.some(i=>i.id===old.id)||!validRef(old.id)||!validRef(old.from)||!validRef(old.place)||!time(old.at)||!time(old.expiresAt)||old.expiresAt<=old.at)continue;
    const e=committed.find(e=>e.source==='rule'&&['campfire_gathering','campfire_invite_expired','campfire_invite_cancelled'].includes(e.kind)&&e.at===now&&e.at>=old.at&&e.muse===old.from&&e.place===old.place&&e.data?.invite_id===old.id);
    if(!e)continue;
    const restored={...structuredClone(old),note:null,status:e.kind==='campfire_gathering'?'gathered' as const:e.kind==='campfire_invite_expired'?'expired' as const:'cancelled' as const,closedAt:e.at};
    if(restored.status==='expired'&&e.at<old.expiresAt)continue;
    if(restored.status==='gathered'){
      const ids=e.data?.muses;
      if(!Array.isArray(ids)||ids.length<3||new Set(ids).size!==ids.length||!ids.includes(old.from)||e.at>=old.expiresAt||ids.some(id=>typeof id!=='string'||![old.from,...old.to].includes(id)))continue;
      const via=e.data?.answers_via as Record<string,unknown>|undefined;
      if(ids.some(id=>id!==old.from&&via?.[id]!=='live'&&via?.[id]!=='rule'))continue;
      restored.gathered=[...ids];
      for(const id of ids.filter(id=>id!==old.from))restored.answers[id]={answer:'accept',via:via![id] as 'live'|'rule',at:e.at};
    }
    invites.push(restored);
  }

  const reconcile=()=>{
  // Reconcile retained terminal invitations too: OFF may have skipped their closing events.
  // A snapshot receipt identifies the exact server state, not invented event text or attendance.
  for(const inv of invites){
    if(!terminal(inv)||!time(inv.closedAt)||inv.closedAt<inv.at||inv.closedAt>now)continue;
    if(inv.status==='expired'&&inv.closedAt<inv.expiresAt)continue;
    const gathered=inv.gathered;
    if(inv.status==='gathered'&&(!Array.isArray(gathered)||gathered.length<3||new Set(gathered).size!==gathered.length
      ||inv.closedAt>=inv.expiresAt||gathered.some(id=>id!==inv.from&&(!inv.to.includes(id)||inv.answers[id]?.answer!=='accept'))))continue;
    const kind=inv.status==='gathered'?'campfire_gathering':`campfire_invite_${inv.status}`;
    const event=committed.find(e=>e.kind===kind&&e.source==='rule'&&e.at===inv.closedAt&&e.muse===inv.from&&e.place===inv.place
      &&e.data?.invite_id===inv.id&&(inv.status!=='gathered'||Array.isArray(e.data?.muses)
        &&JSON.stringify([...e.data.muses as string[]].sort())===JSON.stringify([...gathered!].sort())));
    const evidenceId=event?ref(event.id):`invite-state-sha256:${sha256Hex(JSON.stringify([inv.id,inv.from,inv.place,inv.at,inv.expiresAt,inv.status,inv.closedAt,gathered??[]]))}`;
    for(const r of next.residents){
      if(!eligible(r.id))continue;
      const p=r.promises.find(p=>p.id===promiseId(inv,r.id));
      if(!p||p.status!=='pending'||p.other!==inv.from||p.place!==inv.place||p.dueAt!==inv.expiresAt)continue;
      const fulfilled=inv.status==='gathered'&&gathered!.includes(r.id);
      const summary=fulfilled?'Attended committed public gathering':inv.status==='gathered'?'Gathering closed without verified attendance':inv.status==='expired'?'Accepted invitation expired without a completed gathering':'Accepted invitation was cancelled';
      next=closePromise(next,r.id,p.id,fulfilled?'fulfilled':'cancelled',{id:`${p.id}:closed`,kind:'executed',at:inv.closedAt,
        subject:inv.from,publicSummary:summary,source:'rule',evidenceId});
    }
  }
  // An elapsed deadline with no retained invitation is not proof of attendance or failure.
  // Close tracking conservatively so bounded pending slots cannot be pinned forever after OFF.
  const retained=new Set(invites.flatMap(inv=>inv.to.map(id=>promiseId(inv,id))));
  for(const r of next.residents){
    if(!eligible(r.id))continue;
    for(const p of r.promises){
      if(p.status!=='pending'||!/^invite:[a-f0-9]{64}$/.test(p.id)||p.dueAt>=now||retained.has(p.id))continue;
      next=closePromise(next,r.id,p.id,'cancelled',{id:`${p.id}:closed`,kind:'executed',at:now,subject:p.other,
        publicSummary:'Invitation deadline passed; attendance evidence unavailable; tracking closed',source:'rule',
        evidenceId:`invite-retention-sha256:${sha256Hex(JSON.stringify([p.id,p.dueAt,now]))}`});
    }
  }
  };
  reconcile(); // Free terminal capacity before collecting this commit's new agreement.
  for(const e of committed){
    if(e.kind!=='campfire_invite_answer'||e.source!=='rule'||!e.muse||!eligible(e.muse)||e.data?.answer!=='accept')continue;
    const inv=invites.find(i=>i.id===e.data?.invite_id);
    const answer=inv?.answers[e.muse];
    if(!inv||!inv.to.includes(e.muse)||inv.from!==e.other||answer?.answer!=='accept'||answer.via!=='rule'
      ||answer.at!==e.at||e.at<inv.at||e.at>=inv.expiresAt)continue;
    const id=promiseId(inv,e.muse),r=next.residents.find(r=>r.id===e.muse)!;
    if(r.promises.some(p=>p.id===id)||r.memories.some(m=>m.id===`${id}:accepted`))continue; // Duplicate accept cannot reopen or change a capacity receipt.
    // Keep every pending obligation. Recycle only an older terminal record; memory remains bounded separately.
    if(r.promises.length>=MAX_PROMISES){const old=r.promises.findIndex(p=>p.status!=='pending');if(old>=0)r.promises.splice(old,1);}
    const full=r.promises.length>=MAX_PROMISES;
    next=remember(next,e.muse,{id:`${id}:accepted`,kind:'agreement',at:e.at,subject:inv.from,
      publicSummary:full?'Accepted gathering invitation; promise tracking capacity reached':'Accepted public gathering invitation',source:'rule',evidenceId:ref(e.id)});
    if(!full)next=recordPromise(next,e.muse,{id,other:inv.from,place:inv.place,dueAt:inv.expiresAt,status:'pending',evidenceId:ref(e.id)});
  }

  reconcile(); // A newly accepted invitation can gather in the same atomic commit.
  return next;
}
