import {participantName,participantLikes} from './participants.ts';
import type {ActorProfile} from '../identity/participant.ts';
// Scenario engine and spotlight rotation (direction v2, 8.1–8.4, 8.6, 8.8).
// tick(state, input) is pure: the same state, day seed and inputs always give the same next state and
// events. Model outputs, approvals and asynchronous answers are not reproducible from the seed, so they
// enter only as recorded inputs (`decision`) and are stored in the run log; replays feed them back.
import {BEATS, CLIP_FALLBACK, inHours, type Beat} from './beats.ts';
import {PLACES, PLACE_BY_ID, placeById, distanceM, WALK_MPS, type Place} from './places.ts';
import {actorLabel, knownActorNamed} from './actor-display.ts';
import {HARNESSES, harnessById, hasActorHarness, harnessRoleId,isResidentInstance} from './harness.ts';
import {ITEM_BY_ID, itemUpkeep, grantItem, putTimed, historyFault, spendSpotlightTickets} from './items.ts';
import {rngFor, weightedPick, daySeed} from './rng.ts';
import {emptyLedger, type Ledger as ItemLedger} from './items.ts';
import {defaultOwner, tagLocation, ownerArea, areaContains, sameArea, OWNER_MUSE, type OwnerLocation} from './location.ts';
import {emptyInbox, expireTasks, deliverMessage, noteEncounter, isConnected, isRuntimeControlled, isResidentFrozen, CONNECTED_REFRESH_MS, type Inbox} from './inbox.ts';

/** Branch-specific fixed NPC enrollment/freeze semantics; combined goal integration uses a distinct version. */
export const ENGINE_VERSION = 'engine-6-resident-v1';
export const TICK_MS = 60_000;
export const TIME_ZONE = 'America/Los_Angeles';
export type Source = 'live' | 'rule' | 'scripted' | 'replay';
export type Freedom = 'where' | 'who' | 'offer' | 'plan';
export type Speed = 'walk' | 'bus' | 'taxi';
/** Public factual record of a first introduction through say_hello. Keyed by immutable peer ID. */
export type Introduction = {id: string; at: number; place: string};

export type MuseState = {
  id: string;
  /** Server enrollment marker for a fixed NPC instance; never a personal appearance/authority claim. */
  residentRole?: string;
  /** Opt-in fixed roster freeze, separate from owner delegation revocation. */
  residentFrozenAt?: number;
  /** Actual public identity of an admitted personal actor, independent of the appearance asset. */
  profile?: ActorProfile;
  place: string;
  travel: {to: string; departAt: number; arriveAt: number; speed: Speed; chosen?: boolean} | null;
  beat: {id: string; clip: string; startedAt: number; endsAt: number; line: string | null} | null;
  inventory: string[];
  memory: string[];
  reflection: string;
  lastMet: Record<string, number>;
  /** Absent in older worlds; no unrecorded historical introductions are inferred. */
  introductions?: Record<string, Introduction>;
  /** Once personally connected, loss of presence/credentials never hands this actor to resident rules. */
  controlMode?: 'personal';
  intent: {kind: 'greet' | 'trade'; target: string; give?: string | null; want?: string | null} | null;
  /** Public wants (7, 9.1): starts from the harness; Spark or the owner's connected Muse can update it. */
  wants: Wants;
  /** Legacy private follow anchor; owner-area membership is resolved from the owner location. */
  anchor?: string | null;
};
export type Wants = {goal: string; items: string[]; source: 'harness' | 'spark' | 'connected'; updatedAt: number};
export type WorldEvent = {id: string; tick: number; at: number; source: Source; kind: string; muse: string | null; other?: string | null; place?: string | null; line?: string | null; data?: Record<string, unknown>; tags: string[]};
export type WorldState = {worldId: string; day: string; seed: string; tick: number; version: number; muses: MuseState[]; spotlight: {cursor: number; visitorQueue: string[]; /** Priority turns in a row (see MAX_PRIORITY_STREAK). */ streak?: number}; lastTickAt: number;
  /** Item rule counters (daily limits, pair trades). The append-only item history is the run log. */
  items: ItemLedger;
  /** Owner location source and cell (13.1). Older stored states get the default on the next tick. */
  owner?: OwnerLocation;
  /** Agent inbox, mail in transit and owner notifications (7.2, 12.3). */
  inbox?: Inbox;
  /**
   * Muses whose owner revoked the delegation (C06, I-02). A paused Muse takes no spotlight turn, starts no beat or
   * trip and meets nobody, until its owner delegates again. Set and cleared only by pauseMuse / resumeMuse.
   */
  paused?: Record<string, Paused>};
export type Paused = {at: number; version: number; by: string};
export type Decision = {muse: string; freedom: Freedom; source: 'live' | 'replay'; output: {decision: string; target_place: string; target_agent: string; offer_item: string; want_item: string; public_reason: string; line: string}; evidence?: Record<string, unknown>};
/**
 * The other Muse's answer when two Muses meet (8.3, C05: one answer per encounter). It is a recorded input like
 * `Decision`: live (a model answer, with evidence) or rule (no model answer; `reason` says why). `muse` answers `other`.
 */
export type EncounterReply = {muse: string; other: string; place: string; encounterId: string; source: 'live' | 'replay' | 'rule'; output: {intent: string; item: string; line: string; public_reason: string; injection_suspected: boolean} | null; reason?: string; evidence?: Record<string, unknown>};
export type Hooks = {
  /** Item discovery etc. when a Muse arrives somewhere (task 4 rules). */
  onArrive?: (s: WorldState, m: MuseState, place: Place, rand: () => number, at: number) => Omit<WorldEvent, 'id' | 'tick'>[];
  /** Speed a Muse may use for a trip (items change abilities; task 4). `s` lets the hook check neighborhood verification (13.1). */
  speedFor?: (m: MuseState, from: Place, to: Place, s?: WorldState) => Speed;
  /** Trades, gifts and help when two Muses meet (task 4 rules). */
  onEncounter?: (s: WorldState, initiator: MuseState, other: MuseState, place: Place, rand: () => number, at: number) => Omit<WorldEvent, 'id' | 'tick'>[];
  /** Credential check before two Muses meet (C04). On refusal neither Muse changes; only `event` is logged. */
  canMeet?: (s: WorldState, initiator: MuseState, other: MuseState, place: Place, at: number) => {ok: boolean; event: Omit<WorldEvent, 'id' | 'tick'> | null};
  /** World upkeep after this tick's moves and meetings (campfire invites, I-13: worker/core/messages.ts inviteUpkeep). */
  onTick?: (s: WorldState, now: number) => Omit<WorldEvent, 'id' | 'tick'>[];
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

/** The owner's Muse slot (the Muse a connected owner drives through MCP). */
export {OWNER_MUSE};

export const harnessWants = (museId: string, now: number): Wants => ({goal: harnessById(museId).wants.goal, items: [...harnessById(museId).wants.items], source: 'harness', updatedAt: now});

/**
 * The only way wants change: items must be catalog ids (max 4), the goal is plain public text (max 120).
 * Returns a reason when refused. Private reasons never belong here; this text is shown to everyone.
 */
export function updateWants(m: MuseState, next: {goal?: string; items?: string[]}, source: Wants['source'], now: number): string | null {
  const items = next.items ?? m.wants.items;
  if (!Array.isArray(items) || items.length > 4 || items.some(i => typeof i !== 'string' || !(ITEM_BY_ID.has(i) || i === 'postcard'))) return 'items must be up to 4 catalog item ids';
  const goal = next.goal === undefined ? m.wants.goal : String(next.goal).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!goal || goal.length > 120) return 'goal must be 1-120 characters of plain text';
  m.wants = {goal, items: [...new Set(items)], source, updatedAt: now};
  return null;
}

export function createWorld(worldId: string, now: number): WorldState {
  const day = localClock(now).date;
  return {
    worldId, day, seed: daySeed(worldId, day), tick: 0, version: 0, lastTickAt: now,
    muses: HARNESSES.map(h => ({id: h.id, place: START_PLACES[h.id], travel: null, beat: null, inventory: [...START_ITEMS[h.id]], memory: [], reflection: '', lastMet: {}, intent: null, wants: harnessWants(h.id, now)})),
    spotlight: {cursor: 0, visitorQueue: []},
    items: emptyLedger(),
    owner: defaultOwner(OWNER_MUSE, now),
    inbox: emptyInbox(),
  };
}

/** Priority requests waiting at once (8.2: a visitor's or a connected Muse goes ahead of the rotation). */
export const SPOTLIGHT_QUEUE_MAX = 5;
/** After this many priority turns in a row the next turn goes to the rotation, so the queue cannot hold the spotlight. */
export const MAX_PRIORITY_STREAK = 2;
/** Queued Muses that can still take a turn: known and not paused (a revoked Muse never gets one). */
const queued = (s: WorldState) => s.spotlight.visitorQueue.filter(id => !s.paused?.[id] && !isResidentFrozen(s,id) && s.muses.some(m => m.id === id));

/** The Muse whose turn it is (visitor Muses queue ahead of residents), and the freedom it gets. */
export function spotlightFor(s: WorldState, now: number): {muse: string; freedom: Freedom; priority: boolean} {
  const free = unlockedFreedoms(localClock(now).hour);
  const first = (s.spotlight.streak ?? 0) >= MAX_PRIORITY_STREAK ? undefined : queued(s)[0];
  const muse = first ?? s.muses[s.spotlight.cursor % s.muses.length].id;
  return {muse, freedom: free[Math.floor(s.tick / s.muses.length) % free.length], priority: first !== undefined};
}

/**
 * Puts a Muse at the back of the priority queue (8.2). Pure: the caller commits it. Refused for an unknown or
 * paused (revoked) Muse and when the queue is full; a Muse already waiting keeps its place (no duplicates).
 */
export function requestSpotlight(s: WorldState, museId: string): {ok: true; position: number} | {ok: false; reason: 'unknown_muse' | 'paused' | 'already_queued' | 'queue_full'; position?: number} {
  if (!s.muses.some(m => m.id === museId)) return {ok: false, reason: 'unknown_muse'};
  if (s.paused?.[museId] || isResidentFrozen(s,museId)) return {ok: false, reason: 'paused'};
  // Entries that can no longer take a turn (paused since) do not hold a place.
  s.spotlight.visitorQueue = queued(s);
  const at = s.spotlight.visitorQueue.indexOf(museId);
  if (at >= 0) return {ok: false, reason: 'already_queued', position: at + 1};
  if (s.spotlight.visitorQueue.length >= SPOTLIGHT_QUEUE_MAX) return {ok: false, reason: 'queue_full'};
  s.spotlight.visitorQueue.push(museId);
  return {ok: true, position: s.spotlight.visitorQueue.length};
}

const SAFE = /[^\p{L}\p{N} &'.,()#_\-/:]/gu;
const safeName = (n: string) => n.replace(SAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Unnamed place';

/** Structured input for POST /api/muse spotlight (server validates it again). Nearest places only. */
export function spotlightInput(s: WorldState, museId: string, freedom: Freedom, now: number) {
  const m = s.muses.find(x => x.id === museId)!, here = placeById(m.place);
  const area = s.owner?.muse === museId ? ownerArea(s.owner) : null;
  const near = PLACES.filter(p => p.id !== here.id && (area ? areaContains(area, p) : p.zone !== 'bay')).map(p => ({p, d: distanceM(here, p)})).sort((a, b) => a.d - b.d);
  const liked = new Set(participantLikes(s,museId));
  const pick = [...near.filter(x => liked.has(x.p.kind)).slice(0, 4), ...near.slice(0, 8)].filter((x, i, a) => a.findIndex(y => y.p.id === x.p.id) === i).slice(0, 8);
  return {
    muse: museId, freedom, localTime: localClock(now).hhmm, place: safeName(here.name),
    places: pick.map(x => ({name: safeName(x.p.name), kind: x.p.kind, distanceM: Math.round(x.d)})),
    muses: s.muses.filter(o => o.id !== museId).map(o => ({o, d: distanceM(here, placeById(o.place))})).sort((a, b) => a.d - b.d).slice(0, 6).map(x => ({muse: x.o.id, place: safeName(placeById(x.o.place).name), distanceM: Math.round(x.d)})),
    // Postcards carry their place id (postcard:osm:node/123); the model only needs to know it holds postcards.
    items: [...new Set(m.inventory.map(i => (i.startsWith('postcard:') ? 'postcard' : i)))].slice(0, 12), memory: [m.reflection, ...m.memory].filter(Boolean).slice(0, 5).map(t => t.slice(0, 100)),
  };
}

/** Structured input for the other Muse's encounter answer (validated again with validate('encounter')). */
export function encounterInput(s: WorldState, museId: string, otherId: string, placeId: string, incoming: string | null, now: number) {
  const m = s.muses.find(x => x.id === museId)!, o = s.muses.find(x => x.id === otherId)!;
  const items = (x: MuseState) => [...new Set(x.inventory.map(i => (i.startsWith('postcard:') ? 'postcard' : i)))].slice(0, 12);
  return {
    muse: museId, other: otherId, place: safeName(placeById(placeId).name), localTime: localClock(now).hhmm, items: items(m), otherItems: items(o),
    memory: [m.reflection, ...m.memory].filter(Boolean).slice(0, 5).map(t => t.slice(0, 100)), ...(incoming ? {incoming: incoming.slice(0, 280)} : {}),
  };
}
/** Identifies one meeting (C09): the sorted pair and the tick it happened in. */
export const encounterId = (s: Pick<WorldState, 'day' | 'tick'>, a: string, b: string) => `${s.day}:${s.tick}:${[a, b].sort().join('|')}`;

function eligibleBeats(m: MuseState, place: Place, hour: number) {
  return BEATS.filter(b => b.kinds.includes(place.kind) && inHours(b, hour) && (b.needs ?? []).every(n => m.inventory.includes(n)));
}
function beatWeight(b: Beat, museId: string) { return (b.weight ?? 1) * (b.roles?.includes(harnessRoleId(museId)) ? 3 : 1); }

function chooseDestination(s: WorldState, m: MuseState, rand: () => number, hour: number): Place | null {
  const here = placeById(m.place), liked = new Set<string>(participantLikes(s,m.id));
  const area = s.owner?.muse === m.id ? ownerArea(s.owner) : null;
  const options = PLACES.filter(p => p.id !== here.id && (area ? areaContains(area, p) : p.zone !== 'bay') && eligibleBeats(m, p, hour).length > 0);
  return weightedPick(rand, options, p => (liked.has(p.kind) ? 4 : 1) * (p.zone === 'commons' ? 2.5 : 1) / (1 + distanceM(here, p) / 300));
}

export function tripMs(from: Place, to: Place, speed: Speed) {
  if (speed === 'taxi') return 0;
  const mps = speed === 'bus' ? WALK_MPS * 5 : WALK_MPS;
  return Math.max(TICK_MS / 2, (distanceM(from, to) / mps) * 1000);
}

/**
 * With `spot` the turn goes to the Muse chosen when the heartbeat began (the runtime passes it: the queue may change while
 * the model answers, and a paid answer must not lose its turn); without it the turn is computed from the state.
 * With `replies` (the runtime passes it, possibly empty) every meeting gets the other Muse's answer: the recorded
 * live answer for that meeting, or a rule answer. Without it (pure scenario runs) no answers are emitted.
 */
export function setResidentFrozen(s:WorldState,ids:readonly string[],now:number):void {
  // Only enrolled fixed-catalog NPCs can be paused by this switch. Personal and legacy actors are untouched.
  for(const m of s.muses){
    if(!isResidentInstance(m.id)||m.residentRole!==harnessRoleId(m.id)||m.controlMode==='personal'||m.profile)continue;
    if(ids.includes(m.id)){if(m.residentFrozenAt===undefined)m.residentFrozenAt=now;}
    else if(m.residentFrozenAt!==undefined){
      const delay=Math.max(0,now-m.residentFrozenAt);
      if(m.travel){m.travel.departAt+=delay;m.travel.arriveAt+=delay;}
      if(m.beat){m.beat.startedAt+=delay;m.beat.endsAt+=delay;}
      delete m.residentFrozenAt;
    }
  }
}

export function tick(prev: WorldState, input: {now: number; decision?: Decision | null; replies?: EncounterReply[]; spot?: {muse: string; priority: boolean}; residentMove?: {muse:string;place:string;expectedVersion:number};residentIdle?:readonly string[];residentFrozen?:readonly string[]}, hooks: Hooks = {}): {state: WorldState; events: WorldEvent[]} {
  const now = input.now, clock = localClock(now);
  const s: WorldState = structuredClone(prev);
  if(input.residentFrozen!==undefined)setResidentFrozen(s,input.residentFrozen,now);
  const events: WorldEvent[] = [];
  s.items ??= emptyLedger();
  s.owner ??= defaultOwner(OWNER_MUSE, now);
  s.inbox ??= emptyInbox();
  const emit = (e: Omit<WorldEvent, 'id' | 'tick'>) => events.push({...tagLocation(s.owner, e), id: `${s.day}:${s.tick}:${events.length}`, tick: s.tick});
  for (const m of s.muses) {
    if(!m.wants && !hasActorHarness(m.id)) throw new Error('Personal actor requires explicit public Wants before world entry');
    m.wants ??= harnessWants(m.id, now);
  }
  const newDay = clock.date !== s.day;
  if (newDay) {
    s.day = clock.date; s.seed = daySeed(s.worldId, s.day);
    // Daily limits reset; older counters are dropped so the state stays small.
    for (const d of Object.keys(s.items.finds)) if (d !== s.day) delete s.items.finds[d];
    for (const d of Object.keys(s.items.trades)) if (d !== s.day) delete s.items.trades[d];
    emit({at: now, source: 'rule', kind: 'new_day', muse: null, data: {day: s.day}, tags: []});
  }
  // Item history check (I-06): the tail every tick, every kept entry at the day change. On a fault the item rules
  // (upkeep, finds, trades, gifts, crafts, tickets) stop and the rest of the world keeps running; logged once a day.
  const itemFault = historyFault(s.items, newDay, now);
  if (itemFault && itemFault.notified !== s.day) {
    itemFault.notified = s.day;
    emit({at: now, source: 'rule', kind: 'history_tamper', muse: null, data: {reason: itemFault.reason, index: itemFault.index, since: itemFault.since, halted: ['item upkeep', 'discover', 'trade', 'gift', 'craft', 'spotlight ticket']}, tags: ['history_tamper']});
  }
  // Inbox upkeep: overdue Tasks expire; postcards in transit arrive on the real clock.
  for (const t of expireTasks(s.inbox, now)) emit({at: now, source: 'rule', kind: 'task_expired', muse: t.awaiting, other: t.awaiting === t.from ? t.to : t.from, data: {task_id: t.id, task: t.kind}, tags: []});
  const paused = (id: string) => !!s.paused?.[id] || isResidentFrozen(s,id);
  // A postcard from or to a paused Muse (delegation revoked) waits in the queue; it is delivered on the first tick after
  // the owner delegates again.
  const due = s.inbox.mail.filter(x => x.deliverAt <= now && !paused(x.from) && !paused(x.to));
  for (const mail of due) {
    const to = s.muses.find(m => m.id === mail.to);
    if (to) { to.inventory.push(mail.item); if (mail.timed) putTimed(s.items, to.id, mail.item, mail.timed, now); }
    deliverMessage(s.inbox, {from: mail.from, to: mail.to, kind: 'postcard', at: now, text: mail.text, item: mail.item});
    emit({at: now, source: 'rule', kind: 'postcard_delivered', muse: mail.to, other: mail.from, data: {item: mail.item, mail_id: mail.id, sentAt: mail.sentAt}, tags: mail.crossRegion ? ['cross_region_postcard'] : []});
  }
  s.inbox.mail = s.inbox.mail.filter(x => !due.includes(x));
  // Item upkeep (I-06): chain pending history, expire passes, spend Spotlight Tickets, trim the kept history.
  if (!itemFault) for (const e of itemUpkeep(s, now)) emit(e);

  const computed = spotlightFor(s, now);
  const spot = input.spot && s.muses.some(m => m.id === input.spot!.muse) ? {muse: input.spot.muse, priority: input.spot.priority, freedom: computed.freedom} : computed;
  // 1. Spotlight: a recorded live/replay decision for this turn, or the scenario's own choice. A paused Muse's turn passes silently.
  const d = input.decision && input.decision.muse === spot.muse && !paused(spot.muse) && !isRuntimeControlled(s,spot.muse,now) ? input.decision : null;
  if (input.decision && !d) emit({at: now, source: input.decision.source, kind: 'decision_rejected', muse: input.decision.muse, data: {reason: paused(input.decision.muse) ? 'paused: the owner revoked this Muse\'s delegation' : isRuntimeControlled(s,input.decision.muse,now) ? 'personal or connected control' : 'not this Muse\'s spotlight turn'}, tags: []});
  if (d) applyDecision(s, d, spot.freedom, now, emit, hooks);
  else if (!paused(spot.muse)) emit({at: now, source: 'scripted', kind: 'spotlight', muse: spot.muse, data: {freedom: spot.freedom, live: false}, tags: []});

  // 2. Every Muse advances: arrivals, then a new beat or a trip when the current beat ends.
  for (const m of s.muses) {
    // A paused Muse (owner revoked its delegation) stays where it stopped: no arrival, beat or trip.
    if (paused(m.id)) continue;
    const rand = rngFor(s.seed, s.tick, m.id);
    // A connected Muse (8.8) decides in its owner's runtime: requested trips still arrive and running beats
    // still finish. Only an idle owner-area stroll may be picked by rule; no team-model decision or activity is substituted.
    const connected = isRuntimeControlled(s, m.id, now);
    const arrivedThisTick = !!m.travel && m.travel.arriveAt <= now;
    if (m.travel && m.travel.arriveAt <= now) {
      const place = placeById(m.travel.to);
      const speed = m.travel.speed, chosen = !!m.travel.chosen;
      m.place = place.id; m.travel = null;
      // A Muse that chose this place itself stays for a beat instead of wandering off at once.
      if (chosen && !connected) { const b = weightedPick(rand, eligibleBeats(m, place, clock.hour), x => beatWeight(x, m.id)); if (b) { emit({at: now, source: 'rule', kind: 'arrive', muse: m.id, place: place.id, data: {speed, chosen}, tags: speed === 'taxi' ? ['teleport'] : []}); for (const e of hooks.onArrive?.(s, m, place, rand, now) ?? []) emit(e); startBeat(m, b, place, now, 'rule', emit, s); continue; } }
      emit({at: now, source: 'rule', kind: 'arrive', muse: m.id, place: place.id, data: {speed}, tags: speed === 'taxi' ? ['teleport'] : []});
      for (const e of hooks.onArrive?.(s, m, place, rand, now) ?? []) emit(e);
    }
    if (m.travel) continue;
    if (m.beat && m.beat.endsAt > now) continue;
    if (m.beat) finishBeat(m, now, emit, s.items, !!itemFault);
    if (connected) {
      if (m.controlMode === 'personal' || !hasActorHarness(m.id)) continue;
      // Ambient owner-area walking is world physics, not a connected command or a team-model decision.
      // A real command, an incoming approach, any pending commitment, or an existing trip/beat takes priority.
      const area = s.owner?.muse === m.id ? ownerArea(s.owner) : null;
      const waiting = s.inbox.tasks.some(t => t.status === 'pending' && (t.from === m.id || t.to === m.id));
      const invited = (s.inbox.invites ?? []).some(i => i.status === 'open' && (i.from === m.id || i.to.includes(m.id)));
      const approached = s.muses.some(o => o.id !== m.id && o.intent?.target === m.id);
      // A stamp can lag a successful read by <10 min. Add that uncertainty to guarantee >=2 min client priority
      // without turning every read/poll into a world commit or changing command expected_version semantics.
      const recentlyActive = now - (s.inbox.connected[m.id] ?? 0) < CONNECTED_REFRESH_MS + 2 * TICK_MS;
      if (areaContains(area, m.place) && !m.intent && !waiting && !invited && !approached && !arrivedThisTick && !recentlyActive) {
        const dest = chooseDestination(s, m, rand, clock.hour);
        if (dest) startTrip(s, m, placeById(m.place), dest, now, 'rule', emit, hooks);
      }
      continue;
    }
    // Optional resident-life rule intent after expired activity finishes. Never overrides a
    // live/replay decision, active trip/beat, personal command or pending commitment.
    const plan=input.residentMove;
    if(plan && !input.decision && !spot.priority && plan.muse===spot.muse && plan.muse===m.id && plan.expectedVersion===prev.version && !m.intent){
      const to=PLACE_BY_ID.get(plan.place),from=placeById(m.place);
      const pending=s.inbox.tasks.some(t=>t.status==='pending'&&(t.from===m.id||t.to===m.id));
      const invited=(s.inbox.invites??[]).some(i=>i.status==='open'&&(i.from===m.id||i.to.includes(m.id)));
      const approached=s.muses.some(o=>o.id!==m.id&&o.intent?.target===m.id);
      if(to&&!pending&&!invited&&!approached&&to.id!==from.id&&to.zone==='commons'&&from.zone==='commons'&&sameArea(from,to)){
        startTrip(s,m,from,to,now,'rule',emit,hooks);
        const trip=m.travel as MuseState['travel'];if(trip)trip.chosen=true;
        continue;
      }
    }
    // Opt-in enrolled residents wait idle after finishing activity until their own turn.
    // Otherwise generic auto-restarts can indefinitely hide idle snapshots from the scheduler.
    // Pending social/owner actions never wait behind this hold.
    if(input.residentIdle?.includes(m.id)&&m.id!==spot.muse&&!m.intent){
      const pending=s.inbox.tasks.some(t=>t.status==='pending'&&(t.from===m.id||t.to===m.id));
      const invited=(s.inbox.invites??[]).some(i=>i.status==='open'&&(i.from===m.id||i.to.includes(m.id)));
      const approached=s.muses.some(o=>o.id!==m.id&&o.intent?.target===m.id);
      if(!pending&&!invited&&!approached)continue;
    }
    const place = placeById(m.place);
    const stay = eligibleBeats(m, place, clock.hour);
    // Intent from a spotlight decision takes priority over wandering.
    const goTravel = !m.intent && (stay.length === 0 || rand() < (place.zone === 'commons' ? .22 : .45));
    if (goTravel) {
      // Choose among the area's places first; never discard an already-picked place at a cell edge.
      const dest = chooseDestination(s, m, rand, clock.hour);
      if (dest) { startTrip(s, m, place, dest, now, 'scripted', emit, hooks); continue; }
    }
    const beat = weightedPick(rand, stay, b => beatWeight(b, m.id));
    if (beat) startBeat(m, beat, place, now, 'scripted', emit, s);
  }

  // 3. Encounters: Muses at the same place, not travelling, who have not met in the last 30 minutes.
  const byPlace = new Map<string, MuseState[]>();
  for (const m of s.muses) if (!m.travel && !paused(m.id)) byPlace.set(m.place, [...(byPlace.get(m.place) ?? []), m]);
  for (const [placeId, group] of byPlace) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      // Seeing a new Muse is a world fact, not a greeting or decision made for a personal Muse. Keep it even if
      // the runtime wakes after the peer has left, and independently of the legacy 30-minute meeting cooldown.
      if (!a.introductions?.[b.id] && !b.introductions?.[a.id]) {
        if (isRuntimeControlled(s, a.id, now)) noteEncounter(s.inbox!, a.id, b.id, placeId, now);
        if (isRuntimeControlled(s, b.id, now)) noteEncounter(s.inbox!, b.id, a.id, placeId, now);
      }
      if (now - (a.lastMet[b.id] ?? 0) < 30 * 60_000) continue;
      const initiator = a.intent?.target === b.id ? a : b.intent?.target === a.id ? b : (rngFor(s.seed, s.tick, a.id, b.id)() < .5 ? a : b);
      const other = initiator === a ? b : a;
      const gate = hooks.canMeet?.(s, initiator, other, placeById(placeId), now);
      if (gate && !gate.ok) { if (gate.event) emit(gate.event); continue; }
      a.lastMet[b.id] = b.lastMet[a.id] = now;
      const meeting = encounterId(s, a.id, b.id);
      // C03/C09: a start is by intent only when the initiator was heading for this very Muse (not a coin toss, not an
      // intent aimed at someone else), and it is a connected Muse's start only then and only while it is connected.
      const byIntent = initiator.intent?.target === other.id;
      emit({at: now, source: 'rule', kind: 'encounter', muse: initiator.id, other: other.id, place: placeId, data: {encounterId: meeting, initiatedByIntent: byIntent, actorOrigin: byIntent && isConnected(s.inbox, initiator.id, now) ? 'connected' : 'system', stage: 'recognize'}, tags: []});
      if (gate?.event) emit(gate.event);
      for (const e of hooks.onEncounter?.(s, initiator, other, placeById(placeId), rngFor(s.seed, s.tick, initiator.id, other.id, 'meet'), now) ?? []) emit(e);
      // The other Muse answers (8.3). A connected Muse answers from its owner's runtime, so nothing is said for it here.
      if (input.replies && !isRuntimeControlled(s, other.id, now)) replyTo(s, other, initiator, placeId, meeting, input.replies.find(r => r.encounterId === meeting && r.muse === other.id && r.other === initiator.id), now, emit);
      if (initiator.intent?.target === other.id) initiator.intent = null;
      remember(a, `Met ${participantName(s,b.id)} at ${placeById(placeId).name}`);
      remember(b, `Met ${participantName(s,a.id)} at ${placeById(placeId).name}`);
    }
    const place = placeById(placeId);
    if (place.kind === 'campfire' && group.length >= 3 && clock.hour >= 17) emit({at: now, source: 'rule', kind: 'gathering', muse: group[0].id, place: placeId, data: {count: group.length, muses: group.map(m => m.id)}, tags: ['campfire_gathering_3plus']});
  }
  for (const e of hooks.onTick?.(s, now) ?? []) emit(e);

  // A priority turn leaves the queue (only its own entry, and any paused since); requests that arrived meanwhile stay
  // for the next tick. The rotation waits during priority turns.
  if (spot.priority) s.spotlight.visitorQueue = s.spotlight.visitorQueue.filter(id => id !== spot.muse && !paused(id));
  else s.spotlight.cursor = (s.spotlight.cursor + 1) % s.muses.length;
  s.spotlight.streak = spot.priority ? (s.spotlight.streak ?? 0) + 1 : 0;
  // Spotlight Tickets are spent after this turn was served, so the next heartbeat's spotlightFor sees the same queue.
  if (!itemFault) for (const e of spendSpotlightTickets(s, now, id => paused(id) || isRuntimeControlled(s, id, now))) emit(e);
  s.tick += 1; s.version += 1; s.lastTickAt = now;
  return {state: s, events};
}

/**
 * The owner revoked this Muse's delegation (C06): it stops where it is. A trip in progress ends at the place it left
 * (it never arrived), the current beat and intent end. Returns what was stopped, for the event.
 */
export function pauseMuse(s: WorldState, museId: string, p: Paused) {
  const m = s.muses.find(x => x.id === museId);
  if (!m) return null;
  const stopped = {trip: m.travel?.to ?? null, beat: m.beat?.id ?? null, intent: m.intent?.kind ?? null};
  m.travel = null; m.beat = null; m.intent = null;
  // Nobody keeps waiting to meet or trade with it: other Muses' intents aimed at it end too.
  for (const o of s.muses) if (o.intent?.target === museId) o.intent = null;
  (s.paused ??= {})[museId] = p;
  s.spotlight.visitorQueue = s.spotlight.visitorQueue.filter(id => id !== museId);
  return stopped;
}
/** The owner delegated again: the Muse rejoins the scenario on the next tick. */
export function resumeMuse(s: WorldState, museId: string) {
  if (!s.paused?.[museId]) return false;
  delete s.paused[museId];
  return true;
}

function remember(m: MuseState, line: string) { m.memory = [line, ...m.memory.filter(x => x !== line)].slice(0, 6); }

/**
 * One answer per meeting. A recorded model answer keeps its source and evidence and becomes the Muse's reflection;
 * anything else is a rule answer with the reason it is not live (no key, budget, limits, invalid output, discarded).
 * A rule answer never carries model evidence.
 */
function replyTo(s:WorldState, m: MuseState, to: MuseState, placeId: string, meeting: string, r: EncounterReply | undefined, now: number, emit: (e: Omit<WorldEvent, 'id' | 'tick'>) => void) {
  const toName = to.profile?.displayName ?? actorLabel(to.id);
  if (r && r.source !== 'rule' && r.output) {
    const o = r.output;
    emit({at: now, source: r.source, kind: 'encounter_reply', muse: m.id, other: to.id, place: placeId, line: o.line || null, data: {encounterId: meeting, intent: o.intent, item: o.item || null, public_reason: o.public_reason, injection_suspected: o.injection_suspected, evidence: r.evidence ?? null}, tags: []});
    if(o.line&&isRuntimeControlled(s,to.id,now))deliverMessage(s.inbox!,{from:m.id,to:to.id,kind:'greet',at:now,text:o.line});
    m.reflection = `With ${toName}: ${o.public_reason || o.line}`.slice(0, 100);
    return;
  }
  if(isRuntimeControlled(s,to.id,now))deliverMessage(s.inbox!,{from:m.id,to:to.id,kind:'greet',at:now,text:`Nice to see you, ${toName}.`});
  emit({at: now, source: 'rule', kind: 'encounter_reply', muse: m.id, other: to.id, place: placeId, line: `Nice to see you, ${toName}.`, data: {encounterId: meeting, intent: 'greet', item: null, reason: r?.reason ?? 'no_answer_requested'}, tags: []});
}

function startBeat(m: MuseState, beat: Beat, place: Place, now: number, source: Source, emit: (e: Omit<WorldEvent, 'id' | 'tick'>) => void, s: WorldState) {
  const clip = beat.clips[0];
  const line = beat.line ? beat.line.replace('{place}', place.name).replace('{other}', '') : null;
  m.beat = {id: beat.id, clip: CLIP_FALLBACK[clip] ? clip : clip, startedAt: now, endsAt: now + beat.minutes * 60_000, line};
  emit({at: now, source, kind: 'beat', muse: m.id, place: place.id, line, data: {beat: beat.id, clip, fallbackClip: CLIP_FALLBACK[clip] ?? null, minutes: beat.minutes}, tags: []});
  void s;
}

function finishBeat(m: MuseState, now: number, emit: (e: Omit<WorldEvent, 'id' | 'tick'>) => void, ledger: ItemLedger, itemsHalted: boolean) {
  const beat = BEATS.find(b => b.id === m.beat!.id);
  // With the item history halted the beat still ends, but it neither consumes nor crafts.
  if (beat?.result && !itemsHalted) {
    for (const c of beat.result.consume ?? []) { const k = m.inventory.indexOf(c); if (k >= 0) m.inventory.splice(k, 1); }
    if (beat.result.craft) { grantItem(ledger, m, beat.result.craft, now, m.place, 'craft'); emit({at: now, source: 'rule', kind: 'craft', muse: m.id, place: m.place, data: {item: beat.result.craft, from: beat.result.consume ?? []}, tags: ['ability_change']}); }
  }
  // One-line reflection (#9): what the Muse takes from the last thing it did.
  m.reflection = `Last: ${beat?.id.replace(/_/g, ' ') ?? 'rest'} at ${placeById(m.place).name}`;
  m.beat = null;
}

function startTrip(s: WorldState, m: MuseState, from: Place, to: Place, now: number, source: Source, emit: (e: Omit<WorldEvent, 'id' | 'tick'>) => void, hooks: Hooks) {
  const speed = sameArea(from, to) ? 'walk' : hooks.speedFor?.(m, from, to, s) ?? 'walk';
  const ms = tripMs(from, to, speed);
  // A Taxi Token is spent when the in-world teleport starts (not a payment, not a booking).
  if (speed === 'taxi') { const k = m.inventory.indexOf('taxi_token'); if (k >= 0) m.inventory.splice(k, 1); }
  m.travel = {to: to.id, departAt: now, arriveAt: now + ms, speed, chosen: source === 'live' || source === 'replay'};
  m.beat = null;
  emit({at: now, source, kind: 'depart', muse: m.id, place: from.id, data: {to: to.id, speed, etaMs: Math.round(ms), distanceM: Math.round(distanceM(from, to)), ...(speed === 'taxi' ? {spent: 'taxi_token', neighborhood: 'verified (virtual, demo)'} : {})}, tags: []});
}

function findPlaceByName(name: string): Place | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return PLACES.find(p => p.name.toLowerCase() === n) ?? PLACES.find(p => safeName(p.name).toLowerCase() === n) ?? null;
}
function findMuse(s: WorldState, ref: string): MuseState | null {
  const r = ref.trim().toLowerCase();
  return s.muses.find(m => m.id === r) ?? s.muses.find(m => (m.profile || hasActorHarness(m.id)) && participantName(s,m.id).toLowerCase() === r) ?? null;
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
    // A Taxi Token counts only where it may teleport (13.1: the owner's verified cell); otherwise a Bay trip needs the bus.
    if (dest.zone === 'bay' && !sameArea(here, dest) && !m.inventory.includes('transit_pass') && hooks.speedFor?.(m, here, dest, s) !== 'taxi') return reject('Bay places need a Transit Pass, or a Taxi Token in a verified neighborhood');
    const offScript = dest.id !== scripted?.id;
    emit({...base, kind: 'spotlight', place: here.id, line: o.line || null, data: {...base.data, target: dest.id, live: true, offScript}, tags: offScript ? ['off_script'] : []});
    if (dest.id !== here.id) startTrip(s, m, here, dest, now, d.source, emit, hooks);
    return;
  }
  if (freedom === 'who') {
    const other = findMuse(s, o.target_agent);
    if (!other || other.id === m.id) return reject('unknown Muse: ' + o.target_agent.slice(0, 40));
    m.intent = {kind: 'greet', target: other.id};
    emit({...base, kind: 'spotlight', place: here.id, other: other.id, line: o.line || null, data: {...base.data, live: true, offScript: true}, tags: ['off_script']});
    const there = placeById(other.travel?.to ?? other.place);
    if (there.id !== here.id) startTrip(s, m, here, there, now, d.source, emit, hooks);
    return;
  }
  // offer: propose an in-world trade or gift with an item the Muse actually holds.
  if (o.offer_item && !m.inventory.includes(o.offer_item)) return reject('offered item not held: ' + o.offer_item.slice(0, 40));
  const other = findMuse(s, o.target_agent);
  if (!other || other.id === m.id) return reject('offer needs another Muse');
  m.intent = {kind: 'trade', target: other.id, give: o.offer_item || null, want: o.want_item || null};
  if (o.want_item && ITEM_BY_ID.has(o.want_item) && !m.wants.items.includes(o.want_item)) updateWants(m, {items: [o.want_item, ...m.wants.items].slice(0, 4)}, d.source === 'live' ? 'spark' : m.wants.source, now);
  const there = placeById(other.travel?.to ?? other.place);
  if (there.id !== here.id) startTrip(s, m, here, there, now, d.source, emit, hooks);
  emit({...base, kind: 'trade_intent', place: here.id, other: other.id, line: o.line || null, data: {...base.data, give: o.offer_item || null, want: o.want_item || null, live: true}, tags: ['off_script']});
}

export const placeOf = (id: string) => PLACE_BY_ID.get(id) ?? null;
