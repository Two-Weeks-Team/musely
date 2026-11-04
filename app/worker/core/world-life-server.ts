/** Server-only adapter, installed only by the trusted OFF-default WorldDO controller.
 * Reads real registry/world/event structures; does not authenticate clients or execute proposals.
 */
import type {WorldState, WorldEvent} from '../../src/engine/world.ts';
import {isRuntimeControlled} from '../../src/engine/inbox.ts';
import {createOwnershipAdapter, type PersonalOwners} from './personal-owners.ts';
import type {Sql} from './ledger.ts';
import {WorldRuntime} from './world-runtime.ts';
import {createProjection, projectInvite, restoreProjection, saveProjection, type AuthorityView, type InviteReceipt, type Projection} from './world-life-contract.ts';

/** Registry ownership dominates names, appearance, connection expiry and an absent controlMode. */
export function serverAuthorityView(owners: PersonalOwners, world: WorldState, now: number,
  placeIds: readonly string[], residentTurnAllowed: boolean): AuthorityView {
  const ownership=createOwnershipAdapter(owners);
  return {worldId:world.worldId,version:world.version,now,residentTurnAllowed,placeIds,
    actors:world.muses.map(m=>({id:m.id,personal:ownership.resolve(m.id).kind!=='resident'||m.controlMode==='personal',
      connected:isRuntimeControlled(world,m.id,now),paused:!!world.paused?.[m.id],busy:!!(m.beat||m.travel)}))};
}

/** Requires server-owned event log rows, never JSON supplied by a client/model. The invite spend
 * event must be from this same world's log. WorldEvent has no worldId, so caller is responsible
 * for selecting it from that world's authenticated server storage. Missing evidence fails closed.
 */
function projectCommittedServerInvite(projection: Projection, world: WorldState,
  inviteId: string, worldEvents: readonly WorldEvent[], now: number): Projection {
  if (world.worldId!==projection.worldId || !Number.isFinite(now)) throw Error('invalid_world_scope');
  const inv=world.inbox?.invites?.find(i=>i.id===inviteId);
  if (!inv) throw Error('missing_server_invite');
  let previous=projection.receipts.filter(r=>r.inviteId===inviteId).at(-1);
  const spend=worldEvents.find(e=>e.kind==='campfire_invite' && e.muse===inv.from && e.at===inv.at &&
    e.data?.invite_id===inv.id && e.data?.spent==='invite_token' && e.data?.place===inv.place);
  if (!previous && !spend) throw Error('missing_committed_spend_evidence');
  // Do not retrospectively infer terminal attendance from today's world. Terminal facts are
  // projected once at their commit, then stable on later reads.
  if (previous && previous.status!=='open') return projection;
  const terminalKind=inv.status==='gathered'?'campfire_gathering':inv.status==='expired'?'campfire_invite_expired':'campfire_invite_cancelled';
  const closing=inv.status==='open'?null:worldEvents.find(e=>e.kind===terminalKind && e.muse===inv.from &&
    e.at===inv.closedAt && e.at<=now && e.place===inv.place && e.data?.invite_id===inv.id);
  if(inv.status!=='open'&&!closing)throw Error('missing_committed_terminal_evidence');
  const gathered=closing?.kind==='campfire_gathering'?closing.data?.muses:null;
  if(inv.status==='gathered' && (!Array.isArray(gathered)||JSON.stringify(gathered)!==JSON.stringify(inv.gathered)))throw Error('invalid_gathering_evidence');
  const r:InviteReceipt={receiptId:`${world.worldId}:${inv.id}:${world.version}`,worldId:world.worldId,
    worldVersion:world.version,at:closing?.at??now,inviteId:inv.id,revision:(previous?.revision??0)+1,placeId:inv.place,
    host:inv.from,invitees:[...inv.to],expiresAt:inv.expiresAt,status:inv.status,
    spentTokenReceiptId:previous?.spentTokenReceiptId ?? spend!.id,
    accepted:inv.to.filter(id=>inv.answers[id]?.answer==='accept'),
    present:inv.status==='gathered'?(gathered as string[]).map(id=>({id,placeId:inv.place,travelling:false,paused:false})):world.muses.filter(m=>(m.id===inv.from||inv.to.includes(m.id))&&projection.placeIds.includes(m.place)).map(m=>({id:m.id,placeId:m.place,travelling:!!m.travel,paused:!!world.paused?.[m.id]}))};
  // Expired/cancelled bootstrap replays the actual opening event before its terminal receipt.
  // worldVersion is the server snapshot observation version, not a fabricated historical version.
  if(!previous && (inv.status==='expired'||inv.status==='cancelled')) {
    const opened={...r,receiptId:r.receiptId+':opening',at:inv.at,status:'open' as const,accepted:[],present:[]};
    projection=projectInvite(projection,opened);previous=opened;r.revision=2;
  }
  // Re-reading a commit must not manufacture a new revision or move the timestamp.
  if (previous && previous.worldVersion===world.version && previous.receiptId===r.receiptId) {
    const same={...r,revision:previous.revision,at:previous.at};
    return projectInvite(projection,same);
  }
  return projectInvite(projection,r);
}

/** Separate additive table. Caller holds the SAME synchronous world transaction. No nested
 * transaction and no independent commit: rollback of the world must roll this write back too.
 * This is a persistence seam, not proof that a production caller has wired it.
 */
export class WorldLifeProjectionStore {
  private sql:Sql;
  constructor(sql:Sql){this.sql=sql;}
  init(){this.sql.exec('CREATE TABLE IF NOT EXISTS world_life_projection (world_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL)');}
  load(worldId:string):{revision:number;state:Projection}|null {
    const row=this.sql.exec('SELECT revision,state FROM world_life_projection WHERE world_id = ?',worldId).toArray()[0];
    if(!row)return null;
    if(!Number.isSafeInteger(row.revision)||Number(row.revision)<0||typeof row.state!=='string')throw Error('invalid_projection_row');
    const state=restoreProjection(row.state);
    if(state.worldId!==worldId)throw Error('projection_world_mismatch');
    return {revision:Number(row.revision),state};
  }
  saveInWorldTransaction(expectedRevision:number|null,state:Projection):number {
    const validated=restoreProjection(saveProjection(state));
    const current=this.load(validated.worldId);
    if((current?.revision??null)!==expectedRevision)throw Error('stale_projection_revision');
    const revision=(current?.revision??-1)+1;
    if(!Number.isSafeInteger(revision))throw Error('projection_revision_overflow');
    this.sql.exec('INSERT INTO world_life_projection (world_id,revision,state) VALUES (?,?,?) ON CONFLICT(world_id) DO UPDATE SET revision=excluded.revision,state=excluded.state',validated.worldId,revision,saveProjection(validated));
    return revision;
  }
}
/** Read only through the actual server runtime, not an event array supplied by a peer.
 * Missing/truncated evidence fails closed. This is internal server code, not an HTTP handler.
 * Authentication is still the existing command/runtime boundary, not this instanceof check.
 */
export function projectRuntimeInvite(projection:Projection,runtime:WorldRuntime,inviteId:string,now:number):Projection {
  if(!(runtime instanceof WorldRuntime)||runtime.worldId!==projection.worldId)throw Error('trusted_runtime_required');
  return projectCommittedServerInvite(projection,runtime.state(),inviteId,runtime.events(0,20_000),now);
}

/** Installed observer reads only matching committed events from the SAME runtime SQL handle.
 * No client-supplied event arrays and no first-20k truncation. The index is opt-in at installation.
 */
export class WorldLifeEventReader {
  private sql:Sql;
  constructor(sql:Sql){this.sql=sql;}
  sharesStorage(sql:Sql){return sql===this.sql;}
  init(){this.sql.exec("CREATE INDEX IF NOT EXISTS world_life_invite_evidence ON events(json_extract(data,'$.invite_id')) WHERE kind IN ('campfire_invite','campfire_gathering','campfire_invite_expired','campfire_invite_cancelled')");}
  read(inviteId:string):WorldEvent[]{return this.sql.exec("SELECT id,tick,at,source,kind,muse,other,place,line,data,tags FROM events WHERE json_extract(data,'$.invite_id')=? AND kind IN ('campfire_invite','campfire_gathering','campfire_invite_expired','campfire_invite_cancelled') ORDER BY seq",inviteId).toArray().map(r=>({...r,data:JSON.parse(String(r.data)),tags:JSON.parse(String(r.tags))}) as WorldEvent);}
}
export function projectStoredRuntimeInvite(projection:Projection,runtime:WorldRuntime,reader:WorldLifeEventReader,inviteId:string,now:number,before?:WorldState):Projection {
  const same=(runtime as WorldRuntime & {ownsResidentGoalStore?:(s:{sharesStorage:(sql:Sql)=>boolean})=>boolean}).ownsResidentGoalStore;
  if(!(runtime instanceof WorldRuntime)||!(reader instanceof WorldLifeEventReader)||runtime.worldId!==projection.worldId||!same?.call(runtime,reader))throw Error('trusted_runtime_storage_required');
  const current=runtime.state(),events=reader.read(inviteId);
  if(current.inbox?.invites?.some(i=>i.id===inviteId))return projectCommittedServerInvite(projection,current,inviteId,events,now);
  // Retention may trim a newly terminal invitation before the same-transaction observer.
  // Recover only its public facts from this commit's before state and the SAME SQL event log.
  const old=before?.inbox?.invites?.find(i=>i.id===inviteId);
  if(!old||old.status!=='open'||before!.worldId!==current.worldId||before!.version>=current.version)throw Error('missing_server_invite');
  const opening=events.find(e=>e.kind==='campfire_invite'&&e.muse===old.from&&e.at===old.at&&e.data?.invite_id===old.id&&e.data?.place===old.place&&e.data?.spent==='invite_token'&&e.data?.deadline===old.expiresAt&&JSON.stringify(e.data?.to)===JSON.stringify(old.to));
  const closing=events.find(e=>['campfire_gathering','campfire_invite_expired','campfire_invite_cancelled'].includes(e.kind)&&e.muse===old.from&&e.place===old.place&&e.at===now&&e.at>=old.at&&e.data?.invite_id===old.id);
  if(!opening||!closing)throw Error('missing_committed_terminal_evidence');
  const restored={...structuredClone(old),note:null,status:closing.kind==='campfire_gathering'?'gathered' as const:closing.kind==='campfire_invite_expired'?'expired' as const:'cancelled' as const,closedAt:closing.at};
  if(restored.status==='expired'&&closing.at<old.expiresAt)throw Error('invalid_terminal_evidence');
  if(restored.status==='gathered'){
    const ids=closing.data?.muses;
    if(!Array.isArray(ids)||new Set(ids).size!==ids.length||!ids.includes(old.from)||ids.some(id=>typeof id!=='string'||![old.from,...old.to].includes(id)))throw Error('invalid_gathering_evidence');
    restored.gathered=[...ids];
    for(const id of ids.filter(id=>id!==old.from)){
      const via=(closing.data?.answers_via as Record<string,unknown>|undefined)?.[id];
      if(via!=='live'&&via!=='rule')throw Error('invalid_gathering_evidence');
      restored.answers[id]={answer:'accept',via,at:closing.at};
    }
  }
  const world={...current,inbox:{...current.inbox!,invites:[restored]}};
  return projectCommittedServerInvite(projection,world,inviteId,events,now);
}
export {createProjection};
