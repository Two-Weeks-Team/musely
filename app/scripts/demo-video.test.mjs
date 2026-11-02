import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlan, publicReadAllowed, validatePlan, validateReference} from './lib/demo-video.mjs';

test('D05 prepares exactly 180 seconds and cannot accept pending release or missing event links',()=>{
 const p=createPlan();assert.equal(p.cuts.reduce((n,c)=>n+c.duration,0),180);
 assert.ok(validatePlan(p).includes('release_not_frozen'));assert.ok(validatePlan(p).some(x=>x.endsWith(':missing_refs')));
 p.release.frozen=true;p.cuts[0].duration+=1;assert.ok(validatePlan(p).includes('duration_must_be_180'));
 p.cuts[0].label='LIVE';assert.ok(validatePlan(p).includes('s01:replay_label_required'));
 p.cuts[0].virtual=false;assert.ok(validatePlan(p).includes('s01:virtual_label_required'));
});
test('D05 public source boundary rejects credentials, private paths, writes, redirects and another origin',()=>{
 const root='https://musely.net';
 for(const path of ['/','/api/status','/api/world/highlights?limit=100','/api/world/event?id=event-1'])assert.equal(publicReadAllowed(root+path,root),true,path);
 for(const url of [root+'/api/owner/inbox',root+'/api/claim',root+'/mcp',root+'/?token=secret',root+'/api/world/event?id=a&key=secret','https://other.test/api/world','https://u:p@musely.net/api/world'])assert.equal(publicReadAllowed(url,root),false,url);
 assert.equal(publicReadAllowed(root+'/api/world',root,'POST'),false);
});
const row={runId:'r',runIdStored:true,run:{runId:'r',schemaVersion:'run-log-2'},input:{seq:2,runId:'r'},event:{id:'e',runId:'r',inputSeq:2,source:'live',kind:'spotlight',data:{evidence:{model:'Muse Spark',requestId:'req'}}}};
const ref={runId:'r',inputSeq:2,eventId:'e',originalSource:'live',requestId:'req',signedVerdict:null};
test('D05 actual event/run/commit and model request joins reject superficially plausible mismatches',()=>{
 assert.deepEqual(validateReference(ref,row),[]);
 for(const [key,value] of [['runId','wrong'],['inputSeq',3],['eventId','wrong'],['originalSource','rule'],['requestId','invented']])assert.ok(validateReference({...ref,[key]:value},row).length,key);
 assert.ok(validateReference({...ref,requestId:null,signedVerdict:'verified'},row).length);
 assert.ok(validateReference(ref,{...row,run:{schemaVersion:'run-log-1'}}).includes('run_log_2_required'));
});

import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyBundle,sha,inside,publicGet,collect} from './lib/demo-video.mjs';
test('D05 immutable raw references reject substitution and traversal; valid support rows do not invent model calls',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'d05-test-'));try{
 const p=createPlan(),raw=JSON.stringify(row);await writeFile(join(dir,'event.json'),raw);p.cuts[0].refs=[{...ref,file:'event.json',sha256:sha(raw)}];
 assert.ok(!(await verifyBundle(p,dir)).includes('s01:raw_hash_mismatch'));
 await writeFile(join(dir,'event.json'),raw+' ');assert.ok((await verifyBundle(p,dir)).includes('s01:raw_hash_mismatch'));
 assert.throws(()=>inside(dir,'../private.json'),/unsafe_relative_path/);assert.throws(()=>inside(dir,'/absolute.json'),/unsafe_relative_path/);
 assert.deepEqual(validateReference({...ref,requestId:null,role:'support'},row),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('D05 public GET collection omits credentials, rejects redirect/secret responses and cannot infer freeze',async()=>{
 let opts;await publicGet('https://musely.net/api/status','https://musely.net',async(_url,o)=>{opts=o;return new Response('{}');});
 assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');assert.equal(opts.method,'GET');assert.ok(!opts.headers.authorization);
 await assert.rejects(()=>publicGet('https://musely.net/api/status','https://musely.net',async()=>({ok:true,redirected:true,status:200})),/public_read_http/);
 await assert.rejects(()=>publicGet('https://musely.net/api/status','https://musely.net',async()=>new Response(JSON.stringify({key:'msly_'+'a'.repeat(43)}))),/sensitive/);
 const dir=await mkdtemp(join(tmpdir(),'d05-test-'));try{const p=await collect(createPlan(),dir,async()=>new Response('{}'));assert.equal(p.release.frozen,false);assert.equal(p.observations.length,4);await assert.rejects(()=>collect(createPlan(),dir,async()=>new Response('{}')),/EEXIST/);}finally{await rm(dir,{recursive:true,force:true});}
});

import {captureDemoCut} from './demo-capture.mjs';
test('D05 cannot allocate a browser context before final release and evidence gates',async()=>{
 let allocated=false;await assert.rejects(()=>captureDemoCut({newContext(){allocated=true;}},createPlan(),'s01','/not-used'),/release_not_frozen/);assert.equal(allocated,false);
});
