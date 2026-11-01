import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld, tick, spotlightFor, spotlightInput, unlockedFreedoms, localClock, TICK_MS} from '../src/engine/world.ts';
import {PLACES} from '../src/engine/places.ts';
import {BEATS} from '../src/engine/beats.ts';

const T0 = Date.parse('2026-11-03T16:00:00Z'); // 08:00 in Menlo Park (PST)
const run = (n, decide = () => null, start = T0) => {
  let s = createWorld('test-world', start); const log = [];
  for (let i = 0; i < n; i++) { const r = tick(s, {now: start + i * TICK_MS, decision: decide(s, start + i * TICK_MS)}); s = r.state; log.push(...r.events); }
  return {s, log};
};

test('the scenario replays identically from the day seed (no model calls)', () => {
  const a = run(240), b = run(240);
  assert.deepEqual(a.log, b.log);
  assert.deepEqual(a.s, b.s);
  assert.ok(a.log.length > 300, 'the world is busy: ' + a.log.length + ' events');
  const kinds = new Set(a.log.map(e => e.kind));
  for (const k of ['spotlight', 'beat', 'depart', 'arrive', 'encounter']) assert.ok(kinds.has(k), 'has ' + k);
  assert.ok(a.log.every(e => ['live', 'rule', 'scripted', 'replay'].includes(e.source)), 'every event carries a source');
  assert.notDeepEqual(run(240, () => null, T0 + 86_400_000).log.map(e => e.kind + e.muse), a.log.map(e => e.kind + e.muse), 'another day differs');
});

test('Muses leave the commons for real places at walking speed', () => {
  const {log} = run(300);
  const trips = log.filter(e => e.kind === 'depart');
  assert.ok(trips.some(e => e.data.to.startsWith('osm:')), 'some trips go to real OSM places');
  for (const t of trips) if (t.data.speed === 'walk') assert.ok(t.data.etaMs >= (t.data.distanceM - 1) / 1.3 * 1000, 'walking speed: ' + JSON.stringify(t.data));
});

test('spotlight rotates through every Muse; freedoms unlock through the day', () => {
  let s = createWorld('w', T0); const seen = [];
  for (let i = 0; i < 10; i++) { seen.push(spotlightFor(s, T0 + i * TICK_MS).muse); s = tick(s, {now: T0 + i * TICK_MS}).state; }
  assert.equal(new Set(seen).size, 10);
  assert.deepEqual(unlockedFreedoms(8), ['where']);
  assert.deepEqual(unlockedFreedoms(20), ['where', 'who', 'offer', 'plan']);
  assert.equal(localClock(T0).hhmm, '08:00');
});

test('a live decision is validated, applied, and marked off-script; invalid ones are rejected and logged', () => {
  const s = createWorld('w', T0);
  const spot = spotlightFor(s, T0);
  const input = spotlightInput(s, spot.muse, spot.freedom, T0);
  assert.ok(input.places.length > 0 && input.places.length <= 8);
  const target = input.places.at(-1).name;
  const ok = tick(s, {now: T0, decision: {muse: spot.muse, freedom: spot.freedom, source: 'live', output: {decision: 'go', target_place: target, target_agent: '', offer_item: '', want_item: '', public_reason: 'it is near', line: 'Off I go'}, evidence: {requestId: 'r1'}}});
  const ev = ok.events.find(e => e.kind === 'spotlight');
  assert.equal(ev.source, 'live');
  assert.equal(ev.data.evidence.requestId, 'r1');
  assert.ok(ok.events.some(e => e.kind === 'depart' && e.muse === spot.muse && e.source === 'live'));
  const bad = tick(s, {now: T0, decision: {muse: spot.muse, freedom: spot.freedom, source: 'live', output: {decision: 'x', target_place: 'Atlantis', target_agent: '', offer_item: '', want_item: '', public_reason: '', line: ''}}});
  assert.equal(bad.events.find(e => e.kind === 'decision_rejected').data.reason, 'unknown place: Atlantis');
  const wrongMuse = tick(s, {now: T0, decision: {muse: '09-copper' === spot.muse ? '01-sunny' : '09-copper', freedom: spot.freedom, source: 'live', output: {}}});
  assert.ok(wrongMuse.events.some(e => e.kind === 'decision_rejected'));
});

test('recorded decisions replay to the same world', () => {
  const decisions = new Map();
  const live = run(60, (s, now) => { const sp = spotlightFor(s, now); if (sp.freedom !== 'where' || s.tick % 7) return null; const d = {muse: sp.muse, freedom: 'where', source: 'live', output: {decision: 'go', target_place: spotlightInput(s, sp.muse, 'where', now).places[0].name, target_agent: '', offer_item: '', want_item: '', public_reason: 'near', line: ''}}; decisions.set(s.tick, d); return d; });
  const replay = run(60, s => decisions.has(s.tick) ? {...decisions.get(s.tick), source: 'live'} : null);
  assert.deepEqual(replay.log, live.log);
  assert.ok(decisions.size > 3);
});

test('beats only use known places and real-time durations', () => {
  const kinds = new Set(PLACES.map(p => p.kind));
  for (const b of BEATS) { assert.ok(b.kinds.some(k => kinds.has(k)), b.id); assert.ok(b.minutes >= 3 && b.minutes <= 60, b.id); }
  assert.ok(PLACES.filter(p => p.zone === 'neighborhood').length >= 70);
  assert.equal(PLACES.filter(p => p.zone === 'bay').length, 7);
});
