// Trips outside the scenario tick (direction v2, 13 and 13.1): following the owner's location cell, and
// moves requested by a connected Muse. The Muse's place changes only on arrival (walk / bus) or through a
// verified teleport, which spends a Taxi Token at once.
import {tripMs, type MuseState, type WorldState, type WorldEvent, type Hooks, type Source} from './world.ts';
import {placeById, distanceM, type Place} from './places.ts';
import {speedFor, sweepExpired, historyFault} from './items.ts';
import {placeCell, teleportCheck} from './location.ts';
import {rngFor} from './rng.ts';

type Emit = (e: Omit<WorldEvent, 'id' | 'tick'>) => void;

/** Starts a walk (or a Transit Pass bus ride when held) with a real-speed ETA. Never a taxi. */
export function beginTrip(m: MuseState, to: Place, now: number, source: Source, emit: Emit, why: string) {
  const from = placeById(m.place);
  const speed = speedFor(m.inventory, from, to, false);
  const ms = tripMs(from, to, speed);
  m.travel = {to: to.id, departAt: now, arriveAt: now + ms, speed, chosen: true};
  m.beat = null;
  emit({at: now, source, kind: 'depart', muse: m.id, place: from.id, data: {to: to.id, speed, etaMs: Math.round(ms), distanceM: Math.round(distanceM(from, to)), why}, tags: []});
  return {speed, etaMs: Math.round(ms)};
}

/** Verified teleport: the owner's cell is verified, the destination is in it, and a Taxi Token is spent. */
export function teleport(s: WorldState, m: MuseState, to: Place, now: number, source: Source, emit: Emit, hooks: Hooks, why: string): string | null {
  const refusal = teleportCheck(s.owner, m, to);
  if (refusal) return refusal;
  const from = placeById(m.place);
  m.inventory.splice(m.inventory.indexOf('taxi_token'), 1);
  m.place = to.id; m.travel = null; m.beat = null;
  emit({at: now, source, kind: 'arrive', muse: m.id, place: to.id, data: {speed: 'taxi', from: from.id, teleport: true, spent: 'taxi_token', why, neighborhood: 'verified (virtual, demo)'}, tags: ['teleport']});
  for (const e of hooks.onArrive?.(s, m, to, rngFor(s.seed, s.tick, m.id, 'teleport', now), now) ?? []) emit(e);
  return null;
}

/**
 * After the owner location changes: the owner's Muse follows. Already in the owner cell → stays.
 * Verified cell + Taxi Token → teleports. Otherwise it walks (or rides the bus) toward the target with an ETA.
 */
export function followOwner(s: WorldState, now: number, emit: Emit, hooks: Hooks) {
  const owner = s.owner;
  if (!owner) return null;
  const m = s.muses.find(x => x.id === owner.muse);
  if (!m) return null;
  m.anchor = owner.cell;
  // Outside the tick: passes that expired since the last sweep must not carry this trip (I-06).
  if (!historyFault(s.items, false, now)) for (const e of sweepExpired(s, now)) emit(e);
  // A paused Muse (delegation revoked) does not follow; the owner cell is still recorded.
  if (s.paused?.[m.id]) return {mode: 'paused' as const};
  if (placeCell(m.place) === owner.cell && !m.travel) return {mode: 'stay' as const};
  const target = placeById(owner.target);
  // A verified cell + a Taxi Token teleports, also when a walk there is already under way (verification turned on mid-trip).
  if (owner.verified && m.inventory.includes('taxi_token') && !teleport(s, m, target, now, 'live', emit, hooks, 'follow owner')) return {mode: 'teleport' as const};
  if (m.travel && placeCell(m.travel.to) === owner.cell) return {mode: m.travel.speed === 'bus' ? 'bus' as const : 'walking' as const, etaMs: Math.max(0, m.travel.arriveAt - now)};
  const t = beginTrip(m, target, now, 'live', emit, 'follow owner');
  return {mode: t.speed === 'bus' ? 'bus' as const : 'walking' as const, etaMs: t.etaMs};
}

/** Remaining time of the Muse's current trip, or null. */
export const etaMs = (m: MuseState, now: number) => (m.travel ? Math.max(0, Math.round(m.travel.arriveAt - now)) : null);
