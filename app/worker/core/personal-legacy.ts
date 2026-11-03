// Existing legacy authority adapter for one explicitly adopted principal. No key/grant/session issuance.
import type {ActorProfile} from '../../src/identity/participant.ts';
import {canonicalize} from '../../src/identity/jcs.ts';
import {bodyHash} from './run-log.ts';
import {ReceiptSnapshots} from './receipt-snapshots.ts';
import {CONNECTED_MS} from '../../src/engine/inbox.ts';
import {MAX_REPLAY_SNAPSHOT_BYTES} from '../../src/replay/versions.ts';
import {PersonalAdoption,PersonalAdoptionError,type LegacyAdoptionResult} from './personal-adoption.ts';
import {PersonalAuthStore} from './personal-session.ts';
import type {PersonalBinding} from './personal-registration.ts';
import type {PersonalStorage} from './personal-owners.ts';
import {LegacyProfile,LegacyProfileError,type LegacyOwnerProof} from './legacy-profile.ts';
import {PRINCIPALS} from './owner-session.ts';
import type {WorldRuntime} from './world-runtime.ts';
import type {Trust} from './trust.ts';
import type {ConnectedHost} from './connected.ts';
import type {DecisionOutcome} from './tasks.ts';

type Deps={storage:PersonalStorage;auth:PersonalAuthStore;adoption:PersonalAdoption;runtime:WorldRuntime;trust:Trust;connected:ConnectedHost;legacyProfile:LegacyProfile;now?:()=>number};
export type LegacyEntryProjection={state:'joined'|'viewing';actor:{id:string;displayName:string;appearanceId:string;profileRevision:number};attempt:null;receipt:{kind:'legacy_adoption';id:string;actorId:string;worldId:string;committedAt:number}|null;reason:'paused'|'unavailable'|null};
export type PersonalLegacyView={available:boolean;adopted:boolean;profile:ActorProfile|null;connection:{connected:boolean;lastSeenAt:number|null};entry:LegacyEntryProjection|null};
type Code='personal_session_required'|'adoption_required'|'invalid_approval'|'legacy_unavailable';
export class PersonalLegacyError extends Error{readonly code:Code;constructor(code:Code){super(code);this.code=code;this.name='PersonalLegacyError';}}
const fail=(code:Code):never=>{throw new PersonalLegacyError(code);};
const ACTOR='00-jolly';
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const empty=():PersonalLegacyView=>({available:false,adopted:false,profile:null,connection:{connected:false,lastSeenAt:null},entry:null});
export class PersonalLegacy{
 private d:Deps;private now:()=>number;
 constructor(d:Deps){this.d=d;this.now=d.now??Date.now;}
 private safe<T>(fn:()=>T):T{try{return fn();}catch(e){if(e instanceof PersonalLegacyError||e instanceof PersonalAdoptionError||e instanceof LegacyProfileError)throw e;return fail('legacy_unavailable');}}
 private guard(b:PersonalBinding){if(!b||!this.d.auth.active(b.sidDigest,b.proof,b.appId,this.now()))return fail('personal_session_required');}
 private owner(owner:LegacyOwnerProof|null){return !!owner&&owner.principal==='owner'&&owner.ownerId===PRINCIPALS.owner.ownerId&&time(owner.exp)&&owner.exp>this.now();}
 private own(b:PersonalBinding):LegacyAdoptionResult{this.guard(b);if(!this.d.adoption.hasPrincipal(b.proof.principalId))return fail('adoption_required');const result=this.d.adoption.get(b);if(!result)return fail('adoption_required');return result;}
 private actor(p:ActorProfile){return{id:ACTOR,displayName:p.displayName,appearanceId:p.appearanceId,profileRevision:p.revision};}
 private unavailable(profile:ActorProfile):PersonalLegacyView{return{available:false,adopted:true,profile,connection:{connected:false,lastSeenAt:null},entry:{state:'viewing',actor:this.actor(profile),attempt:null,receipt:null,reason:'unavailable'}};}
 /** Actual source refs and snapshot, not the alias's assertion alone. No browser/provider/MCP action. */
 private committed(value:LegacyAdoptionResult):boolean{
  try{
   const r=value.receipt;if(r.kind!=='legacy_adoption'||r.actorId!==ACTOR||r.worldId!==this.d.runtime.worldId)return false;
   const agent=this.d.trust.agentByMuse(ACTOR);if(!agent||agent.kind!=='owner'||agent.agentId!==r.agentId)return false;
   const record=this.d.runtime.eventRecord(r.eventId),e=record?.event,i=record?.input;
   if(!e||!i||!record?.runIdStored||record.runId!==r.runId||record.run?.worldId!==r.worldId||e.runId!==r.runId||e.seq!==r.eventSeq||e.inputSeq!==r.inputSeq||e.kind!=='legacy_profile_updated'||e.muse!==ACTOR||i.runId!==r.runId||i.seq!==r.inputSeq||i.kind!=='external'||i.label!=='legacy-profile-'+r.profileRevision||i.afterHash!==r.afterHash)return false;
   const archived=i.afterSnapshot;
   const body=archived?.body??(!archived&&i.afterSnapshotError==='replay_storage_limit'?new ReceiptSnapshots(this.d.storage.sql).read({kind:'legacy_adoption',actorId:ACTOR,worldId:r.worldId,runId:r.runId,inputSeq:r.inputSeq,eventId:r.eventId,afterHash:r.afterHash}):null);
   if((archived?archived.hash!==r.afterHash||i.afterSnapshotError!==null:i.afterSnapshotError!=='replay_storage_limit')||typeof body!=='string'||new TextEncoder().encode(body).byteLength>MAX_REPLAY_SNAPSHOT_BYTES||bodyHash(body)!==r.afterHash)return false;
   const s=JSON.parse(body);if(s.worldId!==r.worldId||s.tick!==i.tick||s.version!==i.versionAfter||!Array.isArray(s.muses))return false;
   const muses=s.muses.filter((m:unknown)=>object(m)&&m.id===ACTOR),profile=e.data?.profile;
   return muses.length===1&&object(profile)&&Object.keys(profile).sort().join(',')==='actorId,appearanceId,displayName,revision'&&profile.actorId===ACTOR&&profile.revision===r.profileRevision&&canonicalize(muses[0].profile)===canonicalize(profile);
  }catch{return false;}
 }
 view(binding:PersonalBinding,owner:LegacyOwnerProof|null):PersonalLegacyView{return this.safe(()=>this.d.storage.transactionSync(()=>{
  this.guard(binding);const reserved=this.d.adoption.hasPrincipal(binding.proof.principalId);
  if(!reserved){
   if(this.d.auth.owners.actorForPrincipal(binding.proof.principalId)||!this.owner(owner)||this.d.storage.sql.exec('SELECT 1 FROM personal_legacy_adoptions WHERE actor_id=?',ACTOR).toArray().length)return empty();
   const profile=this.d.legacyProfile.view();this.guard(binding);if(!this.owner(owner))return empty();return{...empty(),available:true,profile};
  }
  let result:LegacyAdoptionResult;
  try{result=this.own(binding);}catch(e){if(e instanceof PersonalAdoptionError&&['adoption_changed','adoption_unavailable'].includes(e.code))return this.unavailable(this.d.legacyProfile.view());throw e;}
  const s=this.d.runtime.state(),paused=!!s.paused?.[ACTOR],active=!this.d.trust.suspended(ACTOR),member=s.muses.filter(m=>m.id===ACTOR).length===1;
  const keys=this.d.connected.keys.list(ACTOR).filter(k=>k.revokedAt===null),seen=keys.map(k=>k.lastUsedAt).filter((at):at is number=>time(at)&&at<=this.now());
  const seenAt=seen.length?Math.max(...seen):null,connected=active&&seenAt!==null&&this.now()-seenAt<CONNECTED_MS,connection={connected,lastSeenAt:connected?seenAt:null};
  const hasKey=!!this.d.storage.sql.exec('SELECT 1 FROM agent_keys WHERE muse=? AND revoked_at IS NULL LIMIT 1',ACTOR).toArray().length;
  const joined=!paused&&active&&member&&hasKey&&this.committed(result),r=result.receipt;
  const entry:LegacyEntryProjection={state:joined?'joined':'viewing',actor:this.actor(result.profile),attempt:null,receipt:joined?{kind:'legacy_adoption',id:r.id,actorId:ACTOR,worldId:r.worldId,committedAt:r.committedAt}:null,reason:joined?null:paused?'paused':'unavailable'};
  this.guard(binding);return{available:false,adopted:true,profile:result.profile,connection,entry};
 }));}
 adopt(binding:PersonalBinding,owner:LegacyOwnerProof,input:unknown):PersonalLegacyView{return this.safe(()=>this.d.storage.transactionSync(()=>{this.d.adoption.adopt(binding,owner,input);const view=this.view(binding,null);if(!this.owner(owner))throw new PersonalAdoptionError('owner_session_required');return view;}));}
 profile(binding:PersonalBinding):ActorProfile|null{return this.safe(()=>{this.guard(binding);return this.d.adoption.hasPrincipal(binding.proof.principalId)?this.own(binding).profile:null;});}
 patchProfile(binding:PersonalBinding,input:unknown):ActorProfile{return this.safe(()=>this.d.storage.transactionSync(()=>{
  const current=this.own(binding);
  if(!object(input)||!['displayName,expectedRevision','appearanceId,displayName,expectedRevision'].includes(Object.keys(input).sort().join(',')))throw new LegacyProfileError('invalid_profile');
  const profile=this.d.legacyProfile.patch({principal:'owner',ownerId:PRINCIPALS.owner.ownerId,exp:binding.proof.expiresAt},{...input,appearanceId:Object.hasOwn(input,'appearanceId')?input.appearanceId:current.profile.appearanceId});this.own(binding);return profile;
 }));}
 inbox(binding:PersonalBinding){return this.safe(()=>this.d.storage.transactionSync(()=>{this.own(binding);const inbox=this.d.connected.ownerInbox([ACTOR]);this.own(binding);return inbox;}));}
 approve(binding:PersonalBinding,input:unknown):DecisionOutcome{return this.safe(()=>this.d.storage.transactionSync(()=>{
  this.own(binding);
  if(!object(input)||!['contentHash,decision,revision,taskId','candidate,contentHash,decision,revision,taskId'].includes(Object.keys(input).sort().join(','))||typeof input.taskId!=='string'||!/^task_[0-9a-z]{1,10}$/.test(input.taskId)||!time(input.revision)||input.revision<1||typeof input.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(input.contentHash)||(typeof input.decision!=='string'||!['approve','reject'].includes(input.decision))||(input.candidate!==undefined&&input.candidate!==null&&(input.decision!=='approve'||typeof input.candidate!=='string'||!/^c[1-5]$/.test(input.candidate))))return fail('invalid_approval');
  const task=this.d.runtime.state().inbox?.tasks.find(t=>t.id===input.taskId);if(!task||(task.from!==ACTOR&&task.to!==ACTOR))return{ok:false,status:404,code:'unknown_task',retryable:false,changed:false};
  const out=this.d.connected.ownerApprove({taskId:input.taskId,muse:ACTOR,ownerId:PRINCIPALS.owner.ownerId,revision:input.revision,contentHash:input.contentHash,decision:input.decision as 'approve'|'reject',candidate:typeof input.candidate==='string'?input.candidate:null});this.own(binding);return out;
 }));}
}
