// Scenario engine and spotlight rotation (direction v2, 8.1–8.4, 8.6, 8.8).
// tick(state, input) is pure: the same state, day seed and inputs always give the same next state and
// events. Model outputs, approvals and asynchronous answers are not reproducible from the seed, so they
// enter only as recorded inputs (`decision`) and are stored in the run log; replays feed them back.
import {BEATS, CLIP_FALLBACK, inHours, type Beat} from './beats.ts';
import {PLACES, PLACE_BY_ID, placeById, distanceM, WALK_MPS, type Place} from './places.ts';
import {HARNESSES, harnessById} from './harness.ts';
import {rngFor, weightedPick, daySeed} from './rng.ts';
import {emptyLedger, type Ledger as ItemLedger} from './items.ts';

export const ENGINE_VERSION = 'engine-1';
export const TICK_MS = 60_000;
export const TIME_ZONE = 'America/Los_Angeles';
export type Source = 'live' | 'rule' | 'scripted' | 'replay';
export type Freedom = 'where' | 'who' | 'offer' | 'plan';
export type Speed = 'walk' | 'bus' | 'taxi';

export type MuseState = {
  id: string;
  place: string;
  travel: {to: string; departAt: number; arriveAt: number; speed: Speed; chosen?: boolean} | null;
  beat: {id: string; clip: string; startedAt: number; endsAt: number; line: string | null} | null;
  inventory: string[];
  memory: string[];
  reflection: string;
  lastMet: Record<string, number>;
  intent: {kind: 'greet' | 'trade'; target: string; give?: string | null; want?: string | null} | null;
};
export type WorldEvent = {id: string; tick: number; at: number; source: Source; kind: string; muse: string | null; other?: string | null; place?: string | null; line?: string | null; data?: Record<string, unknown>; tags: string[]};
export type WorldState = {worldId: string; day: string; seed: string; tick: number; version: number; muses: MuseState[]; spotlight: {cursor: number; visitorQueue: string[]}; lastTickAt: number;
  /** Item rule counters (daily limits, pair trades). The append-only item history is the run log. */
  items: ItemLedger};
export type Decision = {muse: string; freedom: Freedom; source: 'live' | 'replay'; output: {decision: string; target_place: string; target_agent: string; offer_item: string; want_item: string; public_reason: string; line: string}; evidence?: Record<string, unknown>};
export type Hooks = {
  /** Item discovery etc. when a Muse arrives somewhere (task 4 rules). */
  onArrive?: (s: WorldState, m: MuseState, place: Place, rand: () => number, at: number) => Omit<WorldEvent, 'id' | 'tick'>[];
  /** Speed a Muse may use for a trip (items change abilities; task 4). */
  speedFor?: (m: MuseState, from: Place, to: Place) => Speed;
  /** Trades, gifts and help when two Muses meet (task 4 rules). */
  onEncounter?: (s: WorldState, initiator: MuseState, other: MuseState, place: Place, rand: () => number, at: number) => Omit<WorldEvent, 'id' | 'tick'>[];
};

const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
export function localClock(ms: number) {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return {date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), hhmm: `${parts.hour}:${parts.minute}`};
}

/** Freedoms unlock as the local day goes on, so the world visibly grows more autonomous (8.2). */
export function unlockedFreedoms(hour: number): Freedom[] {
  const all: Freedom[] = ['where', 'who', 'offer', 'plan'];
  return all.slice(0, hour < 9 ? 1 : hour < 13 ? 2 : hour < 17 ? 3 : 4);
}

const START_PLACES: Record<string, string> = {
  '00-jolly': 'commons:benches', '01-sunny': 'commons:cafe', '02-moss': 'commons:garden', '03-ripple': 'commons:hq', '04-ember': 'commons:campfire',
  '05-bloom': 'commons:garden', '06-ink': 'commons:bookshelf', '07-tempo': 'commons:bookshelf', '08-orbit': 'commons:benches', '09-copper': 'commons:workbench',
};
const START_ITEMS: Record<string, string[]> = {
  '00-jolly': [], '01-sunny': ['sun_badge'], '02-moss': ['watering_can', 'clover_seed', 'fruit'], '03-ripple': ['paper_map'], '04-ember': ['brass_lantern'],
  '05-bloom': ['petal_patch', 'tea'], '06-ink': ['book_glasses'], '07-tempo': ['headphones', 'snack_box'], '08-orbit': ['star_pin'], '09-copper': ['pocket_gadget', 'coffee'],
};

export function createWorld(worldId: string, now: number): WorldState {
  const day = localClock(now).date;
  return {
    worldId, day, seed: daySeed(worldId, day), tick: 0, version: 0, lastTickAt: now,
    muses: HARNESSES.map(h => ({id: h.id, place: START_PLACES[h.id], travel: null, beat: null, inventory: [...START_ITEMS[h.id]], memory: [], reflection: '', lastMet: {}, intent: null})),
    spotlight: {cursor: 0, visitorQueue: []},
    items: emptyLedger(),
  };
}

/** The Muse whose turn it is (visitor Muses queue ahead of residents), and the freedom it gets. */
export function spotlightFor(s: WorldState, now: number): {muse: string; freedom: Freedom} {
  const free = unlockedFreedoms(localClock(now).hour);
  const muse = s.spotlight.visitorQueue[0] ?? s.muses[s.spotlight.cursor % s.muses.length].id;
  return {muse, freedom: free[Math.floor(s.tick / s.muses.length) % free.length]};
}

const SAFE = /[^\p{L}\p{N} &'.,()#_\-/:]/gu;
const safeName = (n: string) => n.replace(SAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Unnamed place';

/** Structured input for POST /api/muse spotlight (server validates it again). Nearest places only. */
export function spotlightInput(s: WorldState, museId: string, freedom: Freedom, now: number) {
  const m = s.muses.find(x => x.id === museId)!, here = placeById(m.place);
  const near = PLACES.filter(p => p.id !== here.id && p.zone !== 'bay').map(p => ({p, d: distanceM(here, p)})).sort((a, b) => a.d - b.d);
  const liked = new Set(harnessById(museId).persona.likes);
  const pick = [...near.filter(x => liked.has(x.p.kind)).slice(0, 4), ...near.slice(0, 8)].filter((x, i, a) => a.findIndex(y => y.p.id === x.p.id) === i).slice(0, 8);
  return {
    muse: museId, freedom, localTime: localClock(now).hhmm, place: safeName(here.name),
    places: pick.map(x => ({name: safeName(x.p.name), kind: x.p.kind, distanceM: Math.round(x.d)})),
    muses: s.muses.filter(o => o.id !== museId).map(o => ({o, d: distanceM(here, placeById(o.place))})).sort((a, b) => a.d - b.d).slice(0, 6).map(x => ({muse: x.o.id, place: safeName(placeById(x.o.place).name), distanceM: Math.round(x.d)})),
    items: m.inventory.slice(0, 12), memory: [m.reflection, ...m.memory].filter(Boolean).slice(0, 5).map(t => t.slice(0, 100)),
  };
}

function eligibleBeats(m: MuseState, place: Place, hour: number) {
  return BEATS.filter(b => b.kinds.includes(place.kind) && inHours(b, hour) && (b.needs ?? []).every(n => m.inventory.includes(n)));
}
function beatWeight(b: Beat, museId: string) { return (b.weight ?? 1) * (b.roles?.includes(museId) ? 3 : 1); }

function chooseDestination(s: WorldState, m: MuseState, rand: () => number, hour: number): Place | null {
  const here = placeById(m.place), liked = new Set<string>(harnessById(m.id).persona.likes);
  const options = PLACES.filter(p => p.id !== here.id && p.zone !== 'bay' && eligibleBeats(m, p, hour).length > 0);
  return weightedPick(rand, options, p => (liked.has(p.kind) ? 4 : 1) * (p.zone === 'commons' ? 2.5 : 1) / (1 + distanceM(here, p) / 300));
}

export function tripMs(from: Place, to: Place, speed: Speed) {
  if (speed === 'taxi') return 0;
  const mps = speed === 'bus' ? WALK_MPS * 5 : WALK_MPS;
  return Math.max(TICK_MS / 2, (distanceM(from, to) / mps) * 1000);
}

export function tick(prev: WorldState, input: {now: number; decision?: Decision | null}, hooks: Hooks = {}): {state: WorldState; events: WorldEvent[]} {
  const now = input.now, clock = localClock(now);
  const s: WorldState = structuredClone(prev);
  const events: WorldEvent[] = [];
  const emit = (e: Omit<WorldEvent, 'id' | 'tick'>) => events.push({...e, id: `${s.day}:${s.tick}:${events.length}`, tick: s.tick});
  s.items ??= emptyLedger();
  if (clock.date !== s.day) {
    s.day = clock.date; s.seed = daySeed(s.worldId, s.day);
    // Daily limits reset; older counters are dropped so the state stays small.
    for (const d of Object.keys(s.items.finds)) if (d !== s.day) delete s.items.finds[d];
    for (const d of Object.keys(s.items.trades)) if (d !== s.day) delete s.items.trades[d];
    emit({at: now, source: 'rule', kind: 'new_day', muse: null, data: {day: s.day}, tags: []});
  }
  if (s.items.history.length > 200) s.items.history = s.items.history.slice(-200);

  const spot = spotlightFor(s, now);
  // 1. Spotlight: a recorded live/replay decision for this turn, or the scenario's own choice.
  const d = input.decision && input.decision.muse === spot.muse ? input.decision : null;
  if (input.decision && !d) emit({at: now, source: input.decision.source, kind: 'decision_rejected', muse: input.decision.muse, data: {reason: 'not this Muse\'s spotlight turn'}, tags: []});
  if (d) applyDecision(s, d, spot.freedom, now, emit, hooks);
  else emit({at: now, source: 'scripted', kind: 'spotlight', muse: spot.muse, data: {freedom: spot.freedom, live: false}, tags: []});

  // 2. Every Muse advances: arrivals, then a new beat or a trip when the current beat ends.
  for (const m of s.muses) {
    const rand = rngFor(s.seed, s.tick, m.id);
    if (m.travel && m.travel.arriveAt <= now) {
      const place = placeById(m.travel.to);
      const speed = m.travel.speed, chosen = !!m.travel.chosen;
      m.place = place.id; m.travel = null;
      // A Muse that chose this place itself stays for a beat instead of wandering off at once.
      if (chosen) { const b = weightedPick(rand, eligibleBeats(m, place, clock.hour), x => beatWeight(x, m.id)); if (b) { emit({at: now, source: 'rule', kind: 'arrive', muse: m.id, place: place.id, data: {speed, chosen}, tags: speed === 'taxi' ? ['teleport'] : []}); for (const e of hooks.onArrive?.(s, m, place, rand, now) ?? []) emit(e); startBeat(m, b, place, now, 'rule', emit, s); continue; } }
      emit({at: now, source: 'rule', kind: 'arrive', muse: m.id, place: place.id, data: {speed}, tags: speed === 'taxi' ? ['teleport'] : []});
      for (const e of hooks.onArrive?.(s, m, place, rand, now) ?? []) emit(e);
    }
    if (m.travel) continue;
    if (m.beat && m.beat.endsAt > now) continue;
    if (m.beat) finishBeat(m, now, emit);
    const place = placeById(m.place);
    const stay = eligibleBeats(m, place, clock.hour);
    // Intent from a spotlight decision takes priority over wandering.
    const goTravel = !m.intent && (stay.length === 0 || rand() < (place.zone === 'commons' ? .22 : .45));
    if (goTravel) {
      const dest = chooseDestination(s, m, rand, clock.hour);
      if (dest) { startTrip(m, place, dest, now, 'scripted', emit, hooks); continue; }
    }
    const beat = weightedPick(rand, stay, b => beatWeight(b, m.id));
    if (beat) startBeat(m, beat, place, now, 'scripted', emit, s);
  }

  // 3. Encounters: Muses at the same place, not travelling, who have not met in the last 30 minutes.
  const byPlace = new Map<string, MuseState[]>();
  for (const m of s.muses) if (!m.travel) byPlace.set(m.place, [...(byPlace.get(m.place) ?? []), m]);
  for (const [placeId, group] of byPlace) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (now - (a.lastMet[b.id] ?? 0) < 30 * 60_000) continue;
      a.lastMet[b.id] = b.lastMet[a.id] = now;
      const initiator = a.intent?.target === b.id ? a : b.intent?.target === a.id ? b : (rngFor(s.seed, s.tick, a.id, b.id)() < .5 ? a : b);
      const other = initiator === a ? b : a;
      emit({at: now, source: 'rule', kind: 'encounter', muse: initiator.id, other: other.id, place: placeId, data: {initiatedByIntent: !!initiator.intent, stage: 'recognize'}, tags: []});
      for (const e of hooks.onEncounter?.(s, initiator, other, placeById(placeId), rngFor(s.seed, s.tick, initiator.id, other.id, 'meet'), now) ?? []) emit(e);
      if (initiator.intent?.target === other.id) initiator.intent = null;
      remember(a, `Met ${harnessById(b.id).name} at ${placeById(placeId).name}`);
      remember(b, `Met ${harnessById(a.id).name} at ${placeById(placeId).name}`);
    }
    const place = placeById(placeId);
    if (place.kind === 'campfire' && group.length >= 3 && clock.hour >= 17) emit({at: now, source: 'rule', kind: 'gathering', muse: group[0].id, place: placeId, data: {count: group.length, muses: group.map(m => m.id)}, tags: ['campfire_gathering_3plus']});
  }

  if (s.spotlight.visitorQueue[0] === spot.muse) s.spotlight.visitorQueue.shift(); else s.spotlight.cursor = (s.spotlight.cursor + 1) % s.muses.length;
  s.tick += 1; s.version += 1; s.lastTickAt = now;
  return {state: s, events};
}

function remember(m: MuseState, line: string) { m.memory = [line, ...m.memory.filter(x => x !== line)].slice(0, 6); }

function startBeat(m: MuseState, beat: Beat, place: Place, now: number, source: Source, emit: (e: Omit<WorldEvent, 'id' | 'tick'>) => void, s: WorldState) {
  const clip = beat.clips[0];
  const line = beat.line ? beat.line.replace('{place}', place.name).replace('{other}', '') : null;
  m.beat = {id: beat.id, clip: CLIP_FALLBACK[clip] ? clip : clip, startedAt: now, endsAt: now + beat.minutes * 60_000, line};
  emit({at: now, source, kind: 'beat', muse: m.id, place: place.id, line, data: {beat: beat.id, clip, fallbackClip: CLIP_FALLBACK[clip] ?? null, minutes: beat.minutes}, tags: []});
  void s;
}

function finishBeat(m: MuseState, now: number, emit: (e: Omit<WorldEvent, 'id' | 'tick'>) => void) {
  const beat = BEATS.find(b => b.id === m.beat!.id);
  if (beat?.result) {
    for (const c of beat.result.consume ?? []) { const k = m.inventory.indexOf(c); if (k >= 0) m.inventory.splice(k, 1); }
    if (beat.result.craft) { m.inventory.push(beat.result.craft); emit({at: now, source: 'rule', kind: 'craft', muse: m.id, place: m.place, data: {item: beat.result.craft, from: beat.result.consume ?? []}, tags: ['ability_change']}); }
  }
  // One-line reflection (#9): what the Muse takes from the last thing it did.
  m.reflection = `Last: ${beat?.id.replace(/_/g, ' ') ?? 'rest'} at ${placeById(m.place).name}`;
  m.beat = null;
}

function startTrip(m: MuseState, from: Place, to: Place, now: number, source: Source, emit: (e: Omit<WorldEvent, 'id' | 'tick'>) => void, hooks: Hooks) {
  const speed = hooks.speedFor?.(m, from, to) ?? 'walk';
  const ms = tripMs(from, to, speed);
  // A Taxi Token is spent when the in-world teleport starts (not a payment, not a booking).
  if (speed === 'taxi') { const k = m.inventory.indexOf('taxi_token'); if (k >= 0) m.inventory.splice(k, 1); }
  m.travel = {to: to.id, departAt: now, arriveAt: now + ms, speed, chosen: source === 'live' || source === 'replay'};
  m.beat = null;
  emit({at: now, source, kind: 'depart', muse: m.id, place: from.id, data: {to: to.id, speed, etaMs: Math.round(ms), distanceM: Math.round(distanceM(from, to))}, tags: []});
}

function findPlaceByName(name: string): Place | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return PLACES.find(p => p.name.toLowerCase() === n) ?? PLACES.find(p => safeName(p.name).toLowerCase() === n) ?? null;
}
function findMuse(s: WorldState, ref: string): MuseState | null {
  const r = ref.trim().toLowerCase();
  return s.muses.find(m => m.id === r || harnessById(m.id).name.toLowerCase() === r) ?? null;
}

/** Validates a live/replayed spotlight decision against the world and the Muse's scope, then applies it. */
function applyDecision(s: WorldState, d: Decision, freedom: Freedom, now: number, emit: (e: Omit<WorldEvent, 'id' | 'tick'>) => void, hooks: Hooks) {
  const m = s.muses.find(x => x.id === d.muse)!;
  const o = d.output, base = {at: now, source: d.source, muse: m.id, data: {freedom, decision: o.decision, public_reason: o.public_reason, evidence: d.evidence ?? null}} as const;
  const reject = (reason: string) => emit({...base, kind: 'decision_rejected', line: null, data: {...base.data, reason}, tags: []});
  if (d.freedom !== freedom) return reject('freedom mismatch');
  // What the scenario alone would have done this turn, to mark off-script choices (8.2).
  const scripted = chooseDestination(s, m, rngFor(s.seed, s.tick, m.id, 'counterfactual'), localClock(now).hour);
  const here = placeById(m.place);
  if (freedom === 'where' || freedom === 'plan') {
    const dest = findPlaceByName(o.target_place);
    if (!dest) return reject('unknown place: ' + o.target_place.slice(0, 40));
    if (dest.zone === 'bay' && !m.inventory.includes('taxi_token') && !m.inventory.includes('transit_pass')) return reject('Bay places need a Taxi Token or Transit Pass');
    const offScript = dest.id !== scripted?.id;
    emit({...base, kind: 'spotlight', place: here.id, line: o.line || null, data: {...base.data, target: dest.id, live: true, offScript}, tags: offScript ? ['off_script'] : []});
    if (dest.id !== here.id) startTrip(m, here, dest, now, d.source, emit, hooks);
    return;
  }
  if (freedom === 'who') {
    const other = findMuse(s, o.target_agent);
    if (!other || other.id === m.id) return reject('unknown Muse: ' + o.target_agent.slice(0, 40));
    m.intent = {kind: 'greet', target: other.id};
    emit({...base, kind: 'spotlight', place: here.id, other: other.id, line: o.line || null, data: {...base.data, live: true, offScript: true}, tags: ['off_script']});
    const there = placeById(other.travel?.to ?? other.place);
    if (there.id !== here.id) startTrip(m, here, there, now, d.source, emit, hooks);
    return;
  }
  // offer: propose an in-world trade or gift with an item the Muse actually holds.
  if (o.offer_item && !m.inventory.includes(o.offer_item)) return reject('offered item not held: ' + o.offer_item.slice(0, 40));
  const other = findMuse(s, o.target_agent);
  if (!other || other.id === m.id) return reject('offer needs another Muse');
  m.intent = {kind: 'trade', target: other.id, give: o.offer_item || null, want: o.want_item || null};
  const there = placeById(other.travel?.to ?? other.place);
  if (there.id !== here.id) startTrip(m, here, there, now, d.source, emit, hooks);
  emit({...base, kind: 'trade_intent', place: here.id, other: other.id, line: o.line || null, data: {...base.data, give: o.offer_item || null, want: o.want_item || null, live: true}, tags: ['off_script']});
}

export const placeOf = (id: string) => PLACE_BY_ID.get(id) ?? null;
