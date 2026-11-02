import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Ledger as CostLedger} from '../worker/core/ledger.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Trust, OWNER_SLOT} from '../worker/core/trust.ts';
import {ConnectedHost} from '../worker/core/connected.ts';
import {runTool} from '../worker/core/mcp-tools.ts';
import {findOwnerTrade} from '../worker/core/a2a.ts';
import {ITEMS, ITEM_BY_ID, ITEM_EFFECTS, EFFECT_RULES, effectRule, discover, receiveDiscovery, checkTrade, commitTrade, emptyLedger, speedFor, RULES, canCraftTransitPass, itemSpec,
  appendHistory, verifyHistory, trimHistory, sealHistory, historyHash, HistoryTamperError, GENESIS, HISTORY_KEEP, grantItem, transferItem, sweepExpired, takeTimed, isExpired, abilityGain} from '../src/engine/items.ts';
import {sha256Hex} from '../src/engine/sha256.ts';
import {BEATS, inHours} from '../src/engine/beats.ts';
import {placeById, PLACES} from '../src/engine/places.ts';
import {createWorld, tick, TICK_MS, spotlightFor, localClock} from '../src/engine/world.ts';
import {makeHooks, resolveMeeting} from '../src/engine/rules.ts';
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
  // Lower bounds with slack below the values measured at I-06 (trades 2 / 2, discoveries 91 / 93, reach 1227 / 2369 m).
  const trades = r => r.log.filter(e => e.kind === 'trade_completed').length, finds = r => r.log.filter(e => e.kind === 'discover').length;
  assert.ok(trades(base) >= 1 && trades(boosted) >= 1, `cooperation still happens (trades ${trades(base)} / ${trades(boosted)})`);
  assert.ok(finds(base) >= 40 && finds(boosted) >= 40, `discoveries ${finds(base)} / ${finds(boosted)}`);
  assert.ok(reach(boosted) > reach(base), 'the pass carries Ripple farther');
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

// ===================== I-06 (#53): effects, expiry, history chain =====================
const H = 3_600_000, DAY = '2026-11-03';
const CATALOG = [...ITEMS.map(i => i.id), 'postcard'];
const muse = (id, place, inventory = []) => ({id, place, inventory: [...inventory]});
const runTicks = (s, from, n, hooks = makeHooks()) => { const log = []; for (let i = 0; i < n; i++) { const r = tick(s, {now: from + i * TICK_MS}, hooks); s = r.state; log.push(...r.events); } return {s, log}; };
const at = (s, id) => s.muses.find(m => m.id === id);
// 2026-11-03 20:00 in America/Los_Angeles (PST after 2026-11-01).
const NIGHT = Date.parse('2026-11-04T04:00:00Z'), NOON = Date.parse('2026-11-03T20:00:00Z');

// One behaviour probe per implemented effect rule: the same situation with and without the item differs.
const PROBES = {
  bus_speed: () => { const from = placeById('commons:campfire'), far = PLACES.filter(p => p.zone === 'neighborhood').at(-1); return speedFor([], from, far) === 'walk' && speedFor(['transit_pass'], from, far) === 'bus'; },
  teleport: () => speedFor([], placeById('commons:campfire'), placeById('bay:stanford')) === 'walk' && speedFor(['taxi_token'], placeById('commons:campfire'), placeById('bay:stanford')) === 'taxi',
  plant: () => bloomRun(true).blooms > 0 && bloomRun(false).blooms === 0,
  bloom_seed: () => { const r = plantFinish(); return r.blooms === 1 && r.seeds === 0 && r.passKept; },
  // The postage rule lives in the MCP tool: run the real tool without a stamp (refused) and with one (spent).
  send_postcard: async () => {
    const t = await toolWorld();
    t.edit(st => { const me = st.muses.find(m => m.id === OWNER_SLOT); me.inventory = ['postcard:bay:stanford']; });
    const without = await t.call('send_postcard', {to: '02-moss', item: 'postcard:bay:stanford'});
    t.edit(st => st.muses.find(m => m.id === OWNER_SLOT).inventory.push('postage_stamp'));
    const sent = await t.call('send_postcard', {to: '02-moss', item: 'postcard:bay:stanford'});
    return without.structuredContent.refused === 'needs_postage_stamp' && sent.isError === false && !t.muse(OWNER_SLOT).inventory.includes('postage_stamp') && !t.muse(OWNER_SLOT).inventory.includes('postcard:bay:stanford');
  },
  night_sky: () => nightRun({pass: true}).stargaze > 0 && nightRun({pass: false}).stargaze === 0,
  extra_activity: () => { const r = tenFinds(['recharge_ticket']); return r.eleventh.ok && r.eleventh.spent === 'recharge_ticket' && !tenFinds([]).eleventh.ok; },
  extra_spotlight: () => spotlightTurns(true) === spotlightTurns(false) + 1,
};
// The MCP tools over the same Trust + WorldRuntime + ConnectedHost the world Durable Object uses (node:sqlite).
// Delegations carry a real 24 h expiry, so this clock starts at the real time.
const sqlite = () => { const db = new DatabaseSync(':memory:'); let depth = 0; return {exec(q, ...b) { const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }, transactionSync(fn) { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } }}; };
async function toolWorld() {
  const now = Math.floor(Date.now() / 60_000) * 60_000, sql = sqlite();
  const cost = new CostLedger(sql, {dailyCapUsd: 1}); cost.init();
  const trust = new Trust(sql); trust.init();
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const ownerRoot = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await trust.ensureAgents(ownerRoot);
  const hooks = makeHooks();
  const runtime = new WorldRuntime(sql, {worldId: 'w', meetingGate: 'off', ledger: cost, model: null, hooks, delegationValid: m => !trust.suspended(m)});
  runtime.init(now);
  const host = new ConnectedHost({sql, trust, runtime, hooks, baseUrl: 'https://musely.net', ownerRoot: () => ownerRoot, ownerClaimed: () => true, now: () => now});
  host.init();
  const {row} = await host.keys.issue(OWNER_SLOT, now);
  const ctx = {trust, runtime, hooks, ownerRoot, ownerClaimed: true, baseUrl: 'https://musely.net', key: row, now: () => now};
  return {now, runtime, call: (name, args = {}) => runTool(ctx, name, args), edit: fn => runtime.commitExternal(now, 'test-' + Math.random(), fn), muse: id => runtime.state().muses.find(m => m.id === id), events: kind => runtime.events(0, 2000).filter(e => e.kind === kind)};
}
function bloomRun(withPass) {
  let s = createWorld('bloom-probe', T0);
  const moss = at(s, '02-moss');
  if (withPass) grantItem(s.items, moss, 'garden_pass', T0, moss.place, 'craft');
  const r = runTicks(s, T0, 600);
  return {blooms: r.log.filter(e => e.kind === 'craft' && e.data.item === 'bloom' && e.muse === '02-moss').length};
}
/** Moss finishing a garden_plant beat now, holding one Clover Seed and a Garden Pass. */
function plantFinish() {
  const s = createWorld('plant-finish', T0), moss = at(s, '02-moss');
  moss.inventory = ['watering_can', 'clover_seed'];
  grantItem(s.items, moss, 'garden_pass', T0, moss.place, 'craft');
  moss.beat = {id: 'garden_plant', clip: 'plant', startedAt: T0 - 12 * 60_000, endsAt: T0, line: null};
  const r = tick(s, {now: T0}, makeHooks()), m = at(r.state, '02-moss');
  return {blooms: m.inventory.filter(i => i === 'bloom').length, seeds: m.inventory.filter(i => i === 'clover_seed').length, passKept: m.inventory.includes('garden_pass'), craft: r.events.find(e => e.kind === 'craft' && e.muse === '02-moss'), s: r.state};
}
function nightRun({pass, start = NIGHT, acquiredAt = start, world = 'night-probe'}) {
  let s = createWorld(world, start);
  const orbit = at(s, '08-orbit'); orbit.place = 'commons:garden';
  if (pass) grantItem(s.items, orbit, 'night_pass', acquiredAt, orbit.place, 'craft');
  const r = runTicks(s, start, 180);
  return {stargaze: r.log.filter(e => e.kind === 'beat' && e.data.beat === 'night_pass_stargaze').length, log: r.log, s: r.s};
}
function tenFinds(extra) {
  const l = emptyLedger(), m = muse('03-ripple', 'commons:hq', extra);
  const spots = PLACES.filter(p => p.zone === 'neighborhood');
  const results = [];
  for (const p of spots.slice(0, 12)) { const d = discover(l, DAY, m.id, p, m.inventory, rngFor('ten', p.id), 1); if (d.ok) receiveDiscovery(l, m, d, 1); results.push(d); }
  return {tenth: results[9], eleventh: results[10], twelfth: results[11], m, l};
}
function spotlightTurns(ticket) {
  let s = createWorld('spot-probe', T0);
  if (ticket) at(s, '05-bloom').inventory.push('spotlight_ticket');
  const r = runTicks(s, T0, s.muses.length + 1);
  return r.log.filter(e => e.kind === 'spotlight' && e.muse === '05-bloom').length;
}

// The trade column of every item row, from checkTrade / abilityGain (not from the matrix generator).
const TRADE_TEXT = {relic: 'trade: never (relic)', fixed: 'trade: never (not transferable)', gain: 'trade: counts as an ability change for the receiver', wanted: 'trade: counts only for a receiver that wants it'};
function TRADE_COLUMN(id) {
  // The counter item changes nothing for the giver, so the verdict is about `id` alone.
  const w = id === 'pastry' ? 'snack_box' : 'pastry', l = emptyLedger(), a = muse('03-ripple', 'commons:cafe', [id]), b = muse('02-moss', 'commons:cafe', [w]);
  const r = checkTrade(l, DAY, a, b, id, w, 0, T0);
  if (r.reason === 'relic') return TRADE_TEXT.relic;
  if (r.reason === 'not_transferable') return TRADE_TEXT.fixed;
  if (r.ok) return TRADE_TEXT.gain;
  assert.equal(r.reason, 'no_ability_change', id);
  assert.deepEqual(checkTrade(l, DAY, a, {...b, wants: {items: [id]}}, id, w, 0, T0), {ok: true}, `${id}: wanted, it trades`);
  return TRADE_TEXT.wanted;
}

// ---- AC1: every catalog id has data, an effect (rule or explicit fallback), a visual and a test ----
test('AC1 coverage: every catalog id carries an effect rule or an explicit none with a reason; no effect entry is orphaned', () => {
  assert.equal(CATALOG.length, 59);
  for (const id of CATALOG) {
    const spec = itemSpec(id), e = spec?.effect;
    assert.ok(e, `${id}: no effect entry`);
    assert.ok(['prop', 'card', 'stamp', 'glow'].includes(spec.visual), `${id}: visual`);
    if ('rule' in e) assert.ok(EFFECT_RULES[e.rule], `${id}: unknown rule ${e.rule}`);
    else { assert.equal(e.effect, 'none', id); assert.ok(e.reason.length >= 20, `${id}: fallback needs a reason`); }
    if (spec.expiresHours) assert.ok(spec.expiresHours > 0 && !spec.permanent, `${id}: a timed item is not permanent`);
    if (spec.ability) assert.equal(spec.ability, effectRule(id), `${id}: a declared ability must be the implemented rule`);
  }
  assert.deepEqual(Object.keys(ITEM_EFFECTS).sort(), [...CATALOG].sort(), 'effect table keys are exactly the catalog ids');
  // Every implemented rule is used by an item and has a behaviour probe below.
  const used = new Set(CATALOG.map(effectRule).filter(Boolean));
  assert.deepEqual([...used].sort(), Object.keys(EFFECT_RULES).sort());
  assert.deepEqual(Object.keys(PROBES).sort(), Object.keys(EFFECT_RULES).sort());
  // The experience matrix states the same effect for every item row (no rule claimed where there is none).
  const doc = readFileSync(new URL('../docs/EXPERIENCE_MATRIX.md', import.meta.url), 'utf8');
  for (const id of ITEMS.map(i => i.id)) {
    const row = doc.split('\n').find(l => l.includes(`| item:${id} |`));
    assert.ok(row, `matrix row for ${id}`);
    const rule = effectRule(id);
    if (rule) assert.ok(row.includes(`effect rule \`${rule}\``) && !row.includes('effect none'), `${id}: matrix must name rule ${rule}`);
    else assert.ok(row.includes('effect none (fallback)') && !row.includes('effect rule'), `${id}: matrix must say fallback`);
    const trade = TRADE_COLUMN(id);
    assert.ok(row.includes(trade), `${id}: matrix trade column must say "${trade}"`);
    for (const other of Object.values(TRADE_TEXT)) if (other !== trade) assert.ok(!row.includes(other), `${id}: matrix claims "${other}"`);
  }
});

for (const [rule, probe] of Object.entries(PROBES)) test(`AC1 effect probe: ${rule} changes what the holder does`, async () => assert.equal(await probe(), true, rule));

test('AC1 effect: items without a rule change no ability, so trading only them is no trade', () => {
  const l = emptyLedger(), a = muse('01-sunny', 'commons:cafe', ['invite_token']), b = muse('04-ember', 'commons:cafe', ['event_pass']);
  assert.equal(abilityGain('invite_token', []), false);
  assert.equal(abilityGain('event_pass', []), false);
  assert.deepEqual(checkTrade(l, DAY, a, b, 'invite_token', 'event_pass', 0, T0), {ok: false, reason: 'no_ability_change'});
  assert.equal(abilityGain('night_pass', []), true, 'a rule item does change abilities');
});

test('AC1 effect: an item the receiver publicly wants opens its goal, so it trades even without a rule (Invite Token, Event Pass)', () => {
  const l = emptyLedger(), ripple = muse('03-ripple', 'commons:cafe', ['invite_token', 'event_pass']);
  const sunny = {...muse('01-sunny', 'commons:cafe', ['pastry']), wants: {items: ['fruit', 'invite_token', 'coffee']}};
  const tempo = {...muse('07-tempo', 'commons:cafe', ['pastry']), wants: {items: ['mixtape', 'event_pass', 'snack_box']}};
  assert.equal(abilityGain('invite_token', [], ['invite_token']), true);
  assert.equal(abilityGain('invite_token', ['invite_token'], ['invite_token']), true, 'stackable: a second one still serves the goal');
  assert.equal(abilityGain('event_pass', ['event_pass'], ['event_pass']), false, 'a pass already held opens nothing');
  assert.deepEqual(checkTrade(l, DAY, ripple, sunny, 'invite_token', 'pastry', 0, T0), {ok: true});
  assert.deepEqual(checkTrade(l, DAY, ripple, tempo, 'event_pass', 'pastry', 0, T0), {ok: true});
  assert.deepEqual(checkTrade(l, DAY, ripple, {...sunny, wants: {items: []}}, 'invite_token', 'pastry', 0, T0), {ok: false, reason: 'no_ability_change'}, 'without the want it is no trade');
  // The offline rule path: the resident accepts what it wants.
  let s = createWorld('wants', T0);
  const a = at(s, '03-ripple'), b = at(s, '01-sunny');
  a.place = b.place = 'commons:cafe'; a.inventory = ['invite_token']; b.inventory = ['pastry']; a.intent = {kind: 'trade', target: b.id, give: 'invite_token', want: 'pastry'};
  const out = resolveMeeting(s.items, s, a, b, placeById('commons:cafe'), () => .99, T0);
  assert.ok(out.some(e => e.kind === 'trade_completed'), 'Sunny takes the Invite Token she wants');
});

test('AC1 night_sky: the Night Pass beat only opens at night, only while the pass is valid', () => {
  assert.ok(BEATS.find(b => b.id === 'night_pass_stargaze').needs.includes('night_pass'));
  assert.equal(nightRun({pass: true, start: NOON}).stargaze, 0, 'not at noon');
  // After midnight it stays open until 03:00 and closes then.
  const beat = BEATS.find(b => b.id === 'night_pass_stargaze');
  assert.deepEqual([0, 1, 2, 3, 4, 18, 19, 23].map(h => inHours(beat, h)), [true, true, true, false, false, false, true, true], 'open 19:00-02:59');
  const starts = [];
  for (let k = 0; k < 8; k++) starts.push(...nightRun({pass: true, start: Date.parse('2026-11-04T10:30:00Z'), world: 'night-late-' + k}).log.filter(e => e.kind === 'beat' && e.data.beat === 'night_pass_stargaze').map(e => localClock(e.at)));
  assert.ok(starts.length > 0, 'opens when the run starts at 02:30');
  assert.ok(starts.every(c => c.hour === 2), `no Night Pass beat starts at or after 03:00 (${starts.map(c => c.hhmm)})`);
  const stale = nightRun({pass: true, acquiredAt: NIGHT - 24 * H});
  assert.equal(stale.stargaze, 0, 'an expired pass opens nothing');
  assert.ok(stale.log.some(e => e.kind === 'item_expired' && e.data.item === 'night_pass'));
});

test('AC1 extra_activity: one Recharge Ticket a day buys exactly one find past 10, and is spent', () => {
  const r = tenFinds(['recharge_ticket', 'recharge_ticket']);
  assert.equal(r.tenth.ok, true);
  assert.equal(r.eleventh.ok, true); assert.equal(r.eleventh.spent, 'recharge_ticket');
  assert.deepEqual(r.twelfth, {ok: false, reason: 'daily_limit'}, 'the second ticket the same day does nothing');
  assert.equal(r.m.inventory.filter(i => i === 'recharge_ticket').length, 1, 'only one ticket spent');
  assert.equal(r.l.finds[DAY]['03-ripple'].length, RULES.perDay + RULES.rechargesPerDay);
});

test('AC1 extra_spotlight: spent at the end of a tick, so the heartbeat\'s pre-tick spotlight decision is kept and the holder gets the next turn', () => {
  const s = createWorld('spot', T0);
  at(s, '05-bloom').inventory.push('spotlight_ticket');
  // The heartbeat picks the spotlight from the committed state before the tick and calls the model for it.
  const spot = spotlightFor(s, T0);
  assert.equal(spot.muse, s.muses[0].id);
  const decision = {muse: spot.muse, freedom: spot.freedom, source: 'live', output: {decision: 'go', target_place: 'Commons Cafe', target_agent: '', offer_item: '', want_item: '', public_reason: 'coffee', line: 'Coffee time'}};
  const first = tick(s, {now: T0, decision}, makeHooks());
  assert.ok(!first.events.some(e => e.kind === 'decision_rejected'), 'the decision for the pre-tick spotlight is not discarded');
  assert.ok(first.events.some(e => e.kind === 'spotlight' && e.muse === spot.muse && e.data.live === true));
  assert.ok(first.events.some(e => e.kind === 'spotlight_ticket_used' && e.muse === '05-bloom'));
  assert.ok(!at(first.state, '05-bloom').inventory.includes('spotlight_ticket'));
  assert.equal(first.state.spotlight.cursor, 1);
  // The next heartbeat sees the same queue: Bloom's extra turn, and the rotation does not move for it.
  assert.equal(spotlightFor(first.state, T0 + TICK_MS).muse, '05-bloom');
  const second = tick(first.state, {now: T0 + TICK_MS}, makeHooks());
  assert.equal(second.events.find(e => e.kind === 'spotlight').muse, '05-bloom');
  assert.equal(second.state.spotlight.cursor, 1, 'nobody lost a turn');
  assert.equal(tick(second.state, {now: T0 + 2 * TICK_MS}, makeHooks()).events.find(e => e.kind === 'spotlight').muse, s.muses[1].id);
});

test('AC1 extra_spotlight: a connected Muse (it decides in its owner\'s runtime) keeps its ticket', () => {
  const s = createWorld('spot-connected', T0);
  at(s, '05-bloom').inventory.push('spotlight_ticket');
  s.inbox.connected['05-bloom'] = T0;
  const r = tick(s, {now: T0}, makeHooks());
  assert.ok(!r.events.some(e => e.kind === 'spotlight_ticket_used'));
  assert.ok(at(r.state, '05-bloom').inventory.includes('spotlight_ticket'));
  assert.deepEqual(r.state.spotlight.visitorQueue, []);
});

test('AC2 a Muse holding a pass does not find a second one (passes do not stack); the find falls back to another item', () => {
  const garden = placeById('commons:garden'), last = () => .99;
  assert.equal(discover(emptyLedger(), DAY, '02-moss', garden, [], last, 1).item, 'garden_pass', 'the last pool slot is the Garden Pass');
  for (const r of [0, .34, .5, .67, .99]) {
    const d = discover(emptyLedger(), DAY, '02-moss', garden, ['garden_pass'], () => r, 1);
    assert.equal(d.ok, true); assert.notEqual(d.item, 'garden_pass');
  }
  const l = emptyLedger(), m = muse('02-moss', 'commons:garden');
  grantItem(l, m, 'garden_pass', 1, m.place, 'discover');
  const d = discover(l, DAY, m.id, garden, m.inventory, last, 2);
  receiveDiscovery(l, m, d, 2);
  assert.equal(m.inventory.filter(i => i === 'garden_pass').length, 1);
  assert.equal(l.expiry['02-moss'].length, 1, 'one pass, one clock');
});

// ---- AC2: boundary values of the abuse limits ----
test('AC2 boundaries: 10th find ok / 11th refused, one find per place, one trade per pair, 100 m, 2 counters', () => {
  const r = tenFinds([]);
  assert.equal(r.tenth.ok, true); assert.deepEqual(r.eleventh, {ok: false, reason: 'daily_limit'});
  const l = emptyLedger(), park = PLACES.find(p => p.zone === 'neighborhood' && p.kind === 'park');
  assert.equal(discover(l, DAY, '02-moss', park, [], rngFor('p'), 1).ok, true);
  assert.deepEqual(discover(l, DAY, '02-moss', park, [], rngFor('p'), 2), {ok: false, reason: 'place_limit'});
  assert.equal(discover(l, DAY, '01-sunny', park, [], rngFor('p'), 3).ok, true, 'the place limit is per Muse');
  // 100 m: the closest real place pairs on each side of the boundary.
  const near = ['osm:node/6614753529', 'osm:node/6614753530'], far = ['osm:way/123539752', 'osm:way/30027572'];
  const d = ids => Math.hypot(placeById(ids[0]).x - placeById(ids[1]).x, placeById(ids[0]).z - placeById(ids[1]).z);
  assert.ok(d(near) <= 100 && d(near) > 99 && d(far) > 100 && d(far) < 101);
  const t = emptyLedger(), give = 'transit_pass', want = 'clover_seed';
  assert.deepEqual(checkTrade(t, DAY, muse('03-ripple', near[0], [give]), muse('02-moss', near[1], [want]), give, want), {ok: true});
  assert.deepEqual(checkTrade(t, DAY, muse('03-ripple', far[0], [give]), muse('02-moss', far[1], [want]), give, want), {ok: false, reason: 'too_far'});
  const a = muse('03-ripple', 'commons:garden', [give, 'fruit']), b = muse('02-moss', 'commons:garden', [want, 'coffee']);
  assert.deepEqual(checkTrade(t, DAY, a, b, give, want, RULES.maxCounterOffers), {ok: true}, 'second counter allowed');
  assert.deepEqual(checkTrade(t, DAY, a, b, give, want, RULES.maxCounterOffers + 1), {ok: false, reason: 'counter_limit'});
  commitTrade(t, DAY, a, b, give, want, 5);
  assert.deepEqual(checkTrade(t, DAY, a, b, 'fruit', 'coffee'), {ok: false, reason: 'pair_limit'});
  assert.deepEqual(checkTrade(t, DAY, a, muse('09-copper', 'commons:garden', ['coffee']), 'fruit', 'coffee'), {ok: true}, 'another pair still may');
  assert.deepEqual(checkTrade(t, '2026-11-04', a, b, 'fruit', 'coffee'), {ok: true}, 'the pair limit is per day');
});

// ---- AC3: Transit 3 stops, 24 h expiry, seed consumed, permanent stamps kept ----
test('AC3 transit: two stops give no craft right, three different stops do, the same stop twice is one', () => {
  const l = emptyLedger(), all = PLACES.filter(p => p.kind === 'bus_stop');
  for (const s of all.slice(0, 2)) discover(l, DAY, '03-ripple', s, [], rngFor('t', s.id), 1);
  assert.equal(canCraftTransitPass(l, DAY, '03-ripple'), false);
  discover(l, DAY, '03-ripple', all[0], [], rngFor('t'), 2);
  assert.equal(canCraftTransitPass(l, DAY, '03-ripple'), false, 'a revisit is not a new stop');
  discover(l, DAY, '03-ripple', all[2], [], rngFor('t', 'c'), 3);
  assert.equal(canCraftTransitPass(l, DAY, '03-ripple'), true);
  assert.equal(canCraftTransitPass(l, '2026-11-04', '03-ripple'), false, 'a daily right');
});

test('AC3 expiry: a pass is valid at 23h59m after acquisition and expired at 24h; then it can neither be used nor traded', () => {
  const T = T0, l = emptyLedger();
  const a = muse('03-ripple', 'commons:garden'), b = muse('02-moss', 'commons:garden', ['clover_seed']);
  grantItem(l, a, 'transit_pass', T, a.place, 'craft');
  const from = placeById('commons:campfire'), far = PLACES.filter(p => p.zone === 'neighborhood').at(-1);
  const w = {items: l, muses: [a, b]};
  assert.deepEqual(sweepExpired(w, T + 24 * H - 60_000), []);
  assert.ok(a.inventory.includes('transit_pass'));
  assert.equal(speedFor(a.inventory, from, far), 'bus', 'still rides the bus at 23h59m');
  assert.deepEqual(checkTrade(l, DAY, a, b, 'transit_pass', 'clover_seed', 0, T + 24 * H - 60_000), {ok: true});
  assert.deepEqual(checkTrade(l, DAY, a, b, 'transit_pass', 'clover_seed', 0, T + 24 * H), {ok: false, reason: 'expired'}, 'not tradeable at 24h even before a sweep');
  assert.equal(isExpired(l, a.id, 'transit_pass', T + 24 * H), true);
  const ev = sweepExpired(w, T + 24 * H);
  assert.equal(ev.length, 1); assert.equal(ev[0].kind, 'item_expired'); assert.equal(ev[0].data.expiresAt, T + 24 * H);
  assert.ok(!a.inventory.includes('transit_pass'));
  assert.equal(speedFor(a.inventory, from, far), 'walk', 'no bus after expiry');
  assert.deepEqual(checkTrade(l, DAY, a, b, 'transit_pass', 'clover_seed', 0, T + 24 * H), {ok: false, reason: 'not_held'});
  const last = l.history.at(-1);
  assert.equal(last.via, 'expired'); assert.equal(last.item, 'transit_pass'); assert.equal(last.from, '03-ripple'); assert.equal(last.to, null);
  assert.equal(verifyHistory(l).ok, true);
});

test('AC3 expiry: the owner Muse\'s P0 trade search (findOwnerTrade) never offers an expired pass', () => {
  const s = createWorld('p0-expired', T0), me = at(s, OWNER_SLOT);
  me.inventory = ['garden_pass'];
  s.items.expiry = {[OWNER_SLOT]: [{item: 'garden_pass', at: T0 - 24 * H, expiresAt: T0}]};
  assert.equal(findOwnerTrade(s, () => false, T0 - 60_000)?.give, 'garden_pass', 'still valid a minute before');
  assert.equal(findOwnerTrade(s, () => false, T0), null, 'expired: no plan');
});

test('AC3 expiry in the engine: the tick at 24h removes the pass, logs item_expired, and the next trips walk', () => {
  let s = createWorld('expire', T0);
  const ripple = at(s, '03-ripple');
  grantItem(s.items, ripple, 'transit_pass', T0, ripple.place, 'craft');
  const before = tick(s, {now: T0 + 24 * H - 60_000}, makeHooks());
  assert.ok(at(before.state, '03-ripple').inventory.includes('transit_pass'));
  const after = tick(before.state, {now: T0 + 24 * H}, makeHooks());
  assert.ok(after.events.some(e => e.kind === 'item_expired' && e.muse === '03-ripple' && e.data.item === 'transit_pass'));
  assert.ok(!at(after.state, '03-ripple').inventory.includes('transit_pass'));
  const later = runTicks(after.state, T0 + 24 * H + TICK_MS, 240);
  assert.equal(later.log.filter(e => e.kind === 'depart' && e.muse === '03-ripple' && e.data.speed === 'bus').length, 0);
  assert.equal(verifyHistory(later.s.items).ok, true);
});

test('AC3 expiry carries over: a trade or gift hands on the remaining time; only a first acquisition from the world starts a clock', () => {
  const l = emptyLedger(), a = muse('03-ripple', 'commons:garden'), b = muse('02-moss', 'commons:garden', ['clover_seed']), c = muse('05-bloom', 'commons:garden');
  grantItem(l, a, 'garden_pass', T0, a.place, 'discover');
  assert.deepEqual(l.expiry['03-ripple'], [{item: 'garden_pass', at: T0, expiresAt: T0 + 24 * H}], 'found: a new clock');
  // A held it 20 h, then trades it to B: B's copy expires 4 h later, not 24 h.
  commitTrade(l, DAY, a, b, 'garden_pass', 'clover_seed', T0 + 20 * H);
  assert.deepEqual(l.expiry['02-moss'], [{item: 'garden_pass', at: T0, expiresAt: T0 + 24 * H}]);
  assert.equal(l.expiry['03-ripple']?.length ?? 0, 0, 'the giver keeps no record');
  const w = {items: l, muses: [a, b, c]};
  assert.deepEqual(sweepExpired(w, T0 + 24 * H - 60_000), [], 'B still holds it at 3h59m after the trade');
  // Passing it on again (gift) never renews it.
  transferItem(l, b, c, 'garden_pass', T0 + 22 * H);
  assert.equal(l.expiry['05-bloom'][0].expiresAt, T0 + 24 * H);
  const ev = sweepExpired(w, T0 + 24 * H);
  assert.equal(ev.length, 1); assert.equal(ev[0].muse, '05-bloom'); assert.ok(!c.inventory.includes('garden_pass'));
  // A new find later is a new pass with a new clock.
  grantItem(l, a, 'garden_pass', T0 + 30 * H, a.place, 'discover');
  assert.equal(l.expiry['03-ripple'][0].expiresAt, T0 + 54 * H);
  // An unrecorded copy in a state stored before I-06 starts its clock at the first sweep.
  const old = muse('08-orbit', 'commons:benches', ['night_pass']);
  sweepExpired({items: l, muses: [old]}, T0);
  assert.equal(l.expiry['08-orbit'][0].expiresAt, T0 + 24 * H, 'legacy copy: clock starts at the first sweep');
  assert.equal(verifyHistory(l).ok, true);
});

// Guards a path no tool reaches today: send_postcard takes only postcard ids, so a pass is never mailed through MCP.
// Mail.timed keeps the rule true if another path (or a wider schema) ever mails a pass.
test('AC3 expiry carries over in the mail: the clock keeps running in transit and moves to the receiver', () => {
  let s = createWorld('mail-clock', T0);
  const ripple = at(s, '03-ripple');
  grantItem(s.items, ripple, 'event_pass', T0, ripple.place, 'discover');
  s = tick(s, {now: T0 + 20 * H}, makeHooks()).state;
  // What send_postcard does: the item and its clock leave the sender together.
  const sender = at(s, '03-ripple');
  sender.inventory.splice(sender.inventory.indexOf('event_pass'), 1);
  const timed = takeTimed(s.items, '03-ripple', 'event_pass');
  s.inbox.mail.push({id: 'mail_t', from: '03-ripple', to: '02-moss', item: 'event_pass', text: null, sentAt: T0 + 20 * H, deliverAt: T0 + 21 * H, crossRegion: false, timed});
  s = tick(s, {now: T0 + 21 * H}, makeHooks()).state;
  assert.ok(at(s, '02-moss').inventory.includes('event_pass'));
  assert.deepEqual(s.items.expiry['02-moss'].filter(r => r.item === 'event_pass'), [{item: 'event_pass', at: T0, expiresAt: T0 + 24 * H}]);
  const end = tick(s, {now: T0 + 24 * H}, makeHooks());
  assert.ok(end.events.some(e => e.kind === 'item_expired' && e.muse === '02-moss' && e.data.item === 'event_pass'), 'expires 3 h after delivery, 4 h after it left the sender');
});

test('AC3 seed and stamps: Bloom consumes only the Clover Seed; permanent stamps are never consumed, expired or traded', () => {
  const r = plantFinish();
  assert.deepEqual(r.craft.data.from, ['clover_seed']);
  assert.equal(r.blooms, 1); assert.equal(r.seeds, 0); assert.equal(r.passKept, true);
  assert.ok(r.s.items.history.some(h => h.via === 'craft' && h.item === 'bloom' && h.hash), 'the craft is in the chained history');
  assert.equal(verifyHistory(r.s.items).ok, true);
  const l = emptyLedger(), stops = PLACES.filter(p => p.kind === 'bus_stop').slice(0, 3), m = muse('03-ripple', stops[0].id);
  for (const s of stops) { const d = discover(l, DAY, m.id, s, m.inventory, rngFor('st', s.id), 1); if (d.ok) receiveDiscovery(l, m, d, 1); }
  assert.ok(m.inventory.includes('stamp_bus_stop'));
  grantItem(l, m, 'transit_pass', 2, m.place, 'craft');
  assert.ok(m.inventory.includes('stamp_bus_stop'), 'crafting the pass does not consume the stamp');
  sweepExpired({items: l, muses: [m]}, 2 + 30 * 24 * H);
  assert.ok(m.inventory.includes('stamp_bus_stop') && !m.inventory.includes('transit_pass'), 'after 30 days the stamp stays, the pass is gone');
  const b = muse('02-moss', stops[0].id, ['clover_seed']);
  assert.deepEqual(checkTrade(l, DAY, m, b, 'stamp_bus_stop', 'clover_seed'), {ok: false, reason: 'not_transferable'});
});

// ---- AC4: relics, repeat curiosity 0, void exchanges, tamper-proof history ----
test('AC4 relics never move; repeat curiosity gives 0; exchanges that change nothing are refused', () => {
  const l = emptyLedger(), a = muse('03-ripple', 'commons:hq', ['commons_ember', 'transit_pass', 'coffee']), b = muse('02-moss', 'commons:hq', ['clover_seed', 'transit_pass']);
  for (const id of ITEMS.filter(i => i.category === 'relic').map(i => i.id)) assert.deepEqual(checkTrade(l, DAY, {...a, inventory: [id]}, b, id, 'clover_seed'), {ok: false, reason: 'relic'}, id);
  const cafes = PLACES.filter(p => p.kind === 'cafe' && p.zone === 'neighborhood');
  const r1 = discover(l, DAY, '06-ink', placeById('commons:cafe'), [], () => 0, 1), r2 = discover(l, DAY, '06-ink', cafes[0], [], () => 0, 2);
  assert.equal(r1.reward, 'curiosity'); assert.equal(r2.item, r1.item); assert.equal(r2.reward, 'none', 'same kind again: no curiosity reward');
  assert.deepEqual(checkTrade(l, DAY, a, b, 'coffee', 'coffee'), {ok: false, reason: 'same_item'});
  assert.deepEqual(checkTrade(l, DAY, a, b, 'tea', 'clover_seed'), {ok: false, reason: 'not_held'});
  assert.deepEqual(checkTrade(l, DAY, a, b, 'transit_pass', 'transit_pass'), {ok: false, reason: 'same_item'});
  const c = muse('09-copper', 'commons:hq', ['transit_pass', 'trade_receipt']);
  assert.deepEqual(checkTrade(l, DAY, {...a, inventory: ['transit_pass']}, {...c, inventory: ['transit_pass']}, 'transit_pass', 'transit_pass'), {ok: false, reason: 'same_item'});
  assert.deepEqual(checkTrade(l, DAY, muse('01-sunny', 'commons:hq', ['invite_token']), muse('07-tempo', 'commons:hq', ['event_pass']), 'invite_token', 'event_pass'), {ok: false, reason: 'no_ability_change'});
});

function chained(n = 6) {
  const l = emptyLedger();
  for (let i = 0; i < n; i++) appendHistory(l, {item: i % 2 ? 'coffee' : 'fruit', from: null, to: '02-moss', place: 'commons:cafe', at: 1000 + i, via: 'discover'});
  return l;
}
test('AC4 history: entries chain from genesis with prevHash/hash, sha256 matches node:crypto', () => {
  for (const t of ['', 'abc', 'x'.repeat(200), 'Café ↔ 정원']) assert.equal(sha256Hex(t), createHash('sha256').update(t).digest('hex'));
  const l = chained();
  assert.equal(l.history[0].prevHash, GENESIS);
  for (let i = 1; i < l.history.length; i++) assert.equal(l.history[i].prevHash, l.history[i - 1].hash);
  assert.equal(l.chain.head, l.history.at(-1).hash);
  assert.deepEqual(verifyHistory(l), {ok: true, chained: 6, legacy: 0, head: l.chain.head});
});

test('AC4 history tampering is rejected: edit, delete (first, middle, last), reorder, insert', () => {
  const tampered = fn => { const l = structuredClone(chained()); fn(l.history, l); return verifyHistory(l); };
  assert.equal(tampered(h => { h[2].item = 'taxi_token'; }).reason, 'bad_hash');
  assert.equal(tampered(h => { h[2].to = '00-jolly'; h[2].hash = historyHash(h[2]); }).reason, 'broken_link', 're-hashing one entry breaks the next link');
  assert.equal(tampered(h => { h.splice(2, 1); }).reason, 'broken_link');
  assert.equal(tampered(h => { h.shift(); }).reason, 'broken_link', 'deleting the oldest no longer meets the anchor');
  assert.equal(tampered(h => { h.pop(); }).reason, 'head_mismatch');
  assert.equal(tampered(h => { [h[1], h[2]] = [h[2], h[1]]; }).reason, 'broken_link');
  assert.equal(tampered(h => { h.splice(3, 0, {item: 'taxi_token', from: null, to: '00-jolly', place: null, at: 1, via: 'discover'}); }).reason, 'legacy_after_genesis');
  assert.equal(tampered(h => { h[1].seq = 9; h[1].hash = historyHash(h[1]); for (let i = 2; i < h.length; i++) { h[i].prevHash = h[i - 1].hash; h[i].hash = historyHash(h[i]); } }).ok, false);
  // Writes refuse to extend a tampered history (C04: no reward or move on a broken record).
  const cut = chained(); cut.history.pop();
  assert.throws(() => appendHistory(cut, {item: 'spark', from: null, to: '02-moss', place: null, at: 9, via: 'discover'}), HistoryTamperError);
  const edited = chained(); edited.history.at(-1).item = 'taxi_token';
  const m = muse('02-moss', 'commons:garden');
  assert.throws(() => grantItem(edited, m, 'bloom', 9, 'commons:garden', 'craft'), HistoryTamperError);
  assert.deepEqual(m.inventory, [], 'nothing was granted');
  const a = muse('03-ripple', 'commons:garden', ['transit_pass']), b = muse('02-moss', 'commons:garden', ['clover_seed']);
  assert.throws(() => commitTrade(edited, DAY, a, b, 'transit_pass', 'clover_seed', 9), HistoryTamperError);
  assert.deepEqual([a.inventory, b.inventory], [['transit_pass'], ['clover_seed']], 'no half trade');
});

test('AC4 history: trimming keeps the chain linked to the last hash; old entries without hashes are before genesis', () => {
  const l = chained(HISTORY_KEEP + 50);
  trimHistory(l);
  assert.equal(l.history.length, HISTORY_KEEP);
  assert.equal(l.history[0].seq, 51); assert.equal(l.chain.anchor, l.history[0].prevHash);
  assert.equal(verifyHistory(l).ok, true);
  const dropped = structuredClone(l); dropped.history.shift();
  assert.equal(verifyHistory(dropped).reason, 'broken_link', 'deleting below the anchor is still detected');
  // A state stored before I-06: no chain, plain entries.
  const old = {finds: {}, trades: {}, history: [{item: 'fruit', from: null, to: '02-moss', place: 'commons:garden', at: 1, via: 'discover'}, {item: 'coffee', from: '09-copper', to: '02-moss', place: 'commons:cafe', at: 2, via: 'gift'}]};
  assert.deepEqual(verifyHistory(old), {ok: true, chained: 0, legacy: 2, head: GENESIS});
  appendHistory(old, {item: 'tea', from: null, to: '05-bloom', place: 'commons:cafe', at: 3, via: 'discover'});
  assert.equal(old.history[2].prevHash, GENESIS);
  assert.deepEqual(verifyHistory(old), {ok: true, chained: 1, legacy: 2, head: old.history[2].hash});
  const forged = structuredClone(old); forged.history[0].hash = 'f'.repeat(64);
  assert.equal(verifyHistory(forged).reason, 'legacy_chained');
  // An append from code that predates the chain is sealed (appended) at the next upkeep, never rewriting older entries.
  old.history.push({item: 'spark', from: null, to: '05-bloom', place: null, at: 4, via: 'discover'});
  assert.equal(verifyHistory(old).reason, 'legacy_after_genesis');
  assert.equal(sealHistory(old), 1);
  assert.equal(verifyHistory(old).ok, true);
  trimHistory(old, 2);
  assert.equal(old.chain.legacy, 0); assert.equal(verifyHistory(old).ok, true);
});

test('AC4 history in the engine: an old stored world keeps ticking, its history stays legacy, new moves chain', () => {
  let s = createWorld('legacy', T0);
  delete s.items.chain; delete s.items.expiry;
  s.items.history.push({item: 'fruit', from: null, to: '02-moss', place: 'commons:garden', at: T0 - 1, via: 'discover'});
  at(s, '03-ripple').inventory.push('transit_pass');
  const r = runTicks(s, T0, 240);
  const v = verifyHistory(r.s.items);
  assert.equal(v.ok, true); assert.equal(v.legacy, 1); assert.ok(v.chained > 0, 'new moves were chained');
  assert.ok(r.s.items.expiry['03-ripple'].some(x => x.item === 'transit_pass' && x.expiresAt === T0 + 24 * H), 'the unrecorded pass started its clock at the first tick');
});

// ---- AC4: a tampered history halts item rules, never the world ----
const breakTail = st => { st.items.history.pop(); };
test('AC4 tamper in the engine: the tick still commits, item rules stop, history_tamper is logged once a day', () => {
  let s = createWorld('tamper', T0);
  const moss = at(s, '02-moss');
  for (let i = 0; i < 3; i++) grantItem(s.items, moss, 'spark', T0, moss.place, 'craft');
  breakTail(s);
  const kept = s.items.history.length;
  const r = runTicks(s, T0, 120);
  const tamper = r.log.filter(e => e.kind === 'history_tamper');
  assert.equal(tamper.length, 1, 'once for the day'); assert.equal(tamper[0].data.reason, 'tail_mismatch');
  assert.equal(r.s.tick, 120, 'every tick committed');
  assert.ok(r.log.some(e => e.kind === 'depart') && r.log.some(e => e.kind === 'beat') && r.log.filter(e => e.kind === 'spotlight').length === 120, 'movement, beats and the spotlight go on');
  assert.equal(r.log.filter(e => ['discover', 'trade_completed', 'craft', 'item_expired', 'spotlight_ticket_used'].includes(e.kind)).length, 0, 'no item rule ran');
  assert.equal(r.s.items.history.length, kept, 'nothing was appended');
  const next = tick(r.s, {now: Date.parse('2026-11-04T16:00:00Z')}, makeHooks());
  assert.equal(next.events.filter(e => e.kind === 'history_tamper').length, 1, 'logged again on the next day');
});

test('AC4 tamper at the day change: a middle edit whose own hash (and the ones after, short of the newest) was recomputed is caught by the full check', () => {
  for (const upTo of ['one', 'all-but-newest']) {
    let s = createWorld('tamper-mid', T0);
    const moss = at(s, '02-moss');
    for (let i = 0; i < 6; i++) grantItem(s.items, moss, 'spark', T0, moss.place, 'craft');
    const h = s.items.history;
    h[2].to = '00-jolly';
    const end = upTo === 'one' ? 3 : h.length - 1;
    for (let i = 2; i < end; i++) { if (i > 2) h[i].prevHash = h[i - 1].hash; h[i].hash = historyHash(h[i]); }
    const same = tick(s, {now: T0}, makeHooks());
    assert.equal(same.events.filter(e => e.kind === 'history_tamper').length, 0, `${upTo}: the cheap tail check cannot see it`);
    const day = tick(same.state, {now: Date.parse('2026-11-04T16:00:00Z')}, makeHooks());
    const ev = day.events.filter(e => e.kind === 'history_tamper');
    assert.equal(ev.length, 1, upTo); assert.equal(ev[0].data.reason, 'broken_link');
    assert.ok(day.events.some(e => e.kind === 'new_day'));
  }
});

test('AC4 tamper through the runtime and MCP: the heartbeat commits, item tools are refused with history_tamper, other tools still work', async () => {
  const t = await toolWorld();
  t.edit(st => { const me = st.muses.find(m => m.id === OWNER_SLOT); me.inventory.push('coffee'); grantItem(st.items, me, 'spark', t.now, me.place, 'craft'); grantItem(st.items, me, 'spark', t.now, me.place, 'craft'); breakTail(st); });
  assert.equal((await t.runtime.heartbeat(t.now + TICK_MS)).status, 'committed');
  assert.equal(t.events('history_tamper').length, 1);
  for (const [name, args] of [['discover', {}], ['give_gift', {to: '08-orbit', item: 'coffee'}], ['craft', {recipe: 'transit_pass'}]]) {
    const r = await t.call(name, args);
    assert.equal(r.structuredContent.refused, 'history_tamper', name);
  }
  assert.ok(t.muse(OWNER_SLOT).inventory.includes('coffee'), 'nothing moved');
  assert.equal((await t.call('greet', {text: 'Hello, neighbors!'})).isError, false, 'a non-item write still runs');
  assert.equal((await t.runtime.heartbeat(t.now + 2 * TICK_MS)).status, 'committed');
  assert.equal(t.events('history_tamper').length, 1, 'still once a day');
});
