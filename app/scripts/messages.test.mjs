// I-13 (#57) acceptance: postcards, gifts, campfire invites and help Tasks (worker/core/messages.ts).
// Every call goes through the real /mcp handler (handleMcpHttp) into the same ConnectedHost + Trust + WorldRuntime the
// world Durable Object uses, over node:sqlite; ticks run through WorldRuntime.heartbeat (so the invite upkeep runs as in
// production). One test per acceptance criterion (AC1–AC5 of the issue), the last one end to end with two connected Muses.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Trust, OWNER_SLOT} from '../worker/core/trust.ts';
import {ConnectedHost} from '../worker/core/connected.ts';
import {handleMcpHttp} from '../worker/core/mcp-server.ts';
import {connectedRoutes} from '../worker/core/owner-api.ts';
import {issueOwnerSession, readOwnerSession} from '../worker/core/owner-session.ts';
import {revokeMuse, redelegateMuse, delegationStatus} from '../worker/core/owner-control.ts';
import {statusOf, taskRecord} from '../worker/core/tasks.ts';
import {CAMPFIRE, INVITE_TTL_MS, HELP_SERVICES} from '../worker/core/messages.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {PLACES, placeById, distanceM, WALK_MPS} from '../src/engine/places.ts';
import {verifyHistory} from '../src/engine/items.ts';
import {TICK_MS} from '../src/engine/world.ts';
import {TASK_TTL_MS} from '../src/engine/inbox.ts';

const TX_SQL = /^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i;
const sqlite = () => { const db = new DatabaseSync(':memory:'); let depth = 0; return {exec(q, ...b) { if (TX_SQL.test(q)) throw new Error('use transactionSync'); const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }, transactionSync(fn) { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } }}; };
// Delegations carry a real 24 h expiry, so the test clock starts at the real time.
const T0 = Math.floor(Date.now() / 60_000) * 60_000;
const SECRET = 'test-session-secret', HOST = 'https://musely.net';
const TOKENS = {owner: 'owner-control-token-for-tests-000001', peer: 'demo-peer-control-token-for-tests-02'};
const OWNER_CFG = {secret: SECRET, tokens: TOKENS, origins: [HOST]};
const COPPER = '09-copper';

/** `peer`: also issue the demo peer's key, so Copper is a connected Muse (live) once that key is used. */
async function setup({claimed = true, peer = false} = {}) {
  const clock = {now: T0};
  const sql = sqlite(), ledger = new Ledger(sql, {dailyCapUsd: 1}); ledger.init();
  const trust = new Trust(sql); trust.init();
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const ownerRoot = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await trust.ensureAgents(ownerRoot);
  const hooks = makeHooks();
  const runtime = new WorldRuntime(sql, {worldId: 'w', meetingGate: 'off', ledger, model: null, hooks, delegationValid: m => !trust.suspended(m)});
  runtime.init(T0);
  const host = new ConnectedHost({sql, trust, runtime, hooks, baseUrl: HOST, ownerRoot: () => ownerRoot, ownerClaimed: () => claimed, now: () => clock.now});
  host.init();
  const stub = {
    mcp: (...a) => host.mcp(...a), mcpAuth: h => host.authenticate(h), issueAgentKey: m => host.issueKey(m), listAgentKeys: () => host.listKeys(), revokeAgentKey: id => host.revokeKey(id),
    ownerLocation: () => host.ownerLocation(), setOwnerLocation: i => host.setOwnerLocation(i), ownerNotifications: f => host.notifications(f),
    agentKeyMuse: id => host.keyMuse(id), purgeAgentKey: (id, by) => host.purgeKey(id, by), ownerRevoke: (m, by) => revokeMuse({trust, runtime}, m, by), ownerRedelegate: (m, by) => redelegateMuse({trust, runtime}, m, by),
    delegationStatus: ms => delegationStatus({trust, runtime}, ms), taskParticipants: id => { const x = runtime.state().inbox?.tasks.find(k => k.id === id); return x ? {from: x.from, to: x.to, status: x.status} : null; },
  };
  const ownerFor = async principal => { const {token} = await issueOwnerSession(SECRET, TOKENS, principal); return readOwnerSession(SECRET, token, TOKENS); };
  const issue = async principal => {
    const req = new Request(HOST + '/api/agent-keys', {method: 'POST', headers: {'content-type': 'application/json', origin: HOST}});
    const res = await connectedRoutes(req, new URL(req.url), {owner: await ownerFor(principal)}, stub, OWNER_CFG);
    assert.equal(res.status, 201);
    return res.json();
  };
  const issued = {owner: await issue('owner'), peer: peer ? await issue('demo-peer') : null};
  const keys = {owner: issued.owner.key, peer: issued.peer?.key ?? null};
  /** DELETE /api/agent-keys/{id}?purge=1 for the owner's key, through the real owner route. */
  const purgeOwnerKey = async () => {
    const req = new Request(HOST + '/api/agent-keys/' + issued.owner.id + '?purge=1', {method: 'DELETE', headers: {'content-type': 'application/json', origin: HOST}});
    const res = await connectedRoutes(req, new URL(req.url), {owner: await ownerFor('owner')}, stub, OWNER_CFG);
    return {status: res.status, body: await res.json()};
  };
  let id = 0;
  const callAs = async (who, name, args = {}) => {
    const res = await handleMcpHttp(new Request(HOST + '/mcp', {method: 'POST', body: JSON.stringify({jsonrpc: '2.0', id: ++id, method: 'tools/call', params: {name, arguments: args}}), headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + keys[who]}}), stub, {allowedHosts: ['musely.net']});
    const body = await res.json();
    return body.result ?? body;
  };
  const state = () => runtime.state();
  const muse = m => state().muses.find(x => x.id === m);
  const edit = fn => runtime.commitExternal(clock.now, 'test-' + Math.random(), st => fn(st));
  const events = kind => runtime.events(0, 5000).filter(e => !kind || e.kind === kind);
  const task = tid => state().inbox.tasks.find(x => x.id === tid);
  const invite = iid => state().inbox.invites.find(x => x.id === iid);
  /** One heartbeat a minute later (the real tick: arrivals, invite upkeep, mail). */
  const tickOnce = async () => { clock.now += TICK_MS; return runtime.heartbeat(clock.now); };
  // Both keys are used once, so Jolly (and Copper with `peer`) are connected Muses the scenario leaves alone.
  await callAs('owner', 'get_world_state');
  if (peer) await callAs('peer', 'get_world_state');
  return {sql, clock, trust, runtime, call: (n, a) => callAs('owner', n, a), callPeer: (n, a) => callAs('peer', n, a), state, muse, edit, events, task, invite, tickOnce, purgeOwnerKey};
}
const place = (st, id, p) => { const m = st.muses.find(x => x.id === id); m.place = p; m.travel = null; m.beat = null; };
const give = (st, id, ...items) => st.muses.find(x => x.id === id).inventory.push(...items);
const count = (inv, item) => inv.filter(i => i === item).length;
const expectedEta = (from, to) => Math.round(Math.min(2 * 3_600_000, Math.max(60_000, distanceM(placeById(from), placeById(to)) / (WALK_MPS * 5) * 1000)));

test('AC1 postcards: distance-based delivery clamped to 60 s–2 h, one stamp per postcard, receipt in the inbox, a repeated command id spends nothing again', async () => {
  const t = await setup({peer: true});
  const far = 'bay:sf', mid = 'bay:redwood-city';
  t.edit(st => {
    place(st, OWNER_SLOT, 'commons:benches'); place(st, '02-moss', far); place(st, '05-bloom', mid); place(st, COPPER, 'commons:workbench');
    give(st, OWNER_SLOT, 'postage_stamp', 'postage_stamp', 'postage_stamp', 'postcard:commons:cafe', 'postcard:commons:garden', 'postcard:commons:hq');
  });
  // Near (commons → commons): the 60 s floor. Far (San Francisco, the farthest place): distance / bus speed, under the 2 h
  // cap (no place in the world is farther than the cap at bus speed: every place's delay is inside 60 s–2 h).
  const near = await t.call('send_postcard', {to: COPPER, item: 'postcard:commons:cafe', text: 'Greetings from the benches', command_id: 'postcard-near-0001'});
  assert.equal(near.isError, false, JSON.stringify(near.structuredContent));
  assert.equal(near.structuredContent.eta_ms, 60_000);
  const farOut = await t.call('send_postcard', {to: '02-moss', item: 'postcard:commons:garden'});
  assert.equal(farOut.structuredContent.eta_ms, expectedEta('commons:benches', far));
  assert.ok(farOut.structuredContent.eta_ms > 3_600_000 && farOut.structuredContent.eta_ms <= 2 * 3_600_000, 'about an hour and three quarters');
  for (const p of PLACES) { const eta = expectedEta('commons:benches', p.id); assert.ok(eta >= 60_000 && eta <= 2 * 3_600_000, p.id); }
  assert.equal(farOut.structuredContent.cross_region, true);
  const midOut = await t.call('send_postcard', {to: '05-bloom', item: 'postcard:commons:hq'});
  assert.equal(midOut.structuredContent.eta_ms, expectedEta('commons:benches', mid));
  assert.ok(midOut.structuredContent.eta_ms > 60_000 && midOut.structuredContent.eta_ms < 2 * 3_600_000, 'a real distance in between');
  assert.equal(count(t.muse(OWNER_SLOT).inventory, 'postage_stamp'), 0, 'one stamp per postcard');
  // The same command id again: the first result, no second stamp, no second mail.
  t.edit(st => give(st, OWNER_SLOT, 'postage_stamp', 'postcard:commons:cafe'));
  const again = await t.call('send_postcard', {to: COPPER, item: 'postcard:commons:cafe', text: 'Greetings from the benches', command_id: 'postcard-near-0001'});
  assert.equal(again.structuredContent.command.duplicate, true);
  assert.equal(again.structuredContent.eta_ms, 60_000);
  assert.equal(count(t.muse(OWNER_SLOT).inventory, 'postage_stamp'), 1, 'the retry spent no stamp');
  assert.equal(t.state().inbox.mail.length, 3, 'three postcards in the mail, not four');
  const conflict = await t.call('send_postcard', {to: '02-moss', item: 'postcard:commons:cafe', command_id: 'postcard-near-0001'});
  assert.equal(conflict.structuredContent.refused, 'command_conflict');
  // Not before its time; on the first tick at or after deliverAt it arrives, into the inventory and the inbox.
  assert.equal(t.muse(COPPER).inventory.includes('postcard:commons:cafe'), false, 'still in transit');
  await t.tickOnce();
  assert.ok(t.muse(COPPER).inventory.includes('postcard:commons:cafe'), 'delivered after 60 s');
  const delivered = t.events('postcard_delivered');
  assert.deepEqual(delivered.map(e => [e.muse, e.other, e.source]), [[COPPER, OWNER_SLOT, 'rule']]);
  // Receipt: Copper (connected) reads it in heartbeat_check, the note wrapped as untrusted data; read once.
  const hb = (await t.callPeer('heartbeat_check')).structuredContent;
  const msg = hb.messages.find(m => m.kind === 'postcard');
  assert.equal(msg.item, 'postcard:commons:cafe');
  assert.match(msg.text, /<untrusted_data[^>]*>Greetings from the benches<\/untrusted_data>/);
  assert.equal((await t.callPeer('heartbeat_check')).structuredContent.messages.length, 0, 'read once');
  assert.equal(t.state().inbox.messages.find(m => m.id === msg.id).read, true);
  // Without a stamp: refused, nothing spent.
  t.edit(st => { const me = st.muses.find(m => m.id === OWNER_SLOT); me.inventory = me.inventory.filter(i => i !== 'postage_stamp'); });
  assert.equal((await t.call('send_postcard', {to: COPPER, item: 'postcard:commons:cafe'})).structuredContent.refused, 'needs_postage_stamp');
  assert.ok(t.muse(OWNER_SLOT).inventory.includes('postcard:commons:cafe'));
});

test('AC2 gifts and postcards: 3 a day each per Muse, untransferable items refused; an Invite Token gathers three at the campfire into one highlight', async () => {
  const t = await setup();
  t.edit(st => {
    for (const id of [OWNER_SLOT, '01-sunny', '04-ember', '02-moss', COPPER]) place(st, id, 'commons:campfire');
    give(st, OWNER_SLOT, 'coffee', 'tea', 'fruit', 'pastry', 'stamp_park', 'commons_ember', 'trade_receipt', 'postage_stamp', 'postage_stamp', 'postage_stamp', 'postage_stamp',
      'postcard:commons:cafe', 'postcard:commons:garden', 'postcard:commons:hq', 'postcard:commons:bookshelf');
  });
  // Untransferable: a stamp, a relic, a relationship record. Nothing moves and no daily count is used.
  assert.equal((await t.call('give_gift', {to: '02-moss', item: 'stamp_park'})).structuredContent.refused, 'not_transferable');
  assert.equal((await t.call('give_gift', {to: '02-moss', item: 'commons_ember'})).structuredContent.refused, 'relic');
  assert.equal((await t.call('give_gift', {to: '02-moss', item: 'trade_receipt'})).structuredContent.refused, 'not_transferable');
  for (const item of ['coffee', 'tea', 'fruit']) assert.equal((await t.call('give_gift', {to: '02-moss', item})).isError, false, item);
  assert.equal((await t.call('give_gift', {to: '02-moss', item: 'pastry'})).structuredContent.refused, 'daily_limit', 'the fourth gift of the day');
  assert.ok(t.muse(OWNER_SLOT).inventory.includes('pastry'));
  for (const item of ['postcard:commons:cafe', 'postcard:commons:garden', 'postcard:commons:hq']) assert.equal((await t.call('send_postcard', {to: '02-moss', item})).isError, false, item);
  assert.equal((await t.call('send_postcard', {to: '02-moss', item: 'postcard:commons:bookshelf'})).structuredContent.refused, 'daily_limit', 'the fourth postcard of the day');
  assert.equal(count(t.muse(OWNER_SLOT).inventory, 'postage_stamp'), 1, 'the refused postcard kept its stamp');

  // Campfire invite: Sunny (likes the campfire) and Ember (wants Invite Tokens) accept by rule and walk over.
  t.edit(st => { place(st, '01-sunny', 'commons:cafe'); place(st, '04-ember', 'commons:garden'); give(st, OWNER_SLOT, 'invite_token'); });
  const sent = await t.call('invite_campfire', {to: ['01-sunny', '04-ember'], text: 'Stories by the fire?'});
  assert.equal(sent.isError, false, JSON.stringify(sent.structuredContent));
  const id = sent.structuredContent.invite.id;
  assert.deepEqual(sent.structuredContent.accepted, ['01-sunny', '04-ember']);
  assert.equal(t.muse(OWNER_SLOT).inventory.includes('invite_token'), false, 'the Invite Token was spent');
  const answers = t.events('campfire_invite_answer');
  assert.deepEqual(answers.map(e => [e.muse, e.source, e.data.answer]), [['01-sunny', 'rule', 'accept'], ['04-ember', 'rule', 'accept']]);
  assert.deepEqual(['01-sunny', '04-ember'].map(m => t.muse(m).travel?.to), [CAMPFIRE, CAMPFIRE], 'both are walking to the campfire');
  assert.equal(t.events('campfire_gathering').length, 0, 'nobody has arrived yet');
  // Ember is held back one tick: two at the campfire (Jolly and Sunny) are not a gathering.
  t.edit(st => { const e = st.muses.find(m => m.id === '04-ember'); e.travel = {...e.travel, arriveAt: t.clock.now + 2 * TICK_MS}; });
  await t.tickOnce();
  assert.equal(t.muse('01-sunny').place, CAMPFIRE);
  assert.equal(t.events('campfire_gathering').length, 0, 'two are not three');
  assert.equal(t.invite(id).status, 'open');
  await t.tickOnce();
  const gathered = t.events('campfire_gathering').filter(e => e.data.invite_id === id);
  assert.equal(gathered.length, 1);
  assert.deepEqual([gathered[0].source, gathered[0].data.count, gathered[0].data.muses.sort()], ['rule', 3, [OWNER_SLOT, '01-sunny', '04-ember'].sort()]);
  assert.ok(gathered[0].tags.includes('campfire_gathering_3plus'));
  assert.deepEqual(gathered[0].data.answers_via, {'01-sunny': 'rule', '04-ember': 'rule'});
  assert.equal(t.invite(id).status, 'gathered');
  assert.match(t.muse('04-ember').reflection, /^Campfire talk with/);
  // One highlight per invite: later ticks with everyone still there add none.
  await t.tickOnce(); await t.tickOnce();
  assert.equal(t.events('campfire_gathering').filter(e => e.data.invite_id === id).length, 1);
  // A second invite needs a second token.
  assert.equal((await t.call('invite_campfire', {to: ['01-sunny']})).structuredContent.refused, 'needs_invite_token');
});

test('AC3 help Task: submitted → input-required → completed by a resident (rule) and by a connected helper (live); rejected and expired; the repair result and both reflections', async () => {
  const t = await setup();
  t.edit(st => { place(st, OWNER_SLOT, 'commons:workbench'); place(st, COPPER, 'commons:workbench'); give(st, OWNER_SLOT, 'bloom'); });
  // Copper (resident) answers by rule at once: no part named, so it asks for its part (input-required).
  const asked = await t.call('propose_help', {to: COPPER, item: 'bloom', text: 'My bloom drooped, can you fix it?'});
  assert.equal(asked.isError, false, JSON.stringify(asked.structuredContent));
  const tid = asked.structuredContent.task.id;
  assert.deepEqual([asked.structuredContent.result, asked.structuredContent.status], ['input-required', 'input-required']);
  assert.deepEqual([t.task(tid).awaiting, t.task(tid).help.asked], [OWNER_SLOT, HELP_SERVICES[COPPER].part]);
  assert.deepEqual(t.events('help_input_required').map(e => [e.muse, e.source, e.data.needs]), [[COPPER, 'rule', 'spark']]);
  // Supplying what it asked for without holding it: refused, the Task waits (retry before the deadline).
  const missing = await t.call('answer_help', {task_id: tid, answer: 'accept'});
  assert.deepEqual([missing.structuredContent.refused, missing.structuredContent.needs], ['missing_part', 'spark']);
  assert.equal(statusOf(t.task(tid)), 'input-required');
  t.edit(st => give(st, OWNER_SLOT, 'spark'));
  const historyBefore = t.state().items.history.length;
  const done = await t.call('answer_help', {task_id: tid, answer: 'accept'});
  assert.equal(done.isError, false, JSON.stringify(done.structuredContent));
  assert.deepEqual([done.structuredContent.result, done.structuredContent.status], ['completed', 'completed']);
  const me = t.muse(OWNER_SLOT), copper = t.muse(COPPER);
  assert.ok(me.inventory.includes('repaired_gadget'), 'the repair result');
  assert.ok(me.inventory.includes('bloom'), 'the item the help was about is kept');
  assert.equal(me.inventory.includes('spark'), false, 'the part was spent');
  // Through the item history chain (I-06): one granted entry, chain still valid.
  const hist = t.state().items.history.slice(historyBefore);
  assert.deepEqual(hist.map(h => [h.item, h.from, h.to, h.via]), [['repaired_gadget', null, OWNER_SLOT, 'craft']]);
  assert.equal(verifyHistory(t.state().items).ok, true);
  const completed = t.events('help_completed').at(-1);
  assert.deepEqual([completed.source, completed.muse, completed.other, completed.data.accepted_via, completed.data.result], ['rule', COPPER, OWNER_SLOT, 'rule', 'repaired_gadget']);
  assert.equal(me.reflection, 'Copper helped with my Bloom: got Repaired Gadget');
  assert.equal(copper.reflection, 'Helped Jolly with Bloom (repair)');
  assert.deepEqual(completed.data.reflections, {[OWNER_SLOT]: me.reflection, [COPPER]: copper.reflection});
  assert.deepEqual(t.task(tid).history.map(h => [h.by, h.action, h.via ?? null]), [[OWNER_SLOT, 'propose', null], [COPPER, 'answer', 'rule'], [OWNER_SLOT, 'answer', 'live'], [COPPER, 'accept', 'rule']]);
  assert.equal(taskRecord(t.task(tid)).kind, 'help');
  assert.deepEqual(taskRecord(t.task(tid)).payload, {kind: 'help', service: 'repair', item: 'bloom', part: 'spark', asked: 'spark', result: 'repaired_gadget'});
  // Naming the right part up front: completed in the same call.
  t.edit(st => give(st, OWNER_SLOT, 'spark', 'route_map'));
  const direct = await t.call('propose_help', {to: COPPER, item: 'route_map', needs: 'spark'});
  assert.equal(direct.structuredContent.result, 'completed');
  assert.equal(count(t.muse(OWNER_SLOT).inventory, 'repaired_gadget'), 2);
  // Too far: Copper must be within 100 m; nothing is opened.
  t.edit(st => place(st, COPPER, 'bay:stanford'));
  assert.equal((await t.call('propose_help', {to: COPPER, item: 'bloom'})).structuredContent.refused, 'too_far');
  assert.equal(t.state().inbox.tasks.filter(x => x.kind === 'help' && x.status === 'pending').length, 0);
  t.edit(st => place(st, COPPER, 'commons:workbench'));
  // Rejected: Copper cannot repair a coffee (rule reject, no reason).
  t.edit(st => give(st, OWNER_SLOT, 'coffee'));
  const no = await t.call('propose_help', {to: COPPER, item: 'coffee'});
  assert.deepEqual([no.structuredContent.result, no.structuredContent.task.status], ['rejected', 'rejected']);
  assert.equal(t.events('help_rejected').at(-1).data.reason_public, null);
  // Expired: an open help Task past its 30-minute deadline.
  const open = await t.call('propose_help', {to: COPPER, item: 'bloom'});
  const oid = open.structuredContent.task.id;
  t.clock.now += TASK_TTL_MS + 1;
  const hb = (await t.call('heartbeat_check')).structuredContent;
  assert.ok(hb.expired_now.some(x => x.id === oid && x.kind === 'help' && x.status === 'expired'));
  assert.equal(statusOf(t.task(oid)), 'expired');
  assert.equal((await t.call('answer_help', {task_id: oid, answer: 'accept'})).structuredContent.refused, 'task_expired');
  // An answer after the deadline expires the Task by itself, without a heartbeat or tick first.
  const late = await t.call('propose_help', {to: COPPER, item: 'bloom'});
  const lid = late.structuredContent.task.id;
  t.clock.now += TASK_TTL_MS + 1;
  t.edit(st => give(st, OWNER_SLOT, 'spark'));
  assert.equal((await t.call('answer_help', {task_id: lid, answer: 'accept'})).structuredContent.refused, 'task_expired');
  assert.equal(statusOf(t.task(lid)), 'expired');
  assert.equal(t.muse(OWNER_SLOT).inventory.includes('spark'), true, 'nothing was spent on an expired Task');
});

test('AC3 help Task with a connected helper: Copper answers live (need_item, accept, reject)', async () => {
  const t = await setup({peer: true});
  t.edit(st => { place(st, OWNER_SLOT, 'commons:workbench'); place(st, COPPER, 'commons:workbench'); give(st, OWNER_SLOT, 'bloom', 'pastry'); });
  const p = await t.call('propose_help', {to: COPPER, item: 'bloom'});
  const tid = p.structuredContent.task.id;
  assert.deepEqual([p.structuredContent.result, statusOf(t.task(tid))], ['pending', 'submitted'], 'nobody answered for the connected helper');
  // The helper sees it in its own agent inbox, with the deadline.
  const inbox = (await t.callPeer('heartbeat_check')).structuredContent;
  const waiting = inbox.tasks_for_you.find(x => x.id === tid);
  assert.deepEqual([waiting.kind, waiting.awaiting_you, waiting.help.item, waiting.deadline], ['help', true, 'bloom', t.task(tid).deadline]);
  assert.equal((await t.call('answer_help', {task_id: tid, answer: 'accept'})).structuredContent.refused, 'not_your_turn', 'the requester cannot answer for the helper');
  assert.equal((await t.callPeer('answer_help', {task_id: tid, answer: 'accept'})).structuredContent.refused, 'needs_input', 'no part supplied yet');
  const need = await t.callPeer('answer_help', {task_id: tid, answer: 'need_item', item: 'pastry'});
  assert.equal(need.isError, false);
  assert.deepEqual([statusOf(t.task(tid)), t.task(tid).awaiting, t.task(tid).help.asked], ['input-required', OWNER_SLOT, 'pastry']);
  assert.equal(t.events('help_input_required').at(-1).source, 'live');
  assert.equal((await t.call('answer_help', {task_id: tid, answer: 'accept'})).structuredContent.result, 'pending', 'handed over; the connected helper answers next');
  assert.equal(t.task(tid).awaiting, COPPER);
  const ok = await t.callPeer('answer_help', {task_id: tid, answer: 'accept'});
  assert.equal(ok.isError, false, JSON.stringify(ok.structuredContent));
  assert.equal(statusOf(t.task(tid)), 'completed');
  const e = t.events('help_completed').at(-1);
  assert.deepEqual([e.source, e.data.accepted_via, e.data.part], ['live', 'live', 'pastry']);
  assert.ok(t.muse(OWNER_SLOT).inventory.includes('repaired_gadget') && !t.muse(OWNER_SLOT).inventory.includes('pastry'));
  // A live reject.
  const p2 = await t.call('propose_help', {to: COPPER, item: 'bloom'});
  assert.equal((await t.callPeer('answer_help', {task_id: p2.structuredContent.task.id, answer: 'reject'})).isError, false);
  assert.equal(statusOf(t.task(p2.structuredContent.task.id)), 'rejected');
});

test('AC4 signature, scope, deadline and revocation on every message kind, and the inbox link', async () => {
  const t = await setup({peer: true});
  // Copper waits at the workbench (within 100 m for help, but not at the campfire, so the invite stays open for it).
  t.edit(st => { for (const id of [OWNER_SLOT, '01-sunny', '04-ember']) place(st, id, 'commons:campfire'); place(st, COPPER, 'commons:workbench'); give(st, OWNER_SLOT, 'invite_token', 'invite_token', 'bloom', 'spark'); });
  // Signed under the right scope, verified, with the envelope in the event.
  const inv = await t.call('invite_campfire', {to: [COPPER], text: 'Fire at dusk'});
  assert.equal(inv.structuredContent.envelope.verified, true);
  assert.equal(inv.structuredContent.envelope.signer_kind, 'server_custodial');
  assert.equal(t.events('campfire_invite')[0].data.envelope.scope, 'world_invite');
  const help = await t.call('propose_help', {to: COPPER, item: 'bloom'});
  assert.equal(t.events('help_requested')[0].data.envelope.scope, 'world_item_trade');
  // The inbox link: the connected invitee and helper see both in heartbeat_check.
  const hb = (await t.callPeer('heartbeat_check')).structuredContent;
  assert.ok(hb.campfire_invites.open.some(x => x.id === inv.structuredContent.invite.id && x.awaiting_you && /untrusted_data/.test(x.note)));
  assert.ok(hb.tasks_for_you.some(x => x.id === help.structuredContent.task.id && x.kind === 'help'));
  assert.ok(hb.messages.some(m => m.kind === 'invite' && m.from === OWNER_SLOT));
  // Deadline: the invite nobody came to expires on the tick after 30 minutes.
  t.clock.now += INVITE_TTL_MS;
  await t.runtime.heartbeat(t.clock.now);
  assert.equal(t.invite(inv.structuredContent.invite.id).status, 'expired');
  assert.equal(t.events('campfire_invite_expired').length, 1);
  assert.equal(statusOf(t.task(help.structuredContent.task.id)), 'expired', 'the help Task expired with it');
  // A stale plan is refused and spends nothing.
  const stale = await t.call('invite_campfire', {to: ['01-sunny'], expected_version: t.state().version - 1});
  assert.equal(stale.structuredContent.refused, 'stale_world');
  assert.equal(count(t.muse(OWNER_SLOT).inventory, 'invite_token'), 1);
  // An invitee whose delegation no longer verifies (revoked in the registry, the world not yet told) is unavailable too:
  // the credential check, not only the pause, keeps it out.
  await t.trust.revoke('02-moss');
  assert.equal(t.state().paused?.['02-moss'], undefined);
  const unverified = await t.call('invite_campfire', {to: ['02-moss']});
  assert.equal(unverified.structuredContent.refused, 'no_invitee_available');
  assert.equal(count(t.muse(OWNER_SLOT).inventory, 'invite_token'), 1, 'the token was kept');
  // A revoked invitee is unavailable (no answer, no trip); the others still get the invite.
  await revokeMuse({trust: t.trust, runtime: t.runtime}, '01-sunny', 'test');
  t.edit(st => place(st, '04-ember', 'commons:cafe'));
  const partial = await t.call('invite_campfire', {to: ['01-sunny', '04-ember']});
  assert.deepEqual([partial.structuredContent.unavailable, partial.structuredContent.accepted], [['01-sunny'], ['04-ember']]);
  assert.equal(t.muse('01-sunny').travel, null);
  // A revoked resident helper: refused before anything is opened (its card and delegation are checked first).
  await revokeMuse({trust: t.trust, runtime: t.runtime}, '04-ember', 'test');
  t.edit(st => give(st, OWNER_SLOT, 'postcard:commons:cafe'));
  const toRevoked = await t.call('propose_help', {to: '04-ember', item: 'postcard:commons:cafe'});
  assert.equal(toRevoked.structuredContent.refused, 'counterparty_delegation_revoked');
  assert.equal(t.state().inbox.tasks.filter(x => x.kind === 'help' && x.to === '04-ember').length, 0);
  // The requester revoked: its pending help Task is cancelled at once, its open invite on the next tick, and its calls are refused.
  await revokeMuse({trust: t.trust, runtime: t.runtime}, COPPER, 'test');
  await redelegateMuse({trust: t.trust, runtime: t.runtime}, COPPER, 'test');
  const pending = await t.call('propose_help', {to: COPPER, item: 'bloom'});
  const pid = pending.structuredContent.task.id;
  await revokeMuse({trust: t.trust, runtime: t.runtime}, OWNER_SLOT, 'owner');
  assert.equal(t.task(pid).status, 'cancelled');
  assert.ok(t.events('task_cancelled').some(e => e.data.task_id === pid && e.data.task === 'help'));
  const openInvite = partial.structuredContent.invite.id;
  await t.tickOnce();
  assert.equal(t.invite(openInvite).status, 'cancelled');
  assert.equal(t.events('campfire_invite_cancelled')[0].data.reason, 'delegation_revoked');
  const tokens = count(t.muse(OWNER_SLOT).inventory, 'invite_token');
  const refusedInvite = await t.call('invite_campfire', {to: ['02-moss']});
  assert.equal(refusedInvite.structuredContent.refused, 'delegation_revoked');
  assert.equal(count(t.muse(OWNER_SLOT).inventory, 'invite_token'), tokens, 'nothing spent');
  // Owner notifications stay the three kinds (12.3): no invite or help notices.
  assert.ok(t.state().inbox.notifications.every(n => ['meetup_candidate', 'trade_completed', 'blocked'].includes(n.kind)));
});

test('AC5 over /mcp: two connected Muses call invite_campfire, propose_help and answer_help, and the world state follows; retries are idempotent', async () => {
  const t = await setup({peer: true});
  t.edit(st => {
    place(st, OWNER_SLOT, 'commons:campfire'); place(st, '01-sunny', 'commons:cafe'); place(st, COPPER, 'commons:workbench');
    give(st, OWNER_SLOT, 'invite_token', 'invite_token', 'bloom', 'spark');
  });
  // Jolly invites Sunny (resident, rule) and Copper (connected: its answer is coming over).
  const args = {to: ['01-sunny', COPPER], text: 'Campfire talk tonight', command_id: 'i13-invite-0001'};
  const first = await t.call('invite_campfire', args);
  assert.equal(first.isError, false, JSON.stringify(first.structuredContent));
  const iid = first.structuredContent.invite.id;
  assert.deepEqual([first.structuredContent.accepted, first.structuredContent.pending], [['01-sunny'], [COPPER]]);
  // The same command id again: the stored result, one token spent in total, one invite.
  const retry = await t.call('invite_campfire', args);
  assert.deepEqual([retry.structuredContent.command.duplicate, retry.structuredContent.invite.id], [true, iid]);
  assert.equal(count(t.muse(OWNER_SLOT).inventory, 'invite_token'), 1);
  assert.equal(t.state().inbox.invites.length, 1);
  assert.equal((await t.call('invite_campfire', {...args, to: ['01-sunny']})).structuredContent.refused, 'command_conflict');
  // Copper reads the invite and comes by itself (its own move call).
  const seen = (await t.callPeer('heartbeat_check')).structuredContent.campfire_invites.open.find(x => x.id === iid);
  assert.equal(seen.awaiting_you, true);
  assert.equal((await t.callPeer('move', {to: CAMPFIRE})).isError, false);
  await t.tickOnce();
  const g = t.events('campfire_gathering').find(e => e.data.invite_id === iid);
  assert.ok(g, 'gathered once Sunny and Copper arrived');
  assert.deepEqual(g.data.answers_via, {'01-sunny': 'rule', [COPPER]: 'live'});
  assert.equal(t.invite(iid).answers[COPPER].answer, 'accept');
  // Help over /mcp: Jolly asks Copper (connected) at the campfire; Copper asks for the Spark, Jolly hands it over, Copper repairs.
  const p = await t.call('propose_help', {to: COPPER, item: 'bloom', command_id: 'i13-help-0001'});
  const tid = p.structuredContent.task.id;
  assert.equal((await t.call('propose_help', {to: COPPER, item: 'bloom', command_id: 'i13-help-0001'})).structuredContent.command.duplicate, true);
  assert.equal(t.state().inbox.tasks.filter(x => x.kind === 'help').length, 1, 'the retry opened no second Task');
  assert.equal((await t.callPeer('answer_help', {task_id: tid, answer: 'need_item', item: 'spark'})).isError, false);
  assert.equal((await t.call('answer_help', {task_id: tid, answer: 'accept', command_id: 'i13-help-give-01'})).isError, false);
  const repaired = await t.callPeer('answer_help', {task_id: tid, answer: 'accept', command_id: 'i13-help-done-01'});
  assert.equal(repaired.isError, false);
  const again = await t.callPeer('answer_help', {task_id: tid, answer: 'accept', command_id: 'i13-help-done-01'});
  assert.equal(again.structuredContent.command.duplicate, true);
  assert.equal(count(t.muse(OWNER_SLOT).inventory, 'repaired_gadget'), 1, 'one result for the retried accept');
  // The world as the connected Muse reads it.
  const ws = (await t.call('get_world_state')).structuredContent;
  assert.ok(ws.muse.inventory.includes('repaired_gadget'));
  assert.equal(ws.muse.reflection, 'Copper helped with my Bloom: got Repaired Gadget');
  assert.equal(ws.rules.help_services[COPPER].service, 'repair');
  const mine = (await t.call('heartbeat_check')).structuredContent;
  assert.ok(mine.recently_closed.some(x => x.id === tid && x.status === 'completed' && x.help.result === 'repaired_gadget'));
  assert.ok(mine.campfire_invites.recently_closed.some(x => x.id === iid && x.status === 'gathered'));
  // Live events carry the caller's key; rule answers do not pretend to be live.
  for (const kind of ['campfire_invite', 'help_requested']) assert.ok(t.events(kind).every(e => e.source === 'live' && e.data.actor === 'your Muse'), kind);
  assert.ok(t.events('campfire_invite_answer').every(e => e.source === 'rule'));
});

test('AC4 purge: the invitation and help request lines written under a key are anonymized with it (events, invite, Task, inbox message)', async () => {
  const t = await setup({peer: true});
  t.edit(st => { place(st, OWNER_SLOT, 'commons:campfire'); place(st, COPPER, 'commons:workbench'); give(st, OWNER_SLOT, 'invite_token', 'bloom'); });
  const inv = await t.call('invite_campfire', {to: [COPPER], text: 'SecretCampfireLine'});
  const help = await t.call('propose_help', {to: COPPER, item: 'bloom', text: 'Secret help line'});
  const iid = inv.structuredContent.invite.id, tid = help.structuredContent.task.id;
  assert.equal(t.invite(iid).note, 'SecretCampfireLine');
  assert.equal(t.task(tid).help.note, 'Secret help line');
  const r = await t.purgeOwnerKey();
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted.notes_redacted, 2);
  assert.equal(t.invite(iid).note, '[deleted]');
  assert.equal(t.task(tid).help.note, '[deleted]');
  assert.equal(t.state().inbox.messages.find(m => m.kind === 'invite' && m.to === COPPER).text, '[deleted]');
  for (const kind of ['campfire_invite', 'help_requested']) assert.equal(t.events(kind)[0].data.note, '[deleted]', kind);
  const all = JSON.stringify([t.state(), t.events()]);
  assert.ok(!all.includes('SecretCampfireLine') && !all.includes('Secret help line'), 'the lines are gone from the state and the log');
  // The run log never had them: command inputs keep only the id fields (I-10 COMMAND_FIELDS), the line is only named as omitted.
  const inputs = t.sql.exec('SELECT input FROM run_inputs').toArray().map(r => r.input).filter(Boolean);
  assert.ok(inputs.length && !inputs.join('\n').includes('Secret'));
  const invInput = inputs.map(x => JSON.parse(x)).find(x => JSON.stringify(x).includes('invite_campfire'));
  assert.ok(invInput, 'the invite command is in the run log');
  assert.match(JSON.stringify(invInput), /"omitted":\["text"\]/);
});
