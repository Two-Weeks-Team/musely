import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {emitCampfireAsset} from './emit-asset.mjs';
import descriptor from './asset.json' with {type:'json'};
test('deferred asset emitter produces exact pinned path and bytes without inline base64',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'campfire-'));try{
 const path=await emitCampfireAsset(dir,async(d,name,ext,bytes)=>{const path=`assets/${name}.${createHash('sha256').update(bytes).digest('hex')}.${ext}`;await mkdir(join(d,'assets'));await writeFile(join(d,path),bytes);return path;});
 assert.equal('/'+path,descriptor.url);assert.equal((await readFile(join(dir,path))).length,descriptor.bytes);
 const source=await readFile(new URL('./scene-port.mjs',import.meta.url),'utf8');assert.ok(!source.includes('asset-bytes.json'));assert.ok(!source.includes('atob('));
 }finally{await rm(dir,{recursive:true,force:true});}
});
