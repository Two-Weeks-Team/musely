// I-08 (#55): the owner's destination cell, the Muse's own current cell, trips and the verified teleport (direction v2, 11, 13, 13.1;
// contracts C03, C07). One block per acceptance criterion:
//   AC1 a new owner location does not move the Muse's current cell at once
//   AC2 before a walk or bus trip arrives, the destination can be neither discovered nor traded at
//   AC3 only a verified neighborhood + a Taxi Token teleports, residents never; a resent teleport spends one token
//   AC4 HQ + seven Bay presets, the always-on virtual location line, and the device location permission flow (denied → virtual)
// The world runs over node:sqlite with the same ConnectedHost / WorldRuntime / HTTP handlers the Durable Object uses.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Trust, OWNER_SLOT} from '../worker/core/trust.ts';
import {ConnectedHost} from '../worker/core/connected.ts';
import {handleMcpHttp} from '../worker/core/mcp-server.ts';
import {connectedRoutes} from '../worker/core/owner-api.ts';
import {issueOwnerSession, readOwnerSession} from '../worker/core/owner-session.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {placeById, PLACES} from '../src/engine/places.ts';
import {PRESETS, placeCell, teleportCheck, nearestPreset, nextOwnerLocation, defaultOwner, NEIGHBORHOOD_KM, areaById} from '../src/engine/location.ts';
import {createWorld, tick, TICK_MS, spotlightFor} from '../src/engine/world.ts';
import {speedFor} from '../src/engine/items.ts';
import {locationLine, snapshotOf, museLine, deviceLocation, deviceStart, deviceResult, deviceWatchdog, deviceText, DEVICE_IDLE, GEO_WATCHDOG_MS, VIRTUAL_FALLBACK} from '../src/ui/location-state.ts';

// ---------- a world Durable Object over node:sqlite (as in mcp.test.mjs) ----------
const TX_SQL = /^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i;
const sqlite = () => { const db = new DatabaseSync(':memory:'); let depth = 0; return {exec(q, ...b) { if (TX_SQL.test(q)) throw new Error('use transactionSync'); const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }, transactionSync(fn) { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } }}; };
// Delegations carry a real 24 h expiry, so the clock starts at the real time.
const T0 = Math.floor(Date.now() / 60_000) * 60_000;
const SECRET = 'test-session-secret', HOST = 'https://musely.net';
const TOKENS = {owner: 'owner-control-token-for-tests-000001', peer: 'demo-peer-control-token-for-tests-02'};
const OWNER_CFG = {secret: SECRET, tokens: TOKENS, origins: [HOST]};

async function world() {
  const clock = {now: T0};
  const sql = sqlite(), ledger = new Ledger(sql, {dailyCapUsd: 1}); ledger.init();
  const trust = new Trust(sql); trust.init();
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const ownerRoot = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await trust.ensureAgents(ownerRoot);
  const hooks = makeHooks();
  const runtime = new WorldRuntime(sql, {worldId: 'w', meetingGate: 'off', ledger, model: null, hooks, delegationValid: m => !trust.suspended(m)});
  runtime.init(T0);
  const host = new ConnectedHost({sql, trust, runtime, hooks, baseUrl: HOST, ownerRoot: () => ownerRoot, ownerClaimed: () => true, now: () => clock.now});
  host.init();
  const stub = {
    mcp: (...a) => host.mcp(...a), issueAgentKey: () => host.issueKey(), listAgentKeys: () => host.listKeys(), revokeAgentKey: id => host.revokeKey(id),
    ownerLocation: () => host.ownerLocation(), setOwnerLocation: i => host.setOwnerLocation(i), ownerNotifications: f => host.notifications(f), agentKeyMuse: id => host.keyMuse(id),
  };
  const {token} = await issueOwnerSession(SECRET, TOKENS, 'owner');
  const owner = await readOwnerSession(SECRET, token, TOKENS);
  const route = async (method, path, body) => {
    const req = new Request(HOST + path, {method, body: body === undefined ? undefined : JSON.stringify(body), headers: {'content-type': 'application/json', origin: HOST}});
    const res = await connectedRoutes(req, new URL(req.url), {owner}, stub, OWNER_CFG);
    return {status: res.status, body: await res.json()};
  };
  const key = (await route('POST', '/api/agent-keys')).body.key;
  let id = 0;
  const call = async (name, args = {}) => {
    const res = await handleMcpHttp(new Request(HOST + '/mcp', {method: 'POST', body: JSON.stringify({jsonrpc: '2.0', id: ++id, method: 'tools/call', params: {name, arguments: args}}), headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + key}}), stub, {allowedHosts: ['musely.net']});
    const j = await res.json(); return j.result ?? j;
  };
  const muse = m => runtime.state().muses.find(x => x.id === m);
  const edit = fn => runtime.commitExternal(clock.now, 'test-' + Math.random(), st => fn(st));
  const events = kind => runtime.events(0, 1000).filter(e => !kind || e.kind === kind);
  const put = (m, place, inv) => edit(st => { const x = st.muses.find(y => y.id === m); x.place = place; x.travel = null; x.beat = null; if (inv) x.inventory = [...inv]; });
  return {clock, runtime, route, call, muse, edit, events, put};
}
const tokens = m => m.inventory.filter(i => i === 'taxi_token').length;

// ===================== AC1: the owner cell moves, the Muse's cell does not =====================
test('AC1 a new owner location leaves the Muse\'s current cell as it was; only the trip\'s arrival changes it', async () => {
  const t = await world();
  t.put(OWNER_SLOT, 'commons:benches');
  const from = placeCell('commons:benches');
  const set = await t.route('POST', '/api/owner/location', {source: 'virtual', preset: 'stanford'});
  assert.equal(set.status, 200);
  assert.equal(set.body.location.cell, placeCell('bay:stanford'), 'the owner destination cell is Stanford');
  assert.equal(t.muse(OWNER_SLOT).place, 'commons:benches', 'the Muse is still where it was');
  assert.equal(set.body.location.muse.place.id, 'commons:benches');
  assert.equal(set.body.location.muse.at_owner_cell, false);
  assert.equal(set.body.location.muse.travelling_to.id, 'bay:stanford');
  const eta = set.body.follow.etaMs;
  assert.ok(eta > 60 * 60_000, 'a real walking ETA, not a jump: ' + eta);
  const ws = await t.call('get_world_state');
  assert.equal(ws.structuredContent.muse.cell, from, 'MCP world state reports the Muse\'s own cell');
  assert.notEqual(ws.structuredContent.muse.cell, ws.structuredContent.owner_location.cell);
  // A heartbeat before the ETA: still on the road. At the ETA: arrives.
  await t.runtime.heartbeat(T0 + eta - 60_000);
  assert.equal(t.muse(OWNER_SLOT).place, 'commons:benches');
  assert.ok(t.muse(OWNER_SLOT).travel);
  await t.runtime.heartbeat(T0 + eta + 1000);
  assert.equal(t.muse(OWNER_SLOT).place, 'bay:stanford');
  assert.equal(t.events('arrive').filter(e => e.muse === OWNER_SLOT).at(-1).data.location, 'virtual (demo)');
});

test('AC1 engine: nextOwnerLocation is pure (no Muse changes) and a verify flag belongs to one cell', () => {
  const prev = defaultOwner(OWNER_SLOT, T0);
  const s = createWorld('ac1', T0), before = JSON.stringify(s.muses);
  const a = nextOwnerLocation(prev, {source: 'virtual', preset: 'oakland', verify: true}, T0);
  assert.ok(a.ok); assert.equal(a.owner.verified, true); assert.equal(a.owner.target, 'bay:oakland');
  assert.equal(JSON.stringify(s.muses), before);
  const b = nextOwnerLocation(a.owner, {source: 'virtual', preset: 'oakland'}, T0 + 1);
  assert.equal(b.owner.verified, true, 'same cell keeps its verification');
  const c = nextOwnerLocation(b.owner, {source: 'virtual', preset: 'san-jose'}, T0 + 2);
  assert.equal(c.owner.verified, false, 'another cell is not verified');
});

// ===================== AC2: no discovery or nearby trade before arrival =====================
test('AC2 before the walk or bus arrives: no discovery and no nearby trade at the destination; after arrival both use the new place', async () => {
  const t = await world();
  t.put(OWNER_SLOT, 'commons:benches', ['coffee', 'transit_pass']);
  t.put('02-moss', 'bay:stanford', ['clover_seed', 'watering_can']);
  const set = await t.route('POST', '/api/owner/location', {source: 'virtual', preset: 'stanford'});
  assert.equal(set.body.follow.mode, 'bus', 'a Transit Pass makes it a bus ride');
  const eta = set.body.follow.etaMs;
  assert.ok(eta > 10 * 60_000, 'the bus still takes real time: ' + eta);
  assert.equal((await t.call('discover')).structuredContent.refused, 'travelling');
  assert.equal((await t.call('propose_trade', {to: '02-moss', give: 'coffee', want: 'clover_seed'})).structuredContent.refused, 'travelling');
  assert.equal(t.events('discover').filter(e => e.muse === OWNER_SLOT && e.place === 'bay:stanford').length, 0);
  // Stopped short of Stanford (still at the commons): the owner "is" at Stanford, but the trade distance uses the Muse's place.
  t.put(OWNER_SLOT, 'commons:benches');
  assert.equal((await t.call('propose_trade', {to: '02-moss', give: 'coffee', want: 'clover_seed'})).structuredContent.refused, 'too_far');
  const d0 = await t.call('discover');
  assert.notEqual(d0.structuredContent.place?.id, 'bay:stanford');
  // The trip again, and its arrival through the heartbeat at the real ETA.
  t.edit(st => { st.muses.find(m => m.id === OWNER_SLOT).travel = {to: 'bay:stanford', departAt: T0, arriveAt: T0 + eta, speed: 'bus', chosen: true}; });
  await t.runtime.heartbeat(T0 + eta + 1000);
  t.clock.now = T0 + eta + 2000;
  assert.equal(t.muse(OWNER_SLOT).place, 'bay:stanford');
  t.put('02-moss', 'bay:stanford'); // the scenario may have sent Moss on a walk meanwhile
  const r = await t.call('propose_trade', {to: '02-moss', give: 'coffee', want: 'clover_seed'});
  assert.equal(r.isError, false, 'at Stanford the trade distance passes: ' + JSON.stringify(r.structuredContent.refused));
  assert.ok(['completed', 'countered', 'rejected'].includes(r.structuredContent.result), 'Moss answers the proposal: ' + r.structuredContent.result);
});

test('AC2 engine: a Muse on its way meets nobody and finds nothing at the destination until the arrival tick', () => {
  const hooks = makeHooks();
  let s = createWorld('ac2', T0);
  const jolly = s.muses.find(m => m.id === OWNER_SLOT), moss = s.muses.find(m => m.id === '02-moss');
  moss.place = 'bay:stanford'; moss.travel = null; moss.beat = {id: 'rest', clip: 'idle', startedAt: T0, endsAt: T0 + 10 * 3_600_000, line: null};
  jolly.place = 'commons:benches'; jolly.beat = null; jolly.travel = {to: 'bay:stanford', departAt: T0, arriveAt: T0 + 30 * TICK_MS, speed: 'walk', chosen: true};
  const log = [];
  for (let i = 1; i <= 31; i++) { const r = tick(s, {now: T0 + i * TICK_MS}, hooks); s = r.state; log.push(...r.events.map(e => ({...e, i}))); }
  const touches = log.filter(e => (e.muse === OWNER_SLOT || e.other === OWNER_SLOT) && ['encounter', 'discover', 'trade_completed', 'trade_proposed'].includes(e.kind));
  const arrive = log.find(e => e.kind === 'arrive' && e.muse === OWNER_SLOT && e.place === 'bay:stanford');
  assert.ok(arrive, 'arrives at the ETA');
  assert.equal(arrive.i, 30);
  assert.ok(touches.every(e => e.i >= arrive.i), 'nothing at Stanford before the arrival tick: ' + touches.map(e => e.kind + '@' + e.i).join(','));
});

// ===================== AC3: verified neighborhood + Taxi Token only; resent teleport spends once =====================
test('AC3 rule engine: residents have no neighborhood verification, so a Taxi Token never teleports them', () => {
  const hooks = makeHooks();
  let s = createWorld('ac3-residents', T0);
  for (const m of s.muses) m.inventory.push('taxi_token', 'taxi_token');
  // The owner's cell is Stanford and verified for all 360 ticks: the verification exists, but only the owner's Muse may use it.
  s.owner = {...s.owner, preset: 'stanford', area: 'stanford', cell: placeCell('bay:stanford'), target: 'bay:stanford', verified: true};
  const go = {muse: OWNER_SLOT, freedom: 'where', source: 'live', output: {decision: 'go', target_place: 'Stanford', target_agent: '', offer_item: '', want_item: '', public_reason: 'reading', line: ''}};
  const log = [];
  for (let i = 0; i < 360; i++) {
    const sp = s.muses[s.spotlight.cursor % s.muses.length].id, jolly = s.muses.find(m => m.id === OWNER_SLOT);
    const asks = sp === OWNER_SLOT && jolly.place !== 'bay:stanford' && !jolly.travel;
    const r = tick(s, {now: T0 + i * TICK_MS, decision: asks ? {...go, freedom: spotlightFor(s, T0 + i * TICK_MS).freedom} : null}, hooks); s = r.state; log.push(...r.events);
  }
  const taxi = log.filter(e => e.kind === 'depart' && e.data.speed === 'taxi');
  assert.equal(taxi.filter(e => e.muse !== OWNER_SLOT).length, 0, 'no resident taxi departures');
  assert.ok(taxi.some(e => e.muse === OWNER_SLOT && e.data.to === 'bay:stanford'), 'the owner\'s Muse takes the taxi into the verified cell');
  assert.equal(log.filter(e => e.tags.includes('teleport') && e.muse !== OWNER_SLOT).length, 0, 'no resident teleport arrivals');
  assert.ok(log.filter(e => e.kind === 'depart' && e.muse !== OWNER_SLOT).length > 50, 'the world still moves');
  // The hook itself: verified only for the owner's Muse into the owner's verified cell.
  const from = placeById('commons:campfire'), bay = placeById('bay:stanford');
  // Fixed inventories: only a Taxi Token (the run above may have crafted a Transit Pass).
  const ripple = {id: '03-ripple', inventory: ['taxi_token']}, jolly = {id: OWNER_SLOT, inventory: ['taxi_token']};
  s.owner = {...s.owner, preset: 'stanford', area: 'stanford', cell: placeCell(bay), target: bay.id, verified: true};
  assert.equal(hooks.speedFor(ripple, from, bay, s), 'walk', 'a resident with tokens walks even when the owner cell is verified');
  assert.equal(hooks.speedFor(jolly, from, bay, s), 'taxi');
  assert.equal(hooks.speedFor(jolly, from, placeById('bay:oakland'), s), 'walk', 'outside the owner cell');
  s.owner.verified = false;
  assert.equal(hooks.speedFor(jolly, from, bay, s), 'walk', 'unverified');
  assert.equal(speedFor(['taxi_token'], from, bay), 'walk', 'items.ts speedFor is unverified by default');
});

test('AC3 rule engine: a spotlight decision to the Bay with only a Taxi Token is refused unless it may teleport', () => {
  const run = (muse, owner) => {
    const hooks = makeHooks();
    let s = createWorld('ac3-decision', T0);
    const m = s.muses.find(x => x.id === muse);
    m.inventory = m.inventory.filter(i => i !== 'transit_pass').concat('taxi_token');
    if (owner) s.owner = {...s.owner, ...owner};
    const decision = {muse, freedom: 'where', source: 'live', output: {decision: 'go', target_place: 'Stanford', target_agent: '', offer_item: '', want_item: '', public_reason: 'reading', line: ''}};
    for (let i = 0; i < 20; i++) {
      const sp = s.muses[s.spotlight.cursor % s.muses.length].id;
      const r = tick(s, {now: T0 + i * TICK_MS, decision: sp === muse ? decision : null}, hooks); s = r.state;
      const mine = r.events.filter(e => e.muse === muse && (e.kind === 'decision_rejected' || (e.kind === 'depart' && e.data.to === 'bay:stanford')));
      if (mine.length) return {kind: mine[0].kind, speed: mine[0].data.speed, reason: mine[0].data.reason, tokens: tokens(s.muses.find(x => x.id === muse))};
    }
    return null;
  };
  const stanford = {preset: 'stanford', area: 'stanford', cell: placeCell('bay:stanford'), target: 'bay:stanford'};
  const resident = run('03-ripple', {...stanford, verified: true});
  assert.equal(resident.kind, 'decision_rejected', 'a resident cannot use the owner\'s verification');
  assert.match(resident.reason, /verified neighborhood/);
  assert.equal(resident.tokens, 1, 'nothing spent');
  assert.equal(run(OWNER_SLOT, {...stanford, verified: false}).kind, 'decision_rejected', 'owner cell not verified');
  assert.equal(run(OWNER_SLOT, {preset: 'oakland', area: 'oakland', cell: placeCell('bay:oakland'), target: 'bay:oakland', verified: true}).kind, 'decision_rejected', 'Stanford is not the owner cell');
  const ok = run(OWNER_SLOT, {...stanford, verified: true});
  assert.deepEqual([ok.kind, ok.speed, ok.tokens], ['depart', 'taxi', 0], 'verified + token: teleports and spends the token');
});

test('AC3 teleportCheck: the owner\'s verification belongs to the owner\'s Muse only', () => {
  const owner = {...defaultOwner(OWNER_SLOT, T0), preset: 'oakland', area: 'oakland', cell: placeCell('bay:oakland'), target: 'bay:oakland', verified: true};
  const oakland = placeById('bay:oakland');
  assert.equal(teleportCheck(owner, {id: OWNER_SLOT, inventory: ['taxi_token']}, oakland), null);
  assert.equal(teleportCheck(owner, {id: '03-ripple', inventory: ['taxi_token']}, oakland), 'neighborhood_not_verified');
  assert.equal(teleportCheck({...owner, verified: false}, {id: OWNER_SLOT, inventory: ['taxi_token']}, oakland), 'neighborhood_not_verified');
  assert.equal(teleportCheck(owner, {id: OWNER_SLOT, inventory: []}, oakland), 'no_taxi_token');
  assert.equal(teleportCheck(owner, {id: OWNER_SLOT, inventory: ['taxi_token']}, placeById('bay:stanford')), 'not_in_owner_cell');
  assert.equal(teleportCheck(undefined, {id: OWNER_SLOT, inventory: ['taxi_token']}, oakland), 'neighborhood_not_verified');
});

test('AC3 MCP move(teleport) resent with the same command_id spends one Taxi Token and returns the first result; a new id is refused (already here) and spends nothing', async () => {
  const t = await world();
  await t.route('POST', '/api/owner/location', {source: 'virtual', preset: 'oakland', verify: true});
  t.put(OWNER_SLOT, 'commons:benches', ['taxi_token', 'taxi_token']);
  const v0 = t.runtime.state().version;
  const first = await t.call('move', {to: 'oakland', mode: 'teleport', command_id: 'teleport-0001'});
  assert.equal(first.isError, false);
  assert.equal(first.structuredContent.place.id, 'bay:oakland');
  assert.equal(first.structuredContent.command.duplicate, false);
  assert.equal(t.muse(OWNER_SLOT).place, 'bay:oakland');
  assert.equal(tokens(t.muse(OWNER_SLOT)), 1, 'one token spent');
  const v1 = t.runtime.state().version;
  assert.ok(v1 > v0);
  // The same command again (a retry after a lost answer): the stored first result, nothing spent, no new event, same version.
  const again = await t.call('move', {to: 'oakland', mode: 'teleport', command_id: 'teleport-0001'});
  assert.equal(again.isError, false);
  assert.equal(again.structuredContent.command.duplicate, true);
  assert.deepEqual(again.structuredContent.place, first.structuredContent.place);
  assert.equal(again.structuredContent.envelope.message_id, first.structuredContent.envelope.message_id, 'the first envelope');
  assert.equal(tokens(t.muse(OWNER_SLOT)), 1, 'still one token');
  assert.equal(t.runtime.state().version, v1, 'no new commit');
  assert.equal(t.events('arrive').filter(e => e.tags.includes('teleport')).length, 1, 'one teleport arrival');
  // Different arguments under the same id: a conflict, not a second teleport.
  assert.equal((await t.call('move', {to: 'san-jose', mode: 'teleport', command_id: 'teleport-0001'})).structuredContent.refused, 'command_conflict');
  // A world-rule refusal is a stored result (mcp-tools command_id description): the same id after the condition changes returns
  // the same refusal; a new id acts.
  t.put(OWNER_SLOT, 'commons:benches', []);
  assert.equal((await t.call('move', {to: 'oakland', mode: 'teleport', command_id: 'teleport-0003'})).structuredContent.refused, 'no_taxi_token');
  t.edit(st => st.muses.find(m => m.id === OWNER_SLOT).inventory.push('taxi_token', 'taxi_token'));
  const same = await t.call('move', {to: 'oakland', mode: 'teleport', command_id: 'teleport-0003'});
  assert.deepEqual([same.structuredContent.refused, same.structuredContent.command.duplicate, tokens(t.muse(OWNER_SLOT))], ['no_taxi_token', true, 2]);
  assert.equal((await t.call('move', {to: 'oakland', mode: 'teleport', command_id: 'teleport-0004'})).isError, false);
  assert.equal(tokens(t.muse(OWNER_SLOT)), 1);
  // A new command id: the Muse is already there, so it is refused and spends nothing.
  const fresh = await t.call('move', {to: 'oakland', mode: 'teleport', command_id: 'teleport-0002'});
  assert.equal(fresh.structuredContent.refused, 'already_here');
  assert.equal(tokens(t.muse(OWNER_SLOT)), 1);
  assert.equal(t.events('arrive').filter(e => e.tags.includes('teleport')).length, 2);
});

test('AC3 following the owner: a resent verified location teleports once (the second time the Muse is already in the cell)', async () => {
  const t = await world();
  t.put(OWNER_SLOT, 'commons:benches', ['taxi_token', 'taxi_token']);
  const a = await t.route('POST', '/api/owner/location', {source: 'virtual', preset: 'san-jose', verify: true});
  assert.equal(a.body.follow.mode, 'teleport');
  const b = await t.route('POST', '/api/owner/location', {source: 'virtual', preset: 'san-jose', verify: true});
  assert.equal(b.body.follow.mode, 'roaming');
  assert.equal(tokens(t.muse(OWNER_SLOT)), 1);
  assert.equal(t.muse(OWNER_SLOT).place, 'bay:san-jose');
  // Already walking to an unverified cell; the owner turns verification on for the same cell: the Muse teleports instead of walking on.
  const w = await t.route('POST', '/api/owner/location', {source: 'virtual', preset: 'oakland'});
  assert.equal(w.body.follow.mode, 'walking');
  assert.ok(t.muse(OWNER_SLOT).travel);
  const v = await t.route('POST', '/api/owner/location', {source: 'virtual', preset: 'oakland', verify: true});
  assert.equal(v.body.follow.mode, 'teleport');
  assert.deepEqual([t.muse(OWNER_SLOT).place, t.muse(OWNER_SLOT).travel, tokens(t.muse(OWNER_SLOT))], ['bay:oakland', null, 0]);
  t.edit(st => st.muses.find(m => m.id === OWNER_SLOT).inventory.push('taxi_token'));
  // Unverified with a token: walks, spends nothing.
  const c = await t.route('POST', '/api/owner/location', {source: 'virtual', preset: 'hq'});
  assert.equal(c.body.follow.mode, 'walking');
  assert.equal(tokens(t.muse(OWNER_SLOT)), 1);
});

// ===================== AC4: presets, the always-on virtual location line, the GPS permission flow =====================
test('AC4 presets: HQ commons (default) and the seven Bay activity places of direction 11 / 13.1', () => {
  assert.deepEqual(PRESETS.map(p => p.label), ['HQ commons', 'Stanford', 'San Francisco', 'Oakland', 'San Mateo', 'Mountain View', 'Redwood City', 'San Jose']);
  assert.equal(PRESETS[0].place, 'commons:hq');
  const bay = PRESETS.slice(1).map(p => placeById(p.place));
  assert.ok(bay.every(p => p.zone === 'bay' && p.relic), 'each Bay preset is an activity place with its relic');
  assert.deepEqual(new Set(bay.map(p => p.id)), new Set(PLACES.filter(p => p.zone === 'bay' && p.kind === 'region').map(p => p.id)), 'every Bay place, once');
  assert.equal(new Set(PRESETS.map(p => placeCell(p.place))).size, 8, 'eight distinct cells');
});

test('AC4 always-on line: virtual location (demo), the owner destination and the Muse\'s own cell with a counting ETA; unknown is never assumed', () => {
  const view = {area: areaById('stanford'), source: 'virtual', preset: 'stanford', cell_label: 'Stanford', cell: placeCell('bay:stanford'), location: 'virtual (demo)', neighborhood_verified: false,
    muse: {id: OWNER_SLOT, place: {id: 'commons:benches', name: 'Bench Circle'}, at_owner_cell: false, travelling_to: {id: 'bay:stanford', name: 'Stanford'}, speed: 'walk', eta_ms: 42 * 60_000, arrive_at: T0 + 42 * 60_000}};
  const snap = snapshotOf(view, T0);
  const l = locationLine(snap, T0);
  // The owner's destination and the Muse's own current cell are told apart, also mid-trip (13.1).
  assert.equal(l.text, 'Virtual location (demo) · owner neighborhood: Stanford · Jolly at Bench Circle → Stanford, walking, 42 min');
  assert.match(l.title, /Owner neighborhood Stanford: 1500 m/);
  assert.match(l.title, /current place: Bench Circle/);
  assert.match(locationLine(snap, T0 + 30 * 60_000).text, /12 min$/, 'the ETA counts down between answers');
  assert.match(locationLine(snap, T0 + 43 * 60_000).text, /Jolly at Bench Circle → Stanford, walking, arriving$/);
  assert.equal(museLine(snapshotOf({...view, muse: {...view.muse, speed: 'bus', eta_ms: 8 * 60_000}}, T0), T0), 'Jolly at Bench Circle → Stanford, bus, 8 min');
  assert.match(locationLine(snapshotOf({...view, neighborhood_verified: true, muse: {...view.muse, place: {id: 'bay:stanford', name: 'Stanford'}, at_owner_cell: true, in_owner_area: true, travelling_to: null, speed: null, eta_ms: null}}, T0), T0).text, /owner neighborhood: Stanford \(verified\) · Jolly at Stanford · in your neighborhood/);
  assert.match(locationLine(snap, T0, 'HTTP 503').text, /not updating$/, 'a failure keeps the last answer and says so');
  const none = locationLine(null, T0, 'HTTP 503');
  assert.equal(none.state, 'unknown'); assert.doesNotMatch(none.text, /HQ/);
  // Mounted in the header for the whole page (story and world), and no style hides it.
  const panel = readFileSync(new URL('../src/ui/world-panel.ts', import.meta.url), 'utf8'), css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(panel, /mountLocationChip\(header, spot\)/);
  // The chip's answer is applied when it arrives; the rest of the refresh does not wait for it (and nothing is applied during a replay).
  assert.match(panel, /if \(!isolation\.replay\) \{locChip\.update\(lr\); paintOwnerArea\(\);\}/);
  assert.ok(!/await\s+locReq|await load<OwnerLocationView>/.test(panel), 'refresh does not wait for the location answer');
  // The open Location tab is drawn again on polls and after a move (refresh), unless one of its controls is in use.
  assert.match(panel, /tab === 'location' && !ret\) \{\n\s+const f = document\.activeElement, inUse = /);
  assert.ok(!/\.loc-chip[^{}]*\{[^}]*display:\s*none/.test(css) && !/loc-chip\s*\{\s*display:\s*none/.test(css), 'no rule hides the location chip');
  // The map-error note sits under the measured header (with the chip in it), not at a fixed 92 px (scripts/location.browser.js measures it).
  const tops = [...css.matchAll(/#network-note\{([^}]*)\}/g)].map(m => m[1]).filter(r => /(^|;)top:/.test(r));
  assert.ok(tops.at(-1)?.includes('top:calc(var(--header-h'), 'the last #network-note top places it under the header: ' + tops.at(-1));
});

test('AC4 privacy and MCP docs say what the code does: device location stays on the device; rule refusals are stored command results', () => {
  const privacy = readFileSync(new URL('../static/privacy.html', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.ok(privacy.includes(`nearest of eight neighborhood areas (the HQ commons and seven Bay Area neighborhoods), using a ${NEIGHBORHOOD_KM} km proximity limit`), 'radius and preset count match location.ts');
  assert.equal(PRESETS.length, 8);
  assert.ok(privacy.includes('The coordinates are not sent to Musely and not stored, and the result does not verify a neighborhood'));
  assert.ok(privacy.includes('<code>POST /api/owner/location</code> with <code>source: "gps"</code>') && privacy.includes('accepts only a locally mapped neighborhood preset id, never raw coordinates'));
  for (const f of ['../worker/core/mcp-tools.ts', '../docs/MCP_TOOLS.md']) {
    const doc = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(/A call the world rules refuse \(for example `?no_taxi_token`? or `?already_here`?\) is a stored result/.test(doc) && /use a new `?command_id`?/.test(doc), f);
    assert.ok(!doc.includes('A refused call spends nothing'), f + ': the old, too broad sentence is gone');
  }
});

test('AC4 GPS mapping: only the nearest preset within the neighborhood radius survives; outside the Bay it is null', () => {
  assert.equal(nearestPreset(37.4275, -122.1697), 'stanford');
  assert.equal(nearestPreset(37.7793, -122.4192), 'san-francisco');
  assert.equal(nearestPreset(37.3394, -121.8950), 'san-jose');
  assert.equal(nearestPreset(37.4836, -122.1499), 'hq');
  assert.equal(nearestPreset(37.5665, 126.9780), null, 'Seoul is outside every preset');
  assert.equal(nearestPreset(36.6, -121.9), null, `Monterey is farther than ${NEIGHBORHOOD_KM} km from every preset`);
  for (const bad of [[NaN, 1], [1, Infinity], [91, 0], [0, 181]]) assert.equal(nearestPreset(...bad), null);
});

test('AC4 GPS permission flow: denied, unavailable, timeout, no answer and no service all fall back to the virtual location; a late answer is ignored', () => {
  // Pure transitions.
  const r0 = deviceStart(DEVICE_IDLE, true, 1);
  assert.equal(r0.status, 'requesting');
  assert.equal(deviceStart(r0, true, 2), r0, 'a running request is kept');
  assert.equal(deviceStart(DEVICE_IDLE, false, 1).status, 'unsupported');
  assert.deepEqual([1, 2, 3, 99].map(code => deviceResult(r0, 1, {ok: false, code}, 5).status), ['denied', 'unavailable', 'timeout', 'unavailable']);
  const near = deviceResult(r0, 1, {ok: true, lat: 37.4275, lng: -122.1697}, 5);
  assert.deepEqual([near.status, near.preset], ['near', 'stanford']);
  assert.ok(!/37\.4|122\.1/.test(JSON.stringify(near)), 'no coordinate in the state');
  assert.equal(deviceResult(r0, 1, {ok: true, lat: 37.5665, lng: 126.978}, 5).status, 'outside');
  assert.equal(deviceWatchdog(r0, 1, 9).status, 'timeout');
  assert.equal(deviceResult(deviceWatchdog(r0, 1, 9), 1, {ok: true, lat: 37.4275, lng: -122.1697}, 10).status, 'timeout', 'late answer after the watchdog');
  for (const s of ['denied', 'unavailable', 'timeout', 'unsupported', 'outside']) {
    const txt = deviceText({status: s, preset: null, startedAt: null, at: 1});
    assert.equal(txt.fallback, true, s); assert.ok(txt.detail.includes(VIRTUAL_FALLBACK), s);
  }
  assert.match(deviceText(near).detail, /does not verify your neighborhood/, 'GPS does not verify (phase 2)');
  assert.equal(deviceText(near).fallback, false);
});

test('AC4 GPS driver with a fake navigator.geolocation: coarse options, one request at a time, watchdog, and nothing sent', () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the device location flow must not call the network'); };
  try {
    let pending = null, asked = 0, timers = [];
    const geo = {getCurrentPosition(ok, fail, opts) { asked++; pending = {ok, fail, opts}; }};
    const deps = {now: () => 1000, setTimer: (fn, ms) => { timers.push({fn, ms}); return timers.length; }, clearTimer: () => {}};
    const seen = [];
    const flow = deviceLocation(geo, d => seen.push(d.status), deps);
    flow.request(); flow.request();
    assert.equal(asked, 1, 'a second press while asking sends no second request');
    assert.equal(pending.opts.enableHighAccuracy, false);
    assert.equal(timers[0].ms, GEO_WATCHDOG_MS);
    assert.equal(GEO_WATCHDOG_MS, 60_000, 'a minute for a person to answer the browser prompt');
    pending.fail({code: 1});
    assert.equal(flow.state.status, 'denied');
    flow.request(); pending.ok({coords: {latitude: 37.4275, longitude: -122.1697}});
    assert.deepEqual([flow.state.status, flow.state.preset], ['near', 'stanford']);
    flow.request(); timers.at(-1).fn();
    assert.equal(flow.state.status, 'timeout', 'a prompt nobody answers ends as a timeout');
    pending.ok({coords: {latitude: 37.4275, longitude: -122.1697}});
    assert.equal(flow.state.status, 'timeout', 'its late answer is ignored');
    assert.deepEqual(seen, ['requesting', 'denied', 'requesting', 'near', 'requesting', 'timeout']);
    const none = deviceLocation(undefined, () => {}, deps); none.request();
    assert.equal(none.state.status, 'unsupported');
    const throws = deviceLocation({getCurrentPosition() { throw new Error('insecure context'); }}, () => {}, deps); throws.request();
    assert.equal(throws.state.status, 'unavailable');
  } finally { globalThis.fetch = realFetch; }
  // The page asks the real browser API, and neither location module posts anything.
  const bar = readFileSync(new URL('../src/ui/location-bar.ts', import.meta.url), 'utf8'), st = readFileSync(new URL('../src/ui/location-state.ts', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/ui/world-panel.ts', import.meta.url), 'utf8');
  assert.match(bar, /navigator\.geolocation/);
  // The panel only mounts the card: the statement that places it, and nothing in the panel reads a position.
  const mount = panel.split('\n').filter(l => l.includes('deviceLocationCard'));
  assert.equal(mount.length, 2, 'one import and one mount');
  assert.ok(!/geolocation|coords|latitude|longitude/.test(panel), 'the panel never touches the device position');
  const SENDS = /fetch\(|fetchJson|sendBeacon|XMLHttpRequest|WebSocket|EventSource|new Image|console\.|localStorage|sessionStorage|indexedDB/;
  assert.ok(!SENDS.test(bar + st + mount.join('\n')), 'no request, log or storage in the device location path');
});
