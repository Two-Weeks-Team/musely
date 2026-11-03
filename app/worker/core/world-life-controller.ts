/** Trusted WorldDO installation. OFF by default; no client/model can change this configuration.
 * Dependency capabilities must exist before enabling. This module never signs as a personal Muse.
 */
import {WorldRuntime,type TxSql,type RuntimeOptions} from './world-runtime.ts';
import {createOwnershipAdapter,type PersonalOwners} from './personal-owners.ts';
import {isRuntimeControlled,emptyInbox} from '../../src/engine/inbox.ts';
import * as harness from '../../src/engine/harness.ts';
import {BEATS} from '../../src/engine/beats.ts';
import {PLACES,distanceM} from '../../src/engine/places.ts';
import type {WorldState,WorldEvent,Hooks} from '../../src/engine/world.ts';
import type {Trust} from './trust.ts';
import type {Ledger} from './ledger.ts';
import type {ModelConfig} from './model.ts';
import type {OwnerOf} from './tasks.ts';
import {WorldLifeEventReader,projectStoredRuntimeInvite} from './world-life-server.ts';
import {createProjection,restoreProjection,saveProjection,type Projection} from './world-life-contract.ts';
export const WORLD_LIFE_PLACES=Object.freeze(['commons:campfire','commons:garden','commons:benches']);
type RosterCapability={ACTOR_IDS?:readonly string[];harnessRoleId?:(id:string)=>string;isResidentInstance?:(id:string)=>boolean};
const roster=harness as typeof harness & RosterCapability;
export const isInstalledResidentId=(id:string):boolean=>roster.isResidentInstance?.(id)===true;
type Ownership='resident'|'personal'|'legacy'|'unknown';
type CommitObserver=(before:WorldState,after:WorldState,events:readonly WorldEvent[],now:number)=>void;
type FactoryConfig={enabled:boolean;world:()=>WorldState;ownership:(id:string)=>Ownership;authorize:(world:WorldState,actor:string,peer:string|null,at:number)=>boolean;goalBeatsFor:(id:string)=>readonly string[];ledger:Ledger;model:ModelConfig|null;ownerOf:OwnerOf;ownerMuse:string;now:()=>number};
type Services={residentGoals:unknown;residentWants:unknown;onCommit:CommitObserver};
type Capability=typeof WorldRuntime&{createResidentServices?:(sql:TxSql,config:FactoryConfig)=>Services};

export function worldLifeEnabled(mode:string|undefined):boolean {
 if(mode===undefined||mode===''||mode==='off')return false;
 if(mode!=='sandbox-v1')throw Error('unsupported_world_life_mode');
 return true;
}

export class WorldLifeController {
 private runtime:WorldRuntime|null=null;
 private services:Services;
 private reader:WorldLifeEventReader;
 private gate:NonNullable<Hooks['canMeet']>|null=null;
 private gateVersion=-1;
 private gateAt=0;
 private ready=false;
 private ownership:(id:string)=>Ownership;
 private sql:TxSql;private owners:PersonalOwners;private trust:Trust;private active:()=>boolean;
 constructor(sql:TxSql,owners:PersonalOwners,trust:Trust,ledger:Ledger,model:ModelConfig|null,ownerOf:OwnerOf,active:()=>boolean){
  this.sql=sql;this.owners=owners;this.trust=trust;this.active=active;
  const factory=(WorldRuntime as Capability).createResidentServices;
  if(typeof factory!=='function')throw Error('resident_dependencies_not_installed');
  if(!Array.isArray(roster.ACTOR_IDS)||typeof roster.harnessRoleId!=='function'||typeof roster.isResidentInstance!=='function')throw Error('resident_roster_dependency_not_installed');
  this.ownership=id=>{const kind=createOwnershipAdapter(this.owners).resolve(id).kind;return kind==='unknown'&&isInstalledResidentId(id)?'resident':kind;};
  this.reader=new WorldLifeEventReader(sql);
  this.services=factory(sql,{enabled:true,world:()=>this.requireRuntime().state(),ownership:this.ownership,
   authorize:(s,a,b,at)=>this.authorize(s,a,b,at),goalBeatsFor:id=>BEATS.filter(b=>b.result?.craft&&b.roles?.includes(roster.harnessRoleId!(id))).map(b=>b.id),
   ledger,model,ownerOf:id=>this.ownerOf(id,ownerOf),ownerMuse:'00-jolly',now:()=>Date.now()});
 }
 ownerOf(id:string,fallback:OwnerOf):string|null{return this.ownership(id)==='resident'?null:fallback(id);}
 private requireRuntime(){if(!this.runtime)throw Error('world_life_runtime_not_bound');return this.runtime;}
 bind(runtime:WorldRuntime){if(this.runtime)throw Error('world_life_already_bound');this.runtime=runtime;}
 /** All options are server-created. Runtime independently replaces budget/model and registry authority. */
 runtimeOptions():Partial<RuntimeOptions> {
  const active=this.active;
  const ids=roster.ACTOR_IDS!.filter(id=>!['00-jolly','04-ember','09-copper'].includes(id)); // Templates only; runtime rechecks initialized registry before enrollment.
  return {residentGoals:this.services.residentGoals,residentWants:this.services.residentWants,
   residentLife:{roster:'neighborhood-24-v1',get enabled(){return active();},ownershipKind:this.ownership,allowedPlaceIds:WORLD_LIFE_PLACES,
    initialState:{schema:1,residents:ids.map((id,i)=>({id,roleId:roster.harnessRoleId!(id),goal:'Use an available catalog activity',routine:[0,8,16].map((hour,j)=>({hour,place:WORLD_LIFE_PLACES[(i+j)%WORLD_LIFE_PLACES.length]})),memories:[],promises:[],lastServedAt:0,served:0}))}},
   onCommit:(before:WorldState,after:WorldState,events:readonly WorldEvent[],now:number)=>this.onCommit(before,after,events,now),
  } as unknown as Partial<RuntimeOptions>;
 }
 async ensureAgents(ownerRoot:Parameters<Trust['ensureAgents']>[0]){
  const ids=roster.ACTOR_IDS!.filter(isInstalledResidentId);
  await (this.trust.ensureAgents as unknown as (root:Parameters<Trust['ensureAgents']>[0],ids:readonly string[])=>Promise<void>).call(this.trust,ownerRoot,ids);
  if(ids.some(id=>this.trust.agentByMuse(id)?.kind!=='resident'))throw Error('resident_trust_dependency_not_installed');
 }
 init(){
  // Prevent enabling a partial dependency composition that ignores residentLife options.
  if(!this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='resident_life'").toArray().length)throw Error('resident_life_dependency_not_installed');
  this.sql.exec('CREATE TABLE IF NOT EXISTS world_life_invites (world_id TEXT NOT NULL, invite_id TEXT NOT NULL, revision INTEGER NOT NULL, spent_receipt TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(world_id,invite_id), UNIQUE(world_id,spent_receipt))');
  this.reader.init();this.ready=true;
  const s=this.requireRuntime().state(),at=Date.now();
  // A stored open invite can legitimately be overdue after downtime. Never invent a
  // closure or prevent boot: the actual heartbeat upkeep must commit its expiry first.
  const catchup={...s,inbox:{...(s.inbox??emptyInbox()),invites:(s.inbox?.invites??[]).filter(i=>i.status!=='open'||i.expiresAt>at)}};
  this.sql.transactionSync(()=>this.onCommit({...s,inbox:{...(s.inbox??emptyInbox()),invites:[]}},catchup,[],at));
 }
 acceptMeetingGate(world:WorldState,at:number,gate:NonNullable<Hooks['canMeet']>){this.gate=gate;this.gateVersion=world.version;this.gateAt=at;}
 private authorize(s:WorldState,id:string,peer:string|null,at:number):boolean {
  const actor=s.muses.find(m=>m.id===id);
  if(!this.ready||!this.active()||!actor||this.ownership(id)!=='resident'||isRuntimeControlled(s,id,at)||s.paused?.[id]||this.trust.suspended(id))return false;
  if(peer===null)return true;
  // Match the main team's pending-claim restriction for newly admitted personal actors.
  if(this.trust.agentByMuse(peer)?.kind==='personal')return false;
  const other=s.muses.find(m=>m.id===peer),a=PLACES.find(p=>p.id===actor.place),b=PLACES.find(p=>p.id===other?.place);
  if(!other||actor.travel||other.travel||!a||!b||a.zone!=='commons'||b.zone!=='commons'||distanceM(a,b)>100||s.paused?.[peer]||this.trust.suspended(peer))return false;
  if(!this.gate||this.gateVersion!==s.version||at<this.gateAt||at-this.gateAt>60_000)return false;
  return this.gate(s,actor,other,a,at).ok===true;
 }
 private load(inviteId:string):{revision:number;state:Projection}|null {
  const row=this.sql.exec('SELECT revision,state FROM world_life_invites WHERE world_id=? AND invite_id=?',this.requireRuntime().worldId,inviteId).toArray()[0];
  return row?{revision:Number(row.revision),state:restoreProjection(String(row.state))}:null;
 }
 private onCommit(before:WorldState,after:WorldState,events:readonly WorldEvent[],now:number){
  if(!this.ready||!this.active())return;
  this.services.onCommit(before,after,events,now);
  // Per-invitation snapshots avoid a world-wide4096 receipt lifetime ceiling. The unique
  // spend column still prevents one committed token receipt backing two invitations.
  for(const inv of after.inbox?.invites??[]){
   if(!WORLD_LIFE_PLACES.includes(inv.place))continue;
   const old=before.inbox?.invites?.find(x=>x.id===inv.id);
   if(old&&JSON.stringify(old)===JSON.stringify(inv))continue;
   const row=this.load(inv.id),state=projectStoredRuntimeInvite(row?.state??createProjection(after.worldId,WORLD_LIFE_PLACES),this.requireRuntime(),this.reader,inv.id,now);
   if(row&&saveProjection(state)===saveProjection(row.state))continue;
   const receipt=state.receipts.at(-1)!;
   this.sql.exec('INSERT INTO world_life_invites (world_id,invite_id,revision,spent_receipt,state) VALUES (?,?,?,?,?) ON CONFLICT(world_id,invite_id) DO UPDATE SET revision=excluded.revision,state=excluded.state',after.worldId,inv.id,(row?.revision??-1)+1,receipt.spentTokenReceiptId,saveProjection(state));
  }
 }
 view(){
  const runtime=this.requireRuntime(),s=runtime.state();
  const rows=this.sql.exec('SELECT state FROM world_life_invites WHERE world_id=? ORDER BY rowid DESC LIMIT 100',runtime.worldId).toArray();
  const invitations=rows.map(r=>restoreProjection(String(r.state)).receipts.at(-1)!).map(r=>({id:r.inviteId,placeId:r.placeId,status:r.status,host:r.host,invitees:r.invitees,accepted:r.accepted,expiresAt:r.expiresAt,awaitingUpkeep:r.status==='open'&&r.expiresAt<=Date.now(),worldVersion:r.worldVersion}));
  // Only allowlisted public goal fields for registry-positive resident actors, never user goals.
  const goals=this.sql.exec('SELECT body FROM resident_wants_goals WHERE world_id=? ORDER BY rowid DESC LIMIT 100',runtime.worldId).toArray().map(r=>JSON.parse(String(r.body))).filter(g=>typeof g.muse==='string'&&this.ownership(g.muse)==='resident').map(g=>({id:g.id,muse:g.muse,beat:g.beat,status:g.status}));
  return {enabled:true,mode:'sandbox-v1',worldVersion:s.version,places:[...WORLD_LIFE_PLACES],invitations,goals};
 }
}
