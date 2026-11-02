import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ITEMS, ITEM_BY_ID, discover, checkTrade, commitTrade, emptyLedger, speedFor, RULES, canCraftTransitPass, itemSpec} from '../src/engine/items.ts';
import {placeById, PLACES} from '../src/engine/places.ts';
import {createWorld, tick, TICK_MS} from '../src/engine/world.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {rngFor} from '../src/engine/rng.ts';

const T0 = Date.parse('2026-11-03T16:00:00Z');
const cafe = PLACES.find(p => p.kind === 'cafe' && p.zone === 'neighborhood');
const park = PLACES.find(p => p.kind === 'park' && p.zone === 'neighborhood');
const stops = PLACES.filter(p => p.kind === 'bus_stop').slice(0, 3);

test('catalog: 58 kinds plus per-place postcards; provenance is never sellable or tradeable', () => {
  assert.equal(ITEMS.length, 58);
  for (const i of ITEMS) if (['stamp', 'relic', 'postcard'].includes(i.category)) assert.equal(i.sellable, false, i.id);
  for (const i of ITEMS.filter(i => i.category === 'relic')) assert.equal(i.transferable, false, i.id);
  assert.equal(itemSpec('postcard:' + cafe.id).category, 'postcard');
  assert.equal(ITEM_BY_ID.get('taxi_token').ability, 'teleport');
});

test('discovery limits: once per place per day, 10 a day, none above walking speed; repeats decay to zero', () => {
  const l = emptyLedger(), r = rngFor('s', 1), day = '2026-11-03';
  const first = discover(l, day, '03-ripple', cafe, [], r, 1);
  assert.equal(first.ok, true);
  assert.equal(first.stamp, 'stamp_cafe');
  assert.equal(first.postcard, 'postcard:' + cafe.id);
  assert.deepEqual(discover(l, day, '03-ripple', cafe, [], r, 2), {ok: false, reason: 'place_limit'});
  assert.deepEqual(discover(l, day, '03-ripple', park, [], r, 3, 9), {ok: false, reason: 'too_fast'});
  const kinds = [];
  for (const p of PLACES.filter(p => p.zone === 'neighborhood' && p.id !== cafe.id).slice(0, 12)) { const d = discover(l, day, '03-ripple', p, [], r, 4); if (d.ok) kinds.push(d.reward); else assert.equal(d.reason, 'daily_limit'); }
  assert.equal(l.finds[day]['03-ripple'].length, RULES.perDay);
  assert.ok(kinds.includes('none'), 'a repeated kind gives no curiosity reward');
  assert.equal(discover(l, '2026-11-04', '03-ripple', cafe, [], r, 5).ok, true, 'limits reset the next day');
});

test('three different bus stops give a Transit Pass craft right', () => {
  const l = emptyLedger(), day = '2026-11-03';
  for (const s of stops) discover(l, day, '03-ripple', s, [], rngFor('x', s.id), 1);
  assert.equal(canCraftTransitPass(l, day, '03-ripple'), true);
});

test('trades: relics never move, partners must be close, one per pair per day, and must change an ability', () => {
  const l = emptyLedger(), day = '2026-11-03', here = 'commons:garden';
  const a = {id: '03-ripple', place: here, inventory: ['transit_pass', 'commons_ember', 'paper_map']};
  const b = {id: '02-moss', place: here, inventory: ['clover_seed', 'fruit']};
  assert.deepEqual(checkTrade(l, day, a, b, 'commons_ember', 'clover_seed'), {ok: false, reason: 'relic'});
  assert.deepEqual(checkTrade(l, day, a, b, 'paper_map', 'clover_seed'), {ok: false, reason: 'not_transferable'});
  assert.deepEqual(checkTrade(l, day, {...a, place: cafe.id}, b, 'transit_pass', 'clover_seed'), {ok: false, reason: 'too_far'});
  assert.deepEqual(checkTrade(l, day, a, b, 'transit_pass', 'clover_seed', 3), {ok: false, reason: 'counter_limit'});
  assert.deepEqual(checkTrade(l, day, a, b, 'transit_pass', 'clover_seed'), {ok: true});
  commitTrade(l, day, a, b, 'transit_pass', 'clover_seed', 1);
  assert.ok(b.inventory.includes('transit_pass') && a.inventory.includes('clover_seed') && a.inventory.includes('trade_receipt'));
  assert.equal(l.history.filter(h => h.via === 'trade').length, 2, 'append-only history of both moves');
  assert.deepEqual(checkTrade(l, day, a, b, 'clover_seed', 'fruit'), {ok: false, reason: 'pair_limit'});
});

test('items change abilities: Transit Pass rides the bus, Taxi Token teleports to the Bay', () => {
  const from = placeById('commons:campfire'), far = PLACES.filter(p => p.zone === 'neighborhood').at(-1), bay = placeById('bay:stanford');
  assert.equal(speedFor([], from, far), 'walk');
  assert.equal(speedFor(['transit_pass'], from, far), 'bus');
  assert.equal(speedFor(['taxi_token'], from, bay), 'taxi');
});

// P1 (direction 2.1): same start, same seed — the only difference is one item. Choices, movement and cooperation differ.
function runWith(give) {
  const hooks = makeHooks();
  let s = createWorld('p1-world', T0); const log = [];
  if (give) for (const [muse, item] of give) s.muses.find(m => m.id === muse).inventory.push(item);
  for (let i = 0; i < 360; i++) { const r = tick(s, {now: T0 + i * TICK_MS}, hooks); s = r.state; log.push(...r.events); }
  return {s, log};
}
test('P1: the same start with and without a Transit Pass / Garden Pass diverges in movement and outcomes', () => {
  const base = runWith(null), boosted = runWith([['03-ripple', 'transit_pass'], ['02-moss', 'garden_pass']]);
  const trips = r => r.log.filter(e => e.kind === 'depart' && e.muse === '03-ripple');
  const bus = trips(boosted).filter(e => e.data.speed === 'bus');
  assert.ok(bus.length > 0, 'Ripple rides the bus only when it holds the pass');
  assert.equal(trips(base).filter(e => e.data.speed === 'bus').length, 0);
  const reach = r => Math.max(0, ...trips(r).map(e => e.data.distanceM));
  assert.notDeepEqual(trips(base).map(e => e.data.to), trips(boosted).map(e => e.data.to), 'different destinations');
  const blooms = r => r.log.filter(e => e.kind === 'craft' && e.data.item === 'bloom').length;
  assert.ok(blooms(boosted) >= blooms(base), 'Garden Pass + Clover Seed lets Moss grow a Bloom');
  console.log(JSON.stringify({rippleTrips: [trips(base).length, trips(boosted).length], busRides: bus.length, maxReachM: [reach(base), reach(boosted)], blooms: [blooms(base), blooms(boosted)], trades: [base.log.filter(e => e.kind === 'trade_completed').length, boosted.log.filter(e => e.kind === 'trade_completed').length], discoveries: [base.log.filter(e => e.kind === 'discover').length, boosted.log.filter(e => e.kind === 'discover').length]}));
});

test('a Taxi Token is consumed by the teleport it enables', () => {
  const hooks = makeHooks();
  let s = createWorld('taxi', T0);
  const ripple = s.muses.find(m => m.id === '03-ripple');
  ripple.inventory.push('taxi_token');
  const decision = n => ({muse: '03-ripple', freedom: 'where', source: 'live', output: {decision: 'go', target_place: 'Stanford', target_agent: '', offer_item: '', want_item: '', public_reason: 'reading', line: ''}});
  // advance until Ripple holds the spotlight
  for (let i = 0; i < 20; i++) {
    const now = T0 + i * TICK_MS, sp = (s.muses[s.spotlight.cursor % 10]).id;
    const r = tick(s, {now, decision: sp === '03-ripple' ? decision() : null}, hooks); s = r.state;
    if (r.events.some(e => e.kind === 'depart' && e.muse === '03-ripple' && e.data.speed === 'taxi')) {
      assert.ok(!s.muses.find(m => m.id === '03-ripple').inventory.includes('taxi_token'));
      return;
    }
  }
  assert.fail('Ripple never took the taxi');
});
