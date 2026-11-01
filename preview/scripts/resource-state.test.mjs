// P-06 criterion A: request health. An HTTP error, a broken body and a network failure are different; an empty list is a
// real answer; a failure after an earlier success is "stale", not "error"; recovery clears it.
import test from 'node:test';
import assert from 'node:assert/strict';
const {fetchJson, newHealth, track, resState, stateText, loadLog, BLOCKED} = await import('../src/ui/resource-state.ts');

const realFetch = globalThis.fetch;
const reply = (status, body) => async () => new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {status});
const clock = ms => `t${ms % 1000}`;

test('an HTTP error, a broken body and a network failure each get their own reason', async () => {
  globalThis.fetch = reply(503, 'down');
  assert.deepEqual((await fetchJson('/api/world')).error, 'HTTP 503');
  globalThis.fetch = reply(200, '{not json');
  assert.deepEqual((await fetchJson('/api/world')).error, 'Invalid response');
  globalThis.fetch = async () => { throw new TypeError('failed to fetch'); };
  assert.deepEqual((await fetchJson('/api/world')).error, 'Network error');
  globalThis.fetch = realFetch;
});

test('A1: a first failure is an error; a good empty answer is ready, not an error', async () => {
  const h = newHealth();
  assert.equal(resState(h, false), 'loading');
  globalThis.fetch = reply(503, 'down'); track(h, await fetchJson('/x'));
  assert.equal(resState(h, false), 'error');
  globalThis.fetch = reply(200, []); const r = await fetchJson('/x'); track(h, r);
  assert.equal(r.ok, true); assert.deepEqual(r.data, []);
  assert.equal(resState(h, false), 'ready');
  globalThis.fetch = realFetch;
});

test('A2: success then failure is stale (older data stays), recovery is ready again', async () => {
  const h = newHealth(), good = [{id: 1}];
  globalThis.fetch = reply(200, good); track(h, await fetchJson('/x'));
  const okAt = h.lastOkAt;
  globalThis.fetch = reply(500, 'boom'); track(h, await fetchJson('/x'));
  assert.equal(resState(h, true), 'stale');
  assert.equal(h.lastOkAt, okAt, 'the time of the last good answer is kept');
  assert.match(stateText('stale', h, clock), /Not responding \(HTTP 500\).*last good answer/);
  assert.equal(resState(h, false), 'error', 'without older data the same failure is an error');
  globalThis.fetch = reply(200, good); track(h, await fetchJson('/x'));
  assert.equal(resState(h, true), 'ready'); assert.equal(h.error, null);
  globalThis.fetch = realFetch;
});

test('the sentences say what is happening and never claim a connection that is not there', () => {
  const h = {lastOkAt: null, lastErrorAt: 1, error: 'Network error'};
  assert.match(stateText('error', h, clock), /Unavailable \(Network error\).*no live data/);
  assert.match(stateText('loading', undefined, clock), /Connecting/);
  assert.match(stateText('ready', {lastOkAt: 1, lastErrorAt: null, error: null}, clock), /Connected/);
});

test('this module makes no request of its own besides the one fetch in fetchJson', async () => {
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('../src/ui/resource-state.ts', import.meta.url), 'utf8');
  assert.equal((src.match(/\bfetch\(/g) ?? []).length, 1);
  assert.ok(!/document\.|window\./.test(src), 'pure module: no DOM');
});

test('a request refused because the replay is open is not a failure of the world', async () => {
  const h = newHealth();
  globalThis.fetch = reply(200, {a: 1}); track(h, await fetchJson('/x')); const okAt = h.lastOkAt;
  globalThis.fetch = async () => { throw new Error(BLOCKED); };
  const r = await fetchJson('/x'); assert.equal(r.ok, false); assert.equal(r.error, BLOCKED);
  track(h, r);
  assert.equal(h.error, null, 'health is untouched'); assert.equal(h.lastOkAt, okAt); assert.equal(resState(h, true), 'ready');
  globalThis.fetch = realFetch;
});

test('loadLog: one page, an empty log, a failing later page (partial) and the page limit (capped)', async () => {
  const rows = (from, n) => Array.from({length: n}, (_, i) => ({seq: from + i + 1}));
  const ok = data => ({ok: true, data, at: 1}), bad = error => ({ok: false, error, at: 1});
  let r = await loadLog(async () => ok(rows(0, 5)), 2000, 40); assert.deepEqual([r.rows.length, r.error, r.capped], [5, null, false]);
  r = await loadLog(async () => ok([])); assert.deepEqual([r.rows.length, r.error, r.capped], [0, null, false]);
  const seen = []; r = await loadLog(async since => { seen.push(since); return since === 0 ? ok(rows(0, 2000)) : bad('HTTP 503'); });
  assert.deepEqual([r.rows.length, r.error, r.capped], [2000, 'HTTP 503', false]); assert.deepEqual(seen, [0, 2000], 'the next page continues after the last seq');
  let calls = 0; r = await loadLog(async since => { calls++; return ok(rows(since, 2000)); });
  assert.deepEqual([r.rows.length, calls, r.capped, r.error], [80000, 40, true, null], 'a full last page at the limit is capped, not complete');
  r = await loadLog(async since => since < 6000 ? ok(rows(since, 2000)) : ok(rows(since, 7)));
  assert.deepEqual([r.rows.length, r.capped], [6007, false], 'a short last page ends a complete read');
});
