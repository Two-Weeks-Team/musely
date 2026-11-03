import {readFileSync} from 'node:fs';
const asset=readFileSync(new URL('../world-packs/campfire/campfire-prototype.glb',import.meta.url));
globalThis.fetch=async()=>new Response(asset); // transport stub only; actual parser/scene/projection run
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {observeWorld} from '../src/ui/world-observation.ts';
import {makeLiveScene} from '../src/ui/live-scene.ts';
import {createCampfireScenePort} from '../world-packs/campfire/scene-port.mjs';
const at=1800000000000;
const snapshot=(version,place='commons:campfire',travel=null)=>({worldId:'test',day:'2026-11-03',tick:version,version,lastTickAt:at,muses:[{id:'00-jolly',place,travel,beat:null,inventory:[]}]});
function makeHost(){const scene=new T.Scene(),fire=new T.Group();fire.name='Fire';fire.position.set(0,.28,2);scene.add(fire);const campfireVisual=createCampfireScenePort(scene,fire);return {scene,fire,campfireVisual,actors:[],muses:[],shadows:[],selection:new T.Group(),library:null,shadowTexture:null,ambient:t=>campfireVisual.update(t*1000)};}
test('real makeLiveScene forwards only accepted projection to campfire and does not infer arrivals from events',async()=>{
 const host=makeHost(),live=makeLiveScene(host);await host.campfireVisual.enable({distanceM:()=>2});
 assert.equal(live.accept(snapshot(2),[]),true);assert.equal(live.accept(snapshot(1,'commons:cafe'),[]),false);
 live.setActive(true);live.update(at);assert.equal(host.campfireVisual.getMetrics().frame.attendees,1);
 live.accept(snapshot(3,'commons:cafe'),[{id:'invite',tick:3,at,kind:'campfire_invite',muse:'00-jolly',place:'commons:campfire'}]);live.update(at);assert.equal(host.campfireVisual.getMetrics().frame.attendees,0);
 live.accept(snapshot(4,'commons:campfire',{to:'commons:cafe',departAt:at,arriveAt:at+10000,speed:'walk'}),[]);live.update(at);assert.equal(host.campfireVisual.getMetrics().frame.attendees,0);
 live.setActive(false);host.ambient(at/1000);assert.equal(host.campfireVisual.getMetrics().frame.attendees,0);live.dispose();assert.equal(host.fire.visible,true);host.campfireVisual.dispose();
});
test('live controller disposal disables visual but allows same-world controller recreation',async()=>{
 const host=makeHost(),first=makeLiveScene(host);await host.campfireVisual.enable({distanceM:()=>2});first.dispose();
 assert.equal(host.campfireVisual.getMetrics().disposed,false);const second=makeLiveScene(host);await host.campfireVisual.enable({distanceM:()=>2});second.accept(snapshot(1),[]);second.setActive(true);second.update(at);first.dispose();assert.equal(host.campfireVisual.getMetrics().enabled,true);assert.equal(host.campfireVisual.getMetrics().frame.attendees,1);second.dispose();host.campfireVisual.dispose();
});

test('healthy unchanged HTTP snapshots stay fresh across minute ticks, while cached failed polls do not renew evidence',async()=>{
 let received=at+70_000;const host=makeHost(),live=makeLiveScene(host),oldTick=snapshot(1);
 await host.campfireVisual.enable({distanceM:()=>2});live.setActive(true);
 live.accept(oldTick,[],at+70_000);live.update(received);assert.equal(host.campfireVisual.getMetrics().frame.attendees,1,'successful HTTP read is fresh even when lastTickAt is old');
 for(const delta of [20_000,40_000,60_001]){received=at+70_000+delta;live.accept(oldTick,[],at+70_000);live.update(received);}
 assert.equal(host.campfireVisual.getMetrics().frame.attendees,0,'cached callback after failed transport must not renew the TTL');
 live.accept(structuredClone(oldTick),[],received);live.update(received);assert.equal(host.campfireVisual.getMetrics().frame.attendees,1,'new successful read of unchanged state renews observation');
 received+=60_001;assert.equal(live.accept(snapshot(0),[],received),false);live.update(received);assert.equal(host.campfireVisual.getMetrics().frame.attendees,0,'rejected stale response cannot renew evidence');
 live.dispose();host.campfireVisual.dispose();
});
test('returning from replay while live is empty clears recorded attendance, sparks and selection',async()=>{
 const host=makeHost(),live=makeLiveScene(host);await host.campfireVisual.enable({distanceM:()=>2});live.setActive(true);
 live.setRecordedFrame({worldId:'test',runId:'recorded',snapshotHash:'recorded',recordedAt:at+90_000,snapshotAt:at,inputs:[],events:[],publicState:snapshot(1)});
 live.update(at+90_000);assert.equal(host.campfireVisual.getMetrics().frame.attendees,1,'recorded projection uses its own observation clock');
 live.setRecordedFrame(null);live.update(at+1_000_000);assert.equal(host.campfireVisual.getMetrics().frame.attendees,0);assert.equal(host.scene.getObjectByName('spark_0').visible,false);assert.equal(host.selection.visible,false);assert.equal(live.frames.size,0);
 live.dispose();host.campfireVisual.dispose();
});
test('replay observation never renews an expired live snapshot and old controllers cannot clear a new owner',async()=>{
 let received=at;const host=makeHost(),old=makeLiveScene(host);old.dispose();
 const live=makeLiveScene(host);await host.campfireVisual.enable({distanceM:()=>2});live.accept(snapshot(1),[]);live.setActive(true);live.update(at);
 old.setActive(false);host.ambient(at/1000);assert.equal(host.campfireVisual.getMetrics().frame.attendees,1);
 live.setRecordedFrame({worldId:'recorded',runId:'recorded',snapshotHash:'recorded',recordedAt:at+120_000,snapshotAt:at,inputs:[],events:[],publicState:snapshot(1)});live.update(at+120_000);assert.equal(host.campfireVisual.getMetrics().frame.attendees,1);
 live.setRecordedFrame(null);live.update(at+120_000);assert.equal(host.campfireVisual.getMetrics().frame.attendees,0);
 live.dispose();host.campfireVisual.dispose();
});

test('transport receipts survive paused or delayed startup hand-offs without making a cached offline world fresh',async()=>{
 const w=snapshot(1),success={ok:true,data:w,at:at+10_000};let observation=observeWorld(null,success);
 assert.equal(observation.observedAt,success.at);
 // Successful fetch while paused; no renderer callback occurs until much later. A failed refresh then emits the cache.
 observation=observeWorld(observation,{ok:false,error:'Network error',at:at+90_000});
 assert.equal(observation.observedAt,success.at);assert.equal(observation.world,w);
 const host=makeHost(),live=makeLiveScene(host);await host.campfireVisual.enable({distanceM:()=>2});live.setActive(true);
 live.accept(observation.world,[],observation.observedAt);live.update(at+90_000);assert.equal(host.campfireVisual.getMetrics().frame.attendees,0);
 const stale=observeWorld(observation,{ok:true,data:snapshot(0),at:at+90_001});assert.equal(stale,observation);
 const invalid=observeWorld(observation,{ok:true,data:snapshot(2),at:NaN});assert.equal(invalid,observation);
 observation=observeWorld(observation,{ok:true,data:structuredClone(w),at:at+90_002});live.accept(observation.world,[],observation.observedAt);live.update(at+90_002);assert.equal(host.campfireVisual.getMetrics().frame.attendees,1);
 live.dispose();host.campfireVisual.dispose();
});

test('optional campfire disposal failure cannot strand live scene effects',async()=>{
 const host=makeHost(),live=makeLiveScene(host);await host.campfireVisual.enable({distanceM:()=>2});
 host.scene.getObjectByName('campfire:commons:campfire').getObjectByName('bright_core').geometry.addEventListener('dispose',()=>{throw Error('cleanup failed');});
 assert.ok(host.scene.children.some(m=>m.name.startsWith('LiveEffect_')));
 assert.throws(()=>live.dispose(),AggregateError);assert.equal(host.fire.visible,true);assert.equal(host.scene.children.some(m=>m.name.startsWith('LiveEffect_')),false);
 live.dispose();host.campfireVisual.dispose();
});
