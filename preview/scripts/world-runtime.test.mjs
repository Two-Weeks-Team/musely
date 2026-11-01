import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {spotlightFor, spotlightInput, TICK_MS} from '../src/engine/world.ts';

const sqlite = () => { const db = new DatabaseSync(':memory:'); return {exec(q, ...b) { const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }}; };
const T0 = Date.parse('2026-11-03T16:00:00Z');
function setup({cap = 20, fetcher, key = 'k', ...rest} = {}) {
  const sql = sqlite(), ledger = new Ledger(sql, {dailyCapUsd: cap, now: () => T0}); ledger.init();
  const rt = new WorldRuntime(sql, {worldId: 'w', ledger, model: {base: 'https://api.meta.ai/v1', key, model: 'muse-spark-1.3', timeoutMs: 150, fetcher}, ...rest});
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
