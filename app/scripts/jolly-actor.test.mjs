import{test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js';import{SkinnedMesh}from'three';import{BaseMuseActor}from'../src/character-kit/BaseMuseActor.ts';
async function source(){const b=await readFile('character-kit/runtime/base/lod0.glb');return await new GLTFLoader().register(()=>({name:'GeometryOnlyAudit',loadTexture:async()=>null})).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
test('base actors share geometry but keep independent skeletons, facial state and route-owned transforms',async()=>{
 const g=await source(),a=new BaseMuseActor(g),b=new BaseMuseActor(g),root=a.root;
 const sa=[],sb=[];a.root.traverse(o=>{if(o instanceof SkinnedMesh)sa.push(o);});b.root.traverse(o=>{if(o instanceof SkinnedMesh)sb.push(o);});assert.ok(sa.length>=2);assert.equal(sa[0].geometry,sb[0].geometry);assert.notEqual(sa[0].skeleton.bones[0],sb[0].skeleton.bones[0]);
 a.setAction('wave');a.setExpression('Smile');a.update(.9,{x:2,y:.05,z:-3,yaw:.4},.9);b.setAction('idle_breathe');b.setExpression('Concerned');b.update(.9,{x:-2,y:0,z:4,yaw:0},.9);
 assert.equal(a.root,root);assert.deepEqual(a.root.position.toArray(),[2,.05,-3]);assert.deepEqual(b.root.position.toArray(),[-2,0,4]);const bounds=a.getBounds();assert.ok(bounds.min.x>1.3&&bounds.max.x<2.7&&bounds.min.z>-3.7&&bounds.max.z<-2.3,'the actual skinned geometry did not follow the route root');
 const armA=sa[0].skeleton.bones.find(b=>b.name==='UpperArm_R'),armB=sb[0].skeleton.bones.find(b=>b.name==='UpperArm_R');assert.ok(armA.quaternion.angleTo(armB.quaternion)>.3);
 const faceA=sa.find(m=>m.morphTargetDictionary?.Smile!==undefined),faceB=sb.find(m=>m.morphTargetDictionary?.Smile!==undefined);assert.equal(faceA.morphTargetInfluences[faceA.morphTargetDictionary.Smile],1);assert.equal(faceB.morphTargetInfluences[faceB.morphTargetDictionary.Smile],0);
 const q=armA.quaternion.toArray();a.update(.9,{x:2,y:.05,z:-3,yaw:.4},.9);assert.deepEqual(armA.quaternion.toArray(),q);a.dispose();b.dispose();
});
import{Scene,Vector3}from'three';import{instanceMovingMeshes}from'../src/instances.ts';
test('ordinary world instancing leaves independently skinned residents visible and animated',async()=>{
 const actor=new BaseMuseActor(await source()),scene=new Scene();scene.add(actor.root);const update=instanceMovingMeshes(scene,[actor.root]);update();assert.ok(actor.meshes.every(m=>m.visible),'skinned meshes were hidden behind rigid instances');assert.equal(scene.children.length,1);actor.dispose();
});
test('base support feet stay within the documented 20 mm ground tolerance during standing, walking and sit transitions',async()=>{
 const actor=new BaseMuseActor(await source());for(const name of ['idle_breathe','walk','wave','sit_down','sit_idle','stand_up','talk']){actor.setAction(name);for(let frame=0;frame<=32;frame++){const t=frame/24;actor.update(t,{x:0,y:0,z:0,yaw:0},t);const y=actor.getBounds().min.y;assert.ok(y>=-.02&&y<=.02,`${name} support at ${t}s: ${y}m`);}}actor.dispose();
});
test('every facial expression closes the actual exported eyes without reversing their top and bottom',async()=>{
 const actor=new BaseMuseActor(await source()),eye=actor.meshes.find(m=>(Array.isArray(m.material)?m.material[0]:m.material).name==='Glossy eyes'),p=new Vector3();actor.update(0,{x:0,y:0,z:0,yaw:0},0);const pairs=[];
 for(const side of[-1,1]){let top=-Infinity,bottom=Infinity,ti=-1,bi=-1;for(let i=0;i<eye.geometry.attributes.position.count;i++){eye.getVertexPosition(i,p);p.applyMatrix4(eye.matrixWorld);if(p.x*side<=0)continue;if(p.y>top){top=p.y;ti=i;}if(p.y<bottom){bottom=p.y;bi=i;}}pairs.push([ti,bi]);}
 function heights(){return pairs.map(([top,bottom])=>{eye.getVertexPosition(top,p);p.applyMatrix4(eye.matrixWorld);const y=p.y;eye.getVertexPosition(bottom,p);p.applyMatrix4(eye.matrixWorld);return y-p.y;});}
 for(const name of['Neutral','Smile','Curious','Thinking','Focused','Listening','Concerned','Delight']){actor.setExpression(name);actor.update(0,{x:0,y:0,z:0,yaw:0},0);const opened=heights();actor.update(4.35,{x:0,y:0,z:0,yaw:0},0);heights().forEach((h,i)=>assert.ok(h>0&&h<opened[i]*.15,`${name} eye${i} reverses or stays open: ${h} vs ${opened[i]}`));}actor.dispose();
});
import clipManifest from'../character-kit/runtime/animations/manifest.json' with{type:'json'};
test('exported action timelines start at zero and match the stride/action manifest',async()=>{const g=await source();for(const spec of clipManifest.clips){const clip=g.animations.find(a=>a.name===spec.name);assert.ok(Math.abs(clip.duration-spec.seconds)<1e-5,`${spec.name} duration ${clip.duration} vs ${spec.seconds}`);for(const track of clip.tracks)assert.ok(Math.abs(track.times[0])<1e-6,`${spec.name} has a leading hold`);}});
