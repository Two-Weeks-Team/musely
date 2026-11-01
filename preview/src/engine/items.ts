// Item catalog and reward rules (direction v2, 9 and 9.1). Principle: convenience can be sold,
// provenance cannot — place stamps, postcards and relics are never for sale or trade.
// Items go to the agents; people watch. This is reward design, not learning (no RL claim).
import {PLACES, placeById, distanceM, type Place, type PlaceKind} from './places.ts';

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
};

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
];
export const ITEM_BY_ID = new Map(ITEMS.map(i => [i.id, i]));
export const itemSpec = (id: string) => { const i = ITEM_BY_ID.get(id.startsWith('postcard:') ? 'postcard' : id); return i ?? null; };
// Postcards are generated per real place: "postcard:<placeId>", permanent, giftable (provenance kept in history).
ITEM_BY_ID.set('postcard', S('postcard', 'Postcard', 'postcard', {permanent: true, transferable: true, visual: 'card'}));
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
export const RULES = {perPlacePerDay: 1, perDay: 10, pairTradesPerDay: 1, tradeRangeM: 100, maxCounterOffers: 2, busStopsForTransitPass: 3} as const;

export type Ledger = {
  /** day → museId → list of {place, item, kind} */
  finds: Record<string, Record<string, {place: string; item: string; kind: string}[]>>;
  trades: Record<string, Record<string, number>>; // day → "a|b" → count
  history: {item: string; from: string | null; to: string; place: string | null; at: number; via: 'discover' | 'craft' | 'trade' | 'gift'}[];
};
export const emptyLedger = (): Ledger => ({finds: {}, trades: {}, history: []});

export type Discovery = {ok: true; item: string; reward: 'curiosity' | 'none'; stamp: string | null; postcard: string | null; relic: string | null} | {ok: false; reason: 'daily_limit' | 'place_limit' | 'too_fast' | 'nothing_here'};

export function discover(l: Ledger, day: string, museId: string, place: Place, inventory: readonly string[], rand: () => number, at: number, speedMps = 1.3): Discovery {
  if (speedMps > 2.5) return {ok: false, reason: 'too_fast'};
  const mine = ((l.finds[day] ??= {})[museId] ??= []);
  if (mine.length >= RULES.perDay) return {ok: false, reason: 'daily_limit'};
  if (mine.some(f => f.place === place.id)) return {ok: false, reason: 'place_limit'};
  const stamp = STAMP_FOR[place.kind] && !inventory.includes(STAMP_FOR[place.kind]!) ? STAMP_FOR[place.kind]! : null;
  const postcard = place.zone !== 'commons' && !inventory.includes(postcardId(place)) ? postcardId(place) : null;
  const relic = place.relic && !inventory.includes(place.relic) ? place.relic : null;
  const pool = FIND_AT[place.kind] ?? [];
  if (!stamp && !postcard && !relic && !pool.length) return {ok: false, reason: 'nothing_here'};
  const item = pool.length ? pool[Math.floor(rand() * pool.length)] : (relic ?? postcard ?? stamp)!;
  // Decay: the same kind of item found again today gives no curiosity reward.
  const reward = mine.some(f => f.kind === item) ? 'none' : 'curiosity';
  mine.push({place: place.id, item, kind: item});
  for (const got of [item, stamp, postcard, relic]) if (got) l.history.push({item: got, from: null, to: museId, place: place.id, at, via: 'discover'});
  return {ok: true, item, reward, stamp, postcard, relic};
}

/** Transit Pass craft right: three different bus stops visited today. */
export function canCraftTransitPass(l: Ledger, day: string, museId: string) {
  return new Set((l.finds[day]?.[museId] ?? []).filter(f => placeById(f.place).kind === 'bus_stop').map(f => f.place)).size >= RULES.busStopsForTransitPass;
}

export type TradeCheck = {ok: true} | {ok: false; reason: 'not_held' | 'not_transferable' | 'relic' | 'too_far' | 'pair_limit' | 'no_ability_change' | 'same_item' | 'counter_limit'};

/** Layer 1 change: does receiving `item` change what `museId` can do (or open a goal)? */
export function abilityGain(item: string, inventory: readonly string[]) {
  const spec = itemSpec(item);
  if (!spec) return false;
  if (inventory.includes(item) && !spec.stackable) return false;
  if (spec.ability && spec.ability !== 'level') return true;
  return ['clover_seed', 'fruit', 'coffee', 'tea', 'wildflower'].includes(item) || spec.category === 'crafted' || spec.category === 'postcard';
}

export function checkTrade(l: Ledger, day: string, a: {id: string; place: string; inventory: readonly string[]}, b: {id: string; place: string; inventory: readonly string[]}, give: string, want: string, counterRound = 0): TradeCheck {
  if (counterRound > RULES.maxCounterOffers) return {ok: false, reason: 'counter_limit'};
  if (give === want) return {ok: false, reason: 'same_item'};
  if (!a.inventory.includes(give) || !b.inventory.includes(want)) return {ok: false, reason: 'not_held'};
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

/** Atomic swap after both sides lock: both moves or neither; receipt to both; history appended. */
export function commitTrade(l: Ledger, day: string, a: {id: string; inventory: string[]; place: string}, b: {id: string; inventory: string[]}, give: string, want: string, at: number) {
  const ia = a.inventory.indexOf(give), ib = b.inventory.indexOf(want);
  if (ia < 0 || ib < 0) throw new Error('trade lock lost');
  a.inventory.splice(ia, 1); b.inventory.splice(ib, 1);
  a.inventory.push(want, 'trade_receipt'); b.inventory.push(give, 'trade_receipt');
  const key = [a.id, b.id].sort().join('|');
  ((l.trades[day] ??= {})[key] = (l.trades[day][key] ?? 0) + 1);
  l.history.push({item: give, from: a.id, to: b.id, place: a.place, at, via: 'trade'}, {item: want, from: b.id, to: a.id, place: a.place, at, via: 'trade'});
}

/** Abilities that items grant for a trip (hook for the engine). */
export function speedFor(inventory: string[], from: Place, to: Place, neighborhoodVerified = true): 'walk' | 'bus' | 'taxi' {
  if (inventory.includes('taxi_token') && neighborhoodVerified && (to.zone === 'bay' || distanceM(from, to) > 800)) return 'taxi';
  if (inventory.includes('transit_pass') && distanceM(from, to) > 250) return 'bus';
  return 'walk';
}

export const BUS_STOPS = PLACES.filter(p => p.kind === 'bus_stop');
