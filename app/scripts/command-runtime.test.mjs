// I-01 (#47): every shared-state write is verified before side effects and commits once.
// The same Trust + WorldRuntime + ConnectedHost the world Durable Object uses, over node:sqlite.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Trust, OWNER_SLOT} from '../worker/core/trust.ts';
import {MeetingCheck} from '../worker/core/a2a.ts';
import {ConnectedHost} from '../worker/core/connected.ts';
import {runTool} from '../worker/core/mcp-tools.ts';
import {executeCommand, signCommand, commandContent, worldHandler} from '../worker/core/commands.ts';
import {callModel} from '../worker/core/model.ts';
import {signEnvelope, verifyEnvelope, MemoryRegistry, contentHash} from '../src/identity/envelope.ts';
import {generateKeyPair} from '../src/identity/jws.ts';
import {issueDelegation, peekDelegation} from '../src/identity/delegation.ts';
import {makeHooks} from '../src/engine/rules.ts';

const sqlite = () => { const db = new DatabaseSync(':memory:'); return {exec(q, ...b) { const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }}; };
// Delegations carry a real 24 h expiry, so the test clock starts at the real time.
const T0 = Math.floor(Date.now() / 60_000) * 60_000;
const BASE = 'https://musely.net';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setup({model = null, meetings = false, sql = sqlite()} = {}) {
  const ledger = new Ledger(sql, {dailyCapUsd: 5}); ledger.init();
  const trust = new Trust(sql); trust.init();
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const ownerRoot = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await trust.ensureAgents(ownerRoot);
  const hooks = makeHooks();
  const cred = {trust, ownerRoot, ownerClaimed: true, baseUrl: BASE};
  const gate = {check: new MeetingCheck(() => cred), prepared: null};
  const runtime = new WorldRuntime(sql, {worldId: 'w', ledger, model, hooks, delegationValid: m => !trust.suspended(m),
    ...(meetings ? {meetingGate: async (s, now) => { const g = await gate.check.prepare(s, now); gate.prepared?.(); return g; }} : {})});
  runtime.init(T0);
  const ctx = {trust, runtime, ownerRoot, ownerClaimed: true, baseUrl: BASE};
  const muse = id => runtime.state().muses.find(m => m.id === id);
  const edit = fn => runtime.commitExternal(T0, 'test-' + Math.random().toString(36).slice(2), st => fn(st));
  const events = kind => runtime.events(0, 2000).filter(e => !kind || e.kind === kind);
  return {sql, ledger, trust, runtime, ownerRoot, hooks, ctx, gate, muse, edit, events};
}
/** Everything a refusal must leave alone: places, trips, inventories, memories, meetings, items, Tasks, mail. */
const worldOf = rt => { const s = rt.state(); return JSON.stringify({version: s.version, muses: s.muses, items: s.items, tasks: s.inbox?.tasks ?? [], mail: s.inbox?.mail ?? []}); };
const place = (st, id, p) => { const m = st.muses.find(x => x.id === id); m.place = p; m.travel = null; m.beat = null; m.intent = null; };

// Ripple meets Moss at the garden with a trade Moss accepts by rule (Moss wants a wildflower).
function arrangeMeeting(st) {
  place(st, '03-ripple', 'commons:garden'); place(st, '02-moss', 'commons:garden');
  for (const m of st.muses) if (!['03-ripple', '02-moss'].includes(m.id) && (m.place === 'commons:garden' || m.travel?.to === 'commons:garden')) place(st, m.id, 'commons:cafe');
  const ripple = st.muses.find(m => m.id === '03-ripple'), moss = st.muses.find(m => m.id === '02-moss');
  ripple.inventory.push('wildflower'); if (!moss.inventory.includes('fruit')) moss.inventory.push('fruit');
  ripple.intent = {kind: 'trade', target: '02-moss', give: 'wildflower', want: 'fruit'};
  // The spotlight goes to someone else, so no decision moves either of them this tick.
  st.spotlight.cursor = st.muses.findIndex(m => m.id === '09-pixel') >= 0 ? st.muses.findIndex(m => m.id === '09-pixel') : st.muses.length - 1;
}
const pairEvents = (t, tick) => t.events().filter(e => e.tick === tick && [e.muse, e.other].includes('03-ripple') && [e.muse, e.other].includes('02-moss'));

test('I-01 #1: an ordinary resident meeting verifies both cards and delegations before greeting or trading; a failed check changes nothing', async () => {
  // Valid credentials: verification first, then greeting and the rule trade, all in one tick.
  const ok = await setup({meetings: true});
  ok.edit(arrangeMeeting);
  const tick = ok.runtime.state().tick;
  assert.equal((await ok.runtime.heartbeat(T0)).status, 'committed');
  const kinds = pairEvents(ok, tick).map(e => e.kind);
  assert.ok(kinds.includes('greet') && kinds.includes('trade_completed'), kinds.join(','));
  assert.ok(kinds.indexOf('cards_verified') >= 0 && kinds.indexOf('cards_verified') < kinds.indexOf('greet'), 'verified before the greeting: ' + kinds.join(','));
  const v = pairEvents(ok, tick).find(e => e.kind === 'cards_verified');
  assert.deepEqual([v.data.aVerifiesB.ok, v.data.bVerifiesA.ok], [true, true]);
  for (const id of ['03-ripple', '02-moss']) assert.equal(v.data.delegations[id].delegation.signer_kind, 'server_heartbeat');
  assert.ok(ok.muse('02-moss').inventory.includes('wildflower'), 'the verified trade happened');

  // Impostor: Moss's trusted root no longer matches the key that signs its card and delegation.
  const imp = await setup({meetings: true});
  imp.edit(arrangeMeeting);
  imp.sql.exec('UPDATE agents SET root_jwk = ? WHERE muse_id = ?', JSON.stringify((await generateKeyPair()).publicJwk), '02-moss');
  const before = imp.runtime.state(), t1 = before.tick;
  await imp.runtime.heartbeat(T0);
  const ev = pairEvents(imp, t1);
  assert.deepEqual(ev.map(e => e.kind), ['meeting_refused'], 'only the refusal is logged');
  assert.equal(ev[0].data.refused['02-moss'], 'card_untrusted_key');
  assert.ok(ev[0].tags.includes('impostor_rejected'));
  for (const id of ['03-ripple', '02-moss']) {
    const a = before.muses.find(m => m.id === id), b = imp.muse(id);
    assert.deepEqual(b.inventory, a.inventory, id + ' inventory unchanged');
    assert.deepEqual([b.lastMet, b.memory, b.place], [a.lastMet, a.memory, a.place], id + ' did not meet');
  }

  // Revoked while the model was answering: the cards were fine at prepare time, the commit re-check refuses.
  let release;
  const slow = async (_u, init) => { await new Promise(r => { release = r; }); const out = {freedom: 'where', decision: 'stay', target_place: '', target_agent: '', offer_item: '', want_item: '', public_reason: 'here', line: 'Staying'}; void init; return new Response(JSON.stringify({id: 'c', usage: {prompt_tokens: 10, completion_tokens: 10}, choices: [{message: {content: JSON.stringify(out)}}]})); };
  const rev = await setup({meetings: true, model: {base: 'https://api.meta.ai/v1', key: 'k', model: 'muse-spark-1.3', timeoutMs: 5000, fetcher: (...a) => slow(...a)}});
  rev.edit(arrangeMeeting);
  const prepared = new Promise(r => { rev.gate.prepared = r; });
  const t2 = rev.runtime.state().tick, ripple0 = rev.muse('03-ripple');
  const beat = rev.runtime.heartbeat(T0);
  await prepared;
  await rev.trust.revoke('03-ripple');
  while (!release) await sleep(1);
  release();
  assert.equal((await beat).status, 'committed');
  const late = pairEvents(rev, t2);
  assert.deepEqual(late.map(e => e.kind), ['meeting_refused']);
  assert.equal(late[0].data.refused['03-ripple'], 'delegation_revoked');
  assert.ok(late[0].data.delegations['03-ripple'].delegation.ref, 'the delegation was valid when checked before the await');
  assert.deepEqual(rev.muse('03-ripple').inventory, ripple0.inventory);
  assert.ok(!rev.muse('02-moss').inventory.includes('wildflower'), 'no trade');
});

async function mcp(t, {sql} = {}) {
  const host = new ConnectedHost({sql: sql ?? t.sql, trust: t.trust, runtime: t.runtime, hooks: t.hooks, baseUrl: BASE, ownerRoot: () => t.ownerRoot, ownerClaimed: () => true, now: () => T0});
  host.init();
  const {row} = await host.keys.issue(OWNER_SLOT, T0);
  const tc = runtime => ({trust: t.trust, runtime, hooks: t.hooks, ownerRoot: t.ownerRoot, ownerClaimed: true, baseUrl: BASE, key: row, now: () => T0});
  return {call: (name, args, runtime = t.runtime) => runTool(tc(runtime), name, args)};
}

test('I-01 #2: a repeated command_id returns the stored result with no second reward; other arguments conflict; a stale version is refused', async () => {
  const t = await setup();
  const m = await mcp(t);
  t.edit(st => st.muses.find(x => x.id === OWNER_SLOT).inventory.push('wildflower', 'coffee'));
  const args = {to: '02-moss', give: 'wildflower', want: 'fruit', command_id: 'cmd-trade-0001'};
  const first = await m.call('propose_trade', args);
  assert.equal(first.isError, false); assert.equal(first.structuredContent.result, 'completed');
  assert.equal(first.structuredContent.command.command_id, 'cmd-trade-0001');
  assert.equal(first.structuredContent.command.duplicate, false);
  const after = worldOf(t.runtime), trades = t.events('trade_completed').length;
  const count = (id, item) => t.muse(id).inventory.filter(i => i === item).length;
  const receipts = count(OWNER_SLOT, 'trade_receipt');

  // Retry: same id, same arguments → the first result, nothing applied again.
  const again = await m.call('propose_trade', args);
  assert.equal(again.structuredContent.command.duplicate, true);
  assert.deepEqual(again.structuredContent.task, first.structuredContent.task);
  assert.equal(again.structuredContent.envelope.message_id, first.structuredContent.envelope.message_id, 'the first envelope evidence');
  assert.equal(worldOf(t.runtime), after, 'no second swap, no version change');
  assert.equal(t.events('trade_completed').length, trades);
  assert.equal(count(OWNER_SLOT, 'trade_receipt'), receipts, 'no second receipt');

  // The stored result survives a restart (a new runtime over the same SQLite).
  const restarted = new WorldRuntime(t.sql, {worldId: 'w', ledger: t.ledger, model: null, hooks: t.hooks});
  restarted.init(T0);
  const persisted = await m.call('propose_trade', args, restarted);
  assert.equal(persisted.structuredContent.command.duplicate, true);
  assert.equal(worldOf(restarted), after);

  // Same id, different arguments → command_conflict, nothing changes.
  const conflict = await m.call('propose_trade', {...args, give: 'coffee'});
  assert.equal(conflict.isError, true); assert.equal(conflict.structuredContent.refused, 'command_conflict');
  assert.equal(worldOf(t.runtime), after);
  assert.ok(t.events('command_refused').some(e => e.data.reason === 'command_conflict'));

  // A plan against an older world → stale_world (retryable), nothing changes.
  const v = (await m.call('get_world_state', {})).structuredContent.world_version;
  assert.equal(v, t.runtime.state().version);
  const greets = t.events('greet').length;
  const stale = await m.call('greet', {text: 'Hello again', command_id: 'cmd-greet-0001', expected_version: v - 1});
  assert.equal(stale.structuredContent.refused, 'stale_world');
  assert.equal(stale.structuredContent.retryable, true);
  assert.equal(stale.structuredContent.step, 'version', 'refused before any work, not discarded at the commit');
  assert.ok(t.events('command_refused').some(e => e.data.reason === 'stale_world' && e.data.command_id === 'cmd-greet-0001'));
  assert.equal(worldOf(t.runtime), after);
  assert.equal(t.events('greet').length, greets);
  // The current version commits; without a command_id the server picks one and reports what it used.
  const fresh = await m.call('greet', {text: 'Hello again', command_id: 'cmd-greet-0002', expected_version: v});
  assert.equal(fresh.isError, false); assert.equal(fresh.structuredContent.command.world_version, v + 1);
  const auto = await m.call('greet', {text: 'And hi'});
  assert.match(auto.structuredContent.command.command_id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(auto.structuredContent.command.expected_version, v + 1);

  // The owner Muse's A2A trade path is the same command path (CommandResult shape).
  const {ownerTrade} = await import('../worker/core/a2a.ts');
  t.edit(st => { place(st, OWNER_SLOT, 'commons:garden'); place(st, '05-bloom', 'commons:garden'); st.muses.find(x => x.id === OWNER_SLOT).inventory.push('pastry'); st.muses.find(x => x.id === '05-bloom').inventory.push('tea'); });
  const r = await ownerTrade(t.ctx, {label: 'cmd-test', plan: {partner: '05-bloom', give: 'pastry', want: 'tea'}});
  assert.equal(r.verdict, 'verified');
  for (const k of ['ok', 'commandId', 'worldVersion', 'eventIds']) assert.ok(k in r.command, k);
  assert.ok(Object.keys(r.command).every(k => ['ok', 'commandId', 'worldVersion', 'eventIds', 'error'].includes(k)));
  assert.equal(r.command.worldVersion, t.runtime.state().version);
});

// A resident (Moss) acting through executeCommand with its custodial executor.
async function mossCommand(t, over = {}) {
  const exec = await t.trust.executor('02-moss', 'server_custodial', t.ownerRoot);
  return signCommand(exec, {worldId: 'w', expectedVersion: t.runtime.state().version, action: 'greet', payload: {kind: 'greet', text: 'hi'}, recipient: worldHandler('w'), scope: 'walk_and_greet', ownerClaimed: true, now: T0, ...over});
}
const giveCoffee = (st, emit, at) => { st.muses.find(m => m.id === '02-moss').inventory.push('coffee'); emit({at, source: 'live', kind: 'gift', muse: '02-moss', data: {}, tags: []}); return {ok: true, output: {got: 'coffee'}}; };

test('I-01 #3: if the world moves or the delegation is revoked while the model answers, the answer is settled but not committed', async () => {
  const t = await setup();
  let release;
  const fetcher = async () => { await new Promise(r => { release = r; }); return new Response(JSON.stringify({id: 'c1', usage: {prompt_tokens: 200, completion_tokens: 100}, choices: [{message: {content: JSON.stringify({ok: true})}}]}), {headers: {'x-request-id': 'req-late'}}); };
  let n = 0;
  // The model step reserves before the call and settles right after it, whether or not the answer is used.
  const think = () => async () => {
    const id = `w:cmd-think:${n++}`;
    assert.equal(t.ledger.reserve({id, tier: 'world', session: 'world', ip: '', action: 'trade', maxCostUsd: 0.01}).ok, true);
    const res = await callModel({base: 'https://api.meta.ai/v1', key: 'k', model: 'muse-spark-1.3', timeoutMs: 5000, fetcher}, 'trade', [{role: 'user', content: 'x'}]);
    t.ledger.settle(id, 0.002, res.ok ? 'live' : 'error');
    return res;
  };
  const run = async (cmd, during) => {
    const p = executeCommand(t, cmd, {recipient: worldHandler('w'), think: think(), apply: giveCoffee}, T0);
    while (!release) await sleep(1);
    await during();
    const r = release; release = null; r();
    return p;
  };
  const coffee = () => t.muse('02-moss').inventory.filter(i => i === 'coffee').length;
  const c0 = coffee();

  // World moved during the await → stale_world, decision_discarded, settled, no commit, no stored result.
  const a = await mossCommand(t);
  const spent0 = t.ledger.status().spentUsd;
  const ra = await run(a, async () => { t.edit(st => { st.muses[0].reflection = 'someone else committed'; }); });
  assert.deepEqual([ra.result.ok, ra.result.error], [false, {code: 'stale_world', retryable: true}]);
  assert.ok(t.events('decision_discarded').some(e => e.data.command_id === a.commandId && e.data.reason.includes('world changed')));
  assert.equal(coffee(), c0, 'the late answer did not run');
  assert.ok(t.ledger.status().spentUsd > spent0, 'the model call was settled');
  assert.equal(t.runtime.commandRow(a.actorId, a.commandId), null, 'not stored as a result');

  // Delegation revoked during the await → delegation_revoked, settled, no commit.
  const b = await mossCommand(t);
  const spent1 = t.ledger.status().spentUsd, before = worldOf(t.runtime);
  const rb = await run(b, () => t.trust.revoke('02-moss'));
  assert.equal(rb.result.error.code, 'delegation_revoked');
  assert.ok(t.events('decision_discarded').some(e => e.data.command_id === b.commandId && e.data.reason === 'delegation revoked before commit'));
  assert.equal(worldOf(t.runtime), before, 'state and version unchanged');
  assert.ok(t.ledger.status().spentUsd > spent1);

  // Control: nothing moved → the answer commits once.
  t.trust.redelegate('02-moss');
  const c = await mossCommand(t);
  const rc = await run(c, async () => {});
  assert.equal(rc.result.ok, true);
  assert.equal(coffee(), c0 + 1);
  assert.equal(t.ledger.status().liveCalls, 3, 'every answer was settled as a live call');
});

test('I-01 #4: a missing approval, another content hash, an expired message or the wrong recipient leaves the world unchanged', async () => {
  const t = await setup();
  const moss = t.trust.agentByMuse('02-moss').agentId, ripple = t.trust.agentByMuse('03-ripple').agentId;
  const handler = {recipient: worldHandler('w'), apply: giveCoffee};
  const approval = {action: 'confirm_meetup', scope: 'confirm_delivery', payload: {kind: 'confirm_meetup', time: '17:30', place: 'Andytown Coffee'}};
  const refusedWith = async (cmd, code, now = T0) => {
    const before = worldOf(t.runtime), seen = t.events().length;
    const r = await executeCommand(t, cmd, handler, now);
    assert.deepEqual([r.result.ok, r.result.error?.code], [false, code]);
    assert.deepEqual(Object.keys(r.result.error).sort(), ['code', 'retryable'], 'no private reasons in the result');
    assert.equal(worldOf(t.runtime), before, code + ': state and version unchanged');
    assert.equal(t.runtime.commandRow(cmd.actorId, cmd.commandId), null, code + ': nothing stored');
    assert.ok(t.events().slice(seen).some(e => e.kind === 'command_refused' && e.data.reason === code), code + ': refusal logged');
  };

  // Approval scope without an approval.
  await refusedWith(await mossCommand(t, approval), 'approval_required');
  // An approval for a different content hash (the owner approved 18:00, the message says 17:30).
  const other = commandContent({worldId: 'w', expectedVersion: t.runtime.state().version, action: approval.action, payload: {...approval.payload, time: '18:00'}});
  t.trust.recordApproval('appr-other', await contentHash(other), moss);
  await refusedWith(await mossCommand(t, {...approval, approvalRef: 'appr-other'}), 'approval_mismatch');
  // The body changed after signing: wrapper only → bad_command; wrapper and signed content → content_mismatch.
  const signed = await mossCommand(t);
  await refusedWith({...signed, payload: {kind: 'greet', text: 'pay me'}}, 'bad_command');
  const body = {...signed.signed.content, payload: {kind: 'greet', text: 'pay me'}};
  await refusedWith({...signed, payload: body.payload, signed: {...signed.signed, content: body}}, 'content_mismatch');
  // Expired message.
  await refusedWith(await mossCommand(t, {ttlMs: 1}), 'expired', T0 + 5_000);
  // Validly signed, but addressed to Ripple, not to this world.
  const misaddressed = await mossCommand(t, {recipient: ripple, commandId: 'cmd-recipient-01'});
  await refusedWith(misaddressed, 'wrong_recipient');

  // None of the refusals burned the nonce or message id: the same id, correctly addressed and approved, commits once.
  const good = await mossCommand(t, {...approval, approvalRef: 'appr-good', commandId: 'cmd-recipient-01'});
  t.trust.recordApproval('appr-good', good.signed.envelope.content_hash, moss);
  const ok = await executeCommand(t, good, handler, T0);
  assert.equal(ok.result.ok, true);
  assert.ok(t.muse('02-moss').inventory.includes('coffee'));

  // verifyEnvelope itself compares the recipient (before the nonce is claimed).
  const root = await generateKeyPair(), exec = await generateKeyPair();
  const token = await issueDelegation(root, exec, {signerKind: 'browser', version: 1, ttlMs: 3_600_000});
  const reg = new MemoryRegistry(); reg.roots.set(root.kid, root.publicJwk);
  const s = await signEnvelope(exec, token, peekDelegation(token), {recipient: 'moss', action: 'greet', scope: 'walk_and_greet', content: {text: 'hi'}, ownerClaimed: true});
  assert.deepEqual(await verifyEnvelope(s, reg, Date.now(), {recipient: 'ink'}).then(v => [v.ok, v.reason, v.step]), [false, 'wrong_recipient', 'recipient']);
  assert.equal((await verifyEnvelope(s, reg, Date.now(), {recipient: 'moss'})).ok, true, 'the refused check did not consume the nonce');
});
