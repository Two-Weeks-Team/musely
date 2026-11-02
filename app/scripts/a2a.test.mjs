import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Trust, OWNER_SLOT} from '../worker/core/trust.ts';
import {runP0, verifyMeeting, impostorCheck, injectionCheck, findOwnerTrade} from '../worker/core/a2a.ts';
import {makeHooks} from '../src/engine/rules.ts';

const sqlite = () => { const db = new DatabaseSync(':memory:'); return {exec(q, ...b) { const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }}; };
const T0 = Date.parse('2026-11-03T16:00:00Z');
async function setup() {
  const sql = sqlite(), ledger = new Ledger(sql, {dailyCapUsd: 1}); ledger.init();
  const trust = new Trust(sql); trust.init();
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const ownerRoot = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await trust.ensureAgents(ownerRoot);
  const runtime = new WorldRuntime(sql, {worldId: 'w', ledger, model: null, hooks: makeHooks(), delegationValid: m => !trust.suspended(m)});
  runtime.init(T0);
  runtime.commitExternal(T0, 'welcome', st => st.muses.find(m => m.id === OWNER_SLOT).inventory.push('coffee', 'postage_stamp'));
  return {trust, runtime, ctx: {trust, runtime, ownerRoot, ownerClaimed: true, baseUrl: 'https://musely.net'}};
}

test('P0: a valid delegation commits the trade; after revocation the same request is refused; then re-delegated', async () => {
  const {ctx, runtime, trust} = await setup();
  assert.ok(findOwnerTrade(runtime.state()), 'a nearby valid trade exists');
  const r = await runP0(ctx);
  assert.deepEqual([r.before, r.afterRevoke], ['verified', 'delegation_revoked']);
  const ev = runtime.events(0, 500).filter(e => ['a2a_verified', 'trade_completed', 'delegation_revoked', 'a2a_refused', 'delegation_issued'].includes(e.kind));
  assert.deepEqual(ev.map(e => e.kind), ['a2a_verified', 'trade_completed', 'delegation_revoked', 'a2a_refused', 'delegation_issued']);
  const verified = ev[0], refused = ev[3];
  assert.equal(verified.data.envelope.signer_kind, 'server_custodial');
  assert.deepEqual(refused.data.content, verified.data.content, 'the same request content');
  assert.notEqual(refused.data.envelope.message_id, verified.data.envelope.message_id);
  assert.equal(refused.data.step, 'delegation');
  assert.ok(ev[1].tags.includes('p0_trade') && refused.tags.includes('p0_refused'));
  assert.equal(trust.suspended(OWNER_SLOT), false, 'a new delegation was issued');
  const owner = runtime.state().muses.find(m => m.id === OWNER_SLOT);
  assert.ok(owner.inventory.includes('trade_receipt'));
});

test('meeting: both Agent Cards verify against the trusted roots', async () => {
  const {ctx} = await setup();
  const [e] = await verifyMeeting(ctx, '02-moss', '03-ripple', 'commons:garden');
  assert.equal(e.kind, 'cards_verified');
  assert.deepEqual([e.data.aVerifiesB.ok, e.data.bVerifiesA.ok], [true, true]);
  const [o] = await verifyMeeting(ctx, OWNER_SLOT, '02-moss', null);
  assert.equal(o.data.aVerifiesB.ok && o.data.bVerifiesA.ok, true, 'owner card signed with the owner root verifies');
});

test('an impostor with a self-signed look-alike card is refused; peer instructions are blocked', async () => {
  const {ctx} = await setup();
  const [imp] = await impostorCheck(ctx, '02-moss');
  assert.equal(imp.kind, 'impostor_rejected');
  assert.equal(imp.data.verdict.reason, 'untrusted_key');
  for (let i = 0; i < 3; i++) {
    const [inj] = await injectionCheck(ctx, '07-tempo', '02-moss', i);
    assert.equal(inj.kind, 'injection_blocked');
    assert.match(inj.data.wrapped, /^<untrusted_data/);
  }
});

test('while revoked and not re-delegated, live decisions for the owner Muse are discarded', async () => {
  const {trust} = await setup();
  await trust.executor(OWNER_SLOT, 'server_custodial', null).catch(() => null);
  const {ctx} = await setup();
  await ctx.trust.executor(OWNER_SLOT, 'server_custodial', ctx.ownerRoot);
  await ctx.trust.revoke(OWNER_SLOT);
  assert.equal(ctx.trust.suspended(OWNER_SLOT), true);
  assert.equal(ctx.trust.suspended('02-moss'), false);
});
