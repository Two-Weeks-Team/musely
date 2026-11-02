import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {spotlightFor, spotlightInput, TICK_MS} from '../src/engine/world.ts';
import {PLACES} from '../src/engine/places.ts';
import {Trust} from '../worker/core/trust.ts';
import {revokeMuse} from '../worker/core/owner-control.ts';
import {makeHooks} from '../src/engine/rules.ts';

// Like Durable Object SQL: transaction statements are refused (only transactionSync opens a transaction).
const TX_SQL = /^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i;
// transactionSync stands in for ctx.storage.transactionSync: a savepoint that rolls back on a throw.
const sqlite = () => { const db = new DatabaseSync(':memory:'); let depth = 0; return {exec(q, ...b) { if (TX_SQL.test(q)) throw new Error('Durable Object SQL rejects transaction statements; use transactionSync'); const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }, transactionSync(fn) { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('transactionSync callback must be synchronous'); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } }}; };
const T0 = Date.parse('2026-11-03T16:00:00Z');
function setup({cap = 20, fetcher, key = 'k', timeoutMs = 150, sql = sqlite(), ...rest} = {}) {
  const ledger = new Ledger(sql, {dailyCapUsd: cap, now: () => T0}); ledger.init();
  const rt = new WorldRuntime(sql, {worldId: 'w', meetingGate: 'off', ledger, model: {base: 'https://api.meta.ai/v1', key, model: 'muse-spark-1.3', timeoutMs, fetcher}, ...rest});
  rt.init(T0);
  return {rt, ledger, sql};
}
// A model that answers "go to the first nearby place" for whoever holds the spotlight.
const goodModel = (rt, delayMs = 0) => async (_u, init) => {
  const body = JSON.parse(init.body), ctx = JSON.parse(body.messages[1].content);
  await new Promise((res, rej) => { const t = setTimeout(res, delayMs); init.signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('abort'), {name: 'AbortError'})); }); });
  const out = {freedom: 'where', decision: 'walk', target_place: ctx.places_nearby[0].name, target_agent: '', offer_item: '', want_item: '', public_reason: 'close by', line: 'On my way'};
  return new Response(JSON.stringify({id: 'cmpl', usage: {prompt_tokens: 300, completion_tokens: 200}, choices: [{message: {content: JSON.stringify(out)}}]}), {headers: {'x-request-id': 'req-live'}});
};

test('a heartbeat commits one tick with a live spotlight decision and evidence', async () => {
  let rt; const s = setup({fetcher: (...a) => goodModel(rt)(...a)}); rt = s.rt;
  const r = await rt.heartbeat(T0);
  assert.equal(r.status, 'committed');
  assert.equal(r.spotlight.source, 'live');
  const ev = rt.events().find(e => e.kind === 'spotlight');
  assert.equal(ev.source, 'live');
  assert.equal(ev.data.evidence.requestId, 'req-live');
  assert.equal(s.ledger.status().liveCalls, 1);
  assert.equal(rt.state().tick, 1);
});

test('an alarm retried while the first run is still waiting does not commit twice or reserve twice', async () => {
  let rt; const s = setup({fetcher: (...a) => goodModel(rt, 40)(...a)}); rt = s.rt;
  const [a, b] = await Promise.all([rt.heartbeat(T0), rt.heartbeat(T0)]);
  assert.deepEqual([a.status, b.status].sort(), ['committed', 'skipped_duplicate']);
  assert.equal(rt.state().tick, 1);
  assert.equal(s.ledger.status().liveCalls, 1, 'same reservation id: one charge');
  assert.equal(new Set(rt.events().map(e => e.id)).size, rt.events().length);
  assert.equal((await rt.heartbeat(T0 + 1000)).status, 'skipped_early', 'a retry right after a commit does not advance time');
});

test('an answer that arrives after the world moved is discarded, not executed', async () => {
  let rt; const s = setup({fetcher: (...a) => goodModel(rt)(...a), beforeCommit: () => { const st = rt.state(); st.version += 1; s.sql.exec('UPDATE world SET state = ?, version = ? WHERE id = 1', JSON.stringify(st), st.version); }}); rt = s.rt;
  await rt.heartbeat(T0);
  const ev = rt.events();
  assert.ok(ev.some(e => e.kind === 'decision_discarded' && e.data.reason.includes('world changed')));
  assert.ok(!ev.some(e => e.kind === 'spotlight' && e.source === 'live'), 'the late decision did not run');
});

test('an answer for a Muse whose delegation was revoked meanwhile is discarded', async () => {
  let rt; const s = setup({fetcher: (...a) => goodModel(rt)(...a), delegationValid: () => false}); rt = s.rt;
  await rt.heartbeat(T0);
  assert.ok(rt.events().some(e => e.kind === 'decision_discarded' && e.data.reason === 'delegation revoked before commit'));
});

test('a timeout falls back (replay only when valid, else scenario) and is charged in full', async () => {
  let rt; const s = setup({fetcher: (...a) => goodModel(rt, 1000)(...a)}); rt = s.rt;
  const r = await rt.heartbeat(T0);
  assert.equal(r.spotlight.reason, 'timeout');
  assert.ok(['replay', 'scripted'].includes(r.spotlight.source));
  assert.equal(s.ledger.status().liveCalls, 0);
  assert.ok(s.ledger.status().spentUsd > 0);
  assert.ok(rt.events().some(e => e.kind === 'spotlight_fallback' || e.source === 'replay'));
});

test('the daily budget cap keeps the world running on the scenario only', async () => {
  let calls = 0; const s = setup({cap: 0.0001, fetcher: async () => { calls++; return new Response('{}'); }});
  for (let i = 0; i < 5; i++) assert.equal((await s.rt.heartbeat(T0 + i * TICK_MS)).status, 'committed');
  assert.equal(calls, 0);
  assert.equal(s.rt.state().tick, 5);
  assert.ok(s.rt.events().filter(e => e.kind === 'spotlight_fallback').every(e => e.data.reason === 'budget'));
});

test('without a key the world still turns, marked as not connected', async () => {
  const s = setup({key: null, fetcher: async () => { throw new Error('no'); }});
  const r = await s.rt.heartbeat(T0);
  assert.equal(r.spotlight.reason, 'not_connected');
  assert.ok(s.rt.view(T0).muses.length === 10);
});

test('a Muse holding a postcard (or any odd item id) never stops the heartbeat', async () => {
  let rt; const s = setup({fetcher: (...a) => goodModel(rt)(...a)}); rt = s.rt;
  const st = rt.state();
  for (const m of st.muses) m.inventory.push('postcard:osm:node/4869055832', 'postcard:osm:way/123539756');
  s.sql.exec('UPDATE world SET state = ? WHERE id = 1', JSON.stringify(st));
  const r = await rt.heartbeat(T0);
  assert.equal(r.status, 'committed');
  assert.equal(r.spotlight.source, 'live', 'postcards are summarised, the live call still happens');
  // Even an input the validator rejects falls back to the scenario instead of throwing.
  const st2 = rt.state(); st2.muses.forEach(m => m.inventory.push('BAD ITEM!')); s.sql.exec('UPDATE world SET state = ? WHERE id = 1', JSON.stringify(st2));
  const r2 = await rt.heartbeat(T0 + TICK_MS);
  assert.equal(r2.status, 'committed');
  assert.match(r2.spotlight.reason, /^input_invalid/);
});

test('event queries: newest tail in order, and one world day only', async () => {
  const s = setup({key: null, fetcher: async () => new Response('{}')});
  for (let i = 0; i < 6; i++) await s.rt.heartbeat(T0 + i * TICK_MS);
  const all = s.rt.events(0, 5000);
  const tail = s.rt.events(0, 0, {tail: 5});
  assert.deepEqual(tail.map(e => e.seq), all.slice(-5).map(e => e.seq), 'newest five, ascending');
  const day = all[0].id.slice(0, 10);
  assert.equal(s.rt.events(0, 5000, {day}).length, all.filter(e => e.id.startsWith(day + ':')).length);
  assert.equal(s.rt.events(0, 5000, {day: '1999-01-01'}).length, 0);
  assert.equal(s.rt.events(0, 5000, {day: "x' OR 1=1 --"}).length, all.length, 'bad day values are ignored, not injected');
});

// ---------- I-05: visitor priority, the other Muse's answer, two calls at once ----------
const write = (s, fn) => { const st = s.rt.state(); fn(st); s.sql.exec('UPDATE world SET state = ? WHERE id = 1', JSON.stringify(st)); };
/** Every Muse at its own place, busy with a long beat; each [a, b, place] (or [a, b, c, place]) shares a place and meets. */
const arrange = (s, groups) => write(s, st => {
  const spare = PLACES.filter(p => p.zone === 'neighborhood').map(p => p.id);
  st.muses.forEach((m, k) => { m.place = spare[k]; m.travel = null; m.intent = null; m.beat = {id: 'hold', clip: 'idle', startedAt: T0, endsAt: T0 + 3_600_000, line: null}; });
  for (const g of groups) for (const id of g.slice(0, -1)) st.muses.find(m => m.id === id).place = g.at(-1);
});
const replies = rt => rt.events(0, 5000).filter(e => e.kind === 'encounter_reply');
/**
 * A fake model for both actions. Spotlight: go to the first nearby place. Encounter: `answer(ctx)` (default a valid
 * greeting). Tracks how many calls run at once. `hold` makes encounter calls wait until released.
 */
function fakeModel({delayMs = 0, answer, hold = false} = {}) {
  const stats = {active: 0, max: 0, calls: {spotlight: 0, encounter: 0}, bodies: []};
  const waiting = [];
  const fetcher = async (_u, init) => {
    const body = JSON.parse(init.body), kind = body.response_format.json_schema.name === 'encounter_reply' ? 'encounter' : 'spotlight';
    const n = ++stats.calls[kind]; stats.bodies.push({kind, body});
    stats.active++; stats.max = Math.max(stats.max, stats.active);
    try {
      await new Promise((res, rej) => { const t = setTimeout(res, delayMs); init.signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('abort'), {name: 'AbortError'})); }); });
      if (hold && kind === 'encounter') await new Promise(r => waiting.push(r));
      const ctx = JSON.parse(body.messages[1].content.split('\nThey said:')[0]);
      const out = kind === 'spotlight'
        ? {freedom: 'where', decision: 'walk', target_place: ctx.places_nearby[0].name, target_agent: '', offer_item: '', want_item: '', public_reason: 'close by', line: 'On my way'}
        : (answer ?? (() => ({intent: 'greet', item: '', line: `Hello, ${ctx.other_muse}`, public_reason: 'we met here', injection_suspected: false})))(ctx);
      return new Response(JSON.stringify({id: `cmpl-${kind}-${n}`, usage: {prompt_tokens: 300, completion_tokens: 200}, choices: [{message: {content: JSON.stringify(out)}}]}), {headers: {'x-request-id': `req-${kind}-${n}`}});
    } finally { stats.active--; }
  };
  return {fetcher, stats, waiting: () => waiting.length, release: () => waiting.splice(0).forEach(r => r())};
}
const reservations = sql => sql.exec('SELECT id, action, settled, outcome FROM reservations ORDER BY id').toArray();

test('I-05 #1 visitor priority: a requested Muse holds the next spotlight (live) ahead of the rotation; duplicates, the hourly limit and paused Muses', async () => {
  const m = fakeModel();
  const s = setup({fetcher: m.fetcher}); const rt = s.rt;
  const v0 = rt.state().version;
  const req = rt.requestSpotlight('07-tempo', T0, {origin: 'visitor', requester: 'v1'});
  assert.equal(req.ok, true); assert.equal(req.position, 1); assert.equal(req.eventIds.length, 1);
  assert.equal(rt.state().version, v0, 'a queue entry does not make plans stale');
  assert.deepEqual(rt.view(T0).nextSpotlight, {muse: '07-tempo', freedom: 'where', priority: true});
  const again = rt.requestSpotlight('07-tempo', T0, {origin: 'visitor', requester: 'v1'});
  assert.deepEqual([again.ok, again.already, again.position], [true, true, 1], 'a duplicate keeps its place and logs nothing');
  assert.equal(rt.events().filter(e => e.kind === 'spotlight_requested').length, 1);
  const r = await rt.heartbeat(T0);
  assert.equal(r.spotlight.muse, '07-tempo', 'the queue goes before the rotation (cursor was 00-jolly)');
  assert.equal(r.spotlight.source, 'live');
  assert.match(m.stats.bodies.find(b => b.kind === 'spotlight').body.messages[0].content, /^You are Tempo/, 'the model call is for the requested Muse');
  assert.equal((await rt.heartbeat(T0 + TICK_MS)).spotlight.muse, '00-jolly', 'then the rotation resumes where it was');
  // Three per hour for a visitor; another visitor is not affected; the hour passes.
  for (const id of ['01-sunny', '02-moss']) assert.equal(rt.requestSpotlight(id, T0 + TICK_MS, {origin: 'visitor', requester: 'v1'}).ok, true);
  assert.deepEqual(rt.requestSpotlight('03-ripple', T0 + TICK_MS, {origin: 'visitor', requester: 'v1'}), {ok: false, reason: 'hourly_limit'});
  assert.ok(!rt.state().spotlight.visitorQueue.includes('03-ripple'), 'a refused request is not queued');
  assert.equal(rt.requestSpotlight('03-ripple', T0 + TICK_MS, {origin: 'visitor', requester: 'v2'}).ok, true);
  assert.equal(rt.requestSpotlight('04-ember', T0 + 3_600_000 + 1, {origin: 'visitor', requester: 'v1'}).ok, true, 'free again after an hour');
  // A paused (revoked) Muse is refused, and one revoked while waiting never gets the turn.
  rt.commitExternal(T0 + TICK_MS, 'pause', st => { st.paused = {'05-bloom': {at: T0, version: 2, by: 'owner'}}; });
  assert.deepEqual(rt.requestSpotlight('05-bloom', T0 + TICK_MS, {origin: 'visitor', requester: 'v3'}), {ok: false, reason: 'paused'});
  rt.commitExternal(T0 + TICK_MS, 'pause2', st => { st.paused['01-sunny'] = {at: T0, version: 2, by: 'owner'}; });
  assert.equal((await rt.heartbeat(T0 + 2 * TICK_MS)).spotlight.muse, '02-moss', 'Sunny (paused while queued) is skipped');
});

test('I-05 #2 the other Muse answers a meeting with one live model call: reserved, settled, evidence kept', async () => {
  const m = fakeModel();
  // With the rule hooks the initiator greets first; the other Muse answers that greeting.
  const s = setup({fetcher: m.fetcher, hooks: makeHooks()}); const rt = s.rt;
  arrange(s, [['02-moss', '05-bloom', 'commons:garden']]);
  const r = await rt.heartbeat(T0);
  assert.equal(r.status, 'committed');
  const meet = rt.events().find(e => e.kind === 'encounter');
  const said = replies(rt);
  assert.equal(said.length, 1);
  assert.deepEqual([said[0].muse, said[0].other, said[0].source], [meet.other, meet.muse, 'live']);
  assert.equal(said[0].data.encounterId, meet.data.encounterId, 'the answer and the meeting share one encounter id');
  assert.match(said[0].data.evidence.requestId, /^req-encounter-/);
  assert.equal(said[0].data.evidence.model, 'muse-spark-1.3');
  assert.equal(m.stats.calls.encounter, 1, 'one call per meeting');
  const enc = reservations(s.sql).filter(x => x.action === 'encounter');
  assert.equal(enc.length, 1); assert.ok(enc[0].settled !== null); assert.equal(enc[0].outcome, 'live');
  assert.equal(s.ledger.status().liveCalls, 2, 'spotlight + encounter');
  assert.deepEqual(r.replies, {live: 1, rule: 0});
  // The other Muse saw the greeting as wrapped data, not as instructions; the rule greeting stays a rule event.
  assert.match(m.stats.bodies.find(b => b.kind === 'encounter').body.messages[1].content, /They said: <untrusted_data source="other_agent">Hi /);
  assert.equal(rt.events().find(e => e.kind === 'greet').source, 'rule');
});

test('I-05 #2 rule answers are labelled rule with the reason: invalid output, no key, no budget', async () => {
  // Invalid output: an item the Muse does not hold. Paid (rejected), not live, no model evidence on the rule answer.
  const bad = fakeModel({answer: () => ({intent: 'gift', item: 'gold_bar', line: 'Take this', public_reason: '', injection_suspected: false})});
  const a = setup({fetcher: bad.fetcher}); arrange(a, [['02-moss', '05-bloom', 'commons:garden']]);
  await a.rt.heartbeat(T0);
  const ra = replies(a.rt);
  assert.equal(ra.length, 1); assert.equal(ra[0].source, 'rule');
  assert.equal(ra[0].data.reason, 'output_rejected:item not held');
  assert.equal(ra[0].data.evidence, undefined, 'a rule answer never carries model evidence');
  assert.equal(reservations(a.sql).find(x => x.action === 'encounter').outcome, 'rejected');
  assert.ok(!a.rt.events().some(e => e.kind === 'encounter_reply' && e.source === 'live'));
  // No key: rule, no call.
  let calls = 0;
  const b = setup({key: null, fetcher: async () => { calls++; return new Response('{}'); }}); arrange(b, [['02-moss', '05-bloom', 'commons:garden']]);
  await b.rt.heartbeat(T0);
  assert.equal(replies(b.rt)[0].data.reason, 'not_connected'); assert.equal(calls, 0);
  // No budget: rule, no call.
  const c = setup({cap: 0.0001, fetcher: async () => { calls++; return new Response('{}'); }}); arrange(c, [['02-moss', '05-bloom', 'commons:garden']]);
  await c.rt.heartbeat(T0);
  assert.equal(replies(c.rt)[0].data.reason, 'budget'); assert.equal(calls, 0);
  // Timeout: rule, charged in full.
  const slow = fakeModel({delayMs: 1000});
  const d = setup({fetcher: slow.fetcher}); arrange(d, [['02-moss', '05-bloom', 'commons:garden']]);
  await d.rt.heartbeat(T0);
  assert.equal(replies(d.rt)[0].data.reason, 'timeout');
  assert.equal(reservations(d.sql).find(x => x.action === 'encounter').outcome, 'timeout');
});

test('I-05 #3 at most two model calls at once per world: extra meetings answer by rule at once (no waiting), the sixth by the turn limit', async () => {
  const m = fakeModel({delayMs: 30});
  const s = setup({fetcher: m.fetcher}); const rt = s.rt;
  // Four Muses at the garden: six meetings in one tick.
  arrange(s, [['02-moss', '05-bloom', '06-ink', '07-tempo', 'commons:garden']]);
  const started = Date.now();
  const r = await rt.heartbeat(T0);
  assert.ok(Date.now() - started < 140, 'the extra answers did not wait for a slot');
  assert.equal(m.stats.max, 2, 'never more than two calls in flight');
  const said = replies(rt);
  assert.equal(said.length, 6);
  assert.equal(said.filter(e => e.source === 'live').length, 2);
  assert.equal(said.filter(e => e.data.reason === 'concurrency_limit').length, 3);
  assert.equal(said.filter(e => e.data.reason === 'turn_limit').length, 1);
  assert.deepEqual(r.replies, {live: 2, rule: 4});
  assert.equal(rt.modelCallsInFlight, 0);
  // Both slots taken elsewhere: the spotlight falls back with the reason and makes no call.
  const s2 = setup({fetcher: m.fetcher}); const a = s2.rt.modelSlot(), b = s2.rt.modelSlot();
  assert.equal(s2.rt.modelSlot(), null, 'a third slot is refused');
  const before = m.stats.calls.spotlight;
  const r2 = await s2.rt.heartbeat(T0);
  assert.equal(r2.spotlight.reason, 'concurrency_limit');
  assert.equal(m.stats.calls.spotlight, before, 'no call was made');
  a(); a(); b();
  assert.equal(s2.rt.modelCallsInFlight, 0, 'release is idempotent');
});

test('I-05 #3 slots are released on every path: timeout, network error, invalid output and a throw inside the call', async () => {
  const groups = [['02-moss', '05-bloom', 'commons:garden']];
  for (const fetcher of [fakeModel({delayMs: 1000}).fetcher, async () => { throw new Error('offline'); }, async () => new Response('not json', {status: 200})]) {
    const s = setup({fetcher}); arrange(s, groups);
    assert.equal((await s.rt.heartbeat(T0)).status, 'committed');
    assert.equal(s.rt.modelCallsInFlight, 0);
  }
  // A throw inside an encounter call (the ledger fails to settle): the world still commits, the answer is a rule one.
  const m = fakeModel();
  const s = setup({fetcher: m.fetcher}); arrange(s, groups);
  const settle = s.ledger.settle.bind(s.ledger);
  s.ledger.settle = (id, ...x) => { if (id.includes(':encounter:')) throw new Error('settle failed'); return settle(id, ...x); };
  assert.equal((await s.rt.heartbeat(T0)).status, 'committed');
  assert.equal(replies(s.rt)[0].data.reason, 'error');
  assert.equal(s.rt.modelCallsInFlight, 0, 'the encounter slot was released');
  // A throw inside the spotlight call: the heartbeat fails, the slot and the tick claim are both released, the next run works.
  s.ledger.settle = (id, ...x) => { if (id.endsWith(':spotlight')) throw new Error('settle failed'); return settle(id, ...x); };
  await assert.rejects(s.rt.heartbeat(T0 + TICK_MS), /settle failed/);
  assert.equal(s.rt.modelCallsInFlight, 0, 'the spotlight slot was released');
  s.ledger.settle = settle;
  assert.equal((await s.rt.heartbeat(T0 + TICK_MS)).status, 'committed');
});

test('I-05 #4 a Muse revoked while its answer is awaited: the answer is discarded (paid), never used, and the Muse stays paused', async () => {
  const sql = sqlite(), trust = new Trust(sql); trust.init();
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  await trust.ensureAgents(await crypto.subtle.exportKey('jwk', pair.privateKey));
  const m = fakeModel({hold: true});
  const s = setup({sql, fetcher: m.fetcher, timeoutMs: 5000, delegationValid: id => !trust.suspended(id)}); const rt = s.rt;
  arrange(s, [['02-moss', '05-bloom', 'commons:garden']]);
  const beat = rt.heartbeat(T0);
  while (m.waiting() === 0) await new Promise(r => setTimeout(r, 2));
  const answering = m.stats.bodies.find(b => b.kind === 'encounter').body.messages[0].content.match(/^You are (\w+)/)[1];
  const id = answering === 'Moss' ? '02-moss' : '05-bloom';
  await revokeMuse({trust, runtime: rt, now: () => T0}, id, 'owner');
  m.release();
  assert.equal((await beat).status, 'committed');
  const gone = rt.events().filter(e => e.kind === 'encounter_reply_discarded');
  assert.equal(gone.length, 1);
  assert.equal(gone[0].muse, id);
  assert.equal(gone[0].data.reason, 'delegation revoked before commit');
  assert.match(gone[0].data.evidence.requestId, /^req-encounter-/, 'the discarded answer keeps its evidence');
  assert.ok(!replies(rt).some(e => e.muse === id), 'never used');
  assert.ok(!rt.events().some(e => e.kind === 'encounter' && [e.muse, e.other].includes(id) && e.tick === 0), 'the paused Muse did not meet');
  assert.ok(rt.state().paused[id], 'still paused');
  assert.equal(reservations(s.sql).find(x => x.action === 'encounter').settled !== null, true, 'the call was still settled');
  assert.equal(rt.modelCallsInFlight, 0);
});

test('I-05 #4 the world moved while answers were awaited: they are discarded and the meeting answers by rule; an alarm retry calls nothing twice', async () => {
  const m = fakeModel({delayMs: 20});
  let s; s = setup({fetcher: m.fetcher, beforeCommit: () => { const st = s.rt.state(); st.version += 1; s.sql.exec('UPDATE world SET state = ?, version = ? WHERE id = 1', JSON.stringify(st), st.version); }});
  arrange(s, [['02-moss', '05-bloom', 'commons:garden']]);
  await s.rt.heartbeat(T0);
  const gone = s.rt.events().find(e => e.kind === 'encounter_reply_discarded');
  assert.equal(gone.data.reason, 'world changed while the model was answering');
  const said = replies(s.rt);
  assert.equal(said.length, 1); assert.equal(said[0].source, 'rule');
  assert.equal(said[0].data.reason, 'discarded: world changed while the model was answering');
  // Two alarms for the same tick: one run calls the model (spotlight + one answer), the other stops before any call.
  const m2 = fakeModel({delayMs: 20});
  const t = setup({fetcher: m2.fetcher}); arrange(t, [['02-moss', '05-bloom', 'commons:garden']]);
  const [x, y] = await Promise.all([t.rt.heartbeat(T0), t.rt.heartbeat(T0)]);
  assert.deepEqual([x.status, y.status].sort(), ['committed', 'skipped_duplicate']);
  assert.deepEqual(m2.stats.calls, {spotlight: 1, encounter: 1});
  assert.equal(replies(t.rt).length, 1);
  assert.equal(new Set(t.rt.events().map(e => e.id)).size, t.rt.events().length);
});
