import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile as sourceRead,mkdtemp,mkdir,cp,copyFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyAssetManifest} from './asset-files.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
let fixture;
const readFile=(path,...args)=>sourceRead(join(fixture,path),...args);
before(async()=>{
 fixture=await mkdtemp(join(tmpdir(),'musely-transport-build-'));
 await mkdir(join(fixture,'scripts'));await mkdir(join(fixture,'character-kit'));
 for(const dir of ['src','assets','fixtures','static'])await cp(dir,join(fixture,dir),{recursive:true});
 await cp('character-kit/runtime',join(fixture,'character-kit/runtime'),{recursive:true});await copyFile('character-kit/manifest.json',join(fixture,'character-kit/manifest.json'));
 for(const file of ['build.mjs','prepare-assets.mjs','embedding.mjs','asset-files.mjs','device-metrics.mjs','clips-glb.mjs'])await copyFile('scripts/'+file,join(fixture,'scripts',file));
 await symlink(resolve('node_modules'),join(fixture,'node_modules'),'dir');
 const result=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:fixture,encoding:'utf8'});assert.equal(result.status,0,result.stderr+result.stdout);
});
after(async()=>{if(fixture)await rm(fixture,{recursive:true,force:true});});
// Re-pin the changed script and its referring document so graph tests cannot pass via a stale filename.
async function scriptWithSuffix(suffix,role='app'){
 const manifest=JSON.parse(await readFile('dist/asset-manifest.json','utf8')),file=manifest.files.find(f=>f.role===role),oldPath=file.path;
 const body=Buffer.concat([await readFile('dist/'+oldPath),Buffer.from('\n'+suffix)]);
 file.bytes=body.length;file.sha256=sha(body);file.path=oldPath.replace(/\.[a-f0-9]{64}\.js$/,'.'+file.sha256+'.js');
 const changed=new Map([[file.path,body]]);
 for(const html of manifest.files.filter(f=>f.path.endsWith('.html'))){
  const previous=await readFile('dist/'+html.path),next=Buffer.from(previous.toString().replaceAll('/'+oldPath,'/'+file.path));
  if(!previous.equals(next)){html.bytes=next.length;html.sha256=sha(next);changed.set(html.path,next);}
 }
 manifest.critical.paths=manifest.critical.paths.map(p=>p===oldPath?file.path:p);
 manifest.dynamicReferences=manifest.dynamicReferences.map(p=>p===oldPath?file.path:p);
 manifest.critical.bytes=manifest.critical.paths.reduce((n,p)=>n+manifest.files.find(f=>f.path===p).bytes,0);
 return {manifest,read:p=>changed.has(p)?Promise.resolve(changed.get(p)):readFile('dist/'+p)};
}
test('release HTML delegates to hashed same-origin code, not a megabyte inline payload',async()=>{
 const html=await readFile('dist/index.html','utf8');
 const script=/<script defer src="(\/assets\/[^"<>]+\.js)"><\/script>/.exec(html);
 assert.ok(script,'production app is a same-origin deferred hash script');
 assert.match(html,/<link rel="stylesheet" href="\/assets\/[^"<>]+\.css">/);
 assert.ok(Buffer.byteLength(html)<20000,'small document alone is not an entry-completion claim');
 const js=await readFile('dist'+script[1],'utf8');assert.ok(js.includes('arrival-overview'),'overview stays in A');
 assert.ok(!js.includes('data:model/gltf-binary;base64,'),'legacy model is not eagerly transmitted');
 for(const path of['variant_a.png','variant_b.png'])assert.ok(!js.includes((await readFile('assets/'+path)).toString('base64').slice(0,160)),'actual legacy sigil bytes are not eagerly transmitted');
});
test('manifest binds full initial closure and every legacy/runtime byte, not only the small HTML',async()=>{
 const m=JSON.parse(await readFile('dist/asset-manifest.json','utf8'));
 assert.equal(m.schemaVersion,'musely-assets-1');
 const byPath=new Map(m.files.map(f=>[f.path,f]));assert.equal(byPath.size,m.files.length);
 for(const f of m.files){const b=await readFile('dist/'+f.path);assert.equal(b.length,f.bytes,f.path);assert.equal(sha(b),f.sha256,f.path);}
 for(const role of ['app','style','map-worker','legacy-model','legacy-sigil'])assert.ok(m.files.some(f=>f.role===role),role);
 assert.ok(m.critical.paths.some(p=>p.endsWith('.js')));assert.ok(m.critical.paths.some(p=>p.endsWith('.cjs')));
 assert.ok(m.critical.paths.includes('character-kit/runtime/base/lod2.glb'));assert.ok(m.critical.paths.includes('character-kit/runtime/base/clips.glb'));
 assert.equal(m.critical.bytes,m.critical.paths.reduce((n,p)=>n+byPath.get(p).bytes,0));
 assert.equal(m.critical.logicalDeadlineMs,12000);assert.equal(m.critical.maxBytes,16777216);
 const kit=JSON.parse(await readFile('character-kit/manifest.json','utf8'));
 for(const [p,v]of Object.entries(kit.files))assert.equal(byPath.get('character-kit/runtime/'+p)?.sha256,v.sha256,p);
 const legacy=JSON.parse(await readFile('assets/source-manifest.json','utf8'));
 for(const v of Object.values(legacy))assert.ok(m.files.some(f=>f.sha256===v.sha256&&f.bytes===v.bytes),'source legacy bytes preserved');
});
test('only content-hash URLs receive immutable and the worker gets a JavaScript MIME type',async()=>{
 const headers=await readFile('dist/_headers','utf8');
 assert.match(headers,/\/assets\/\*[\s\S]*Cache-Control: public, max-age=31536000, immutable/);
 assert.match(headers,/\/\n  Cache-Control: no-cache/);
 assert.ok(!/character-kit[^\n]*\n\s+Cache-Control:.*immutable/.test(headers));
 assert.match(headers,/\/assets\/\*\.cjs\n  Content-Type: text\/javascript/);
});
test('unlisted static script or dynamic worker fails even after the tampered file is rehashed',async()=>{
 for(const kind of ['html','script']){
  if(kind==='script'){
   const {manifest,read}=await scriptWithSuffix('const missingWorker="/assets/missing.cjs";');
   await assert.rejects(verifyAssetManifest(manifest,read),/Unlisted runtime reference/);continue;
  }
  const m=JSON.parse(await readFile('dist/asset-manifest.json','utf8'));
  const target=kind==='html'?m.files.find(f=>f.path==='index.html'):m.files.find(f=>f.role==='app');
  const original=await readFile('dist/'+target.path);
  const bytes=Buffer.concat([original,Buffer.from(kind==='html'?'<script src="/assets/missing.js"></script>':'\nconst missingWorker="/assets/missing.cjs";')]);
  const delta=bytes.length-target.bytes;target.bytes=bytes.length;target.sha256=sha(bytes);m.critical.bytes+=delta;
  await assert.rejects(verifyAssetManifest(m,p=>p===target.path?Promise.resolve(bytes):readFile('dist/'+p)),/Unlisted runtime reference/);
 }
});
test('runtime file omission, byte mutation and small-HTML-only critical accounting are rejected',async()=>{
 const original=JSON.parse(await readFile('dist/asset-manifest.json','utf8'));
 const missing=structuredClone(original),path='character-kit/runtime/attachments/09-copper.glb';missing.files=missing.files.filter(f=>f.path!==path);missing.dynamicReferences=missing.dynamicReferences.filter(p=>p!==path);
 await assert.rejects(verifyAssetManifest(missing,p=>readFile('dist/'+p),{requiredRuntimePaths:[path]}),/Unlisted runtime reference/);
 await assert.rejects(verifyAssetManifest(original,async p=>p===path?Buffer.from('wrong'):readFile('dist/'+p)),/Asset hash mismatch/);
 const tiny=structuredClone(original);tiny.critical.paths=['index.html'];tiny.critical.bytes=tiny.files.find(f=>f.path==='index.html').bytes;
 await assert.rejects(verifyAssetManifest(tiny,p=>readFile('dist/'+p)),/Critical resource omitted/);
});
test('a new root resource namespace or a query on a known hash URL cannot evade closure validation',async()=>{
 for(const variant of ['new-namespace','query','encoded']){
  const m=JSON.parse(await readFile('dist/asset-manifest.json','utf8')),known=m.files.find(f=>f.role==='map-worker');
  const suffix=variant==='query'?'/'+known.path+'?unexpected=1':variant==='encoded'?'/assets/%6dissing.js':'/new-models/not-listed.glb';
  const {manifest,read}=await scriptWithSuffix('const unknownResource='+JSON.stringify(suffix)+';');
  await assert.rejects(verifyAssetManifest(manifest,read),/Unlisted runtime reference|Unpinned runtime URL/);
 }
});
test('rehashing a changed body cannot reuse an old immutable filename',async()=>{
 const m=JSON.parse(await readFile('dist/asset-manifest.json','utf8')),file=m.files.find(f=>f.role==='style'),path=file.path;
 const body=Buffer.concat([await readFile('dist/'+path),Buffer.from('\n/* changed CSS */')]);
 m.critical.bytes+=body.length-file.bytes;file.bytes=body.length;file.sha256=sha(body);
 await assert.rejects(verifyAssetManifest(m,p=>p===path?Promise.resolve(body):readFile('dist/'+p)),/Immutable URL hash mismatch/);
});
test('relative workers and explicit URL constructors must resolve to listed resources',async()=>{
 for(const suffix of ['new Worker("./not-listed.cjs");','new SharedWorker("../not-listed.cjs");','new Worker(new URL("./not-listed.cjs",import.meta.url));','new Worker(new URL("../not-listed.cjs",document.baseURI));']){
  const {manifest,read}=await scriptWithSuffix(suffix,suffix.includes('import.meta.url')?'character-viewer':'app');
  await assert.rejects(verifyAssetManifest(manifest,read),/Unlisted runtime reference/);
 }
});
test('a plain relative Worker uses its document directory while import.meta.url uses the script',async()=>{
 const original=JSON.parse(await readFile('dist/asset-manifest.json','utf8')),worker=original.files.find(f=>f.role==='map-worker'),name=worker.path.split('/').at(-1);
 for(const [role,suffix]of [['app','new Worker('+JSON.stringify(worker.path)+');'],['character-viewer','new Worker('+JSON.stringify('../'+worker.path)+');'],['character-viewer','new Worker(new URL('+JSON.stringify('./'+name)+',import.meta.url));']]){
  const {manifest,read}=await scriptWithSuffix(suffix,role);assert.equal((await verifyAssetManifest(manifest,read)).files,29);
 }
 const {manifest,read}=await scriptWithSuffix('new Worker('+JSON.stringify('./'+name)+');');
 await assert.rejects(verifyAssetManifest(manifest,read),/Unlisted runtime reference/);
});
