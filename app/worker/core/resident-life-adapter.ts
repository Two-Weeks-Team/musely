/** Opt-in adapter only. No production caller, timer, model call or world mutation. */
import {localClock, spotlightFor, type WorldState, type WorldEvent} from '../../src/engine/world.ts';
import {sha256Hex} from '../../src/engine/sha256.ts';
import {hasActorHarness} from '../../src/engine/harness.ts';
import {PRINCIPALS} from './owner-session.ts';
import {isRuntimeControlled} from '../../src/engine/inbox.ts';
import {proposeLifeTurn, remember, restoreLife, saveLife, type LifeState, type LifeProposal} from '../../src/engine/resident-life.ts';
import {projectResidentPromises} from './resident-promises.ts';

/** Respect the real scheduler's chosen resident. Never steal visitor priority or personal control. */
export type ResidentOwnershipKind = 'resident'|'legacy'|'personal'|'unknown';
export const knownResident = (id:string,kind:(id:string)=>ResidentOwnershipKind,includeOperatingResidents=false):boolean =>
  hasActorHarness(id) && (includeOperatingResidents&&['04-ember','09-copper'].includes(id)||!Object.values(PRINCIPALS).some(p=>p.muses.includes(id))) && kind(id)==='resident';

export function residentProposalForWorld(life:LifeState, world:WorldState, now:number,
  options:{enabled:boolean;residentTurnAllowed:boolean;includeOperatingResidents?:boolean;allowedPlaceIds:readonly string[];promiseLeadMs?:number;promiseGraceMs?:number;ownershipKind?:(id:string)=>ResidentOwnershipKind}):LifeProposal|null {
  if(options.enabled!==true || options.residentTurnAllowed!==true || world.muses.length===0) return null;
  const spot=spotlightFor(world,now);
  if(spot.priority) return null;
  const actor=world.muses.find(m=>m.id===spot.muse);
  if(!actor || !options.ownershipKind || !knownResident(actor.id,options.ownershipKind,options.includeOperatingResidents) || actor.intent || actor.travel || (actor.beat && actor.beat.endsAt>now ) || world.paused?.[actor.id] || isRuntimeControlled(world,actor.id,now)) return null;
  const pending=world.inbox?.tasks.some(t=>t.status==='pending'&&(t.from===actor.id||t.to===actor.id));
  const invited=world.inbox?.invites?.some(i=>i.status==='open'&&(i.from===actor.id||i.to.includes(actor.id)));
  const approached=world.muses.some(m=>m.id!==actor.id&&m.intent?.target===actor.id);
  if(pending||invited||approached) return null;
  return proposeLifeTurn(life,{now,hour:localClock(now).hour,worldVersion:world.version,
    authorities:[{id:actor.id,connected:false,paused:false}],allowedPlaceIds:options.allowedPlaceIds,
    residentTurnAllowed:true,promiseLeadMs:options.promiseLeadMs,promiseGraceMs:options.promiseGraceMs});
}

/** Only pass already-committed server events from this world's append-only event log.
 * Records small factual public receipts, never event.line/data or a user's private Wants.
 * This is not an authenticity verifier. Do not expose it as an untrusted client endpoint.
 */
export function rememberCommittedResidentEvents(life:LifeState,world:WorldState,events:readonly WorldEvent[],now:number,allowed:(id:string)=>boolean=()=>true,before?:WorldState):LifeState {
  let next=restoreLife(saveLife(life));
  for(const e of events){
    if(!e.muse || !['arrive','encounter','craft','greet','encounter_reply'].includes(e.kind) || e.at>now || e.tick>world.tick) continue;
    if(e.kind==='greet'&&e.data?.public!==true)continue;
    const recipients=[e.muse,...(e.other&&['encounter','greet','encounter_reply'].includes(e.kind)?[e.other]:[])];
    for(const id of new Set(recipients)){
      if(!allowed(id)||!world.muses.some(m=>m.id===id)||!next.residents.some(m=>m.id===id)||isRuntimeControlled(world,id,now))continue;
      const receiving=id!==e.muse;
      const rawId=receiving?`${e.id}:received:${id}`:e.id;
      const bounded=(value:string)=>value.length<=160&&!/[\u0000-\u001f<>]/.test(value)?value:`event-sha256:${sha256Hex(value)}`;
      next=remember(next,id,{id:bounded(rawId),kind:'executed',at:e.at,subject:receiving?e.muse:e.other??e.place??e.muse,
        publicSummary:`Committed ${e.kind} event${receiving?' received':''}`,source:e.source,evidenceId:bounded(e.id)});
    }
  }
  return projectResidentPromises(next,world,events,now,allowed,before);
}

/** Matches the existing synchronous DO SQL/transaction shape, but owns a separate table.
 * Not installed in production. Caller must invoke inside the same outer transaction as
 * world/event commit when integrating; this class alone cannot guarantee joint atomicity.
 */
export interface LifeSql {
  exec(query:string,...bindings:unknown[]):{toArray():Record<string,unknown>[]};
  transactionSync<T>(fn:()=>T):T;
}
export class ResidentLifeStore {
  private sql:LifeSql;
  constructor(sql:LifeSql){this.sql=sql;}
  init(){this.sql.exec('CREATE TABLE IF NOT EXISTS resident_life (world_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL)');}
  load(worldId:string):{revision:number;state:LifeState}|null {
    const row=this.sql.exec('SELECT revision, state FROM resident_life WHERE world_id = ?',worldId).toArray()[0];
    if(!row) return null;
    if(!Number.isSafeInteger(row.revision)||Number(row.revision)<0||typeof row.state!=='string') throw new Error('invalid stored life');
    return {revision:Number(row.revision),state:restoreLife(row.state)};
  }
  /** Compare-and-swap; null means create only. State validated before any write. */
  save(worldId:string,expectedRevision:number|null,state:LifeState):number {
    if(!worldId||worldId.length>160) throw new Error('invalid world id');
    saveLife(state);
    return this.sql.transactionSync(()=>this.saveInTransaction(worldId,expectedRevision,state));
  }
  /** Runtime caller already holds the shared world transaction. No nested transaction. */
  saveInTransaction(worldId:string,expectedRevision:number|null,state:LifeState):number {
    if(!worldId||worldId.length>160) throw new Error('invalid world id');
    const raw=saveLife(state);
      const current=this.load(worldId);
      if((current?.revision ?? null)!==expectedRevision) throw new Error('stale life revision');
      const revision=(current?.revision ?? -1)+1;
      if(!Number.isSafeInteger(revision)) throw new Error('life revision overflow');
      this.sql.exec('INSERT INTO resident_life (world_id, revision, state) VALUES (?, ?, ?) ON CONFLICT(world_id) DO UPDATE SET revision = excluded.revision, state = excluded.state',worldId,revision,raw);
      return revision;
  }
}
