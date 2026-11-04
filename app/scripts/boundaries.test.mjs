// I-12 (#60) operating boundaries that are not covered by proxy.test.mjs:
//  - the model is called directly at api.meta.ai, with no AI Gateway and no gateway headers (Gateway decision:
//    docs/V2_VERIFICATION.md, section 5)
//  - no key or token reaches the built client or Worker bundle, even when fake secret values sit in the build's
//    environment and in local secret files
//  - no key or token appears in Worker responses, the public event log, the run log, console logs, storage or
//    requests to the wrong host, along the main paths; the agent key issue response is the one intended exception
//  - the private part of OWNER_ROOT_JWK (`d`) never appears in the JWKS or the Agent Cards
// The Worker entry runs with WorldDO on node:sqlite, as in worker-entry.test.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {inspect} from 'node:util';
import {readFile, readdir, mkdtemp, mkdir, cp, copyFile, symlink, writeFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const hooks = `export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return {url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true};
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

const APP = new URL('..', import.meta.url).pathname;
const ORIGIN = 'https://musely.net';
const wranglerVars = async () => JSON.parse((await readFile(APP + 'wrangler.jsonc', 'utf8')).replace(/^\s*\/\/.*$/gm, '')).vars;

// Fake values for every Worker secret. Each is distinctive so a single substring search finds it anywhere.
const FAKE = {
  // Assembled at run time so this file itself never matches the key pattern that proxy.test.mjs scans sources for.
  MODEL_API_KEY: ['LLM', '424242424242', 'i12FakeModelKeyDoNotShip0001'].join('_'),
  SESSION_SECRET: 'i12-fake-session-secret-000000000000000001',
  JUDGE_TOKEN: 'i12-fake-judge-token-0000000000000000000001',
  OWNER_CONTROL_TOKEN: 'i12-fake-owner-control-token-000000000001',
  DEMO_PEER_CONTROL_TOKEN: 'i12-fake-peer-control-token-0000000000001',
  REVIEWER_CONTROL_TOKEN: 'i12-fake-reviewer-control-token-00000001',
  TURNSTILE_SECRET: 'i12-fake-turnstile-secret-00000000000001',
  THREADS_APP_SECRET: 'i12fakethreadsappsecret000000000001',
};
const THREADS_SHORT = 'THi12FakeShortLivedThreadsToken0000000001';
const THREADS_TOKEN = 'THi12FakeLongLivedThreadsToken00000000001';
// Patterns for real secrets whose values a test cannot know: Model API keys, Musely agent keys, a private EC JWK member.
const PATTERNS = {modelKey: /LLM_\d{6,}_[A-Za-z0-9_-]{8,}/, agentKey: /msly_[A-Za-z0-9_-]{43}/, privateJwk: /\bd"?\s*:\s*["'][A-Za-z0-9_-]{43}["']/};

const ownerRoot = async () => {
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {jwk, text: JSON.stringify(jwk)};
};
const secretList = root => [...Object.entries(FAKE), ['OWNER_ROOT_JWK', root.text], ['OWNER_ROOT_JWK.d', root.jwk.d]];

// base64url runs are decoded too, so a secret inside a cookie body or an encoded blob is still found.
const decoded = text => (text.match(/[A-Za-z0-9_-]{16,}/g) ?? []).map(c => Buffer.from(c, 'base64url').toString('latin1')).join('\n');
function leaks(text, secrets, {except = [], decode = true} = {}) {
  const all = decode ? text + '\n' + decoded(text) : text;
  const found = secrets.filter(([name, v]) => v && !except.includes(name) && all.includes(v)).map(([name]) => name);
  for (const [name, re] of Object.entries(PATTERNS)) if (!except.includes('pattern:' + name) && re.test(all)) found.push('pattern:' + name);
  return found;
}

test('I-12 Gateway: model requests go straight to api.meta.ai with only authorization and content-type headers', async () => {
  const vars = await wranglerVars();
  assert.equal(vars.MODEL_BASE, 'https://api.meta.ai/v1', 'deployed MODEL_BASE is the Meta Model API itself; an AI Gateway needs challenge body logging and caching off first (V2_VERIFICATION 5)');
  const {handleMuse} = await import('../worker/core/proxy.ts');
  const {Ledger} = await import('../worker/core/ledger.ts');
  const db = new DatabaseSync(':memory:');
  const ledger = new Ledger({exec(q, ...b) { const st = db.prepare(q); if (/^\s*select/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }}, {dailyCapUsd: 5});
  ledger.init();
  const frame = 'data:image/jpeg;base64,' + Buffer.from('i12 frame').toString('base64');
  const inputs = {
    spotlight: {muse: '03-ripple', freedom: 'where', localTime: '14:10', place: 'The commons', places: [], muses: [], items: [], memory: []},
    encounter: {muse: '01-sunny', other: '06-ink', place: 'The commons', localTime: '18:00'},
    trade: {muse: '02-moss', other: '03-ripple', give: 'transit_pass', want: 'clover_seed', round: 1},
    negotiate: {muses: ['00-jolly', '05-bloom'], day: '2026-11-03', signals: [], places: ['Andytown Coffee']},
    challenge: {steps: ['raise_left_hand', 'thumbs_up', 'touch_nose'], frames: [frame, frame, frame]},
  };
  const seen = [];
  const fetcher = async (url, init) => { seen.push({url: String(url), headers: {...init.headers}}); return new Response('{}', {status: 503}); };
  for (const [action, input] of Object.entries(inputs)) {
    const res = await handleMuse({action, input}, {sid: 'g-' + action, tier: 'judge', exp: Date.now() + 1e6}, 'ip', {ledger, model: {base: vars.MODEL_BASE, key: 'test-key', model: vars.MODEL_ID, timeoutMs: 500, fetcher}});
    assert.equal((await res.json()).reason, 'upstream', action);
  }
  assert.equal(seen.length, 5, 'one request per action, including challenge and negotiate');
  for (const r of seen) {
    assert.equal(r.url, 'https://api.meta.ai/v1/chat/completions');
    assert.equal(new URL(r.url).host, 'api.meta.ai');
    assert.deepEqual(Object.keys(r.headers).sort(), ['authorization', 'content-type'], 'no gateway (cf-aig-*) or other extra header');
  }
});

test('I-12 bundle: fake secrets in the build environment and local secret files never reach dist/ or the Worker bundle', async () => {
  const root = await ownerRoot();
  const secrets = secretList(root);
  const env = {...process.env, ...FAKE, OWNER_ROOT_JWK: root.text, THREADS_APP_ID: '424242', WRANGLER_SEND_METRICS: 'false', CI: '1'};
  const temp = await mkdtemp(join(tmpdir(), 'musely-i12-bundle-'));
  try {
    for (const dir of ['src', 'assets', 'fixtures', 'static', 'worker', 'world-packs/campfire', 'character-kit/runtime']) await cp(APP + dir, join(temp, dir), {recursive: true});
    await mkdir(join(temp, 'scripts'));
    for (const f of ['build.mjs', 'prepare-assets.mjs', 'embedding.mjs', 'clips-glb.mjs', 'asset-files.mjs','asset-representations.mjs', 'device-metrics.mjs']) await copyFile(APP + 'scripts/' + f, join(temp, 'scripts', f));
    for (const f of ['package.json', 'wrangler.jsonc', 'character-kit/manifest.json']) await copyFile(APP + f, join(temp, f));
    await symlink(APP + 'node_modules', join(temp, 'node_modules'), 'dir');
    // Where developers keep secrets locally: neither file may be read into a deploy build.
    const lines = Object.entries({...FAKE, OWNER_ROOT_JWK: root.text}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n';
    await writeFile(join(temp, '.dev.vars'), lines);
    await writeFile(join(temp, '.env'), lines);
    const run = args => { const r = spawnSync(process.execPath, args, {cwd: temp, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}); assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout + r.stderr; };
    const buildLog = run(['scripts/build.mjs']);
    const dryLog = run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', 'worker-out']);
    assert.deepEqual(leaks(buildLog + dryLog, secrets, {decode: false}), [], 'the build and dry-run output print no secret');
    const walk = async dir => (await Promise.all((await readdir(dir, {withFileTypes: true})).map(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))).flat();
    const files = [...await walk(join(temp, 'dist')), ...await walk(join(temp, 'worker-out'))];
    assert.ok(files.some(f => f.endsWith('dist/index.html')) && files.some(f => f.endsWith('worker-out/index.js')), 'both bundles were built');
    let bytes = 0;
    for (const f of files) {
      const text = (await readFile(f)).toString('latin1');
      bytes += text.length;
      assert.deepEqual(leaks(text, secrets, {decode: false}), [], 'secret in ' + f.slice(temp.length));
    }
    assert.ok(bytes > 1_000_000, 'every file of the built client and Worker was read');
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
  // This checkout's own build outputs, when present (patterns only: real values are unknown here).
  for (const dir of ['dist', '.wrangler/dry-run']) {
    if (!(await stat(APP + dir).catch(() => null))) continue;
    const walk = async d => (await Promise.all((await readdir(d, {withFileTypes: true})).map(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))).flat();
    for (const f of await walk(APP + dir)) assert.deepEqual(leaks((await readFile(f)).toString('latin1'), [], {decode: false}), [], 'key-like string in ' + f.slice(APP.length));
  }
});

test('I-12 secrets: no key or token in Worker responses, events, run log, logs, storage or requests to other hosts', async () => {
  const vars = await wranglerVars();
  const root = await ownerRoot();
  const secrets = secretList(root);
  secrets.push(['Threads token', THREADS_TOKEN], ['Threads short-lived token', THREADS_SHORT]);
  const claim = JSON.parse(await readFile(APP + 'fixtures/owner-claim.json', 'utf8'));

  // Console capture: everything the Worker logs (Workers Logs in production).
  const logs = [], saved = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) { saved[m] = console[m]; console[m] = (...a) => logs.push(m + ' ' + a.map(x => typeof x === 'string' ? x : inspect(x, {depth: 8})).join(' ')); }
  // Outbound requests: the model, Turnstile and Threads, each answered by a stub.
  const outbound = [], realFetch = globalThis.fetch;
  let threadsUser = 'someone-else';
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const headers = Object.fromEntries(new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined)));
    const body = init.body instanceof FormData ? [...init.body.entries()].map(([k, v]) => k + '=' + v).join('&') : String(init.body ?? '');
    outbound.push({host: url.host, url: url.href, headers, body});
    const reply = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json', 'x-request-id': 'i12-req-' + outbound.length}});
    if (url.host === 'api.meta.ai') {
      const name = JSON.parse(body).response_format?.json_schema?.name;
      const content = name === 'challenge_verdict'
        ? {results: [0, 1, 2].map(() => ({step: 'step', passed: false, confidence: 0.4, observation: 'unclear'}))}
        : {freedom: 'where', decision: 'walk to the garden', target_place: 'Garden', target_agent: 'Moss', offer_item: '', want_item: '', public_reason: 'Moss is close by.', line: 'Off to see Moss!'};
      return reply({id: 'chatcmpl-i12', usage: {prompt_tokens: 100, completion_tokens: 100}, choices: [{message: {content: JSON.stringify(content)}}]});
    }
    if (url.host === 'challenges.cloudflare.com') return reply({success: true, hostname: 'musely.net'});
    if (url.host === 'graph.threads.net') {
      if (url.pathname === '/oauth/access_token') return reply({access_token: THREADS_SHORT, user_id: '7'});
      if (url.pathname === '/access_token') return reply({access_token: THREADS_TOKEN, expires_in: 5_184_000});
      if (url.pathname === '/v1.0/me') return reply({id: '7', username: threadsUser});
      if (url.pathname === '/v1.0/me/threads') return reply({data: [{id: 'i12-media', text: claim.claim_text, permalink: 'https://www.threads.com/@' + claim.handle + '/post/i12', username: claim.handle, timestamp: '2026-11-02T00:00:00+0000'}]});
      return reply({error: {message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190}}, 400);
    }
    throw new Error('unexpected outbound request to ' + url.host);
  };

  try {
    const {default: worker, WorldDO} = await import('../worker/index.ts');
    const {HARNESS_IDS} = await import('../src/engine/harness.ts');
    const db = new DatabaseSync(':memory:');
    const sql = {exec(q, ...b) { const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }};
    let alarm = null, ready, depth = 0;
    const transactionSync = fn => { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } };
    const ctx = {storage: {sql, transactionSync, getAlarm: async () => alarm, setAlarm: async t => { alarm = t; }}, blockConcurrencyWhile: fn => (ready = fn())};
    const env = {...vars, DAILY_BUDGET_USD: '1', ...FAKE, OWNER_ROOT_JWK: root.text, THREADS_APP_ID: '424242'};
    const dobj = new WorldDO(ctx, env);
    await ready;
    env.WORLD = {idFromName: () => 'id', get: () => dobj};
    env.ASSETS = {fetch: async () => new Response('asset')};

    const surfaces = [];
    const go = async (method, path, body, headers = {}, opts = {}) => {
      const r = await worker.fetch(new Request(ORIGIN + path, {method, body: body === undefined ? undefined : JSON.stringify(body), headers: {'content-type': 'application/json', ...headers}}), env);
      const text = await r.text();
      surfaces.push({label: `${method} ${path} → ${r.status}`, text: JSON.stringify([...r.headers]) + '\n' + text, ...opts});
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      return {status: r.status, body: parsed, cookie: r.headers.get('set-cookie')?.split(';')[0], location: r.headers.get('location')};
    };
    const owner = origin => (cookie, extra = {}) => ({cookie, origin, ...extra});
    const h = owner(ORIGIN);

    // Status, visitor and judge sessions (Turnstile secret, session secret, judge token).
    const status = await go('GET', '/api/status');
    assert.equal(status.body.aiGateway, false, 'the deployed configuration reports no AI Gateway');
    assert.equal(status.body.model.connected, true);
    const judge = (await go('POST', '/api/session', {judge: FAKE.JUDGE_TOKEN})).cookie;
    assert.ok(judge);
    assert.equal((await go('POST', '/api/session', {judge: 'wrong-judge-token'})).status, 403);
    const visitor = (await go('POST', '/api/session', {turnstile: 'turnstile-response-token'}, {'cf-connecting-ip': '203.0.113.9'})).cookie;
    assert.ok(visitor);
    await go('GET', '/api/status', undefined, {cookie: judge});

    // Owner, demo peer and reviewer sessions (control tokens).
    const ownerC = (await go('POST', '/api/owner/session', {token: FAKE.OWNER_CONTROL_TOKEN}, {origin: ORIGIN})).cookie;
    const peerC = (await go('POST', '/api/owner/session', {token: FAKE.DEMO_PEER_CONTROL_TOKEN}, {origin: ORIGIN})).cookie;
    const reviewerC = (await go('POST', '/api/owner/session', {token: FAKE.REVIEWER_CONTROL_TOKEN}, {origin: ORIGIN})).cookie;
    assert.ok(ownerC && peerC && reviewerC);
    assert.notEqual((await go('POST', '/api/owner/session', {token: 'not-a-control-token-0000000000000000'}, {origin: ORIGIN})).status, 200);
    await go('GET', '/api/owner/session', undefined, {cookie: ownerC});
    await go('GET', '/api/status', undefined, {cookie: ownerC});

    // Agent key: its one intended appearance is the issue response.
    const issued = await go('POST', '/api/agent-keys', undefined, h(ownerC), {issue: true});
    assert.equal(issued.status, 201);
    const KEY = issued.body.key;
    assert.match(KEY, PATTERNS.agentKey);
    secrets.push(['agent key', KEY]);
    assert.equal(surfaces.at(-1).text.split(KEY).length - 1, 1, 'the issue response shows the key exactly once');
    await go('GET', '/api/agent-keys', undefined, {cookie: ownerC});

    // MCP with the key.
    const auth = {authorization: 'Bearer ' + KEY, accept: 'application/json, text/event-stream'};
    const v = {...auth, 'mcp-protocol-version': '2025-06-18'};
    let rpcId = 0;
    const rpc = (method, params, headers = v) => go('POST', '/mcp', {jsonrpc: '2.0', id: ++rpcId, method, params}, headers);
    assert.equal((await rpc('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'i12', version: '1'}}, auth)).status, 200);
    await go('POST', '/mcp', {jsonrpc: '2.0', method: 'notifications/initialized'}, v);
    await rpc('tools/list');
    for (const [name, args] of [['register_agent', {}], ['get_agent_card', {}], ['get_world_state', {}], ['greet', {text: 'Hello from I-12'}], ['update_wants', {goal: 'Find a map', items: ['paper_map']}], ['discover', {}], ['heartbeat_check', {}], ['propose_meetup', {to: '01-sunny'}]]) {
      const r = await rpc('tools/call', {name, arguments: args});
      assert.equal(r.status, 200, name);
    }
    assert.equal((await rpc('tools/list', undefined, {...v, authorization: 'Bearer msly_' + 'x'.repeat(43)})).status, 401);

    // Model paths: the proxy (visitor, judge, the ritual's challenge) and the heartbeat.
    const spot = {action: 'spotlight', input: {muse: '03-ripple', freedom: 'where', localTime: '14:10', place: 'The commons'}};
    assert.equal((await go('POST', '/api/muse', spot, {cookie: judge})).body.source, 'live');
    await go('POST', '/api/muse', spot, {cookie: visitor});
    const ritual = await go('POST', '/api/ritual/start', {}, {cookie: judge});
    const frame = 'data:image/jpeg;base64,' + Buffer.from('i12 frame').toString('base64');
    await go('POST', '/api/muse', {action: 'challenge', input: {challengeId: ritual.body.id, frames: [frame, frame, frame]}}, {cookie: judge});
    await dobj.alarm();
    await go('POST', '/api/world/spotlight', {muse: '06-ink'}, {cookie: judge});

    // Signed paths that use OWNER_ROOT_JWK: P0, demo checks, owner revoke and re-delegate, location, reviewer reset.
    await go('POST', '/api/p0/run', {}, {cookie: judge});
    await go('POST', '/api/demo/impostor', {}, {cookie: judge});
    await go('POST', '/api/demo/injection', {}, {cookie: judge});
    await go('POST', '/api/owner/location', {source: 'virtual', preset: 'stanford'}, h(ownerC));
    await go('GET', '/api/owner/location');
    await go('GET', '/api/owner/notifications', undefined, {cookie: ownerC});
    assert.equal((await go('POST', '/api/owner/revoke', {muse: '00-jolly'}, h(peerC))).status, 403);
    assert.equal((await go('POST', '/api/owner/revoke', {muse: '00-jolly'}, h(ownerC))).status, 200);
    assert.equal((await go('POST', '/api/owner/redelegate', {muse: '00-jolly'}, h(ownerC))).status, 200);
    await go('POST', '/api/owner/reset', {}, h(reviewerC));

    // Threads claim: a wrong account (logged failure), then the owner account (token stored), then a re-check.
    const start = async () => { const s = await go('GET', '/api/threads/start'); const state = new URL(s.location).searchParams.get('state'); return {state, cookie: s.cookie}; };
    let s = await start();
    let cb = await go('GET', '/api/threads/callback?code=i12-code&state=' + encodeURIComponent(s.state), undefined, {cookie: s.cookie});
    assert.match(cb.location, /claim=failed&step=identity/);
    assert.ok(logs.some(l => l.includes('threads claim failed')), 'the failure was logged');
    threadsUser = claim.handle;
    s = await start();
    cb = await go('GET', '/api/threads/callback?code=i12-code-2&state=' + encodeURIComponent(s.state), undefined, {cookie: s.cookie});
    assert.match(cb.location, /claim=claimed/);
    assert.equal(dobj.claimToken(claim.agent), THREADS_TOKEN, 'the long-lived token is kept server-side');
    await go('GET', '/api/claim/' + claim.agent);
    dobj.setClaim(claim.agent, {...dobj.getClaim(claim.agent), checkedAt: 1});
    const rechecked = await go('GET', '/api/claim/' + claim.agent);
    assert.match(rechecked.body.record.note, /recheck paused/, 'the re-check ran with the stored token');

    // Public reads, the run log and identity documents.
    await go('GET', '/api/world');
    const events = (await go('GET', '/api/world/events?limit=2000')).body;
    assert.ok(events.length > 20);
    await go('GET', '/api/world/highlights?limit=300');
    const run = (await go('GET', '/api/world/run')).body;
    assert.equal((await go('GET', '/api/world/run?snapshot=1')).status, 200);
    assert.equal((await go('GET', '/api/world/run/inputs?runId=' + encodeURIComponent(run.runId) + '&limit=500')).status, 200);
    await go('GET', '/api/world/autonomy');
    await go('GET', '/api/world/event?id=' + encodeURIComponent(events.at(-1).id));
    await go('GET', '/api/ritual/record');
    let ownerKeys = 0;
    for (const muse of HARNESS_IDS) {
      const card = await go('GET', `/api/agents/${muse}/card`);
      assert.equal(card.status, 200, muse);
      // The JWKS a verifier follows: `jku` in the card signature's protected header.
      const jku = new URL(JSON.parse(Buffer.from(card.body.signatures[0].protected, 'base64url').toString()).jku);
      assert.equal(jku.origin, ORIGIN);
      const set = await go('GET', jku.pathname);
      assert.equal(set.status, 200, muse);
      for (const doc of [card.body, set.body]) JSON.stringify(doc, (k, val) => { if (val && typeof val === 'object' && 'kty' in val) assert.ok(!('d' in val), `${muse}: a private JWK member in ${k || 'the document'}`); return val; });
      if (set.body.keys[0].x === root.jwk.x) { ownerKeys++; assert.equal(set.body.keys[0].y, root.jwk.y); }
    }
    assert.equal(ownerKeys, 1, 'the owner root public key is published once (so the owner JWKS was read)');

    // Purge the key; afterwards it no longer works.
    assert.equal((await go('DELETE', `/api/agent-keys/${issued.body.id}?purge=1`, undefined, h(ownerC))).status, 200);
    assert.equal((await rpc('tools/list')).status, 401);

    // 1. Responses (headers and bodies).
    assert.ok(surfaces.length > 60);
    for (const sf of surfaces) assert.deepEqual(leaks(sf.text, secrets, sf.issue ? {except: ['agent key', 'pattern:agentKey']} : {}), [], sf.label);
    // 2. Events and the run log, read straight from storage as well as through the API above.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
    for (const t of ['events', 'runs', 'run_inputs', 'commands', 'agent_keys', 'claims', 'private_keys']) assert.ok(tables.includes(t), t);
    for (const t of tables) {
      const rows = db.prepare(`SELECT * FROM "${t}"`).all();
      // Intended storage: the Threads token in claims.token; resident and executor private keys in private_keys.
      const text = JSON.stringify(t === 'claims' ? rows.map(({token: _t, ...r}) => r) : rows);
      assert.deepEqual(leaks(text, secrets, t === 'private_keys' ? {except: ['pattern:privateJwk']} : {}), [], 'storage table ' + t);
    }
    assert.ok(db.prepare('SELECT count(*) AS n FROM run_inputs').get().n > 0 && db.prepare('SELECT count(*) AS n FROM events').get().n > 20, 'the run log and events were written');
    // 3. Logs.
    assert.ok(logs.some(l => l.startsWith('log heartbeat')), 'the heartbeat log line was captured');
    assert.deepEqual(leaks(logs.join('\n'), secrets), [], 'console logs');
    // 4. Outbound requests: each secret goes only to the service it is for.
    const allowed = {'api.meta.ai': ['MODEL_API_KEY'], 'challenges.cloudflare.com': ['TURNSTILE_SECRET'], 'graph.threads.net': ['THREADS_APP_SECRET', 'Threads token', 'Threads short-lived token']};
    for (const r of outbound) assert.deepEqual(leaks(JSON.stringify(r), secrets, {except: [...(allowed[r.host] ?? []), ...(r.host === 'api.meta.ai' ? ['pattern:modelKey'] : [])]}), [], 'request to ' + r.host + new URL(r.url).pathname);
    const model = outbound.filter(r => r.host === 'api.meta.ai');
    assert.ok(model.length >= 3, 'proxy, ritual and heartbeat called the model');
    for (const r of model) {
      assert.equal(r.url, 'https://api.meta.ai/v1/chat/completions');
      assert.deepEqual(Object.keys(r.headers).sort(), ['authorization', 'content-type']);
    }
    assert.ok(model.some(r => JSON.parse(r.body).response_format.json_schema.name === 'challenge_verdict'), 'the challenge request was among them');
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, saved);
  }
});

test('I-12 wording: terms, About and this record tell the demo limits apart from the unbuilt probation and per-owner limits', async () => {
  const {HOURLY_LIMITS, CHALLENGE_HOURLY_LIMIT, IP_HOURLY_LIMIT} = await import('../worker/core/ledger.ts');
  const {SPOTLIGHT_REQUESTS_PER_HOUR} = await import('../worker/core/world-runtime.ts');
  const {SESSION_TTL_MS} = await import('../worker/core/session.ts');
  const vars = await wranglerVars();
  const plain = html => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  // Public wording: /terms section "Limits in this demo", enforced limits first, then what is not built.
  const section = (await readFile(APP + 'static/terms.html', 'utf8')).split('<h2 id="demo-limits">')[1]?.split('<h2')[0];
  assert.ok(section, 'terms.html has the #demo-limits section');
  const [enforced, notBuilt] = plain(section).split('Remaining demo limits:');
  assert.ok(notBuilt, 'the section separates what is not built');
  for (const fact of [`${SESSION_TTL_MS / 3_600_000}-hour session`, `${HOURLY_LIMITS.visitor} live Muse Spark calls per hour`, `own ${CHALLENGE_HOURLY_LIMIT} per hour`, `spotlight requests are also ${SPOTLIGHT_REQUESTS_PER_HOUR.visitor} per hour`, `capped at ${IP_HOURLY_LIMIT} per hour`, `${HOURLY_LIMITS.judge} live calls per hour`, `US$${vars.DAILY_BUDGET_USD}`, '00:00 UTC', 'recorded replay', 'Personal Muse connections', 'demo peer and a directory-review Muse']) assert.ok(enforced.includes(fact), 'enforced now: ' + fact);
  assert.ok(!/probation|per-owner/.test(enforced), 'the enforced limits do not claim the unbuilt safeguards');
  for (const fact of ['Personal sign-in and connections are implemented', 'no 24-hour probation', 'no per-owner rate limit']) assert.ok(notBuilt.includes(fact), 'not built: ' + fact);
  // The About dialog points to it.
  const aboutHtml = (await readFile(APP + 'src/index.html', 'utf8')).split('<section id="about-dialog"')[1].split('</section>')[0];
  assert.ok(aboutHtml.includes('href="/terms#demo-limits"'), 'About links to the limits');
  const about = plain(aboutHtml);
  for (const fact of [`${HOURLY_LIMITS.visitor} live Muse Spark calls per hour`, 'daily model budget', 'not built yet']) assert.ok(about.includes(fact), 'About: ' + fact);
  // The verification record and the deployment notes keep the same split.
  const record = (await readFile(APP + 'docs/V2_VERIFICATION.md', 'utf8')).split('### 7.1 Demo limits and what is not built')[1]?.split('### 7.2')[0];
  assert.ok(record, 'V2_VERIFICATION.md section 7.1');
  const [table, unbuilt] = record.split('Not built (S4, G-01):');
  for (const fact of [`${HOURLY_LIMITS.visitor} per session per hour`, `${HOURLY_LIMITS.judge} live calls per judge session per hour`, `${IP_HOURLY_LIMIT} visitor calls per IP per hour`, `(${vars.DAILY_BUDGET_USD} at this commit)`]) assert.ok(table.includes(fact), 'record: ' + fact);
  assert.ok(unbuilt && /24-hour probation/.test(unbuilt) && /per-owner rate limits/.test(unbuilt));
  const deployment = await readFile(APP + 'docs/DEPLOYMENT.md', 'utf8');
  assert.ok(deployment.includes('Not built: a 24-hour probation for new Muses and per-owner rate limits') && deployment.includes('Personal sign-in, explicit connections and separate ownership proof are implemented') && deployment.includes('/terms#demo-limits'));
});
