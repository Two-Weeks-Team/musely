import {createOwnershipAdapter} from './personal-owners.ts';
import {ReceiptSnapshots} from './receipt-snapshots.ts';
import {PRESETS,defaultOwner,nextOwnerLocation,type OwnerLocation} from '../../src/engine/location.ts';
import {followOwner} from '../../src/engine/travel.ts';
import {resumeMuse} from '../../src/engine/world.ts';
import {stopInWorld} from './owner-control.ts';
// Personal bootstrap + signed world admission. All authority/receipt data is private to the same DO SQL.
import {PersonalRegistryError,type PersonalStorage,type PersonalActor} from './personal-owners.ts';
import {PersonalAuthority} from './personal-authority.ts';
import {PersonalEntry,ENTRY_SCOPE_HASH,type CommittedEntryReceipt} from './personal-entry.ts';
import type {PersonalAuthStore} from './personal-session.ts';
 import type {PersonalRegistration,PersonalBinding} from './personal-registration.ts';
import type {Trust} from './trust.ts';
 import type {WorldRuntime} from './world-runtime.ts';
 import type {Hooks} from '../../src/engine/world.ts';
import {admitPersonal,actorProfile} from '../../src/engine/participants.ts';
import {executeCommand,signCommand,worldHandler} from './commands.ts';
 import {bodyHash} from './run-log.ts';
import {dispatch,type McpOutcome} from './mcp-server.ts';
 import {runTool,toolList,InvalidParams,type ToolResult} from './mcp-tools.ts';
import {envelopeEvidence} from './a2a.ts';
 import {emptyInbox,CONNECTED_REFRESH_MS} from '../../src/engine/inbox.ts';
type Bearer={actor:PersonalActor;
 id:string;
 version:number;
 scopes:string[];
 createdAt:number};
const fail=(code:string):never=>{throw new PersonalRegistryError(code);
 };
const tool=(value:Record<string,unknown>,error=false):ToolResult=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:error});
const denied=(reason:string)=>tool({ok:false,refused:reason,reason},true);
export class PersonalWorld{
 readonly authority:PersonalAuthority;
 readonly entry:PersonalEntry;
 private receiptSnapshots:ReceiptSnapshots;
 constructor(privateStorage:PersonalStorage,auth:PersonalAuthStore,registration:PersonalRegistration,runtime:WorldRuntime,trust:Trust,baseUrl:string,hooks:Hooks,legacy:{root:()=>JsonWebKey|null;
 claimed:()=>boolean}={root:()=>null,claimed:()=>false}){
  this.storage=privateStorage;
 this.receiptSnapshots=new ReceiptSnapshots(privateStorage.sql);
 this.auth=auth;
 this.registration=registration;
 this.runtime=runtime;
 this.trust=trust;
 this.baseUrl=baseUrl;
 this.hooks=hooks;
 this.legacy=legacy;
  this.authority=new PersonalAuthority(privateStorage,auth);
  this.entry=new PersonalEntry(privateStorage,auth,{authority:this.authority,currentWorld:actorId=>({worldId:runtime.worldId,paused:!!runtime.state().paused?.[actorId]||trust.suspended(actorId)}),readReceipt:id=>this.receipt(id)});
 }
 private legacy:{root:()=>JsonWebKey|null;
 claimed:()=>boolean};
 private storage:PersonalStorage;
 private auth:PersonalAuthStore;
 private registration:PersonalRegistration;
 private runtime:WorldRuntime;
 private trust:Trust;
 private baseUrl:string;
 private hooks:Hooks;
 init(){this.authority.init();
 this.receiptSnapshots.init();
 this.entry.init();
 this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_owner_locations (actor_id TEXT PRIMARY KEY,location TEXT NOT NULL)');
 this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_connector_activity (key_id TEXT PRIMARY KEY REFERENCES personal_authority_keys(id),actor_id TEXT NOT NULL,grant_version INTEGER NOT NULL,last_seen_at INTEGER NOT NULL)');
 this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_entry_receipts (id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL UNIQUE,actor_id TEXT NOT NULL,agent_id TEXT NOT NULL,root_ref TEXT NOT NULL,key_id TEXT NOT NULL,grant_version INTEGER NOT NULL,profile_revision INTEGER NOT NULL,world_id TEXT NOT NULL,committed_at INTEGER NOT NULL,run_id TEXT NOT NULL,input_seq INTEGER NOT NULL,event_seq INTEGER NOT NULL,event_id TEXT NOT NULL,after_hash TEXT NOT NULL,command_id TEXT NOT NULL,payload_hash TEXT NOT NULL,UNIQUE(agent_id,command_id))');
 }
 private own(b:PersonalBinding){if(!b||!this.auth.active(b.sidDigest,b.proof,b.appId,Date.now()))return fail('personal_session_required');
 return this.auth.owners.actorForPrincipal(b.proof.principalId)??fail('draft_required');
 }
 private safeAuthority(v:{actorId:string;
 version:number;
 active:boolean;
 scopes:string[]}){return{actorId:v.actorId,version:v.version,active:v.active,scopes:[...v.scopes]};
 }
 async authorityOwn(b:PersonalBinding){return this.safeAuthority(await this.authority.own(b));
 }
 async grant(b:PersonalBinding,input:unknown){return this.safeAuthority(await this.authority.grant(b,input,v=>{if(this.runtime.state().paused?.[v.actorId])this.runtime.commitExternal(Date.now(),'personal-resume-'+v.version,(s,emit)=>{resumeMuse(s,v.actorId);
 emit({at:Date.now(),source:'live',kind:'muse_resumed',muse:v.actorId,data:{actor:'owner',reason:'personal_delegation',version:v.version},tags:[]});
 });
 }));
 }
 revoke(b:PersonalBinding,input:unknown){if(!input||typeof input!=='object'||Object.keys(input).join(',')!=='expectedVersion')return fail('invalid_authority');
 return this.storage.transactionSync(()=>{const v=this.authority.revokeAuthority(b,(input as {expectedVersion:number}).expectedVersion);
 if(this.runtime.state().muses.some(m=>m.id===v.actorId))this.runtime.commitExternal(Date.now(),'personal-revoke-'+v.version,(s,emit)=>{const ownerEmit:typeof emit=e=>emit({...e,data:{...e.data,actor:'owner'}});
 ownerEmit({at:Date.now(),source:'live',kind:'delegation_revoked',muse:v.actorId,data:{newVersion:v.version},tags:['revocation']});
 stopInWorld(s,ownerEmit,v.actorId,v.version,'personal-owner',Date.now(),false);
 });
 return this.safeAuthority(v);
 });
 }
 status(b:PersonalBinding|null){if(!b)return{profile:null,authority:null,keys:[],connection:{connected:false,lastSeenAt:null},entry:this.entry.project(null)};
 return this.storage.transactionSync(()=>{if(!this.auth.active(b.sidDigest,b.proof,b.appId,Date.now()))return fail('personal_session_required');
 const profile=this.registration.profile(b);
 if(!profile)return{profile:null,authority:null,keys:[],connection:{connected:false,lastSeenAt:null},entry:this.entry.project(b)};
 const actor=this.own(b),g=this.storage.sql.exec('SELECT version,active,scopes FROM personal_authority WHERE actor_id=?',actor.actorId).toArray()[0];
 const seen=this.storage.sql.exec('SELECT max(a.last_seen_at) AS seen FROM personal_connector_activity a JOIN personal_authority_keys k ON k.id=a.key_id JOIN personal_authority g ON g.actor_id=k.actor_id WHERE a.actor_id=? AND k.actor_id=? AND k.agent_id=? AND k.root_ref=? AND k.revoked_at IS NULL AND a.grant_version=k.grant_version AND k.grant_version=g.version AND g.active=1 AND g.agent_id=k.agent_id AND g.root_ref=k.root_ref',actor.actorId,actor.actorId,actor.agentId,actor.rootRef).toArray()[0]?.seen;
 const lastSeenAt=typeof seen==='number'&&Number.isSafeInteger(seen)&&seen>0?seen:null;
 return{profile,authority:{actorId:actor.actorId,version:Number(g?.version??0),active:Number(g?.active??0)===1,scopes:g?JSON.parse(String(g.scopes)):[]},keys:this.authority.listKeys(b),connection:{connected:lastSeenAt!==null,lastSeenAt},entry:this.entry.project(b)};
 });
 }
 locationFor(actorId:string):OwnerLocation|undefined{const row=this.storage.sql.exec('SELECT location FROM personal_owner_locations WHERE actor_id=?',actorId).toArray()[0];
 return row?JSON.parse(String(row.location)):undefined;
 }
 location(b:PersonalBinding){const actor=this.own(b);
 return{location:this.locationFor(actor.actorId)??null,presets:PRESETS.map(({id,label})=>({id,label}))};
 }
 setLocation(b:PersonalBinding,input:unknown){return this.storage.transactionSync(()=>{const actor=this.own(b),at=Date.now();
 if(!input||typeof input!=='object'||Array.isArray(input)||(input as {source?:unknown}).source!=='virtual')return fail('invalid_location');
 const out=nextOwnerLocation(this.locationFor(actor.actorId)??defaultOwner(actor.actorId,at),input,at);
 if(!out.ok)return fail('invalid_location');
 this.storage.sql.exec('INSERT INTO personal_owner_locations (actor_id,location) VALUES (?,?) ON CONFLICT(actor_id) DO UPDATE SET location=excluded.location',actor.actorId,JSON.stringify(out.owner));
 let follow:ReturnType<typeof followOwner>=null;
 if(this.runtime.state().muses.some(m=>m.id===actor.actorId))this.runtime.commitExternal(at,'personal-location-'+at,(s,emit)=>{follow=followOwner({...s,owner:out.owner},at,emit,this.hooks);
 emit({at,source:'live',kind:'personal_location_changed',muse:actor.actorId,data:{actor:'owner',changed:true},tags:[]});
 });
 return{...this.location(b),follow};
 });
 }
 patchProfile(b:PersonalBinding,input:unknown){return this.storage.transactionSync(()=>{const profile=this.registration.patch(b,input);
 if(this.runtime.state().muses.some(m=>m.id===profile.actorId))this.runtime.commitExternal(Date.now(),'personal-profile-'+profile.revision,(s,emit)=>{s.muses.find(m=>m.id===profile.actorId)!.profile=actorProfile(profile,profile.actorId);
 emit({at:Date.now(),source:'live',kind:'personal_profile_updated',muse:profile.actorId,data:{actor:'owner',profile},tags:[]});
 });
 return profile;
 });
 }
 ownerOf(id:string):string|null{const v=createOwnershipAdapter(this.auth.owners).resolve(id);
 return v.kind==='resident'?null:v.kind==='unknown'?'musely:unknown-owner':v.ownerId;
 }
 /** No browser session is fabricated for bearer authentication. Ownership is durable SQL, independent of logout. */
 lookup(hash:string):Bearer|null{
  if(!/^[a-f0-9]{64}$/.test(hash))return null;
  const k=this.storage.sql.exec('SELECT * FROM personal_authority_keys WHERE hash=? AND revoked_at IS NULL',hash).toArray()[0];
 if(!k)return null;
  const actor=this.auth.owners.actor(String(k.actor_id));
 if(!actor||actor.agentId!==k.agent_id||actor.rootRef!==k.root_ref)return null;
  const g=this.storage.sql.exec('SELECT version,active,scopes,agent_id,root_ref FROM personal_authority WHERE actor_id=?',actor.actorId).toArray()[0];
  if(!g||Number(g.active)!==1||g.agent_id!==actor.agentId||g.root_ref!==actor.rootRef||Number(g.version)!==Number(k.grant_version))return null;
  const scopes=JSON.parse(String(g.scopes));
 if(!Array.isArray(scopes)||!scopes.length||!scopes.every(x=>typeof x==='string'))return null;
  const root=this.storage.sql.exec('SELECT actor_id,agent_id FROM personal_actor_roots WHERE root_ref=?',actor.rootRef).toArray()[0];
 if(!root||root.actor_id!==actor.actorId||root.agent_id!==actor.agentId)return null;
  return{actor,id:String(k.id),version:Number(g.version),scopes,createdAt:Number(k.created_at)};
 }
 private attempt(b:Bearer,id:string,commandId:string,at:number){
  const r=this.storage.sql.exec('SELECT * FROM personal_entry_attempts WHERE id=? AND actor_id=?',id,b.actor.actorId).toArray()[0];
  if(!r||r.agent_id!==b.actor.agentId||r.root_ref!==b.actor.rootRef||r.key_id!==b.id||Number(r.grant_version)!==b.version||r.world_id!==this.runtime.worldId||r.scope_hash!==ENTRY_SCOPE_HASH)return fail('entry_binding_invalid');
  if(this.runtime.state().paused?.[b.actor.actorId]||this.trust.suspended(b.actor.actorId))return fail('entry_paused');
  if(r.status==='activated'){const receipt=this.receipt(id),stored=this.storage.sql.exec('SELECT command_id FROM personal_entry_receipts WHERE attempt_id=?',id).toArray()[0];
 if(!receipt||stored?.command_id!==commandId)return fail('entry_already_activated');
 return r;
 }
  if(r.status!=='pending')return fail('entry_cancelled');
 if(Number(r.expires_at)<=at)return fail('entry_expired');
  if(this.auth.owners.profile(b.actor.actorId)?.revision!==Number(r.profile_revision))return fail('entry_profile_conflict');
 return r;
 }
 private receipt(id:string):CommittedEntryReceipt|null{
  const r=this.storage.sql.exec('SELECT * FROM personal_entry_receipts WHERE attempt_id=?',id).toArray()[0];
 if(!r)return null;
  const record=this.runtime.eventRecord(String(r.event_id)),input=record?.input;
  const archived=input?.afterSnapshot;
  const body=archived?.body??(!archived&&input?.afterSnapshotError==='replay_storage_limit'?this.receiptSnapshots.read({kind:'personal_entry',actorId:String(r.actor_id),worldId:String(r.world_id),runId:String(r.run_id),inputSeq:Number(r.input_seq),eventId:String(r.event_id),afterHash:String(r.after_hash)}):null);
  if(!record||record.event.kind!=='personal_entered'||record.event.muse!==r.actor_id||record.event.seq!==Number(r.event_seq)||record.runId!==r.run_id||input?.seq!==Number(r.input_seq)||!body||(archived?input.afterSnapshotError!==null||archived.hash!==r.after_hash:input.afterSnapshotError!=='replay_storage_limit')||typeof r.after_hash!=='string'||input.afterHash!==r.after_hash||bodyHash(body)!==r.after_hash||input.input?.actorId!==r.agent_id||input.input?.commandId!==r.command_id||input.input?.action!=='enter_world'||input.input?.payloadHash!==r.payload_hash||input.input?.ok!==true)return null;
  const s=JSON.parse(body);
 if(s.worldId!==r.world_id||s.tick!==input.tick||s.version!==input.versionAfter)return null;
  const muse=s.muses?.find((m:{id:string})=>m.id===r.actor_id);
 if(!muse||muse.controlMode!=='personal'||muse.profile?.actorId!==r.actor_id||muse.profile?.revision!==Number(r.profile_revision))return null;
  return{id:String(r.id),attemptId:String(r.attempt_id),actorId:String(r.actor_id),agentId:String(r.agent_id),rootRef:String(r.root_ref),keyId:String(r.key_id),grantVersion:Number(r.grant_version),profileRevision:Number(r.profile_revision),worldId:String(r.world_id),committedAt:Number(r.committed_at),runId:String(r.run_id),inputSeq:Number(r.input_seq),eventSeq:Number(r.event_seq),afterHash:r.after_hash};
 }
 private record(b:Bearer,attempt:Record<string,unknown>,commandId:string,done:{events:{id:string}[];
 row:{payloadHash:string;
 result:{worldVersion:number;
 ok:boolean}}},at:number){
  if(!done.row.result.ok)return fail('entry_commit_invalid');
  const events=done.events.map(e=>this.runtime.eventRecord(e.id)).filter(e=>e?.event.kind==='personal_entered'&&e.event.muse===b.actor.actorId);
  if(events.length!==1)return fail('entry_commit_invalid');
 const event=events[0]!,input=event.input;
  if(!input)return fail('entry_commit_invalid');
  const witness={kind:'personal_entry' as const,actorId:b.actor.actorId,worldId:this.runtime.worldId,runId:event.runId!,inputSeq:input.seq,eventId:event.event.id,afterHash:input.afterHash};
  if(!input.afterSnapshot&&input.afterSnapshotError==='replay_storage_limit')this.receiptSnapshots.put(witness,this.runtime.state());
  const snapshot=input.afterSnapshot?.body??(input.afterSnapshotError==='replay_storage_limit'?this.receiptSnapshots.read(witness):null);
  if(!snapshot||(input.afterSnapshot?input.afterSnapshotError!==null:input.afterSnapshotError!=='replay_storage_limit')||input.versionAfter!==done.row.result.worldVersion||input.input?.actorId!==b.actor.agentId||input.input?.commandId!==commandId||input.input?.action!=='enter_world'||input.input?.ok!==true||typeof input.afterHash!=='string'||bodyHash(snapshot)!==input.afterHash)return fail('entry_commit_invalid');
  this.storage.sql.exec('INSERT INTO personal_entry_receipts (id,attempt_id,actor_id,agent_id,root_ref,key_id,grant_version,profile_revision,world_id,committed_at,run_id,input_seq,event_seq,event_id,after_hash,command_id,payload_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)','per_'+crypto.randomUUID(),attempt.id,b.actor.actorId,b.actor.agentId,b.actor.rootRef,b.id,b.version,attempt.profile_revision,this.runtime.worldId,at,event.runId,input.seq,event.event.seq,event.event.id,input.afterHash,commandId,done.row.payloadHash);
  this.storage.sql.exec("UPDATE personal_entry_attempts SET status='activated' WHERE id=? AND status='pending'",attempt.id);
  if(!this.receipt(String(attempt.id)))return fail('entry_commit_invalid');
 }
 /** A new key/grant does not inherit another credential's activation. No history scan/fallback. */
 private admitted(b:Bearer):boolean{
  if(!this.runtime.state().muses.some(m=>m.id===b.actor.actorId&&m.controlMode==='personal'))return false;
  const row=this.storage.sql.exec("SELECT id,key_id,grant_version FROM personal_entry_attempts WHERE actor_id=? AND status='activated' ORDER BY created_at DESC,rowid DESC LIMIT 1",b.actor.actorId).toArray()[0];
  return !!row&&row.key_id===b.id&&Number(row.grant_version)===b.version&&!!this.receipt(String(row.id));
 }
 private async enter(hash:string,b:Bearer,args:unknown):Promise<ToolResult>{
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['attempt_id','command_id','expected_version'].includes(k)))throw new InvalidParams();
  const a=args as {attempt_id:string;command_id:string;expected_version?:number};if(typeof a.attempt_id!=='string'||typeof a.command_id!=='string'||!/^pea_[a-f0-9-]{36}$/.test(a.attempt_id)||!/^[A-Za-z0-9_-]{8,64}$/.test(a.command_id)||/^(msly_|pak_|pea_)/.test(a.command_id)||(a.expected_version!==undefined&&(!Number.isSafeInteger(a.expected_version)||a.expected_version<0)))throw new InvalidParams();
  if(!b.scopes.includes('world_entry'))return denied('scope_not_delegated');
  try{this.attempt(b,a.attempt_id,a.command_id,Date.now());}catch(e){return denied(e instanceof PersonalRegistryError?e.code:'entry_unavailable');}
  const exec=await this.trust.custodialExecutor(b.actor.actorId,null);if(!exec)return denied('delegation_revoked');
  const cmd=await signCommand(exec,{worldId:this.runtime.worldId,expectedVersion:a.expected_version??null,action:'enter_world',payload:{attempt_id:a.attempt_id},recipient:worldHandler(this.runtime.worldId),scope:'world_entry',ownerClaimed:false,now:Date.now(),commandId:a.command_id});
  let currentAttempt:Record<string,unknown>|null=null;
  const authorize=()=>{const current=this.lookup(hash);if(!current||current.id!==b.id||current.actor.actorId!==b.actor.actorId||current.actor.rootRef!==b.actor.rootRef||current.version!==b.version)return'agent_key_revoked';try{currentAttempt=this.attempt(current,a.attempt_id,a.command_id,Date.now());return null;}catch(e){return e instanceof PersonalRegistryError?e.code:'entry_unavailable';}};
  try{const out=await executeCommand({runtime:this.runtime,trust:this.trust,authorize,now:Date.now},cmd,{recipient:worldHandler(this.runtime.worldId),apply:(s,emit,at)=>{const p=this.auth.owners.profile(b.actor.actorId);if(!p||p.revision!==Number(currentAttempt?.profile_revision))return{ok:false,code:'entry_profile_conflict'};const added=admitPersonal(s,p,at);s.muses.find(m=>m.id===p.actorId)!.profile=actorProfile(p,p.actorId);emit({at,source:'live',kind:'personal_entered',muse:p.actorId,place:s.muses.find(m=>m.id===p.actorId)!.place,data:{actorOrigin:'connected',tool:'enter_world',command_id:cmd.commandId,new_actor:added,profile:p,envelope:envelopeEvidence(cmd.signed)},tags:['personal_entry']});return{ok:true,output:{actorId:p.actorId}};},afterLog:(done,at)=>this.record(b,currentAttempt!,cmd.commandId,done,at)});
   return out.result.ok?tool({ok:true,duplicate:out.duplicate,command:out.result,entry_receipt:this.receipt(a.attempt_id)?{id:this.receipt(a.attempt_id)!.id,actorId:b.actor.actorId,worldId:this.runtime.worldId}:null}):denied(out.result.error?.code??'entry_refused');
  }catch{return denied('entry_unavailable');}
 }
 async mcp(hash:string,method:string,params:unknown,notification:boolean):Promise<McpOutcome>{
  const b=this.lookup(hash);if(!b)return{status:'unauthorized'};
  if(notification&&method&&!method.startsWith('notifications/'))return{status:'ok',error:{code:-32600,message:'Invalid Request: only notifications may omit the id'}};
  const call=async(name:string,args:unknown):Promise<ToolResult>=>{
   if(name==='register_agent'){if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw new InvalidParams();const claim=this.trust.personalClaim(b.actor.actorId);return tool({agent_id:b.actor.agentId,muse:b.actor.actorId,name:this.auth.owners.profile(b.actor.actorId)?.displayName,signer_kind:'server_custodial',claim:{status:claim.status,owner_claimed:claim.claimed},tools:toolList(this.runtime.state().muses.map(m=>m.id),true).map(t=>t.name),entry_required:!this.admitted(b)});}
   if(name==='enter_world')return this.enter(hash,b,args);
   if(!this.admitted(b))return denied('entry_required');
   if(name==='heartbeat_check'&&!b.scopes.includes('walk_and_greet'))return denied('scope_not_delegated');
   const last=this.runtime.state().inbox?.connected[b.actor.actorId];if(last===undefined||Date.now()-last>=CONNECTED_REFRESH_MS)this.runtime.commitExternal(Date.now(),'personal-connected-'+crypto.randomUUID(),(s,emit)=>{(s.inbox??=emptyInbox()).connected[b.actor.actorId]=Date.now();emit({at:Date.now(),source:'live',kind:'agent_connected',muse:b.actor.actorId,data:{via:'mcp'},tags:[]});});
   const authorize=()=>this.lookup(hash)?.version===b.version?null:'agent_key_revoked';
   return runTool({trust:this.trust,runtime:this.runtime,hooks:this.hooks,ownerRoot:this.legacy.root(),ownerClaimed:this.legacy.claimed(),ownerClaimedNow:this.legacy.claimed,personal:true,ownerLocation:()=>this.locationFor(b.actor.actorId),baseUrl:this.baseUrl,key:{id:b.id,muse:b.actor.actorId,signerKind:'server_custodial',createdAt:b.createdAt,lastUsedAt:null,revokedAt:null},now:Date.now,authorize,ownerOf:id=>this.ownerOf(id)},name,args);
  };
  try{const out=await dispatch(method,params,{list:()=>toolList(this.runtime.state().muses.map(m=>m.id),true),call,isInvalidParams:e=>e instanceof InvalidParams});
   if(out.result&&(out.result as {isError?:boolean}).isError!==true&&!out.error){
    // Owner-private connection observation, separate from world presence, admission and claim.
    // Re-check after any awaited tool work; revoked keys cannot leave a positive observation.
    try{this.storage.transactionSync(()=>{const current=this.lookup(hash);if(!current||current.id!==b.id||current.actor.actorId!==b.actor.actorId||current.actor.rootRef!==b.actor.rootRef||current.version!==b.version)return;
     this.storage.sql.exec('INSERT INTO personal_connector_activity (key_id,actor_id,grant_version,last_seen_at) VALUES (?,?,?,?) ON CONFLICT(key_id) DO UPDATE SET last_seen_at=max(last_seen_at,excluded.last_seen_at)',b.id,b.actor.actorId,b.version,Date.now());
    });}catch{/* An optional observation must not turn an already-completed tool action into a retry. */}
   }
   if(method==='tools/list'&&out.result)out.result={...(out.result as Record<string,unknown>),cacheScope:'private',ttlMs:0};return{status:'ok',...out};}catch{return{status:'ok',error:{code:-32603,message:'Internal error'}};}
 }
}
