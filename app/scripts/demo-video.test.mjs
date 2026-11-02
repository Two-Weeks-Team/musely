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

import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
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

// Offline fixture bytes only; these are never browser footage or account/deployment receipts.
async function mediaFixture(t){
 const dir=await mkdtemp(join(tmpdir(),'d05-offline-media-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const p=createPlan();Object.assign(p.release,{frozen:true,sourceSha:'a'.repeat(40),deployId:'fixture',configVersion:'fixture',htmlSha256:'b'.repeat(64),modelIds:['fixture'],attestation:'fixture'});for(const k in p.review)p.review[k]=true;
 for(const c of p.cuts){c.refs=[{...ref,runId:'A'}];c.seekSec=0;c.snapshotHash='c'.repeat(64);if(c.id==='s05'){c.refs.push({...ref,runId:'B',eventId:'eB',requestId:'reqB'});c.views=[{id:'before',runId:'A',duration:10,seekSec:0,snapshotHash:'c'.repeat(64)},{id:'after',runId:'B',duration:10,seekSec:0,snapshotHash:'d'.repeat(64)}];}
 for(const r of c.refs){const raw=JSON.stringify({runId:r.runId,runIdStored:true,run:{runId:r.runId,schemaVersion:'run-log-2'},input:{seq:r.inputSeq,runId:r.runId},event:{id:r.eventId,runId:r.runId,inputSeq:r.inputSeq,source:r.originalSource,data:{evidence:{requestId:r.requestId}}}});r.file=c.id+'-'+r.runId+'.event.json';r.sha256=sha(raw);await writeFile(join(dir,r.file),raw);}
 c.media=[];for(const v of c.views.length?c.views:[{id:'main',runId:'A',duration:c.duration,seekSec:0,snapshotHash:c.snapshotHash}]){
  const file=c.id+'-'+v.id+'.NOT-VIDEO',receiptFile=file+'.json',bytes=Buffer.from('OFFLINE NOT VIDEO '+file),refs=c.refs.filter(r=>r.runId===v.runId),takeId=c.id+'-'+v.id;
  await writeFile(join(dir,file),bytes);const receipt={schema:'musely-demo-capture-2',kind:'recorded_public_capture',cutId:c.id,viewId:v.id,takeId,release:structuredClone(p.release),runId:v.runId,seekSec:v.seekSec,durationSeconds:v.duration,label:'REPLAY',virtual:true,originalSources:['live'],startOffsetSec:0,blockedRequests:0,refs,observed:{runId:v.runId,hash:v.snapshotHash,label:true},media:{file,sha256:sha(bytes),bytes:bytes.length}};
  await writeFile(join(dir,receiptFile),JSON.stringify(receipt));c.media.push({file,sha256:sha(bytes),receipt:receiptFile,viewId:v.id,takeId,runId:v.runId,duration:v.duration,refs});
 }}return {dir,p};
}
test('D05 media set requires exactly one before and after take; A/A cannot stand in for A/B',async t=>{
 const {verifyMedia}=await import('./lib/demo-video.mjs'),{dir,p}=await mediaFixture(t);assert.equal((await verifyMedia(p,dir)).length,13);
 const c=p.cuts[4],original=c.media;c.media=[original[1],original[0]];await assert.rejects(()=>verifyMedia(p,dir),/view_set_mismatch/);c.media=[original[0],{...original[0]}];await assert.rejects(()=>verifyMedia(p,dir),/view_set_mismatch/);
});
test('D05 byte/file binding rejects another take or synthetic media even when the plan hash is updated',async t=>{
 const {verifyMedia}=await import('./lib/demo-video.mjs'),{dir,p}=await mediaFixture(t),m=p.cuts[0].media[0];
 const originalFile=m.file,originalBytes=await readFile(join(dir,m.file));await writeFile(join(dir,'same-bytes.NOT-VIDEO'),originalBytes);m.file='same-bytes.NOT-VIDEO';
 await assert.rejects(()=>verifyMedia(p,dir),/media_binding_mismatch/);
 m.file=originalFile;const replacement=Buffer.from('OFFLINE SYNTHETIC CALIBRATION NOT FOOTAGE');await writeFile(join(dir,m.file),replacement);m.sha256=sha(replacement);
 await assert.rejects(()=>verifyMedia(p,dir),/media_binding_mismatch/);
});
test('D05 receipts bind release, view, run, duration, exact refs and original source labels',async t=>{
 const {verifyMedia}=await import('./lib/demo-video.mjs'),{dir,p}=await mediaFixture(t),m=p.cuts[0].media[0],path=join(dir,m.receipt);const original=JSON.parse(await readFile(path,'utf8'));
 for(const mutate of [r=>r.release.deployId='other',r=>r.viewId='after',r=>r.runId='other',r=>r.durationSeconds=1,r=>r.refs=[],r=>r.refs[0].requestId='unrelated',r=>r.originalSources=['scripted'],r=>r.label='LIVE',r=>r.observed.runId='other',r=>r.media.bytes++]){const next=structuredClone(original);mutate(next);await writeFile(path,JSON.stringify(next));await assert.rejects(()=>verifyMedia(p,dir),/capture_receipt_mismatch|captured_refs_mismatch|media_binding_mismatch/);}
});

test('D05 validates named P1 views and refuses duplicated checkpoints or missing sides before capture',async()=>{
 const p=createPlan(),c=p.cuts[4];c.refs=[{...ref,runId:'A'},{...ref,runId:'B'}];c.views=[{id:'before',runId:'A',duration:10,seekSec:0,snapshotHash:'c'.repeat(64)},{id:'after',runId:'B',duration:10,seekSec:0,snapshotHash:'d'.repeat(64)}];assert.ok(!validatePlan(p).includes('s05:before_after_views_required'));
 c.views[1]={...c.views[0],id:'after'};assert.ok(validatePlan(p).includes('s05:before_after_views_required'));c.views.pop();assert.ok(validatePlan(p).includes('s05:before_after_views_required'));
});

test('D05 explicit P1 view and exact take duration are required before HTML GET or browser allocation',async t=>{
 const {dir,p}=await mediaFixture(t);let allocated=false;const browser={newContext(){allocated=true;throw Error('must not allocate');}};
 await assert.rejects(()=>captureDemoCut(browser,p,'s05',dir),/explicit_view_required/);
 await assert.rejects(()=>captureDemoCut(browser,p,'s05',dir,{viewId:'before',runId:'B'}),/mismatch/);
 await assert.rejects(()=>captureDemoCut(browser,p,'s05',dir,{viewId:'before',seconds:20}),/take_duration_must_match_view/);
 assert.equal(allocated,false);
});

// No real browser or network: the route callback is exercised with explicit fake requests and bytes.
async function captureFixture(t,{bootstrap=[],recording=[]}={}){
 const {dir,p}=await mediaFixture(t),cut=p.cuts[11];cut.duration=1/16;p.cuts[0].duration+=6-cut.duration;
 const html='OFFLINE FROZEN HTML',before=globalThis.fetch;globalThis.fetch=async()=>new Response(html);t.after(()=>{globalThis.fetch=before;});p.release.htmlSha256=sha(html);
 let route,videoPath,mediaDir,bodyReads=0;const aborted=[],continued=[];
 const fire=async ({path,method='GET',origin=p.origin})=>{const url=origin+path,request={url:()=>url,method:()=>method,postData(){bodyReads++;throw Error('body must not be read');},headers(){throw Error('headers must not be read');}};await route({request:()=>request,abort:async()=>aborted.push({path,method}),continue:async()=>continued.push({path,method})});};
 const button=name=>({click:async()=>{if(name==='Play recorded run')for(const r of recording)await fire(r);}}),root={getByRole:(_role,{name})=>button(name),locator:()=>({fill:async()=>{},dispatchEvent:async()=>{},selectOption:async()=>{}}),evaluate:async()=>({runId:'A',hash:cut.snapshotHash,label:true})};
 const page={video:()=>({path:async()=>videoPath}),goto:async()=>{for(const r of bootstrap)await fire(r);},waitForFunction:async()=>{},locator:()=>root,evaluate:async fn=>fn.toString().includes('projection.events')?cut.refs.map(r=>r.eventId):undefined};
 const browser={newContext:async options=>{mediaDir=options.recordVideo.dir;videoPath=join(mediaDir,'OFFLINE-FIXTURE.NOT-VIDEO');await writeFile(videoPath,'OFFLINE MOCK BYTES NOT FOOTAGE');return {route:async(_pattern,fn)=>{route=fn;},newPage:async()=>page,close:async()=>{}};}};
 return {dir,p,cut,browser,aborted,continued,get mediaDir(){return mediaDir;},get bodyReads(){return bodyReads;}};
}
test('D05 bootstrap private read and exact telemetry stay aborted and audited without rejecting a take',async t=>{
 const f=await captureFixture(t,{bootstrap:[{path:'/api/owner/location'},{path:'/cdn-cgi/rum',method:'POST'}],recording:[{path:'/cdn-cgi/rum',method:'POST'}]});
 const media=await captureDemoCut(f.browser,f.p,'s12',f.dir),receipt=JSON.parse(await readFile(join(f.dir,media.receipt),'utf8'));
 assert.equal(receipt.blockedRequests,0);assert.equal(receipt.bootstrapDeniedReads.length,1);assert.equal(receipt.deniedTelemetry.length,2);assert.equal(receipt.continuedWriteRequests,0);assert.equal(receipt.denialsAreAccessReceipts,false);assert.equal(f.aborted.length,3);assert.equal(f.continued.length,0);assert.equal(f.bodyReads,0);
 const audit=JSON.parse(await readFile(join(f.mediaDir,'network-audit.json'),'utf8'));assert.equal(audit.bootstrapDeniedReads.length,1);assert.equal(audit.deniedTelemetry.length,2);
 const {verifyMedia}=await import('./lib/demo-video.mjs');f.cut.media=[media];assert.equal((await verifyMedia({...f.p,cuts:[f.cut]},f.dir)).length,1);receipt.bootstrapDeniedReads[0].phase='recording';await writeFile(join(f.dir,media.receipt),JSON.stringify(receipt));await assert.rejects(()=>verifyMedia({...f.p,cuts:[f.cut]},f.dir),/denied_request_audit_mismatch/);
});
test('D05 owner-location GET after take start remains fatal and its denied audit is retained',async t=>{
 const f=await captureFixture(t,{recording:[{path:'/api/owner/location'},{path:'/api/owner/inbox?token=DO-NOT-PERSIST'}]});
 await assert.rejects(()=>captureDemoCut(f.browser,f.p,'s12',f.dir),/capture_blocked_requests:2/);
 const raw=await readFile(join(f.mediaDir,'network-audit.json'),'utf8'),audit=JSON.parse(raw);assert.equal(audit.fatalDeniedRequests.length,2);assert.equal(audit.bootstrapDeniedReads.length,0);assert.equal(audit.continuedWriteRequests,0);assert.ok(!raw.includes('DO-NOT-PERSIST'));assert.equal(f.bodyReads,0);
});
test('D05 exception classification permits no new request and is exact in origin/method/path/phase',async()=>{
 const {captureRequestPolicy}=await import('./lib/demo-video.mjs'),o='https://musely.net';
 assert.equal(captureRequestPolicy(o+'/api/owner/location','GET',o,'bootstrap'),'bootstrap-denied-read');assert.equal(captureRequestPolicy(o+'/cdn-cgi/rum','POST',o,'recording'),'denied-telemetry');
 for(const [path,method,phase,origin] of [['/api/owner/location','GET','recording'],['/api/owner/location','POST','bootstrap'],['/api/owner/location?x=1','GET','bootstrap'],['/api/owner/inbox','GET','bootstrap'],['/api/world/spotlight','POST','bootstrap'],['/mcp','POST','recording'],['/cdn-cgi/rum?x=1','POST','recording'],['/cdn-cgi/RUM','POST','bootstrap'],['/cdn-cgi/rum','GET','bootstrap'],['/cdn-cgi/rum','POST','recording','https://other.invalid'],['/api/owner/location','GET','bootstrap','https://other.invalid'],['/other-telemetry','POST','recording']])assert.equal(captureRequestPolicy((origin??o)+path,method,o,phase),'fatal-denied',path);
});

test('D05 unrelated private reads and world writes remain fatal even during bootstrap',async t=>{
 const f=await captureFixture(t,{bootstrap:[{path:'/api/owner/inbox'},{path:'/api/world/spotlight',method:'POST'}]});
 await assert.rejects(()=>captureDemoCut(f.browser,f.p,'s12',f.dir),/capture_blocked_requests:2/);
 const audit=JSON.parse(await readFile(join(f.mediaDir,'network-audit.json'),'utf8'));assert.equal(audit.fatalDeniedRequests.length,2);assert.equal(audit.bootstrapDeniedReads.length,0);assert.equal(audit.continuedWriteRequests,0);assert.equal(f.aborted.length,2);assert.equal(f.continued.length,0);assert.equal(f.bodyReads,0);
});
