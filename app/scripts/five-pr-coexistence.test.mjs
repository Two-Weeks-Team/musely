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

// CPU scene ownership only: #135 roof/MapLibre tests run separately; this is not a GPU co-rendering proof.
test('composed resident rigs remain independent from OFF/ON campfire resources and freshness',geometryOptions,async t=>{
 const T=await import('three'),{createCampfireScenePort}=await import('../world-packs/campfire/scene-port.mjs'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
 const {view,host}=await renderer(t),legacy=new T.Group();legacy.name='Fire';host.scene.add(legacy);let assetLoads=0;
 const port=createCampfireScenePort(host.scene,legacy,{loadAsset:async()=>{assetLoads++;const b=readFileSync(new URL('../world-packs/campfire/campfire-prototype.glb',import.meta.url));return(await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}});host.campfireVisual=port;t.after(()=>port.dispose());
 const w=viewWorld(world());for(const m of w.muses){m.place='commons:campfire';m.travel=null;m.beat=null;}const before=JSON.stringify(w);view.accept(w,[],NOW);await view.ready;view.setActive(true);view.update(NOW,'nr_alba');port.update(NOW);
 assert.equal(assetLoads,0,'OFF never loads visual replacement');assert.equal(legacy.visible,true);const roots=view.getMetrics().muses.map(m=>m.rootId);assert.equal(new Set(roots).size,27);assert(view.getMetrics().muses.every(m=>m.rendered));
 await port.enable({distanceM:()=>2});view.update(NOW,'nr_alba');port.update(NOW);assert.equal(assetLoads,1);assert.equal(legacy.visible,false);assert.equal(port.getMetrics().frame.attendees,27);assert.deepEqual(view.getMetrics().muses.map(m=>m.rootId),roots);assert.equal(JSON.stringify(w),before,'rendering cannot mutate authoritative actor state');
 port.update(NOW+60001);assert.equal(port.getMetrics().frame.attendees,0,'stale attendance never becomes crowd evidence');
 const stamp=NOW+120000;view.accept(w,[],stamp);view.update(stamp,'nr_alba');port.update(stamp);assert.equal(port.getMetrics().frame.attendees,27,'HTTP observation time refreshes the unchanged authoritative snapshot');
 port.disable();assert.equal(legacy.visible,true);assert.deepEqual(view.getMetrics().muses.map(m=>m.rootId),roots);assert.equal(host.scene.children.filter(c=>c.name.startsWith('campfire:')).length,0);assert.equal(JSON.stringify(w),before);
 view.dispose();port.dispose();assert.equal(port.getMetrics().disposed,true);assert.equal(host.scene.children.some(c=>roots.includes(c.uuid)),false,'disposed NPC roots cannot remain attached');assert.equal(legacy.parent,host.scene);assert.equal(legacy.visible,true);assert.equal(host.scene.children.filter(c=>c.name.startsWith('campfire:')).length,0);
});
