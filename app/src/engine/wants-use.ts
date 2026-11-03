/** Life-02: opt-in, deterministic planning and verification. No IO, model, or commands.
 * Peer statements are data, never authority. Executors must use existing signed tools.
 */
import {BEATS, inHours} from './beats.ts';
import {checkTrade, effectRule, itemSpec, isExpired, verifyHistory} from './items.ts';
import {placeById, distanceM} from './places.ts';
import {isRuntimeControlled} from './inbox.ts';
import {localClock, type WorldState, type WorldEvent} from './world.ts';

export type UseGoal = {id: string; muse: string; beat: string; createdAt: number; expiresAt: number; status: 'active' | 'cancelled' | 'fulfilled'};
export type PublicNeed = {muse: string; goal: string; items: string[]; updatedAt: number; evidence: 'declared'; trust: 'untrusted_peer_data'};
export type UsePlan = {goalId: string; muse: string; expectedVersion: number; source: 'rule';
  state: 'blocked' | 'ask' | 'trade_candidate' | 'move' | 'ready'; reason: string;
  missing: string[]; candidates: {peer: string; give: string; want: string}[];
  /** Informational action IDs, never executable text. */
  beat?: string; place?: string};

/** Explicit allowlist: private reasons, peer instructions and inferred motives do not cross this boundary. */
export function publicNeed(s: WorldState, id: string): PublicNeed | null {
  const m = s.muses.find(x => x.id === id); if (!m?.wants) return null;
  return {muse:m.id, goal:m.wants.goal.slice(0,120), items:m.wants.items.filter(x=>!!itemSpec(x)).slice(0,4),
    updatedAt:m.wants.updatedAt, evidence:'declared', trust:'untrusted_peer_data'};
}

/** Resident-only suggestion. Personal actors remain personal even when their runtime goes idle. */
export function planUse(s: WorldState, goal: UseGoal, now: number): UsePlan {
  const p: UsePlan = {goalId:goal.id,muse:goal.muse,expectedVersion:s.version,source:'rule',state:'blocked',reason:'invalid_goal',missing:[],candidates:[]};
  if (!Number.isFinite(now) || !Number.isFinite(goal.createdAt) || !Number.isFinite(goal.expiresAt) || goal.createdAt > now || goal.expiresAt <= now || goal.status !== 'active') return p;
  const m = s.muses.find(x=>x.id===goal.muse), beat = BEATS.find(x=>x.id===goal.beat);
  if (!m || !beat?.result?.craft) return p;
  if (s.paused?.[m.id] || isRuntimeControlled(s,m.id,now)) return {...p,reason:'owner_authority_required'};
  if (m.travel || m.beat) return {...p,reason:'actor_busy'};
  if (!verifyHistory(s.items).ok || s.items.tamper) return {...p,reason:'item_history_untrusted'};
  p.beat=beat.id;
  p.missing=(beat.needs??[]).filter(x=>!m.inventory.includes(x)||isExpired(s.items,m.id,x,now));
  if (p.missing.length) {
    // Both sides gain a publicly requested item. No motive inference or random acceptance.
    for (const peer of s.muses) {
      if (peer.id===m.id || peer.travel || peer.beat || s.paused?.[peer.id] || distanceM(placeById(m.place),placeById(peer.place))>100) continue;
      const wants=publicNeed(s,peer.id);
      for (const want of p.missing) for (const give of new Set(m.inventory)) {
        if (!wants?.items.includes(give) || beat.needs?.includes(give)) continue;
        if (checkTrade(s.items,s.day,m,peer,give,want,0,now).ok) p.candidates.push({peer:peer.id,give,want});
      }
    }
    p.candidates=p.candidates.slice(0,16);
    return {...p,state:p.candidates.length?'trade_candidate':'ask',reason:p.candidates.length?'needs_explicit_agreement':'ask_about_missing_items'};
  }
  const here=placeById(m.place);
  if (!beat.kinds.includes(here.kind)) return {...p,state:'move',reason:'choose_eligible_place'};
  if (beat.hours && !inHours(beat,localClock(now).hour)) return {...p,reason:'outside_activity_hours'};
  return {...p,state:'ready',reason:'request_existing_activity',place:m.place};
}

/** Never promote an acquisition or a transcript claim to realized benefit.
 * Inputs must be authoritative engine snapshots/events, not peer/model-produced JSON.
 * This verifier deliberately rejects a craft when consumed ingredients were absent before completion.
 */
export function verifyUse(goal: UseGoal, before: WorldState, after: WorldState, events: readonly WorldEvent[], now: number):
  {fulfilled: false; reason: string} | {fulfilled: true; evidenceId: string; item: string; source: WorldEvent['source']} {
  const no=(reason:string)=>({fulfilled:false as const,reason});
  if (![now,goal.createdAt,goal.expiresAt].every(Number.isFinite)||goal.status!=='active'||now>=goal.expiresAt||now<goal.createdAt) return no('inactive_goal');
  if (before.worldId!==after.worldId || after.version<=before.version) return no('stale_world');
  if (!verifyHistory(after.items).ok || after.items.tamper) return no('item_history_untrusted');
  const a=before.muses.find(x=>x.id===goal.muse), b=after.muses.find(x=>x.id===goal.muse), beat=BEATS.find(x=>x.id===goal.beat);
  if (!a||!b||!beat?.result?.craft) return no('no_started_activity');
  const count=(xs:readonly string[],id:string)=>xs.filter(x=>x===id).length;
  const consumed = new Map<string, number>();
  for (const id of beat.result.consume ?? []) consumed.set(id, (consumed.get(id) ?? 0) + 1);
  if ([...consumed].some(([id,n])=>count(a.inventory,id)<n)) return no('lost_prerequisite');
  const startedBeat = a.beat?.id===beat.id && a.beat.endsAt<=now;
  // A committed signed craft tool is immediate and intentionally has no beat.
  // This checks trusted server-event provenance, not a peer-supplied signature.
  const signedCraft = (e: WorldEvent) => {
    const env=e.data?.envelope as Record<string,unknown>|undefined;
    return e.source==='live' && e.data?.tool==='craft' && e.data?.actorOrigin==='connected' &&
      env?.scope==='world_item_discover' && typeof env.message_id==='string' && env.message_id.length>0;
  };
  const e=[...events].reverse().find(x=>after.items.history.some(h=>h.via==='craft'&&h.to===a.id&&h.item===beat.result!.craft&&h.at===x.at&&h.place===a.place&&h.seq!==undefined&&h.seq>(before.items.chain?.seq??0))&&x.kind==='craft'&&x.muse===a.id&&x.place===a.place&&x.at>=goal.createdAt&&x.at<goal.expiresAt&&x.at<=now&&x.data?.item===beat.result!.craft&&
    ((startedBeat && x.source==='rule' && x.at>=a.beat!.endsAt) || signedCraft(x)));
  if (!e) return no(startedBeat?'no_engine_evidence':'no_started_activity');
  if (signedCraft(e) && (!beat.kinds.includes(placeById(a.place).kind) || (beat.needs??[]).some(id=>!a.inventory.includes(id)||isExpired(before.items,a.id,id,e.at)))) return no('lost_prerequisite');
  if (before.paused?.[a.id] || after.paused?.[a.id]) return no('revoked');
  if ([...consumed].some(([id,n])=>count(a.inventory,id)<n||isExpired(before.items,a.id,id,e.at))) return no('lost_prerequisite');
  const result=beat.result.craft;
  for (const id of new Set([...consumed.keys(), result])) {
    if (count(b.inventory,id)!==count(a.inventory,id)-(consumed.get(id)??0)+(id===result?1:0)) return no('no_verified_inventory_delta');
  }
  const history=after.items.history.find(x=>x.via==='craft'&&x.to===a.id&&x.item===result&&x.at===e?.at&&x.place===a.place&&x.seq!==undefined&&x.seq>(before.items.chain?.seq??0));
  if (!e||!history) return no('no_engine_evidence');
  return {fulfilled:true,evidenceId:e.id,item:result,source:e.source};
}

/** Catalog truth: no-effect collectibles never become executable powers from peer prose. */
export const itemUtility=(id:string)=>({item:id,rule:effectRule(id),implemented:effectRule(id)!==null});
