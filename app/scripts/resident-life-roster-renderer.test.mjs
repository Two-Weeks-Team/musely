// Real Three.js renderer/kit validation. CI must use checked-in GLBs, never synthetic replacement assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {statSync,readFileSync} from 'node:fs';
import {createWorld} from '../src/engine/world.ts';
import {createLife} from '../src/engine/resident-life.ts';
import {HARNESS_IDS,harnessById,harnessRoleId,isResidentInstance} from '../src/engine/harness.ts';
import {RESIDENT_INSTANCES,RESIDENT_ROSTER_MODE} from '../src/engine/resident-catalog.ts';
import {enrollResidentRoster} from '../worker/core/resident-roster.ts';
import {resolveMuse,withSnapshotProfiles} from '../src/ui/personal-profile.ts';
import {liveFrames,ownerOf} from '../src/ui/live-scene-core.ts';
const NOW=Date.parse('2026-11-03T20:00:00Z');
const legacy=['00-jolly','04-ember','09-copper'];
function world(){
 const life=createLife(HARNESS_IDS.map(id=>({id,defaultGoal:harnessById(id).wants.goal,home:'commons:garden'})),HARNESS_IDS.filter(id=>!legacy.includes(id)).map(id=>({id,roleId:id})));
 return enrollResidentRoster(createWorld('renderer-roster',NOW),life,NOW,{roster:RESIDENT_ROSTER_MODE,allowedPlaceIds:['commons:garden'],ownershipKind:id=>legacy.includes(id)?'legacy':HARNESS_IDS.includes(id)||isResidentInstance(id)?'resident':'unknown'}).world;
}
const viewWorld=s=>({worldId:s.worldId,day:s.day,tick:s.tick,version:s.version,lastTickAt:s.lastTickAt,muses:s.muses});
test('24 NPC presentations resolve exact identities and reusable appearance without personal ownership',()=>{
 const s=world();assert.equal(s.muses.length,27);
 for(const r of RESIDENT_INSTANCES){const m=s.muses.find(m=>m.id===r.id),p=resolveMuse(m);assert.equal(p.actorId,r.id);assert.equal(p.kind,'resident');assert.equal(p.name,r.name);assert.equal(p.appearanceId,r.appearanceId);assert.equal(p.profile,null);assert.equal(ownerOf(r.id).kind,'resident');}
 for(const id of ['nr_forged','pm_unknown','constructor']){assert.equal(resolveMuse({id}).kind,'unknown');assert.equal(ownerOf(id).kind,'unknown');}
});
test('27 actual actor frames keep deterministic separate positions while instances reuse appearance',()=>{
 const w=viewWorld(world());for(const m of w.muses){m.place='commons:cafe';m.travel=null;m.beat=null;}
 const a=liveFrames(w,[],NOW),b=liveFrames({...w,muses:[...w.muses].reverse()},[],NOW);assert.deepEqual(a,b);assert.equal(a.size,27);
 assert.equal(new Set([...a.values()].map(f=>`${f.x},${f.z}`)).size,27);
 assert.equal(harnessRoleId('nr_alba'),harnessRoleId('nr_olive'));assert.notDeepEqual(a.get('nr_alba'),a.get('nr_olive'));
});
test('replay projection retains recorded catalog IDs without borrowing a later personal profile',()=>{
 const s=viewWorld(world()),live={...s,muses:s.muses.map(m=>m.id==='nr_alba'?{...m,profile:{actorId:m.id,displayName:'Later public label',appearanceId:'00-jolly',revision:1}}:m)};
 const recorded=withSnapshotProfiles(live,s);assert.equal(resolveMuse(recorded.muses.find(m=>m.id==='nr_alba')).name,'Alba');assert.equal(recorded.muses.length,27);
});
const base=new URL('../character-kit/runtime/base/lod0.glb',import.meta.url);
const fullAssets=statSync(base).size>1_000_000;
const geometryOptions={skip:!fullAssets&&!process.env.CI?'Local checkout has empty LOD0/1; full asset validation is mandatory in CI':false};
async function renderer(t){
 assert.ok(fullAssets,'full checked-in LOD0 asset is required');
 const T=await import('three'),{makeLiveScene}=await import('../src/ui/live-scene.ts'),{MaterialLibrary}=await import('../src/character-kit/MaterialLibrary.ts'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{deriveClipsGlb}=await import('./clips-glb.mjs');
 const parser=new GLTFLoader().register(()=>({name:'GeometryOnlyAudit',loadTexture:async()=>null}));
 const loads=new Map(),library=new MaterialLibrary('character-kit/runtime/',{loadAsync:async path=>{loads.set(path,(loads.get(path)??0)+1);const b=path.endsWith('/clips.glb')?deriveClipsGlb(readFileSync(path.replace('/clips.glb','/lod0.glb'))):readFileSync(path);assert.ok(b.length>0);return parser.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}});
 const host={scene:new T.Scene(),actors:[],muses:[],shadows:[],selection:new T.Group(),library,shadowTexture:null,ambient:()=>{}};
 const view=makeLiveScene(host,p=>({x:400+p.x*10,y:400-p.y*100}));t.after(()=>{view.dispose();library.dispose();});return{view,host,loads};
}
test('all 24 NPCs render as independent real GLB rigs with fixed global LOD budgets',geometryOptions,async t=>{
 const {view,host,loads}=await renderer(t);view.accept(viewWorld(world()),[]);await view.ready;view.setActive(true);view.update(NOW,'nr_alba');
 const metrics=view.getMetrics(),rows=metrics.muses;assert.equal(rows.length,27);assert.ok(rows.every(m=>m.rendered));assert.equal(new Set(rows.map(m=>m.rootId)).size,27);assert.deepEqual(metrics.errors,[]);
 const a=rows.find(m=>m.id==='nr_alba'),b=rows.find(m=>m.id==='nr_olive');assert.equal(a.variant,b.variant);assert.notEqual(a.rootId,b.rootId);assert.notDeepEqual(a.position,b.position);assert.equal(host.selection.position.x,a.frame.x);
 assert.ok([...loads.values()].every(n=>n===1),'shared GLB parsed once per resource');
 const bodies=rows.map(m=>m.lod);assert.ok(bodies.filter(n=>n===0).length<=2);assert.ok(bodies.every(n=>[0,1,2].includes(n)));
});
test('roster replay/removal/restart does not duplicate roots or mutate other same-appearance actors',geometryOptions,async t=>{
 const {view,host}=await renderer(t),w=viewWorld(world());view.accept(w,[]);await view.ready;view.setActive(true);view.update(NOW);
 const before=view.getMetrics().muses,a=before.find(m=>m.id==='nr_alba'),b=before.find(m=>m.id==='nr_olive');
 view.accept({...w,version:w.version+1,muses:w.muses.filter(m=>m.id!=='nr_alba')},[]);await view.ready;view.update(NOW);assert.equal(view.getMetrics().muses.length,26);assert.equal(host.scene.children.some(n=>n.uuid===a.rootId),false);assert.equal(view.getMetrics().muses.find(m=>m.id==='nr_olive').rootId,b.rootId);
 view.setRecordedFrame({replay:true,runId:'saved',snapshotHash:'saved',recordedAt:NOW,snapshotAt:NOW,inputs:[],events:[],publicState:w});await view.ready;view.update(NOW,'nr_alba');assert.equal(view.getMetrics().muses.length,27);assert.ok(view.getMetrics().muses.every(m=>m.rendered));
 view.setRecordedFrame(null);await view.ready;view.update(NOW);assert.equal(view.getMetrics().muses.length,26);
 view.accept({...structuredClone(w),version:w.version+2},[]);await view.ready;view.update(NOW);assert.equal(view.getMetrics().muses.length,27);assert.equal(new Set(view.getMetrics().muses.map(m=>m.rootId)).size,27);
});

test('frozen resident position and animation clocks remain fixed while personal and legacy clocks are untouched',()=>{
 const w=viewWorld(world()),a=w.muses.find(m=>m.id==='nr_alba');a.travel={to:'commons:garden',departAt:NOW,arriveAt:NOW+600_000,speed:'walk'};a.residentFrozenAt=NOW+60_000;
 const f=liveFrames(w,[],NOW+60_000).get(a.id),late=liveFrames(w,[],NOW+600_000).get(a.id);assert.deepEqual(late,f);assert.equal(late.moving,false);assert.equal(late.status,'Resident activity paused');
});
