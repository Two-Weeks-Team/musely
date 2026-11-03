import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/engine/location.ts';
import {PLACES, placeById, distanceM} from '../src/engine/places.ts';
import {createWorld, tick, TICK_MS, OWNER_MUSE} from '../src/engine/world.ts';
import {followOwner, beginTrip} from '../src/engine/travel.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {publicState, PRIVATE} from '../worker/core/run-log.ts';
import {ownerView} from '../worker/core/mcp-tools.ts';
import {locationLine, snapshotOf, museLine} from '../src/ui/location-state.ts';
import {assertCompatible} from '../src/replay/player.ts';
import {currentVersions} from '../src/replay/versions.ts';
import {existsSync} from 'node:fs';
import {speedFor} from '../src/engine/items.ts';
const T0 = Date.parse('2026-11-03T16:00:00Z');
const jolly = s => s.muses.find(m => m.id === OWNER_MUSE);

test('eight owner neighborhoods expose a bounded area and multiple places, not a single spot', () => {
  assert.equal(typeof L.areaById, 'function', 'area catalog is missing');
  for (const p of L.PRESETS) {
    const a = L.areaById(p.id);
    assert.equal(a.id, p.id); assert.equal(a.radiusM, 1500);
    assert.ok(a.placeIds.length >= 3, `${p.id}: needs multiple activities`);
    assert.ok(a.placeIds.includes(p.place));
    for (const id of a.placeIds) {
      assert.ok(L.areaContains(a, id));
      assert.ok(distanceM(placeById(id), placeById(p.place)) <= a.radiusM + 1);
    }
    const legacy = {...L.defaultOwner(OWNER_MUSE, T0), preset: p.id, target: p.place, cell: L.placeCell(p.place)};
    delete legacy.area;
    assert.equal(L.ownerArea(legacy).id, p.id);
    assert.equal(L.ownerArea({...legacy, source: 'gps', preset: null, area: undefined}).id, p.id, 'legacy GPS catalog target resolves without reading coordinates');
  }
});

test('raw coordinates are refused; only the browser-mapped GPS neighborhood id may reach the server', () => {
  const prev = L.defaultOwner(OWNER_MUSE, T0);
  for (const source of ['gps', 'virtual']) {
    assert.equal(L.nextOwnerLocation(prev, {source, preset: 'hq', lat: 37.48, lng: -122.15}, T0).ok, false);
  }
  const mapped = L.nextOwnerLocation(prev, {source: 'gps', preset: 'stanford'}, T0);
  assert.equal(mapped.ok, true); assert.equal(mapped.owner.area, 'stanford');
  assert.equal(mapped.owner.verified, false);
  assert.equal(L.nextOwnerLocation(prev, {source: 'gps', preset: 'stanford', verify: true}, T0).ok, false);
  assert.equal(L.nearestPreset(37.4275, -122.1697), 'stanford');
  assert.equal(L.nearestPreset(37.5665, 126.978), null);
  assert.equal(publicState({...createWorld('private', T0), owner: mapped.owner}).owner.area, PRIVATE);
});

test('old cell verification does not silently become verification of an expanded neighborhood', () => {
  const old = {...L.defaultOwner(OWNER_MUSE, T0), verified: true}; delete old.area;
  const next = L.nextOwnerLocation(old, {source: 'virtual', preset: 'hq'}, T0 + 1);
  assert.equal(next.owner.verified, false);
  assert.equal(L.teleportCheck(old, {id: OWNER_MUSE, inventory: ['taxi_token'], place: 'bay:sf'}, placeById('commons:hq')), 'neighborhood_not_verified');
});

test('a Muse freely visits multiple places within each owner area, always walking even with transport items', () => {
  assert.equal(typeof L.ownerArea, 'function', 'area roaming is missing');
  for (const p of L.PRESETS) {
    let s = createWorld(`area-${p.id}`, T0);
    s.owner = L.nextOwnerLocation(s.owner, {source: 'virtual', preset: p.id, verify: true}, T0).owner;
    Object.assign(jolly(s), {place: p.place, inventory: ['transit_pass', 'taxi_token'], beat: null});
    assert.equal(followOwner(s, T0, () => {}, {} ).mode, 'roaming');
    const a = L.ownerArea(s.owner), visited = new Set([p.place]), departures = [];
    for (let i = 1; i <= 360; i++) {
      const r = tick(s, {now: T0 + i * TICK_MS}, {speedFor: () => 'taxi'});
      s = r.state; visited.add(jolly(s).place);
      departures.push(...r.events.filter(e => e.muse === OWNER_MUSE && e.kind === 'depart'));
    }
    assert.ok(visited.size >= 2, `${p.id} stuck at owner spot`);
    assert.ok(departures.length >= 1);
    assert.ok([...visited].every(id => L.areaContains(a, id)), `${p.id} escaped area`);
    assert.ok(departures.every(e => e.data.speed === 'walk'), `${p.id} used transport inside area`);
    assert.ok(departures.every(e => L.areaContains(a, e.data.to)), `${p.id} chose a destination outside the area`);
    assert.equal(jolly(s).inventory.filter(x => x === 'taxi_token').length, 1);
  }
});

test('internal explicit/follow trips preserve walking and a running local trip; cross-area items retain their role', () => {
  assert.equal(typeof L.areaById, 'function');
  const s = createWorld('travel-area', T0), m = jolly(s), a = L.areaById('hq');
  const to = a.placeIds.map(placeById).find(p => distanceM(placeById(m.place), p) > 250);
  assert.ok(to); m.inventory = ['transit_pass', 'taxi_token'];
  assert.equal(speedFor(m.inventory, placeById(m.place), to, true), 'walk', 'the low-level item rule also respects neighborhood walking');
  assert.equal(beginTrip(m, to, T0, 'live', () => {}, 'test').speed, 'walk');
  const before = structuredClone(m.travel);
  followOwner(s, T0 + 1, () => {}, makeHooks());
  assert.deepEqual(m.travel, before);
  m.travel = null;
  assert.equal(beginTrip(m, placeById('bay:stanford'), T0, 'live', () => {}, 'test').speed, 'bus');
  s.paused = {[m.id]: {at: T0, version: 0, by: 'owner'}};
  m.travel.arriveAt = T0 + TICK_MS;
  const stopped = structuredClone(m);
  assert.equal(followOwner(s, T0 + 2, () => {}, {}).mode, 'paused');
  const after = tick(s, {now: T0 + 3 * TICK_MS}).state;
  assert.deepEqual(jolly(after).travel, stopped.travel);
});

test('owner area and Muse current place have distinct read DTO and display even across a grid-cell boundary', () => {
  const s = createWorld('area-view', T0), m = jolly(s);
  const area = L.areaById('hq');
  m.place = area.placeIds.find(id => L.placeCell(id) !== s.owner.cell);
  assert.ok(m.place, 'an area spans grid cells');
  const view = ownerView(s.owner, m, T0);
  assert.equal(view.area?.id, 'hq'); assert.equal(view.muse.in_owner_area, true);
  const snap = snapshotOf(view, T0), line = locationLine(snap, T0);
  assert.match(line.text, /owner neighborhood: HQ commons/);
  assert.match(museLine(snap, T0), /in your neighborhood/);
  assert.doesNotMatch(line.text, /with the owner/);
  assert.match(line.title, /1500 m/);
});

test('an idle connected owner may stroll by rule; other connected Muses and active commitments retain their authority', () => {
  const s = createWorld('area-connected', T0), m = jolly(s);
  s.inbox.connected[m.id] = T0;
  s.inbox.connected['01-sunny'] = T0;
  let state = s; const visits = new Set([m.place]), log = [];
  for (let i = 1; i <= 120; i++) {const r = tick(state, {now: T0 + i * TICK_MS}); state = r.state; visits.add(jolly(state).place); log.push(...r.events);}
  assert.ok(visits.size >= 2, 'connected owner must not freeze for its 24h connection');
  assert.equal(state.muses.find(x => x.id === '01-sunny').place, 'commons:cafe');
  const ownTrips = log.filter(e => e.muse === m.id && e.kind === 'depart');
  assert.ok(ownTrips.length > 0 && ownTrips.every(e => e.source === 'rule' && e.data.speed === 'walk'));
  for (const guard of ['intent', 'incoming', 'task', 'invite', 'paused']) {
    const guarded = structuredClone(s);
    if (guard === 'intent') jolly(guarded).intent = {kind: 'greet', target: '02-moss'};
    if (guard === 'incoming') guarded.muses.find(x => x.id === '02-moss').intent = {kind: 'greet', target: m.id};
    if (guard === 'task') guarded.inbox.tasks.push({id: 't', status: 'pending', from: m.id, to: '02-moss', deadline: T0 + 3600_000});
    if (guard === 'invite') (guarded.inbox.invites ??= []).push({id: 'i', from: m.id, to: ['02-moss'], status: 'open', expiresAt: T0 + 3600_000, answers: {}});
    if (guard === 'paused') guarded.paused = {[m.id]: {at: T0, version: 0, by: 'owner'}};
    const r = tick(guarded, {now: T0 + 20 * TICK_MS});
    assert.equal(r.events.filter(e => e.muse === m.id && e.kind === 'depart').length, 0, guard);
  }
});

test('old engine-2 checkpoint records retain their exact version while unknown or mixed versions are refused', () => {
  const old = {schemaVersion: 'run-log-2', engineVersion: 'engine-2', harnessVersion: 'harness-c0c69e98b5e8', catalogVersion: 'catalog-d69858ec160f'};
  assert.doesNotThrow(() => assertCompatible(old));
  assert.throws(() => assertCompatible({...old, catalogVersion: currentVersions().catalogVersion}), /incompatible_record/);
  assert.throws(() => assertCompatible({...old, engineVersion: 'engine-unknown'}), /incompatible_record/);
  assert.throws(() => assertCompatible(old, currentVersions()), /incompatible_record/);
});

test('the map presents a closed owner area boundary with a separate label and hides it for replay', async () => {
  const path = new URL('../src/ui/area-map.ts', import.meta.url);
  assert.ok(existsSync(path), 'area map renderer is missing');
  const {areaGeometry, mountOwnerArea} = await import(path);
  const geometry = areaGeometry(L.areaById('hq'), 'virtual');
  const ring = geometry.features[0].geometry.coordinates[0];
  assert.equal(ring.length, 65); assert.deepEqual(ring[0], ring.at(-1));
  assert.match(geometry.features[1].properties.label, /Owner neighborhood/);
  const sources = new Map(), layers = new Map(); let loaded = true;
  const map = {isStyleLoaded: () => loaded, on() {}, addSource(id, s) {sources.set(id, {...s, setData(d) {this.data = d;}});}, getSource: id => sources.get(id), addLayer(l) {layers.set(l.id, l);}, getLayer: id => layers.get(id)};
  const overlay = mountOwnerArea(map);
  overlay.update({area: L.areaById('hq'), source: 'virtual'}, true);
  assert.equal(sources.get('owner-neighborhood').data.features.length, 2);
  assert.ok(layers.has('owner-neighborhood-fill') && layers.has('owner-neighborhood-line'));
  loaded = false; // A mode/camera change can leave tiles loading; hiding must still be synchronous.
  overlay.update(null, false);
  assert.equal(sources.get('owner-neighborhood').data.features.length, 0, 'replay must not show the live owner location');
});
