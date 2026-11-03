// Independent CPU geometry regression: actual scene.ts primitives + actual checked-in LOD2 bind pose.
// Not a GPU capture, animated full-kit clearance proof, native tile collision test or travel navmesh test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {COMMONS_SLOTS,slotAt,liveFrames,scheduleCues,CUE_DELAY_MS,museLngLat,sceneToLngLat} from '../src/ui/live-scene-core.ts';
import {commonsCandidates,clearsCommons,clearsContactMove,PRESENTATION_RADIUS,SLOT_SPACING} from '../src/ui/commons-clearance.ts';
import {MUSE_VARIANTS} from '../src/character-kit/catalog.ts';
import {RESIDENT_INSTANCES} from '../src/engine/resident-catalog.ts';
import {surfaceHeightAt} from '../src/surfaces.ts';
const NOW=1_800_000_000_000;
const places=Object.keys(COMMONS_SLOTS), legacyIds=new Set(MUSE_VARIANTS.map(v=>v.id));
const muse=(id,place='commons:campfire',extra={})=>({id,place,travel:null,beat:null,inventory:[],...extra});
const residents=place=>RESIDENT_INSTANCES.map(r=>muse(r.id,place??r.home));
const personal=(i,place)=>muse(`pm_${String(i).padStart(2,'0')}`,place,{profile:{actorId:`pm_${String(i).padStart(2,'0')}`,displayName:`Visitor ${i}`,appearanceId:'00-jolly',revision:1}});
const world=muses=>({worldId:'clearance',day:'2026-11-03',tick:1,lastTickAt:NOW,muses});
// Execute the actual authored geometry before the DOM/text/character loader. Capture each original primitive,
// retaining its real rounded-box/sphere/cylinder vertices and transform instead of recreating test furniture.
function actualPrimitives(){
 const src=readFileSync(new URL('../src/scene.ts',import.meta.url),'utf8');
 const start=src.indexOf(' const scene=new T.Scene()'),end=src.indexOf(' // Local hand-lettered wayfinding',start);
 assert.ok(start>=0&&end>start,'scene geometry extraction must track the actual authoring boundary');
 const body=src.slice(start,end).replace('o.updateMatrix();','o.updateMatrix();captured.push(o);');
 const code=transformSync(body,{loader:'ts',target:'es2022'}).code;
 return new Function('T','RoundedBoxGeometry','mergeGeometries',`const captured=[];${code};return captured;`)(T,RoundedBoxGeometry,mergeGeometries).map(o=>{
  o.updateMatrixWorld(true);const g=o.geometry,p=g.attributes.position,vertices=[];
  for(let i=0;i<p.count;i++)vertices.push(new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));
  const bounds=new T.Box3().setFromPoints(vertices),triangles=[],idx=g.index;
  for(let i=0;i<(idx?.count??p.count);i+=3)triangles.push([0,1,2].map(k=>vertices[idx?idx.getX(i+k):i+k]));
  return{bounds,triangles};
 });
}
const primitives=actualPrimitives();
function segmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,d=dx*dx+dz*dz,t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/d)):0;return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);}
function triangleDistance(p,[a,b,c]){
 const cross=(u,v,w)=>(v.x-u.x)*(w.z-u.z)-(v.z-u.z)*(w.x-u.x);
 const area=cross(a,b,c),signs=[cross(a,b,p),cross(b,c,p),cross(c,a,p)];
 if(Math.abs(area)>1e-9&&(signs.every(n=>n>=0)||signs.every(n=>n<=0)))return 0;
 return Math.min(segmentDistance(p,a,b),segmentDistance(p,b,c),segmentDistance(p,c,a));
}
function actualClearance(p){
 const floor=surfaceHeightAt(p.x,p.z)+.006,top=floor+.95;let distance=Infinity;
 for(const {bounds:b,triangles}of primitives){
  // The approach/paving and reading platform are authored walkable surfaces, not walls.
  if(b.max.y<=.075||(Math.abs(b.max.y-.23)<1e-5&&Math.abs(b.min.y-.01)<1e-5))continue;
  if(b.max.y<floor||b.min.y>top||p.x<b.min.x-.6||p.x>b.max.x+.6||p.z<b.min.z-.6||p.z>b.max.z+.6)continue;
  for(const tri of triangles){if(Math.max(...tri.map(v=>v.y))<floor||Math.min(...tri.map(v=>v.y))>top)continue;distance=Math.min(distance,triangleDistance(p,tri));}
 }
 return distance;
}
test('the real LOD2 bind-pose radius fits the existing .45 m actor bounds plus clearance',async()=>{
 const bytes=readFileSync(new URL('../character-kit/runtime/base/lod2.glb',import.meta.url));assert.ok(bytes.length>400_000);
 const g=await new GLTFLoader().register(()=>({name:'GeometryOnlyAudit',loadTexture:async()=>null})).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 g.scene.updateMatrixWorld(true);let radius=0,count=0;const v=new T.Vector3();g.scene.traverse(m=>{if(m.isSkinnedMesh){m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i++){m.getVertexPosition(i,v).applyMatrix4(m.matrixWorld);radius=Math.max(radius,Math.hypot(v.x,v.z));count++;}}});
 assert.ok(count>1000);assert.ok(radius<.45,`actual bind pose ${radius}`);assert.ok(PRESENTATION_RADIUS>=.5);
});
test('every overflow candidate clears the actual scene.ts geometry by the actor radius',()=>{
 const candidates=commonsCandidates(Object.values(COMMONS_SLOTS).flat());assert.ok(candidates.length>=64);
 for(const p of candidates)assert.ok(actualClearance(p)>=PRESENTATION_RADIUS-1e-6,`actual scene collision at ${JSON.stringify(p)}: ${actualClearance(p)}`);
});
test('the old south-bench and garden-hedge overflow collisions are rejected',()=>{
 for(const p of [{x:-.4790319486279727,z:4.35},{x:.4209680513720273,z:4.35},{x:11.05,z:-.55},{x:11.05,z:.35}]){
  assert.equal(clearsCommons(p),false);assert.ok(actualClearance(p)<PRESENTATION_RADIUS);
 }
});
function checkSlots(ms){
 const frames=liveFrames(world(ms),[],NOW),extras=ms.filter(m=>!legacyIds.has(m.id));assert.equal(frames.size,ms.length);
 const reserved=Object.values(COMMONS_SLOTS).flat();
 for(const m of extras){const p=frames.get(m.id);assert.ok(clearsCommons(p),`${m.id} in furniture`);assert.ok(actualClearance(p)>=PRESENTATION_RADIUS-1e-6);assert.deepEqual(museLngLat(m,NOW,ms),sceneToLngLat(p.x,p.z));for(const q of reserved)assert.ok(Math.hypot(p.x-q.x,p.z-q.z)>=2*PRESENTATION_RADIUS-1e-8);}
 for(let i=0;i<extras.length;i++)for(let j=0;j<i;j++){const a=frames.get(extras[i].id),b=frames.get(extras[j].id);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=SLOT_SPACING-1e-8);}
 assert.deepEqual(liveFrames(world([...ms].reverse()),[],NOW),frames);
 return frames;
}
test('all 17 catalog residents fit at every commons place without changing the ten authored slots',()=>{
 for(const place of places){const ms=[...MUSE_VARIANTS.map(v=>muse(v.id,place)),...residents(place)];checkSlots(ms);for(let k=0;k<MUSE_VARIANTS.length;k++)assert.deepEqual(slotAt(place,MUSE_VARIANTS[k].id,ms),COMMONS_SLOTS[place][k]);}
});
test('64 actors spread across places share one non-overlapping pool, and mutable snapshots cannot reuse stale placements',()=>{
 const ms=[...MUSE_VARIANTS.map((v,i)=>muse(v.id,places[i%places.length])),...residents(),...Array.from({length:37},(_,i)=>personal(i,places[i%places.length]))];
 checkSlots(ms);ms.find(m=>m.id==='nr_alba').place='commons:campfire';checkSlots(ms);
});
test('overflow exhaustion and unknown/invalid profile IDs fail closed',()=>{
 const ms=Array.from({length:140},(_,i)=>personal(i,'commons:campfire'));
 const frames=liveFrames(world(ms),[],NOW);assert.equal(frames.size,commonsCandidates(Object.values(COMMONS_SLOTS).flat()).length);
 assert.equal(slotAt('commons:campfire','nr_forged',[muse('nr_forged')]),null);
 assert.equal(slotAt('commons:campfire','nr_alba',[muse('nr_alba','commons:campfire',{profile:null})]),null);
});
test('new actor contact crossing a bench falls back and does not step through furniture',()=>{
 assert.equal(clearsContactMove({x:-1.5,z:4.2},{x:1.5,z:4.2}),false);
 const ms=residents('commons:campfire');let found=0;
 for(let i=0;i<ms.length;i++)for(let j=i+1;j<ms.length;j++){
  const cues=scheduleCues([{id:`e${i}-${j}`,tick:1,at:NOW,kind:'encounter',muse:ms[i].id,other:ms[j].id}]);
  const frames=liveFrames(world(ms),cues,NOW+CUE_DELAY_MS+1000),f=frames.get(ms[i].id);
  if(f.fallback?.includes('furniture')){found++;assert.equal(f.clip,'wave');assert.equal(f.x,slotAt(ms[i].place,ms[i].id,ms).x);assert.equal(f.z,slotAt(ms[i].place,ms[i].id,ms).z);}
 }
 assert.ok(found>0,'fixture must exercise a real furniture-blocked contact');
});
test('frozen residents ignore active cues and partner facing; personal profiles keep their own clock',()=>{
 const frozen=muse('nr_alba','commons:campfire',{residentFrozenAt:NOW}),other=muse('nr_basil'),ms=[frozen,other];
 const cues=scheduleCues([{id:'freeze-contact',tick:1,at:NOW,kind:'encounter',muse:frozen.id,other:other.id}]);
 const baseline=liveFrames(world(ms),[],NOW).get(frozen.id);
 for(const delta of [100,500,1000,1900])assert.deepEqual(liveFrames(world(ms),cues,NOW+CUE_DELAY_MS+delta).get(frozen.id),baseline);
 const profile={actorId:'nr_alba',displayName:'Personal Alba',appearanceId:'00-jolly',revision:1};
 const owned={...frozen,profile};assert.notEqual(liveFrames(world([owned]),[],NOW+1000).get(owned.id).actionTime,liveFrames(world([owned]),[],NOW).get(owned.id).actionTime);
});

test('the OFF resident cohort stays still when an unrelated personal actor moves, even with an earlier ID',()=>{
 const frozen=residents().map(m=>({...m,residentFrozenAt:NOW}));
 const p=muse('aa_personal','commons:cafe',{profile:{actorId:'aa_personal',displayName:'Visitor',appearanceId:'01-sunny',revision:1}});
 const before=liveFrames(world([...frozen,p]),[],NOW);
 p.place='commons:campfire';const after=liveFrames(world([...frozen,p]),[],NOW+60_000);
 for(const m of frozen)assert.deepEqual(after.get(m.id),before.get(m.id));
});
