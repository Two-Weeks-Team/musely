// I-01 (#47): every shared-state write is verified before side effects and commits once.
// The same Trust + WorldRuntime + ConnectedHost the world Durable Object uses, over node:sqlite.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime, REFUSAL_WINDOW_MS} from '../worker/core/world-runtime.ts';
import {Trust, OWNER_SLOT} from '../worker/core/trust.ts';
import {MeetingCheck} from '../worker/core/a2a.ts';
import {ConnectedHost} from '../worker/core/connected.ts';
import {hashAgentKey} from '../worker/core/agent-keys.ts';
import {runTool} from '../worker/core/mcp-tools.ts';
import {executeCommand, signCommand, commandContent, worldHandler} from '../worker/core/commands.ts';
import {callModel} from '../worker/core/model.ts';
import {signEnvelope, verifyEnvelope, MemoryRegistry, contentHash} from '../src/identity/envelope.ts';
import {generateKeyPair} from '../src/identity/jws.ts';
import {issueDelegation, peekDelegation} from '../src/identity/delegation.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {TICK_MS} from '../src/engine/world.ts';

// Like Durable Object SQL: transaction statements are refused (only transactionSync opens a transaction).
const TX_SQL = /^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i;
// transactionSync stands in for ctx.storage.transactionSync (a savepoint that rolls back on a throw);
// `faults.match` makes matching statements throw, to prove a commit is all or nothing.
const sqlite = (faults = {match: null}) => { const db = new DatabaseSync(':memory:'); let depth = 0; return {faults, exec(q, ...b) { if (TX_SQL.test(q)) throw new Error('Durable Object SQL rejects transaction statements; use transactionSync'); if (faults.match?.test(q)) throw new Error('injected fault'); const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }, transactionSync(fn) { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('transactionSync callback must be synchronous'); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } }}; };
// Delegations carry a real 24 h expiry, so the test clock starts at the real time.
const T0 = Math.floor(Date.now() / 60_000) * 60_000;
const BASE = 'https://musely.net';
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Waits for a condition, failing (not hanging) after `ms`. */
const until = async (cond, ms = 3000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('condition not reached'); await sleep(1); } };

// meetings: true = the real gate, 'missing' = no gate configured (must fail closed), false = explicit test 'off'.
async function setup({model = null, meetings = false, sql = sqlite(), gateFn = null} = {}) {
  const ledger = new Ledger(sql, {dailyCapUsd: 5}); ledger.init();
  const trust = new Trust(sql); trust.init();
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const ownerRoot = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await trust.ensureAgents(ownerRoot);
  const hooks = makeHooks();
  const cred = {trust, ownerRoot, ownerClaimed: true, baseUrl: BASE};
  const gate = {check: new MeetingCheck(() => cred), prepared: null};
  const meetingGate = gateFn ?? (meetings === true ? async (s, now) => { const g = await gate.check.prepare(s, now); gate.prepared?.(); return g; } : meetings === 'missing' ? undefined : 'off');
  const runtime = new WorldRuntime(sql, {worldId: 'w', ledger, model, hooks, delegationValid: m => !trust.suspended(m), meetingGate});
  runtime.init(T0);
  const ctx = {trust, runtime, ownerRoot, ownerClaimed: true, baseUrl: BASE};
  const muse = id => runtime.state().muses.find(m => m.id === id);
  const edit = fn => runtime.commitExternal(T0, 'test-' + Math.random().toString(36).slice(2), st => fn(st));
  const events = kind => runtime.events(0, 2000).filter(e => !kind || e.kind === kind);
  return {sql, ledger, trust, runtime, ownerRoot, hooks, ctx, gate, muse, edit, events, meetingGate};
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
  // Only the spotlight call waits; later calls (other meetings' answers) return at once.
  let waiting = true;
  const slow = async (_u, init) => { if (waiting) { waiting = false; await new Promise(r => { release = r; }); } const out = {freedom: 'where', decision: 'stay', target_place: '', target_agent: '', offer_item: '', want_item: '', public_reason: 'here', line: 'Staying'}; void init; return new Response(JSON.stringify({id: 'c', usage: {prompt_tokens: 10, completion_tokens: 10}, choices: [{message: {content: JSON.stringify(out)}}]})); };
  const rev = await setup({meetings: true, model: {base: 'https://api.meta.ai/v1', key: 'k', model: 'muse-spark-1.3', timeoutMs: 5000, fetcher: (...a) => slow(...a)}});
  rev.edit(arrangeMeeting);
  const prepared = new Promise(r => { rev.gate.prepared = r; });
  const t2 = rev.runtime.state().tick, ripple0 = rev.muse('03-ripple');
  const beat = rev.runtime.heartbeat(T0);
  await prepared;
  await rev.trust.revoke('03-ripple');
  await until(() => release);
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
  const {row, key} = await host.keys.issue(OWNER_SLOT, T0);
  const tc = runtime => ({trust: t.trust, runtime, hooks: t.hooks, ownerRoot: t.ownerRoot, ownerClaimed: true, baseUrl: BASE, key: row, now: () => T0});
  return {host, keyHash: await hashAgentKey(key), call: (name, args, runtime = t.runtime) => runTool(tc(runtime), name, args)};
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
  assert.equal(auto.structuredContent.command.expected_version, null, 'omitted: no version was checked');
  assert.equal(auto.structuredContent.command.world_version, t.runtime.state().version, 'the version it committed at');

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

test('I-01 #3: if the world moves or the delegation is revoked while the model answers, the answer is settled (by executeCommand) but not committed', async () => {
  const t = await setup();
  let release;
  const fetcher = async () => { await new Promise(r => { release = r; }); return new Response(JSON.stringify({id: 'c1', usage: {prompt_tokens: 200, completion_tokens: 100}, choices: [{message: {content: JSON.stringify({ok: true})}}]}), {headers: {'x-request-id': 'req-late'}}); };
  let n = 0;
  // The model step reserves before the call and only hands back settle(): executeCommand must call it,
  // whether the answer commits or is discarded.
  const think = () => async () => {
    const id = `w:cmd-think:${n++}`;
    assert.equal(t.ledger.reserve({id, tier: 'world', session: 'world', ip: '', action: 'trade', maxCostUsd: 0.01}).ok, true);
    const res = await callModel({base: 'https://api.meta.ai/v1', key: 'k', model: 'muse-spark-1.3', timeoutMs: 5000, fetcher}, 'trade', [{role: 'user', content: 'x'}]);
    return {thought: res, settle: () => t.ledger.settle(id, 0.002, res.ok ? 'live' : 'error')};
  };
  const run = async (cmd, during) => {
    const p = executeCommand(t, cmd, {recipient: worldHandler('w'), think: think(), apply: giveCoffee}, T0);
    await until(() => release);
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
  assert.equal((await verifyEnvelope(s, reg, Date.now(), undefined)).reason, 'wrong_recipient', 'no expectation → refused (fail closed)');
  assert.equal((await verifyEnvelope(s, reg, Date.now(), {recipient: 'moss'})).ok, true, 'the refused check did not consume the nonce');
});

// ---------------- review follow-ups (#47 independent review) ----------------

const blocked = t => t.runtime.state().inbox?.notifications?.filter(n => n.kind === 'blocked').length ?? 0;
const coffeeOf = t => t.muse('02-moss').inventory.filter(i => i === 'coffee').length;
// A think step that waits until the test releases it (every waiter, so a broken guard fails instead of hanging).
const gated = () => { const waiters = [], g = {waiting: () => waiters.length > 0, release: () => waiters.splice(0).forEach(r => r())}; g.think = async () => { await new Promise(r => waiters.push(r)); return {thought: 'ok'}; }; return g; };

test('review 1: verification spends no nonce; the commit claims it — retry after stale_world works, concurrent duplicates commit once', async () => {
  const t = await setup();
  const m = await mcp(t);
  const v = (await m.call('get_world_state', {})).structuredContent.world_version;
  // stale_world (retryable) → the same id with the current version succeeds, no Blocked notice, no p0_refused.
  const stale = await m.call('greet', {text: 'Hi there', command_id: 'cmd-retry-0001', expected_version: v + 7});
  assert.equal(stale.structuredContent.refused, 'stale_world');
  assert.equal(stale.structuredContent.retryable, true);
  const retry = await m.call('greet', {text: 'Hi there', command_id: 'cmd-retry-0001', expected_version: v});
  assert.equal(retry.isError, false, 'not refused as replay');
  assert.equal(retry.structuredContent.command.duplicate, false);
  assert.equal(blocked(t), 0, 'no Blocked notice for a stale plan');
  assert.ok(!t.events().some(e => e.tags.includes('p0_refused')));

  // Concurrent duplicates: one commits, the other is in_progress (retryable); then the stored result.
  const g = gated();
  const cmd = await mossCommand(t);
  const c0 = coffeeOf(t);
  // Deterministic order: the first call holds the command (waiting in think); the duplicate is answered while it is
  // held; only then is the first released. (A fixed sleep here raced under a loaded full run.)
  const first = executeCommand(t, cmd, {recipient: worldHandler('w'), think: g.think, apply: giveCoffee}, T0);
  await until(g.waiting);
  const b = await Promise.race([executeCommand(t, cmd, {recipient: worldHandler('w'), think: g.think, apply: giveCoffee}, T0), sleep(3000).then(() => ({result: {error: 'the duplicate waited instead of answering in_progress'}}))]);
  g.release();
  const a = await first;
  assert.deepEqual([a.result.ok, b.result.error], [true, {code: 'in_progress', retryable: true}]);
  assert.equal(coffeeOf(t), c0 + 1, 'one commit');
  const later = await executeCommand(t, cmd, {recipient: worldHandler('w'), apply: giveCoffee}, T0);
  assert.equal(later.duplicate, true); assert.equal(coffeeOf(t), c0 + 1);

  // A refusal after the envelope check leaves the nonce unspent: the same signed command commits afterwards.
  const peerFirst = await mossCommand(t);
  const e = peerFirst.signed.envelope;
  const no = await executeCommand(t, peerFirst, {recipient: worldHandler('w'), counterparty: async () => ({ok: false, reason: 'counterparty_card_untrusted_key'}), apply: giveCoffee}, T0);
  assert.equal(no.result.error.code, 'counterparty_card_untrusted_key');
  assert.equal(t.trust.nonceSeen(e.agent_id, e.nonce, e.message_id), false, 'nonce still unspent');
  const yes = await executeCommand(t, peerFirst, {recipient: worldHandler('w'), counterparty: async () => ({ok: true, current: () => true}), apply: giveCoffee}, T0);
  assert.equal(yes.result.ok, true);
  assert.equal(t.trust.nonceSeen(e.agent_id, e.nonce, e.message_id), true, 'spent by the commit');
});

test('review 2: a revoked actor cannot read its stored results', async () => {
  const t = await setup();
  const m = await mcp(t);
  t.edit(st => st.muses.find(x => x.id === OWNER_SLOT).inventory.push('wildflower'));
  const args = {to: '02-moss', give: 'wildflower', want: 'fruit', command_id: 'cmd-revoked-01'};
  assert.equal((await m.call('propose_trade', args)).isError, false);
  await t.trust.revoke(OWNER_SLOT);
  const r = await m.call('propose_trade', args);
  assert.equal(r.structuredContent.refused, 'delegation_revoked', 'revoked before the stored-result lookup');
  assert.equal(r.structuredContent.step, 'delegation');
  assert.equal(r.structuredContent.task, undefined, 'no stored result leaks');
});

test('review 4: a commit is all or nothing — a failing result write rolls back state, events and the nonce claim', async () => {
  const t = await setup();
  const cmd = await mossCommand(t), e = cmd.signed.envelope;
  const before = worldOf(t.runtime), seen = t.events().length, c0 = coffeeOf(t);
  t.sql.faults.match = /^INSERT INTO commands/;
  await assert.rejects(executeCommand(t, cmd, {recipient: worldHandler('w'), apply: giveCoffee}, T0), /injected fault/);
  t.sql.faults.match = null;
  assert.equal(worldOf(t.runtime), before, 'state and version rolled back');
  assert.equal(coffeeOf(t), c0);
  assert.equal(t.events().length, seen, 'no events written');
  assert.equal(t.runtime.commandRow(cmd.actorId, cmd.commandId), null);
  assert.equal(t.trust.nonceSeen(e.agent_id, e.nonce, e.message_id), false, 'the nonce claim rolled back too');
  assert.equal((await executeCommand(t, cmd, {recipient: worldHandler('w'), apply: giveCoffee}, T0)).result.ok, true, 'the same command commits once the fault is gone');
});

test('review 5: a refused rule moves the version only if the state changed; the result is stored either way', async () => {
  const t = await setup();
  const m = await mcp(t);
  const here = t.muse(OWNER_SLOT).place, v0 = t.runtime.state().version;
  const same = await m.call('move', {to: here, command_id: 'cmd-rule-0001'});
  assert.equal(same.structuredContent.refused, 'already_here');
  assert.equal(t.runtime.state().version, v0, 'nothing changed → same version');
  assert.equal((await m.call('move', {to: here, command_id: 'cmd-rule-0001'})).structuredContent.command.duplicate, true, 'stored');
  // A rule refusal that does change state (the Task expires now) moves the version.
  t.edit(st => { st.inbox.tasks.push({id: 'task_old', kind: 'trade', from: '02-moss', to: OWNER_SLOT, status: 'pending', awaiting: OWNER_SLOT, createdAt: T0 - 3_600_000, deadline: T0 - 1, updatedAt: T0 - 3_600_000, offer: {by: '02-moss', give: 'fruit', want: 'coffee'}, round: 0, history: []}); });
  const v1 = t.runtime.state().version;
  const late = await m.call('accept_trade', {task_id: 'task_old', command_id: 'cmd-rule-0002'});
  assert.equal(late.structuredContent.refused, 'task_expired');
  assert.equal(t.runtime.state().version, v1 + 1);
  assert.equal(t.runtime.state().inbox.tasks.find(x => x.id === 'task_old').status, 'expired');
});

test('review 6: discover after moving is the same command (the place is not in the hash)', async () => {
  const t = await setup();
  const m = await mcp(t);
  t.edit(st => place(st, OWNER_SLOT, 'commons:cafe'));
  const first = await m.call('discover', {command_id: 'cmd-discover-1'});
  assert.equal(first.isError, false); assert.equal(first.structuredContent.place.id, 'commons:cafe');
  t.edit(st => place(st, OWNER_SLOT, 'commons:garden'));
  const finds = JSON.stringify(t.runtime.state().items.finds);
  const again = await m.call('discover', {command_id: 'cmd-discover-1'});
  assert.equal(again.structuredContent.command.duplicate, true, 'not command_conflict');
  assert.equal(again.structuredContent.place.id, 'commons:cafe', 'the first result');
  assert.equal(JSON.stringify(t.runtime.state().items.finds), finds, 'no second find at the new place');
});

test('review 7: ownerTrade is ok only when the trade committed; a rule rejection is rejected:<rule>', async () => {
  const t = await setup();
  const {ownerTrade} = await import('../worker/core/a2a.ts');
  t.edit(st => { place(st, OWNER_SLOT, 'commons:garden'); place(st, '05-bloom', 'commons:garden'); st.muses.find(x => x.id === '05-bloom').inventory.push('tea'); });
  const r = await ownerTrade(t.ctx, {label: 'review-7', plan: {partner: '05-bloom', give: 'pastry', want: 'tea'}});
  assert.deepEqual([r.ok, r.verdict], [false, 'rejected:not_held']);
  t.edit(st => st.muses.find(x => x.id === OWNER_SLOT).inventory.push('pastry'));
  const ok = await ownerTrade(t.ctx, {label: 'review-7b', plan: {partner: '05-bloom', give: 'pastry', want: 'tea'}});
  assert.deepEqual([ok.ok, ok.verdict], [true, 'verified']);
});

test('review 8: repeated refusals collapse into one event per (actor, code, step) and window, across restarts', async () => {
  const t = await setup();
  const m = await mcp(t);
  const v = t.runtime.state().version;
  for (let i = 0; i < 5; i++) assert.equal((await m.call('greet', {text: 'Hi', command_id: `cmd-flood-000${i}`, expected_version: v + 1})).structuredContent.refused, 'stale_world');
  const ev = t.events('command_refused').filter(e => e.data.reason === 'stale_world');
  assert.equal(ev.length, 1, 'one event');
  assert.equal(t.runtime.refusalCount(ev[0].data.dedup_key), 5, 'all five counted');
  // A refusal that changes nothing does not rewrite the world row (an UPDATE would throw here).
  t.sql.faults.match = /^UPDATE world/;
  assert.equal((await m.call('greet', {text: 'Hi', command_id: 'cmd-flood-0009', expected_version: v + 1})).structuredContent.refused, 'stale_world');
  t.sql.faults.match = null;
  assert.equal(t.runtime.refusalCount(ev[0].data.dedup_key), 6);
  // After the window a new event opens.
  const exec = await t.trust.executor(OWNER_SLOT, 'server_custodial', t.ownerRoot);
  const late = await signCommand(exec, {worldId: 'w', expectedVersion: v + 1, action: 'greet', payload: {kind: 'greet', text: 'Hi', to: null}, recipient: worldHandler('w'), scope: 'walk_and_greet', ownerClaimed: true, now: T0, ttlMs: 2 * REFUSAL_WINDOW_MS});
  const later = await executeCommand(t, late, {recipient: worldHandler('w'), apply: giveCoffee}, T0 + REFUSAL_WINDOW_MS + 1);
  assert.equal(later.result.error.code, 'stale_world');
  assert.equal(t.events('command_refused').filter(e => e.data.reason === 'stale_world').length, 2, 'a new window opens a new event');

  // Meeting refusals: one event per pair across a DO restart (new runtime and gate over the same SQLite).
  const imp = await setup({meetings: true});
  imp.edit(arrangeMeeting);
  imp.sql.exec('UPDATE agents SET root_jwk = ? WHERE muse_id = ?', JSON.stringify((await generateKeyPair()).publicJwk), '02-moss');
  await imp.runtime.heartbeat(T0);
  const restarted = new WorldRuntime(imp.sql, {worldId: 'w', ledger: imp.ledger, model: null, hooks: imp.hooks, meetingGate: imp.meetingGate});
  restarted.init(T0);
  await restarted.heartbeat(T0 + TICK_MS);
  const refusals = restarted.events(0, 5000).filter(e => e.kind === 'meeting_refused' && [e.muse, e.other].includes('02-moss') && [e.muse, e.other].includes('03-ripple'));
  assert.equal(refusals.length, 1);
  assert.equal(restarted.refusalCount(refusals[0].data.dedup_key), 2);

  // The fallback when the check itself fails uses the same dedup.
  const down = await setup({gateFn: async () => { throw new Error('crypto down'); }});
  down.edit(arrangeMeeting);
  await down.runtime.heartbeat(T0);
  await down.runtime.heartbeat(T0 + TICK_MS);
  const un = down.events('meeting_refused').filter(e => e.data.reason === 'verification_unavailable' && [e.muse, e.other].includes('02-moss') && [e.muse, e.other].includes('03-ripple'));
  assert.equal(un.length, 1);
  assert.equal(down.runtime.refusalCount(un[0].data.dedup_key), 2);
  assert.ok(!down.events('greet').some(e => [e.muse, e.other].includes('02-moss') && [e.muse, e.other].includes('03-ripple')), 'nobody met');
});

test('review 9: heartbeat_check by a revoked Muse reads but writes nothing', async () => {
  const t = await setup();
  const m = await mcp(t);
  t.edit(st => {
    st.inbox.tasks.push({id: 'task_due', kind: 'trade', from: '02-moss', to: OWNER_SLOT, status: 'pending', awaiting: OWNER_SLOT, createdAt: T0 - 3_600_000, deadline: T0 - 1, updatedAt: T0 - 3_600_000, offer: {by: '02-moss', give: 'fruit', want: 'coffee'}, round: 0, history: []});
    st.inbox.messages.push({id: 'msg_1', from: '02-moss', to: OWNER_SLOT, kind: 'greet', at: T0, text: 'hello', read: false, blocked: []});
  });
  await t.trust.revoke(OWNER_SLOT);
  const before = JSON.stringify(t.runtime.state()), seen = t.events().length;
  const hb = await m.call('heartbeat_check', {});
  assert.equal(hb.structuredContent.read_only, true);
  assert.equal(hb.structuredContent.messages.length, 1, 'still readable');
  assert.equal(JSON.stringify(t.runtime.state()), before, 'no expiry mark, no read receipt, same version');
  assert.equal(t.events().length, seen);
  t.trust.redelegate(OWNER_SLOT);
  const live = await m.call('heartbeat_check', {});
  assert.equal(live.structuredContent.read_only, false);
  assert.equal(t.runtime.state().inbox.tasks.find(x => x.id === 'task_due').status, 'expired', 'an active Muse marks expiry as before');
});

test('review 10: event ids name the actor; no gate configured means nobody meets; a missing executor answers in the command shape', async () => {
  const t = await setup();
  const cmd = await mossCommand(t);
  const r = await executeCommand(t, cmd, {recipient: worldHandler('w'), apply: giveCoffee}, T0);
  assert.ok(r.result.eventIds.length && r.result.eventIds.every(id => id.includes(cmd.actorId)));

  const closed = await setup({meetings: 'missing'});
  closed.edit(arrangeMeeting);
  const tick = closed.runtime.state().tick;
  await closed.runtime.heartbeat(T0);
  assert.deepEqual(pairEvents(closed, tick).map(e => [e.kind, e.data.reason]), [['meeting_refused', 'verification_not_configured']]);

  const fresh = await setup();
  const m = await mcp(fresh);
  await fresh.trust.revoke(OWNER_SLOT);
  const w = await m.call('greet', {text: 'Hello?', command_id: 'cmd-noexec-01'});
  assert.equal(w.structuredContent.refused, 'delegation_revoked');
  assert.equal(w.structuredContent.retryable, false);
  assert.deepEqual(Object.keys(w.structuredContent.command).sort(), ['applied', 'command_id', 'committed', 'duplicate', 'expected_version', 'world_version']);
  assert.equal(w.structuredContent.command.command_id, 'cmd-noexec-01');
  assert.deepEqual([w.structuredContent.command.committed, w.structuredContent.command.applied], [false, false]);
});

// ---------------- PR #87 re-review ----------------

test('re-review 2: a revoked Muse using its key through the host does not change the world (no connected mark)', async () => {
  const t = await setup();
  const m = await mcp(t);
  await t.trust.revoke(OWNER_SLOT);
  const before = JSON.stringify(t.runtime.state()), seen = t.events().length;
  assert.equal((await m.host.mcp(m.keyHash, 'tools/list', {}, false)).status, 'ok');
  const ws = await m.host.mcp(m.keyHash, 'tools/call', {name: 'get_world_state', arguments: {}}, false);
  assert.equal(ws.result.isError, false, 'reads still work');
  assert.equal(JSON.stringify(t.runtime.state()), before, 'no connected flag, same version');
  assert.equal(t.events().length, seen, 'no agent_connected event');
  t.trust.redelegate(OWNER_SLOT);
  await m.host.mcp(m.keyHash, 'ping', {}, false);
  assert.equal(t.runtime.state().inbox.connected[OWNER_SLOT], T0, 'an active Muse is marked as before');
});

test('re-review 3: without expected_version the world may move before the commit; no stale_world', async () => {
  const t = await setup();
  const g = gated();
  const cmd = await mossCommand(t, {expectedVersion: null});
  t.edit(st => { st.muses[0].reflection = 'moved after signing'; });
  const p = executeCommand(t, cmd, {recipient: worldHandler('w'), think: g.think, apply: giveCoffee}, T0);
  await until(g.waiting);
  t.edit(st => { st.muses[0].reflection = 'moved during think'; });
  const v = t.runtime.state().version;
  g.release();
  const r = await p;
  assert.equal(r.result.ok, true, 'not refused, not discarded');
  assert.equal(r.result.worldVersion, v + 1, 'the version it really committed at');
  // Through MCP: omitted → the response says expected_version null and the committed world_version.
  const m = await mcp(t);
  const w = await m.call('greet', {text: 'Hi'});
  assert.deepEqual([w.isError, w.structuredContent.command.expected_version, w.structuredContent.command.world_version], [false, null, t.runtime.state().version]);
});

test('re-review 4: without think, a commit-time refusal is an ordinary refusal (not decision_discarded)', async () => {
  const t = await setup();
  const cmd = await mossCommand(t);
  const seen = t.events().length;
  // The actor is revoked while the counterparty check runs, i.e. after verification and before the commit.
  const r = await executeCommand(t, cmd, {recipient: worldHandler('w'), counterparty: async () => { await t.trust.revoke('02-moss'); return {ok: true, current: () => true}; }, refused: (_st, emit, x, at) => emit({at, source: 'live', kind: 'a2a_refused', muse: '02-moss', data: {step: x.step, reason: x.code}, tags: ['p0_refused']}), apply: giveCoffee}, T0);
  assert.deepEqual([r.result.error.code, r.refused.step], ['delegation_revoked', 'commit']);
  const ev = t.events().slice(seen);
  assert.deepEqual(ev.map(e => e.kind), ['a2a_refused'], 'the handler logged it, with its tags');
  assert.ok(ev[0].tags.includes('p0_refused'));
});

test('re-review 5: a closed refusal window leaves a refusal_repeats summary; the key names the other side', async () => {
  const t = await setup();
  const m = await mcp(t);
  const v = t.runtime.state().version;
  for (let i = 0; i < 4; i++) await m.call('greet', {text: 'Hi', command_id: `cmd-repeat-000${i}`, expected_version: v + 1});
  const key = t.events('command_refused').find(e => e.data.reason === 'stale_world').data.dedup_key;
  assert.ok(key.includes('>' + worldHandler('w') + ':'), key);
  assert.equal(t.events('refusal_repeats').length, 0, 'still inside the window');
  await t.runtime.heartbeat(T0 + REFUSAL_WINDOW_MS + 1);
  const sum = t.events('refusal_repeats');
  assert.equal(sum.length, 1);
  assert.deepEqual([sum[0].data.dedup_key, sum[0].data.repeat_count, sum[0].data.suppressed], [key, 4, 3]);
  assert.equal(t.runtime.refusalCount(key), 0, 'the window was closed');
});

test('re-review 6: think and counterparty have a deadline', async () => {
  const t = await setup();
  const never = () => new Promise(() => {});
  const short = {...t, deadlineMs: 30};
  const a = await executeCommand(short, await mossCommand(t), {recipient: worldHandler('w'), think: never, apply: giveCoffee}, T0);
  assert.equal(a.result.error.code, 'decision_unavailable');
  const b = await executeCommand(short, await mossCommand(t), {recipient: worldHandler('w'), counterparty: never, apply: giveCoffee}, T0);
  assert.equal(b.result.error.code, 'counterparty_unavailable');
  assert.equal(t.runtime.pending.size, 0, 'nothing left in flight');
});

test('re-review 7: refusals without an envelope (no executor) are deduplicated too', async () => {
  const t = await setup();
  const m = await mcp(t);
  await t.trust.revoke(OWNER_SLOT);
  for (let i = 0; i < 3; i++) assert.equal((await m.call('greet', {text: 'Hello?'})).structuredContent.refused, 'delegation_revoked');
  const ev = t.events('a2a_refused').filter(e => e.data.envelope === null);
  assert.equal(ev.length, 1);
  assert.equal(t.runtime.refusalCount(ev[0].data.dedup_key), 3);
  assert.equal(blocked(t), 1, 'one Blocked notice');
});

test('re-review 8: like Durable Object SQL, transaction statements and async commits are refused', async () => {
  const t = await setup();
  assert.throws(() => t.sql.exec('BEGIN'), /transaction statements/);
  assert.throws(() => t.sql.exec('SAVEPOINT x'), /transaction statements/);
  assert.throws(() => t.sql.transactionSync(async () => 1), /synchronous/);
  const before = worldOf(t.runtime);
  assert.throws(() => t.runtime.commitExternal(T0, 'async', async st => { st.muses[0].inventory.push('coffee'); }), /synchronous/);
  assert.equal(worldOf(t.runtime), before, 'nothing committed');
});
