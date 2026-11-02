import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {computeAutonomy} from '../src/ui/autonomy.ts';

const scope = {label: 'Scripted fixture', day: '2026-11-01', worldId: 'fixture-world', runId: 'fixture-run-1', complete: true};
const event = (id, kind, data = {}, extra = {}) => ({id, kind, data, source: 'rule', muse: '00-jolly', at: 1793548800000, tags: [], ...extra});
const row = (events, key, s = scope) => computeAutonomy(events, s).rows.find(r => r.key === key);

test('empty sample has six unmeasured rows and transparent scope', () => {
  const r = computeAutonomy([], {...scope, worldId: null, runId: null});
  assert.equal(r.rows.length, 6);
  for (const v of r.rows) { assert.equal(v.measured, false); assert.equal(v.value, 'Not measured'); assert.match(v.sample, /n=0/); }
  assert.match(r.period, /2026-11-01.*0 events/);
  assert.match(r.period, /not recorded/);
});

test('starts use intent / all meetings, with observed actor origins and missing coverage', () => {
  // C03 actor origins: system (world residents), connected (a person's own Muse), trial (a visitor).
  const events = [event('1', 'encounter', {initiatedByIntent: true, actorOrigin: 'system'}), event('2', 'encounter', {initiatedByIntent: true, actorOrigin: 'system'}), event('3', 'encounter', {initiatedByIntent: false, actorOrigin: 'connected'}), event('4', 'encounter')];
  const r = row(events, 'starts');
  assert.equal(r.value, '50%'); assert.equal(r.sample, 'n=4 meetings');
  assert.match(r.note, /system: 2 \(2 by intent\)/); assert.match(r.note, /connected: 1 \(0 by intent\)/); assert.match(r.note, /trial: 0/); assert.match(r.note, /1 without origin/); assert.match(r.note, /1.*not recorded/);
  // The old non-contract values are not origins: they count as unrecorded.
  assert.match(row([event('1', 'encounter', {initiatedByIntent: true, actorOrigin: 'muse'})], 'starts').note, /Actor origins not recorded/);
  assert.equal(row([event('1', 'encounter')], 'starts').value, 'Not measured');
  assert.match(row([event('1', 'encounter')], 'starts').note, /origin of each start is not recorded/);
  assert.equal(row([event('1', 'encounter', {initiatedByIntent: false})], 'starts').value, '0%');
});

test('approval requests count unique request ids, never candidates as a second request', () => {
  const events = [event('1', 'approval_requested', {requestId: 'approval-1'}), event('2', 'approval_requested', {requestId: 'approval-1'}), event('3', 'meetup_candidate', {requestId: 'approval-1'}), event('4', 'meetup_candidate', {requestId: 'candidate-only'}), event('5', 'approval_requested')];
  assert.equal(row(events, 'interventions').value, '2');
  assert.match(row(events, 'interventions').note, /2.*candidates/);
  assert.equal(row([event('1', 'beat')], 'interventions').value, '0');
});

test('signature checks count both card directions and actual refused checks', () => {
  const events = [event('1', 'cards_verified', {aVerifiesB: {ok: true}, bVerifiesA: {ok: false}}), event('2', 'a2a_verified'), event('3', 'a2a_refused'), event('4', 'impostor_rejected')];
  const r = row(events, 'signatures');
  assert.equal(r.value, '2 passed · 3 refused'); assert.match(r.note, /check ids.*not recorded/i);
  assert.equal(row([event('1', 'cards_verified')], 'signatures').value, 'Not measured');
  assert.equal(row([event('1', 'beat')], 'signatures').value, '0 passed · 0 refused');
});

test('a missing card direction remains unmeasured even when the other direction passed', () => {
  const r = row([event('1', 'cards_verified', {aVerifiesB: {ok: true}})], 'signatures');
  assert.equal(r.measured, false);
  assert.equal(r.value, 'Not measured');
  assert.match(r.note, /1 card check outcomes not recorded/);
});

test('model calls deduplicate request ids across kinds and exclude model-free verification', () => {
  const events = [event('1', 'spotlight', {evidence: {requestId: 'live-a'}}, {source: 'live'}), event('2', 'trade_completed', {evidence: {requestId: 'live-a'}}, {source: 'live'}), event('3', 'encounter', {evidence: {requestId: 'live-b'}}, {source: 'live'}), event('4', 'a2a_verified', {}, {source: 'live'}), event('5', 'spotlight', {evidence: {replayOf: 'original-a'}}, {source: 'replay'}), event('6', 'spotlight', {evidence: {replayOf: 'original-a'}}, {source: 'replay'}), event('7', 'spotlight', {}, {source: 'replay'}), event('8', 'spotlight', {}, {source: 'scripted'})];
  assert.equal(row(events, 'models').value, '2 live · 1 replay · 1 scenario');
  assert.match(row(events, 'models').note, /1 replay events without original request id/);
});

test('abilities count changed before/after hashes, distinguish tags without hashes and real zero', () => {
  const changed = event('1', 'trade_completed', {beforeHash: 'before', afterHash: 'after'}, {tags: ['ability_change']});
  const same = event('2', 'trade_completed', {beforeHash: 'same', afterHash: 'same'}, {tags: ['ability_change']});
  const tagged = event('3', 'discover', {}, {tags: ['ability_change']});
  assert.equal(row([changed, same, tagged], 'abilities').value, '1 changes');
  assert.match(row([changed, same, tagged], 'abilities').note, /1 tagged observations/);
  assert.equal(row([same], 'abilities').value, '0 changes');
  assert.equal(row([tagged], 'abilities').value, 'Not measured');
  assert.match(row([tagged], 'abilities').note, /1 tagged observations \(before\/after state not recorded\)/);
});

test('blocks are separate; all results deduplicate ids without mutating input', () => {
  const one = event('1', 'injection_blocked'), two = event('2', 'decision_rejected');
  const events = [one, structuredClone(one), two]; const snapshot = structuredClone(events);
  const r = computeAutonomy(events, {...scope, complete: false, partialReason: 'page 2 failed'});
  assert.equal(r.eventCount, 2); assert.equal(r.duplicates, 1);
  assert.deepEqual(r.sources, {live: 0, rule: 2, scripted: 0, replay: 0});
  assert.equal(r.rows.find(v => v.key === 'blocks').value, '1 instructions blocked · 1 out-of-scope decisions refused');
  assert.match(r.period, /partial sample.*page 2 failed/i);
  for (const v of r.rows) assert.match(v.note, /Partial sample/);
  assert.deepEqual(events, snapshot);
});

test('fixture six rows agree with independent raw-event counts', () => {
  const run = JSON.parse(readFileSync(new URL('../fixtures/replay-run.json', import.meta.url)));
  const events = run.events, r = computeAutonomy(events, scope), values = Object.fromEntries(r.rows.map(v => [v.key, v.value]));
  const meetings = events.filter(e => e.kind === 'encounter');
  assert.equal(values.starts, `${Math.round(meetings.filter(e => e.data.initiatedByIntent === true).length / meetings.length * 100)}%`);
  assert.equal(values.interventions, String(new Set(events.filter(e => e.kind === 'approval_requested').map(e => e.data.requestId || e.id)).size));
  let passed = 0, refused = 0;
  for (const e of events) {
    if (e.kind === 'cards_verified') for (const v of [e.data.aVerifiesB, e.data.bVerifiesA]) { if (v?.ok === true) passed++; if (v?.ok === false) refused++; }
    if (e.kind === 'a2a_verified') passed++;
    if (e.kind === 'a2a_refused' || e.kind === 'impostor_rejected') refused++;
  }
  assert.equal(values.signatures, `${passed} passed · ${refused} refused`);
  const live = new Set(), replay = new Set(); let scenario = 0;
  for (const e of events) { if (e.source === 'live' && e.data.evidence?.requestId) live.add(e.data.evidence.requestId); if (e.source === 'replay' && e.data.evidence?.replayOf) { const r = e.data.evidence.replayOf; replay.add(typeof r === 'string' ? r : r.requestId); } if (e.source === 'scripted' && e.kind === 'spotlight') scenario++; }
  assert.equal(values.models, `${live.size} live · ${replay.size} replay · ${scenario} scenario`);
  assert.equal(values.abilities, `${events.filter(e => e.tags.includes('ability_change') && e.data.beforeHash && e.data.afterHash && e.data.beforeHash !== e.data.afterHash).length} changes`);
  assert.equal(values.blocks, `${events.filter(e => e.kind === 'injection_blocked').length} instructions blocked · ${events.filter(e => e.kind === 'decision_rejected').length} out-of-scope decisions refused`);
});

test('C09 on real Worker data: replayOf is the recorded answer, so two events with the same request id are one replay', () => {
  const rec = {requestId: 'same', responseId: 'r1', model: 'm'};
  const events = [event('1', 'spotlight', {evidence: {replayOf: {...rec}}}, {source: 'replay'}), event('2', 'spotlight', {evidence: {replayOf: {...rec}}}, {source: 'replay'}), event('3', 'spotlight', {evidence: {replayOf: 'other'}}, {source: 'replay'})];
  const row = computeAutonomy(events, scope).rows.find(r => r.key === 'models');
  assert.match(row.value, /0 live · 2 replay · 0 scenario/); assert.equal(row.sample, 'n=2 unique requests');
});

test('C09: live model answers without a request id are not counted and never shown as a measured zero', () => {
  const events = [event('1', 'spotlight', {evidence: {requestId: null}}, {source: 'live'})];
  const row = computeAutonomy(events, scope).rows.find(r => r.key === 'models');
  assert.equal(row.measured, false); assert.equal(row.value, 'Not measured'); assert.match(row.note, /1 live model answers without request id/);
  const some = computeAutonomy([...events, event('2', 'spotlight', {evidence: {requestId: 'live-a'}}, {source: 'live'})], scope).rows.find(r => r.key === 'models');
  assert.equal(some.measured, true); assert.match(some.value, /^1 live/); assert.match(some.note, /1 live model answers without request id \(not counted\)/);
});

test('C09: a live answer with no request id hides only the live count; replay and scenario counts stay', () => {
  const rec = {requestId: 'rec-1', responseId: 'r1', model: 'm'};
  const events = [event('1', 'spotlight', {evidence: {replayOf: rec}}, {source: 'replay'}), event('2', 'spotlight', {evidence: {requestId: null}}, {source: 'live'})];
  const row = computeAutonomy(events, scope).rows.find(r => r.key === 'models');
  assert.equal(row.measured, true); assert.equal(row.value, 'live not measured · 1 replay · 0 scenario'); assert.match(row.note, /1 live model answers without request id/);
});

test('C09: a model answer on any kind of event (decision_rejected, decision_discarded) with a null request id is noted, not a silent zero', () => {
  for (const kind of ['decision_rejected', 'decision_discarded']) {
    const row = computeAutonomy([event('1', kind, {evidence: {model: 'm', responseId: 'r1', requestId: null}}, {source: 'live'})], scope).rows.find(r => r.key === 'models');
    assert.equal(row.measured, false, kind); assert.equal(row.value, 'Not measured', kind); assert.match(row.note, /without request id/, kind);
  }
});
