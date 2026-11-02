import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Trust, OWNER_SLOT} from '../worker/core/trust.ts';
import {runP0, verifyMeeting, impostorCheck, injectionCheck, findOwnerTrade} from '../worker/core/a2a.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {revokeMuse, redelegateMuse} from '../worker/core/owner-control.ts';

// Like Durable Object SQL: transaction statements are refused (only transactionSync opens a transaction).
const TX_SQL = /^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i;
// transactionSync stands in for ctx.storage.transactionSync: a savepoint that rolls back on a throw.
const sqlite = () => { const db = new DatabaseSync(':memory:'); let depth = 0; return {exec(q, ...b) { if (TX_SQL.test(q)) throw new Error('Durable Object SQL rejects transaction statements; use transactionSync'); const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }, transactionSync(fn) { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('transactionSync callback must be synchronous'); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } }}; };
const T0 = Date.parse('2026-11-03T16:00:00Z');
async function setup() {
  const sql = sqlite(), ledger = new Ledger(sql, {dailyCapUsd: 1}); ledger.init();
  const trust = new Trust(sql); trust.init();
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const ownerRoot = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await trust.ensureAgents(ownerRoot);
  const runtime = new WorldRuntime(sql, {worldId: 'w', meetingGate: 'off', ledger, model: null, hooks: makeHooks(), delegationValid: m => !trust.suspended(m)});
  runtime.init(T0);
  runtime.commitExternal(T0, 'welcome', st => st.muses.find(m => m.id === OWNER_SLOT).inventory.push('coffee', 'postage_stamp'));
  return {trust, runtime, ctx: {trust, runtime, ownerRoot, ownerClaimed: true, baseUrl: 'https://musely.net'}};
}

test('P0: valid → the owner revokes → the same job with a new nonce is refused, state unchanged → no automatic re-delegation', async () => {
  const {ctx, runtime, trust} = await setup();
  assert.ok(findOwnerTrade(runtime.state()), 'a nearby valid trade exists');
  const r1 = await runP0(ctx);
  assert.deepEqual([r1.phase, r1.before], ['valid', 'verified']);
  assert.equal(trust.suspended(OWNER_SLOT), false, 'running P0 revokes nothing by itself');
  // The owner's own, separate action.
  const rv = await revokeMuse(ctx, OWNER_SLOT, 'owner:kim-sejun');
  assert.equal(rv.ok && rv.already, false);
  const before = JSON.stringify(runtime.state());
  const r2 = await runP0(ctx);
  assert.deepEqual([r2.phase, r2.afterRevoke, r2.stateUnchanged, r2.redelegated], ['after_revoke', 'delegation_revoked', true, false]);
  assert.equal(JSON.stringify(runtime.state()), before, 'inventories, places, Tasks and the world version did not change');
  assert.equal(trust.suspended(OWNER_SLOT), true, 'P0 did not delegate again');
  // Running it again changes nothing either: still revoked until the owner delegates.
  const r3 = await runP0(ctx);
  assert.deepEqual([r3.phase, r3.afterRevoke, r3.stateUnchanged], ['after_revoke', 'delegation_revoked', true]);
  assert.equal(trust.suspended(OWNER_SLOT), true);
  const kinds = ['a2a_verified', 'trade_completed', 'delegation_revoked', 'a2a_refused', 'delegation_issued'];
  const ev = runtime.events(0, 500).filter(e => kinds.includes(e.kind));
  assert.deepEqual(ev.map(e => e.kind), ['a2a_verified', 'trade_completed', 'delegation_revoked', 'a2a_refused', 'a2a_refused'], 'no delegation_issued: nothing re-delegated');
  const [verified, , revoked, refused, refusedAgain] = ev;
  assert.equal(revoked.data.by, 'owner:kim-sejun');
  assert.equal(verified.data.envelope.signer_kind, 'server_custodial');
  assert.deepEqual(refused.data.content, verified.data.content, 'the same job');
  assert.deepEqual(refusedAgain.data.content, verified.data.content);
  assert.notEqual(refused.data.envelope.message_id, verified.data.envelope.message_id);
  assert.notEqual(refused.data.envelope.nonce, verified.data.envelope.nonce, 'a new nonce');
  assert.notEqual(refusedAgain.data.envelope.nonce, refused.data.envelope.nonce);
  assert.equal(refused.data.step, 'delegation');
  assert.ok(ev[1].tags.includes('p0_trade') && refused.tags.includes('p0_refused'));
  assert.ok(runtime.state().muses.find(m => m.id === OWNER_SLOT).inventory.includes('trade_receipt'));
  // Only the owner's explicit re-delegation brings P0 back to the valid step.
  const rd = redelegateMuse(ctx, OWNER_SLOT, 'owner:kim-sejun');
  assert.equal(rd.ok && rd.already, false);
  assert.equal(runtime.events(0, 500).filter(e => e.kind === 'delegation_issued').length, 1);
  assert.equal((await runP0(ctx)).phase, 'valid');
});

test('P0 after a revocation made before any executor existed: refused at the delegation step, nothing signed', async () => {
  const {ctx, runtime, trust} = await setup();
  await revokeMuse(ctx, OWNER_SLOT, 'owner:kim-sejun');
  assert.equal(await trust.storedExecutor(OWNER_SLOT, 'server_custodial'), null);
  const before = JSON.stringify(runtime.state());
  const r = await runP0(ctx);
  assert.deepEqual([r.phase, r.afterRevoke, r.stateUnchanged], ['after_revoke', 'delegation_revoked', true]);
  assert.equal(JSON.stringify(runtime.state()), before);
  assert.equal(runtime.events(0, 500).filter(e => e.kind === 'a2a_refused').at(-1).data.envelope, null);
  assert.equal(trust.suspended(OWNER_SLOT), true);
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

test('a revocation suspends only that Muse, with or without an executor, until the owner delegates again', async () => {
  // The live decision discarded at the commit point for a revoked Muse is tested in world-runtime.test.mjs.
  const {ctx} = await setup();
  await ctx.trust.executor(OWNER_SLOT, 'server_custodial', ctx.ownerRoot);
  await ctx.trust.revoke(OWNER_SLOT);
  assert.equal(ctx.trust.suspended(OWNER_SLOT), true);
  assert.equal(ctx.trust.suspended('02-moss'), false);
  await assert.rejects(ctx.trust.executor(OWNER_SLOT, 'server_custodial', ctx.ownerRoot), /revoked/);
  ctx.trust.redelegate(OWNER_SLOT);
  assert.equal(ctx.trust.suspended(OWNER_SLOT), false);
});

test('P0 never picks a partner whose delegation is revoked', async () => {
  const {ctx, runtime} = await setup();
  const nearest = findOwnerTrade(runtime.state()).partner;
  await revokeMuse(ctx, nearest, 'musely');
  assert.notEqual(findOwnerTrade(runtime.state())?.partner, nearest, 'paused partners are skipped');
  assert.notEqual(findOwnerTrade(runtime.state(), id => ctx.trust.suspended(id))?.partner, nearest);
  const r = await runP0(ctx);
  assert.equal(r.phase, 'valid');
  assert.notEqual(r.plan?.partner, nearest);
  assert.ok(r.plan, 'another partner is available');
  assert.equal(r.before, 'verified', 'the chosen partner can answer');
});

test('P0 run twice in a row: both runs keep their refusal evidence (P0 refusals are never collapsed)', async () => {
  const {ctx, runtime} = await setup();
  const first = await runP0(ctx);
  assert.deepEqual([first.phase, first.before], ['valid', 'verified']);
  await revokeMuse(ctx, OWNER_SLOT, 'owner:kim-sejun');
  // Two P0 runs while revoked: the same actor, other side, code and step, yet each run keeps its own refusal.
  for (let i = 0; i < 2; i++) assert.equal((await runP0(ctx)).afterRevoke, 'delegation_revoked');
  const partner = runtime.events(0, 2000).find(e => e.kind === 'a2a_refused').other;
  // The owner delegates again and P0 commits a second valid trade with the same partner: clear today's pair
  // counter and give the owner's Muse something new to offer. Then the owner revokes again.
  redelegateMuse(ctx, OWNER_SLOT, 'owner:kim-sejun');
  runtime.commitExternal(T0, 'second-run', st => {
    st.items.trades = {};
    const me = st.muses.find(m => m.id === OWNER_SLOT), p = st.muses.find(m => m.id === partner);
    me.inventory.push('wildflower', 'pastry', 'tea', 'coffee', 'clover_seed');
    p.inventory.push('fruit', 'tea', 'pastry', 'route_map');
  });
  const plan = findOwnerTrade(runtime.state());
  assert.equal(plan?.partner, partner, 'the second run trades with the same partner');
  const second = await runP0(ctx);
  assert.deepEqual([second.phase, second.before], ['valid', 'verified'], JSON.stringify(second));
  await revokeMuse(ctx, OWNER_SLOT, 'owner:kim-sejun');
  assert.equal((await runP0(ctx)).afterRevoke, 'delegation_revoked');
  const refused = runtime.events(0, 2000).filter(e => e.kind === 'a2a_refused');
  assert.equal(refused.length, 3, 'one refusal per run');
  assert.ok(refused.every(e => e.other === partner && e.tags.includes('p0_refused') && e.data.label === 'p0-after-revoke'));
  assert.equal(new Set(refused.map(e => e.data.envelope.message_id)).size, 3);
  assert.deepEqual(refused.map(e => e.data.content.give), [first.plan.give, first.plan.give, second.plan.give], 'each refusal re-sends the latest valid job');
});
