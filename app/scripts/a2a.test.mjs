import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Trust, OWNER_SLOT} from '../worker/core/trust.ts';
import {runP0, verifyMeeting, impostorCheck, injectionCheck, findOwnerTrade} from '../worker/core/a2a.ts';
import {makeHooks} from '../src/engine/rules.ts';

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

test('P0 run twice in a row: both runs keep their refusal evidence (P0 refusals are never collapsed)', async () => {
  const {ctx, runtime} = await setup();
  const first = await runP0(ctx);
  assert.deepEqual([first.before, first.afterRevoke], ['verified', 'delegation_revoked']);
  // A second valid trade with the same partner (so both refusals share actor, other side, code and step):
  // clear today's pair counter and give the owner's Muse something new to offer.
  const partner = runtime.events(0, 2000).find(e => e.kind === 'a2a_refused').other;
  runtime.commitExternal(T0, 'second-run', st => {
    st.items.trades = {};
    const me = st.muses.find(m => m.id === OWNER_SLOT), p = st.muses.find(m => m.id === partner);
    me.inventory.push('wildflower', 'pastry', 'tea', 'coffee', 'clover_seed');
    p.inventory.push('fruit', 'tea', 'pastry', 'route_map');
  });
  const plan = findOwnerTrade(runtime.state());
  assert.equal(plan?.partner, partner, 'the second run trades with the same partner');
  const second = await runP0(ctx);
  assert.deepEqual([second.before, second.afterRevoke], ['verified', 'delegation_revoked'], JSON.stringify(second));
  const refused = runtime.events(0, 2000).filter(e => e.kind === 'a2a_refused');
  assert.equal(refused.length, 2, 'one refusal per run');
  assert.equal(refused[1].other, partner);
  assert.ok(refused.every(e => e.tags.includes('p0_refused') && e.data.label === 'p0-after-revoke'));
  assert.notEqual(refused[0].data.envelope.message_id, refused[1].data.envelope.message_id);
});
