import {test} from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const file='character-kit/runtime/base/lod0.glb';
function glb(){const b=readFileSync(file);assert.equal(b.readUInt32LE(0),0x46546c67);return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());}
test('portable Jolly base has independent skin, standard PBR detail, expressions and reusable clips',()=>{
 const g=glb();assert.ok(g.skins?.length>0,'base needs a deforming skeleton');assert.ok(g.skins.every(s=>s.joints.length<=40));
 const names=g.nodes.map(n=>n.name);for(const bone of ['Root','Hips','Spine','Chest','Neck','Head','UpperArm_L','Forearm_L','Hand_L','UpperLeg_L','LowerLeg_L','Foot_L','Toe_L','UpperArm_R','Forearm_R','Hand_R','UpperLeg_R','LowerLeg_R','Foot_R','Toe_R'])assert.ok(names.includes(bone),bone);
 for(const clip of ['idle_breathe','walk','look_around','think','listen','talk','wave','sit_down','sit_idle','stand_up','celebrate','offer_item'])assert.ok(g.animations.some(a=>a.name===clip),clip);
 const morphs=g.meshes.flatMap(m=>m.extras?.targetNames??[]);for(const name of ['Smile','Curious','Thinking','Focused','Listening','Concerned','Delight','Blink_L','Blink_R','MouthOpen'])assert.ok(morphs.includes(name),name);
 const fleece=g.materials.find(m=>m.name==='Fleece');assert.ok(fleece.normalTexture);assert.ok(fleece.pbrMetallicRoughness.baseColorTexture);assert.ok(fleece.pbrMetallicRoughness.metallicRoughnessTexture);assert.deepEqual(fleece.emissiveFactor??[0,0,0],[0,0,0]);assert.ok(g.images.every(i=>i.bufferView!==undefined&&i.mimeType==='image/png'));
 let tris=0;for(const mesh of g.meshes)for(const p of mesh.primitives){assert.ok(p.attributes.TEXCOORD_0!==undefined);assert.ok(p.attributes.JOINTS_0!==undefined);assert.ok(p.attributes.WEIGHTS_0!==undefined);if(g.materials[p.material].normalTexture)assert.ok(p.attributes.TANGENT!==undefined,'fleece needs portable tangent space');tris+=(p.indices!==undefined?g.accessors[p.indices].count:g.accessors[p.attributes.POSITION].count)/3;}assert.ok(tris<=28000,`triangles ${tris}`);
 assert.ok(readFileSync(file).length<=8*1024*1024,'portable payload budget');
});
test('the exported skin actually binds arms and feet, rather than moving the whole body from the head',()=>{
 const bytes=readFileSync(file),g=glb(),binStart=20+bytes.readUInt32LE(12)+8;
 const counts={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
 const componentSize={5121:1,5123:2,5125:4,5126:4};
 function value(index,row,column){const a=g.accessors[index],v=g.bufferViews[a.bufferView],stride=v.byteStride??counts[a.type]*componentSize[a.componentType],o=binStart+(v.byteOffset??0)+(a.byteOffset??0)+row*stride+column*componentSize[a.componentType];return a.componentType===5121?bytes.readUInt8(o):a.componentType===5123?bytes.readUInt16LE(o):a.componentType===5125?bytes.readUInt32LE(o):bytes.readFloatLE(o);}
 const used=new Set();for(const node of g.nodes.filter(n=>n.skin!==undefined))for(const p of g.meshes[node.mesh].primitives){const joints=p.attributes.JOINTS_0,weights=p.attributes.WEIGHTS_0;for(let i=0;i<g.accessors[weights].count;i++)for(let j=0;j<4;j++)if(value(weights,i,j)>.05)used.add(g.nodes[g.skins[node.skin].joints[value(joints,i,j)]].name);}
 for(const name of ['Hips','Spine','Chest','Head','UpperArm_L','Forearm_L','Hand_L','UpperArm_R','Forearm_R','Hand_R','Foot_L','Foot_R'])assert.ok(used.has(name),`no vertices deform with ${name}; used ${[...used]}`);
});
test('portable base opens in its neutral expression with every facial target disabled',()=>{for(const m of glb().meshes)for(const w of m.weights??[])assert.equal(w,0,'exported facial targets are active by default');});
