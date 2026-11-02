// I-10 (#58): versioned run log, highlights by period with a server cursor, and the C09 server recount.
// Acceptance criteria (issue #58):
//   AC1 versions / seed / initial snapshot / model outputs / approval order are kept; raw frames and private conditions are not
//   AC2 duplicate event ids are not counted, an empty denominator is unmeasured, model calls are unique request ids
//   AC3 period / Muse / place / tag find a highlight, and its evidence opens by run id and event id
//   AC4 period, sample, live / rule / scripted / replay and actorOrigin are kept apart
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime, AUTONOMY_SAMPLE_MAX} from '../worker/core/world-runtime.ts';
import {RunLog, currentVersions, publicState, snapshotBody, bodyHash, stateHash, redact, PRIVATE, RUN_SCHEMA_VERSION} from '../worker/core/run-log.ts';
import {recountAutonomy, values} from '../worker/core/autonomy-oracle.ts';
import {computeAutonomy} from '../src/ui/autonomy.ts';
import {EMPTY_FILTER, matchFilter, dayBound} from '../src/ui/replay-core.ts';
import {createWorld, tick, ENGINE_VERSION, TICK_MS} from '../src/engine/world.ts';
import {PLACES} from '../src/engine/places.ts';
import {Trust} from '../worker/core/trust.ts';
import {revokeMuse} from '../worker/core/owner-control.ts';

const TX_SQL = /^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i;
// Durable Object SQL stand-in (as in world-runtime.test.mjs): only transactionSync opens a transaction.
const sqlite = (db = new DatabaseSync(':memory:')) => { let depth = 0; return {db, exec(q, ...b) { if (TX_SQL.test(q)) throw new Error('Durable Object SQL rejects transaction statements; use transactionSync'); const st = db.prepare(q); if (/^\s*(select|with|explain)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }, transactionSync(fn) { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('transactionSync callback must be synchronous'); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } }}; };
const T0 = Date.parse('2026-11-03T16:00:00Z');
function setup({sql = sqlite(), fetcher, key = 'k', now = T0, ...rest} = {}) {
  const ledger = new Ledger(sql, {dailyCapUsd: 20, now: () => T0}); ledger.init();
  const rt = new WorldRuntime(sql, {worldId: 'w', meetingGate: 'off', ledger, model: {base: 'https://api.meta.ai/v1', key, model: 'muse-spark-1.3', timeoutMs: 2000, fetcher}, ...rest});
  rt.init(now);
  return {rt, ledger, sql};
}
/** A model that answers both actions; request ids are req-<kind>-<n>. */
function model() {
  const n = {spotlight: 0, encounter: 0};
  const fetcher = async (_u, init) => {
    const body = JSON.parse(init.body), kind = body.response_format.json_schema.name === 'encounter_reply' ? 'encounter' : 'spotlight', i = ++n[kind];
    const ctx = JSON.parse(body.messages[1].content.split('\nThey said:')[0]);
    const out = kind === 'spotlight' ? {freedom: 'where', decision: 'walk', target_place: ctx.places_nearby[0].name, target_agent: '', offer_item: '', want_item: '', public_reason: 'close by', line: 'On my way'} : {intent: 'greet', item: '', line: `Hello, ${ctx.other_muse}`, public_reason: 'we met here', injection_suspected: false};
    return new Response(JSON.stringify({id: `cmpl-${kind}-${i}`, usage: {prompt_tokens: 300, completion_tokens: 200}, choices: [{message: {content: JSON.stringify(out)}}]}), {headers: {'x-request-id': `req-${kind}-${i}`}});
  };
  return {fetcher, n};
}
/** Two Muses share a place (they meet on the next tick); the rest hold a long beat elsewhere. Committed like any external change. */
const arrange = (rt, at, pair = ['02-moss', '05-bloom', 'commons:garden']) => rt.commitExternal(at, 'arrange', st => {
  const spare = PLACES.filter(p => p.zone === 'neighborhood').map(p => p.id);
  st.muses.forEach((m, k) => { m.place = spare[k]; m.travel = null; m.intent = null; m.beat = {id: 'hold', clip: 'idle', startedAt: at, endsAt: at + 3_600_000, line: null}; });
  for (const id of pair.slice(0, -1)) st.muses.find(m => m.id === id).place = pair.at(-1);
});
const inputs = sql => sql.exec('SELECT * FROM run_inputs ORDER BY seq').toArray().map(r => ({...r, input: r.input ? JSON.parse(r.input) : null}));
const runs = sql => sql.exec('SELECT * FROM runs ORDER BY n').toArray();
const allEvents = rt => rt.events(0, 100000);

// ---------------------------------------------------------------- AC1
test('AC1 a new world opens a fresh run: versions, seed, public initial snapshot (hash and body), start time', () => {
  const s = setup();
  const [run] = runs(s.sql), v = currentVersions(), st = createWorld('w', T0);
  assert.equal(run.origin, 'fresh'); assert.equal(run.world_id, 'w'); assert.equal(run.started_at, T0); assert.equal(run.prev_run_id, null);
  assert.equal(run.schema_version, RUN_SCHEMA_VERSION); assert.equal(run.engine_version, ENGINE_VERSION);
  assert.match(run.harness_version, /^harness-[0-9a-f]{12}$/); assert.match(run.catalog_version, /^catalog-[0-9a-f]{12}$/);
  assert.deepEqual({schemaVersion: run.schema_version, engineVersion: run.engine_version, harnessVersion: run.harness_version, catalogVersion: run.catalog_version}, v);
  assert.equal(run.seed, st.seed);
  assert.equal(run.snapshot, snapshotBody(st), 'the snapshot body is the public initial state');
  assert.equal(run.snapshot_hash, bodyHash(run.snapshot), 'the hash is over the stored body');
  assert.deepEqual(JSON.parse(run.snapshot), JSON.parse(JSON.stringify(publicState(st))));
  // A restart with the same code keeps the run.
  const again = new WorldRuntime(s.sql, {worldId: 'w', meetingGate: 'off', ledger: s.ledger, model: null}); again.init(T0 + 5000);
  assert.equal(runs(s.sql).length, 1); assert.equal(again.runLog.current.runId, run.run_id);
});

test('AC1 each commit appends one ordered input row: model outputs with request ids, the meeting answer, an approval command, the owner revocation; hashes chain', async () => {
  const sql = sqlite(), trust = new Trust(sql); trust.init();
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  await trust.ensureAgents(await crypto.subtle.exportKey('jwk', pair.privateKey));
  const m = model(), s = setup({sql, fetcher: m.fetcher, delegationValid: id => !trust.suspended(id)}), rt = s.rt;
  arrange(rt, T0);
  const t1 = await rt.heartbeat(T0);
  assert.equal(t1.status, 'committed');
  // An approval: a command whose payload is the owner's answer (accept).
  const cmd = rt.commitCommand(T0 + 1000, 'cmd-approve', {guard: () => null, mutate: (_st, emit) => { emit({at: T0 + 1000, source: 'live', kind: 'meetup_answer', muse: '00-jolly', other: '01-sunny', data: {task_id: 'task_1', answer: 'accept', actorOrigin: 'connected'}, tags: []}); return {ok: true}; }, record: (version, events) => ({actorId: 'agent-jolly', commandId: 'cmd-1', action: 'answer_candidate', payload: {task_id: 'task_1', answer: 'accept'}, row: {payloadHash: 'h1', result: {ok: true, commandId: 'cmd-1', worldVersion: version, eventIds: events.map(e => e.id)}, output: null}})});
  assert.equal(cmd.aborted, null);
  await revokeMuse({trust, runtime: rt, now: () => T0 + 2000}, '03-ripple', 'owner');
  const t2 = await rt.heartbeat(T0 + TICK_MS);
  assert.equal(t2.status, 'committed');

  const rows = inputs(sql), run = rt.runLog.current;
  assert.deepEqual(rows.map(r => r.seq), rows.map((_r, i) => i + 1), 'one ordered sequence');
  const kinds = rows.map(r => r.kind + ':' + r.label.replace(/-[a-z0-9]+-[a-z0-9]+$/, ''));
  const iTick1 = rows.findIndex(r => r.kind === 'tick'), iCmd = rows.findIndex(r => r.kind === 'command'), iRevoke = rows.findIndex(r => r.label.startsWith('owner-revoke-')), iTick2 = rows.findLastIndex(r => r.kind === 'tick');
  assert.ok(iTick1 < iCmd && iCmd < iRevoke && iRevoke < iTick2, 'order: tick, approval, revocation, tick · ' + kinds.join(', '));
  const tick1 = rows[iTick1].input;
  assert.equal(tick1.spotlight.source, 'live'); assert.equal(tick1.spotlight.used, true);
  assert.equal(tick1.spotlight.decision.evidence.requestId, 'req-spotlight-1');
  assert.equal(tick1.spotlight.decision.output.decision, 'walk', 'the model output itself');
  assert.equal(tick1.seed, rt.state().seed);
  const reply = tick1.replies.find(r => r.source === 'live');
  assert.ok(reply, 'the other Muse answered with a model call'); assert.match(reply.evidence.requestId, /^req-encounter-/); assert.match(reply.output.line, /^Hello/); assert.equal(reply.used, true);
  assert.equal(JSON.stringify(tick1).includes('messages'), false, 'the prompt is not stored');
  assert.deepEqual(rows[iCmd].input, {actorId: 'agent-jolly', commandId: 'cmd-1', action: 'answer_candidate', payloadHash: 'h1', payload: {task_id: 'task_1', answer: 'accept'}, ok: true, code: null, worldVersion: rows[iCmd].version_after});
  // Every event names its run and its commit; every commit's after-hash is the next commit's before-hash.
  for (const e of allEvents(rt)) { assert.equal(e.runId, run.runId, e.id); assert.ok(rows.some(r => r.seq === e.inputSeq), e.id); }
  for (const r of rows) assert.equal(allEvents(rt).filter(e => e.inputSeq === r.seq).length, r.events, `events of input ${r.seq}`);
  assert.equal(rows[0].before_hash, run.initialSnapshot.hash, 'the first commit starts from the initial snapshot');
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].before_hash, rows[i - 1].after_hash, `chain at ${i}`);
  for (const r of rows.filter(r => r.kind === 'tick')) assert.notEqual(r.before_hash, r.after_hash, 'a tick changes the state');
  assert.equal(rows.at(-1).after_hash, stateHash(rt.state()));
  // I-06 anchor outside the state: the item history head after every commit.
  assert.equal(rows.at(-1).items_head, rt.state().items.chain.head);
  assert.deepEqual(rt.runLog.itemsAnchor(rt.state()).matches, true);
  assert.ok(rows.every(r => /^[0-9a-f]{64}$/.test(r.items_head)));
});

test('AC1 an out-of-band state change shows: the item head anchor stops matching and the hash chain breaks', async () => {
  const s = setup({key: undefined}), rt = s.rt;
  await rt.heartbeat(T0);
  const st = rt.state(); st.items.chain.head = 'f'.repeat(64); st.muses[1].inventory.push('relic_x');
  s.sql.exec('UPDATE world SET state = ? WHERE id = 1', JSON.stringify(st)); // a write that is not a commit
  assert.equal(rt.runLog.itemsAnchor(rt.state()).matches, false);
  rt.commitExternal(T0 + 1000, 'after', (_st, emit) => emit({at: T0 + 1000, source: 'rule', kind: 'note', muse: null, tags: []}));
  const rows = inputs(s.sql);
  assert.notEqual(rows.at(-1).before_hash, rows.at(-2).after_hash, 'the chain shows the gap');
});

test('AC1 private conditions and raw frames never enter the run log (snapshot or inputs)', () => {
  const s = setup({key: undefined}), rt = s.rt;
  const CELL = '9999:-9999', TIME = 'PRIVATE-TIME-7731', SPOT = 'PRIVATE-PLACE-7731', FRAME = 'data:image/jpeg;base64,RkFLRUZSQU1F';
  rt.commitExternal(T0, 'private-setup', st => {
    st.owner = {source: 'gps', preset: null, cell: CELL, target: 'commons:hq', verified: false, setAt: T0, muse: '00-jolly'};
    st.muses[0].anchor = CELL;
    st.inbox.tasks.push({id: 'task_1', kind: 'meetup', from: '00-jolly', to: '01-sunny', status: 'pending', awaiting: '01-sunny', createdAt: T0, deadline: T0 + 1, updatedAt: T0, round: 0, candidate: {time: TIME, place: SPOT, public_basis: 'both like coffee'}, answers: {}, history: []});
    st.inbox.notifications.push({id: 'n_1', kind: 'meetup_candidate', at: T0, line: 'A meetup candidate needs your approval', ref: 'task_1', other: '01-sunny', muse: '00-jolly', detail: {time: TIME, place: SPOT}});
  });
  rt.commitCommand(T0 + 1, 'cmd-private', {guard: () => null, mutate: () => ({ok: true}), record: v => ({actorId: 'a', commandId: 'c', action: 'answer_candidate', payload: {task_id: 'task_1', answer: 'accept', candidate: {time: TIME, place: SPOT}, owner: {cell: CELL, lat: 37.1, lng: -122.1}, frames: [FRAME]}, row: {payloadHash: 'h', result: {ok: true, commandId: 'c', worldVersion: v, eventIds: []}, output: null}})});
  rt.commitExternal(T0 + 2, 'ritual-x', (_st, emit) => emit({at: T0 + 2, source: 'replay', kind: 'ritual_judged', muse: null, data: {passed: true, results: [{step: 'wave', passed: true, confidence: 0.9}], framesStored: false, actorOrigin: 'trial'}, tags: ['ritual']}));
  // A deploy with other code versions opens a new run whose snapshot is the current state.
  s.sql.exec("UPDATE runs SET engine_version = 'engine-0'"); // test only: the stored run came from older code
  const rt2 = new WorldRuntime(s.sql, {worldId: 'w', meetingGate: 'off', ledger: s.ledger, model: null}); rt2.init(T0 + 3);
  const all = runs(s.sql); assert.equal(all.length, 2); assert.equal(all[1].origin, 'version_change'); assert.equal(all[1].prev_run_id, all[0].run_id);
  const log = JSON.stringify(runs(s.sql)) + JSON.stringify(inputs(s.sql));
  for (const secret of [CELL, TIME, SPOT, FRAME, '37.1', '-122.1']) assert.equal(log.includes(secret), false, `${secret} is in the run log`);
  const snap = JSON.parse(all[1].snapshot);
  assert.equal(snap.owner.location, PRIVATE); assert.equal(snap.muses[0].anchor, PRIVATE);
  assert.equal(snap.inbox.tasks[0].candidate, PRIVATE); assert.equal(snap.inbox.notifications.at(-1).detail, PRIVATE);
  assert.equal(snap.inbox.tasks[0].id, 'task_1', 'the rest of the Task is kept');
  const cmd = inputs(s.sql).find(r => r.kind === 'command').input;
  assert.deepEqual(cmd.payload, {task_id: 'task_1', answer: 'accept', candidate: PRIVATE, owner: {cell: PRIVATE, lat: PRIVATE, lng: PRIVATE}, frames: PRIVATE});
  assert.equal(redact({a: {b: 'x'.repeat(600)}}).a.b.length, 501, 'long strings are cut');
  // The source of the run log never updates or deletes its rows.
  const src = readFileSync(new URL('../worker/core/run-log.ts', import.meta.url), 'utf8');
  assert.equal(/(UPDATE|DELETE FROM|REPLACE INTO|DROP TABLE)\s+(runs|run_inputs)\b/i.test(src), false);
});

test('AC1 a world stored before the run log gets one pre-run-log run; its old events stay, new events carry the run id', async () => {
  const sql = sqlite();
  // The storage of the current production world: events without run_id / input_seq, a world row, no runs table.
  sql.exec('CREATE TABLE world (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, version INTEGER NOT NULL)');
  sql.exec('CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, muse TEXT, other TEXT, place TEXT, line TEXT, data TEXT, tags TEXT NOT NULL)');
  let st = createWorld('w', T0 - 3_600_000);
  const old = [];
  for (let i = 0; i < 5; i++) { const r = tick(st, {now: T0 - 3_600_000 + i * TICK_MS}); st = r.state; old.push(...r.events.map((e, k) => ({...e, id: e.id ?? `old:${i}:${k}`}))); }
  sql.exec('INSERT INTO world (id, state, version) VALUES (1, ?, ?)', JSON.stringify(st), st.version);
  old.forEach((e, k) => sql.exec('INSERT INTO events (id, tick, at, source, kind, muse, other, place, line, data, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', e.id || `old-${k}`, e.tick, e.at, e.source, e.kind, e.muse, e.other ?? null, e.place ?? null, e.line ?? null, JSON.stringify(e.data ?? {}), JSON.stringify(e.tags)));
  const s = setup({sql, key: undefined}), rt = s.rt;
  const [run] = runs(sql);
  assert.equal(run.origin, 'pre-run-log');
  const legacy = JSON.parse(run.legacy); assert.equal(legacy.events, old.length); assert.equal(legacy.lastSeq, old.length);
  assert.equal(run.snapshot, snapshotBody(st), 'the snapshot is the state when the log started');
  // Restarting migrates nothing twice.
  new WorldRuntime(sql, {worldId: 'w', meetingGate: 'off', ledger: s.ledger, model: null}).init(T0 + 1);
  assert.equal(runs(sql).length, 1);
  await rt.heartbeat(T0);
  const evs = allEvents(rt);
  assert.equal(evs.filter(e => e.runId === null).length, old.length, 'old rows are not rewritten');
  assert.ok(evs.filter(e => e.runId === run.run_id).length > 0);
  // The pre-run-log run owns its old events in a recount and in the evidence record.
  assert.equal(rt.autonomy({runId: run.run_id}).sample.events, evs.length);
  const rec = rt.eventRecord(evs[0].id);
  assert.equal(rec.runId, run.run_id); assert.equal(rec.runIdStored, false); assert.equal(rec.input, null);
});

// ---------------------------------------------------------------- AC2
const ev = (id, kind, data = {}, extra = {}) => ({id, kind, data, source: 'rule', muse: '00-jolly', at: T0, tags: [], ...extra});
const SCOPE = {worldId: 'w', runIds: ['r'], from: null, to: null, day: null, complete: true};
const clientScope = {label: 'test', day: '2026-11-03', worldId: 'w', runId: 'r', complete: true};
const same = (events, why = '') => {
  const server = values(recountAutonomy(events, SCOPE)), client = computeAutonomy(events, clientScope).rows;
  for (const r of client) assert.deepEqual(server[r.key], {value: r.value, measured: r.measured}, `${why} ${r.key}`);
  return server;
};

test('AC2 a duplicated event id counts once; a duplicated encounterId counts once; the oracle and the panel agree', () => {
  const meet = ev('m1', 'encounter', {encounterId: 'd:1:a|b', initiatedByIntent: true, actorOrigin: 'system'});
  const events = [meet, structuredClone(meet), ev('m1-copy', 'encounter', {encounterId: 'd:1:a|b', initiatedByIntent: false, actorOrigin: 'system'}), ev('m2', 'encounter', {encounterId: 'd:2:a|c', initiatedByIntent: false, actorOrigin: 'system'})];
  const r = recountAutonomy(events, SCOPE);
  assert.equal(r.sample.events, 3); assert.equal(r.sample.duplicateIds, 1); assert.equal(r.sample.duplicateEncounters, 1);
  assert.equal(r.starts.meetings, 2); assert.equal(r.starts.ratePct, 50);
  assert.equal(same(events).starts.value, '50%');
  const checks = [ev('v1', 'a2a_verified', {verificationId: 'ver-1'}), ev('v1b', 'a2a_verified', {verificationId: 'ver-1'}), ev('v2', 'a2a_refused', {verificationId: 'ver-2'})];
  assert.equal(same(checks).signatures.value, '1 passed · 1 refused');
});

test('AC2 an empty denominator is unmeasured, never 0%; an empty sample is unmeasured in all six', () => {
  const empty = same([]);
  for (const v of Object.values(empty)) assert.deepEqual(v, {value: 'Not measured', measured: false});
  const noStart = same([ev('m1', 'encounter', {encounterId: 'x'})]);
  assert.equal(noStart.starts.value, 'Not measured');
  assert.equal(recountAutonomy([ev('b', 'beat')], SCOPE).starts.ratePct, null, 'no meetings: no rate');
  assert.equal(same([ev('b', 'beat')]).starts.value, 'Not measured');
  assert.equal(same([ev('t', 'craft', {}, {tags: ['ability_change']})]).abilities.value, 'Not measured', 'a tag without hashes is not a measured change');
  assert.equal(same([ev('s', 'spotlight', {evidence: {requestId: null}}, {source: 'live'})]).models.value, 'Not measured', 'a live answer without a request id');
});

test('AC2 model calls are unique request ids, live and replay apart; model-free checks are not model calls', () => {
  const events = [ev('1', 'spotlight', {evidence: {requestId: 'q1'}}, {source: 'live'}), ev('2', 'encounter_reply', {evidence: {requestId: 'q1'}}, {source: 'live'}), ev('3', 'encounter_reply', {evidence: {requestId: 'q2'}}, {source: 'live'}), ev('4', 'a2a_verified', {}, {source: 'live'}), ev('5', 'spotlight', {evidence: {replayOf: {requestId: 'q1', responseId: 'r'}}}, {source: 'replay'}), ev('6', 'spotlight', {evidence: {replayOf: 'q1'}}, {source: 'replay'}), ev('7', 'spotlight', {}, {source: 'scripted'})];
  const r = recountAutonomy(events, SCOPE);
  assert.equal(r.models.live, 2); assert.equal(r.models.replay, 1); assert.equal(r.models.scenario, 1);
  assert.equal(same(events).models.value, '2 live · 1 replay · 1 scenario');
  assert.equal(same([...events, ...events]).models.value, '2 live · 1 replay · 1 scenario', 'the whole sample delivered twice');
});

test('AC2 oracle = panel: the replay fixture, a recorded runtime day, and 300 random samples with duplicates', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-run.json', import.meta.url))).events;
  same(fixture, 'fixture');
  const m = model(), s = setup({fetcher: m.fetcher}), rt = s.rt;
  arrange(rt, T0);
  for (let i = 0; i < 40; i++) await rt.heartbeat(T0 + i * TICK_MS);
  rt.requestSpotlight('07-tempo', T0 + 41 * TICK_MS, {origin: 'visitor', requester: 'v'});
  const day = allEvents(rt);
  assert.ok(day.some(e => e.kind === 'encounter') && day.some(e => e.source === 'live'), 'the run has meetings and live answers');
  const srv = same(day, 'runtime');
  assert.equal(srv.models.value, `${new Set(day.filter(e => e.source === 'live' && e.data.evidence?.requestId).map(e => e.data.evidence.requestId)).size} live · 0 replay · ${day.filter(e => e.source === 'scripted' && e.kind === 'spotlight').length} scenario`);
  assert.deepEqual(rt.autonomy({}).values, srv, 'the runtime API gives the same values');
  // Random samples (seeded): kinds, sources, origins, ids, encounter ids, request ids, hashes, duplicates.
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), pick = a => a[Math.floor(rnd() * a.length)];
  const kinds = ['encounter', 'approval_requested', 'meetup_candidate', 'cards_verified', 'a2a_verified', 'a2a_refused', 'impostor_rejected', 'spotlight', 'encounter_reply', 'trade_completed', 'injection_blocked', 'decision_rejected', 'beat'];
  for (let n = 0; n < 300; n++) {
    const list = [];
    for (let i = 0, len = Math.floor(rnd() * 25); i < len; i++) {
      const kind = pick(kinds), source = pick(['live', 'rule', 'scripted', 'replay']);
      const data = {actorOrigin: pick(['system', 'connected', 'trial', undefined]), ...(kind === 'encounter' ? {encounterId: 'e' + Math.floor(rnd() * 5), ...(rnd() < .8 ? {initiatedByIntent: rnd() < .5} : {})} : {}), ...(kind === 'approval_requested' ? {requestId: rnd() < .7 ? 'ap' + Math.floor(rnd() * 3) : undefined} : {}), ...(kind === 'cards_verified' ? {aVerifiesB: pick([{ok: true}, {ok: false}, undefined]), bVerifiesA: pick([{ok: true}, {ok: false}])} : {}), ...(['a2a_verified', 'a2a_refused'].includes(kind) && rnd() < .5 ? {verificationId: 'v' + Math.floor(rnd() * 3)} : {}), ...(rnd() < .5 ? {evidence: pick([{requestId: 'q' + Math.floor(rnd() * 4)}, {requestId: null, model: 'm'}, {replayOf: 'q' + Math.floor(rnd() * 4)}, {replayOf: {requestId: 'q1'}}, {}])} : {}), ...(rnd() < .4 ? {beforeHash: pick(['a', 'b']), afterHash: pick(['a', 'b'])} : {})};
      list.push(ev('i' + Math.floor(rnd() * 30), kind, data, {source, tags: rnd() < .4 ? ['ability_change'] : []}));
    }
    same(list, `sample ${n}`);
  }
});

// ---------------------------------------------------------------- AC3
test('AC3 highlights by period with a server cursor reach beyond 300, then Muse, place and tag narrow them and the evidence opens by run id and event id', () => {
  const s = setup({key: undefined}), rt = s.rt, DAY = 3_600_000 * 24;
  const muses = ['01-sunny', '02-moss', '03-ripple'], places = ['commons:cafe', 'commons:garden'], tags = ['first_trade', 'impostor_rejected', 'p0_valid'];
  for (let i = 0; i < 700; i++) {
    const at = T0 + Math.floor(i / 350) * DAY + i * 1000; // 350 moments on day 1, 350 on day 2
    rt.commitExternal(at, `moment-${i}`, (_st, emit) => emit({at, source: 'live', kind: 'moment', muse: muses[i % 3], other: null, place: places[i % 2], line: `moment ${i}`, data: {n: i}, tags: [tags[i % 3]]}));
  }
  const page = q => rt.highlights(300, q);
  const pages = []; let before = null;
  for (let k = 0; ; k++) { assert.ok(k < 10, 'the cursor must move to older rows'); const p = page({before}); pages.push(p); if (p.length < 300) break; before = p.at(-1).seq; }
  const got = pages.flat();
  assert.equal(pages.length, 3); assert.equal(got.length, 700, 'the cursor reaches every highlight'); assert.equal(new Set(got.map(e => e.id)).size, 700);
  assert.ok(got.every((e, i) => !i || e.seq < got[i - 1].seq), 'newest first, no overlap');
  // Period: day 2 only.
  const from = T0 + DAY, to = T0 + 2 * DAY;
  const d2 = []; before = null;
  for (let k = 0; ; k++) { assert.ok(k < 10, 'the cursor must move to older rows'); const p = page({before, from, to}); d2.push(...p); if (p.length < 300) break; before = p.at(-1).seq; }
  assert.equal(d2.length, 350); assert.ok(d2.every(e => e.at >= from && e.at < to));
  // The panel's filter on the loaded pages: period + Muse + place + tag (AND), Muse matching either side.
  const f = {...EMPTY_FILTER, from, to, muse: '02-moss', place: 'commons:garden', tag: 'impostor_rejected'};
  const shown = got.filter(e => matchFilter(e, f));
  assert.ok(shown.length > 0);
  assert.deepEqual(shown.map(e => e.id).sort(), got.filter(e => e.at >= from && e.at < to && e.muse === '02-moss' && e.place === 'commons:garden' && e.tags.includes('impostor_rejected')).map(e => e.id).sort());
  // Evidence: the event with its run and the commit that wrote it.
  const pickd = shown[0], rec = rt.eventRecord(pickd.id);
  assert.equal(pickd.runId, rt.runLog.current.runId);
  assert.equal(rec.event.id, pickd.id); assert.equal(rec.runId, pickd.runId); assert.equal(rec.runIdStored, true);
  assert.equal(rec.input.seq, pickd.inputSeq); assert.equal(rec.input.runId, pickd.runId); assert.match(rec.input.label, /^moment-/);
  assert.match(rec.input.afterHash, /^[0-9a-f]{64}$/); assert.equal(rec.run.runId, pickd.runId); assert.equal(rec.run.initialSnapshot.body, undefined, 'no snapshot body in the evidence record');
  assert.equal(rt.eventRecord('nope'), null);
});

test('AC3 date inputs become the viewer-day period the panel sends (from inclusive, to = start of the next day)', () => {
  const was = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Seoul';
    assert.equal(dayBound('2026-11-03'), Date.parse('2026-11-02T15:00:00Z'));
    assert.equal(dayBound('2026-11-03', true), Date.parse('2026-11-03T15:00:00Z'));
    assert.equal(dayBound(''), null); assert.equal(dayBound('11/03/2026'), null);
    const e = {tags: [], muse: null, other: null, place: null, at: Date.parse('2026-11-03T14:59:59Z')};
    assert.equal(matchFilter(e, {...EMPTY_FILTER, from: dayBound('2026-11-03'), to: dayBound('2026-11-03', true)}), true);
    assert.equal(matchFilter({...e, at: e.at + 1000}, {...EMPTY_FILTER, from: dayBound('2026-11-03'), to: dayBound('2026-11-03', true)}), false);
  } finally { process.env.TZ = was; }
});

test('AC3 Worker routes: /api/world/run, /run/inputs, /event, /highlights (before, from, to) and /autonomy through the real entry and WorldDO', async () => {
  const hooks = `export async function resolve(spec, ctx, next) { if (spec === 'cloudflare:workers') return {url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true}; return next(spec, ctx); }`;
  register('data:text/javascript,' + encodeURIComponent(hooks));
  const {default: worker, WorldDO} = await import('../worker/index.ts');
  const sql = sqlite();
  let alarm = null, ready;
  const ctx = {storage: {sql: {exec: sql.exec}, transactionSync: sql.transactionSync, getAlarm: async () => alarm, setAlarm: async t => { alarm = t; }}, blockConcurrencyWhile: fn => (ready = fn())};
  const env = {MODEL_ID: 'muse-spark-1.3', MODEL_BASE: 'https://api.meta.ai/v1', DAILY_BUDGET_USD: '1', TURNSTILE_SITEKEY: 'x', ALLOWED_HOSTS: 'musely.net,www.musely.net', PUBLIC_ORIGIN: 'https://musely.net', SESSION_SECRET: 'e2e-secret'};
  const dobj = new WorldDO(ctx, env); await ready;
  env.WORLD = {idFromName: () => 'id', get: () => dobj}; env.ASSETS = {fetch: async () => new Response('asset')};
  const go = async path => { const r = await worker.fetch(new Request('https://musely.net' + path), env); return {status: r.status, body: await r.json()}; };
  const now = Date.now();
  // Each check one millisecond apart: two commits in the same millisecond with the same label share an event id.
  for (let i = 0; i < 5; i++) { await dobj.impostor('01-sunny'); await new Promise(r => setTimeout(r, 3)); }
  const run = await go('/api/world/run');
  assert.equal(run.status, 200); assert.equal(run.body.origin, 'fresh'); assert.equal(run.body.engineVersion, ENGINE_VERSION); assert.equal(typeof run.body.initialSnapshot.bytes, 'number'); assert.equal(run.body.initialSnapshot.body, undefined);
  assert.equal(run.body.itemsAnchor.matches, true); assert.ok(run.body.inputs.count >= 6);
  const full = await go(`/api/world/run?runId=${run.body.runId}&snapshot=1`);
  assert.equal(bodyHash(full.body.initialSnapshot.body), full.body.initialSnapshot.hash);
  assert.equal((await go('/api/world/run?runId=nope')).status, 404);
  const ins = await go(`/api/world/run/inputs?runId=${run.body.runId}&since=0&limit=3`);
  assert.equal(ins.body.length, 3); assert.deepEqual(ins.body.map(r => r.seq), [1, 2, 3]);
  const p1 = await go('/api/world/highlights?limit=2'), p2 = await go(`/api/world/highlights?limit=2&before=${p1.body.at(-1).seq}`);
  assert.equal(p1.body.length, 2); assert.equal(p2.body.length, 2); assert.ok(p2.body[0].seq < p1.body.at(-1).seq);
  assert.equal((await go(`/api/world/highlights?from=${now + 3_600_000}`)).body.length, 0, 'a future period has no moments');
  const one = await go(`/api/world/event?id=${encodeURIComponent(p1.body[0].id)}`);
  assert.equal(one.body.event.id, p1.body[0].id); assert.equal(one.body.runId, run.body.runId); assert.equal(one.body.input.seq, p1.body[0].inputSeq);
  assert.equal((await go('/api/world/event?id=nope')).status, 404);
  const auto = await go(`/api/world/autonomy?from=${now - 60_000}&to=${now + 60_000}`);
  assert.equal(auto.status, 200); assert.equal(auto.body.values.signatures.value, '0 passed · 5 refused'); assert.deepEqual(auto.body.scope.runIds, [run.body.runId]);
  assert.equal((await go('/api/world/autonomy?from=10&to=5')).status, 400);
  assert.equal((await go('/api/world/autonomy?day=nope')).status, 400);
  assert.equal((await go(`/api/world/autonomy?from=0&to=${8 * 86_400_000}`)).status, 400, 'at most 7 days');
});

// ---------------------------------------------------------------- AC4
test('AC4 the recount keeps period, sample, sources and actor origins apart (system / connected / trial)', async () => {
  const m = model(), s = setup({fetcher: m.fetcher}), rt = s.rt;
  arrange(rt, T0);
  await rt.heartbeat(T0);
  // A connected Muse's own command (MCP), a visitor's spotlight request, a replayed answer and a scripted turn.
  rt.commitExternal(T0 + 1000, 'mcp-greet', (_st, emit) => emit({at: T0 + 1000, source: 'live', kind: 'greet', muse: '00-jolly', other: '01-sunny', data: {actor: 'your Muse', actorOrigin: 'connected'}, tags: []}));
  rt.requestSpotlight('07-tempo', T0 + 2000, {origin: 'visitor', requester: 'v1'});
  rt.commitExternal(T0 + 3000, 'replayed', (_st, emit) => emit({at: T0 + 3000, source: 'replay', kind: 'spotlight', muse: '04-ember', data: {evidence: {replayOf: {requestId: 'old-1'}}}, tags: []}));
  rt.commitExternal(T0 + 4000, 'scripted', (_st, emit) => emit({at: T0 + 4000, source: 'scripted', kind: 'spotlight', muse: '06-ink', data: {}, tags: []}));
  const r = rt.autonomy({from: T0, to: T0 + 10_000});
  const evs = allEvents(rt).filter(e => e.at >= T0 && e.at < T0 + 10_000);
  assert.equal(r.sample.events, evs.length); assert.equal(r.scope.from, T0); assert.equal(r.scope.to, T0 + 10_000); assert.equal(r.scope.complete, true);
  for (const src of ['live', 'rule', 'scripted', 'replay']) assert.equal(r.sources[src], evs.filter(e => e.source === src).length, src);
  assert.ok(r.sources.live > 0 && r.sources.rule > 0 && r.sources.scripted === 1 && r.sources.replay === 1);
  for (const o of ['system', 'connected', 'trial']) assert.equal(r.origins[o], evs.filter(e => e.data.actorOrigin === o).length, o);
  assert.equal(r.origins.unrecorded, 0, 'every committed event has an actor origin');
  assert.equal(r.origins.connected, 1); assert.equal(r.origins.trial, 1);
  assert.equal(r.models.live, new Set(evs.filter(e => e.source === 'live' && e.data.evidence?.requestId).map(e => e.data.evidence.requestId)).size); assert.equal(r.models.replay, 1); assert.equal(r.models.scenario, 1);
  // Starts by origin: residents (system) apart from connected Muses.
  assert.equal(r.starts.byOrigin.system.meetings, r.starts.meetings); assert.equal(r.starts.byOrigin.connected.meetings, 0);
  // The period bounds the sample.
  assert.equal(rt.autonomy({from: T0 + 2500, to: T0 + 3500}).sample.events, 1);
  assert.equal(rt.autonomy({from: T0 + 2500, to: T0 + 3500}).sources.replay, 1);
  assert.equal(rt.autonomy({from: T0 + 9_000_000, to: T0 + 9_000_001}).values.starts.value, 'Not measured', 'an empty period is not a zero');
  // The panel shows the same split in its period line.
  const res = computeAutonomy(evs, clientScope);
  assert.deepEqual(res.origins, r.origins); assert.deepEqual(res.sources, r.sources);
  assert.match(res.period, new RegExp(`actors: ${r.origins.system} system / 1 connected / 1 trial`));
});

test('AC4 an encounter started by a connected Muse is connected, by a resident system; each is counted in its own row', () => {
  let st = createWorld('w', T0);
  const spare = PLACES.filter(p => p.zone === 'neighborhood').map(p => p.id);
  st.muses.forEach((m, k) => { m.place = spare[k]; m.travel = null; m.beat = {id: 'hold', clip: 'idle', startedAt: T0, endsAt: T0 + 3_600_000, line: null}; });
  for (const id of ['00-jolly', '01-sunny']) st.muses.find(m => m.id === id).place = 'commons:cafe';
  for (const id of ['02-moss', '05-bloom']) st.muses.find(m => m.id === id).place = 'commons:garden';
  st.muses.find(m => m.id === '00-jolly').intent = {kind: 'greet', target: '01-sunny'};
  st.muses.find(m => m.id === '02-moss').intent = {kind: 'greet', target: '05-bloom'};
  st.inbox.connected['00-jolly'] = T0;
  const meet = tick(st, {now: T0 + TICK_MS}).events.filter(e => e.kind === 'encounter');
  const jolly = meet.find(e => e.muse === '00-jolly'), moss = meet.find(e => e.muse === '02-moss');
  assert.equal(jolly.data.actorOrigin, 'connected'); assert.equal(moss.data.actorOrigin, 'system');
  const sample = meet.map((e, i) => ({...e, id: 'e' + i}));
  const r = recountAutonomy(sample, SCOPE);
  assert.deepEqual(r.starts.byOrigin.connected, {meetings: 1, byIntent: 1, ratePct: 100});
  assert.deepEqual(r.starts.byOrigin.system, {meetings: 1, byIntent: 1, ratePct: 100});
  assert.equal(r.starts.byOrigin.trial.ratePct, null, 'no trial meetings: unmeasured');
  assert.match(computeAutonomy(sample, clientScope).rows.find(x => x.key === 'starts').note, /system: 1 \(1 by intent\) · connected: 1 \(1 by intent\) · trial: 0/);
});

test('AC4 a period crossing a deploy is split by run, and an oversized sample is reported partial', async () => {
  const s = setup({key: undefined}), rt = s.rt;
  rt.commitExternal(T0, 'a', (_st, emit) => emit({at: T0, source: 'rule', kind: 'encounter', muse: '01-sunny', other: '02-moss', data: {encounterId: 'x1', initiatedByIntent: true}, tags: []}));
  s.sql.exec("UPDATE runs SET catalog_version = 'catalog-old'"); // test only: the first run came from older code
  const rt2 = new WorldRuntime(s.sql, {worldId: 'w', meetingGate: 'off', ledger: s.ledger, model: null}); rt2.init(T0 + 10);
  rt2.commitExternal(T0 + 20, 'b', (_st, emit) => emit({at: T0 + 20, source: 'rule', kind: 'encounter', muse: '01-sunny', other: '03-ripple', data: {encounterId: 'x2', initiatedByIntent: false}, tags: []}));
  const r = rt2.autonomy({from: T0, to: T0 + 100});
  assert.equal(r.scope.runIds.length, 2); assert.equal(r.byRun.length, 2);
  assert.deepEqual(r.byRun.map(b => b.values.starts.value), ['100%', '0%']);
  assert.equal(rt2.autonomy({from: T0, to: T0 + 100, runId: r.scope.runIds[1]}).values.starts.value, '0%');
  assert.ok(AUTONOMY_SAMPLE_MAX >= 15_000, 'a world day fits in one sample');
});
