// End-to-end through the real Worker entry (worker/index.ts) and WorldDO, with node:sqlite standing in for
// Durable Object storage. Local workerd cannot run this compatibility date, so `cloudflare:workers` is
// replaced by a minimal DurableObject base class for this test only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

const hooks = `export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return {url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true};
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

test('Worker entry: /api/agent-keys → /mcp handshake and tools → owner location → key revocation', async () => {
  const {default: worker, WorldDO} = await import('../worker/index.ts');
  const {issueSession, sessionCookie} = await import('../worker/core/session.ts');
  const db = new DatabaseSync(':memory:');
  const sql = {exec(q, ...b) { if (/^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i.test(q)) throw new Error('Durable Object SQL rejects transaction statements; use transactionSync'); const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }};
  let alarm = null, ready;
  // ctx.storage.transactionSync: a savepoint that rolls back on a throw, like the Durable Object transaction.
  let depth = 0;
  const transactionSync = fn => { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('transactionSync callback must be synchronous'); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } };
  const ctx = {storage: {sql, transactionSync, getAlarm: async () => alarm, setAlarm: async t => { alarm = t; }}, blockConcurrencyWhile: fn => (ready = fn())};
  const env = {MODEL_ID: 'muse-spark-1.3', MODEL_BASE: 'https://api.meta.ai/v1', DAILY_BUDGET_USD: '1', TURNSTILE_SITEKEY: 'x', ALLOWED_HOSTS: 'musely.net,www.musely.net', PUBLIC_ORIGIN: 'https://musely.net', SESSION_SECRET: 'e2e-secret', OWNER_CONTROL_TOKEN: 'e2e-owner-control-token-000000000001'};
  const dobj = new WorldDO(ctx, env);
  await ready;
  env.WORLD = {idFromName: () => 'id', get: () => dobj};
  env.ASSETS = {fetch: async () => new Response('asset')};
  const judgeCookie = sessionCookie((await issueSession(env.SESSION_SECRET, 'judge')).token).split(';')[0];
  const go = async (method, path, body, headers = {}) => {
    const r = await worker.fetch(new Request('https://musely.net' + path, {method, body: body ? JSON.stringify(body) : undefined, headers: {'content-type': 'application/json', ...headers}}), env);
    const t = await r.text();
    return {status: r.status, body: t ? JSON.parse(t) : null, setCookie: r.headers.get('set-cookie')};
  };
  // Owner control is an owner session (C06), exchanged for the control token from our origin; the judge link is not an owner.
  const origin = 'https://musely.net';
  const login = await go('POST', '/api/owner/session', {token: env.OWNER_CONTROL_TOKEN}, {origin});
  assert.equal(login.status, 200); assert.equal(login.body.owner.principal, 'owner');
  const cookie = login.setCookie.split(';')[0];
  assert.equal((await go('POST', '/api/agent-keys', null, {cookie: judgeCookie, origin})).status, 401, 'the judge session is not an owner');

  const k = await go('POST', '/api/agent-keys', null, {cookie, origin});
  assert.equal(k.status, 201); assert.match(k.body.key, /^msly_[A-Za-z0-9_-]{43}$/);
  assert.equal((await go('POST', '/api/agent-keys', null, {origin})).status, 401, 'owner session required');
  assert.equal((await go('POST', '/api/agent-keys', null, {cookie})).status, 403, 'an owner write without our Origin is refused');
  const auth = {authorization: 'Bearer ' + k.body.key, accept: 'application/json, text/event-stream'};
  const v = {...auth, 'mcp-protocol-version': '2025-06-18'};
  assert.equal((await go('POST', '/mcp', {jsonrpc: '2.0', id: 1, method: 'initialize', params: {}})).status, 401);
  const init = await go('POST', '/mcp', {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'e2e', version: '1'}}}, auth);
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal((await go('POST', '/mcp', {jsonrpc: '2.0', method: 'notifications/initialized'}, v)).status, 202);
  const tools = (await go('POST', '/mcp', {jsonrpc: '2.0', id: 2, method: 'tools/list'}, v)).body.result.tools;
  assert.equal(tools.length, 21, 'the existing twenty tools plus the first-conversation action');
  assert.ok(tools.some(tool => tool.name === 'say_hello' && tool.annotations.readOnlyHint === false));
  const g = await go('POST', '/mcp', {jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'greet', arguments: {text: 'Hello from the Worker entry'}}}, v);
  assert.equal(g.body.result.isError, false); assert.equal(g.body.result.structuredContent.envelope.signer_kind, 'server_custodial');
  assert.equal((await go('GET', '/mcp', null, auth)).status, 405);

  // Meetup candidate time and place stay private: never in /api/world/events or highlights.
  dobj.setClaim('owner-muse', {agent: 'owner-muse', status: 'claimed', path: 'worker_token', handle: 'x', fingerprint: 'x', permalink: null, mediaId: null, postedText: null, verifiedAt: Date.now(), checkedAt: Date.now(), machineVerified: true, note: 'test'});
  const tool = async (name, args) => (await go('POST', '/mcp', {jsonrpc: '2.0', id: 9, method: 'tools/call', params: {name, arguments: args}}, v)).body.result;
  const meet = await tool('propose_meetup', {to: '01-sunny'});
  assert.equal(meet.isError, false);
  const cand = meet.structuredContent.task.candidate;
  assert.ok(cand.time && cand.place, 'the connected Muse itself sees the candidate');
  assert.equal((await tool('answer_candidate', {task_id: meet.structuredContent.task.id, answer: 'accept'})).isError, false);
  const pubEvents = (await go('GET', '/api/world/events?limit=500')).body;
  const pubHigh = (await go('GET', '/api/world/highlights')).body;
  assert.ok(pubHigh.some(e => e.kind === 'meetup_candidate'), 'the highlight exists');
  for (const e of [...pubEvents, ...pubHigh]) {
    const visible = JSON.stringify({line: e.line, data: e.data});
    assert.ok(!visible.includes(cand.time), `${e.kind} leaks the candidate time`);
    if (e.kind.startsWith('meetup')) assert.ok(!visible.includes(cand.place), `${e.kind} leaks the candidate place`);
    assert.ok(typeof e.data?.candidate !== 'object' || e.data.candidate === null, `${e.kind} carries a candidate object`);
  }
  const publicN = (await go('GET', '/api/owner/notifications')).body.notifications.find(n => n.kind === 'meetup_candidate');
  assert.ok(publicN && !JSON.stringify(publicN).includes(cand.time));
  const judgeN = (await go('GET', '/api/owner/notifications', null, {cookie: judgeCookie})).body.notifications.find(n => n.kind === 'meetup_candidate');
  assert.equal(judgeN.detail, undefined, 'the judge session no longer sees owner details');
  const ownerN = (await go('GET', '/api/owner/notifications', null, {cookie})).body.notifications.find(n => n.kind === 'meetup_candidate');
  assert.equal(ownerN.detail.candidates[0].time, cand.time, 'the owner session sees the details');

  const loc = await go('POST', '/api/owner/location', {source: 'virtual', preset: 'stanford'}, {cookie, origin});
  assert.equal(loc.status, 200); assert.equal(loc.body.follow.mode, 'walking');
  const pub = await go('GET', '/api/owner/location');
  assert.equal(pub.body.cell_label, 'Stanford'); assert.ok(pub.body.muse.eta_ms > 0);
  assert.equal((await go('GET', '/api/owner/notifications')).status, 200);

  // I-05 visitor priority through the Worker: a session asks for a Muse's next spotlight turn.
  assert.equal((await go('POST', '/api/world/spotlight', {muse: '06-ink'})).status, 401, 'a session is required');
  assert.equal((await go('POST', '/api/world/spotlight', {muse: 'nobody'}, {cookie: judgeCookie})).status, 400);
  const asked = await go('POST', '/api/world/spotlight', {muse: '06-ink'}, {cookie: judgeCookie});
  assert.equal(asked.status, 200); assert.equal(asked.body.queued, true);
  // The connected Muse's own actions above already put it first in line; the visitor's Muse comes next.
  const view = (await go('GET', '/api/world')).body;
  assert.deepEqual(view.spotlightQueue, ['00-jolly', '06-ink']); assert.equal(asked.body.position, 2);
  assert.equal(view.nextSpotlight.priority, true);
  const reqEvent = dobj.worldEvents(0, 2000).find(e => e.kind === 'spotlight_requested' && e.muse === '06-ink');
  assert.equal(reqEvent.data.actorOrigin, 'trial');
  // The session token's body is the base64url JSON session: its real sid must not appear in the public event.
  const sid = JSON.parse(Buffer.from(judgeCookie.split('=')[1].split('.')[0], 'base64url').toString()).sid;
  assert.match(sid, /^[A-Za-z0-9_-]{16,}$/);
  assert.ok(!JSON.stringify(reqEvent).includes(sid), 'no session id in the public event');
  assert.ok(!JSON.stringify((await go('GET', '/api/world/events?limit=2000')).body).includes(sid), 'nor anywhere in the public log');
  await dobj.ownerRevoke('05-bloom', 'owner:test');
  assert.equal((await go('POST', '/api/world/spotlight', {muse: '05-bloom'}, {cookie: judgeCookie})).status, 409, 'a revoked Muse is not queued');

  assert.equal((await go('DELETE', '/api/agent-keys/' + k.body.id, null, {cookie, origin})).status, 200);
  assert.equal((await go('POST', '/mcp', {jsonrpc: '2.0', id: 4, method: 'tools/list'}, v)).status, 401);
  const kinds = dobj.worldEvents(0, 500).filter(e => e.muse === '00-jolly').map(e => e.kind);
  for (const kind of ['agent_key_issued', 'agent_connected', 'greet', 'owner_location_set', 'depart', 'agent_key_revoked']) assert.ok(kinds.includes(kind), kind);
});

test('www and any non-canonical host are sent to the canonical origin with method-preserving 308', async () => {
  const {canonicalRedirect} = await import('../worker/index.ts');
  const r = canonicalRedirect(new URL('https://www.musely.net/mcp?x=1'), 'https://musely.net');
  assert.equal(r.status, 308);
  assert.equal(r.headers.get('location'), 'https://musely.net/mcp?x=1');
  assert.equal(canonicalRedirect(new URL('https://musely.net/api/status'), 'https://musely.net'), null);
});
