import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPlayer, SPEEDS, EMPTY_FILTER, matchFilter, visibleEvents, formatT} from '../src/ui/replay-core.ts';
import {HARNESS_IDS} from '../src/engine/harness.ts';
import {PLACES} from '../src/engine/places.ts';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));

test('clock advances by the chosen speed and speed changes do not move the cursor', () => {
  assert.deepEqual(SPEEDS, [1, 10, 60]);
  for (const speed of SPEEDS) { const p = createPlayer(1800, () => 0); p.setSpeed(speed); p.play(); p.advance(1000); assert.equal(p.getState().cursor, speed); p.setSpeed(10); assert.equal(p.getState().cursor, speed); p.pause(); p.advance(2000); assert.equal(p.getState().cursor, speed); }
});
test('end, replay, backward seek, restart and returned state are safe', () => {
  const p = createPlayer(30); p.play(); p.advance(60_000);
  assert.deepEqual(p.getState(), {cursor: 30, playing: false, speed: 1, durationSec: 30, ended: true});
  p.play(); assert.equal(p.getState().cursor, 0); assert.equal(p.getState().playing, true);
  p.seek(100); assert.equal(p.getState().ended, true); assert.equal(p.getState().playing, false);
  p.seek(10); assert.equal(p.getState().ended, false); p.play(); p.restart(); assert.equal(p.getState().cursor, 0); assert.equal(p.getState().playing, false);
  p.seek(-100); assert.equal(p.getState().cursor, 0);
  const copy = p.getState(); copy.cursor = 200; assert.equal(p.getState().cursor, 0);
  p.play(); p.advance(-1000); p.advance(NaN); assert.equal(p.getState().cursor, 0);
});
test('formatT and visible events are a read-only time projection, including rewind', () => {
  assert.equal(formatT(245.9), '4:05'); assert.equal(formatT(0), '0:00');
  const events = [{id: '1', t: 0}, {id: '2', t: 10}];
  assert.deepEqual(visibleEvents(events, 10), events); assert.deepEqual(visibleEvents(events, 9), [events[0]]); assert.equal(events.length, 2);
});
test('filters match tags, either participant, place and Los Angeles time with AND semantics', () => {
  const e = {tags: ['first_trade'], muse: '00-jolly', other: '03-ripple', place: 'commons:cafe', at: Date.parse('2026-11-01T17:00:00Z')};
  assert.equal(matchFilter(e, EMPTY_FILTER), true);
  for (const f of [{tag: 'first_trade'}, {muse: '03-ripple'}, {place: 'commons:cafe'}, {part: 'morning'}, {tag: 'first_trade', muse: '00-jolly', part: 'morning', place: 'commons:cafe'}]) assert.equal(matchFilter(e, {...EMPTY_FILTER, ...f}, 'America/Los_Angeles'), true);
  for (const f of [{tag: 'p0_trade'}, {muse: '02-moss'}, {place: 'commons:garden'}, {part: 'night'}, {tag: 'first_trade', part: 'evening'}]) assert.equal(matchFilter(e, {...EMPTY_FILTER, ...f}, 'America/Los_Angeles'), false);
  for (const [hour, part] of [[0, 'night'], [6, 'morning'], [12, 'afternoon'], [18, 'evening']]) assert.equal(matchFilter({...e, at: Date.parse('2026-11-02T08:00:00Z') + hour * 3600000}, {...EMPTY_FILTER, part}, 'America/Los_Angeles'), true);
});
test('without a zone argument the time-of-day filter uses the viewer\'s own zone (the path the page takes)', () => {
  const was = process.env.TZ, e = {tags: [], muse: '00-jolly', other: null, place: 'commons:cafe', at: Date.parse('2026-11-01T17:00:00Z')};
  try {
    for (const [tz, part] of [['Asia/Seoul', 'night'], ['Europe/London', 'afternoon'], ['America/Los_Angeles', 'morning']]) { // 02:00, 17:00, 09:00 local
      process.env.TZ = tz;
      for (const p of ['night', 'morning', 'afternoon', 'evening']) assert.equal(matchFilter(e, {...EMPTY_FILTER, part: p}), p === part, `${tz} ${p}`);
    }
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
});
test('fixture is a scoped, ordered scenario with catalog ids and genuine recorded model references', () => {
  const run = read('../fixtures/replay-run.json'), library = read('../fixtures/replay-library.json');
  assert.equal(run.label, 'SCRIPTED · PREVIEW FIXTURE'); assert.equal(run.day, '2026-11-01'); assert.equal(run.durationSec, 1800); assert.equal(run.startAt, 1793552400000); // layout.browser.js checks the clock against this start
  assert.match(run.note, /not.*real|not.*actual/i); assert.ok(run.events.length >= 24 && run.events.length <= 30);
  assert.equal(new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23'}).format(run.startAt), '09');
  assert.equal(new Set(run.events.map(e => e.id)).size, run.events.length);
  const places = new Set(PLACES.map(p => p.id));
  for (const [i, e] of run.events.entries()) {
    assert.ok(e.fixture); assert.ok(e.t >= 0 && e.t <= run.durationSec); if (i) assert.ok(e.t >= run.events[i - 1].t);
    assert.equal(e.at, run.startAt + e.t * 1000); assert.equal(e.seq, i + 1);
    if (e.muse) assert.ok(HARNESS_IDS.includes(e.muse)); if (e.other) assert.ok(HARNESS_IDS.includes(e.other)); if (e.place) assert.ok(places.has(e.place));
    if (e.data.evidence) { const rec = e.data.evidence.replayOf; assert.equal(typeof rec, 'object', 'the Worker stores the recorded answer in replayOf'); const ref = library.entries.find(r => r.requestId === rec.requestId); assert.ok(ref, 'a real recorded request id'); assert.equal(rec.responseId, ref.responseId); assert.equal(rec.model, ref.model); assert.equal(e.muse, ref.muse); assert.equal(e.data.evidence.requestId, undefined, 'no request id is invented for a replay'); }
    if (e.source === 'rule' || ['cards_verified', 'a2a_verified', 'a2a_refused', 'impostor_rejected'].includes(e.kind)) assert.equal(e.data.evidence, undefined);
  }
  assert.equal(run.events.filter(e => e.source === 'replay' && !e.data.evidence).length, 1);
  assert.equal(run.events.filter(e => e.kind === 'new_day').length, 0);
  const required = {spotlight: 3, depart: 2, arrive: 2, beat: 2, encounter: 4, cards_verified: 2, a2a_verified: 1, a2a_refused: 1, impostor_rejected: 1, injection_blocked: 1, decision_rejected: 1, approval_requested: 1, meetup_candidate: 1, trade_proposed: 1, trade_completed: 1, discover: 1};
  for (const [kind, count] of Object.entries(required)) assert.ok(run.events.filter(e => e.kind === kind).length >= count, kind);
  const enc = run.events.filter(e => e.kind === 'encounter'); assert.equal(enc.filter(e => e.data.initiatedByIntent === true).length, 2); assert.equal(enc.filter(e => e.data.initiatedByIntent === false).length, 1); assert.equal(enc.filter(e => !('initiatedByIntent' in e.data)).length, 1);
  assert.ok(enc.some(e => e.data.actorOrigin === 'muse')); assert.ok(enc.some(e => e.data.actorOrigin === 'person'));
  const trade = run.events.find(e => e.kind === 'trade_completed'); assert.ok(trade.tags.includes('ability_change')); assert.notEqual(trade.data.beforeHash, trade.data.afterHash);
  const discovery = run.events.find(e => e.kind === 'discover'); assert.ok(discovery.tags.includes('ability_change')); assert.equal(discovery.data.beforeHash, undefined);
  assert.equal(run.events.find(e => e.kind === 'meetup_candidate').data.requestId, run.events.find(e => e.kind === 'approval_requested').data.requestId);
});
test('pure modules and DOM module cannot perform network calls or HTML interpolation', () => {
  for (const name of ['replay.ts', 'replay-core.ts', 'autonomy.ts']) {
    const source = readFileSync(new URL('../src/ui/' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|innerHTML/);
  }
});
