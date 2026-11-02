// Connector directory review (G-08) and data deletion (G-09) through the real Worker entry (worker/index.ts) and
// WorldDO, with node:sqlite standing in for Durable Object storage (as in owner-control.test.mjs):
//  - the reviewer principal (system:reviewer) controls only its resident Muse; owner and demo-peer sessions cannot
//    reach it and it cannot reach theirs; an unset REVIEWER_CONTROL_TOKEN disables only the reviewer
//  - every /mcp write tool under the reviewer key acts as the reviewer Muse, without waiting on the owner's claim
//  - POST /api/owner/reset: the reviewer Muse back to its start state, its pending Tasks cancelled, its counters
//    cleared, every other Muse unchanged; refused while revoked
//  - DELETE /api/agent-keys/{id}?purge=1: the key's free text and envelopes leave events, command rows and inboxes;
//    other keys' data stays; another principal's key cannot be purged; the purged key stops working
//  - command result rows are deleted 7 days after they were written
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

const hooks = `export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return {url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true};
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

const ORIGIN = 'https://musely.net';
const OWNER_TOKEN = 'test-owner-control-token-0000000000001';
const PEER_TOKEN = 'test-demo-peer-control-token-000000002';
const REVIEWER_TOKEN = 'test-reviewer-control-token-00000000004';
const JUDGE_TOKEN = 'test-judge-link-token-00000000000003';
const OWNER = '00-jolly', PEER_MUSE = '09-copper', REVIEWER = '04-ember';
const TICK = 60_000, DAY_MS = 24 * 3_600_000;

async function boot(extra = {}) {
  const {default: worker, WorldDO} = await import('../worker/index.ts');
  const {issueSession, sessionCookie} = await import('../worker/core/session.ts');
  const db = new DatabaseSync(':memory:');
  const sql = {exec(q, ...b) { if (/^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i.test(q)) throw new Error('Durable Object SQL rejects transaction statements; use transactionSync'); const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }};
  let alarm = null, ready, depth = 0;
  const transactionSync = fn => { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('transactionSync callback must be synchronous'); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } };
  const ctx = {storage: {sql, transactionSync, getAlarm: async () => alarm, setAlarm: async t => { alarm = t; }}, blockConcurrencyWhile: fn => (ready = fn())};
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const env = {MODEL_ID: 'muse-spark-1.3', MODEL_BASE: 'https://api.meta.ai/v1', DAILY_BUDGET_USD: '1', TURNSTILE_SITEKEY: 'x', ALLOWED_HOSTS: 'musely.net,www.musely.net', PUBLIC_ORIGIN: ORIGIN,
    SESSION_SECRET: 'directory-review-secret', JUDGE_TOKEN, OWNER_CONTROL_TOKEN: OWNER_TOKEN, DEMO_PEER_CONTROL_TOKEN: PEER_TOKEN, REVIEWER_CONTROL_TOKEN: REVIEWER_TOKEN, OWNER_ROOT_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)), ...extra};
  const t = {env, ctx, sql};
  t.dobj = new WorldDO(ctx, env); await ready; env.WORLD = {idFromName: () => 'id', get: () => t.dobj};
  env.ASSETS = {fetch: async () => new Response('asset')};
  t.go = async (method, path, body, headers = {}) => {
    const r = await worker.fetch(new Request(ORIGIN + path, {method, body: body === undefined ? undefined : JSON.stringify(body), headers: {'content-type': 'application/json', ...headers}}), env);
    const text = await r.text();
    return {status: r.status, body: text ? JSON.parse(text) : null};
  };
  t.session = async tier => sessionCookie((await issueSession(env.SESSION_SECRET, tier)).token).split(';')[0];
  t.login = async token => {
    const r = await worker.fetch(new Request(ORIGIN + '/api/owner/session', {method: 'POST', body: JSON.stringify({token}), headers: {'content-type': 'application/json', origin: ORIGIN}}), env);
    assert.equal(r.status, 200, await r.clone().text());
    return r.headers.get('set-cookie').split(';')[0];
  };
  t.state = () => t.dobj.runtime.state();
  t.muse = id => t.state().muses.find(m => m.id === id);
  t.events = () => t.dobj.worldEvents(0, 2000);
  t.edit = fn => t.dobj.runtime.commitExternal(Date.now(), 'test-' + Math.random(), st => fn(st));
  t.key = async (cookie, body = {}) => { const r = await t.go('POST', '/api/agent-keys', body, {cookie, origin: ORIGIN}); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
  t.agent = muse => t.dobj.trust.agentByMuse(muse).agentId;
  t.commands = muse => sql.exec('SELECT command_id, result, output, at FROM commands WHERE actor_id = ?', t.agent(muse)).toArray();
  return t;
}
const h = cookie => ({cookie, origin: ORIGIN});
const task = (id, kind, from, to, now, extra = {}) => ({id, kind, from, to, status: 'pending', awaiting: to, createdAt: now, deadline: now + 30 * 60_000, updatedAt: now, round: 0, history: [{by: from, action: 'propose', at: now}], ...(kind === 'trade' ? {offer: {by: from, give: 'coffee', want: 'fruit'}} : {candidate: {time: '18:00', place: 'commons:cafe', public_basis: 'both like cafes'}, answers: {}}), ...extra});
const mcpClient = (t, key) => {
  let id = 0;
  const auth = {authorization: 'Bearer ' + key, accept: 'application/json, text/event-stream'};
  const rpc = async (method, params) => t.go('POST', '/mcp', {jsonrpc: '2.0', id: ++id, method, params}, {...auth, 'mcp-protocol-version': '2025-06-18'});
  return {
    rpc,
    init: async () => { await t.go('POST', '/mcp', {jsonrpc: '2.0', id: ++id, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'directory-review', version: '1'}}}, auth); await t.go('POST', '/mcp', {jsonrpc: '2.0', method: 'notifications/initialized'}, {...auth, 'mcp-protocol-version': '2025-06-18'}); },
    tool: async (name, args = {}) => (await rpc('tools/call', {name, arguments: args})).body.result,
  };
};
const place = (st, id, p) => { const m = st.muses.find(x => x.id === id); m.place = p; m.travel = null; m.beat = null; m.intent = null; };

// ---------- G-08: the reviewer principal ----------

test('reviewer principal: its session controls only the reviewer Muse; owner and demo-peer sessions cannot reach it, nor it theirs', async () => {
  const t = await boot();
  const owner = await t.login(OWNER_TOKEN), peer = await t.login(PEER_TOKEN), rev = await t.login(REVIEWER_TOKEN);
  const me = (await t.go('GET', '/api/owner/session', undefined, {cookie: rev})).body;
  assert.deepEqual([me.owner.principal, me.owner.ownerId, me.owner.muses, me.owner.demo], ['reviewer', 'system:reviewer', [REVIEWER], true]);
  assert.deepEqual(me.delegation.map(d => [d.muse, d.status]), [[REVIEWER, 'active']]);
  assert.notEqual(REVIEWER, OWNER); assert.notEqual(REVIEWER, PEER_MUSE);
  assert.equal(t.dobj.trust.agentByMuse(REVIEWER).kind, 'resident', 'an existing resident, not a new Muse');

  // Keys: each principal issues for its own Muse only.
  const rk = await t.key(rev), ok = await t.key(owner), pk = await t.key(peer);
  assert.deepEqual([rk.muse, ok.muse, pk.muse], [REVIEWER, OWNER, PEER_MUSE]);
  for (const [cookie, muse] of [[rev, OWNER], [rev, PEER_MUSE], [owner, REVIEWER], [peer, REVIEWER]]) {
    const r = await t.go('POST', '/api/agent-keys', {muse}, h(cookie));
    assert.deepEqual([r.status, r.body.error], [403, 'not_your_muse'], muse);
  }
  // Revoking or purging another principal's key: refused, the key keeps working.
  for (const [cookie, id] of [[rev, ok.id], [rev, pk.id], [owner, rk.id], [peer, rk.id]]) for (const q of ['', '?purge=1']) {
    const r = await t.go('DELETE', '/api/agent-keys/' + id + q, undefined, h(cookie));
    assert.deepEqual([r.status, r.body.error], [403, 'not_your_muse'], id + q);
  }
  for (const k of [rk, ok, pk]) assert.equal(t.dobj.connected.keys.byId(k.id).revokedAt, null);
  assert.deepEqual((await t.go('GET', '/api/agent-keys', undefined, {cookie: rev})).body.keys.map(k => k.muse), [REVIEWER]);
  assert.deepEqual((await t.go('GET', '/api/agent-keys', undefined, {cookie: owner})).body.keys.map(k => k.muse), [OWNER]);

  // Revocation and re-delegation across principals.
  for (const [cookie, muse] of [[rev, OWNER], [rev, PEER_MUSE], [owner, REVIEWER], [peer, REVIEWER]]) {
    assert.equal((await t.go('POST', '/api/owner/revoke', {muse}, h(cookie))).status, 403, muse);
    assert.equal((await t.go('POST', '/api/owner/redelegate', {muse}, h(cookie))).status, 403, muse);
  }
  for (const m of [OWNER, PEER_MUSE, REVIEWER]) assert.equal(t.dobj.trust.suspended(m), false, m);
  assert.equal((await t.go('POST', '/api/owner/location', {source: 'virtual', preset: 'stanford'}, h(rev))).status, 403, 'the owner location is the real owner\'s');

  // The reset is the reviewer's own action.
  const before = JSON.stringify(t.state().muses);
  for (const cookie of [owner, peer]) for (const body of [{}, {muse: REVIEWER}]) {
    const r = await t.go('POST', '/api/owner/reset', body, h(cookie));
    assert.deepEqual([r.status, r.body.error], [403, 'reviewer_only']);
  }
  assert.deepEqual([(await t.go('POST', '/api/owner/reset', {muse: OWNER}, h(rev))).body.error, (await t.go('POST', '/api/owner/reset', {muse: PEER_MUSE}, h(rev))).body.error], ['not_your_muse', 'not_your_muse']);
  assert.equal((await t.go('POST', '/api/owner/reset', {}, {origin: ORIGIN})).status, 401, 'no session');
  assert.equal((await t.go('POST', '/api/owner/reset', {}, h(await t.session('judge')))).status, 401, 'the judge link is not the reviewer');
  assert.equal((await t.go('POST', '/api/owner/reset', {}, {cookie: rev})).status, 403, 'no Origin');
  assert.equal((await t.go('POST', '/api/owner/reset', {}, {cookie: rev, origin: 'https://evil.example'})).status, 403);
  assert.equal(JSON.stringify(t.state().muses), before, 'no refused reset changed anything');

  // MCP: the reviewer key acts as the reviewer Muse, the owner key as the owner Muse.
  const reg = async k => { const c = mcpClient(t, k.key); await c.init(); return (await c.tool('register_agent')).structuredContent; };
  assert.deepEqual([(await reg(rk)).muse, (await reg(ok)).muse], [REVIEWER, OWNER]);
});

test('a missing or invalid REVIEWER_CONTROL_TOKEN turns off only the reviewer (503 on its route); owner and demo-peer control keep working', async () => {
  const t = await boot({REVIEWER_CONTROL_TOKEN: undefined});
  const off = await t.go('POST', '/api/owner/reset', {}, {origin: ORIGIN});
  assert.deepEqual([off.status, off.body.error], [503, 'not_configured']);
  const owner = await t.login(OWNER_TOKEN), peer = await t.login(PEER_TOKEN);
  assert.equal((await t.go('POST', '/api/owner/reset', {}, h(owner))).status, 503, 'the reviewer route is off, for everyone');
  assert.equal((await t.key(owner)).muse, OWNER, 'the owner works');
  assert.equal((await t.key(peer)).muse, PEER_MUSE, 'the demo peer works');
  const r = await t.go('POST', '/api/owner/session', {token: REVIEWER_TOKEN}, {origin: ORIGIN});
  assert.deepEqual([r.status, r.body.error], [403, 'owner_token_invalid'], 'no reviewer session without its token');
  assert.equal((await t.go('POST', '/api/p0/run', undefined, h(owner))).status, 200);
  // Set but invalid (under 32 characters, the judge link token, another principal's token): the reviewer alone is off.
  for (const bad of ['x'.repeat(31), JUDGE_TOKEN, OWNER_TOKEN, PEER_TOKEN]) {
    const u = await boot({REVIEWER_CONTROL_TOKEN: bad});
    const o = await u.login(OWNER_TOKEN), p = await u.login(PEER_TOKEN);
    assert.deepEqual([(await u.go('GET', '/api/owner/session', undefined, {cookie: o})).body.owner.principal, (await u.go('GET', '/api/owner/session', undefined, {cookie: p})).body.owner.principal], ['owner', 'demo-peer'], bad.slice(0, 12));
    assert.equal((await u.key(o)).muse, OWNER);
    const reset = await u.go('POST', '/api/owner/reset', {}, h(o));
    assert.deepEqual([reset.status, reset.body.error], [503, 'not_configured'], bad.slice(0, 12));
    if (bad !== OWNER_TOKEN && bad !== PEER_TOKEN) assert.equal((await u.go('POST', '/api/owner/session', {token: bad}, {origin: ORIGIN})).status, 403, 'an invalid reviewer token opens nothing');
  }
  // A reviewer session issued while its token was valid ends once that same token becomes invalid (here: the judge link
  // token is set to the same value); the owner's session goes on.
  const v = await boot();
  const rev = await v.login(REVIEWER_TOKEN), vo = await v.login(OWNER_TOKEN);
  assert.equal((await v.go('GET', '/api/owner/session', undefined, {cookie: rev})).body.owner.principal, 'reviewer');
  v.env.JUDGE_TOKEN = REVIEWER_TOKEN;
  assert.equal((await v.go('GET', '/api/owner/session', undefined, {cookie: rev})).body.owner, null);
  assert.equal((await v.go('POST', '/api/owner/reset', {}, h(rev))).status, 503);
  assert.equal((await v.go('GET', '/api/owner/session', undefined, {cookie: vo})).body.owner.principal, 'owner');
  // The owner and demo-peer rule is unchanged: a broken owner or demo-peer token stops owner control as a whole.
  for (const extra of [{OWNER_CONTROL_TOKEN: 'x'.repeat(31)}, {DEMO_PEER_CONTROL_TOKEN: OWNER_TOKEN}]) {
    const u = await boot(extra);
    for (const token of [OWNER_TOKEN, REVIEWER_TOKEN]) assert.equal((await u.go('POST', '/api/owner/session', {token}, {origin: ORIGIN})).status, 503, Object.keys(extra)[0]);
  }
  // Only a valid reviewer token: the reviewer works alone.
  const only = await boot({OWNER_CONTROL_TOKEN: undefined, DEMO_PEER_CONTROL_TOKEN: undefined, REVIEWER_CONTROL_TOKEN: 'r'.repeat(32)});
  assert.equal((await only.go('POST', '/api/owner/session', {token: 'r'.repeat(32)}, {origin: ORIGIN})).body.owner.principal, 'reviewer');
  assert.equal((await only.go('POST', '/api/owner/session', {token: OWNER_TOKEN}, {origin: ORIGIN})).status, 403);
});

test('reviewer key: every /mcp write tool acts as the reviewer Muse, without waiting on the owner\'s Threads claim', async () => {
  const t = await boot();
  assert.equal(t.dobj.getClaim('owner-muse'), null, 'the owner claim is still pending');
  const rev = await t.login(REVIEWER_TOKEN);
  assert.equal((await t.go('POST', '/api/owner/reset', {}, h(rev))).status, 200);
  const key = await t.key(rev), c = mcpClient(t, key.key);
  await c.init();
  const now = Date.now();
  t.edit(st => {
    for (const [id, p] of [['01-sunny', 'commons:cafe'], ['02-moss', 'commons:garden'], ['05-bloom', 'commons:garden'], ['06-ink', 'commons:bookshelf'], ['07-tempo', 'commons:bookshelf'], ['09-copper', 'commons:workbench']]) place(st, id, p);
    st.inbox.tasks.push(
      task('task_r1', 'trade', '05-bloom', REVIEWER, now, {offer: {by: '05-bloom', give: 'tea', want: 'coffee'}}),
      task('task_r2', 'trade', '07-tempo', REVIEWER, now, {offer: {by: '07-tempo', give: 'snack_box', want: 'fruit'}}),
      task('task_r3', 'trade', '09-copper', REVIEWER, now, {offer: {by: '09-copper', give: 'coffee', want: 'tea'}}),
      task('task_r4', 'meetup', '06-ink', REVIEWER, now));
  });
  const reg = (await c.tool('register_agent')).structuredContent;
  assert.deepEqual([reg.muse, reg.claim.status, reg.delegation.status], [REVIEWER, 'claimed', 'active']);
  const owner0 = JSON.stringify([t.muse(OWNER).inventory, t.muse(OWNER).wants]);
  const agent = t.agent(REVIEWER), postcard = t.muse(REVIEWER).inventory.find(i => i.startsWith('postcard:'));
  const calls = [
    ['greet', {text: 'Hello from the review', to: '01-sunny'}],
    ['update_wants', {goal: 'Find a story for tonight', items: ['pastry']}],
    ['discover', {}],
    ['accept_trade', {task_id: 'task_r1'}],
    ['counter_trade', {task_id: 'task_r2', give: 'wildflower', want: 'snack_box'}],
    ['reject_trade', {task_id: 'task_r3'}],
    ['propose_trade', {to: '02-moss', give: 'fruit', want: 'clover_seed'}],
    ['give_gift', {to: '01-sunny', item: 'tea'}],
    ['send_postcard', {to: '01-sunny', item: postcard, text: 'Greetings from the campfire'}],
    ['propose_meetup', {to: '01-sunny'}],
    ['answer_candidate', {task_id: 'task_r4', answer: 'accept'}],
    ['move', {to: 'commons:garden'}],
    'arrive',
    ['craft', {recipe: 'bloom'}],
  ];
  const done = [];
  for (const call of calls) {
    if (call === 'arrive') { await t.dobj.runtime.heartbeat(Math.max(Date.now(), t.state().lastTickAt) + 2 * TICK); assert.equal(t.muse(REVIEWER).place, 'commons:garden'); continue; }
    const [name, args] = call;
    const r = await c.tool(name, args);
    assert.equal(r.isError, false, `${name}: ${JSON.stringify(r.structuredContent)}`);
    const mine = t.events().filter(e => e.data?.key_id === key.id && e.data?.tool === name);
    assert.ok(mine.length, name + ' logged under the reviewer key');
    assert.ok(mine.every(e => e.data.envelope.agent_id === agent), name + ' signed as the reviewer Muse');
    assert.ok(t.commands(REVIEWER).some(row => row.command_id === r.structuredContent.command.command_id), name + ' stored under the reviewer Muse');
    done.push(name);
  }
  const hb = await c.tool('heartbeat_check');
  assert.equal(hb.isError, false); done.push('heartbeat_check');
  // invite_campfire, propose_help and answer_help have no backend yet (I-13): under this key too they are refused, never a success.
  const {TOOLS, NOT_READY_TOOLS} = await import('../worker/core/mcp-tools.ts');
  assert.deepEqual(done.sort(), TOOLS.filter(x => !x.annotations.readOnlyHint && !(x.name in NOT_READY_TOOLS)).map(x => x.name).sort(), 'every write tool that has a backend');
  for (const name of Object.keys(NOT_READY_TOOLS)) assert.equal((await c.tool(name, name === 'invite_campfire' ? {to: ['01-sunny']} : name === 'propose_help' ? {to: '01-sunny', item: 'coffee'} : {task_id: 'task_r1', answer: 'accept'})).structuredContent.refused, 'capability_not_ready', name);
  const e = t.muse(REVIEWER);
  assert.ok(e.inventory.includes('bloom') && e.inventory.includes('invite_token') && !e.inventory.includes(postcard));
  assert.equal(e.wants.goal, 'Find a story for tonight');
  assert.equal(JSON.stringify([t.muse(OWNER).inventory, t.muse(OWNER).wants]), owner0, 'the owner Muse\'s items and wants did not change');
  assert.ok(t.events().filter(x => x.data?.key_id === key.id).every(x => x.muse !== OWNER && x.other !== OWNER), 'no reviewer-key event involves the owner Muse');
  assert.equal(t.state().inbox.tasks.find(x => x.id === 'task_r1').status, 'completed');
});

test('reviewer reset: start state, pending Tasks cancelled, its counters cleared, every other Muse unchanged; refused while revoked', async () => {
  const t = await boot();
  const rev = await t.login(REVIEWER_TOKEN);
  const now = Date.now(), day = t.state().day;
  t.edit(st => {
    const e = st.muses.find(m => m.id === REVIEWER);
    Object.assign(e, {place: 'commons:hq', travel: {to: 'commons:garden', departAt: now, arriveAt: now + 5 * TICK, speed: 'walk'}, beat: null, inventory: ['brass_lantern', 'spark'], memory: ['Met Sunny at the Cafe'], reflection: 'Last: rest', intent: {kind: 'greet', target: '01-sunny'}, wants: {goal: 'an old goal', items: [], source: 'connected', updatedAt: now}});
    st.inbox.tasks.push(task('task_e1', 'trade', '02-moss', REVIEWER, now), task('task_e2', 'meetup', REVIEWER, '01-sunny', now), task('task_o1', 'trade', '02-moss', '03-ripple', now));
    st.items.finds[day] = {[REVIEWER]: [{place: 'commons:cafe', item: 'coffee', kind: 'coffee'}], '02-moss': [{place: 'commons:garden', item: 'fruit', kind: 'fruit'}]};
    st.items.trades[day] = {'02-moss|04-ember': 1, '01-sunny|02-moss': 1};
    st.inbox.sent[day] = {[REVIEWER]: {postcards: 3, gifts: 3}, '02-moss': {postcards: 1, gifts: 0}};
    st.inbox.messages.push({id: 'm_e', from: '02-moss', to: REVIEWER, kind: 'greet', at: now, text: 'hi', read: false}, {id: 'm_o', from: REVIEWER, to: '09-copper', kind: 'greet', at: now, text: 'yo', read: false});
    st.inbox.notifications.push({id: 'n_e', kind: 'blocked', at: now, line: 'x', ref: null, other: null, muse: REVIEWER}, {id: 'n_o', kind: 'blocked', at: now, line: 'y', ref: null, other: null, muse: OWNER});
    // Other Muses hold state about the reviewer Muse; a reset must leave it alone.
    const moss = st.muses.find(m => m.id === '02-moss'), copper = st.muses.find(m => m.id === PEER_MUSE);
    moss.memory = ['Met Ember at The Campfire']; moss.lastMet[REVIEWER] = now; moss.reflection = 'Last: rest';
    copper.intent = {kind: 'trade', target: REVIEWER, give: 'coffee', want: 'tea'}; copper.inventory.push('tea');
  });
  const others = JSON.stringify(t.state().muses.filter(m => m.id !== REVIEWER));
  const r = await t.go('POST', '/api/owner/reset', {}, h(rev));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.muse, r.body.place, r.body.cancelledTasks.sort()], [REVIEWER, 'commons:campfire', ['task_e1', 'task_e2']]);
  const {START_STATE} = await import('../worker/core/muse-reset.ts');
  const e = t.muse(REVIEWER);
  assert.deepEqual([e.place, e.travel, e.beat, e.intent, e.memory, e.reflection, e.inventory], ['commons:campfire', null, null, null, [], '', [...START_STATE[REVIEWER].inventory]]);
  assert.deepEqual([e.wants.source, e.wants.goal], ['harness', 'Gather people around a story tonight']);
  const tasks = Object.fromEntries(t.state().inbox.tasks.map(x => [x.id, x.status]));
  assert.deepEqual([tasks.task_e1, tasks.task_e2, tasks.task_o1], ['cancelled', 'cancelled', 'pending']);
  const s = t.state();
  assert.deepEqual([s.items.finds[day][REVIEWER], s.items.finds[day]['02-moss'].length], [undefined, 1], 'only its finds');
  assert.deepEqual(s.items.trades[day], {'01-sunny|02-moss': 1}, 'only its pair trades');
  assert.deepEqual(s.inbox.sent[day], {'02-moss': {postcards: 1, gifts: 0}}, 'only its postcards and gifts');
  assert.deepEqual(s.inbox.messages.map(m => m.id), ['m_o'], 'its own inbox only');
  assert.deepEqual(s.inbox.notifications.map(n => n.id), ['n_o']);
  assert.equal(JSON.stringify(s.muses.filter(m => m.id !== REVIEWER)), others, 'no other Muse changed');
  const ev = t.events();
  const reset = ev.find(x => x.kind === 'muse_reset');
  assert.deepEqual([reset.muse, reset.source, reset.data.by], [REVIEWER, 'live', 'system:reviewer']);
  assert.deepEqual(ev.filter(x => x.kind === 'task_cancelled' && x.data.reason === 'muse_reset').map(x => x.data.task_id).sort(), ['task_e1', 'task_e2']);

  // Representative data: right after a reset a trade with a nearby resident passes the rules.
  const key = await t.key(rev), c = mcpClient(t, key.key);
  await c.init();
  t.edit(st => place(st, '02-moss', 'commons:garden'));
  const trade = await c.tool('propose_trade', {to: '02-moss', give: 'fruit', want: 'clover_seed'});
  assert.equal(trade.isError, false, JSON.stringify(trade.structuredContent));

  // Revoked: refused and nothing changes. After the explicit re-delegation the reset works again.
  assert.equal((await t.go('POST', '/api/owner/revoke', {}, h(rev))).body.muse, REVIEWER);
  const frozen = JSON.stringify(t.state()), n = t.events().length;
  const refused = await t.go('POST', '/api/owner/reset', {}, h(rev));
  assert.deepEqual([refused.status, refused.body.error], [409, 'delegation_revoked']);
  assert.deepEqual([JSON.stringify(t.state()), t.events().length], [frozen, n]);
  assert.equal((await t.go('POST', '/api/owner/redelegate', {}, h(rev))).status, 200);
  assert.equal((await t.go('POST', '/api/owner/reset', {}, h(rev))).status, 200);
});

// ---------- G-09: data deletion ----------

test('purge: the key\'s free text and envelopes leave events, command rows and inboxes; other keys\' data stays; the key stops working', async () => {
  const t = await boot();
  const rev = await t.login(REVIEWER_TOKEN), peer = await t.login(PEER_TOKEN), owner = await t.login(OWNER_TOKEN);
  assert.equal((await t.go('POST', '/api/owner/reset', {}, h(rev))).status, 200);
  const A = await t.key(rev), B = await t.key(rev), P = await t.key(peer), O = await t.key(owner);
  const a = mcpClient(t, A.key), b = mcpClient(t, B.key), p = mcpClient(t, P.key), o = mcpClient(t, O.key);
  for (const x of [p, a, b, o]) await x.init(); // the demo peer's Muse is connected, so messages reach its inbox
  const second = 'postcard:osm:node/2611183817';
  t.edit(st => { place(st, PEER_MUSE, 'commons:campfire'); place(st, '02-moss', 'osm:node/2611183817'); st.muses.find(m => m.id === REVIEWER).inventory.push(second, 'postage_stamp'); });
  const first = t.muse(REVIEWER).inventory.find(i => i.startsWith('postcard:') && i !== second);
  const ok = async (c, name, args) => { const r = await c.tool(name, args); assert.equal(r.isError, false, `${name}: ${JSON.stringify(r.structuredContent)}`); return r; };
  // Under key A: a greeting delivered to a connected Muse, a refused greeting that carries its text, a meetup a resident
  // answers by rule, wants, two postcards
  // (one delivered, one still in transit) and an accepted trade with its owner notification.
  await ok(a, 'greet', {text: 'A-greet secret', to: PEER_MUSE});
  assert.equal((await a.tool('greet', {text: 'A-far secret', to: '02-moss'})).structuredContent.refused, 'too_far');
  await ok(a, 'propose_meetup', {to: '01-sunny'}); // Sunny answers by rule in the same commit, under A's envelope
  await ok(a, 'update_wants', {goal: 'A-goal secret'});
  await ok(a, 'send_postcard', {to: PEER_MUSE, item: first, text: 'A-note-one secret'});
  await t.dobj.runtime.heartbeat(Math.max(Date.now(), t.state().lastTickAt) + 3 * 3_600_000);
  assert.ok(t.state().inbox.messages.some(m => m.kind === 'postcard' && m.text === 'A-note-one secret'), 'delivered');
  await ok(a, 'send_postcard', {to: PEER_MUSE, item: second, text: 'A-note-two secret'});
  t.edit(st => { place(st, '05-bloom', 'commons:garden'); place(st, REVIEWER, 'commons:campfire'); place(st, PEER_MUSE, 'commons:campfire'); st.muses.find(m => m.id === '05-bloom').inventory.push('tea'); st.inbox.tasks.push(task('task_p1', 'trade', '05-bloom', REVIEWER, Date.now(), {offer: {by: '05-bloom', give: 'tea', want: 'coffee'}})); });
  await ok(a, 'accept_trade', {task_id: 'task_p1'});
  assert.ok(t.state().inbox.notifications.some(n => n.ref === 'task_p1' && n.muse === REVIEWER));
  // Under key B (same Muse), the demo peer's key and the owner's key.
  await ok(b, 'greet', {text: 'B-greet keep', to: PEER_MUSE});
  await ok(b, 'update_wants', {goal: 'B-goal keep'});
  await ok(p, 'greet', {text: 'P-greet keep', to: REVIEWER});
  await ok(o, 'heartbeat_check', {});

  const aEvents = t.events().filter(e => e.data?.key_id === A.id);
  const aCommands = aEvents.map(e => e.data.envelope?.message_id).filter(Boolean);
  const aNonces = aEvents.map(e => e.data.envelope?.nonce).filter(Boolean);
  assert.deepEqual(aEvents.map(e => e.kind), ['agent_key_issued', 'greet', 'action_refused', 'meetup_proposed', 'wants_updated', 'postcard_sent', 'postcard_sent', 'trade_completed']);
  assert.deepEqual([aCommands.length, aNonces.length], [7, 7]);
  const aRule = t.events().filter(e => e.source === 'rule' && aCommands.includes(e.data?.envelope?.message_id));
  assert.deepEqual(aRule.map(e => [e.kind, e.muse]), [['meetup_answer', '01-sunny']], 'the resident\'s answer carries A\'s envelope, not its key id');
  const rows = () => t.commands(REVIEWER);
  // Two command rows with no envelope of A: one points at an A event by its event ids (it goes), one at nothing of A's (it stays).
  const putRow = (id, eventIds) => t.sql.exec('INSERT INTO commands (actor_id, command_id, payload_hash, action, result, output, at) VALUES (?, ?, ?, ?, ?, ?, ?)', t.agent(REVIEWER), id, 'h', 'greet', JSON.stringify({ok: true, commandId: id, worldVersion: 1, eventIds}), 'null', Date.now());
  putRow('event-linked-row', [aEvents[1].id]); putRow('no-key-events-row', []);
  const aRows = rows().filter(r => aCommands.includes(r.command_id)).length, bRows = rows().length - aRows - 1;
  assert.deepEqual([aRows, bRows], [7, 3], 'A: seven calls; kept: B\'s two calls and the row without A events');
  // A notification of another Muse that happens to point at one of A's command ids is not A's.
  t.edit(st => st.inbox.notifications.push({id: 'n_other', kind: 'blocked', at: Date.now(), line: 'other Muse notice', ref: aCommands[0], other: null, muse: OWNER}));
  const before = new Map(t.events().map(e => [e.id, e]));

  // Nobody else can purge it, a purge needs our Origin, and purge takes only 1.
  for (const cookie of [owner, peer]) assert.equal((await t.go('DELETE', `/api/agent-keys/${A.id}?purge=1`, undefined, h(cookie))).status, 403);
  assert.equal((await t.go('DELETE', `/api/agent-keys/${O.id}?purge=1`, undefined, h(rev))).status, 403, 'the reviewer cannot purge the owner\'s key');
  assert.equal((await t.go('DELETE', `/api/agent-keys/${A.id}?purge=1`, undefined, {cookie: rev})).status, 403, 'no Origin');
  assert.equal((await t.go('DELETE', `/api/agent-keys/${A.id}?purge=yes`, undefined, h(rev))).status, 400);
  assert.equal(t.events().length, before.size, 'refused purges changed nothing');
  assert.equal((await o.tool('heartbeat_check')).isError, false, 'the owner key still works');

  const r = await t.go('DELETE', `/api/agent-keys/${A.id}?purge=1`, undefined, h(rev));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.id, r.body.muse, r.body.purged, typeof r.body.revoked_at], [A.id, REVIEWER, true, 'number']);
  assert.deepEqual(r.body.deleted, {events_anonymized: aEvents.length + 1, rule_events_anonymized: 1, commands_deleted: aRows + 1, messages_redacted: 2, mail_redacted: 1, notifications_redacted: 1, wants_reset: false, key_record: 'hash_and_last_use_removed'}, 'the revoke event is anonymized too');
  assert.deepEqual(r.body.kept, {events: aEvents.length + 2, key_record: 'id_muse_created_revoked', unlinked: {agent_connected_events: 1, messages_to_muse: 1}});
  assert.deepEqual(rows().map(x => x.command_id).filter(x => x.endsWith('-row')), ['no-key-events-row']);
  assert.equal(t.state().inbox.notifications.find(n => n.id === 'n_other').line, 'other Muse notice', 'another Muse\'s notification stays');
  const answer = t.events().find(e => e.id === aRule[0].id);
  assert.deepEqual([answer.kind, answer.source, answer.muse, answer.data.envelope, answer.data.redacted, answer.data.task_id], ['meetup_answer', 'rule', '01-sunny', '[deleted]', true, aRule[0].data.task_id]);

  // Gone from events, command rows, inboxes, mail and Muse state.
  const everything = () => JSON.stringify([t.events(), rows(), t.state().inbox, t.state().muses]);
  const all = everything();
  for (const s of ['A-greet secret', 'A-far secret', 'A-goal secret', 'A-note-one secret', 'A-note-two secret', A.id, ...aNonces]) assert.ok(!all.includes(s), 'still present: ' + s.slice(0, 20));
  // Event ids are kept (the order and counts depend on them); a command id survives only inside the id of its event.
  // (n_other is the planted notification of another Muse that reuses one of those ids; it is not A's and stays.)
  const inboxNow = t.state().inbox, withoutIds = JSON.stringify([t.events().map(({id: _i, ...e}) => e), rows(), {...inboxNow, notifications: inboxNow.notifications.filter(n => n.id !== 'n_other')}, t.state().muses]);
  for (const s of aCommands) assert.ok(!withoutIds.includes(s), 'command id still linked: ' + s);
  for (const s of ['B-greet keep', 'B-goal keep', 'P-greet keep']) assert.ok(all.includes(s), 'kept: ' + s);
  assert.equal(rows().length, bRows, 'key B\'s command rows and the row without A events stay');
  assert.ok(rows().every(x => !aCommands.includes(x.command_id)));
  // The rows stay with their id, tick, time, source and kind; nothing else changed.
  const after = new Map(t.events().map(e => [e.id, e]));
  for (const [id, e] of before) {
    const x = after.get(id);
    assert.ok(x, 'no event row was deleted');
    if (e.data?.key_id === A.id) {
      assert.deepEqual([x.seq, x.tick, x.at, x.source, x.kind, x.muse, x.tags], [e.seq, e.tick, e.at, e.source, e.kind, e.muse, e.tags]);
      assert.deepEqual([x.data.key_id, x.data.redacted], ['[deleted]', true]);
      if (e.data.envelope) assert.equal(x.data.envelope, '[deleted]');
      if (e.kind === 'greet') assert.equal(x.line, '[deleted]');
    } else if (e.kind !== 'agent_key_revoked' && !aRule.some(y => y.id === id)) assert.deepEqual(x, e, 'unrelated event unchanged: ' + e.kind);
  }
  const greet = t.events().find(e => e.id === aEvents.find(x => x.kind === 'greet').id);
  assert.deepEqual([greet.kind, greet.source, greet.line], ['greet', 'live', '[deleted]']);
  const inbox = t.state().inbox;
  assert.deepEqual(inbox.messages.filter(m => m.from === REVIEWER && m.to === PEER_MUSE).map(m => [m.kind, m.text]).sort(), [['greet', 'B-greet keep'], ['greet', '[deleted]'], ['postcard', '[deleted]']]);
  assert.equal(inbox.mail.find(m => m.item === second).text, '[deleted]', 'the postcard in transit lost its note');
  const note = inbox.notifications.find(n => n.ref === 'task_p1');
  assert.deepEqual([note.line, note.detail], ['[deleted]', undefined]);
  assert.equal(t.muse(REVIEWER).wants.goal, 'B-goal keep', 'the wants came from key B and stay');
  const logged = t.events().filter(e => e.kind === 'data_deleted');
  assert.equal(logged.length, 1);
  assert.deepEqual([logged[0].muse, logged[0].data.by, logged[0].data.scope, logged[0].data.deleted], [REVIEWER, 'system:reviewer', 'agent_key', r.body.deleted]);
  assert.ok(!JSON.stringify(logged[0]).includes(A.id), 'the deletion record does not name the key');

  // The key no longer works; its record keeps only id, Muse and times.
  const dead = await a.rpc('tools/call', {name: 'get_world_state', arguments: {}});
  assert.equal(dead.status, 401);
  assert.equal((await b.tool('heartbeat_check')).isError, false, 'key B still works');
  const rec = t.dobj.connected.keys.byId(A.id);
  assert.deepEqual([rec.muse, rec.lastUsedAt, typeof rec.revokedAt], [REVIEWER, null, 'number']);
  assert.equal(t.sql.exec('SELECT hash FROM agent_keys WHERE id = ?', A.id).toArray()[0].hash, 'purged:' + A.id);
  assert.equal((await t.go('GET', '/api/agent-keys', undefined, {cookie: rev})).body.keys.find(k => k.id === A.id).revoked_at, rec.revokedAt);

  // Again: nothing is left to remove, and nothing is logged. Then key B: its wants were the current ones, so they go back.
  const again = await t.go('DELETE', `/api/agent-keys/${A.id}?purge=1`, undefined, h(rev));
  assert.deepEqual([again.status, again.body.deleted], [200, {events_anonymized: 0, rule_events_anonymized: 0, commands_deleted: 0, messages_redacted: 0, mail_redacted: 0, notifications_redacted: 0, wants_reset: false, key_record: 'hash_and_last_use_removed'}]);
  assert.equal(t.events().filter(e => e.kind === 'data_deleted').length, 1, 'an empty purge writes no data_deleted event');
  const rb = await t.go('DELETE', `/api/agent-keys/${B.id}?purge=1`, undefined, h(rev));
  assert.equal(rb.body.deleted.wants_reset, true);
  const final = everything();
  for (const s of ['B-greet keep', 'B-goal keep']) assert.ok(!final.includes(s), s);
  assert.ok(final.includes('P-greet keep'), 'the demo peer\'s greeting is the peer\'s data');
  assert.equal(t.muse(REVIEWER).wants.source, 'harness');
});

test('retention: command result rows go 7 days after they were written (a row exactly 7 days old stays); the alarm checks at most hourly', async () => {
  const {pruneCommands, COMMAND_RETENTION_MS} = await import('../worker/core/data-retention.ts');
  assert.equal(COMMAND_RETENTION_MS, 7 * DAY_MS);
  const t = await boot();
  const put = (id, at) => t.sql.exec('INSERT INTO commands (actor_id, command_id, payload_hash, action, result, output, at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'agent-x', id, 'h', 'greet', '{}', 'null', at);
  const ids = () => t.sql.exec('SELECT command_id FROM commands WHERE actor_id = ? ORDER BY command_id', 'agent-x').toArray().map(r => r.command_id);
  const now = Date.now();
  put('old', now - 7 * DAY_MS - 1); put('edge', now - 7 * DAY_MS); put('new', now - 1000);
  const events = t.events().length;
  assert.equal(pruneCommands(t.sql, now), 1);
  assert.deepEqual(ids(), ['edge', 'new']);
  assert.equal(pruneCommands(t.sql, now + 1), 1, 'one millisecond later the edge row is past 7 days');
  assert.deepEqual(ids(), ['new']);
  assert.equal(t.events().length, events, 'public events are not touched');
  // From the heartbeat alarm.
  put('stale1', Date.now() - 8 * DAY_MS);
  await t.dobj.alarm();
  assert.deepEqual(ids(), ['new']);
  put('stale2', Date.now() - 8 * DAY_MS);
  await t.dobj.alarm();
  assert.deepEqual(ids(), ['new', 'stale2'], 'not again within the hour');
});

// ---------- review follow-ups (PR #91) ----------

test('reviewer reset: the start pass gets a fresh 24-hour clock, old pass clocks and a queued extra turn go, the item history stays intact', async () => {
  const {verifyHistory} = await import('../src/engine/items.ts');
  const t = await boot();
  const rev = await t.login(REVIEWER_TOKEN), key = await t.key(rev), c = mcpClient(t, key.key);
  await c.init(); // connected: the world neither moves Ember nor trades for it while the clock runs
  const now = Date.now(), H = 3_600_000;
  t.edit(st => {
    st.muses.find(m => m.id === REVIEWER).inventory.push('garden_pass', 'transit_pass');
    (st.items.expiry ??= {})[REVIEWER] = [{item: 'garden_pass', at: now - 20 * H, expiresAt: now + 4 * H}, {item: 'transit_pass', at: now - 20 * H, expiresAt: now + 4 * H}];
    st.spotlight.visitorQueue.push(REVIEWER);
  });
  const r = await t.go('POST', '/api/owner/reset', {}, h(rev));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cleared.queued_turns, 1);
  const resetAt = t.events().find(e => e.kind === 'muse_reset').at;
  assert.deepEqual(t.state().items.expiry[REVIEWER], [{item: 'garden_pass', at: resetAt, expiresAt: resetAt + DAY_MS}], 'one record: the start pass, from the reset');
  assert.ok(!t.state().spotlight.visitorQueue.includes(REVIEWER));
  // Five hours on, past the old clock: the pass still works.
  const from = t.events().at(-1).seq;
  await t.dobj.runtime.heartbeat(Math.max(Date.now(), t.state().lastTickAt) + 5 * H);
  const s = t.state();
  assert.ok(t.muse(REVIEWER).inventory.includes('garden_pass'));
  assert.deepEqual(t.dobj.worldEvents(from, 2000).filter(e => e.muse === REVIEWER && e.kind === 'item_expired'), []);
  assert.equal(s.items.expiry[REVIEWER].find(x => x.item === 'garden_pass').expiresAt, resetAt + DAY_MS);
  assert.deepEqual([s.items.tamper, verifyHistory(s.items).ok], [undefined, true], 'no history_tamper');
  assert.equal(t.events().filter(e => e.kind === 'history_tamper').length, 0);
  assert.ok(!s.spotlight.visitorQueue.includes(REVIEWER));
});

test('claim exemption: reviewer actions are not gated on the owner claim, but Agent Cards report the real claim', async () => {
  const t = await boot();
  const rev = await t.login(REVIEWER_TOKEN);
  assert.equal((await t.go('POST', '/api/owner/reset', {}, h(rev))).status, 200);
  const key = await t.key(rev), c = mcpClient(t, key.key);
  await c.init();
  const ownerCard = async () => (await c.tool('get_agent_card', {muse: OWNER})).structuredContent.card['x-musely'].owner_claimed;
  assert.equal(await ownerCard(), false, 'the owner claim is pending, and the reviewer key does not change that');
  assert.equal((await c.tool('get_agent_card', {})).structuredContent.card['x-musely'].owner_claimed, true, 'Ember is a resident');
  assert.equal((await c.tool('register_agent')).structuredContent.claim.status, 'claimed');
  t.edit(st => place(st, '01-sunny', 'commons:cafe'));
  const gift = await c.tool('give_gift', {to: '01-sunny', item: 'tea'});
  assert.equal(gift.isError, false, 'a claim-gated write works');
  assert.equal(t.events().find(e => e.kind === 'gift' && e.data?.key_id === key.id).data.envelope.owner_claimed, true);
  t.dobj.setClaim('owner-muse', {agent: 'owner-muse', status: 'claimed', path: 'worker_token', handle: 'combba82', fingerprint: 'x', permalink: null, mediaId: null, postedText: null, verifiedAt: Date.now(), checkedAt: Date.now(), machineVerified: true, note: 'test'});
  assert.equal(await ownerCard(), true, 'once the owner claims, the card says so');
});

test('world panel wording: a reset-cancelled Task is not called a revocation; an anonymized envelope reads as deleted', async () => {
  const {taskCancelledText, envelopeFacts} = await import('../src/ui/evidence-text.ts');
  assert.equal(taskCancelledText({task: 'trade', reason: 'muse_reset'}, 'Ember', 'Moss'), 'A pending trade with Moss was cancelled: Ember was reset by the operators');
  assert.equal(taskCancelledText({task: 'trade', reason: 'delegation_revoked'}, 'Jolly', 'Moss'), "A pending trade with Moss was cancelled: the owner revoked Jolly's delegation");
  assert.equal(taskCancelledText({}, 'Jolly', 'Moss'), "A pending Task with Moss was cancelled: the owner revoked Jolly's delegation", 'older events without a reason');
  assert.deepEqual(envelopeFacts('[deleted]'), [['Signed envelope', "deleted (the agent key's data was deleted)"]]);
  assert.deepEqual(envelopeFacts(null), []);
  const facts = envelopeFacts({message_id: 'm1', signer_kind: 'server_custodial', delegation_ref: 'd1', scope: 'walk_and_greet', scope_hash: 'sh', content_hash: 'ch', owner_claimed: true});
  assert.deepEqual(facts.map(f => f[0]), ['Message id', 'Signer', 'Delegation ref', 'Scope', 'Content hash', 'Owner claimed']);
  assert.ok(facts.every(([, v]) => v !== undefined && !String(v).includes('undefined')));
  // The panel uses both helpers.
  const {readFileSync} = await import('node:fs');
  const panel = readFileSync(new URL('../src/ui/world-panel.ts', import.meta.url), 'utf8');
  assert.ok(panel.includes("case 'task_cancelled': return taskCancelledText(d, a, b);") && panel.includes('for (const [k, v] of envelopeFacts(env)) fact(k, v);'));
});

test('purge: the wants goal the key wrote is reset even after the items, source or time changed; a goal written since stays', async () => {
  const t = await boot();
  const rev = await t.login(REVIEWER_TOKEN);
  assert.equal((await t.go('POST', '/api/owner/reset', {}, h(rev))).status, 200);
  const A = await t.key(rev), a = mcpClient(t, A.key);
  await a.init();
  assert.equal((await a.tool('update_wants', {goal: 'A-goal secret'})).isError, false);
  // The world (a Spark decision) later changes the items only: the goal is still A's text, under another source and time.
  t.edit(st => { const m = st.muses.find(x => x.id === REVIEWER); m.wants = {...m.wants, items: ['tea'], source: 'spark', updatedAt: m.wants.updatedAt + 60_000}; });
  const r = await t.go('DELETE', `/api/agent-keys/${A.id}?purge=1`, undefined, h(rev));
  assert.equal(r.body.deleted.wants_reset, true);
  assert.deepEqual([t.muse(REVIEWER).wants.goal, t.muse(REVIEWER).wants.source], ['Gather people around a story tonight', 'harness']);
  assert.ok(!JSON.stringify(t.state()).includes('A-goal secret'));
  // A goal someone else wrote after the key's stays.
  const B = await t.key(rev), b = mcpClient(t, B.key);
  await b.init();
  assert.equal((await b.tool('update_wants', {goal: 'B-goal'})).isError, false);
  t.edit(st => { const m = st.muses.find(x => x.id === REVIEWER); m.wants = {...m.wants, goal: 'A later goal from Spark', source: 'spark'}; });
  const rb = await t.go('DELETE', `/api/agent-keys/${B.id}?purge=1`, undefined, h(rev));
  assert.deepEqual([rb.body.deleted.wants_reset, t.muse(REVIEWER).wants.goal], [false, 'A later goal from Spark']);
});

test('retention: a command id repeated within 7 days is a duplicate, after 7 days a new command; a failing prune still schedules the next alarm', async () => {
  const {pruneCommands} = await import('../worker/core/data-retention.ts');
  const t = await boot();
  const rev = await t.login(REVIEWER_TOKEN);
  assert.equal((await t.go('POST', '/api/owner/reset', {}, h(rev))).status, 200);
  const key = await t.key(rev), c = mcpClient(t, key.key);
  await c.init();
  const args = {text: 'Hello once', command_id: 'retention-cmd-0001'};
  const greets = () => t.events().filter(e => e.kind === 'greet' && e.data?.key_id === key.id).length;
  const first = await c.tool('greet', args);
  assert.deepEqual([first.isError, first.structuredContent.command.duplicate, greets()], [false, false, 1]);
  assert.equal((await c.tool('greet', args)).structuredContent.command.duplicate, true);
  const age = ms => t.sql.exec('UPDATE commands SET at = at - ? WHERE command_id = ?', ms, args.command_id);
  age(6 * DAY_MS);
  assert.equal(pruneCommands(t.sql, Date.now()), 0, 'six days old: kept');
  const six = await c.tool('greet', args);
  assert.deepEqual([six.structuredContent.command.duplicate, greets()], [true, 1], 'still the first result');
  age(1.5 * DAY_MS);
  assert.equal(pruneCommands(t.sql, Date.now()), 1, 'seven and a half days old: deleted');
  t.sql.exec('UPDATE nonces SET exp = 0'); // replay-protection records expire two minutes after an action; a week has passed
  const later = await c.tool('greet', args);
  assert.deepEqual([later.isError, later.structuredContent.command.duplicate, greets()], [false, false, 2], 'a new command');

  // A prune that throws does not stop the heartbeat: the next alarm is still set.
  const real = t.sql.exec, err = console.error;
  t.sql.exec = (q, ...b) => { if (/FROM commands WHERE at </.test(q)) throw new Error('simulated prune failure'); return real.call(t.sql, q, ...b); };
  console.error = () => {};
  try {
    await t.ctx.storage.setAlarm(null);
    await t.dobj.alarm();
    assert.ok((await t.ctx.storage.getAlarm()) > Date.now(), 'the next beat is scheduled');
  } finally {
    t.sql.exec = real; console.error = err;
  }
});
