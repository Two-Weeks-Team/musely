import {readFileSync} from 'node:fs';
const asset=readFileSync(new URL('../world-packs/campfire/campfire-prototype.glb',import.meta.url));
globalThis.fetch=async()=>new Response(asset); // transport stub only; actual parser/scene/projection run
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
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
