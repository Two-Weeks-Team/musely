import{test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js';import{SkinnedMesh,Vector3,Box3,Mesh}from'three';
import{MuseActor}from'../src/character-kit/MuseActor.ts';import{MaterialLibrary}from'../src/character-kit/MaterialLibrary.ts';
import{MUSE_VARIANTS,RESIDENT_VARIANTS,SIGNATURE_CLIPS,SHARED_CLIPS,fleeceFactor}from'../src/character-kit/catalog.ts';import{residentBehavior,chooseLods,ResidentClock}from'../src/character-kit/residents.ts';import{positionAt}from'../src/activity.ts';import{conversationAt,DURATION}from'../src/story.ts';
import manifest from'../character-kit/manifest.json' with{type:'json'};import clips from'../character-kit/runtime/animations/manifest.json' with{type:'json'};
const RT='character-kit/runtime/';
const cache=new Map();
async function gltf(path){if(!cache.has(path)){const b=await readFile(RT+path);cache.set(path,await new GLTFLoader().register(()=>({name:'GeometryOnlyAudit',loadTexture:async()=>null})).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),''));}return cache.get(path);}
async function actor(id,library){return new MuseActor([await gltf('base/lod0.glb'),await gltf('base/lod1.glb'),await gltf('base/lod2.glb')],id==='00-jolly'?null:await gltf(`attachments/${id}.glb`),id,library);}
const pose={x:0,y:0,z:0,yaw:0};

test('the runtime catalog, Python authoring spec and kit manifest describe the same ten characters',()=>{
 const spec=readFileSync('character-kit/source/variant_spec.py','utf8');
 assert.equal(MUSE_VARIANTS.length,10);assert.equal(new Set(MUSE_VARIANTS.map(v=>v.id)).size,10);
 for(const v of MUSE_VARIANTS){const m=manifest.variants.find(x=>x.id===v.id);assert.ok(m,v.id);for(const k of['name','role','body','accent','signature'])assert.equal(m[k],v[k],`${v.id}.${k}`);assert.ok(spec.includes(`'id': '${v.id}'`)&&spec.includes(`'body': '${v.body}'`),`${v.id} missing from variant_spec.py`);}
 assert.deepEqual([...RESIDENT_VARIANTS],manifest.residents);assert.equal(RESIDENT_VARIANTS.length,8);
 assert.deepEqual(MUSE_VARIANTS.filter(v=>v.signature).map(v=>v.signature).sort(),Object.keys(SIGNATURE_CLIPS).sort(),'each of the nine has exactly one distinct signature');
});

test('every runtime file matches its recorded hash and the single shared rig digest',()=>{
 for(const[path,info]of Object.entries(manifest.files)){const b=readFileSync(RT+path);assert.equal(createHash('sha256').update(b).digest('hex'),info.sha256,path);assert.equal(b.length,info.bytes,path);if(info.rigDigest)assert.equal(info.rigDigest,manifest.rigDigest,path);}
 assert.equal(Object.keys(manifest.files).length,12,'3 base LODs + 9 attachments');
});

test('the base carries all 21 body clips at their manifest durations, starting at zero',async()=>{
 const g=await gltf('base/lod0.glb');assert.equal(clips.clips.length,21);
 for(const name of[...SHARED_CLIPS,...Object.keys(SIGNATURE_CLIPS)]){const spec=clips.clips.find(c=>c.name===name),clip=g.animations.find(a=>a.name===name);assert.ok(spec&&clip,name);assert.ok(Math.abs(clip.duration-spec.seconds)<1e-5,`${name} ${clip.duration}`);for(const t of clip.tracks)assert.ok(Math.abs(t.times[0])<1e-6,`${name} leading hold`);}
 for(const[name,s]of Object.entries(SIGNATURE_CLIPS))assert.equal(clips.clips.find(c=>c.name===name).loop,s.loop,name);
});

test('every equipped character stays inside the LOD0/LOD1/LOD2 triangle budgets',async()=>{
 for(const v of MUSE_VARIANTS){const a=await actor(v.id);const counts=[0,1,2].map(l=>{a.setLod(l);return a.visibleTriangles();});
  assert.ok(counts[0]<=28000&&counts[1]<=8000&&counts[2]<=3000,`${v.id} ${counts}`);assert.ok(counts[0]>counts[1]&&counts[1]>counts[2],`${v.id} LODs must reduce: ${counts}`);a.dispose();}
});

test('variants share base geometry but keep independent skeletons, garments bound to their own actor',async()=>{
 const moss=await actor('02-moss'),tempo=await actor('07-tempo');
 assert.ok(moss.meshes[0].geometry===tempo.meshes[0].geometry,'shared body geometry');assert.ok(moss.skeleton.bones[0]!==tempo.skeleton.bones[0],'independent bones');
 for(const a of[moss,tempo])for(const m of a.meshes)assert.ok(m.skeleton.bones.every((b,i)=>b===a.skeleton.bones[i]),`${a.variant} ${m.name} bound to a foreign skeleton`);
 moss.setAction('water_plants');tempo.setAction('music_bounce');moss.update(1,pose,1);tempo.update(1,pose,1);
 const arm=a=>a.skeleton.bones.find(b=>b.name==='UpperArm_R').quaternion;assert.ok(arm(moss).angleTo(arm(tempo))>.2,'independent pose');
 moss.dispose();tempo.dispose();
});

test('props ride on the named bone and garments follow the skinned torso through actions',async()=>{
 for(const[id,bone]of[['02-moss','Hand_R'],['03-ripple','Hand_L'],['04-ember','Hand_L'],['06-ink','Head'],['07-tempo','Head'],['09-copper','Hand_R']]){
  const a=await actor(id);const b=a.skeleton.bones.find(x=>x.name===bone);const props=b.children.filter(c=>c.userData.musely_kind==='prop');assert.ok(props.length>=3,`${id} prop LODs on ${bone}`);
  a.setAction(MUSE_VARIANTS.find(v=>v.id===id).signature);a.update(1.1,{x:1,y:0,z:-2,yaw:.3},1.1);
  const prop=props.find(p=>p.visible),pw=new Box3().setFromObject(prop).getCenter(new Vector3()),bw=b.getWorldPosition(new Vector3());
  assert.ok(pw.distanceTo(bw)<.3,`${id} prop drifted ${pw.distanceTo(bw)} from ${bone}`);a.dispose();}
});

test('LOD swaps keep identity, skeleton, action phase and expression mid-walk',async()=>{
 const a=await actor('01-sunny'),root=a.root,skeleton=a.skeleton;a.setAction('walk');a.setExpression('Smile');
 const head=a.skeleton.bones.find(b=>b.name==='UpperLeg_L');a.update(1.3,pose,.4);const q=head.quaternion.clone();
 for(const lod of[1,2,0]){a.setLod(lod);a.update(1.3,pose,.4);assert.equal(a.root,root);assert.equal(a.skeleton,skeleton);assert.ok(head.quaternion.angleTo(q)<1e-6,`phase changed at LOD${lod}`);
  const faces=a.meshes.filter(m=>m.visible&&m.parent?.visible!==false&&m.morphTargetDictionary?.Smile!==undefined);assert.ok(faces.length>0,`LOD${lod} face`);for(const f of faces)assert.equal(f.morphTargetInfluences[f.morphTargetDictionary.Smile],1);
  let shown=0;root.traverse(o=>{if(o.userData.museLod!==undefined&&o.visible){assert.equal(o.userData.museLod,lod);shown++;}});assert.ok(shown>=3);}
 a.dispose();
});

test('fleece takes the variant palette while face, eyes and accessory materials keep their own',async()=>{
 const lib=new MaterialLibrary(),a=await actor('06-ink',lib),b=await actor('06-ink',lib),j=await actor('00-jolly',lib);
 const fleece=x=>x.meshes.find(m=>m.material.name.startsWith('Fleece')).material;
 const f=fleeceFactor('#91ABC8');assert.deepEqual(fleece(a).color.toArray().map(x=>+x.toFixed(4)),f.map(x=>+x.toFixed(4)));assert.equal(fleece(a),fleece(b),'one shared tinted material per variant');
 if(fleece(a).sheen>0)assert.equal(fleece(a).sheenColor.getHexString(),'91abc8','fabric sheen takes the coat color instead of washing it to white');
 assert.equal(fleece(j).name,'Fleece','the base keeps its original cream');const face=a.meshes.find(m=>m.material.name==='Warm face');assert.ok(face);assert.deepEqual(face.material.color.toArray(),[1,1,1]);
 for(const x of[a,b,j])x.dispose();
});

test('signature actions keep a supporting foot on the ground within 20 mm',async()=>{
 for(const v of MUSE_VARIANTS.filter(v=>v.signature)){const a=await actor(v.id);a.setLod(0);a.setAction(v.signature);const frames=SIGNATURE_CLIPS[v.signature].frames;
  for(let f=0;f<=frames;f+=4){const t=f/24;a.update(t,pose,t);let low=Infinity;for(const m of a.meshes.filter(m=>m.visible&&m.name.startsWith('Jolly'))){m.computeBoundingBox();low=Math.min(low,new Box3().setFromObject(m).min.y);}
   assert.ok(low>=-.02&&low<=.02,`${v.id} ${v.signature} lowest support at ${t.toFixed(2)}s: ${low.toFixed(4)}m`);}
  a.dispose();}
});

test('every resident uses only clips the kit provides, and shows its own activity when idle',async()=>{
 const g=await gltf('base/lod0.glb'),names=new Set(g.animations.map(a=>a.name)),seen=RESIDENT_VARIANTS.map(()=>new Set());
 for(let t=0;t<=DURATION;t+=.5)for(let i=0;i<8;i++){const b=residentBehavior(i,t,positionAt(i,t).moving,conversationAt(t));assert.ok(names.has(b.action),`${i} ${b.action}`);seen[i].add(b.action);}
 RESIDENT_VARIANTS.forEach((id,i)=>{const sig=MUSE_VARIANTS.find(v=>v.id===id).signature;if(sig)assert.ok(seen[i].has(sig),`${id} never performs ${sig}`);assert.ok(seen[i].has('walk')||i===4,`${id} never walks`);});
});
test('the world LOD selector keeps at most two LOD0 actors, prefers the selected Muse and holds hysteresis',()=>{
 const h=[300,250,240,100,50,46,30,10];let l=chooseLods(h,[2,2,2,2,2,2,2,2],[2]);assert.deepEqual(l,[0,1,0,1,2,2,2,2]);
 assert.equal(l.filter(x=>x===0).length,2);l=chooseLods([140,140,140,48,48,48,48,48],l,[]);assert.deepEqual(l.slice(0,3),[0,1,0],'LOD0 held above the demotion height');assert.equal(l[3],1,'LOD1 held above its demotion height');
 l=chooseLods([120,120,120,40,40,40,40,40],l,[]);assert.deepEqual(l,[1,1,1,2,2,2,2,2]);
});
test('walking phase follows traveled distance and resets after a seek',()=>{
 const c=new ResidentClock(),walk={action:'walk',expression:'Neutral',timed:false};c.time(walk,10,0,0);const a=c.time(walk,10.1,.27,0);assert.ok(Math.abs(a-32/24)<1e-9,`one stride = one cycle: ${a}`);
 assert.equal(c.time(walk,50,5,5),0,'seek resets the stride clock');
});
import{surfaceHeightAt}from'../src/surfaces.ts';
// Same furniture volumes as base-world-clearance.test.mjs, applied to every equipped resident.
const benches=[[-2.3,2,-Math.PI/2],[2.2,2,Math.PI/2],[0,4.2,Math.PI],[-8.2,4.7,.2]];
const cylinders=[[-7.1,-3.16,.055,1.22,1.2,'canopy-left'],[-.5,-3.16,.055,1.22,1.2,'canopy-right']];for(const[x,z]of[[-5.2,-1.8],[-2.5,-1.6]]){cylinders.push([x,z,.6,.64,.06,'table'],[x,z,.085,.32,.31,'table-leg']);for(const dx of[-.9,.9])cylinders.push([x+dx,z,.27,.36,.05,'stool']);}
test('all eight equipped residents clear commons furniture through the complete story',async()=>{
 const v=new Vector3(),q=new Vector3(),up=new Vector3(0,1,0),hits=[];
 for(let i=0;i<8;i++){const a=await actor(RESIDENT_VARIANTS[i]),clock=new ResidentClock();a.setLod(0);
  for(let t=0;t<=210;t+=.25){const p=positionAt(i,t),line=conversationAt(t),partner=line?.person===i?line.listener:line?.listener===i?line.person:undefined,o=partner===undefined?null:positionAt(partner,t),yaw=p.moving?p.yaw:o?Math.atan2(o.x-p.x,o.z-p.z):0;
   const b=residentBehavior(i,t,p.moving,line),time=clock.time(b,t,p.x,p.z);
   const nb=benches.filter(([x,z])=>Math.hypot(p.x-x,p.z-z)<1.8),nc=cylinders.filter(([x,z,r])=>Math.hypot(p.x-x,p.z-z)<r+.7);if(!nb.length&&!nc.length)continue;
   a.setAction(b.action);a.update(t,{x:p.x,y:surfaceHeightAt(p.x,p.z)+.006,z:p.z,yaw},time);
   const meshes=[];a.root.traverseVisible(m=>{if(m instanceof Mesh)meshes.push(m);});
   outer:for(const m of meshes)for(let k=0;k<m.geometry.attributes.position.count;k+=2){m.getVertexPosition(k,v);v.applyMatrix4(m.matrixWorld);
    for(const[x,z,by]of nb){q.copy(v).sub(new Vector3(x,0,z)).applyAxisAngle(up,-by);if(Math.abs(q.x)<.85&&((Math.abs(q.y-.42)<.06&&Math.abs(q.z)<.19)||(Math.abs(q.y-.75)<.2&&Math.abs(q.z+.18)<.05))){hits.push({who:RESIDENT_VARIANTS[i],t,obj:'bench',part:m.name});break outer;}}
    for(const[x,z,r,y,h,name]of nc)if(Math.abs(v.y-y)<h&&Math.hypot(v.x-x,v.z-z)<r){hits.push({who:RESIDENT_VARIANTS[i],t,obj:name,part:m.name});break outer;}}
   if(hits.length>12)break;}
  a.dispose();}
 assert.deepEqual(hits,[]);
});
