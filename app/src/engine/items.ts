// Item catalog and reward rules (direction v2, 9 and 9.1). Principle: convenience can be sold,
// provenance cannot — place stamps, postcards and relics are never for sale or trade.
// Items go to the agents; people watch. This is reward design, not learning (no RL claim).
import {PLACES, placeById, distanceM, type Place, type PlaceKind} from './places.ts';
import {canonicalize} from '../identity/jcs.ts';
import {sha256Hex} from './sha256.ts';

export type Category = 'stamp' | 'postcard' | 'role_tool' | 'pass' | 'token' | 'gift' | 'crafted' | 'currency' | 'relic' | 'relation';
export type ItemSpec = {
  id: string; name: string; category: Category;
  permanent: boolean; consumable: boolean; transferable: boolean; stackable: boolean;
  expiresHours?: number;
  /** Ability the item changes (layer 1 reward). */
  ability?: 'bus_speed' | 'teleport' | 'night_sky' | 'events' | 'plant' | 'extra_activity' | 'campfire_talk' | 'send_postcard' | 'extra_spotlight' | 'level';
  owner?: string;            // role tools belong to a character
  visual: 'prop' | 'card' | 'stamp' | 'glow';
  sellable: boolean;         // convenience only (GTM later); provenance never
  /** What holding the item really does in the engine (I-06): an implemented rule, or an explicit 'none' with the reason. */
  effect?: ItemEffect;
};

/**
 * Effect rules the engine implements (C07: a catalog row is not an ability until a rule and a test back it).
 * `where` names the code that applies the rule; scripts/items.test.mjs has one behaviour probe per rule.
 */
export const EFFECT_RULES = {
  bus_speed: {does: 'trips over 250 m ride the bus (5x walking speed)', where: 'items.ts speedFor'},
  teleport: {does: 'verified-neighborhood teleport; one token spent per teleport', where: 'items.ts speedFor, location.ts teleportCheck, travel.ts teleport'},
  plant: {does: 'opens the garden_plant beat (with a Clover Seed) that grows a Bloom', where: 'beats.ts garden_plant'},
  bloom_seed: {does: 'consumed by garden_plant into a Bloom; the Garden Pass is kept', where: 'beats.ts garden_plant, world.ts finishBeat'},
  send_postcard: {does: 'one stamp is spent per postcard mailed (send_postcard tool)', where: 'mcp-tools.ts send_postcard'},
  night_sky: {does: 'opens the night_pass_stargaze beat 19:00-03:00 at parks, gardens, benches, the campfire and landmarks', where: 'beats.ts night_pass_stargaze'},
  extra_activity: {does: 'one more discovery after the daily 10 (at most one ticket a day); the ticket is spent', where: 'items.ts discover, receiveDiscovery'},
  extra_spotlight: {does: 'spent for one extra spotlight turn ahead of the rotation; the rotation does not skip anyone', where: 'items.ts itemUpkeep'},
} as const;
export type EffectRule = keyof typeof EFFECT_RULES;
export type ItemEffect = {rule: EffectRule} | {effect: 'none'; reason: string};

const NONE = (reason: string): ItemEffect => ({effect: 'none', reason});
const STAMP_NONE = NONE('provenance record: permanent, never consumed, traded or sold; direction 9 gives stamps no ability');
const ROLE_NONE = NONE('role tool levels are not modelled; role beats follow the Muse role (Beat.roles), not the held tool');
const GIFT_NONE = NONE('gift and consumable for give_gift (3 a day, C07); no ability of its own');
const CRAFT_NONE = NONE('no recipe and no ability in the engine yet; direction 9 names the item and its maker only');
const RELIC_NONE = NONE('place token: permanent and never traded (9.1); no ability');
/** Every catalog id has exactly one entry here (coverage test in scripts/items.test.mjs). */
export const ITEM_EFFECTS: Record<string, ItemEffect> = {
  stamp_park: STAMP_NONE, stamp_bus_stop: STAMP_NONE, stamp_cafe: STAMP_NONE, stamp_restaurant: STAMP_NONE, stamp_fast_food: STAMP_NONE, stamp_convenience: STAMP_NONE,
  stamp_rooftop_garden: STAMP_NONE, stamp_hq_landmark: STAMP_NONE, stamp_bookshop: STAMP_NONE, stamp_music_venue: STAMP_NONE, stamp_campus_library: STAMP_NONE, stamp_trail: STAMP_NONE,
  sun_badge: ROLE_NONE, watering_can: ROLE_NONE, paper_map: ROLE_NONE, brass_lantern: ROLE_NONE, petal_patch: ROLE_NONE, book_glasses: ROLE_NONE, headphones: ROLE_NONE, star_pin: ROLE_NONE, pocket_gadget: ROLE_NONE,
  transit_pass: {rule: 'bus_speed'},
  night_pass: {rule: 'night_sky'},
  event_pass: NONE('no local event schedule exists in the world; direction 9 names the pass without a rule'),
  garden_pass: {rule: 'plant'},
  taxi_token: {rule: 'teleport'},
  recharge_ticket: {rule: 'extra_activity'},
  invite_token: NONE('campfire invites have no engine path yet (invite_campfire, I-13)'),
  postage_stamp: {rule: 'send_postcard'},
  spotlight_ticket: {rule: 'extra_spotlight'},
  coffee: GIFT_NONE, pastry: GIFT_NONE, wildflower: GIFT_NONE, fruit: GIFT_NONE, snack_box: GIFT_NONE, tea: GIFT_NONE,
  clover_seed: {rule: 'bloom_seed'},
  bloom: NONE('craft result of garden_plant (Garden Pass + Clover Seed); no ability of its own'),
  story_scroll: CRAFT_NONE, mixtape: CRAFT_NONE, star_chart: CRAFT_NONE, repaired_gadget: CRAFT_NONE, route_map: CRAFT_NONE, welcome_garland: CRAFT_NONE, reading_list: CRAFT_NONE, comfort_note: CRAFT_NONE,
  spark: NONE('balance currency, not cashable (9); nothing spends it yet'),
  commons_ember: RELIC_NONE, sf_bookmark: RELIC_NONE, oakland_vinyl: RELIC_NONE, stanford_tassel: RELIC_NONE, san_mateo_bean: RELIC_NONE, mountain_view_circuit_leaf: RELIC_NONE, redwood_pinecone: RELIC_NONE, san_jose_trail_badge: RELIC_NONE,
  friendship_seal: NONE('relationship record; not issued by any rule yet'),
  trade_receipt: NONE('relationship record issued to both sides of every committed trade; no ability'),
  meetup_ember: NONE('relationship record issued when both owners approve a meetup (I-07); no ability'),
  postcard: NONE('provenance keepsake; mailing it is the Postage Stamp rule (send_postcard)'),
};
/** The rule an item carries, or null for an explicit 'none' (or an id outside the catalog). */
export const effectRule = (id: string): EffectRule | null => { const e = itemSpec(id)?.effect; return e && 'rule' in e ? e.rule : null; };

const S = (id: string, name: string, cat: Category, o: Partial<ItemSpec> = {}): ItemSpec => ({
  id, name, category: cat, permanent: false, consumable: false, transferable: true, stackable: false, visual: 'card', sellable: false, ...o,
});

export const ITEMS: ItemSpec[] = [
  // Place stamps (permanent, provenance, not transferable)
  ...([['stamp_park', 'Park Stamp'], ['stamp_bus_stop', 'Bus Stop Stamp'], ['stamp_cafe', 'Café Stamp'], ['stamp_restaurant', 'Restaurant Stamp'], ['stamp_fast_food', 'Fast Food Stamp'], ['stamp_convenience', 'Convenience Stamp'], ['stamp_rooftop_garden', 'Rooftop Garden Stamp'], ['stamp_hq_landmark', 'HQ Landmark Stamp'], ['stamp_bookshop', 'Bookshop Stamp (SF)'], ['stamp_music_venue', 'Music Venue Stamp'], ['stamp_campus_library', 'Campus Library Stamp (Stanford)'], ['stamp_trail', 'Trail Stamp (San Jose)']] as const)
    .map(([id, name]) => S(id, name, 'stamp', {permanent: true, transferable: false, visual: 'stamp'})),
  // Role tools (permanent, level up; held by their character)
  ...([['sun_badge', 'Sun Badge', '01-sunny'], ['watering_can', 'Watering Can', '02-moss'], ['paper_map', 'Paper Map', '03-ripple'], ['brass_lantern', 'Brass Lantern', '04-ember'], ['petal_patch', 'Petal Patch', '05-bloom'], ['book_glasses', 'Book & Glasses', '06-ink'], ['headphones', 'Headphones', '07-tempo'], ['star_pin', 'Star Pin', '08-orbit'], ['pocket_gadget', 'Pocket Gadget', '09-copper']] as const)
    .map(([id, name, owner]) => S(id, name, 'role_tool', {permanent: true, transferable: false, owner, ability: 'level', visual: 'prop'})),
  // Passes (time-limited)
  S('transit_pass', 'Transit Pass', 'pass', {expiresHours: 24, ability: 'bus_speed', sellable: true}),
  S('night_pass', 'Night Pass', 'pass', {expiresHours: 24, ability: 'night_sky', sellable: true}),
  S('event_pass', 'Event Pass', 'pass', {expiresHours: 24, ability: 'events', sellable: true}),
  S('garden_pass', 'Garden Pass', 'pass', {expiresHours: 24, ability: 'plant', sellable: true}),
  // Tokens (consumed)
  S('taxi_token', 'Taxi Token', 'token', {consumable: true, stackable: true, ability: 'teleport', sellable: true}),
  S('recharge_ticket', 'Recharge Ticket', 'token', {consumable: true, stackable: true, ability: 'extra_activity', sellable: true}),
  S('invite_token', 'Invite Token', 'token', {consumable: true, stackable: true, ability: 'campfire_talk', sellable: true}),
  S('postage_stamp', 'Postage Stamp', 'token', {consumable: true, stackable: true, ability: 'send_postcard', sellable: true}),
  S('spotlight_ticket', 'Spotlight Ticket', 'token', {consumable: true, stackable: true, ability: 'extra_spotlight', sellable: true}),
  // Gifts and consumables
  ...([['coffee', 'Coffee'], ['pastry', 'Pastry'], ['clover_seed', 'Clover Seed'], ['wildflower', 'Wildflower'], ['fruit', 'Fruit'], ['snack_box', 'Snack Box'], ['tea', 'Tea']] as const)
    .map(([id, name]) => S(id, name, 'gift', {consumable: true, stackable: true, visual: 'prop'})),
  // Crafted
  S('bloom', 'Bloom', 'crafted', {visual: 'glow'}), S('story_scroll', 'Story Scroll', 'crafted'), S('mixtape', 'Mixtape', 'crafted'), S('star_chart', 'Star Chart', 'crafted'),
  S('repaired_gadget', 'Repaired Gadget', 'crafted'), S('route_map', 'Route Map', 'crafted'), S('welcome_garland', 'Welcome Garland', 'crafted'), S('reading_list', 'Reading List', 'crafted'), S('comfort_note', 'Comfort Note', 'crafted'),
  // Currency (not cashable)
  S('spark', 'Spark', 'currency', {stackable: true}),
  // Landmark and regional relics (limited, never tradeable: place tokens)
  ...([['commons_ember', 'Commons Ember'], ['sf_bookmark', 'SF Bookmark'], ['oakland_vinyl', 'Oakland Vinyl'], ['stanford_tassel', 'Stanford Tassel'], ['san_mateo_bean', 'San Mateo Bean'], ['mountain_view_circuit_leaf', 'Mountain View Circuit Leaf'], ['redwood_pinecone', 'Redwood Pinecone'], ['san_jose_trail_badge', 'San Jose Trail Badge']] as const)
    .map(([id, name]) => S(id, name, 'relic', {permanent: true, transferable: false, visual: 'glow'})),
  // Relationship records
  S('friendship_seal', 'Friendship Seal', 'relation', {permanent: true, transferable: false}),
  S('trade_receipt', 'Trade Receipt', 'relation', {permanent: true, transferable: false, stackable: true}),
  S('meetup_ember', 'Meetup Ember', 'relation', {permanent: true, transferable: false, visual: 'glow'}),
].map(i => ({...i, effect: ITEM_EFFECTS[i.id]}));
export const ITEM_BY_ID = new Map(ITEMS.map(i => [i.id, i]));
export const itemSpec = (id: string) => { const i = ITEM_BY_ID.get(id.startsWith('postcard:') ? 'postcard' : id); return i ?? null; };
// Postcards are generated per real place: "postcard:<placeId>", permanent, giftable (provenance kept in history).
ITEM_BY_ID.set('postcard', S('postcard', 'Postcard', 'postcard', {permanent: true, transferable: true, visual: 'card', effect: ITEM_EFFECTS.postcard}));
export const postcardId = (p: Place) => `postcard:${p.id}`;
export const itemName = (id: string) => id.startsWith('postcard:') ? `Postcard · ${placeById(id.slice(9)).name}` : ITEM_BY_ID.get(id)?.name ?? id;

const STAMP_FOR: Partial<Record<PlaceKind, string>> = {park: 'stamp_park', playground: 'stamp_park', garden: 'stamp_park', bus_stop: 'stamp_bus_stop', cafe: 'stamp_cafe', restaurant: 'stamp_restaurant', fast_food: 'stamp_fast_food', ice_cream: 'stamp_fast_food', convenience: 'stamp_convenience', landmark: 'stamp_hq_landmark', library: 'stamp_campus_library'};
const FIND_AT: Partial<Record<PlaceKind, string[]>> = {
  cafe: ['coffee', 'pastry', 'tea'], restaurant: ['snack_box', 'fruit'], fast_food: ['snack_box', 'spark'], convenience: ['snack_box', 'postage_stamp', 'recharge_ticket'],
  bus_stop: ['spark', 'taxi_token'], park: ['clover_seed', 'wildflower', 'fruit'], garden: ['clover_seed', 'wildflower', 'garden_pass'], playground: ['wildflower', 'spark'],
  library: ['reading_list', 'postage_stamp'], bookshelf: ['reading_list'], campfire: ['invite_token'], landmark: ['spark', 'event_pass'], ice_cream: ['snack_box'],
};

// Abuse limits (9, shown on screen): per Muse one discovery per place per day, at most 10 a day,
// none above walking speed, history is append-only. Decay (9.1): repeat finds of the same kind give 0.
// A Recharge Ticket adds one discovery after the 10 (at most `rechargesPerDay` a day).
export const RULES = {perPlacePerDay: 1, perDay: 10, pairTradesPerDay: 1, tradeRangeM: 100, maxCounterOffers: 2, busStopsForTransitPass: 3, rechargesPerDay: 1} as const;
/** Entries the world state keeps; older ones leave the state but the chain anchor still links to them. */
export const HISTORY_KEEP = 200;

export type HistoryVia = 'discover' | 'craft' | 'trade' | 'gift' | 'expired';
/**
 * One move in the append-only item history (9: discovery place → owner). Chained entries carry `seq`, `prevHash`
 * and `hash`; entries written before the chain existed have none and sit before genesis (see verifyHistory).
 */
export type HistoryEntry = {item: string; from: string | null; to: string | null; place: string | null; at: number; via: HistoryVia; seq?: number; prevHash?: string; hash?: string};
/**
 * Chain state. `head` is the hash of the last entry ever appended, `anchor` the prevHash the oldest kept chained
 * entry must have (genesis, or the hash of the last entry trimmed away), `legacy` the number of unchained entries
 * at the front (from states stored before the chain), `seq` the number of chained entries ever appended.
 */
export type HistoryChain = {head: string; anchor: string; seq: number; legacy: number};
/** A held time-limited item (a pass): valid from `at` until `expiresAt` (exclusive). */
export type HeldTimed = {item: string; at: number; expiresAt: number};

export type Ledger = {
  /** day → museId → list of {place, item, kind} (`recharge` marks the find a Recharge Ticket paid for) */
  finds: Record<string, Record<string, {place: string; item: string; kind: string; recharge?: true}[]>>;
  trades: Record<string, Record<string, number>>; // day → "a|b" → count
  history: HistoryEntry[];
  /** Missing in states stored before I-06; created on the next append or upkeep. */
  chain?: HistoryChain;
  /** museId → held items with an expiry (passes). Missing in older states; filled by itemUpkeep. */
  expiry?: Record<string, HeldTimed[]>;
};
export const GENESIS = '0'.repeat(64);
export const emptyLedger = (): Ledger => ({finds: {}, trades: {}, history: [], chain: {head: GENESIS, anchor: GENESIS, seq: 0, legacy: 0}, expiry: {}});

// ---------- append-only history with a hash chain ----------

export class HistoryTamperError extends Error {}
const HASH_PREFIX = 'musely-item-history-v1\n';
/** SHA-256 over the JCS form of every field except `hash` (so seq, prevHash and the move itself are all covered). */
export function historyHash(e: HistoryEntry) {
  const {hash: _h, ...body} = e;
  return sha256Hex(HASH_PREFIX + canonicalize(body));
}
/** The chain state, created for a ledger stored before the chain: every existing entry is legacy (before genesis). */
function chainOf(l: Ledger): HistoryChain {
  return (l.chain ??= {head: GENESIS, anchor: GENESIS, seq: 0, legacy: l.history.length});
}
/** Cheap check before writing: the newest chained entry still hashes to the stored head. Throws on tampering. */
function assertTail(l: Ledger, c: HistoryChain) {
  let last: HistoryEntry | null = null;
  for (let i = l.history.length - 1; i >= c.legacy; i--) if (l.history[i].hash) { last = l.history[i]; break; }
  const tail = last ? (historyHash(last) === last.hash && last.seq === c.seq ? last.hash! : null) : c.anchor;
  if (tail !== c.head) throw new HistoryTamperError('item history does not end at the recorded head');
}
function link(l: Ledger, c: HistoryChain, e: HistoryEntry) {
  const {seq: _s, prevHash: _p, hash: _h, ...move} = e;
  const entry: HistoryEntry = {...move, seq: c.seq + 1, prevHash: c.head};
  entry.hash = historyHash(entry);
  c.seq = entry.seq!; c.head = entry.hash;
  return entry;
}
/**
 * Chains entries that were pushed without appendHistory after the last chained entry (an append from code that
 * predates the chain). Entries already chained are never rewritten; a broken tail throws instead.
 */
export function sealHistory(l: Ledger) {
  const c = chainOf(l);
  let first = l.history.length;
  while (first > c.legacy && !l.history[first - 1].hash) first--;
  if (first === l.history.length) return 0;
  assertTail(l, c);
  for (let i = first; i < l.history.length; i++) l.history[i] = link(l, c, l.history[i]);
  return l.history.length - first;
}
/** Seals pending appends and checks the tail; call before mutating anything a history append belongs to. Throws on tampering. */
export function readyHistory(l: Ledger) {
  sealHistory(l);
  assertTail(l, chainOf(l));
}
/** The only way to add history: links the move to the current head. Refuses (throws) when the history was tampered with. */
export function appendHistory(l: Ledger, e: Omit<HistoryEntry, 'seq' | 'prevHash' | 'hash'>) {
  sealHistory(l);
  const c = chainOf(l);
  assertTail(l, c);
  const entry = link(l, c, e);
  l.history.push(entry);
  return entry;
}
/** Drops the oldest entries beyond `keep` (legacy first); the anchor moves to the hash of the last chained one dropped. */
export function trimHistory(l: Ledger, keep = HISTORY_KEEP) {
  const c = chainOf(l);
  sealHistory(l);
  while (l.history.length > keep) {
    const e = l.history.shift()!;
    if (c.legacy > 0) c.legacy -= 1;
    else if (e.hash) c.anchor = e.hash;
  }
}
export type HistoryVerdict = {ok: true; chained: number; legacy: number; head: string} | {ok: false; reason: 'legacy_after_genesis' | 'legacy_chained' | 'broken_link' | 'bad_hash' | 'bad_seq' | 'head_mismatch'; index: number};
/**
 * Verifies the whole kept history: the legacy prefix carries no chain fields, the first chained entry links to the
 * anchor, every entry links to the one before and hashes to its own `hash`, seq numbers are consecutive, and the
 * last one is the head. Editing, deleting or reordering any chained entry, or slipping an unchained entry in after
 * genesis, fails. A ledger that was never chained is all legacy.
 */
export function verifyHistory(l: Ledger): HistoryVerdict {
  const c = l.chain;
  if (!c) return {ok: true, chained: 0, legacy: l.history.length, head: GENESIS};
  if (c.legacy > l.history.length) return {ok: false, reason: 'head_mismatch', index: l.history.length};
  for (let i = 0; i < c.legacy; i++) if (l.history[i].hash || l.history[i].prevHash) return {ok: false, reason: 'legacy_chained', index: i};
  let prev = c.anchor, seq: number | null = null;
  for (let i = c.legacy; i < l.history.length; i++) {
    const e = l.history[i];
    if (!e.hash) return {ok: false, reason: 'legacy_after_genesis', index: i};
    if (e.prevHash !== prev) return {ok: false, reason: 'broken_link', index: i};
    if (historyHash(e) !== e.hash) return {ok: false, reason: 'bad_hash', index: i};
    if (typeof e.seq !== 'number' || (seq !== null && e.seq !== seq + 1)) return {ok: false, reason: 'bad_seq', index: i};
    prev = e.hash; seq = e.seq;
  }
  if (prev !== c.head || (seq !== null && seq !== c.seq)) return {ok: false, reason: 'head_mismatch', index: l.history.length};
  return {ok: true, chained: l.history.length - c.legacy, legacy: c.legacy, head: c.head};
}

// ---------- expiry (passes: `expiresHours` from acquisition) ----------

const HOUR_MS = 3_600_000;
const timedHours = (item: string) => itemSpec(item)?.expiresHours ?? 0;
/** Records the acquisition time of a time-limited item; no-op for others. */
export function stampAcquired(l: Ledger, museId: string, item: string, at: number) {
  const h = timedHours(item);
  if (!h) return;
  ((l.expiry ??= {})[museId] ??= []).push({item, at, expiresAt: at + h * HOUR_MS});
}
/**
 * The holder hands a copy on (trade, gift, mail): the copy closest to expiry leaves, with its clock. Returns that
 * clock so the receiver keeps the remaining time; passing a pass around never renews it.
 */
export function takeTimed(l: Ledger, museId: string, item: string): HeldTimed | null {
  const list = l.expiry?.[museId];
  if (!list) return null;
  let k = -1;
  for (let i = 0; i < list.length; i++) if (list[i].item === item && (k < 0 || list[i].expiresAt < list[k].expiresAt)) k = i;
  return k >= 0 ? list.splice(k, 1)[0] : null;
}
/** The receiver of a handed-on copy keeps its original clock. A copy that came without one (never swept) starts at `at`. */
export function putTimed(l: Ledger, museId: string, item: string, clock: HeldTimed | null, at: number) {
  if (!timedHours(item)) return;
  if (clock) ((l.expiry ??= {})[museId] ??= []).push({...clock});
  else stampAcquired(l, museId, item, at);
}
/** True when every recorded copy of `item` the Muse holds has reached its expiry at `at` (expiresAt itself is expired). */
export function isExpired(l: Ledger, museId: string, item: string, at: number) {
  const list = (l.expiry?.[museId] ?? []).filter(r => r.item === item);
  return list.length > 0 && list.every(r => r.expiresAt <= at);
}
/** When a held time-limited item stops working, or null for items without expiry / unrecorded copies. */
export function expiresAt(l: Ledger, museId: string, item: string) {
  const list = (l.expiry?.[museId] ?? []).filter(r => r.item === item);
  return list.length ? Math.max(...list.map(r => r.expiresAt)) : null;
}

/** Item gained from the world (craft, grant): into the inventory, its expiry clock started, history appended. */
export function grantItem(l: Ledger, m: {id: string; inventory: string[]}, item: string, at: number, place: string | null, via: 'craft' | 'discover') {
  readyHistory(l);
  m.inventory.push(item);
  stampAcquired(l, m.id, item, at);
  return appendHistory(l, {item, from: null, to: m.id, place, at, via});
}
/** A gift between Muses: the giver's copy leaves with its expiry clock; the receiver keeps the remaining time. */
export function transferItem(l: Ledger, from: {id: string; inventory: string[]; place: string}, to: {id: string; inventory: string[]}, item: string, at: number) {
  const k = from.inventory.indexOf(item);
  if (k < 0) throw new Error('transfer of an item not held');
  readyHistory(l);
  from.inventory.splice(k, 1); to.inventory.push(item);
  putTimed(l, to.id, item, takeTimed(l, from.id, item), at);
  return appendHistory(l, {item, from: from.id, to: to.id, place: from.place, at, via: 'gift'});
}

type UpkeepEvent = {at: number; source: 'rule'; kind: string; muse: string; place: string; line: string; data: Record<string, unknown>; tags: string[]};
type UpkeepWorld = {items: Ledger; muses: {id: string; place: string; inventory: string[]}[]; spotlight: {visitorQueue: string[]}; paused?: Record<string, unknown>};

/**
 * Expiry sweep at `now`. Records are reconciled with inventories first: a held time-limited copy without a record
 * (a stored state from before I-06) starts its clock now; records for copies no longer
 * held are dropped. Then every copy at or past its expiry leaves the inventory, with an `expired` history entry.
 */
export function sweepExpired(s: {items: Ledger; muses: {id: string; place: string; inventory: string[]}[]}, now: number): UpkeepEvent[] {
  const l = s.items, out: UpkeepEvent[] = [];
  readyHistory(l);
  for (const m of s.muses) {
    const timed = new Set([...m.inventory.filter(i => timedHours(i) > 0), ...(l.expiry?.[m.id] ?? []).map(r => r.item)]);
    if (!timed.size) continue;
    const list = ((l.expiry ??= {})[m.id] ??= []);
    for (const item of timed) {
      const held = m.inventory.filter(i => i === item).length;
      const mine = list.filter(r => r.item === item).sort((a, b) => a.expiresAt - b.expiresAt);
      while (mine.length > held) list.splice(list.indexOf(mine.pop()!), 1);
      for (let n = mine.length; n < held; n++) stampAcquired(l, m.id, item, now);
    }
    for (const r of [...list].sort((a, b) => a.expiresAt - b.expiresAt)) {
      if (r.expiresAt > now) continue;
      list.splice(list.indexOf(r), 1);
      m.inventory.splice(m.inventory.indexOf(r.item), 1);
      appendHistory(l, {item: r.item, from: m.id, to: null, place: m.place, at: now, via: 'expired'});
      out.push({at: now, source: 'rule', kind: 'item_expired', muse: m.id, place: m.place, line: `${itemName(r.item)} expired`, data: {item: r.item, acquiredAt: r.at, expiresAt: r.expiresAt}, tags: ['item_expired']});
    }
    if (!list.length) delete l.expiry![m.id];
  }
  return out;
}

/**
 * Item upkeep once per tick (world.ts) before the spotlight is chosen: chain any unchained appends, expire passes,
 * spend Spotlight Tickets for an extra turn, and trim the kept history.
 */
export function itemUpkeep(s: UpkeepWorld, now: number): UpkeepEvent[] {
  sealHistory(s.items);
  const out = sweepExpired(s, now);
  // Spotlight Ticket (9: an extra free turn): the Muse joins the queue served ahead of the rotation; the rotation
  // cursor does not move for a queued turn, so nobody loses theirs. One queued turn per Muse at a time.
  for (const m of s.muses) {
    if (s.paused?.[m.id] || s.spotlight.visitorQueue.includes(m.id)) continue;
    const k = m.inventory.indexOf('spotlight_ticket');
    if (k < 0) continue;
    m.inventory.splice(k, 1);
    s.spotlight.visitorQueue.push(m.id);
    out.push({at: now, source: 'rule', kind: 'spotlight_ticket_used', muse: m.id, place: m.place, line: 'Spotlight Ticket: an extra turn', data: {item: 'spotlight_ticket', queue: s.spotlight.visitorQueue.length}, tags: ['ability_change']});
  }
  trimHistory(s.items);
  return out;
}

// ---------- discovery, crafting rights and trades ----------

export type Discovery = {ok: true; item: string; reward: 'curiosity' | 'none'; stamp: string | null; postcard: string | null; relic: string | null; spent: 'recharge_ticket' | null} | {ok: false; reason: 'daily_limit' | 'place_limit' | 'too_fast' | 'nothing_here'};

export function discover(l: Ledger, day: string, museId: string, place: Place, inventory: readonly string[], rand: () => number, at: number, speedMps = 1.3): Discovery {
  if (speedMps > 2.5) return {ok: false, reason: 'too_fast'};
  const mine = ((l.finds[day] ??= {})[museId] ??= []);
  // Recharge Ticket: past the daily cap, one ticket buys one more find (at most rechargesPerDay a day).
  const recharged = mine.filter(f => f.recharge).length;
  const recharge = mine.length >= RULES.perDay + recharged;
  if (recharge && !(recharged < RULES.rechargesPerDay && inventory.includes('recharge_ticket'))) return {ok: false, reason: 'daily_limit'};
  if (mine.some(f => f.place === place.id)) return {ok: false, reason: 'place_limit'};
  const stamp = STAMP_FOR[place.kind] && !inventory.includes(STAMP_FOR[place.kind]!) ? STAMP_FOR[place.kind]! : null;
  const postcard = place.zone !== 'commons' && !inventory.includes(postcardId(place)) ? postcardId(place) : null;
  const relic = place.relic && !inventory.includes(place.relic) ? place.relic : null;
  const pool = FIND_AT[place.kind] ?? [];
  if (!stamp && !postcard && !relic && !pool.length) return {ok: false, reason: 'nothing_here'};
  const item = pool.length ? pool[Math.floor(rand() * pool.length)] : (relic ?? postcard ?? stamp)!;
  // Decay: the same kind of item found again today gives no curiosity reward.
  const reward = mine.some(f => f.kind === item) ? 'none' : 'curiosity';
  readyHistory(l);
  mine.push(recharge ? {place: place.id, item, kind: item, recharge: true} : {place: place.id, item, kind: item});
  for (const got of [item, stamp, postcard, relic]) if (got) appendHistory(l, {item: got, from: null, to: museId, place: place.id, at, via: 'discover'});
  return {ok: true, item, reward, stamp, postcard, relic, spent: recharge ? 'recharge_ticket' : null};
}

/** Applies a successful discovery to the Muse: items in, pass clocks started, a used Recharge Ticket spent. */
export function receiveDiscovery(l: Ledger, m: {id: string; inventory: string[]}, d: Extract<Discovery, {ok: true}>, at: number) {
  if (d.spent) { const k = m.inventory.indexOf(d.spent); if (k >= 0) m.inventory.splice(k, 1); }
  for (const got of [d.item, d.stamp, d.postcard, d.relic]) if (got && !(m.inventory.includes(got) && !got.startsWith('postcard:') && got !== d.item)) { m.inventory.push(got); stampAcquired(l, m.id, got, at); }
}

/** Transit Pass craft right: three different bus stops visited today. */
export function canCraftTransitPass(l: Ledger, day: string, museId: string) {
  return new Set((l.finds[day]?.[museId] ?? []).filter(f => placeById(f.place).kind === 'bus_stop').map(f => f.place)).size >= RULES.busStopsForTransitPass;
}

export type TradeCheck = {ok: true} | {ok: false; reason: 'not_held' | 'not_transferable' | 'relic' | 'too_far' | 'pair_limit' | 'no_ability_change' | 'same_item' | 'counter_limit' | 'expired'};

/**
 * Layer 1 change: does receiving `item` change what `museId` can do (or open a goal)? An item changes abilities only
 * when it carries an implemented effect rule (ITEM_EFFECTS); a few gifts count because they serve harness goals.
 */
export function abilityGain(item: string, inventory: readonly string[]) {
  const spec = itemSpec(item);
  if (!spec) return false;
  if (inventory.includes(item) && !spec.stackable) return false;
  if (effectRule(item)) return true;
  return ['clover_seed', 'fruit', 'coffee', 'tea', 'wildflower'].includes(item) || spec.category === 'crafted' || spec.category === 'postcard';
}

/** `at` (the engine's now) enables the expiry check; a pass at or past its expiry cannot be traded. */
export function checkTrade(l: Ledger, day: string, a: {id: string; place: string; inventory: readonly string[]}, b: {id: string; place: string; inventory: readonly string[]}, give: string, want: string, counterRound = 0, at?: number): TradeCheck {
  if (counterRound > RULES.maxCounterOffers) return {ok: false, reason: 'counter_limit'};
  if (give === want) return {ok: false, reason: 'same_item'};
  if (!a.inventory.includes(give) || !b.inventory.includes(want)) return {ok: false, reason: 'not_held'};
  if (at !== undefined && (isExpired(l, a.id, give, at) || isExpired(l, b.id, want, at))) return {ok: false, reason: 'expired'};
  for (const id of [give, want]) {
    const spec = itemSpec(id);
    if (spec?.category === 'relic') return {ok: false, reason: 'relic'};
    if (!spec?.transferable) return {ok: false, reason: 'not_transferable'};
  }
  if (distanceM(placeById(a.place), placeById(b.place)) > RULES.tradeRangeM) return {ok: false, reason: 'too_far'};
  const key = [a.id, b.id].sort().join('|');
  if ((l.trades[day]?.[key] ?? 0) >= RULES.pairTradesPerDay) return {ok: false, reason: 'pair_limit'};
  // Decay: an exchange that changes nobody's abilities is not counted as a trade.
  if (!abilityGain(want, a.inventory) && !abilityGain(give, b.inventory)) return {ok: false, reason: 'no_ability_change'};
  return {ok: true};
}

/** Atomic swap after both sides lock: both moves or neither; receipt to both; history appended; a pass keeps its clock. */
export function commitTrade(l: Ledger, day: string, a: {id: string; inventory: string[]; place: string}, b: {id: string; inventory: string[]}, give: string, want: string, at: number) {
  const ia = a.inventory.indexOf(give), ib = b.inventory.indexOf(want);
  if (ia < 0 || ib < 0) throw new Error('trade lock lost');
  readyHistory(l);
  a.inventory.splice(ia, 1); b.inventory.splice(ib, 1);
  a.inventory.push(want, 'trade_receipt'); b.inventory.push(give, 'trade_receipt');
  const gaveClock = takeTimed(l, a.id, give), gotClock = takeTimed(l, b.id, want);
  putTimed(l, b.id, give, gaveClock, at); putTimed(l, a.id, want, gotClock, at);
  const key = [a.id, b.id].sort().join('|');
  ((l.trades[day] ??= {})[key] = (l.trades[day][key] ?? 0) + 1);
  appendHistory(l, {item: give, from: a.id, to: b.id, place: a.place, at, via: 'trade'});
  appendHistory(l, {item: want, from: b.id, to: a.id, place: a.place, at, via: 'trade'});
}

/** Abilities that items grant for a trip (hook for the engine). */
export function speedFor(inventory: string[], from: Place, to: Place, neighborhoodVerified = true): 'walk' | 'bus' | 'taxi' {
  if (inventory.includes('taxi_token') && neighborhoodVerified && (to.zone === 'bay' || distanceM(from, to) > 800)) return 'taxi';
  if (inventory.includes('transit_pass') && distanceM(from, to) > 250) return 'bus';
  return 'walk';
}

export const BUS_STOPS = PLACES.filter(p => p.kind === 'bus_stop');
