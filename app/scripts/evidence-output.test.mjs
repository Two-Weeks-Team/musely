import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openEvidenceOutput} from './lib/evidence-output.mjs';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'musely-output-unit-'));t.after(()=>rm(dir,{recursive:true,force:true}));const source=join(dir,'source');await mkdir(source);return{dir,source};}
test('default output retains the new-directory-only contract',async t=>{
 const {dir,source}=await fixture(t),directory=join(dir,'new');const file=await openEvidenceOutput({directory,source,pin:{version:'test'}});
 assert.equal(file('summary.json'),join(directory,'summary.json'));assert.deepEqual(JSON.parse(await readFile(file('pin.json'),'utf8')),{version:'test'});
 await assert.rejects(openEvidenceOutput({directory,source,pin:{}}));
});
test('a prefixed run uses an existing directory and preserves all historical bytes',async t=>{
 const {dir,source}=await fixture(t),directory=join(dir,'existing');await mkdir(directory);for(const name of['pin.json','summary.json','raw-00000.json','samples.jsonl'])await writeFile(join(directory,name),'HISTORICAL '+name);
 const before=await Promise.all((await readdir(directory)).map(async n=>[n,await readFile(join(directory,n),'utf8')]));
 const file=await openEvidenceOutput({directory,source,prefix:'final-1105',pin:{version:'new'}});await writeFile(file('raw-00000.json'),'new sample',{flag:'wx'});await writeFile(file('summary.json'),'new result');
 assert.equal(file('samples.jsonl'),join(directory,'final-1105-samples.jsonl'));for(const[n,body]of before)assert.equal(await readFile(join(directory,n),'utf8'),body);
});
test('a prior partial prefix or simultaneous same-prefix invocation cannot overwrite a run',async t=>{
 const {dir,source}=await fixture(t),directory=join(dir,'existing');await mkdir(directory);await writeFile(join(directory,'partial-summary.json'),'KEEP');
 await assert.rejects(openEvidenceOutput({directory,source,prefix:'partial',pin:{}}));assert.equal(await readFile(join(directory,'partial-summary.json'),'utf8'),'KEEP');
 const outcomes=await Promise.allSettled([1,2].map(n=>openEvidenceOutput({directory,source,prefix:'shared',pin:{n}})));assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.ok([1,2].includes(JSON.parse(await readFile(join(directory,'shared-pin.json'),'utf8')).n));
});
test('invalid prefixes, missing existing directories and source-contained output fail without writing',async t=>{
 const {dir,source}=await fixture(t);for(const prefix of['','../escape','with/slash','bad value','a'.repeat(65)])await assert.rejects(openEvidenceOutput({directory:dir,source,prefix,pin:{}}));
 await assert.rejects(openEvidenceOutput({directory:join(dir,'missing'),source,prefix:'x',pin:{}}));await assert.rejects(openEvidenceOutput({directory:source,source,prefix:'x',pin:{}}));assert.deepEqual(await readdir(source),[]);
});
