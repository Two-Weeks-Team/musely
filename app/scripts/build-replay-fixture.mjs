// Local browser fixture made by the actual RunLog writer; no provider, account or deployed world is called.
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync, mkdirSync} from 'node:fs';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
const db = new DatabaseSync(':memory:'); let depth = 0;
const sql = {exec(q, ...b) { const s = db.prepare(q); if (/^\s*(SELECT|WITH|EXPLAIN)/i.test(q)) return {toArray: () => s.all(...b)}; s.run(...b); return {toArray: () => []}; }, transactionSync(f) { const save = 'tx' + depth++; db.exec('SAVEPOINT ' + save); try { const r = f(); db.exec('RELEASE ' + save); return r; } catch (e) { db.exec('ROLLBACK TO ' + save); db.exec('RELEASE ' + save); throw e; } finally { depth--; } }};
const at = Date.parse('2026-11-02T12:00:00Z'), rt = new WorldRuntime(sql, {worldId: 'browser-fixture', model: null, meetingGate: 'off'}); rt.init(at);
rt.commitExternal(at + 1000, 'fixture-public-record', (st, emit) => {
 st.muses[0].place = 'commons:garden';
 emit({at: at + 1000, source: 'live', kind: 'greet', muse: st.muses[0].id, other: st.muses[1].id, place: 'commons:garden', line: 'Synthetic browser fixture; not a provider receipt', data: {evidence: {model: 'test-fixture', requestId: 'fixture-request-id', responseId: 'fixture-response-id'}}, tags: ['test_record']});
});
rt.commitExternal(at + 2000, 'fixture-public-end', (st, emit) => {
 st.muses[0].place = 'commons:campfire'; st.muses[0].inventory.push('tea');
 emit({at: at + 2000, source: 'rule', kind: 'arrive', muse: st.muses[0].id, place: 'commons:campfire', line: null, data: {verdict: {ok: true}}, tags: ['test_record']});
});
const run = rt.runLog.current;
const fixture = {...run, readThrough: rt.runLog.boundary(run.runId), inputs: rt.runLog.inputs(run.runId), events: rt.events(0, 100, {runId: run.runId})};
mkdirSync('dist', {recursive: true}); writeFileSync('dist/replay-test.json', JSON.stringify(fixture));
console.log(JSON.stringify({fixture: 'dist/replay-test.json', inputs: fixture.inputs.length, events: fixture.events.length, versions: {schema: run.schemaVersion, engine: run.engineVersion, catalog: run.catalogVersion}}));
