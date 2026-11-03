// Execute the complete production makeWorld function with real GLB geometry.
// Canvas drawing/image decode and HTTP are explicit Node fixtures, not browser/GPU acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const asset=await readFile(new URL('../world-packs/campfire/campfire-prototype.glb',import.meta.url));
const legacy=await readFile(new URL('../assets/muse_base.glb',import.meta.url));
async function fixture(t,fetchAsset){
 const file=new URL(`./.campfire-world-${randomUUID()}.mjs`,import.meta.url);
 const built=await build({entryPoints:[new URL('../src/scene.ts',import.meta.url).pathname],bundle:true,format:'esm',platform:'node',external:['three','three/*','maplibre-gl'],write:false});
 await writeFile(file,built.outputFiles[0].contents);
 const documentBefore=globalThis.document,fetchBefore=globalThis.fetch,loadBefore=GLTFLoader.prototype.loadAsync;
 globalThis.document={createElement(tag){assert.equal(tag,'canvas');return{width:0,height:0,getContext:()=>({clearRect(){},fillRect(){},fillText(){},createRadialGradient:()=>({addColorStop(){}})})};}};
 const parser=new GLTFLoader().register(()=>({name:'GeometryOnlyCharacterBoundary',loadTexture:async()=>null}));let legacyLoads=0;
 GLTFLoader.prototype.loadAsync=async function(url){assert.equal(url,'fixture:legacy-character');legacyLoads++;return parser.parseAsync(legacy.buffer.slice(legacy.byteOffset,legacy.byteOffset+legacy.byteLength),'');};
 globalThis.fetch=fetchAsset;
 t.after(async()=>{globalThis.document=documentBefore;globalThis.fetch=fetchBefore;GLTFLoader.prototype.loadAsync=loadBefore;await rm(file,{force:true});});
 return{makeWorld:(await import(file.href)).makeWorld,get legacyLoads(){return legacyLoads;}};
}
test('complete makeWorld default-OFF path retains original fire and never requests campfire bytes',async t=>{
 let requests=0;const f=await fixture(t,async()=>{requests++;throw Error('OFF must not fetch');});
 const world=await f.makeWorld('fixture:legacy-character',[],null,undefined,1);
 assert.equal(f.legacyLoads,1);assert.equal(world.muses.length,8);assert.ok(world.sourceHeight>0);
 assert.equal(world.scene.getObjectByName('Fire').visible,true);assert.equal(world.campfireVisual.getMetrics().enabled,false);world.ambient(1);assert.equal(requests,0);world.campfireVisual.dispose();
});
test('complete makeWorld starts before optional HTTP completes, then swaps only flames through all LODs',async t=>{
 let release,requests=0,distance=2;const started=new Promise(resolve=>{release=resolve;});let finish;
 const f=await fixture(t,async()=>{requests++;release();return new Promise(resolve=>{finish=resolve;});});
 const world=await f.makeWorld('fixture:legacy-character',[],null,undefined,1,{enabled:true,distanceM:()=>distance});
 await started;const fire=world.scene.getObjectByName('Fire'),commons=world.scene.getObjectByName('HQCommons'),staticIds=commons.children.map(m=>m.geometry.uuid);let originalDisposals=0;
 fire.traverse(m=>{if(m.isMesh)m.geometry.addEventListener('dispose',()=>originalDisposals++);});
 assert.equal(fire.visible,true);assert.equal(world.campfireVisual.getMetrics().pending,true,'the actual startup resolved while optional transport is pending');
 const ready=world.campfireVisual.enable({distanceM:()=>distance});finish(new Response(asset));assert.equal(await ready,true);assert.equal(requests,1);
 world.campfireVisual.setWorld({worldId:'fixture',tick:1,lastTickAt:1000,muses:[{id:'00-jolly',place:'commons:campfire',travel:null}]},1000);
 for(const [d,lod,visible]of [[2,'near',13],[50,'mid',5],[100,'far',1],[201,'hidden',0]]){
  distance=d;world.ambient(1);const next=world.scene.getObjectByName('campfire:commons:campfire'),meshes=[];next.traverseVisible(m=>{if(m.isMesh)meshes.push(m);});
  assert.equal(world.campfireVisual.getMetrics().frame.lod,lod);assert.equal(meshes.length,visible);assert.deepEqual(next.position.toArray(),[0,0,2]);
  assert.ok(meshes.every(m=>!/^seat_|^stone_|^log_|^coal_/.test(m.name)),'pack architecture never duplicates the authored scene');
 }
 assert.deepEqual(commons.children.map(m=>m.geometry.uuid),staticIds);world.campfireVisual.disable();assert.equal(fire.visible,true);assert.equal(originalDisposals,0);world.campfireVisual.dispose();
});
