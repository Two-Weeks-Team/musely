import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createCampfireScenePort} from './scene-port.mjs';
const bytes=readFileSync(new URL('./campfire-prototype.glb',import.meta.url));
const load=()=>new Promise((resolve,reject)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',g=>resolve(g.scene),reject));
function host(){const scene=new T.Scene(),fire=new T.Group();fire.name='Fire';fire.position.set(0,.28,2);scene.add(fire);return {scene,fire};}
const world={worldId:'real',tick:1,version:1,lastTickAt:1000,muses:[{id:'present',place:'commons:campfire',travel:null},{id:'departing',place:'commons:campfire',travel:{to:'elsewhere'}},{id:'invited',place:'commons:cafe',travel:null}]};
test('default OFF does not load or replace existing fire',()=>{const {scene,fire}=host();let loads=0;const p=createCampfireScenePort(scene,fire,{loadAsset:async()=>{loads++;return load();}});p.setWorld(world);p.update(1000);assert.equal(loads,0);assert.equal(scene.children.length,1);assert.equal(fire.visible,true);p.dispose();});
test('enable swaps only flame layer; disable restores legacy, snapshot filters travel',async()=>{const {scene,fire}=host();let loads=0;const p=createCampfireScenePort(scene,fire,{loadAsset:async()=>{loads++;return load();}});await p.enable({distanceM:()=>2});await p.enable({distanceM:()=>2});assert.equal(loads,1);assert.equal(fire.visible,false);const next=scene.children[1];assert.deepEqual(next.position.toArray(),[0,0,2]);p.setWorld(world);p.update(1000);assert.equal(p.getMetrics().frame.attendees,1);assert.equal(next.getObjectByName('seat_0').visible,false);assert.equal(next.getObjectByName('spark_0').visible,true);p.setWorld(null);p.update(1000);assert.equal(p.getMetrics().frame.attendees,0);assert.equal(next.getObjectByName('spark_0').visible,false);p.disable();assert.equal(scene.children.length,1);assert.equal(fire.visible,true);p.dispose();p.dispose();});
test('stale snapshots and missing camera fail closed',async()=>{const {scene,fire}=host();const p=createCampfireScenePort(scene,fire,{loadAsset:load});await assert.rejects(p.enable(),/distanceM/);await p.enable({distanceM:()=>{throw Error('camera unavailable')}});p.setWorld(world);p.update(62000);assert.equal(p.getMetrics().frame.attendees,0);assert.equal(p.getMetrics().frame.lod,'hidden');p.dispose();});
test('disable during load cannot resurrect replacement and source is disposed',async()=>{const {scene,fire}=host();let release;const source=await load();let disposed=0;source.getObjectByName('bright_core').geometry.addEventListener('dispose',()=>disposed++);const p=createCampfireScenePort(scene,fire,{loadAsset:()=>new Promise(r=>release=r)});const pending=p.enable({distanceM:()=>1});p.disable();release(source);assert.equal(await pending,false);assert.equal(disposed,1);assert.equal(scene.children.length,1);assert.equal(fire.visible,true);p.dispose();});
test('failed asset loading retains original fire and permits retry',async()=>{const {scene,fire}=host();let attempt=0;const p=createCampfireScenePort(scene,fire,{loadAsset:async()=>{if(!attempt++)throw Error('asset unavailable');return load();}});await assert.rejects(p.enable({distanceM:()=>1}),/asset unavailable/);assert.equal(fire.visible,true);await p.enable({distanceM:()=>1});assert.equal(fire.visible,false);p.dispose();assert.equal(fire.visible,true);await assert.rejects(p.enable({distanceM:()=>1}),/disposed/);});
test('only one port may own a scene, legacy resources are not disposed',()=>{const {scene,fire}=host();const geo=new T.BoxGeometry(),mat=new T.MeshBasicMaterial();let frees=0;geo.addEventListener('dispose',()=>frees++);fire.add(new T.Mesh(geo,mat));const p=createCampfireScenePort(scene,fire);assert.throws(()=>createCampfireScenePort(scene,fire),/already attached/);p.dispose();assert.equal(frees,0);createCampfireScenePort(scene,fire).dispose();geo.dispose();mat.dispose();});
test('disposed port cannot change newer owner with deferred verified asset',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response(bytes);try{const {scene,fire}=host();const old=createCampfireScenePort(scene,fire);old.dispose();const p=createCampfireScenePort(scene,fire);await p.enable({distanceM:()=>1});old.disable();assert.equal(fire.visible,false);p.dispose();}finally{globalThis.fetch=original;}});

test('default OFF makes no fetch; enable fetches only pinned asset and rejects corrupt response',async()=>{
 const old=globalThis.fetch;let requests=0;globalThis.fetch=async url=>{requests++;assert.match(url,/^\/assets\/campfire\.[a-f0-9]{64}\.glb$/);const corrupt=Buffer.from(bytes);corrupt[100]^=1;return new Response(corrupt);};
 try {const {scene,fire}=host();const p=createCampfireScenePort(scene,fire);p.update(1000);assert.equal(requests,0);await assert.rejects(p.enable({distanceM:()=>1}),/integrity/);assert.equal(requests,1);assert.equal(fire.visible,true);p.dispose();}finally{globalThis.fetch=old;}
});
test('deferred request has a bounded abort signal and HTTP failure preserves old fire',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.ok(options.signal instanceof AbortSignal);return new Response('',{status:503});};
 try {const {scene,fire}=host();const p=createCampfireScenePort(scene,fire);await assert.rejects(p.enable({distanceM:()=>1}),/unavailable/);assert.equal(fire.visible,true);assert.equal(p.getMetrics().pending,false);p.dispose();}finally{globalThis.fetch=old;}
});

test('synchronous loader failure clears pending and retries without a manual disable',async()=>{
 const {scene,fire}=host();let attempts=0;
 const p=createCampfireScenePort(scene,fire,{loadAsset:()=>{if(!attempts++)throw Error('sync loader failure');return load();}});
 await assert.rejects(p.enable({distanceM:()=>2}),/sync loader failure/);
 assert.equal(p.getMetrics().pending,false);assert.equal(fire.visible,true);
 assert.equal(await p.enable({distanceM:()=>2}),true);assert.equal(attempts,2);p.dispose();
});
test('throwing owned cleanup still restores legacy fire, clears ownership and permits retry',async()=>{
 const {scene,fire}=host(),p=createCampfireScenePort(scene,fire,{loadAsset:load});await p.enable({distanceM:()=>2});
 scene.getObjectByName('campfire:commons:campfire').getObjectByName('bright_core').geometry.addEventListener('dispose',()=>{throw Error('cleanup failed');});
 assert.throws(()=>p.disable(),AggregateError);assert.equal(p.getMetrics().enabled,false);assert.equal(fire.visible,true);assert.equal(scene.children.length,1);
 await p.enable({distanceM:()=>2});assert.equal(fire.visible,false);p.dispose();assert.equal(fire.visible,true);
});
test('port disposal releases its scene owner even when a GPU resource cleanup callback throws',async()=>{
 const {scene,fire}=host(),p=createCampfireScenePort(scene,fire,{loadAsset:load});await p.enable({distanceM:()=>2});
 scene.getObjectByName('campfire:commons:campfire').getObjectByName('bright_core').geometry.addEventListener('dispose',()=>{throw Error('cleanup failed');});
 assert.throws(()=>p.dispose(),AggregateError);assert.equal(p.getMetrics().disposed,true);assert.equal(fire.visible,true);createCampfireScenePort(scene,fire).dispose();
});
