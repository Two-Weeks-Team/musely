// Reversible owner control, separate from grants, revoked keys, admission and Native schedules.
import type {Sql} from './ledger.ts';
import type {PersonalStorage} from './personal-owners.ts';
import {PersonalRegistryError} from './personal-owners.ts';
import type {PersonalBinding} from './personal-registration.ts';
import type {WorldRuntime} from './world-runtime.ts';
import type {Trust} from './trust.ts';
import {pauseMuse,resumeMuse} from '../../src/engine/world.ts';
export type OwnerPauseView={muse:string;paused:boolean;revision:number};
export function initOwnerPause(sql:Sql){sql.exec('CREATE TABLE IF NOT EXISTS owner_pause_controls (actor_id TEXT PRIMARY KEY,paused INTEGER NOT NULL CHECK(paused IN (0,1)),revision INTEGER NOT NULL CHECK(revision>=1))');}
export function ownerPauseState(sql:Sql,muse:string):OwnerPauseView {
 const r=sql.exec('SELECT paused,revision FROM owner_pause_controls WHERE actor_id=?',muse).toArray()[0];
 if(!r)return{muse,paused:false,revision:0};
 if(![0,1].includes(Number(r.paused))||!Number.isSafeInteger(r.revision)||Number(r.revision)<1)throw new PersonalRegistryError('pause_unavailable');
 return{muse,paused:Number(r.paused)===1,revision:Number(r.revision)};
}
export type PauseOwner={muse:string;binding:string};
export function setOwnerPause(storage:PersonalStorage,runtime:WorldRuntime,trust:Trust,resolve:(b:PersonalBinding)=>PauseOwner,binding:PersonalBinding,input:unknown):OwnerPauseView {
 const b={...binding,proof:{...binding.proof}};
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='expectedRevision,paused')throw new PersonalRegistryError('invalid_pause');
 const x=input as {paused:boolean;expectedRevision:number};
 if(typeof x.paused!=='boolean'||!Number.isSafeInteger(x.expectedRevision)||x.expectedRevision<0||x.expectedRevision>=Number.MAX_SAFE_INTEGER)throw new PersonalRegistryError('invalid_pause');
 const desired=x.paused,expected=x.expectedRevision,owner=resolve(b),guard=()=>{const current=resolve(b);if(current.muse!==owner.muse||current.binding!==owner.binding)throw new PersonalRegistryError('pause_binding_changed');};
 return storage.transactionSync(()=>{
  guard();const before=ownerPauseState(storage.sql,owner.muse);
  // An exact state/CAS retry does not create another event or move a revision.
  if(expected!==before.revision){if(expected+1===before.revision&&desired===before.paused)return before;throw new PersonalRegistryError('pause_conflict');}
  if(before.paused===desired)return before;
  const now=Date.now(),revision=before.revision+1;
  const persist=()=>storage.sql.exec('INSERT INTO owner_pause_controls(actor_id,paused,revision) VALUES(?,?,?) ON CONFLICT(actor_id) DO UPDATE SET paused=excluded.paused,revision=excluded.revision',owner.muse,desired?1:0,revision);
  // A registered profile can be paused before explicit signed admission. This private write creates no actor/event.
  if(!runtime.state().muses.some(m=>m.id===owner.muse)){guard();persist();guard();return ownerPauseState(storage.sql,owner.muse);}
  runtime.commitExternal(now,'owner-pause-'+owner.muse+'-'+revision,(s,emit)=>{
   guard();persist();
   if(desired)pauseMuse(s,owner.muse,{status:'paused'});
   else if(trust.suspended(owner.muse))pauseMuse(s,owner.muse,{at:now,version:trust.delegationVersion(trust.agentByMuse(owner.muse)!.agentId),by:'delegation_revoked'});
   else resumeMuse(s,owner.muse);
   emit({at:now,source:'rule',kind:'muse_status_changed',muse:owner.muse,line:desired?'Resting (paused)':'Active',data:{status:desired?'paused':'active'},tags:[]});guard();
  },()=>({action:'owner_pause',payload:{muse:owner.muse,paused:desired}}));
  guard();return ownerPauseState(storage.sql,owner.muse);
 });
}
