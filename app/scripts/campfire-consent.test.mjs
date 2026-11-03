// An observed position is not consent. The invitee's own signed action is required. Local TLS fixtures only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpsWorld, JOLLY, COPPER, domainState} from './test-support/https-world.mjs';
const FIRE = 'commons:campfire';
const ok = r => {assert.equal(r.isError, false, JSON.stringify(r)); return r.structuredContent;};
async function invite(tc, {there = true} = {}) {
  const t = await httpsWorld(tc);
  t.edit(state => {
    for (const id of [COPPER, '01-sunny']) state.muses.find(m => m.id === id).place = FIRE;
    state.muses.find(m => m.id === JOLLY).place = there ? FIRE : 'commons:workbench';
    state.inbox.connected[JOLLY] = Date.now() - 25 * 3600000;
    state.muses.find(m => m.id === COPPER).inventory.push('invite_token');
  });
  const sent = ok(await t.tool(COPPER, 'invite_campfire', {to: [JOLLY, '01-sunny']}));
  const id = sent.invite.id;
  return {t, id, invitation: () => t.state().inbox.invites.find(x => x.id === id)};
}

test('a personal Muse already at the campfire stays pending until it chooses to answer', async tc => {
  const {t, invitation} = await invite(tc);
  assert.equal(invitation().answers[JOLLY].answer, 'pending');
  assert.equal(invitation().answers[JOLLY].via, null);
  assert.equal(invitation().status, 'open');
  assert.equal(t.events().filter(e => e.kind === 'campfire_gathering').length, 0);
});

test('an explicit signed campfire acceptance joins once and a duplicate sends no second answer', async tc => {
  const {t, id, invitation} = await invite(tc);
  const args = {invite_id: id, answer: 'accept', command_id: 'campfire-explicit-accept-001'};
  const accepted = ok(await t.tool(JOLLY, 'answer_campfire', args));
  assert.equal(accepted.envelope.verified, true);
  assert.equal(invitation().answers[JOLLY].answer, 'accept');
  assert.equal(invitation().answers[JOLLY].via, 'live');
  assert.equal(invitation().status, 'gathered');
  const before = structuredClone(domainState(t)), events = t.events().length;
  const again = ok(await t.tool(JOLLY, 'answer_campfire', args));
  assert.equal(again.command.duplicate, true);
  assert.deepEqual(domainState(t), before);
  assert.equal(t.events().length, events);
  assert.equal(t.events().filter(e => e.kind === 'campfire_gathering').length, 1);
  const answer = t.events().find(e => e.kind === 'campfire_invite_answer' && e.muse === JOLLY);
  assert.equal(answer.source, 'live');
  assert.equal(answer.data.tool, 'answer_campfire');
  assert.equal(answer.data.envelope.scope, 'world_invite');
});

test('the personal Muse can decline while already there without a forced trip or gathering', async tc => {
  const {t, id, invitation} = await invite(tc);
  const before = {place: t.muse(JOLLY).place, inventory: [...t.muse(JOLLY).inventory]};
  ok(await t.tool(JOLLY, 'answer_campfire', {invite_id: id, answer: 'decline'}));
  assert.equal(invitation().answers[JOLLY].answer, 'decline');
  assert.equal(invitation().answers[JOLLY].via, 'live');
  assert.equal(invitation().status, 'open');
  assert.equal(t.muse(JOLLY).place, before.place);
  assert.deepEqual(t.muse(JOLLY).inventory, before.inventory);
  assert.equal(t.muse(JOLLY).travel, null);
});

test('a recipient can still answer by choosing its own authenticated trip after the invitation', async tc => {
  const {t, invitation} = await invite(tc, {there: false});
  ok(await t.tool(JOLLY, 'move', {to: FIRE, command_id: 'campfire-chosen-arrival-001'}));
  assert.equal(invitation().answers[JOLLY].answer, 'pending', 'starting the trip is not arrival');
  const arrival = t.muse(JOLLY).travel.arriveAt;
  await t.dobj.runtime.heartbeat(Math.max(Date.now(), arrival) + 1);
  assert.equal(invitation().answers[JOLLY].answer, 'accept');
  assert.equal(invitation().answers[JOLLY].via, 'live');
  assert.equal(invitation().status, 'gathered');
});

test('an unrelated position change after the invitation cannot stand in for the recipient decision', async tc => {
  const {t, id, invitation} = await invite(tc, {there: false});
  t.edit(state => {state.muses.find(m => m.id === JOLLY).place = FIRE;});
  await t.dobj.runtime.heartbeat(Date.now() + 60001);
  ok(await t.tool(COPPER, 'heartbeat_check'));
  assert.equal(invitation().answers[JOLLY].answer, 'pending');
  assert.equal(invitation().status, 'open');
  assert.ok(id);
});

test('expired invitations cannot be accepted and a lost owner claim still permits a decline', async tc => {
  const {t, id, invitation} = await invite(tc);
  t.claim(false);
  const blocked = await t.tool(JOLLY, 'answer_campfire', {invite_id: id, answer: 'accept'});
  assert.equal(blocked.structuredContent.refused, 'pending_claim');
  assert.equal(invitation().answers[JOLLY].answer, 'pending');
  ok(await t.tool(JOLLY, 'answer_campfire', {invite_id: id, answer: 'decline'}));
  assert.equal(invitation().answers[JOLLY].answer, 'decline');
  const closed = await t.tool(JOLLY, 'answer_campfire', {invite_id: id, answer: 'accept'});
  assert.equal(closed.structuredContent.refused, 'pending_claim');
});

test('expired invitations and stale reply versions leave the participant unanswered', async tc => {
  const {t, id, invitation} = await invite(tc);
  const stale = await t.tool(JOLLY, 'answer_campfire', {invite_id: id, answer: 'accept', expected_version: 0});
  assert.equal(stale.structuredContent.refused, 'stale_world');
  t.edit(state => {state.inbox.invites.find(x => x.id === id).expiresAt = Date.now() - 1;});
  const expired = await t.tool(JOLLY, 'answer_campfire', {invite_id: id, answer: 'accept'});
  assert.equal(expired.structuredContent.refused, 'invite_expired');
  assert.equal(invitation().answers[JOLLY].answer, 'pending');
});

test('campfire replies enforce the real recipient, strict inputs and current key authority', async tc => {
  const {t, id, invitation} = await invite(tc);
  const other = await t.dobj.connected.issueKey('04-ember');
  const wrong = await t.rpc(other.key, 'tools/call', {name: 'answer_campfire', arguments: {invite_id: id, answer: 'accept'}});
  assert.equal(wrong.body.result?.structuredContent.refused, 'not_your_invite');
  const privateReason = await t.rpc(t.keys[JOLLY].key, 'tools/call', {name: 'answer_campfire', arguments: {invite_id: id, answer: 'decline', reason: 'SYNTHETIC_PRIVATE_REASON'}});
  assert.equal(privateReason.body.error?.code, -32602);
  const revoked = await t.go('DELETE', '/api/agent-keys/' + t.keys[JOLLY].id, undefined, {origin: t.origin, cookie: t.cookies[JOLLY]});
  assert.equal(revoked.status, 200);
  const denied = await t.rpc(t.keys[JOLLY].key, 'tools/call', {name: 'answer_campfire', arguments: {invite_id: id, answer: 'accept'}});
  assert.equal(denied.status, 401);
  assert.equal(invitation().answers[JOLLY].answer, 'pending');
});
