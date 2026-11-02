// Source badges and model-call notes (direction v2, 8.6): each event says who acted and whether a model was called.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceLabel, modelNote} from '../src/ui/source-label.ts';

test('I-05 review 3: a connected Muse\'s spotlight request reads as your connected Muse, not as a verification', () => {
  const connected = {kind: 'spotlight_requested', source: 'live', data: {origin: 'connected', actorOrigin: 'connected', requester: 'connected:00-jolly', position: 1}};
  assert.deepEqual(sourceLabel(connected), {text: 'LIVE · your Muse · connected', cls: 'src-live'});
  assert.equal(modelNote(connected), "Not applicable — your connected Muse's own request, no model call");
  const visitor = {kind: 'spotlight_requested', source: 'live', data: {origin: 'visitor', actorOrigin: 'trial', requester: 'abc', position: 1}};
  assert.equal(sourceLabel(visitor).text, 'LIVE · visitor');
  assert.equal(modelNote(visitor), 'Not applicable — a visitor request, no model call');
  // Unchanged: model answers, verifications and rule answers.
  assert.equal(sourceLabel({source: 'live', data: {evidence: {requestId: 'r'}}}).text, 'LIVE · Muse Spark');
  assert.equal(sourceLabel({source: 'live', data: {kinds: []}}).text, 'LIVE · verified');
  assert.equal(modelNote({kind: 'cards_verified', source: 'live', data: {}}), 'Not applicable — verification only, no model call');
  const ruleAnswer = {kind: 'encounter_reply', source: 'rule', data: {reason: 'budget_reserved_for_visitors'}};
  assert.equal(sourceLabel(ruleAnswer).text, 'RULE');
  assert.equal(modelNote(ruleAnswer), 'Not applicable — rule, no model call');
});
