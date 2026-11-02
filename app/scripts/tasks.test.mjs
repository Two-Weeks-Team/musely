// I-07 (#54): trades, sealed meetup coordination and both owners' inbox approval, through the real Worker entry
// (worker/index.ts) and WorldDO over node:sqlite (as in owner-control.test.mjs). Two owners use independent sessions:
// the real owner (Jolly) and the team-controlled demo peer (Copper), each with its own cookie and its own agent key.
// One test per acceptance criterion, plus the two-owner session check and the redaction check:
//   AC1 trade: first answer, counters ≤ 2, lock, atomic swap, a duplicate accept rewarded once
//   AC2 meetup: ≤ 5 public candidates, private conditions stay in the browser, only the same revision/hash approved by both confirms
//   AC3 one owner declines, the deadline passes, a delegation is revoked, the candidates change: no confirmation, no reward
//   AC4 the agent inbox and the three owner notifications stay apart; a rejection reason is never in input, network or logs
//   AC5 the version 2 migration keeps every v1 Task, inbox item and agent key; a restart is idempotent
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

const hooks = `export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return {url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true};
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

const {parseBusy, evaluateCandidates, suggestCandidate, approvalBody, submitDecision, loadOwnerInbox, loadConditions, saveConditions, PRIVATE_STORE_KEY} = await import('../src/ui/owner-inbox.ts');
const {taskRecord, migrateInbox, syncTask, meetupCandidates, MAX_CANDIDATES, registerTaskKind} = await import('../worker/core/tasks.ts');
const {verifyHistory} = await import('../src/engine/items.ts');
const {publicState, SNAPSHOT_FIELDS, PRIVATE} = await import('../worker/core/run-log.ts');
const {PLACES} = await import('../src/engine/places.ts');

const ORIGIN = 'https://musely.net';
const OWNER_TOKEN = 'test-owner-control-token-0000000000001';
const PEER_TOKEN = 'test-demo-peer-control-token-000000002';
const JUDGE_TOKEN = 'test-judge-link-token-00000000000003';
const JOLLY = '00-jolly', COPPER = '09-copper', SUNNY = '01-sunny', MOSS = '02-moss';
const COMMONS = new Set(PLACES.filter(p => p.zone === 'commons').map(p => p.id));

async function boot() {
  const {default: worker, WorldDO} = await import('../worker/index.ts');
  const {issueSession, sessionCookie} = await import('../worker/core/session.ts');
  const db = new DatabaseSync(':memory:');
  const sql = {exec(q, ...b) { if (/^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i.test(q)) throw new Error('Durable Object SQL rejects transaction statements; use transactionSync'); const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }};
  let alarm = null, ready, depth = 0;
  const transactionSync = fn => { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('transactionSync callback must be synchronous'); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } };
  const ctx = {storage: {sql, transactionSync, getAlarm: async () => alarm, setAlarm: async x => { alarm = x; }}, blockConcurrencyWhile: fn => (ready = fn())};
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const env = {MODEL_ID: 'muse-spark-1.3', MODEL_BASE: 'https://api.meta.ai/v1', DAILY_BUDGET_USD: '1', TURNSTILE_SITEKEY: 'x', ALLOWED_HOSTS: 'musely.net,www.musely.net', PUBLIC_ORIGIN: ORIGIN,
    SESSION_SECRET: 'tasks-test-secret', JUDGE_TOKEN, OWNER_CONTROL_TOKEN: OWNER_TOKEN, DEMO_PEER_CONTROL_TOKEN: PEER_TOKEN, OWNER_ROOT_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))};
  const t = {env, ctx, sql, db, responses: []};
  t.start = async () => { t.dobj = new WorldDO(ctx, env); await ready; env.WORLD = {idFromName: () => 'id', get: () => t.dobj}; };
  await t.start();
  env.ASSETS = {fetch: async () => new Response('asset')};
  t.go = async (method, path, body, headers = {}) => {
    const r = await worker.fetch(new Request(ORIGIN + path, {method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers: {'content-type': 'application/json', ...headers}}), env);
    const text = await r.text();
    t.responses.push(text);
    return {status: r.status, body: text ? JSON.parse(text) : null, setCookie: r.headers.get('set-cookie')};
  };
  t.session = async tier => sessionCookie((await issueSession(env.SESSION_SECRET, tier)).token).split(';')[0];
  t.login = async token => { const r = await t.go('POST', '/api/owner/session', {token}, {origin: ORIGIN}); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.setCookie.split(';')[0]; };
  t.state = () => t.dobj.runtime.state();
  t.task = id => t.state().inbox.tasks.find(x => x.id === id);
  t.muse = id => t.state().muses.find(m => m.id === id);
  t.events = () => t.dobj.worldEvents(0, 2000);
  t.kinds = kind => t.events().filter(e => e.kind === kind);
  t.edit = fn => t.dobj.runtime.commitExternal(Date.now(), 'test-' + Math.random(), st => fn(st));
  t.dobj.setClaim('owner-muse', {agent: 'owner-muse', status: 'claimed', path: 'worker_token', handle: 'combba82', fingerprint: 'x', permalink: null, mediaId: null, postedText: null, verifiedAt: Date.now(), checkedAt: Date.now(), machineVerified: true, note: 'test'});
  return t;
}
const mcpClient = async (t, key) => {
  let id = 0;
  const auth = {authorization: 'Bearer ' + key, accept: 'application/json, text/event-stream'};
  const rpc = async (method, params) => (await t.go('POST', '/mcp', {jsonrpc: '2.0', id: ++id, method, params}, {...auth, 'mcp-protocol-version': '2025-06-18'})).body;
  await t.go('POST', '/mcp', {jsonrpc: '2.0', id: ++id, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'tasks', version: '1'}}}, auth);
  await t.go('POST', '/mcp', {jsonrpc: '2.0', method: 'notifications/initialized'}, {...auth, 'mcp-protocol-version': '2025-06-18'});
  return {rpc, tool: async (name, args = {}) => { const r = await rpc('tools/call', {name, arguments: args}); if (!r?.result) throw new Error(`${name}: ${JSON.stringify(r).slice(0, 400)}`); return r.result; }};
};
/** Two owners, each with its own owner session (cookie jar) and its own agent key; both Muses connected and side by side at the cafe. */
async function twoOwners() {
  const t = await boot();
  const owner = await t.login(OWNER_TOKEN), peer = await t.login(PEER_TOKEN);
  assert.notEqual(owner, peer, 'independent cookie jars');
  t.h = {owner: {cookie: owner, origin: ORIGIN}, peer: {cookie: peer, origin: ORIGIN}};
  const jk = (await t.go('POST', '/api/agent-keys', {}, t.h.owner)).body, ck = (await t.go('POST', '/api/agent-keys', {}, t.h.peer)).body;
  assert.deepEqual([jk.muse, ck.muse], [JOLLY, COPPER]);
  t.keys = {jolly: jk, copper: ck};
  t.jolly = await mcpClient(t, jk.key); t.copper = await mcpClient(t, ck.key);
  t.edit(st => { for (const id of [JOLLY, COPPER, SUNNY, MOSS]) { const m = st.muses.find(x => x.id === id); m.place = 'commons:cafe'; m.travel = null; m.beat = null; } });
  t.inbox = async who => t.go('GET', '/api/owner/inbox', undefined, {cookie: t.h[who].cookie});
  t.decide = async (who, body) => t.go('POST', '/api/owner/approvals', body, t.h[who]);
  return t;
}
/** Jolly proposes a meetup to `to`; both Muses accept; the Task waits for the owners. */
async function meetupToOwners(t, to = COPPER) {
  const p = await t.jolly.tool('propose_meetup', {to});
  assert.equal(p.isError, false, JSON.stringify(p.structuredContent));
  const id = p.structuredContent.task.id;
  if (to === COPPER) assert.equal((await t.copper.tool('answer_candidate', {task_id: id, answer: 'accept'})).isError, false);
  const a = await t.jolly.tool('answer_candidate', {task_id: id, answer: 'accept'});
  assert.equal(a.isError, false, JSON.stringify(a.structuredContent));
  assert.equal(a.structuredContent.owner_approval, 'required');
  return id;
}
const embers = (t, id) => t.muse(id).inventory.filter(i => i === 'meetup_ember').length;
const body = (task, decision, candidate) => ({taskId: task.id, revision: task.revision, contentHash: task.contentHash, decision, ...(candidate ? {candidate} : {})});

test('I-07 AC1 trade: the first answer, at most two counters, both sides locked, an atomic swap, and a duplicate accept rewarded once', async () => {
  const t = await twoOwners();
  t.edit(st => { st.muses.find(m => m.id === COPPER).inventory.push('tea', 'fruit'); });
  // A resident answers at once, in the same call: the first answer is part of the proposal's commit.
  t.edit(st => { st.muses.find(m => m.id === MOSS).inventory.push('wildflower'); st.muses.find(m => m.id === JOLLY).inventory.push('clover_seed'); });
  const toMoss = await t.jolly.tool('propose_trade', {to: MOSS, give: 'clover_seed', want: 'wildflower'});
  assert.equal(toMoss.isError, false, JSON.stringify(toMoss.structuredContent));
  assert.ok(['completed', 'countered', 'rejected'].includes(toMoss.structuredContent.result), 'answered by rule at once');
  assert.equal(toMoss.structuredContent.task.awaiting_you, toMoss.structuredContent.result === 'countered', 'no answer is left waiting unless the resident countered');

  // A connected peer answers in its own inbox. Proposal → counter 1 → counter 2 → a third counter is refused.
  const p = await t.jolly.tool('propose_trade', {to: COPPER, give: 'coffee', want: 'tea'});
  assert.deepEqual([p.isError, p.structuredContent.result], [false, 'pending']);
  const id = p.structuredContent.task.id;
  const waiting = (await t.copper.tool('heartbeat_check')).structuredContent.tasks_for_you.map(x => x.id);
  assert.deepEqual(waiting, [id], 'the first answer is the peer\'s to give');
  assert.equal((await t.jolly.tool('accept_trade', {task_id: id})).structuredContent.refused, 'not_your_turn');
  const c1 = await t.copper.tool('counter_trade', {task_id: id, give: 'fruit', want: 'coffee'});
  assert.equal(c1.isError, false, JSON.stringify(c1.structuredContent));
  const c2 = await t.jolly.tool('counter_trade', {task_id: id, give: 'coffee', want: 'tea'});
  assert.equal(c2.structuredContent.task.counters_used, 2);
  const c3 = await t.copper.tool('counter_trade', {task_id: id, give: 'fruit', want: 'coffee'});
  assert.equal(c3.structuredContent.refused, 'counter_limit');
  assert.equal(t.kinds('trade_counter_refused').length, 1);
  assert.equal(taskRecord(t.task(id)).revision, 3, 'each counter is a new revision (1 + 2 counters)');

  // Locked: neither side opens a second trade between them while this one is open.
  assert.equal((await t.jolly.tool('propose_trade', {to: COPPER, give: 'coffee', want: 'fruit'})).structuredContent.refused, 'open_task_exists');
  // Atomic: if one side no longer holds its item, accept is refused and neither inventory changes.
  t.edit(st => { const c = st.muses.find(m => m.id === COPPER); c.inventory.splice(c.inventory.indexOf('tea'), 1); });
  const before = JSON.stringify([t.muse(JOLLY).inventory, t.muse(COPPER).inventory, t.state().items.history.length]);
  assert.equal((await t.copper.tool('accept_trade', {task_id: id})).structuredContent.refused, 'not_held');
  assert.equal(JSON.stringify([t.muse(JOLLY).inventory, t.muse(COPPER).inventory, t.state().items.history.length]), before, 'nothing moved');
  assert.equal(t.task(id).status, 'pending');
  t.edit(st => st.muses.find(m => m.id === COPPER).inventory.push('tea'));

  const receipts0 = {j: t.muse(JOLLY).inventory.filter(i => i === 'trade_receipt').length, c: t.muse(COPPER).inventory.filter(i => i === 'trade_receipt').length};
  const accept = await t.copper.tool('accept_trade', {task_id: id, command_id: 'accept-once-0001'});
  assert.equal(accept.isError, false, JSON.stringify(accept.structuredContent));
  assert.ok(t.muse(JOLLY).inventory.includes('tea') && !t.muse(JOLLY).inventory.includes('coffee'));
  assert.ok(t.muse(COPPER).inventory.includes('coffee') && !t.muse(COPPER).inventory.includes('tea'));
  const after = () => ({j: t.muse(JOLLY).inventory.filter(i => i === 'trade_receipt').length, c: t.muse(COPPER).inventory.filter(i => i === 'trade_receipt').length,
    swaps: t.kinds('trade_completed').filter(e => e.data.task_id === id).length, notes: t.state().inbox.notifications.filter(n => n.kind === 'trade_completed' && n.ref === id).length, history: t.state().items.history.length});
  const once = after();
  assert.deepEqual(t.state().inbox.notifications.filter(n => n.kind === 'trade_completed' && n.ref === id).map(n => n.muse).sort(), [JOLLY, COPPER].sort(), 'both owners receive the completed trade');
  assert.deepEqual([once.j - receipts0.j, once.c - receipts0.c, once.swaps, once.notes], [1, 1, 1, 2], 'one receipt each, one swap event, one notification per owner');
  // The same accept again (same command_id): the first result, nothing more. A new accept: the Task is completed.
  const retry = await t.copper.tool('accept_trade', {task_id: id, command_id: 'accept-once-0001'});
  assert.deepEqual([retry.isError, retry.structuredContent.command.duplicate], [false, true]);
  assert.equal((await t.copper.tool('accept_trade', {task_id: id, command_id: 'accept-twice-002'})).structuredContent.refused, 'task_completed');
  assert.equal((await t.jolly.tool('accept_trade', {task_id: id})).structuredContent.refused, 'task_completed');
  assert.deepEqual(after(), once, 'a duplicate accept rewards once');
  assert.equal(verifyHistory(t.state().items).ok, true);
  assert.equal(taskRecord(t.task(id)).status, 'completed');
});

test('I-07 AC2 meetup: at most five public candidates, private conditions stay in the browser, only the same revision and hash approved by both owners confirms', async () => {
  const t = await twoOwners();
  const p = await t.jolly.tool('propose_meetup', {to: COPPER});
  const cands = p.structuredContent.task.candidates;
  assert.ok(cands.length >= 1 && cands.length <= MAX_CANDIDATES && MAX_CANDIDATES === 5, `${cands.length} candidates`);
  assert.deepEqual(cands.map(c => c.id), cands.map((_, i) => `c${i + 1}`));
  for (const c of cands) { assert.match(c.time, /^([01]\d|2[0-3]):(00|30)$/); assert.ok(COMMONS.has(c.place_id), c.place_id); assert.match(c.public_basis, /likes|like|open spot/); }
  assert.equal(new Set(cands.map(c => `${c.time}|${c.place_id}`)).size, cands.length, 'no repeated candidate');
  // Public information only: the builder takes the two Muses and the time, nothing else.
  assert.equal(meetupCandidates.length, 3, 'meetupCandidates(a, b, at, shift?) has no input for private conditions');
  const id = p.structuredContent.task.id;
  await t.copper.tool('answer_candidate', {task_id: id, answer: 'accept'});
  await t.jolly.tool('answer_candidate', {task_id: id, answer: 'accept'});
  assert.equal((await t.copper.tool('answer_candidate', {task_id: id, answer: 'accept'})).structuredContent.refused, 'awaiting_owner_approval', 'the Muses cannot confirm it themselves');
  const task = t.task(id);
  assert.deepEqual([task.status, task.stage, task.approvals], ['pending', 'owner_approval', {}]);
  assert.equal(embers(t, JOLLY) + embers(t, COPPER), 0);

  // Each owner sees the same Task, revision and hash in its own owner inbox.
  const oi = (await t.inbox('owner')).body, pi = (await t.inbox('peer')).body;
  assert.deepEqual([oi.approvals.length, pi.approvals.length], [1, 1]);
  assert.deepEqual([oi.approvals[0].muse, pi.approvals[0].muse], [JOLLY, COPPER]);
  assert.deepEqual([oi.approvals[0].revision, oi.approvals[0].content_hash], [task.revision, task.contentHash]);
  assert.deepEqual([pi.approvals[0].revision, pi.approvals[0].content_hash], [task.revision, task.contentHash]);
  assert.equal(oi.approvals[0].candidates.length, cands.length);

  // The owner's private conditions are evaluated in the browser (owner-inbox.ts) and never leave it. The owner cannot
  // make the first candidate's time and skips the second's place; its own fetch is the network fixture.
  const store = new Map(), local = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v))};
  const busy = `${cands[0].time}-${cands[0].time.replace(/:(\d\d)/, (_, m) => m === '00' ? ':29' : ':59')}`;
  const cond = {busy: parseBusy(busy), avoid: [cands[1].place_id]};
  saveConditions(local, cond);
  assert.deepEqual(loadConditions(local), cond, 'kept on this device');
  const verdicts = evaluateCandidates(oi.approvals[0].candidates, loadConditions(local));
  assert.deepEqual(verdicts.slice(0, 2).map(v => [v.fits, v.clash]), [[false, 'busy'], [false, 'place']]);
  const pick = suggestCandidate(oi.approvals[0], verdicts);
  assert.ok(verdicts.find(v => v.id === pick).fits, 'the suggested candidate fits the private conditions');
  const sent = [];
  const fetchAs = who => async (url, init) => { sent.push({url, ...init}); const r = await t.go(init.method, url, init.body, {...t.h[who]}); return {ok: r.status < 300, status: r.status, json: async () => r.body}; };

  // A wrong hash or revision is refused and records nothing.
  const wrong = await submitDecision(fetchAs('owner'), {...oi.approvals[0], content_hash: '0'.repeat(64)}, 'approve', pick);
  assert.deepEqual([wrong.status, wrong.data.error], [409, 'stale_approval']);
  assert.deepEqual(t.task(id).approvals, {});
  // The owner approves its pick: recorded for Jolly only, nothing confirmed yet.
  const first = await submitDecision(fetchAs('owner'), oi.approvals[0], 'approve', pick);
  assert.deepEqual([first.status, first.data.confirmed], [200, false]);
  assert.deepEqual(Object.keys(t.task(id).approvals), [JOLLY]);
  const loggedApproval = JSON.parse(t.sql.exec("SELECT input FROM run_inputs WHERE label LIKE 'owner-approval-%' ORDER BY seq DESC LIMIT 1").toArray()[0].input);
  assert.equal(loggedApproval?.action, 'owner_approval', 'owner decisions are recorded ordered inputs');
  assert.deepEqual(loggedApproval.fields, {taskId: id, museId: JOLLY, decision: 'approve', revision: task.revision, approvalRef: t.task(id).approvals[JOLLY].ref});
  assert.deepEqual(loggedApproval.omitted, []);
  assert.equal(embers(t, JOLLY) + embers(t, COPPER), 0, 'one approval issues nothing');
  // The peer: a different candidate, or the previous revision, does not confirm.
  const other = cands.find(c => c.id !== pick).id;
  assert.deepEqual([(await t.decide('peer', body(task, 'approve', other))).body.error, (await t.decide('peer', {...body(task, 'approve', pick), revision: task.revision + 1})).body.error], ['candidate_mismatch', 'stale_approval']);
  assert.equal(t.task(id).status, 'pending');
  // The same revision, hash and candidate from the other owner: confirmed, one Meetup Ember each through the item history chain.
  const peerInbox = (await loadOwnerInbox(fetchAs('peer'))).data.approvals[0];
  assert.deepEqual(peerInbox.theirs.candidate, pick, 'the peer sees which candidate the other owner approved');
  const second = await submitDecision(fetchAs('peer'), peerInbox, 'approve', pick);
  assert.deepEqual([second.status, second.data.confirmed], [200, true]);
  const done = t.task(id);
  assert.deepEqual([done.status, done.confirmed.candidate, taskRecord(done).status], ['completed', pick, 'completed']);
  assert.deepEqual([embers(t, JOLLY), embers(t, COPPER)], [1, 1]);
  const grants = t.state().items.history.filter(h => h.via === 'meetup');
  assert.deepEqual(grants.map(h => [h.item, h.to]), [['meetup_ember', JOLLY], ['meetup_ember', COPPER]]);
  assert.ok(grants.every(h => typeof h.hash === 'string'), 'chained');
  assert.ok(publicState(t.state()).items.history.filter(h => h.via === 'meetup').every(h => h.place == null), 'private meetup place must not enter public run snapshots');
  assert.equal(verifyHistory(t.state().items).ok, true);
  const confirmed = t.kinds('meetup_confirmed');
  assert.equal(confirmed.length, 1);
  assert.deepEqual(confirmed[0].data.approvals, {[JOLLY]: 'owner', [COPPER]: 'owner'});
  assert.deepEqual(taskRecord(done).approvalRefs, confirmed[0].data.approval_refs);
  // Retrying a decision returns it again and issues nothing more.
  const again = await submitDecision(fetchAs('peer'), peerInbox, 'approve', pick);
  assert.deepEqual([again.status, again.data.duplicate, embers(t, COPPER), t.kinds('meetup_confirmed').length], [200, true, 1, 1]);

  // Network fixture: what the owner-inbox code sent. Only the allowed fields, never a private condition.
  const posts = sent.filter(r => r.method === 'POST');
  assert.ok(posts.length >= 3);
  for (const r of sent) {
    const wire = JSON.stringify(r);
    for (const secret of [busy, JSON.stringify(cond), 'busy', 'avoid', PRIVATE_STORE_KEY]) assert.ok(!wire.includes(secret), `${r.method} ${r.url} sends ${secret}`);
  }
  for (const r of posts) assert.deepEqual(Object.keys(JSON.parse(r.body)).sort(), ['candidate', 'contentHash', 'decision', 'revision', 'taskId']);
  assert.deepEqual(Object.keys(approvalBody(oi.approvals[0], 'reject', pick)).sort(), ['contentHash', 'decision', 'revision', 'taskId'], 'a decline sends no candidate and no reason');
  // The candidates' times and places never reach a public event.
  for (const e of [...(await t.go('GET', '/api/world/events?limit=2000')).body, ...(await t.go('GET', '/api/world/highlights')).body]) {
    if (!/meetup|owner_decision/.test(e.kind)) continue;
    const pub = JSON.stringify({line: e.line, data: e.data});
    for (const c of cands) assert.ok(!pub.includes(c.time) && !pub.includes(c.place), `${e.kind} leaks a candidate`);
  }

  // The run log snapshot (I-10 allow-list): every version 2 field is named; candidates, hash, approvals, deciders and the
  // chosen candidate are private, the revision and stage are kept.
  const snapTask = publicState(t.state()).inbox.tasks.find(x => x.id === id);
  assert.deepEqual(Object.keys(done).filter(k => !(k in SNAPSHOT_FIELDS.task)), []);
  for (const k of ['candidates', 'contentHash', 'approvals', 'owners', 'confirmed']) assert.equal(snapTask[k], PRIVATE, k);
  assert.deepEqual([snapTask.revision, snapTask.stage, snapTask.schema], [done.revision, 'owner_approval', 2]);

  // A resident (no owner signs in for Sunny) approves by rule; the owner's approval alone then confirms.
  const rid = await meetupToOwners(t, SUNNY);
  const rt = t.task(rid);
  assert.deepEqual([rt.approvals[SUNNY].source, rt.approvals[SUNNY].by, rt.approvals[SUNNY].revision, rt.approvals[SUNNY].contentHash], ['rule', 'musely:rule', rt.revision, rt.contentHash]);
  assert.equal(t.kinds('owner_decision').find(e => e.data.task_id === rid).source, 'rule', 'the rule approval is labeled rule');
  const r = await t.decide('owner', body(rt, 'approve', 'c1'));
  assert.deepEqual([r.status, r.body.confirmed], [200, true]);
  assert.deepEqual(t.kinds('meetup_confirmed').at(-1).data.approvals, {[JOLLY]: 'owner', [SUNNY]: 'rule'});
  assert.deepEqual([embers(t, JOLLY), embers(t, SUNNY)], [2, 1]);
});

test('I-07 AC3 one owner declines, the deadline passes, a delegation is revoked, or the candidates change: nothing is confirmed or rewarded', async () => {
  const t = await twoOwners();
  const nothing = id => { assert.equal(t.kinds('meetup_confirmed').filter(e => e.data.task_id === id).length, 0, 'no confirmation'); assert.equal(t.state().items.history.filter(h => h.via === 'meetup').length, 0, 'no Meetup Ember'); assert.equal(t.task(id).confirmed, undefined); };

  // 1. One owner declines (after the other approved).
  const a = await meetupToOwners(t);
  assert.equal((await t.decide('owner', body(t.task(a), 'approve', 'c1'))).status, 200);
  const no = await t.decide('peer', body(t.task(a), 'reject'));
  assert.deepEqual([no.status, no.body.task.status], [200, 'rejected']);
  assert.deepEqual([(await t.decide('owner', body(t.task(a), 'approve', 'c1'))).body.error, t.task(a).status], ['task_rejected', 'rejected'], 'the owner\'s earlier approval does not reopen a declined meetup');
  assert.equal((await t.decide('peer', body(t.task(a), 'approve', 'c1'))).body.error, 'task_rejected');
  nothing(a);

  // 2. The approval window passes (server time).
  const b = await meetupToOwners(t, SUNNY);
  t.edit(st => { st.inbox.tasks.find(x => x.id === b).deadline = Date.now() - 1; });
  const late = await t.decide('owner', body(t.task(b), 'approve', 'c1'));
  assert.deepEqual([late.status, late.body.error, t.task(b).status], [409, 'task_expired', 'expired']);
  assert.equal(t.kinds('task_expired').filter(e => e.data.task_id === b && e.data.via === 'owner_approval').length, 1);
  assert.equal((await t.decide('owner', body(t.task(b), 'approve', 'c1'))).body.error, 'task_expired');
  nothing(b);

  // 3. A delegation is revoked: the Task is cancelled; neither the old approval nor a new one confirms, even after re-delegation.
  const c = await meetupToOwners(t);
  assert.equal((await t.decide('owner', body(t.task(c), 'approve', 'c2'))).status, 200);
  assert.equal((await t.go('POST', '/api/owner/revoke', {}, t.h.peer)).status, 200);
  assert.equal(t.task(c).status, 'cancelled');
  assert.equal((await t.decide('peer', body(t.task(c), 'approve', 'c2'))).body.error, 'delegation_revoked');
  assert.equal((await t.go('POST', '/api/owner/redelegate', {}, t.h.peer)).status, 200);
  assert.equal((await t.decide('peer', body(t.task(c), 'approve', 'c2'))).body.error, 'task_cancelled');
  assert.equal((await t.decide('owner', body(t.task(c), 'approve', 'c2'))).body.error, 'task_cancelled', 'an approval before the cancellation is not a confirmation after it');
  nothing(c);

  // 4. The candidates change: a new revision and hash, the earlier approval no longer applies.
  t.jolly = await mcpClient(t, t.keys.jolly.key); t.copper = await mcpClient(t, t.keys.copper.key);
  const d = await meetupToOwners(t);
  const v1 = structuredClone(t.task(d));
  assert.equal((await t.decide('owner', body(v1, 'approve', 'c1'))).status, 200);
  const revised = await t.jolly.tool('propose_meetup', {to: COPPER});
  assert.deepEqual([revised.isError, revised.structuredContent.revised, revised.structuredContent.approvals_invalidated], [false, true, 1]);
  const v2 = t.task(d);
  assert.equal(v2.revision, v1.revision + 1);
  assert.notEqual(v2.contentHash, v1.contentHash);
  assert.notDeepEqual(v2.candidates, v1.candidates);
  assert.deepEqual([v2.stage, v2.approvals, v2.answers], ['negotiate', {}, {}]);
  assert.equal(t.kinds('meetup_revised').at(-1).data.approvals_invalidated, 1);
  assert.equal((await t.decide('peer', body(v1, 'approve', 'c1'))).body.error, 'stale_approval', 'an approval of the old candidates is refused');
  assert.equal((await t.decide('peer', body(v2, 'approve', 'c1'))).body.error, 'not_ready_for_approval', 'the Muses answer the new candidates first');
  await t.copper.tool('answer_candidate', {task_id: d, answer: 'accept'});
  await t.jolly.tool('answer_candidate', {task_id: d, answer: 'accept'});
  const v2b = t.task(d);
  assert.equal(v2b.revision, v2.revision, 'answers are not a content change');
  assert.equal((await t.inbox('owner')).body.approvals.find(x => x.task_id === d).yours, null, 'the owner\'s old approval is gone');
  const peerOnly = await t.decide('peer', body(v2b, 'approve', 'c1'));
  assert.deepEqual([peerOnly.status, peerOnly.body.confirmed], [200, false], 'the other owner\'s approval of the old revision does not count');
  nothing(d);
  // Approved again on the new revision: now it confirms (the change alone blocked it).
  assert.equal((await t.decide('owner', body(v2b, 'approve', 'c1'))).body.confirmed, true);

  // 5. A content change made by any commit (not only propose_meetup) is caught at the commit point: a new revision,
  // and the approvals made before it (here the resident's rule approval) are dropped.
  const e = await meetupToOwners(t, SUNNY);
  const e1 = structuredClone(t.task(e));
  assert.equal(e1.approvals[SUNNY].source, 'rule');
  t.edit(st => { st.inbox.tasks.find(x => x.id === e).candidates[0].time = '23:30'; });
  assert.deepEqual([t.task(e).revision, t.task(e).approvals], [e1.revision + 1, {}]);
  assert.equal((await t.decide('owner', body(e1, 'approve', 'c1'))).body.error, 'stale_approval');
  const e2 = await t.decide('owner', body(t.task(e), 'approve', 'c1'));
  assert.deepEqual([e2.status, e2.body.confirmed], [200, false], 'the resident\'s rule approval of the old content no longer counts');
  assert.equal(t.kinds('meetup_confirmed').filter(x => x.data.task_id === e).length, 0);
});

test('I-07 two owners: owner and demo peer decide from independent sessions; cross approval is refused', async () => {
  const t = await twoOwners();
  const shared = await meetupToOwners(t);
  const sunny = await meetupToOwners(t, SUNNY);
  // A Task of the peer's Muse with a resident, waiting for owners (made by the peer's own agent).
  const cp = await t.copper.tool('propose_meetup', {to: MOSS});
  const cid = cp.structuredContent.task.id;
  if (t.task(cid).status === 'pending') await t.copper.tool('answer_candidate', {task_id: cid, answer: 'accept'});
  const judge = await t.session('judge');

  // Each session sees only its own Muse's approvals.
  const oi = (await t.inbox('owner')).body.approvals.map(x => [x.task_id, x.muse]), pi = (await t.inbox('peer')).body.approvals.map(x => [x.task_id, x.muse]);
  assert.deepEqual(oi, [[shared, JOLLY], [sunny, JOLLY]]);
  assert.deepEqual(pi.filter(([id]) => id !== cid), [[shared, COPPER]]);
  assert.ok(pi.every(([, m]) => m === COPPER));
  // Cross approval: not your Muse's Task.
  assert.deepEqual([(await t.decide('peer', body(t.task(sunny), 'approve', 'c1'))).status, (await t.decide('peer', body(t.task(sunny), 'approve', 'c1'))).body.error], [403, 'not_your_muse']);
  assert.equal((await t.decide('owner', body(t.task(cid), 'approve', 'c1'))).body.error, 'not_your_muse');
  assert.deepEqual(t.task(sunny).approvals[JOLLY], undefined);
  // No owner session, a judge session, or a foreign origin: refused.
  assert.equal((await t.go('POST', '/api/owner/approvals', body(t.task(shared), 'approve', 'c1'), {origin: ORIGIN})).status, 401);
  assert.equal((await t.go('POST', '/api/owner/approvals', body(t.task(shared), 'approve', 'c1'), {cookie: judge, origin: ORIGIN})).status, 401);
  assert.equal((await t.go('POST', '/api/owner/approvals', body(t.task(shared), 'approve', 'c1'), {cookie: t.h.owner.cookie, origin: 'https://evil.example'})).status, 403);
  assert.equal((await t.go('GET', '/api/owner/inbox', undefined, {cookie: judge})).status, 401);
  assert.equal(Object.keys(t.task(shared).approvals).length, 0);
  // On the shared Task each owner decides only for its own Muse; one owner's session never fills in the other side.
  assert.equal((await t.decide('owner', body(t.task(shared), 'approve', 'c3'))).status, 200);
  const dup = await t.decide('owner', body(t.task(shared), 'approve', 'c3'));
  assert.deepEqual([dup.body.duplicate, dup.body.confirmed, Object.keys(t.task(shared).approvals)], [true, false, [JOLLY]]);
  assert.equal(t.task(shared).approvals[JOLLY].by, 'owner:kim-sejun');
  const peerSide = await t.decide('peer', body(t.task(shared), 'approve', 'c3'));
  assert.deepEqual([peerSide.body.confirmed, t.task(shared).approvals[COPPER].by], [true, 'system:demo-peer']);
  assert.equal((await t.inbox('peer')).body.demo_limits.includes('not a second real Meta account'), true, 'the demo principal\'s limits are shown');
});

test('I-07 AC4 the agent inbox and the three owner notifications stay apart', async () => {
  const t = await twoOwners();
  const id = await meetupToOwners(t);
  // A daily greeting to the connected owner Muse (a resident's, delivered as the engine does): in the agent inbox, never an owner notification.
  const {deliverMessage} = await import('../src/engine/inbox.ts');
  t.edit(st => { deliverMessage(st.inbox, {from: MOSS, to: JOLLY, kind: 'greet', at: Date.now(), text: 'Hi Jolly'}); });
  const agent = (await t.jolly.tool('heartbeat_check')).structuredContent;
  assert.ok(agent.messages.some(m => m.kind === 'greet'), 'the greeting reached the agent inbox');
  assert.equal(agent.your_open_tasks.find(x => x.id === id).owner_approval, 'waiting');
  for (const k of ['notifications', 'approvals', 'recent']) assert.equal(k in agent, false, `the agent inbox has no ${k}`);
  assert.ok(!JSON.stringify(agent).includes('approval_ref'), 'no owner decision details in the agent inbox');
  const owner = (await t.inbox('owner')).body;
  for (const k of ['messages', 'mail', 'tasks_for_you', 'your_open_tasks']) assert.equal(k in owner, false, `the owner inbox has no ${k}`);
  assert.deepEqual(owner.notification_kinds, ['meetup_candidate', 'trade_completed', 'blocked']);
  assert.ok(owner.notifications.length > 0 && owner.notifications.every(n => owner.notification_kinds.includes(n.kind) && n.muse === JOLLY));
  assert.ok(!JSON.stringify(owner).includes('Hi Jolly'), 'the greeting is not an owner notification');
  assert.equal(owner.notifications.filter(n => n.kind === 'meetup_candidate' && n.ref === id).length, 1);
  // Both owned sides got the meetup candidate notification, each in its own inbox only.
  const peer = (await t.inbox('peer')).body;
  assert.deepEqual(peer.notifications.filter(n => n.ref === id).map(n => [n.kind, n.muse]), [['meetup_candidate', COPPER]]);
  assert.ok(peer.notifications.every(n => n.muse === COPPER));
  assert.equal(t.state().inbox.notifications.filter(n => !['meetup_candidate', 'trade_completed', 'blocked'].includes(n.kind)).length, 0);
});

test('I-07 AC4 redaction: a rejection reason sent anyway is in no event, run log, stored row, console line or response', async () => {
  const SECRET = 'PRIVATE-REASON-dentist-at-6pm-7f3a';
  const logs = [], orig = {log: console.log, error: console.error, warn: console.warn, info: console.info};
  for (const k of Object.keys(orig)) console[k] = (...a) => { logs.push(a.map(String).join(' ')); };
  try {
    const t = await twoOwners();
    const id = await meetupToOwners(t);
    const task = t.task(id), events0 = t.events().length, state0 = JSON.stringify(task);
    // Refused unread: a reason field, a reason in another field, a reason as a candidate.
    for (const b of [{...body(task, 'reject'), reason: SECRET}, {...body(task, 'reject'), note: SECRET}, {...body(task, 'approve'), candidate: SECRET}, {...body(task, 'reject'), decision: 'reject: ' + SECRET}, {...body(task, 'reject'), [SECRET]: true}]) {
      const r = await t.decide('peer', b);
      assert.equal(r.status, 400, JSON.stringify(b));
    }
    assert.equal(JSON.stringify(t.task(id)), state0, 'nothing changed');
    assert.equal(t.events().length, events0, 'nothing logged');
    // The Muse's own sealed answers have no reason either: an extra argument or a non-enum answer is refused.
    const extra = await t.copper.rpc('tools/call', {name: 'reject_trade', arguments: {task_id: 'task_1', reason: SECRET}});
    const bad = await t.copper.rpc('tools/call', {name: 'answer_candidate', arguments: {task_id: id, answer: SECRET}});
    assert.deepEqual([extra.error.code, bad.error.code], [-32602, -32602]);
    // A real decline goes through, without any reason.
    const no = await t.decide('peer', body(task, 'reject'));
    assert.deepEqual([no.status, no.body.task.status], [200, 'rejected']);
    assert.deepEqual(Object.keys(t.task(id).approvals[COPPER]).sort(), ['at', 'by', 'candidate', 'contentHash', 'decision', 'ref', 'revision', 'source']);
    // Everything the deployment stored, logged or answered.
    const tables = t.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map(r => r.name);
    const stored = tables.map(n => JSON.stringify(t.sql.exec(`SELECT * FROM ${n}`).toArray())).join('\n');
    const pub = JSON.stringify([(await t.go('GET', '/api/world/events?limit=2000')).body, (await t.go('GET', '/api/world/highlights')).body, (await t.go('GET', '/api/owner/notifications')).body]);
    const owners = JSON.stringify([(await t.inbox('owner')).body, (await t.inbox('peer')).body, (await t.jolly.tool('heartbeat_check')).structuredContent]);
    for (const [where, text] of [['stored rows (world state, events, commands, …)', stored], ['public run log', pub], ['owner and agent inboxes', owners], ['responses', t.responses.join('\n')], ['console', logs.join('\n')]]) {
      assert.ok(!text.includes(SECRET) && !text.includes('dentist'), `${where} contain the reason`);
    }
  } finally {
    Object.assign(console, orig);
  }
});

test('I-07 AC5 the version 2 migration keeps every v1 Task, inbox item and agent key; a restart is idempotent', async () => {
  const t = await boot();
  const owner = await t.login(OWNER_TOKEN);
  const key = (await t.go('POST', '/api/agent-keys', {}, {cookie: owner, origin: ORIGIN})).body;
  const now = Date.now(), day = t.state().day;
  // A stored version 1 inbox (as #26 / I-03A wrote it): no version, no schema/revision/contentHash, a meetup with one
  // `candidate`, a `failed` Task, closed Tasks, messages, mail, notifications (one from before `muse`), connected flags.
  const v1 = {
    tasks: [
      {id: 'task_1', kind: 'trade', from: JOLLY, to: MOSS, status: 'pending', awaiting: JOLLY, createdAt: now - 9e5, deadline: now + 9e5, updatedAt: now - 6e5, offer: {by: MOSS, give: 'wildflower', want: 'coffee'}, round: 1, history: [{by: JOLLY, action: 'propose', at: now - 9e5, give: 'coffee', want: 'tea'}, {by: MOSS, action: 'counter', at: now - 6e5, give: 'wildflower', want: 'coffee'}]},
      {id: 'task_2', kind: 'meetup', from: JOLLY, to: SUNNY, status: 'pending', awaiting: JOLLY, createdAt: now - 5e5, deadline: now + 1e6, updatedAt: now - 5e5, round: 0, candidate: {time: '18:00', place: 'Commons Cafe', public_basis: 'both like cafe spots'}, answers: {[SUNNY]: 'accept'}, history: [{by: JOLLY, action: 'propose', at: now - 5e5}, {by: SUNNY, action: 'answer', at: now - 5e5}]},
      {id: 'task_3', kind: 'trade', from: '03-ripple', to: JOLLY, status: 'failed', awaiting: JOLLY, createdAt: now - 4e6, deadline: now - 2e6, updatedAt: now - 2e6, offer: {by: '03-ripple', give: 'paper_map', want: 'coffee'}, round: 0, history: [{by: '03-ripple', action: 'propose', at: now - 4e6}]},
      {id: 'task_4', kind: 'trade', from: JOLLY, to: '06-ink', status: 'completed', awaiting: null, createdAt: now - 8e6, deadline: now - 7e6, updatedAt: now - 7.5e6, offer: {by: JOLLY, give: 'pastry', want: 'tea'}, round: 0, history: [{by: JOLLY, action: 'propose', at: now - 8e6}, {by: '06-ink', action: 'accept', at: now - 7.5e6, via: 'rule'}]},
      {id: 'task_5', kind: 'meetup', from: COPPER, to: '05-bloom', status: 'expired', awaiting: null, createdAt: now - 9e6, deadline: now - 8e6, updatedAt: now - 8e6, round: 0, candidate: {time: '07:30', place: 'The Garden', public_basis: 'Bloom likes garden spots'}, answers: {}, history: [{by: COPPER, action: 'propose', at: now - 9e6}, {by: 'musely', action: 'expire', at: now - 8e6}]},
    ],
    messages: [{id: 'm_1', from: MOSS, to: JOLLY, kind: 'greet', at: now - 1e5, text: 'hello', read: false}, {id: 'm_2', from: SUNNY, to: JOLLY, kind: 'gift', at: now - 2e5, text: null, item: 'fruit', read: true}],
    mail: [{id: 'mail_1', from: MOSS, to: JOLLY, item: 'postcard:commons:garden', text: 'from the garden', sentAt: now - 1e5, deliverAt: now + 1e6, crossRegion: false}],
    notifications: [{id: 'n_1', kind: 'trade_completed', at: now - 7.5e6, line: 'Your Muse traded', ref: 'task_4', other: '06-ink'}, {id: 'n_2', kind: 'meetup_candidate', at: now - 5e5, line: 'A meetup candidate', ref: 'task_2', other: SUNNY, muse: JOLLY, detail: {time: '18:00', place: 'Commons Cafe', public_basis: 'both like cafe spots'}}, {id: 'n_3', kind: 'blocked', at: now - 3e5, line: 'Blocked', ref: null, other: '07-tempo', muse: JOLLY}],
    connected: {[JOLLY]: now - 1e5}, sent: {[day]: {[JOLLY]: {postcards: 1, gifts: 0}}}, seq: 40,
  };
  const s0 = t.state(); s0.inbox = v1;
  t.sql.exec('UPDATE world SET state = ? WHERE id = 1', JSON.stringify(s0));
  const keyRows = () => JSON.stringify(t.sql.exec('SELECT id, hash, muse, signer_kind, created_at, revoked_at FROM agent_keys ORDER BY id').toArray());
  const keysBefore = keyRows(), keyCount = t.sql.exec('SELECT COUNT(*) AS n FROM agent_keys').toArray()[0].n;
  const itemsBefore = JSON.stringify(t.state().items), musesBefore = JSON.stringify(t.state().muses.map(m => [m.id, m.inventory]));

  // Restart: the Durable Object comes up over the same storage and migrates once.
  await t.start();
  const ib = t.state().inbox;
  assert.equal(ib.version, 2);
  assert.deepEqual(ib.tasks.map(x => x.id), v1.tasks.map(x => x.id), 'same Tasks, same order');
  for (const [i, x] of ib.tasks.entries()) {
    const o = v1.tasks[i];
    assert.deepEqual([x.id, x.kind, x.from, x.to, x.deadline, x.createdAt, x.offer, x.round, x.history], [o.id, o.kind, o.from, o.to, o.deadline, o.createdAt, o.offer, o.round, o.history], `${o.id} keeps its v1 fields`);
    assert.equal(x.schema, 2); assert.match(x.contentHash, /^[0-9a-f]{64}$/); assert.deepEqual(x.approvals, {});
  }
  assert.deepEqual(ib.tasks.map(x => x.revision), [2, 1, 1, 1, 1], 'a counter already made is a revision');
  assert.deepEqual(ib.tasks.map(x => x.status), ['pending', 'pending', 'cancelled', 'completed', 'expired'], 'failed → cancelled (C06), nothing else');
  assert.deepEqual(ib.tasks[1].candidates, [{id: 'c1', time: '18:00', place: 'Commons Cafe', place_id: null, public_basis: 'both like cafe spots'}]);
  assert.equal(ib.tasks[1].candidate, undefined);
  assert.deepEqual(ib.tasks.map(x => taskRecord(x).status), ['input-required', 'input-required', 'cancelled', 'completed', 'expired']);
  for (const k of ['messages', 'mail', 'notifications', 'connected', 'sent', 'seq']) assert.deepEqual(ib[k], v1[k], `${k} unchanged`);
  assert.equal(JSON.stringify(t.state().items), itemsBefore); assert.equal(JSON.stringify(t.state().muses.map(m => [m.id, m.inventory])), musesBefore);
  assert.deepEqual([keyRows(), t.sql.exec('SELECT COUNT(*) AS n FROM agent_keys').toArray()[0].n], [keysBefore, keyCount], 'agent keys untouched');
  const mig = t.kinds('tasks_migrated');
  assert.equal(mig.length, 1);
  const loggedMigration = JSON.parse(t.sql.exec("SELECT input FROM run_inputs WHERE label = 'tasks-v2-migrate' ORDER BY seq DESC LIMIT 1").toArray()[0].input);
  assert.equal(loggedMigration?.action, 'tasks_migrated');
  assert.deepEqual(loggedMigration.fields, {from: 1, to: 2, migrated: 5, failedToCancelled: 1, candidatesMoved: 2, tasks: 5});
  assert.deepEqual([mig[0].data.from, mig[0].data.to, mig[0].data.migrated, mig[0].data.failed_to_cancelled, mig[0].data.candidates_moved, mig[0].data.tasks], [1, 2, 5, 1, 2, 5]);

  // Restart again: nothing is written (same state row, same version, no second event).
  const row = () => t.sql.exec('SELECT state, version FROM world WHERE id = 1').toArray()[0];
  const before = row(), evs = t.events().length;
  await t.start(); await t.start();
  assert.deepEqual(row(), before, 'byte-identical world row');
  assert.deepEqual([t.events().length, t.kinds('tasks_migrated').length], [evs, 1]);
  // The pure migration is idempotent too, and keeps the counts.
  const copy = structuredClone(v1), r1 = migrateInbox(copy), snapshot = JSON.stringify(copy), r2 = migrateInbox(copy);
  assert.deepEqual([r1.from, r1.migrated, r2.from, r2.migrated], [1, 5, 2, 0]);
  assert.deepEqual(r1.before, r1.after);
  assert.equal(JSON.stringify(copy), snapshot);

  // The old agent key still works, and the migrated Tasks are live: the pending meetup can be answered.
  const c = await mcpClient(t, key.key);
  const hb = (await c.tool('heartbeat_check')).structuredContent;
  assert.deepEqual(hb.tasks_for_you.map(x => x.id).sort(), ['task_1', 'task_2']);
  assert.equal(hb.tasks_for_you.find(x => x.id === 'task_2').candidates.length, 1);
  const ans = await c.tool('answer_candidate', {task_id: 'task_2', answer: 'accept'});
  assert.equal(ans.isError, false, JSON.stringify(ans.structuredContent));
  assert.equal(t.task('task_2').stage, 'owner_approval');
  assert.equal(t.task('task_2').approvals[SUNNY].source, 'rule');
});

test('I-07 Task kinds: an unregistered kind (help, before I-13) syncs with a content hash; a kind registers once', () => {
  const help = {id: 'task_h', kind: 'help', from: COPPER, to: '03-ripple', status: 'pending', awaiting: '03-ripple', createdAt: 1, deadline: 2, updatedAt: 1, round: 0, history: [{by: COPPER, action: 'propose', at: 1}]};
  assert.equal(syncTask(help), true);
  assert.deepEqual([help.schema, help.revision, taskRecord(help).payload.kind], [2, 1, 'help']);
  assert.equal(syncTask(help), false, 'idempotent');
  assert.throws(() => registerTaskKind('trade', {}), /already registered/);
});


test('I-07 owner intervention requests count each human side once per candidate revision', async () => {
  const t = await twoOwners();
  const id = await meetupToOwners(t);
  const requests = () => t.kinds('approval_requested').filter(e => e.data.task_id === id);
  assert.deepEqual(requests().map(e => e.muse).sort(), [JOLLY, COPPER].sort());
  assert.equal(new Set(requests().map(e => e.data.requestId)).size, 2);
  assert.ok(requests().every(e => e.data.revision === t.task(id).revision && typeof e.data.requestId === 'string'));
  const task = t.task(id);
  await t.decide('owner', body(task, 'approve', 'c1'));
  await t.decide('owner', body(task, 'approve', 'c1'));
  assert.equal(requests().length, 2, 'a decision retry is not another request');
  const rid = await meetupToOwners(t, SUNNY);
  assert.deepEqual(t.kinds('approval_requested').filter(e => e.data.task_id === rid).map(e => e.muse), [JOLLY], 'residents do not create human intervention');
});

test('I-07 a Muse cannot create a meetup with itself or leave a task or reward behind', async () => {
  const t = await twoOwners();
  const before = {tasks: t.state().inbox.tasks.length, history: t.state().items.history.length, inventory: [...t.muse(COPPER).inventory]};
  const res = await t.copper.tool('propose_meetup', {to: COPPER});
  assert.equal(res.isError, true);
  assert.equal(res.structuredContent.refused, 'invalid_target');
  assert.deepEqual({tasks: t.state().inbox.tasks.length, history: t.state().items.history.length, inventory: [...t.muse(COPPER).inventory]}, before);
});


test('I-07 a revoked owner claim blocks a peer final approval without rewards or state changes', async () => {
  const t = await twoOwners();
  const id = await meetupToOwners(t);
  const task = t.task(id);
  assert.equal((await t.decide('owner', body(task, 'approve', 'c1'))).status, 200);
  const claim = t.dobj.getClaim('owner-muse');
  t.dobj.setClaim('owner-muse', {...claim, status: 'claim_revoked'});
  const before = {task: JSON.stringify(t.task(id)), items: JSON.stringify(t.state().items), version: t.state().version};
  const res = await t.decide('peer', body(task, 'approve', 'c1'));
  assert.deepEqual([res.status, res.body.error], [409, 'pending_claim']);
  assert.deepEqual({task: JSON.stringify(t.task(id)), items: JSON.stringify(t.state().items), version: t.state().version}, before);
  assert.deepEqual([embers(t, JOLLY), embers(t, COPPER), t.kinds('meetup_confirmed').length], [0, 0, 0]);
});


test('I-07 removing an owner control token never converts that owned Muse into a rule approver', async () => {
  const t = await twoOwners();
  delete t.env.OWNER_CONTROL_TOKEN;
  await t.start();
  const id = await meetupToOwners(t);
  assert.equal(t.task(id).owners[JOLLY], 'owner:kim-sejun');
  assert.equal(t.task(id).approvals[JOLLY], undefined, 'a missing token cannot grant rule consent');
  const res = await t.decide('peer', body(t.task(id), 'approve', 'c1'));
  assert.deepEqual([res.status, res.body.confirmed], [200, false]);
  assert.deepEqual([embers(t, JOLLY), embers(t, COPPER)], [0, 0]);
  const missing = await t.go('POST', '/api/owner/session', {token: OWNER_TOKEN}, {origin: ORIGIN});
  assert.notEqual(missing.status, 200, 'the unavailable owner cannot log in with the old token');
});
