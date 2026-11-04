import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createCampfireView} from './renderer.mjs';
const bytes=readFileSync(new URL('./campfire-prototype.glb',import.meta.url));
const load=()=>new Promise((resolve,reject)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',resolve,reject));
test('actual GLB imports in Three.js with flame, seating and sparks',async()=>{
 const gltf=await load();assert.ok(gltf.scene.getObjectByName('bright_core'));assert.ok(gltf.scene.getObjectByName('seat_3'));assert.equal(gltf.animations.length,5);
});
test('LOD and arrival visual binding execute against actual asset',async()=>{
 const {scene}=await load();const v=createCampfireView(scene,'commons:campfire');v.update(2,1000);
 assert.equal(v.group.userData.arrivedCount,0);assert.equal(v.group.getObjectByName('spark_0').visible,false);
 const s={placeId:'commons:campfire',observedAt:1000,receiptId:'world:arrival1',arrivedMuseIds:['one']};
 v.update(2,1000,s);assert.equal(v.group.getObjectByName('spark_0').visible,true);v.update(100,1000,s);assert.equal(v.group.children[0].visible,false);assert.equal(v.group.children[1].visible,true);
 v.update(201,1000,s);assert.equal(v.group.visible,false);v.dispose();
});
test('isolated instances never mutate or dispose source/shared resources',async()=>{
 const {scene}=await load();const original=scene.getObjectByName('bright_core');let sourceDisposals=0;original.geometry.addEventListener('dispose',()=>sourceDisposals++);
 const scale=original.scale.clone();const a=createCampfireView(scene,'a'),b=createCampfireView(scene,'b');const mesh=a.group.getObjectByName('bright_core');let ownDisposals=0;mesh.geometry.addEventListener('dispose',()=>ownDisposals++);
 assert.notEqual(mesh.geometry,original.geometry);assert.notEqual(mesh.material,original.material);
 a.update(1,3000);a.dispose();a.dispose();a.update(1,4000);
 assert.deepEqual(original.scale,scale);assert.equal(sourceDisposals,0);assert.equal(ownDisposals,1);assert.equal(a.group.children.length,0);assert.ok(b.group.children.length);b.dispose();
});
test('empty place cannot allocate a live controller',()=>{assert.throws(()=>createCampfireView(new THREE.Group(),''),/placeId/);});

test('construction is hidden without distance or arrival evidence',async()=>{
 const {scene}=await load();const v=createCampfireView(scene,'test');
 assert.equal(v.group.visible,false);assert.equal(v.frame.lod,'hidden');
 assert.equal(v.group.getObjectByName('spark_0').visible,false);
 assert.equal(v.group.userData.arrivedCount,0);v.dispose();
});
