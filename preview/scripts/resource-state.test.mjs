// P-06 criterion A: request health. An HTTP error, a broken body and a network failure are different; an empty list is a
// real answer; a failure after an earlier success is "stale", not "error"; recovery clears it.
import test from 'node:test';
import assert from 'node:assert/strict';
const {fetchJson, newHealth, track, resState, stateText} = await import('../src/ui/resource-state.ts');

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
