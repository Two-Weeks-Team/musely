import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRun, ReplayRecordError} from '../src/replay/player.ts';
import {loadRecordedRun} from '../src/replay/loader.ts';
import {currentVersions} from '../src/replay/versions.ts';
import {bodyHash, publicState} from '../worker/core/run-log.ts';
import {createWorld} from '../src/engine/world.ts';
const T0 = Date.parse('2026-11-02T12:00:00Z');
const snapshot = state => { const body = JSON.stringify(state); return {body, hash: bodyHash(body)}; };
function record() {
 const initial = publicState(createWorld('w', T0)), a = structuredClone(initial), b = structuredClone(initial);
 a.version = 1; a.muses[0].place = 'commons:garden'; b.version = 2; b.muses[0].place = 'commons:campfire'; b.muses[0].inventory.push('tea');
 const s = [snapshot(initial), snapshot(a), snapshot(b)];
 const inputs = [1, 2].map((seq, i) => ({seq, runId: 'run-test', at: T0 + seq * 1000, kind: 'external', label: 'recorded-change', day: initial.day, tick: seq, versionBefore: i, versionAfter: seq, beforeHash: s[i].hash, afterHash: s[seq].hash, itemsHead: null, itemsSeq: null, events: 1, input: {recorded: true}, afterSnapshot: s[seq], afterSnapshotError: null}));
 const events = inputs.map(i => ({id: 'event-' + i.seq, seq: i.seq, runId: 'run-test', inputSeq: i.seq, tick: i.tick, at: i.at, source: i.seq === 1 ? 'live' : 'rule', kind: 'arrive', muse: '00-jolly', other: null, place: i.seq === 1 ? 'commons:garden' : 'commons:campfire', line: null, data: i.seq === 1 ? {evidence: {model: 'recorded-model', requestId: 'req-real-recorded'}} : {verdict: {ok: true}}, tags: []}));
 return {...currentVersions(), runId: 'run-test', worldId: 'w', seed: initial.seed, startedAt: T0, origin: 'fresh', prevRunId: null, legacy: null, initialSnapshot: s[0], readThrough: {inputSeq: 2, eventSeq: 2, inputs: 2, events: 2}, inputs, events};
}
const rejects = (r, code) => assert.throws(() => loadRun(r), e => e instanceof ReplayRecordError && e.code === code);

test('the exact historical a31 engine3 checkpoint tuple stays readable after the encounter engine changes', () => {
 for (const [engineVersion, catalogVersion] of [['engine-5', 'catalog-c7068bfa0238'], ['engine-4', 'catalog-c7068bfa0238'], ['engine-3', 'catalog-c7068bfa0238'], ['engine-2', 'catalog-d69858ec160f']]) {
  const r = record();
  Object.assign(r, {schemaVersion: 'run-log-2', engineVersion, harnessVersion: 'harness-c0c69e98b5e8', catalogVersion});
  const player = loadRun(r); player.seek(2);
  assert.equal(player.getFrame().publicState.muses[0].place, 'commons:campfire');
  const invalid = structuredClone(r); invalid.catalogVersion = 'catalog-not-the-historical-a31-content';
  rejects(invalid, 'incompatible_record');
 }
});

test('recorded introductions and the inbox meeting signal survive checkpoint playback without an executor', () => {
 const r = record(), last = r.inputs.at(-1), state = JSON.parse(last.afterSnapshot.body);
 const introduction = {id: 'w:hello:00-jolly|09-copper:recorded', at: T0 + 1000, place: 'commons:cafe'};
 state.muses[0].introductions = {'09-copper': introduction};
 state.muses[9].introductions = {'00-jolly': introduction};
 state.inbox.messages.push({id: 'm_intro', from: '00-jolly', to: '09-copper', kind: 'greet', at: T0 + 1000, text: null, read: false, encounter: {id: introduction.id, place: introduction.place, first_contact: true}});
 last.afterSnapshot = snapshot(state); last.afterHash = last.afterSnapshot.hash;
 const player = loadRun(r); player.seek(2);
 const restored = player.getFrame().publicState;
 assert.deepEqual(restored.muses[0].introductions['09-copper'], introduction);
 assert.equal(restored.inbox.messages.at(-1).encounter.first_contact, true);
 assert.equal(restored.inbox.messages.at(-1).encounter.id, introduction.id);
});

test('recorded1x/10x/60x finish at the exact stored public after-state and seek restores the same snapshots', () => {
 const r = record(), end = JSON.parse(r.inputs[1].afterSnapshot.body), original = structuredClone(r), finals = [];
 for (const speed of [1, 10, 60]) {
  const p = loadRun(r); p.setSpeed(speed); p.play(); p.advance(3000 / speed);
  assert.equal(p.getState().ended, true); assert.equal(p.getState().playing, false);
  const frame = p.getFrame(); assert.deepEqual(frame.publicState, end); assert.equal(frame.snapshotHash, r.inputs[1].afterHash); assert.equal(frame.events.length, 2); finals.push(frame.publicState);
  p.seek(1); assert.deepEqual(p.getFrame().publicState, JSON.parse(r.inputs[0].afterSnapshot.body));
  p.seek(0); assert.deepEqual(p.getFrame().publicState, JSON.parse(r.initialSnapshot.body));
  p.seek(2); assert.deepEqual(p.getFrame().publicState, end);
  frame.publicState.muses.length = 0; assert.equal(p.getFrame().publicState.muses.length, 10, 'callers cannot mutate the stored replay');
 }
 assert.deepEqual(finals[0], finals[1]); assert.deepEqual(finals[1], finals[2]); assert.deepEqual(r, original);
});

test('schema/engine/harness/catalog mismatch is incompatible_record and corrupt or missing snapshots are refused', () => {
 for (const key of ['schemaVersion', 'engineVersion', 'harnessVersion', 'catalogVersion']) { const r = record(); r[key] = key === 'schemaVersion' ? 'run-log-1' : 'different'; rejects(r, 'incompatible_record'); }
 for (const where of ['initial', 'after']) { const r = record(); (where === 'initial' ? r.initialSnapshot : r.inputs[0].afterSnapshot).body += ' '; rejects(r, 'invalid_record'); }
 const missing = record(); missing.inputs[0].afterSnapshot = null; missing.inputs[0].afterSnapshotError = 'replay_storage_limit'; rejects(missing, 'incomplete_record');
 const broken = record(); broken.inputs[1].beforeHash = '0'.repeat(64); rejects(broken, 'invalid_record');
 const truncated = record(); truncated.events.pop(); rejects(truncated, 'incomplete_record');
 const foreign = record(); foreign.events[0].runId = 'another-run'; rejects(foreign, 'invalid_record');
 const seed = record(); seed.seed += '-changed'; rejects(seed, 'invalid_record');
 const tags = record(); tags.events[0].tags = [42]; rejects(tags, 'invalid_record');
});

test('empty recorded run is a genuine snapshot-only state, pause/end/rewind are read-only and no executor is called', () => {
 const r = record(); r.inputs = []; r.events = []; r.readThrough = {inputSeq: 0, eventSeq: 0, inputs: 0, events: 0};
 let calls = 0; const old = globalThis.fetch; globalThis.fetch = () => { calls++; throw new Error('replay must not execute'); };
 try {
  const p = loadRun(r); p.play(); p.advance(3600000); p.pause(); p.setSpeed(60); p.seek(0);
  assert.deepEqual(p.getFrame().publicState, JSON.parse(r.initialSnapshot.body)); assert.equal(p.getFrame().empty, true); assert.equal(p.getFrame().events.length, 0); assert.equal(calls, 0);
 } finally { globalThis.fetch = old; }
});

test('commit order survives a backwards source timestamp without altering the recorded timestamp or hashes', () => {
 const r = record(); r.inputs[1].at = T0 + 500; r.events[1].at = T0 + 500;
 const p = loadRun(r); p.seek(1);
 assert.deepEqual(p.getFrame().publicState, JSON.parse(r.inputs[1].afterSnapshot.body));
 assert.equal(p.getFrame().snapshotAt, T0 + 500); assert.equal(p.getFrame().timeOrderAdjusted, true);
 assert.equal(p.getFrame().events[1].at, T0 + 500);
});

test('GET loader freezes a finite committed prefix, pages by sequence and cannot issue model/MCP/write calls', async () => {
 const r = record(), calls = [];
 const read = async (path, init) => {
  calls.push({path, ...init}); const u = new URL(path, 'https://musely.net');
  const data = u.pathname === '/api/world/run' ? {...r, inputs: undefined, events: undefined} : (u.pathname === '/api/world/run/inputs' ? r.inputs : r.events).filter(x => x.seq > Number(u.searchParams.get('since') ?? 0)).slice(0, 1);
  return {ok: true, status: 200, json: async () => structuredClone(data)};
 };
 const loaded = await loadRecordedRun(read, r.runId), p = loadRun(loaded); p.seek(999);
 assert.deepEqual(p.getFrame().publicState, JSON.parse(r.inputs[1].afterSnapshot.body));
 assert.equal(calls.length, 5); assert.ok(calls.every(c => c.method === 'GET' && !c.body));
 assert.ok(calls.every(c => ['/api/world/run', '/api/world/run/inputs', '/api/world/events'].includes(new URL(c.path, 'https://musely.net').pathname)));
});

test('failed or malformed record reads are errors rather than successful empty runs', async () => {
 await assert.rejects(loadRecordedRun(async () => ({ok: false, status: 503, json: async () => ({error: 'down'})}), 'run-test'), e => e.code === 'load_failed');
 await assert.rejects(loadRecordedRun(async () => ({ok: true, status: 200, json: async () => []}), 'run-test'), e => e.code === 'invalid_record');
 const r = record();
 await assert.rejects(loadRecordedRun(async path => ({ok: true, status: 200, json: async () => path.startsWith('/api/world/run?') ? r : []}), 'run-test'), e => e.code === 'incomplete_record');
});

test('the replay loading channel permits only same-origin public log GETs; global replay guard blocks API and MCP writes', async () => {
 const {build} = await import('esbuild');
 const b = await build({entryPoints: [new URL('../src/ui/isolation.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent'});
 const m = await import('data:text/javascript;base64,' + Buffer.from(b.outputFiles[0].text).toString('base64'));
 const old = {fetch: globalThis.fetch, window: globalThis.window, location: globalThis.location}, calls = [];
 globalThis.window = globalThis; globalThis.location = {href: 'https://musely.net/', origin: 'https://musely.net'};
 globalThis.fetch = async (url, init) => { calls.push({url: String(url), ...init}); return new Response('{}'); };
 try {
  m.enforceIsolation(); m.isolation.replay = true;
  await assert.rejects(fetch('/api/muse', {method: 'POST'}));
  await assert.rejects(fetch('/mcp', {method: 'POST'}));
  await assert.rejects(m.readRecordedApi('/api/owner/session'));
  await assert.rejects(m.readRecordedApi('https://foreign.example/api/world/run'));
  await assert.rejects(m.readRecordedApi('/api/world/events'));
  assert.equal(calls.length, 0);
  await m.readRecordedApi('/api/world/run'); await m.readRecordedApi('/api/world/run/inputs?runId=r'); await m.readRecordedApi('/api/world/events?runId=r');
  assert.equal(calls.length, 3); assert.ok(calls.every(c => c.method === 'GET' && !c.body));
 } finally { m.isolation.replay = false; globalThis.fetch = old.fetch; if (old.window === undefined) delete globalThis.window; else globalThis.window = old.window; if (old.location === undefined) delete globalThis.location; else globalThis.location = old.location; }
});

test('recorded final public dialogue has a read-only playout tail instead of ending before its cue starts', () => {
 const r = record(); r.events[0].kind = 'greet'; r.events[0].line = 'The final stored hello';
 const p = loadRun(r), end = JSON.parse(r.inputs.at(-1).afterSnapshot.body);
 assert.equal(p.getState().durationSec,17,'legacy event.at +12s delay +4s greeting');
 p.seek(13.5); assert.equal(p.getFrame().playout,true); assert.equal(p.getFrame().recordedAt,T0+13500);
 assert.equal(p.getFrame().snapshotAt,T0+2000); assert.deepEqual(p.getFrame().publicState,end);
 p.play();p.advance(10000);assert.equal(p.getState().ended,true);assert.deepEqual(p.getFrame().publicState,end);
});

test('a hashed snapshot with malformed renderer clock or Muse travel is invalid_record before it reaches 3D', () => {
 for (const change of [s=>delete s.day, s=>s.tick='one', s=>s.lastTickAt=null, s=>s.muses[0].travel={to:'commons:cafe',departAt:'yesterday',arriveAt:T0+1000,speed:'walk'}]) {
  const r=record(), state=JSON.parse(r.initialSnapshot.body); change(state); r.initialSnapshot=snapshot(state); r.inputs[0].beforeHash=r.initialSnapshot.hash; rejects(r,'invalid_record');
 }
});

test('publishedAt selects the real publication cue clock while preserving the business event.at and final checkpoint', () => {
 const r=record(); r.events[0].kind='greet';r.events[0].line='A published public hello';r.events[0].data.publishedAt=T0+20000;
 const p=loadRun(r);assert.equal(p.getState().durationSec,36,'publication +12s delay +4s greeting');
 p.seek(32.5);const frame=p.getFrame();assert.equal(frame.playout,true);assert.equal(frame.recordedAt,T0+32500);
 assert.equal(frame.events[0].at,T0+1000);assert.equal(frame.events[0].data.publishedAt,T0+20000);
 assert.equal(frame.snapshotAt,T0+2000);assert.equal(frame.snapshotHash,r.inputs.at(-1).afterHash);
});

// The engine computes real-speed ETAs from geographic distance; arrival milliseconds need not be integral.
import {DatabaseSync} from 'node:sqlite';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {beginTrip} from '../src/engine/travel.ts';
import {tripMs} from '../src/engine/world.ts';
import {PLACES,placeById} from '../src/engine/places.ts';
test('real recorded trips retain fractional arrival times in both initial and committed snapshots',()=>{
 const db=new DatabaseSync(':memory:');let depth=0;const sql={exec(q,...b){const st=db.prepare(q);if(/^\s*(select|with|explain)/i.test(q))return{toArray:()=>st.all(...b)};st.run(...b);return{toArray:()=>[]};},transactionSync(fn){const id='t'+depth++;db.exec('SAVEPOINT '+id);try{const r=fn();db.exec('RELEASE '+id);return r;}catch(e){db.exec('ROLLBACK TO '+id);db.exec('RELEASE '+id);throw e;}finally{depth--;}}};
 try{
  const rt=new WorldRuntime(sql,{worldId:'trip-replay',model:null,meetingGate:'off',publicationNow:()=>T0+1000});rt.init(T0);
  const from=placeById(rt.state().muses[0].place),to=PLACES.find(p=>!Number.isInteger(T0+1000+tripMs(from,p,'walk')));assert.ok(to,'actual geography produces fractional ETA');
  rt.commitExternal(T0+1000,'recorded-trip',(st,emit)=>beginTrip(st.muses[0],to,T0+1000,'scripted',emit,'recorded regression'));
  const run=rt.runLog.current,r={...run,inputs:rt.runLog.inputs(run.runId),events:rt.events(0,100,{runId:run.runId}),readThrough:rt.runLog.boundary(run.runId)},travel=rt.state().muses[0].travel;
  assert.equal(Number.isInteger(travel.arriveAt),false);const original=JSON.stringify(r),p=loadRun(r);p.seek(p.getState().durationSec);assert.deepEqual(p.getFrame().publicState.muses[0].travel,travel);assert.equal(JSON.stringify(r),original,'replay never rounds the original checkpoint');
  const last=r.inputs.at(-1);const initialOnly={...r,startedAt:last.at,initialSnapshot:last.afterSnapshot,inputs:[],events:[],readThrough:{inputSeq:0,eventSeq:0,inputs:0,events:0}};
  assert.deepEqual(loadRun(initialOnly).getFrame().publicState.muses[0].travel,travel);
 }finally{db.close();}
});
test('nonfinite, negative, out-of-range and reversed arrival times remain invalid',()=>{
 for(const arriveAt of [NaN,Infinity,-1,Number.MAX_SAFE_INTEGER+1,'tomorrow',T0-1]){const r=record(),state=JSON.parse(r.initialSnapshot.body);state.muses[0].travel={to:'commons:cafe',departAt:T0,arriveAt,speed:'walk'};r.initialSnapshot=snapshot(state);r.inputs[0].beforeHash=r.initialSnapshot.hash;rejects(r,'invalid_record');}
});

