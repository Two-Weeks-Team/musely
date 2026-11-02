// Owner control (I-02, contract C06) through the real Worker entry (worker/index.ts) and WorldDO, with node:sqlite
// standing in for Durable Object storage (as in worker-entry.test.mjs):
//  - owner session vs judge session: separate powers
//  - two demo principals: independent sessions, cross approval/revocation refused
//  - revocation: pending Tasks cancelled, public activity stopped; re-delegation only as a separate owner action
//  - no automatic re-delegation anywhere in the product path (P0 included)
//  - /api/claim/permalink needs the owner session
//  - a new visitor gains nothing by replaying someone else's claim or ritual record
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const hooks = `export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return {url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true};
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

const ORIGIN = 'https://musely.net';
const OWNER_TOKEN = 'test-owner-control-token-0000000000001';
const PEER_TOKEN = 'test-demo-peer-control-token-000000002';
const JUDGE_TOKEN = 'test-judge-link-token-00000000000003';
const OWNER = '00-jolly', PEER_MUSE = '09-copper';
const TICK = 60_000;

async function boot(extra = {}) {
  const {default: worker, WorldDO} = await import('../worker/index.ts');
  const {issueSession, sessionCookie} = await import('../worker/core/session.ts');
  const db = new DatabaseSync(':memory:');
  const sql = {exec(q, ...b) { if (/^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i.test(q)) throw new Error('Durable Object SQL rejects transaction statements; use transactionSync'); const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }};
  let alarm = null, ready;
  // ctx.storage.transactionSync: a savepoint that rolls back on a throw, like the Durable Object transaction.
  let depth = 0;
  const transactionSync = fn => { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('transactionSync callback must be synchronous'); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } };
  const ctx = {storage: {sql, transactionSync, getAlarm: async () => alarm, setAlarm: async t => { alarm = t; }}, blockConcurrencyWhile: fn => (ready = fn())};
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const env = {MODEL_ID: 'muse-spark-1.3', MODEL_BASE: 'https://api.meta.ai/v1', DAILY_BUDGET_USD: '1', TURNSTILE_SITEKEY: 'x', ALLOWED_HOSTS: 'musely.net,www.musely.net', PUBLIC_ORIGIN: ORIGIN,
    SESSION_SECRET: 'owner-control-secret', JUDGE_TOKEN, OWNER_CONTROL_TOKEN: OWNER_TOKEN, DEMO_PEER_CONTROL_TOKEN: PEER_TOKEN, OWNER_ROOT_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)), ...extra};
  const t = {env, ctx, sql};
  t.start = async () => { t.dobj = new WorldDO(ctx, env); await ready; env.WORLD = {idFromName: () => 'id', get: () => t.dobj}; };
  await t.start();
  env.ASSETS = {fetch: async () => new Response('asset')};
  t.go = async (method, path, body, headers = {}) => {
    const r = await worker.fetch(new Request(ORIGIN + path, {method, body: body === undefined ? undefined : JSON.stringify(body), headers: {'content-type': 'application/json', ...headers}}), env);
    const text = await r.text();
    return {status: r.status, body: text ? JSON.parse(text) : null, setCookie: r.headers.get('set-cookie')};
  };
  t.session = async tier => sessionCookie((await issueSession(env.SESSION_SECRET, tier)).token).split(';')[0];
  t.login = async token => { const r = await t.go('POST', '/api/owner/session', {token}, {origin: ORIGIN}); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.setCookie.split(';')[0]; };
  t.state = () => t.dobj.runtime.state();
  t.muse = id => t.state().muses.find(m => m.id === id);
  t.events = () => t.dobj.worldEvents(0, 2000);
  t.edit = fn => t.dobj.runtime.commitExternal(Date.now(), 'test-' + Math.random(), st => fn(st));
  return t;
}
const task = (id, kind, from, to, now) => ({id, kind, from, to, status: 'pending', awaiting: to, createdAt: now, deadline: now + 30 * 60_000, updatedAt: now, round: 0, history: [{by: from, action: 'propose', at: now}], ...(kind === 'trade' ? {offer: {by: from, give: 'coffee', want: 'fruit'}} : {candidate: {time: '18:00', place: 'commons:cafe', public_basis: 'both like cafes'}, answers: {}})});

test('owner session vs judge session: owner actions need the owner session; the judge keeps reads and P0', async () => {
  const t = await boot();
  const judge = await t.session('judge'), owner = await t.login(OWNER_TOKEN);
  const h = cookie => ({cookie, origin: ORIGIN});
  // The judge link never yields an owner session, and the judge cookie is not an owner cookie.
  assert.equal((await t.go('POST', '/api/owner/session', {token: JUDGE_TOKEN}, {origin: ORIGIN})).status, 403);
  const judgeLogin = await t.go('POST', '/api/session', {judge: JUDGE_TOKEN});
  assert.equal(judgeLogin.body.tier, 'judge'); assert.ok(!judgeLogin.setCookie.includes('musely_o='), 'no owner cookie from the judge link');
  assert.equal((await t.go('GET', '/api/owner/session', undefined, {cookie: 'musely_o=' + judge.split('=')[1]})).body.owner, null, 'a judge token in the owner cookie is not read');
  assert.equal((await t.go('POST', '/api/ritual/start', undefined, {cookie: 'musely_s=' + owner.split('=')[1]})).status, 401, 'an owner token in the visitor cookie is not read');

  const ownerOnly = [['POST', '/api/owner/revoke', {}], ['POST', '/api/owner/redelegate', {}], ['POST', '/api/agent-keys', {}], ['GET', '/api/agent-keys', undefined],
    ['POST', '/api/owner/location', {source: 'virtual', preset: 'stanford'}], ['POST', '/api/claim/permalink', {permalink: 'https://www.threads.com/@combba82/post/ABCDE12345'}], ['POST', '/api/owner/approvals', {taskId: 'task_1', decision: 'approve'}]];
  for (const [m, p, b] of ownerOnly) {
    const r = await t.go(m, p, b, h(judge));
    assert.equal(r.status, 401, `${m} ${p} with the judge session`); assert.equal(r.body.error, 'owner_session_required');
    assert.equal((await t.go(m, p, b, {origin: ORIGIN})).status, 401, `${m} ${p} without any session`);
  }
  assert.equal(t.dobj.trust.suspended(OWNER), false, 'nothing was revoked by the judge');
  // What the judge keeps: reads and the P0 demonstration.
  for (const p of ['/api/world', '/api/owner/location', '/api/owner/notifications', '/api/claim/owner-muse', '/api/world/events']) assert.equal((await t.go('GET', p, undefined, {cookie: judge})).status, 200, p);
  const p0 = await t.go('POST', '/api/p0/run', undefined, {cookie: judge});
  assert.equal(p0.status, 200); assert.equal(p0.body.phase, 'valid');
  assert.equal((await t.go('POST', '/api/p0/run')).status, 403, 'P0 still needs the judge link (or the owner)');

  // The owner session: 1-hour HttpOnly/Secure/SameSite=Strict cookie; the same actions work for it.
  const login = await t.go('POST', '/api/owner/session', {token: OWNER_TOKEN}, {origin: ORIGIN});
  for (const attr of ['Path=/api', 'Max-Age=3600', 'HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(login.setCookie.includes(attr), attr);
  assert.deepEqual([login.body.owner.principal, login.body.owner.ownerId, login.body.owner.muses], ['owner', 'owner:kim-sejun', [OWNER]]);
  assert.ok(login.body.owner.expiresAt - Date.now() <= 3_600_000);
  assert.equal((await t.go('POST', '/api/agent-keys', {}, h(owner))).status, 201);
  assert.equal((await t.go('GET', '/api/agent-keys', undefined, {cookie: owner})).body.keys.length, 1);
  assert.equal((await t.go('POST', '/api/owner/location', {source: 'virtual', preset: 'stanford'}, h(owner))).status, 200);
  assert.equal((await t.go('POST', '/api/p0/run', undefined, {cookie: owner})).status, 200, 'the owner may run P0 too');

  // CSRF: every owner write needs one of our origins, the session exchange included.
  for (const headers of [{cookie: owner}, {cookie: owner, origin: 'https://evil.example'}, {cookie: owner, origin: ORIGIN, 'sec-fetch-site': 'cross-site'}]) {
    const r = await t.go('POST', '/api/owner/revoke', {}, headers);
    assert.equal(r.status, 403); assert.equal(r.body.error, 'origin_not_allowed');
  }
  assert.equal((await t.go('POST', '/api/owner/session', {token: OWNER_TOKEN})).status, 403, 'no Origin, no session');
  assert.equal((await t.go('POST', '/api/owner/session', {token: OWNER_TOKEN}, {origin: 'https://evil.example'})).status, 403);
  assert.equal(t.dobj.trust.suspended(OWNER), false);
  // Sign-out clears the cookie.
  assert.ok((await t.go('DELETE', '/api/owner/session', undefined, h(owner))).setCookie.includes('Max-Age=0'));
});

test('owner session: expires after one hour, ends when the control token is rotated, refuses a forged or misconfigured setup', async () => {
  const {issueOwnerSession, readOwnerSession, OWNER_SESSION_TTL_MS} = await import('../worker/core/owner-session.ts');
  const secret = 's', tokens = {owner: OWNER_TOKEN, peer: PEER_TOKEN}, now = Date.now();
  const {token} = await issueOwnerSession(secret, tokens, 'owner', now);
  assert.equal((await readOwnerSession(secret, token, tokens, now + OWNER_SESSION_TTL_MS - 1)).principal, 'owner');
  assert.equal(await readOwnerSession(secret, token, tokens, now + OWNER_SESSION_TTL_MS), null, 'expired after 1 h');
  assert.equal(await readOwnerSession(secret, token, {...tokens, owner: OWNER_TOKEN + 'x'}, now), null, 'rotating the secret ends the session');
  assert.equal(await readOwnerSession('other-secret', token, tokens, now), null);
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(body, 'base64url')), principal: 'demo-peer', ownerId: 'system:demo-peer'})).toString('base64url');
  assert.equal(await readOwnerSession(secret, forged + '.' + sig, tokens, now), null, 'a changed principal breaks the signature');
  const long = JSON.parse(Buffer.from(body, 'base64url'));
  assert.ok(long.exp - now <= OWNER_SESSION_TTL_MS);
  // The same value for both principals is a misconfiguration: no session at all.
  const t = await boot({DEMO_PEER_CONTROL_TOKEN: OWNER_TOKEN});
  assert.equal((await t.go('POST', '/api/owner/session', {token: OWNER_TOKEN}, {origin: ORIGIN})).status, 503);
  const u = await boot({OWNER_CONTROL_TOKEN: undefined, DEMO_PEER_CONTROL_TOKEN: undefined});
  assert.equal((await u.go('POST', '/api/owner/session', {token: OWNER_TOKEN}, {origin: ORIGIN})).status, 503);
});

test('two demo principals: independent sessions; one cannot approve, revoke, re-delegate, move or revoke keys for the other', async () => {
  const t = await boot();
  const owner = await t.login(OWNER_TOKEN), peer = await t.login(PEER_TOKEN);
  assert.notEqual(owner, peer);
  const h = cookie => ({cookie, origin: ORIGIN});
  const me = async c => (await t.go('GET', '/api/owner/session', undefined, {cookie: c})).body;
  const [a, b] = [await me(owner), await me(peer)];
  assert.deepEqual([a.owner.principal, a.owner.ownerId, a.owner.muses], ['owner', 'owner:kim-sejun', [OWNER]]);
  assert.deepEqual([b.owner.principal, b.owner.ownerId, b.owner.muses, b.owner.demo], ['demo-peer', 'system:demo-peer', [PEER_MUSE], true]);
  assert.match(b.owner.note, /not a second real Meta account/);
  // Different roots and agents.
  assert.notEqual(t.dobj.trust.agentByMuse(OWNER).agentId, t.dobj.trust.agentByMuse(PEER_MUSE).agentId);
  assert.notDeepEqual(t.dobj.trust.agentByMuse(OWNER).rootJwk, t.dobj.trust.agentByMuse(PEER_MUSE).rootJwk);

  // Cross revocation and re-delegation are refused; the body cannot name another owner's Muse.
  const crossRevoke = await t.go('POST', '/api/owner/revoke', {muse: OWNER}, h(peer));
  assert.equal(crossRevoke.status, 403); assert.equal(crossRevoke.body.error, 'not_your_muse');
  assert.equal(t.dobj.trust.suspended(OWNER), false);
  assert.equal((await t.go('POST', '/api/owner/revoke', {muse: PEER_MUSE}, h(owner))).status, 403);
  assert.equal(t.dobj.trust.suspended(PEER_MUSE), false);
  assert.equal((await t.go('POST', '/api/owner/revoke', {}, h(owner))).body.muse, OWNER, 'without a muse, the session\'s own Muse');
  assert.equal((await t.go('POST', '/api/owner/redelegate', {muse: OWNER}, h(peer))).status, 403, 'the peer cannot re-delegate the owner\'s Muse');
  assert.equal(t.dobj.trust.suspended(OWNER), true);
  assert.equal((await t.go('POST', '/api/owner/redelegate', {}, h(owner))).status, 200);
  // The peer controls its own Muse only.
  const own = await t.go('POST', '/api/owner/revoke', {}, h(peer));
  assert.deepEqual([own.status, own.body.muse], [200, PEER_MUSE]);
  assert.deepEqual([t.dobj.trust.suspended(PEER_MUSE), t.dobj.trust.suspended(OWNER)], [true, false]);
  assert.equal((await t.go('POST', '/api/owner/redelegate', {}, h(peer))).status, 200);

  // Cross approval: the peer cannot approve a Task of the owner's Muse. The approval workflow itself is I-07:
  // for the Muse's own owner the route says capability_not_ready and approves nothing.
  t.edit(st => { st.inbox.tasks.push(task('task_x1', 'meetup', OWNER, '01-sunny', Date.now())); st.inbox.tasks.push(task('task_x2', 'trade', '02-moss', PEER_MUSE, Date.now())); });
  const crossApprove = await t.go('POST', '/api/owner/approvals', {taskId: 'task_x1', revision: 1, contentHash: 'h', decision: 'approve'}, h(peer));
  assert.equal(crossApprove.status, 403); assert.equal(crossApprove.body.error, 'not_your_muse');
  assert.equal((await t.go('POST', '/api/owner/approvals', {taskId: 'task_x2', decision: 'approve'}, h(owner))).status, 403);
  const ownApprove = await t.go('POST', '/api/owner/approvals', {taskId: 'task_x1', decision: 'approve'}, h(owner));
  assert.deepEqual([ownApprove.status, ownApprove.body.error], [501, 'capability_not_ready']);
  assert.equal(t.state().inbox.tasks.find(x => x.id === 'task_x1').status, 'pending', 'nothing was approved');
  assert.equal((await t.go('POST', '/api/owner/approvals', {taskId: 'task_zz', decision: 'approve'}, h(owner))).status, 404);

  // Owner location and owner notification details belong to the real owner's Muse.
  assert.equal((await t.go('POST', '/api/owner/location', {source: 'virtual', preset: 'stanford'}, h(peer))).status, 403);
  // Agent keys: each principal issues for its own Muse; the peer cannot revoke the owner's key.
  const ok = await t.go('POST', '/api/agent-keys', {}, h(owner));
  assert.equal(ok.body.muse, OWNER);
  const pk = await t.go('POST', '/api/agent-keys', {}, h(peer));
  assert.equal(pk.body.muse, PEER_MUSE);
  assert.equal((await t.go('POST', '/api/agent-keys', {muse: OWNER}, h(peer))).status, 403);
  const crossKey = await t.go('DELETE', '/api/agent-keys/' + ok.body.id, undefined, h(peer));
  assert.deepEqual([crossKey.status, crossKey.body.error], [403, 'not_your_muse']);
  assert.equal(t.dobj.connected.keys.byId(ok.body.id).revokedAt, null, 'the owner key still works');
  assert.deepEqual((await t.go('GET', '/api/agent-keys', undefined, {cookie: peer})).body.keys.map(k => k.muse), [PEER_MUSE], 'each lists only its own keys');
  assert.equal((await t.go('POST', '/api/p0/run', undefined, {cookie: peer})).status, 403, 'the demo peer is not the owner of the P0 Muse');
});

test('owner revocation: pending Tasks close as cancelled, the Muse stops all public activity, until the owner delegates again', async () => {
  const t = await boot();
  const owner = await t.login(OWNER_TOKEN);
  const h = {cookie: owner, origin: ORIGIN};
  const now0 = Date.now();
  // Before: Jolly is on its way somewhere with two pending Tasks; Moss and Ripple have their own Task.
  t.edit(st => {
    st.inbox.tasks.push(task('task_a', 'trade', '02-moss', OWNER, now0), task('task_b', 'meetup', OWNER, '01-sunny', now0), task('task_c', 'trade', '02-moss', '03-ripple', now0));
    const j = st.muses.find(m => m.id === OWNER); j.travel = {to: 'commons:garden', departAt: now0, arriveAt: now0 + 5 * TICK, speed: 'walk'}; j.beat = null;
  });
  const placeBefore = t.muse(OWNER).place;
  const r = await t.go('POST', '/api/owner/revoke', {}, h);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.muse, r.body.already, r.body.cancelledTasks.sort(), r.body.stopped.trip], [OWNER, false, ['task_a', 'task_b'], 'commons:garden']);
  const tasks = Object.fromEntries(t.state().inbox.tasks.map(x => [x.id, x]));
  assert.deepEqual([tasks.task_a.status, tasks.task_b.status, tasks.task_c.status], ['cancelled', 'cancelled', 'pending']);
  assert.deepEqual(tasks.task_a.history.at(-1), {by: 'owner:kim-sejun', action: 'cancel', at: tasks.task_a.updatedAt});
  assert.equal(tasks.task_a.awaiting, null);
  const kinds = t.events().filter(e => e.muse === OWNER).map(e => e.kind);
  for (const k of ['delegation_revoked', 'task_cancelled', 'muse_paused']) assert.ok(kinds.includes(k), k);
  assert.deepEqual([t.muse(OWNER).travel, t.muse(OWNER).place], [null, placeBefore], 'the trip stops where it was');
  assert.equal((await t.go('GET', '/api/world')).body.muses.find(m => m.id === OWNER).paused.by, 'owner:kim-sejun', 'the public view shows the pause');
  assert.equal((await t.go('GET', '/api/owner/session', undefined, {cookie: owner})).body.delegation[0].status, 'revoked');
  // A second revoke changes nothing (no version bump, no new events).
  const v = t.dobj.trust.delegationVersion(t.dobj.trust.agentByMuse(OWNER).agentId), n = t.events().length;
  assert.equal((await t.go('POST', '/api/owner/revoke', {}, h)).body.already, true);
  assert.deepEqual([t.dobj.trust.delegationVersion(t.dobj.trust.agentByMuse(OWNER).agentId), t.events().length], [v, n]);

  // Gather everyone at Jolly's place so the scenario would surely make it meet someone, then run 40 heartbeats.
  t.edit(st => { for (const m of st.muses) if (m.id !== OWNER && ['02-moss', '03-ripple', '05-bloom'].includes(m.id)) { m.place = placeBefore; m.travel = null; m.beat = null; } });
  const from = t.events().at(-1).seq;
  let clock = Math.max(Date.now(), t.state().lastTickAt) + TICK;
  for (let i = 0; i < 40; i++, clock += TICK) await t.dobj.runtime.heartbeat(clock);
  const after = t.dobj.worldEvents(from, 2000);
  const active = ['spotlight', 'spotlight_fallback', 'beat', 'depart', 'arrive', 'encounter', 'greet', 'trade_proposed', 'trade_completed', 'gift', 'discover', 'craft', 'cards_verified', 'meeting_refused', 'gathering'];
  const jolly = after.filter(e => active.includes(e.kind) && (e.muse === OWNER || e.other === OWNER || (e.data?.muses ?? []).includes(OWNER)));
  assert.deepEqual(jolly.map(e => e.kind), [], 'no scenario turn, beat, trip or meeting for the paused Muse');
  assert.ok(after.some(e => e.kind === 'spotlight') && after.some(e => e.kind === 'encounter'), 'the rest of the world kept running');
  assert.deepEqual([t.muse(OWNER).place, t.muse(OWNER).travel, t.muse(OWNER).beat], [placeBefore, null, null]);
  // The owner location still records, but the paused Muse does not follow.
  const loc = await t.go('POST', '/api/owner/location', {source: 'virtual', preset: 'stanford'}, h);
  assert.equal(loc.body.follow.mode, 'paused'); assert.equal(t.muse(OWNER).travel, null);
  // Writes under an agent key are refused (no new delegation is issued while revoked).
  assert.equal(await t.dobj.trust.custodialExecutor(OWNER, t.dobj.ownerRoot), null);
  await assert.rejects(t.dobj.trust.executor(OWNER, 'server_custodial', t.dobj.ownerRoot), /revoked/);

  // Only the owner's explicit re-delegation resumes the Muse.
  const rd = await t.go('POST', '/api/owner/redelegate', {}, h);
  assert.deepEqual([rd.status, rd.body.already], [200, false]);
  assert.equal(t.state().paused?.[OWNER], undefined);
  const from2 = t.events().at(-1).seq;
  for (let i = 0; i < 12; i++, clock += TICK) await t.dobj.runtime.heartbeat(clock);
  assert.ok(t.dobj.worldEvents(from2, 2000).some(e => e.muse === OWNER && ['spotlight', 'beat', 'depart'].includes(e.kind)), 'active again');
});

test('no automatic re-delegation: P0, heartbeats and a restart leave a revoked Muse revoked; only /api/owner/redelegate delegates', async () => {
  const t = await boot();
  const judge = await t.session('judge'), owner = await t.login(OWNER_TOKEN);
  assert.equal((await t.go('POST', '/api/p0/run', undefined, {cookie: judge})).body.before, 'verified');
  assert.equal((await t.go('POST', '/api/owner/revoke', {}, {cookie: owner, origin: ORIGIN})).status, 200);
  for (let i = 0; i < 2; i++) {
    const before = JSON.stringify(t.state());
    const r = (await t.go('POST', '/api/p0/run', undefined, {cookie: judge})).body;
    assert.deepEqual([r.phase, r.afterRevoke, r.stateUnchanged, r.redelegated], ['after_revoke', 'delegation_revoked', true, false]);
    assert.equal(JSON.stringify(t.state()), before);
  }
  let clock = Math.max(Date.now(), t.state().lastTickAt) + TICK;
  for (let i = 0; i < 5; i++, clock += TICK) await t.dobj.runtime.heartbeat(clock);
  await t.start(); // a restarted Durable Object over the same storage
  assert.equal(t.dobj.trust.suspended(OWNER), true);
  assert.ok(t.state().paused[OWNER], 'still paused after the restart');
  assert.equal(t.events().filter(e => e.kind === 'delegation_issued').length, 0, 'nothing delegated again by itself');
  assert.equal((await t.go('POST', '/api/owner/redelegate', {}, {cookie: owner, origin: ORIGIN})).status, 200);
  assert.equal(t.events().filter(e => e.kind === 'delegation_issued').length, 1);
  assert.equal((await t.go('POST', '/api/p0/run', undefined, {cookie: judge})).body.phase, 'valid');

  // Source check: the only call of Trust.redelegate is in owner-control.ts, reached only from POST /api/owner/redelegate.
  const files = [];
  const walk = d => { for (const f of readdirSync(d, {withFileTypes: true})) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.ts$/.test(f.name) && !f.name.endsWith('.d.ts')) files.push(p); } };
  walk(new URL('../worker', import.meta.url).pathname);
  const callers = files.filter(f => /\.redelegate\(/.test(readFileSync(f, 'utf8'))).map(f => f.split('/worker/')[1]);
  assert.deepEqual(callers, ['core/owner-control.ts']);
  const routes = files.filter(f => /\.ownerRedelegate\(/.test(readFileSync(f, 'utf8'))).map(f => f.split('/worker/')[1]);
  assert.deepEqual(routes, ['core/owner-api.ts']);
  assert.ok(!/\.redelegate\(|redelegateMuse\(/.test(readFileSync(new URL('../worker/core/a2a.ts', import.meta.url), 'utf8').split('export async function runP0')[1].split('\n}\n')[0]), 'runP0 has no re-delegation');
});

test('/api/claim/permalink needs the real owner\'s session from our origin; nobody else can write the claim record', async () => {
  const t = await boot();
  const permalink = 'https://www.threads.com/@combba82/post/ABCDE12345';
  const visitor = await t.session('visitor'), judge = await t.session('judge'), peer = await t.login(PEER_TOKEN), owner = await t.login(OWNER_TOKEN);
  const tries = [[{origin: ORIGIN}, 401], [{cookie: visitor, origin: ORIGIN}, 401], [{cookie: judge, origin: ORIGIN}, 401], [{cookie: peer, origin: ORIGIN}, 403], [{cookie: owner}, 403], [{cookie: owner, origin: 'https://evil.example'}, 403]];
  for (const [headers, status] of tries) assert.equal((await t.go('POST', '/api/claim/permalink', {permalink}, headers)).status, status, JSON.stringify(Object.keys(headers)));
  assert.equal((await t.go('GET', '/api/claim/owner-muse')).body.record.status, 'pending_claim', 'no record was written');
  assert.equal(t.dobj.getClaim('owner-muse'), null);
  const ok = await t.go('POST', '/api/claim/permalink', {permalink}, {cookie: owner, origin: ORIGIN});
  assert.equal(ok.status, 200); assert.equal(ok.body.record.path, 'owner_direct'); assert.equal(ok.body.record.machineVerified, false);
  assert.equal((await t.go('POST', '/api/claim/permalink', {permalink: 'https://www.threads.com/@someone/post/ABCDE12345'}, {cookie: owner, origin: ORIGIN})).status, 400);
});

test('a new visitor gains nothing by replaying the owner\'s claim or ritual record', async () => {
  const t = await boot({MODEL_API_KEY: 'test-key'});
  t.dobj.setClaim('owner-muse', {agent: 'owner-muse', status: 'claimed', path: 'worker_token', handle: 'combba82', fingerprint: 'ef96 1d6f 307b a775', permalink: 'https://www.threads.com/@combba82/post/ABCDE12345', mediaId: 'm1', postedText: 'x', verifiedAt: Date.now(), checkedAt: Date.now(), machineVerified: true, note: 'test'});
  const claim = (await t.go('GET', '/api/claim/owner-muse')).body;
  assert.equal(claim.record.status, 'claimed');
  // Replaying the public claim material as a credential: refused, no cookie, no owner.
  for (const token of [claim.record.permalink, claim.fingerprint, claim.fingerprintFull, claim.claimText, claim.record.mediaId, 'owner-muse']) {
    const r = await t.go('POST', '/api/owner/session', {token}, {origin: ORIGIN});
    assert.equal(r.status, 403); assert.equal(r.setCookie, null);
  }
  for (const body of [{permalink: claim.record.permalink}, {fingerprint: claim.fingerprintFull}, {claim: claim.record}]) assert.equal((await t.go('POST', '/api/owner/session', body, {origin: ORIGIN})).status, 403);
  const visitor = await t.session('visitor');
  assert.equal((await t.go('GET', '/api/owner/session', undefined, {cookie: visitor})).body.owner, null);
  assert.equal((await t.go('POST', '/api/owner/revoke', {}, {cookie: visitor, origin: ORIGIN})).status, 401);

  // Rituals: a model that passes every step (stubbed). The owner record is written only by the owner session.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.meta.ai/')) return realFetch(url, init);
    return new Response(JSON.stringify({id: 'r1', usage: {prompt_tokens: 10, completion_tokens: 10}, choices: [{message: {content: JSON.stringify({results: [1, 2, 3].map(i => ({step: 's' + i, passed: true, confidence: .9, observation: 'ok'}))})}}]}), {headers: {'x-request-id': 'req-' + Math.random().toString(36).slice(2, 8)}});
  };
  const frames = [1, 2, 3].map(() => 'data:image/jpeg;base64,AAAA');
  const ritual = async (cookie, id) => {
    const start = id ? {id} : (await t.go('POST', '/api/ritual/start', undefined, {cookie})).body;
    return {id: start.id, r: await t.go('POST', '/api/muse', {action: 'challenge', input: {challengeId: start.id, frames}}, {cookie})};
  };
  try {
    const judge = await t.session('judge'), ownerCookie = await t.login(OWNER_TOKEN), ownerVisit = await t.session('visitor');
    // Another session's challenge id is useless to a new visitor, and does not use it up.
    const ownerStart = (await t.go('POST', '/api/ritual/start', undefined, {cookie: ownerVisit})).body;
    const replay = await ritual(visitor, ownerStart.id);
    assert.deepEqual([replay.r.status, replay.r.body.error], [400, 'ritual_expired_or_used']);
    // A passing visitor run and a passing judge-link run do not become the owner's record.
    assert.equal((await ritual(visitor)).r.body.source, 'live');
    assert.equal((await ritual(judge)).r.body.source, 'live');
    assert.equal((await t.go('GET', '/api/ritual/record')).body.record, null);
    // The owner's run (visitor session + owner session) is the owner record; it still authenticates no one.
    const own = await t.go('POST', '/api/muse', {action: 'challenge', input: {challengeId: ownerStart.id, frames}}, {cookie: ownerVisit + '; ' + ownerCookie});
    assert.equal(own.body.source, 'live');
    const rec = (await t.go('GET', '/api/ritual/record')).body.record;
    assert.equal(rec.tier, 'owner'); assert.ok(rec.requestId);
    assert.ok(!JSON.stringify(rec).includes('data:image'), 'no frames kept');
    const r = await t.go('POST', '/api/owner/session', {token: rec.requestId}, {origin: ORIGIN});
    assert.equal(r.status, 403, 'the ritual record is not a credential');
    const who = t.events().filter(e => e.kind === 'ritual_judged').map(e => e.data.who.split(' ')[0]);
    assert.deepEqual(who, ['visitor', 'judge', 'owner']);
  } finally {
    globalThis.fetch = realFetch;
  }
});
