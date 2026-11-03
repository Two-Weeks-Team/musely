// Offline runtime integration: no real model, transport, credentials or user state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Ledger} from '../worker/core/ledger.ts';
import {ResidentLifeStore} from '../worker/core/resident-life-adapter.ts';
import {createLife,recordPromise} from '../src/engine/resident-life.ts';
import {TICK_MS} from '../src/engine/world.ts';
globalThis.fetch=async()=>{throw new Error('network disabled in resident-life tests');};
const now=Date.parse('2026-11-03T20:00:00Z');
const initialState=()=>createLife([{id:'gardener',defaultGoal:'Visit garden',home:'commons:garden'}],[{id:'01-sunny',roleId:'gardener'},{id:'00-jolly',roleId:'gardener'}]);
const policy=()=>({enabled:true,initialState:initialState(),allowedPlaceIds:['commons:garden'],ownershipKind:id=>id==='01-sunny'?'resident':'legacy'});
function storage(db){let depth=0;return {exec(q,...args){const st=db.prepare(q),rows=st.columns().length?st.all(...args):(st.run(...args),[]);return {toArray:()=>rows};},transactionSync(fn){const sp='test'+depth++;db.exec('SAVEPOINT '+sp);try{const v=fn();db.exec('RELEASE '+sp);return v;}catch(e){db.exec('ROLLBACK TO '+sp);db.exec('RELEASE '+sp);throw e;}finally{depth--;}}};}
function boot(t,{residentLife=policy(),beforeCommit,db=new DatabaseSync(':memory:')}={}){t.after(()=>db.close());const sql=storage(db),ledger=new Ledger(sql,{dailyCapUsd:0});ledger.init();const runtime=new WorldRuntime(sql,{worldId:'life-runtime-test',ledger,model:null,meetingGate:'off',residentLife,beforeCommit});runtime.init(now);const s=runtime.state();s.spotlight.cursor=1;sql.exec('UPDATE world SET state = ?, version = ? WHERE id=1',JSON.stringify(s),s.version);return {db,sql,ledger,runtime,store:new ResidentLifeStore(sql)};}
test('feature absent/off preserves baseline and creates no life table',async t=>{
 const a=boot(t,{residentLife:null}),b=boot(t,{residentLife:{...policy(),enabled:false}});
 // Explicitly remove the default via a separate runtime with no option.
 const absent=new WorldRuntime(a.sql,{worldId:'life-runtime-test',ledger:a.ledger,model:null,meetingGate:'off'});absent.init(now);
 await absent.heartbeat(now);await b.runtime.heartbeat(now);assert.deepEqual(absent.state(),b.runtime.state());
 assert.equal(b.db.prepare("SELECT name FROM sqlite_master WHERE name='resident_life'").all().length,0);
});
test('real heartbeat starts one rule trip, records input and persists resident memory after arrival',async t=>{
 const {runtime,store,ledger}=boot(t);await runtime.heartbeat(now);
 const sunny=runtime.state().muses.find(m=>m.id==='01-sunny');assert.equal(sunny.travel?.to,'commons:garden');
 const depart=runtime.events().find(e=>e.kind==='depart'&&e.muse==='01-sunny');assert.equal(depart.source,'rule');
 const row=store.load(runtime.worldId);assert.equal(row.state.residents.length,1);assert.equal(row.state.residents[0].served,1);
 await runtime.heartbeat(Math.max(now+TICK_MS,sunny.travel.arriveAt+1));
 assert.ok(store.load(runtime.worldId).state.residents[0].memories.some(m=>m.publicSummary==='Committed arrive event'));
 assert.equal(ledger.status().liveCalls,0);
 const rec=runtime.runLog.inputs(runtime.runLog.current.runId).find(r=>r.input?.residentLife);
 assert.equal(rec.input.residentLife.source,'rule');
});
test('same runtime store reinitialization preserves snapshots and heartbeat retry is idempotent',async t=>{
 const {runtime,store,sql,ledger}=boot(t);await runtime.heartbeat(now);const before=store.load(runtime.worldId);
 const restart=new WorldRuntime(sql,{worldId:runtime.worldId,ledger,model:null,meetingGate:'off',residentLife:policy()});restart.init(now+1);
 assert.deepEqual(store.load(runtime.worldId),before);assert.equal((await restart.heartbeat(now+1)).status,'skipped_early');assert.deepEqual(store.load(runtime.worldId),before);
});
test('late personal ownership removes planned rule trip before commit',async t=>{
 let kind='resident';const p={...policy(),ownershipKind:id=>id==='01-sunny'?kind:'legacy'};
 const {runtime}=boot(t,{residentLife:p,beforeCommit:()=>{kind='personal';}});await runtime.heartbeat(now);
 assert.ok(!runtime.events().some(e=>e.kind==='depart'&&e.muse==='01-sunny'&&e.source==='rule'));
});
test('unknown and legacy identities never seed resident persistence',t=>{
 const {store,runtime}=boot(t,{residentLife:{...policy(),ownershipKind:()=> 'unknown'}});assert.equal(store.load(runtime.worldId).state.residents.length,0);
});
test('life write failure rolls world, ticks, events and memory back together',async t=>{
 const {runtime,db,store}=boot(t);const before=runtime.state(),life=store.load(runtime.worldId);
 db.exec("CREATE TRIGGER fail_life BEFORE UPDATE ON resident_life BEGIN SELECT RAISE(ABORT,'injected life failure'); END");
 await assert.rejects(runtime.heartbeat(now),/injected life failure/);assert.deepEqual(runtime.state(),before);assert.deepEqual(store.load(runtime.worldId),life);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ticks').get().n,0);assert.equal(runtime.events().length,0);
});

test('expired beat permits another routine trip after prior arrival, with a changed time slot',async t=>{
 const p=policy();p.allowedPlaceIds=['commons:garden','commons:bookshelf'];
 p.initialState.residents[0].routine=[{hour:0,place:'commons:garden'},{hour:13,place:'commons:bookshelf'}];
 const {runtime,sql}=boot(t,{residentLife:p});await runtime.heartbeat(now);
 let actor=runtime.state().muses[1];const arrived=Math.max(now+TICK_MS,actor.travel.arriveAt+1);await runtime.heartbeat(arrived);
 let s=runtime.state();assert.equal(s.muses[1].place,'commons:garden');assert.ok(s.muses[1].beat);
 // Advance to the later scheduled hour and rotate back without clearing the existing beat.
 s.spotlight.cursor=1;sql.exec('UPDATE world SET state = ?, version = ? WHERE id=1',JSON.stringify(s),s.version);
 await runtime.heartbeat(now+3_600_000);
 assert.equal(runtime.state().muses[1].travel?.to,'commons:bookshelf');
});
test('a delayed heartbeat honors a pending promise within bounded runtime grace, not a completion claim',async t=>{
 const p=policy();p.initialState=recordPromise(p.initialState,'01-sunny',{id:'p',other:'02-moss',place:'commons:garden',dueAt:now-30_000,status:'pending',evidenceId:'agreement'});
 const {runtime,store}=boot(t,{residentLife:p});await runtime.heartbeat(now);
 const record=runtime.runLog.inputs(runtime.runLog.current.runId).find(r=>r.input?.residentLife);
 assert.equal(record.input.residentLife.proposal.reason,'promise');assert.equal(store.load(runtime.worldId).state.residents[0].promises[0].status,'pending');
});
for(const table of ['world','events','run_inputs'])test('late '+table+' write failure rolls back earlier life revision and all commit rows',async t=>{
 const {runtime,db,store}=boot(t),before=runtime.state(),life=store.load(runtime.worldId);
 db.exec(`CREATE TRIGGER fail_late BEFORE ${table==='world'?'UPDATE':'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'late synthetic failure'); END`);
 await assert.rejects(runtime.heartbeat(now),/late synthetic failure/);
 assert.deepEqual(runtime.state(),before);assert.deepEqual(store.load(runtime.worldId),life);
 for(const name of ['ticks','events','run_inputs'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+name).get().n,0);
});
for(const source of ['live','replay'])test(source+' decision prevents an additional resident rule trip (synthetic decision seam)',async t=>{
 const {runtime,store}=boot(t);
 runtime.liveSpotlight=async()=>({decision:{muse:'01-sunny',freedom:'where',source,output:{decision:'stay',target_place:'',target_agent:'',offer_item:'',want_item:'',public_reason:'Synthetic',line:''}},info:{source}});
 await runtime.heartbeat(now);
 assert.ok(!runtime.events().some(e=>e.kind==='depart'&&e.muse==='01-sunny'&&e.source==='rule'));
 assert.equal(store.load(runtime.worldId).state.residents[0].served,0);
});
test('a world version change discards the pending routine rather than applying it late',async t=>{
 let ctx;ctx=boot(t,{beforeCommit:()=>{const s=ctx.runtime.state();s.version++;ctx.sql.exec('UPDATE world SET state=?,version=? WHERE id=1',JSON.stringify(s),s.version);}});
 await ctx.runtime.heartbeat(now);assert.ok(!ctx.runtime.events().some(e=>e.kind==='depart'&&e.muse==='01-sunny'&&e.source==='rule'));
});
test('incoming intent and queued visitor retain precedence over resident routine',async t=>{
 for(const mode of ['incoming','visitor']){
 const ctx=boot(t),s=ctx.runtime.state();if(mode==='incoming')s.muses[2].intent={kind:'greet',target:'01-sunny'};else s.spotlight.visitorQueue=['01-sunny'];
 ctx.sql.exec('UPDATE world SET state=?,version=? WHERE id=1',JSON.stringify(s),s.version);await ctx.runtime.heartbeat(now);
 assert.equal(ctx.store.load(ctx.runtime.worldId).state.residents[0].served,0);
 }
});

test('normal cursor rotation can honor a due promise after other residents and active beats',async t=>{
 const p=policy();p.allowedPlaceIds=['commons:garden','commons:bookshelf'];
 p.initialState=recordPromise(p.initialState,'01-sunny',{id:'rotating-promise',other:'06-ink',place:'commons:bookshelf',dueAt:now+2*TICK_MS,status:'pending',evidenceId:'agreement'});
 const {runtime,store}=boot(t,{residentLife:p});
 // No forced cursor reset: the real scheduler and completed beats arbitrate 40 minutes.
 for(let i=0;i<40;i++)await runtime.heartbeat(now+i*TICK_MS);
 const records=runtime.runLog.inputs(runtime.runLog.current.runId);
 assert.ok(records.some(r=>r.input?.residentLife?.proposal?.promiseId==='rotating-promise'));
 assert.ok(records.some(r=>!r.input?.residentLife&&r.input?.residentLifePolicy?.idle?.includes('01-sunny')),'hold policy is recorded even without a move');
 assert.ok(runtime.events().some(e=>e.kind==='depart'&&e.muse==='01-sunny'&&e.source==='rule'&&e.data?.to==='commons:bookshelf'));
 assert.equal(store.load(runtime.worldId).state.residents[0].promises[0].status,'pending');
});
