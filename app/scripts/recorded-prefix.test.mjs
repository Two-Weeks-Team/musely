import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {loadRun} from '../src/replay/player.ts';
import {SceneProjection} from '../src/ui/recorded-scene.ts';
const T0=Date.parse('2026-11-02T12:00:00Z');
function fixture(){const db=new DatabaseSync(':memory:');let depth=0;const sql={exec(q,...b){const s=db.prepare(q);if(/^\s*(select|with|explain)/i.test(q))return{toArray:()=>s.all(...b)};s.run(...b);return{toArray:()=>[]};},transactionSync(fn){const n='t'+depth++;db.exec('SAVEPOINT '+n);try{const r=fn();db.exec('RELEASE '+n);return r;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}}};
 const rt=new WorldRuntime(sql,{worldId:'w',model:null,meetingGate:'off',publicationNow:()=>T0+1000});rt.init(T0);
 rt.commitRefusal(T0+1000,'blocked','blocked-key',(_s,emit)=>emit({at:T0+1000,source:'live',kind:'injection_blocked',muse:'00-jolly',other:null,line:null,data:{direction:'outgoing'},tags:['injection_blocked']}));
 const r=rt.runLog.current;return{db,rt,record:{...r,readThrough:rt.runLog.boundary(r.runId),inputs:rt.runLog.inputs(r.runId),events:rt.events(0,100,{runId:r.runId})}};}
test('review recorded event-only commits update 3D even when the public checkpoint hash stays identical',()=>{
 const {db,record}=fixture();try{assert.equal(record.inputs[0].beforeHash,record.inputs[0].afterHash);const p=loadRun(record),scene=new SceneProjection();scene.setRecordedFrame(p.getFrame());p.seek(13.5);const next=p.getFrame();assert.equal(next.events.length,1);scene.setRecordedFrame(next);const f=scene.projection.frames(next.recordedAt).get('00-jolly');console.log(JSON.stringify({sameHash:record.initialSnapshot.hash===next.snapshotHash,playerEvents:next.events.length,sceneEvents:scene.projection.events.length,clip:f.clip}));assert.equal(f.clip,'head_shake','the actual recorded block must animate after crossing its commit');p.seek(0);scene.setRecordedFrame(p.getFrame());assert.equal(scene.projection.events.length,0,'backward seek removes the later event prefix even at the same hash');assert.equal(scene.projection.frames(p.getFrame().recordedAt).get('00-jolly').clip,'idle_breathe');p.seek(13.5);scene.setRecordedFrame(p.getFrame());assert.equal(scene.projection.frames(p.getFrame().recordedAt).get('00-jolly').clip,'head_shake');}finally{db.close();}
});

test('recorded pause state follows the public world map like WorldRuntime.view, then clears on reverse seek',()=>{
 const {db,rt}=fixture();try{
  const pause={at:T0+2000,version:1,by:'fixture-owner'};
  rt.commitExternal(T0+2000,'fixture-pause',st=>{st.paused={'00-jolly':pause};st.muses[0].travel=null;st.muses[0].beat=null;});
  const head=rt.runLog.current,record={...head,readThrough:rt.runLog.boundary(head.runId),inputs:rt.runLog.inputs(head.runId),events:rt.events(0,100,{runId:head.runId})},p=loadRun(record),scene=new SceneProjection();
  p.seek(2);const frame=p.getFrame(),unchanged=JSON.stringify(frame);assert.deepEqual(frame.publicState.paused['00-jolly'],pause);assert.equal(Object.hasOwn(frame.publicState.muses[0],'paused'),false);
  scene.setRecordedFrame(frame);assert.deepEqual(scene.projection.world.muses[0].paused,rt.view(T0+2000).muses[0].paused);assert.match(scene.projection.frames(frame.recordedAt).get('00-jolly').status,/paused \(delegation revoked\)/);assert.equal(scene.projection.world.muses[1].paused,null);assert.equal(JSON.stringify(frame),unchanged);
  p.seek(0);scene.setRecordedFrame(p.getFrame());assert.equal(scene.projection.world.muses[0].paused,null);assert.doesNotMatch(scene.projection.frames(p.getFrame().recordedAt).get('00-jolly').status,/paused/);
 }finally{db.close();}
});
