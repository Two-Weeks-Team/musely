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

test('a Muse that chose a place by itself stays there for a beat after arriving', () => {
  let s = createWorld('stay', T0);
  const spot = spotlightFor(s, T0), target = spotlightInput(s, spot.muse, spot.freedom, T0).places[0].name;
  s = tick(s, {now: T0, decision: {muse: spot.muse, freedom: spot.freedom, source: 'live', output: {decision: 'go', target_place: target, target_agent: '', offer_item: '', want_item: '', public_reason: '', line: ''}}}).state;
  for (let i = 1; i < 30; i++) {
    const r = tick(s, {now: T0 + i * TICK_MS}); s = r.state;
    const arrive = r.events.find(e => e.kind === 'arrive' && e.muse === spot.muse);
    if (arrive) {
      assert.equal(arrive.data.chosen, true);
      assert.ok(r.events.some(e => e.kind === 'beat' && e.muse === spot.muse), 'starts a beat there');
      assert.ok(!r.events.some(e => e.kind === 'depart' && e.muse === spot.muse), 'does not leave on arrival');
      return;
    }
  }
  assert.fail('never arrived');
});

test('wants: harness defaults, validated updates, Spark adds a wanted item, old state is backfilled', async () => {
  const {updateWants} = await import('../src/engine/world.ts');
  const s = createWorld('wants', T0);
  const ripple = s.muses.find(m => m.id === '03-ripple');
  assert.equal(ripple.wants.source, 'harness');
  assert.ok(ripple.wants.items.includes('transit_pass'));
  assert.match(updateWants(ripple, {items: ['not_an_item']}, 'connected', T0), /catalog/);
  assert.match(updateWants(ripple, {items: ['a', 'b', 'c', 'd', 'e'].map(() => 'coffee').concat('tea', 'fruit', 'spark', 'pastry')}, 'connected', T0), /up to 4/);
  assert.equal(updateWants(ripple, {goal: '<b>Ride</b> the 296 bus\n'}, 'connected', T0), null);
  assert.equal(ripple.wants.goal, 'b Ride /b the 296 bus', 'no markup, single line');
  assert.equal(ripple.wants.source, 'connected');
  // Spark: an offer decision with a want_item adds it to the Muse's wants.
  const s2 = createWorld('wants2', T0 + 9 * 3600_000);
  let st = s2;
  for (let i = 0; i < 40; i++) {
    const now = T0 + 9 * 3600_000 + i * TICK_MS, sp = spotlightFor(st, now);
    if (sp.freedom !== 'offer') { st = tick(st, {now}).state; continue; }
    const me = st.muses.find(m => m.id === sp.muse), other = st.muses.find(m => m.id !== sp.muse);
    const r = tick(st, {now, decision: {muse: sp.muse, freedom: 'offer', source: 'live', output: {decision: 'trade', target_place: '', target_agent: other.id, offer_item: me.inventory[0] ?? '', want_item: 'night_pass', public_reason: '', line: ''}}});
    if (me.inventory[0]) { assert.equal(r.state.muses.find(m => m.id === sp.muse).wants.items[0], 'night_pass'); assert.equal(r.state.muses.find(m => m.id === sp.muse).wants.source, 'spark'); return; }
    st = r.state;
  }
  // Backfill: a state saved before wants existed gets harness wants on the next tick.
  const old = createWorld('old', T0); for (const m of old.muses) delete m.wants;
  assert.ok(tick(old, {now: T0}).state.muses.every(m => m.wants?.items.length));
});

// ---------- I-05: visitor priority and the other Muse's answer ----------
const hold = (s, pairs) => {
  // Every Muse at its own place, busy with a long beat (no trip, no new beat); `pairs` share a place and meet.
  const spare = PLACES.filter(p => p.zone === 'neighborhood').map(p => p.id);
  s.muses.forEach((m, k) => { m.place = spare[k]; m.travel = null; m.intent = null; m.beat = {id: 'hold', clip: 'idle', startedAt: T0, endsAt: T0 + 3_600_000, line: null}; });
  for (const [a, b, place] of pairs) for (const id of [a, b]) s.muses.find(m => m.id === id).place = place;
  return s;
};

test('I-05 visitor priority: a queued Muse takes the next spotlight ahead of the rotation, then the rotation resumes', async () => {
  const {requestSpotlight} = await import('../src/engine/world.ts');
  let s = createWorld('queue', T0);
  assert.equal(spotlightFor(s, T0).muse, '00-jolly', 'rotation starts at the cursor');
  assert.deepEqual(requestSpotlight(s, '07-tempo'), {ok: true, position: 1});
  assert.deepEqual(spotlightFor(s, T0), {muse: '07-tempo', freedom: 'where', priority: true}, 'the queue goes first');
  const r = tick(s, {now: T0});
  assert.ok(r.events.some(e => e.kind === 'spotlight' && e.muse === '07-tempo'));
  s = r.state;
  assert.deepEqual(s.spotlight.visitorQueue, [], 'the priority turn leaves the queue');
  assert.equal(spotlightFor(s, T0 + TICK_MS).muse, '00-jolly', 'the rotation was not skipped');
  assert.equal(spotlightFor(s, T0 + TICK_MS).priority, false);
  // Ten rotation turns after the priority turn still reach every Muse once.
  const seen = [];
  for (let i = 1; i <= 10; i++) { seen.push(spotlightFor(s, T0 + i * TICK_MS).muse); s = tick(s, {now: T0 + i * TICK_MS}).state; }
  assert.equal(new Set(seen).size, 10);
});

test('I-05 visitor priority: duplicates keep their place, the queue is capped, a paused Muse is never queued or picked', async () => {
  const {requestSpotlight, pauseMuse, SPOTLIGHT_QUEUE_MAX} = await import('../src/engine/world.ts');
  const s = createWorld('queue2', T0);
  assert.equal(requestSpotlight(s, '03-ripple').ok, true);
  assert.deepEqual(requestSpotlight(s, '03-ripple'), {ok: false, reason: 'already_queued', position: 1});
  assert.deepEqual(s.spotlight.visitorQueue, ['03-ripple'], 'no duplicate entry');
  for (const id of ['04-ember', '05-bloom', '06-ink', '07-tempo']) assert.equal(requestSpotlight(s, id).ok, true);
  assert.equal(s.spotlight.visitorQueue.length, SPOTLIGHT_QUEUE_MAX);
  assert.deepEqual(requestSpotlight(s, '08-orbit'), {ok: false, reason: 'queue_full'});
  assert.deepEqual(requestSpotlight(s, 'not-a-muse'), {ok: false, reason: 'unknown_muse'});
  // Revoked while waiting: it leaves the queue, and the next queued Muse is picked instead.
  pauseMuse(s, '03-ripple', {at: T0, version: 2, by: 'owner'});
  assert.ok(!s.spotlight.visitorQueue.includes('03-ripple'));
  assert.equal(spotlightFor(s, T0).muse, '04-ember');
  assert.deepEqual(requestSpotlight(s, '03-ripple'), {ok: false, reason: 'paused'});
  // Even a stale stored queue that still names a paused Muse never gives it a turn.
  s.spotlight.visitorQueue.unshift('03-ripple');
  assert.equal(spotlightFor(s, T0).muse, '04-ember');
  const after = tick(s, {now: T0});
  assert.ok(!after.events.some(e => e.muse === '03-ripple' && e.kind === 'spotlight'));
  assert.ok(!after.state.spotlight.visitorQueue.includes('03-ripple'), 'the paused entry is dropped');
});

test('I-05 encounter answers: a recorded live answer keeps its source and evidence; otherwise a rule answer with its reason', async () => {
  const {encounterId} = await import('../src/engine/world.ts');
  const s = hold(createWorld('answers', T0), [['02-moss', '05-bloom', 'commons:garden']]);
  const id = encounterId(s, '02-moss', '05-bloom');
  const answer = (muse, other) => ({muse, other, place: 'commons:garden', encounterId: id, source: 'live', output: {intent: 'gift', item: '', line: 'The roses are out', public_reason: 'we both tend this garden', injection_suspected: false}, evidence: {model: 'muse-spark-1.3', requestId: 'req-enc'}});
  // Pure scenario run: the meeting happens, with its id, and nobody answers for anyone.
  const plain = tick(s, {now: T0});
  const meet = plain.events.find(e => e.kind === 'encounter');
  assert.equal(meet.data.encounterId, id);
  assert.ok(!plain.events.some(e => e.kind === 'encounter_reply'));
  // A live answer for this meeting: source live, model evidence, and the answering Muse's reflection.
  const live = tick(s, {now: T0, replies: [answer('02-moss', '05-bloom'), answer('05-bloom', '02-moss')]});
  const said = live.events.filter(e => e.kind === 'encounter_reply');
  assert.equal(said.length, 1, 'one answer per meeting');
  assert.equal(said[0].muse, meet.other, 'the other Muse answers');
  assert.equal(said[0].source, 'live');
  assert.equal(said[0].data.evidence.requestId, 'req-enc');
  assert.match(live.state.muses.find(m => m.id === meet.other).reflection, /we both tend this garden/);
  // No live answer: a rule answer that says why and carries no model evidence.
  const rule = tick(s, {now: T0, replies: [{muse: meet.other, other: meet.muse, place: 'commons:garden', encounterId: id, source: 'rule', output: null, reason: 'budget'}]});
  const r = rule.events.find(e => e.kind === 'encounter_reply');
  assert.equal(r.source, 'rule');
  assert.equal(r.data.reason, 'budget');
  assert.equal(r.data.evidence, undefined);
  assert.equal(tick(s, {now: T0, replies: []}).events.find(e => e.kind === 'encounter_reply').data.reason, 'no_answer_requested');
});
