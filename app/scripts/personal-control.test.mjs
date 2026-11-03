// Persistent personal ownership is independent of credential freshness. Local TLS/SQLite, no account or model.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpsWorld, JOLLY, COPPER} from './test-support/https-world.mjs';

test('using the owner Muse connector establishes a durable personal control mode without converting demo peers', async tc => {
  const t = await httpsWorld(tc);
  assert.equal(t.muse(JOLLY).controlMode, 'personal');
  assert.notEqual(t.muse(COPPER).controlMode, 'personal');
  await t.restart();
  assert.equal(t.muse(JOLLY).controlMode, 'personal');
  const revoked = await t.go('DELETE', '/api/agent-keys/' + t.keys[JOLLY].id, undefined, {origin: t.origin, cookie: t.cookies[JOLLY]});
  assert.equal(revoked.status, 200);
  assert.equal(t.muse(JOLLY).controlMode, 'personal', 'a credential revocation never transfers the Muse to NPC rules');
});

test('an offline personal Muse waits for its own runtime rather than accepting a resident trade by rule', async tc => {
  const t = await httpsWorld(tc);
  t.edit(state => {
    state.muses.find(m => m.id === JOLLY).inventory = ['coffee'];
    state.muses.find(m => m.id === COPPER).inventory = ['tea'];
  });
  const revoked = await t.go('DELETE', '/api/agent-keys/' + t.keys[JOLLY].id, undefined, {origin: t.origin, cookie: t.cookies[JOLLY]});
  assert.equal(revoked.status, 200);
  const result = await t.tool(COPPER, 'propose_trade', {to: JOLLY, give: 'tea', want: 'coffee'});
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.structuredContent.result, 'pending');
  assert.equal(result.structuredContent.task.status, 'pending');
  assert.deepEqual(t.muse(JOLLY).inventory, ['coffee']);
  assert.deepEqual(t.muse(COPPER).inventory, ['tea']);
});
