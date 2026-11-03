// Local SQLite + actual registry/runtime. No network/auth service or real user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Ledger} from '../worker/core/ledger.ts';
import {PersonalOwners,createOwnershipAdapter} from '../worker/core/personal-owners.ts';
import {ResidentLifeStore} from '../worker/core/resident-life-adapter.ts';
import {createLife} from '../src/engine/resident-life.ts';
import {TICK_MS} from '../src/engine/world.ts';
import {publicState} from '../worker/core/run-log.ts';
import {loadRun} from '../src/replay/player.ts';
let calls=0;globalThis.fetch=async()=>{calls++;throw Error('network prohibited in resident integration');};
const NOW=Date.parse('2026-11-03T20:00:00Z');
function sqlFor(db){let depth=0;return {exec(q,...b){const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return {toArray:()=>rows};},transactionSync(fn){const sp='life_tx_'+depth++;db.exec('SAVEPOINT '+sp);try{const r=fn();assert.ok(!r?.then);db.exec('RELEASE '+sp);return r;}catch(e){db.exec('ROLLBACK TO '+sp);db.exec('RELEASE '+sp);throw e;}finally{depth--;}}};}
function boot(t,file=':memory:',extra={}){const db=new DatabaseSync(file);t.after(()=>db.close());const sql=sqlFor(db),owners=new PersonalOwners({sql,transactionSync:sql.transactionSync});owners.init();const ownership=createOwnershipAdapter(owners),ledger=new Ledger(sql,{dailyCapUsd:0});ledger.init();
 const initialState=createLife([{id:'r',defaultGoal:'SYNTHETIC-LIFE-NOT-IN-PUBLIC-LOG',home:'commons:garden'}],[{id:'01-sunny',roleId:'r'},{id:'00-jolly',roleId:'r'},{id:'04-ember',roleId:'r'},{id:'09-copper',roleId:'r'},{id:'unknown-fixture',roleId:'r'}]);
 const policy={enabled:true,initialState,allowedPlaceIds:['commons:garden'],ownershipKind:id=>ownership.resolve(id).kind};
 const runtime=new WorldRuntime(sql,{worldId:'resident-integration',ledger,model:null,meetingGate:'off',residentLife:policy,...extra});runtime.init(NOW);
 return {db,sql,owners,ownership,ledger,runtime,policy,store:new ResidentLifeStore(sql)};
}
function selectSunny(ctx,at=NOW){ctx.runtime.commitExternal(at,'fixture-select-sunny',s=>{s.spotlight.cursor=1;});}
function record(runtime){const run=runtime.runLog.current,inputs=runtime.runLog.inputs(run.runId,0,1000),events=runtime.events(0,20_000,{runId:run.runId});return {...run,inputs,events,readThrough:{inputSeq:inputs.at(-1)?.seq??0,eventSeq:events.at(-1)?.seq??0,inputs:inputs.length,events:events.length}};}
test('real registry excludes all legacy owners and unknown actor IDs from persisted resident policy',t=>{const c=boot(t);assert.deepEqual(c.store.load(c.runtime.worldId).state.residents.map(r=>r.id),['01-sunny']);for(const id of ['00-jolly','04-ember','09-copper'])assert.equal(c.ownership.resolve(id).kind,'legacy');assert.equal(c.ownership.resolve('unknown-fixture').kind,'unknown');});
test('two actual runtime instances on separate SQLite connections commit one tick and one life revision',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'life-two-runtime-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'world.sqlite'),a=boot(t,path),b=boot(t,path);selectSunny(a);
 const results=await Promise.all([a.runtime.heartbeat(NOW),b.runtime.heartbeat(NOW)]);
 assert.deepEqual(results.map(r=>r.status).sort(),['committed','skipped_duplicate']);assert.equal(a.runtime.state().tick,1);assert.equal(a.store.load(a.runtime.worldId).revision,1);
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM ticks').get().n,1);const events=a.runtime.events(0,20_000);assert.equal(new Set(events.map(e=>e.id)).size,events.length);assert.equal(a.ledger.status().liveCalls,0);
});
test('independent life revision change during await rejects stale movement but preserves new state',async t=>{
 let c;c=boot(t,':memory:',{beforeCommit:()=>{const row=c.store.load(c.runtime.worldId);row.state.residents[0].goal='newer local edit';c.store.save(c.runtime.worldId,row.revision,row.state);}});selectSunny(c);await c.runtime.heartbeat(NOW);
 assert.ok(!c.runtime.events().some(e=>e.kind==='depart'&&e.muse==='01-sunny'&&e.source==='rule'));assert.equal(c.store.load(c.runtime.worldId).state.residents[0].goal,'newer local edit');
});
test('unsupported dynamic personal world entry fails closed with complete heartbeat rollback',async t=>{
 const c=boot(t),principal=c.owners.ensurePrincipal({provider:'fixture',subject:'synthetic-subject'},NOW),actor=c.owners.registerDraft(principal.id,{operationId:'fixture-op',displayName:'Synthetic personal actor',appearanceId:'01-sunny',agentId:'fixture-agent',rootRef:'root_ref:fixture'},NOW);
 c.runtime.commitExternal(NOW,'fixture-personal-entry',s=>{const clone=structuredClone(s.muses[1]);clone.id=actor.actorId;clone.controlMode='personal';clone.travel=null;clone.beat=null;clone.intent=null;s.muses.push(clone);s.spotlight.cursor=s.muses.length-1;s.inbox.connected[actor.actorId]=NOW;});
 const worldBefore=c.runtime.state(),lifeBefore=c.store.load(c.runtime.worldId),eventsBefore=c.runtime.events(0,20_000);
 await assert.rejects(c.runtime.heartbeat(NOW+86_400_000),/Unknown Muse harness/);
 assert.deepEqual(c.runtime.state(),worldBefore);assert.deepEqual(c.store.load(c.runtime.worldId),lifeBefore);assert.deepEqual(c.runtime.events(0,20_000),eventsBefore);
 const before=worldBefore.muses.at(-1),after=c.runtime.state().muses.find(m=>m.id===actor.actorId);
 assert.equal(c.ownership.resolve(actor.actorId).kind,'personal');assert.equal(after.place,before.place);assert.equal(after.travel,null);assert.equal(after.beat,null);assert.ok(!c.store.load(c.runtime.worldId).state.residents.some(r=>r.id===actor.actorId));
 assert.ok(!c.runtime.events(0,20_000).some(e=>e.muse===actor.actorId&&['depart','beat'].includes(e.kind)));
});
test('actual committed routine and idle-hold run replays every stored checkpoint without mutation or execution',async t=>{
 const c=boot(t);selectSunny(c,NOW+1);for(let i=0;i<25;i++)await c.runtime.heartbeat(NOW+1+i*TICK_MS);
 const captured=record(c.runtime),before=structuredClone(captured),life=c.store.load(c.runtime.worldId),world=c.runtime.state();
 assert.ok(captured.inputs.some(i=>i.input?.residentLifePolicy?.idle?.includes('01-sunny')));assert.ok(captured.events.some(e=>e.kind==='depart'&&e.source==='rule'&&e.muse==='01-sunny'));
 assert.ok(!JSON.stringify(captured).includes('SYNTHETIC-LIFE-NOT-IN-PUBLIC-LOG'));
 for(const speed of [1,10,60]){const player=loadRun(captured);player.setSpeed(speed);player.seek(Number.MAX_SAFE_INTEGER);assert.deepEqual(player.getFrame().publicState,publicState(world));assert.equal(player.getFrame().snapshotHash,captured.inputs.at(-1).afterHash);
 player.seek(0);assert.deepEqual(player.getFrame().publicState,JSON.parse(captured.initialSnapshot.body));}
 assert.deepEqual(captured,before);assert.deepEqual(c.store.load(c.runtime.worldId),life);assert.deepEqual(c.runtime.state(),world);assert.equal(calls,0);
});
test.after(()=>assert.equal(calls,0,'no network call attempted'));
