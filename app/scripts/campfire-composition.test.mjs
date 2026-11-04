import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import * as T from 'three';
import {serveCriticalAsset} from '../worker/asset-encoding.ts';
import {createCampfireScenePort} from '../world-packs/campfire/scene-port.mjs';
import descriptor from '../world-packs/campfire/asset.json' with {type:'json'};
const bytes=await readFile(new URL('../world-packs/campfire/campfire-prototype.glb',import.meta.url));
test('PR146 routing preserves exact campfire URL/decoded SHA; OFF no request, ON one, disable restores',async()=>{
 const saved=globalThis.fetch;let calls=0;const scene=new T.Scene(),fire=new T.Group();fire.name='Fire';scene.add(fire);const port=createCampfireScenePort(scene,fire);
 globalThis.fetch=async path=>{const req=new Request('https://musely.net'+path,{headers:{'accept-encoding':'br,gzip'}});return serveCriticalAsset(req,{async fetch(actual){calls++;assert.equal(actual,req);assert.equal(new URL(actual.url).pathname,descriptor.url);return new Response(bytes);}});};
 try{port.update(1000);assert.equal(calls,0);await port.enable({distanceM:()=>2});assert.equal(calls,1);assert.equal(fire.visible,false);assert.equal(createHash('sha256').update(bytes).digest('hex'),descriptor.sha256);port.disable();assert.equal(fire.visible,true);}finally{port.dispose();globalThis.fetch=saved;}
});
test('PR146 upstream503 and corrupt body leave legacy campfire usable',async()=>{
 const saved=globalThis.fetch;try{for(const status of [503,200]){const scene=new T.Scene(),fire=new T.Group();fire.name='Fire';scene.add(fire);const port=createCampfireScenePort(scene,fire);const corrupt=Buffer.from(bytes);corrupt[100]^=1;
 globalThis.fetch=async path=>serveCriticalAsset(new Request('https://musely.net'+path,{headers:{'accept-encoding':'br'}}),{fetch:async()=>new Response(corrupt,{status})});
 await assert.rejects(port.enable({distanceM:()=>2}),status===503?/unavailable/:/integrity/);assert.equal(fire.visible,true);assert.equal(port.getMetrics().pending,false);port.dispose();}}finally{globalThis.fetch=saved;}
});
