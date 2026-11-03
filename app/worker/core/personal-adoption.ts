// Private dual-proof alias for the existing legacy actor. Never inserts a personal actor or grants authority.
import type {ActorProfile} from '../../src/identity/participant.ts';
import {canonicalize,base64url} from '../../src/identity/jcs.ts';
import {sha256Hex} from '../../src/engine/sha256.ts';
import {normalizePersonalProfile,type PersonalStorage} from './personal-owners.ts';
import {PersonalAuthStore} from './personal-session.ts';
import type {PersonalBinding} from './personal-registration.ts';
import {LegacyProfileError,type LegacyOwnerProof} from './legacy-profile.ts';
import {PRINCIPALS} from './owner-session.ts';

export type LegacyAdoptionInput={operationId:string;displayName:string;appearanceId:string;expectedRevision:number};
export type LegacyAdoptionCurrent={actorId:'00-jolly';agentId:string;rootBinding:string;worldId:string;profile:ActorProfile};
export type LegacyAdoptionCommit={worldId:string;runId:string;inputSeq:number;eventSeq:number;eventId:string;afterHash:string};
export type LegacyAdoptionReceipt=LegacyAdoptionCommit&{kind:'legacy_adoption';id:string;actorId:'00-jolly';agentId:string;committedAt:number;profileRevision:number};
export type LegacyAdoptionResult={profile:ActorProfile;receipt:LegacyAdoptionReceipt};
type Code='personal_session_required'|'owner_session_required'|'not_your_muse'|'invalid_adoption'|'adoption_conflict'|'adoption_changed'|'adoption_unavailable';
export class PersonalAdoptionError extends Error{readonly code:Code;constructor(code:Code){super(code);this.code=code;this.name='PersonalAdoptionError';}}
const fail=(code:Code):never=>{throw new PersonalAdoptionError(code);};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string):v is Record<string,unknown>=>object(v)&&Object.keys(v).sort().join(',')===keys;
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const ACTOR='00-jolly';
const reference=(v:unknown,max=256):v is string=>typeof v==='string'&&v.length<=max&&/^[A-Za-z0-9_.:/-]+$/.test(v);
const receiptId=(v:unknown)=>typeof v==='string'&&/^lad_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
type Options={currentLegacy:()=>LegacyAdoptionCurrent;commitProfile:(owner:LegacyOwnerProof,input:{expectedRevision:number;displayName:string;appearanceId:string})=>{profile:ActorProfile;commit:LegacyAdoptionCommit};now?:()=>number};

export class PersonalAdoption{
 private storage:PersonalStorage;private auth:PersonalAuthStore;private options:Options;private now:()=>number;
 constructor(storage:PersonalStorage,auth:PersonalAuthStore,options:Options){this.storage=storage;this.auth=auth;this.options=options;this.now=options.now??Date.now;}
 private safe<T>(fn:()=>T):T{try{return fn();}catch(e){if(e instanceof PersonalAdoptionError)throw e;if(e instanceof LegacyProfileError){if(e.code==='owner_session_required')return fail('owner_session_required');if(e.code==='not_your_muse')return fail('not_your_muse');if(e.code==='profile_conflict')return fail('adoption_conflict');}return fail('adoption_unavailable');}}
 init(){this.safe(()=>this.storage.sql.exec("CREATE TABLE IF NOT EXISTS personal_legacy_adoptions (id TEXT NOT NULL UNIQUE, principal_id TEXT PRIMARY KEY REFERENCES personal_principals(id), app_id TEXT NOT NULL, provider TEXT NOT NULL, subject TEXT NOT NULL, actor_id TEXT NOT NULL UNIQUE CHECK(actor_id='00-jolly'), agent_id TEXT NOT NULL, root_binding TEXT NOT NULL, world_id TEXT NOT NULL, operation_id TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL)"));}
 /** Persistent reservation, deliberately independent of session/root validity. Private caller only. */
 hasPrincipal(principalId:string):boolean{return this.safe(()=>typeof principalId==='string'&&!!this.storage.sql.exec('SELECT 1 FROM personal_legacy_adoptions WHERE principal_id=?',principalId).toArray().length);}
 private guard(b:PersonalBinding){
  const at=this.now();if(!b||!time(at)||!this.auth.active(b.sidDigest,b.proof,b.appId,at))return fail('personal_session_required');
  const p=this.auth.owners.principal(b.proof.principalId);
  if(!p||p.provider!=='threads'||!/^\d{1,32}$/.test(b.appId)||!p.subject.startsWith(b.appId+':')||!/^\d{1,128}$/.test(p.subject.slice(b.appId.length+1)))return fail('personal_session_required');
  if(this.auth.owners.actorForPrincipal(p.id))return fail('adoption_conflict');
  return{principalId:p.id,appId:b.appId,provider:p.provider,subject:p.subject};
 }
 private owner(p:LegacyOwnerProof){if(!p||!time(p.exp)||p.exp<=this.now())return fail('owner_session_required');if(p.principal!=='owner'||p.ownerId!==PRINCIPALS.owner.ownerId)return fail('not_your_muse');}
 private profile(v:unknown):ActorProfile{
  if(!exact(v,'actorId,appearanceId,displayName,revision')||v.actorId!==ACTOR||!time(v.revision))return fail('adoption_unavailable');
  const p=normalizePersonalProfile(v.displayName,v.appearanceId);if(p.displayName!==v.displayName)return fail('adoption_unavailable');return{actorId:ACTOR,...p,revision:v.revision};
 }
 private current():LegacyAdoptionCurrent{
  const c=this.options.currentLegacy();if(!object(c)||c.actorId!==ACTOR||typeof c.agentId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(c.agentId)||typeof c.rootBinding!=='string'||c.rootBinding.length>512||!reference(c.worldId,128))return fail('adoption_unavailable');
  const root=JSON.parse(c.rootBinding);if(!exact(root,'crv,kty,x,y')||root.kty!=='EC'||root.crv!=='P-256'||!['x','y'].every(k=>typeof root[k]==='string'&&/^[A-Za-z0-9_-]{43}$/.test(root[k])))return fail('adoption_unavailable');
  if(canonicalize(root)!==c.rootBinding)return fail('adoption_unavailable');
  const hash=sha256Hex(c.rootBinding),kid=base64url(Uint8Array.from(hash.match(/../g)!,x=>parseInt(x,16)));if(kid!==c.agentId)return fail('adoption_unavailable');
  return{actorId:ACTOR,agentId:c.agentId,rootBinding:c.rootBinding,worldId:c.worldId,profile:this.profile(c.profile)};
 }
 private matches(row:Record<string,unknown>,p:ReturnType<PersonalAdoption['guard']>,c:LegacyAdoptionCurrent){if(row.actor_id!==ACTOR||row.principal_id!==p.principalId||row.app_id!==p.appId||row.provider!==p.provider||row.subject!==p.subject||row.agent_id!==c.agentId||row.root_binding!==c.rootBinding||row.world_id!==c.worldId)return fail('adoption_changed');}
 private commit(v:unknown,worldId:string):LegacyAdoptionCommit{
  if(!exact(v,'afterHash,eventId,eventSeq,inputSeq,runId,worldId')||v.worldId!==worldId||!reference(v.runId,128)||!reference(v.eventId)||!time(v.inputSeq)||v.inputSeq<1||!time(v.eventSeq)||v.eventSeq<1||typeof v.afterHash!=='string'||!/^[a-f0-9]{64}$/.test(v.afterHash))return fail('adoption_unavailable');
  return{worldId,runId:v.runId,inputSeq:v.inputSeq,eventSeq:v.eventSeq,eventId:v.eventId,afterHash:v.afterHash};
 }
 private result(row:Record<string,unknown>,c:LegacyAdoptionCurrent):LegacyAdoptionResult{
  const value=JSON.parse(String(row.result));if(!exact(value,'profile,receipt')||!exact(value.receipt,'actorId,afterHash,agentId,committedAt,eventId,eventSeq,id,inputSeq,kind,profileRevision,runId,worldId'))return fail('adoption_unavailable');
  const profile=this.profile(value.profile),r=value.receipt;
  if(r.kind!=='legacy_adoption'||r.actorId!==ACTOR||r.agentId!==c.agentId||!receiptId(r.id)||r.id!==row.id||!time(r.committedAt)||r.committedAt!==row.created_at||r.committedAt>this.now()||r.profileRevision!==profile.revision)return fail('adoption_unavailable');
  return{profile,receipt:{...this.commit({worldId:r.worldId,runId:r.runId,inputSeq:r.inputSeq,eventSeq:r.eventSeq,eventId:r.eventId,afterHash:r.afterHash},c.worldId),kind:'legacy_adoption',id:r.id as string,actorId:ACTOR,agentId:c.agentId,committedAt:r.committedAt,profileRevision:profile.revision}};
 }
 get(binding:PersonalBinding):LegacyAdoptionResult|null{return this.safe(()=>this.storage.transactionSync(()=>{
  const p=this.guard(binding),r=this.storage.sql.exec('SELECT * FROM personal_legacy_adoptions WHERE principal_id=?',p.principalId).toArray()[0];if(!r)return null;
  const c=this.current();this.matches(r,p,c);const after=this.guard(binding);if(canonicalize(after)!==canonicalize(p))return fail('adoption_changed');const original=this.result(r,c);return{profile:c.profile,receipt:original.receipt};
 }));}
 adopt(binding:PersonalBinding,ownerProof:LegacyOwnerProof,input:unknown):LegacyAdoptionResult{return this.safe(()=>{
  const b=binding?{...binding,proof:binding.proof?{...binding.proof}:binding.proof}:binding,owner=ownerProof?{...ownerProof}:ownerProof;
  this.guard(b);this.owner(owner);
  if(!exact(input,'appearanceId,displayName,expectedRevision,operationId')||typeof input.operationId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId)||input.operationId.startsWith('msly_')||!time(input.expectedRevision)||input.expectedRevision>=Number.MAX_SAFE_INTEGER)return fail('invalid_adoption');
  let intent:{expectedRevision:number;displayName:string;appearanceId:string};try{intent={expectedRevision:input.expectedRevision,...normalizePersonalProfile(input.displayName,input.appearanceId)};}catch{return fail('invalid_adoption');}
  const operationId=input.operationId,payload=canonicalize(intent);
  return this.storage.transactionSync(()=>{
   const p=this.guard(b);this.owner(owner);const c=this.current(),r=this.storage.sql.exec('SELECT * FROM personal_legacy_adoptions WHERE principal_id=?',p.principalId).toArray()[0];
   if(r){this.matches(r,p,c);if(r.operation_id!==operationId||r.payload!==payload)return fail('adoption_conflict');const result=this.result(r,c);this.guard(b);this.owner(owner);return result;}
   if(this.storage.sql.exec('SELECT 1 FROM personal_legacy_adoptions WHERE actor_id=?',ACTOR).toArray().length)return fail('adoption_conflict');
   const out=this.options.commitProfile(owner,intent);if(!exact(out,'commit,profile'))return fail('adoption_unavailable');const profile=this.profile(out.profile),commit=this.commit(out.commit,c.worldId);if(profile.revision!==intent.expectedRevision+1||profile.displayName!==intent.displayName||profile.appearanceId!==intent.appearanceId)return fail('adoption_unavailable');
   const after=this.current();if(after.agentId!==c.agentId||after.rootBinding!==c.rootBinding||after.worldId!==c.worldId||canonicalize(after.profile)!==canonicalize(profile))return fail('adoption_changed');
   if(canonicalize(this.guard(b))!==canonicalize(p))return fail('adoption_changed');this.owner(owner);
   const at=this.now();if(!time(at))return fail('adoption_unavailable');const receipt:LegacyAdoptionReceipt={...commit,kind:'legacy_adoption',id:'lad_'+crypto.randomUUID(),actorId:ACTOR,agentId:c.agentId,committedAt:at,profileRevision:profile.revision};
   this.storage.sql.exec('INSERT INTO personal_legacy_adoptions (id,principal_id,app_id,provider,subject,actor_id,agent_id,root_binding,world_id,operation_id,payload,result,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',receipt.id,p.principalId,p.appId,p.provider,p.subject,ACTOR,c.agentId,c.rootBinding,c.worldId,operationId,payload,canonicalize({profile,receipt}),at);
   const final=this.current();if(final.agentId!==c.agentId||final.rootBinding!==c.rootBinding||final.worldId!==c.worldId||canonicalize(final.profile)!==canonicalize(profile))return fail('adoption_changed');
   if(canonicalize(this.guard(b))!==canonicalize(p))return fail('adoption_changed');this.owner(owner);
   return{profile,receipt};
  });
 });}
}
