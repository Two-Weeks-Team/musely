import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {Box3,Vector3} from 'three';
import {MaterialLibrary} from '../src/character-kit/MaterialLibrary.ts';
import {loadWorldCharacters} from '../src/character-kit/WorldCharacters.ts';
import {deriveClipsGlb} from './clips-glb.mjs';
const parse=async b=>new GLTFLoader().register(()=>({name:'GeometryOnlyAudit',loadTexture:async()=>null})).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
const legacy=await parse(await readFile('assets/muse_base.glb'));
const height=new Box3().setFromObject(legacy.scene).getSize(new Vector3()).y;
const asset={glb:'/legacy.glb',sigils:['/a.png','/b.png'],height};
const files=new Map();
const library=()=>new MaterialLibrary('/character-kit/runtime/',{loadAsync:async url=>{
 const path=url.replace('/character-kit/runtime/','');if(!files.has(path))files.set(path,(async()=>parse(path==='base/clips.glb'?deriveClipsGlb(await readFile('character-kit/runtime/base/lod0.glb')):await readFile('character-kit/runtime/'+path)))());return files.get(path);
}});
test('normal real rigged actors never request or decode legacy GLB and sigils',async()=>{
 let reads=0;const loaded=await loadWorldCharacters(asset,library(),async()=>{reads++;return {source:legacy.scene,textures:[]};});
 assert.equal(loaded.light.length,8);assert.equal(reads,0,'normal rigged world must exclude fallback transfer/parse');assert.equal(loaded.source,null);assert.equal(loaded.sourceHeight,height);
 loaded.light.forEach(x=>x.actor.dispose());
});
test('explicit legacy mode loads the original source exactly once and preserves its height',async()=>{
 let reads=0;const loaded=await loadWorldCharacters(asset,null,async a=>{reads++;assert.deepEqual(a,asset);return {source:legacy.scene,textures:[]};});
 assert.equal(reads,1);assert.equal(loaded.light,null);assert.equal(loaded.source,legacy.scene);assert.equal(loaded.sourceHeight,height);
});
test('complete kit failure still loads a real legacy source instead of hiding the error',async()=>{
 let reads=0;const loaded=await loadWorldCharacters(asset,{load:async()=>{throw Error('offline kit');}},async()=>{reads++;return {source:legacy.scene,textures:[]};});
 assert.equal(reads,1);assert.equal(loaded.light,null);assert.equal(loaded.source,legacy.scene);
});
test('a variant material failure uses the plain kit base, not the legacy source',async()=>{
 const lib=library(),fleece=lib.fleece.bind(lib);lib.fleece=(id,m)=>{if(id==='01-sunny')throw Error('unavailable variant material');return fleece(id,m);};
 let reads=0;const loaded=await loadWorldCharacters(asset,lib,async()=>{reads++;return {source:legacy.scene,textures:[]};});
 assert.equal(reads,0);assert.equal(loaded.light.length,8);assert.equal(loaded.light[1].actor.variant,'00-jolly');loaded.light.forEach(x=>x.actor.dispose());
});
