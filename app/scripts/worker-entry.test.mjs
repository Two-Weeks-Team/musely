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
  const sql = {exec(q, ...b) { const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }};
  let alarm = null, ready;
  const ctx = {storage: {sql, getAlarm: async () => alarm, setAlarm: async t => { alarm = t; }}, blockConcurrencyWhile: fn => (ready = fn())};
  const env = {MODEL_ID: 'muse-spark-1.3', MODEL_BASE: 'https://api.meta.ai/v1', DAILY_BUDGET_USD: '1', TURNSTILE_SITEKEY: 'x', ALLOWED_HOSTS: 'musely.net', SESSION_SECRET: 'e2e-secret'};
  const dobj = new WorldDO(ctx, env);
  await ready;
  env.WORLD = {idFromName: () => 'id', get: () => dobj};
  env.ASSETS = {fetch: async () => new Response('asset')};
  const cookie = sessionCookie((await issueSession(env.SESSION_SECRET, 'judge')).token).split(';')[0];
  const go = async (method, path, body, headers = {}) => {
    const r = await worker.fetch(new Request('https://musely.net' + path, {method, body: body ? JSON.stringify(body) : undefined, headers: {'content-type': 'application/json', ...headers}}), env);
    const t = await r.text();
    return {status: r.status, body: t ? JSON.parse(t) : null};
  };

  const k = await go('POST', '/api/agent-keys', null, {cookie});
  assert.equal(k.status, 201); assert.match(k.body.key, /^msly_[A-Za-z0-9_-]{43}$/);
  assert.equal((await go('POST', '/api/agent-keys')).status, 403, 'judge session required');
  const auth = {authorization: 'Bearer ' + k.body.key, accept: 'application/json, text/event-stream'};
  const v = {...auth, 'mcp-protocol-version': '2025-06-18'};
  assert.equal((await go('POST', '/mcp', {jsonrpc: '2.0', id: 1, method: 'initialize', params: {}})).status, 401);
  const init = await go('POST', '/mcp', {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'e2e', version: '1'}}}, auth);
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal((await go('POST', '/mcp', {jsonrpc: '2.0', method: 'notifications/initialized'}, v)).status, 202);
  assert.equal((await go('POST', '/mcp', {jsonrpc: '2.0', id: 2, method: 'tools/list'}, v)).body.result.tools.length, 17);
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
  const judgeN = (await go('GET', '/api/owner/notifications', null, {cookie})).body.notifications.find(n => n.kind === 'meetup_candidate');
  assert.equal(judgeN.detail.time, cand.time, 'the judge (owner) session sees the details');

  const loc = await go('POST', '/api/owner/location', {source: 'virtual', preset: 'stanford'}, {cookie});
  assert.equal(loc.status, 200); assert.equal(loc.body.follow.mode, 'walking');
  const pub = await go('GET', '/api/owner/location');
  assert.equal(pub.body.cell_label, 'Stanford'); assert.ok(pub.body.muse.eta_ms > 0);
  assert.equal((await go('GET', '/api/owner/notifications')).status, 200);

  assert.equal((await go('DELETE', '/api/agent-keys/' + k.body.id, null, {cookie})).status, 200);
  assert.equal((await go('POST', '/mcp', {jsonrpc: '2.0', id: 4, method: 'tools/list'}, v)).status, 401);
  const kinds = dobj.worldEvents(0, 500).filter(e => e.muse === '00-jolly').map(e => e.kind);
  for (const kind of ['agent_key_issued', 'agent_connected', 'greet', 'owner_location_set', 'depart', 'agent_key_revoked']) assert.ok(kinds.includes(kind), kind);
});
