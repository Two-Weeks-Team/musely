import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,copyFile,cp,symlink,readFile,writeFile,rm,access}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{spawnSync}from'node:child_process';
test('character proof builds its current world source independently of absent or stale production dist',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'musely-proof-test-'));
 try{
  await Promise.all([mkdir(join(temp,'scripts')),mkdir(join(temp,'character-kit/runtime/base'),{recursive:true}),cp('src',join(temp,'src'),{recursive:true}),cp('assets',join(temp,'assets'),{recursive:true}),symlink(resolve('node_modules'),join(temp,'node_modules'),'dir')]);
  for(const file of['build-character-proof.mjs','prepare-assets.mjs','embedding.mjs'])await copyFile('scripts/'+file,join(temp,'scripts',file));
  await mkdir(join(temp,'character-kit/runtime/animations'),{recursive:true});await copyFile('character-kit/runtime/animations/manifest.json',join(temp,'character-kit/runtime/animations/manifest.json'));
  await copyFile('character-kit/runtime/base/lod0.glb',join(temp,'character-kit/runtime/base/lod0.glb'));
  const build=()=>{const r=spawnSync(process.execPath,['scripts/build-character-proof.mjs'],{cwd:temp,encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);};
  build();await assert.rejects(access(join(temp,'dist')));const first=await readFile(join(temp,'dist-character-proof/world/index.html'),'utf8');assert.ok(first.includes('Musely'));
  await mkdir(join(temp,'dist'));await writeFile(join(temp,'dist/index.html'),'STALE_PRODUCTION_DOCUMENT');const template=join(temp,'src/index.html');await writeFile(template,(await readFile(template,'utf8')).replace('<title>','<title>FRESH_PROOF_SOURCE '));
  build();const next=await readFile(join(temp,'dist-character-proof/world/index.html'),'utf8');assert.ok(next.includes('FRESH_PROOF_SOURCE'));assert.ok(!next.includes('STALE_PRODUCTION_DOCUMENT'));assert.equal(await readFile(join(temp,'dist/index.html'),'utf8'),'STALE_PRODUCTION_DOCUMENT');
 }finally{await rm(temp,{recursive:true,force:true});}
});
