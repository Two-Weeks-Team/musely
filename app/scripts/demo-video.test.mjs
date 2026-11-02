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

// Each invocation creates new local writer records; fixture data never stands in for filmed/production evidence.
async function controlledBundle(t){
 const {controlledFixture}=await import('./test-support/controlled-p1.mjs'),{loadRun}=await import('../src/replay/player.ts');
 const {dir,p}=await mediaFixture(t),bundle=controlledFixture(p.release.sourceSha,p.release.htmlSha256),c=p.cuts[4];
 const save=async(file,value)=>{const raw=JSON.stringify(value);await writeFile(join(dir,file),raw);return{file,sha256:sha(raw)};};
 const pair=await save('controlled-pair.json',bundle.pair),before=await save('without.run.json',bundle.before.record),after=await save('with.run.json',bundle.after.record);
 for(const d of[pair,before,after])bundle.manifest.files[d.file]={sha256:d.sha256,bytes:Buffer.byteLength(await readFile(join(dir,d.file)))};
 const manifest=await save('controlled-manifest.json',bundle.manifest);c.controlledPair={label:'CONTROLLED COMPARISON (SIMULATION)',manifest,pair,before,after};p.tooling={version:'musely-demo-tools-2',sourceSha:'f'.repeat(40)};
 c.refs=[];c.views=[];for(const [id,variant,x]of[['before','without',bundle.before],['after','with',bundle.after]]){const event=x.record.events.find(e=>e.muse==='03-ripple'&&(variant==='without'?e.kind==='decision_rejected':e.kind==='depart'&&e.data.speed==='bus')),r={runId:x.record.runId,inputSeq:event.inputSeq,eventId:event.id,originalSource:event.source,requestId:null,signedVerdict:null,role:'controlled-p1'};Object.assign(r,await save(id+'.controlled-event.json',x.eventRecords[event.id]));c.refs.push(r);const player=loadRun(x.record);player.seek(65);c.views.push({id,runId:x.record.runId,duration:10,seekSec:65,snapshotHash:player.getFrame().snapshotHash});}
 return{dir,p,c,bundle,save};
}
test('D05 s05 can use a pinned actual controlled pair without inventing model or signed anchors',async t=>{
 const{verifyBundle}=await import('./lib/demo-video.mjs'),f=await controlledBundle(t);assert.deepEqual(await verifyBundle(f.p,f.dir),[]);assert.ok(f.c.refs.every(r=>!r.requestId&&!r.signedVerdict&&r.role==='controlled-p1'));
});
async function controlledMedia(t){
 const f=await controlledBundle(t);for(const cut of f.p.cuts)for(const m of cut.media??[]){const path=join(f.dir,m.receipt),receipt=JSON.parse(await readFile(path,'utf8'));receipt.tooling=structuredClone(f.p.tooling);await writeFile(path,JSON.stringify(receipt));}f.c.media=[];for(const v of f.c.views){const file='CONTROLLED-OFFLINE-'+v.id+'.NOT-VIDEO',receipt=file+'.json',bytes=Buffer.from('OFFLINE TEST ONLY '+v.id),refs=f.c.refs.filter(r=>r.runId===v.runId),takeId='controlled-'+v.id;
 const controlledLabel={valid:true,visible:true,text:'REPLAY | CONTROLLED COMPARISON (SIMULATION) | '+v.id.toUpperCase()+' | VIRTUAL WORLD | LOCAL REPLAY | NO MODEL CALL | build '+f.p.release.sourceSha.slice(0,12),sourceSha:f.p.release.sourceSha,variant:v.id};
 const r={schema:'musely-demo-capture-2',kind:'recorded_public_capture',cutId:'s05',viewId:v.id,takeId,release:structuredClone(f.p.release),tooling:structuredClone(f.p.tooling),controlledPair:structuredClone(f.c.controlledPair),controlledLabel,runId:v.runId,seekSec:v.seekSec,durationSeconds:10,label:'REPLAY',virtual:true,originalSources:['replay'],startOffsetSec:0,blockedRequests:0,refs,observed:{runId:v.runId,hash:v.snapshotHash,label:true},media:{file,sha256:sha(bytes),bytes:bytes.length}};
 await writeFile(join(f.dir,file),bytes);await writeFile(join(f.dir,receipt),JSON.stringify(r));f.c.media.push({file,receipt,sha256:sha(bytes),viewId:v.id,takeId,runId:v.runId,duration:10,refs});}return f;
}
test('D05 controlled media receipts require continuous label, artifact binding and tooling separate from release',async t=>{
 const{verifyMedia}=await import('./lib/demo-video.mjs'),f=await controlledMedia(t);assert.equal((await verifyMedia(f.p,f.dir)).length,13);const path=join(f.dir,f.c.media[0].receipt),original=JSON.parse(await readFile(path,'utf8'));
 for(const mutate of[r=>r.controlledLabel.valid=false,r=>r.controlledLabel.visible=false,r=>r.controlledLabel.text='REPLAY',r=>r.controlledLabel.sourceSha='d'.repeat(40),r=>r.controlledLabel.variant='after',r=>delete r.controlledPair,r=>r.controlledPair.pair.sha256='0'.repeat(64),r=>r.tooling.sourceSha='d'.repeat(40)]){const r=structuredClone(original);mutate(r);await writeFile(path,JSON.stringify(r));await assert.rejects(()=>verifyMedia(f.p,f.dir),/controlled_capture_binding|tooling_capture_binding/);}
});
async function rewriteControlled(f,key,change,{manifestPin=false}={}){
 const d=key==='event'?f.c.refs[1]:f.c.controlledPair[key],path=join(f.dir,d.file),value=JSON.parse(await readFile(path,'utf8'));change(value);const raw=JSON.stringify(value);await writeFile(path,raw);d.sha256=sha(raw);
 if(manifestPin){const md=f.c.controlledPair.manifest,mp=join(f.dir,md.file),m=JSON.parse(await readFile(mp,'utf8'));m.files[d.file]={sha256:d.sha256,bytes:Buffer.byteLength(raw)};const text=JSON.stringify(m);await writeFile(mp,text);md.sha256=sha(text);}
}
test('D05 controlled allowance fails closed for absent sides, A/A, labels, source/tool pins, refs and UI seek grid',async t=>{
 const{verifyBundle}=await import('./lib/demo-video.mjs');
 const changes=[['missing before',f=>delete f.c.controlledPair.before],['missing after',f=>delete f.c.controlledPair.after],['A/A',f=>{f.c.controlledPair.after=f.c.controlledPair.before;f.c.views[1].runId=f.c.views[0].runId;}],['simulation label',f=>delete f.c.controlledPair.label],['source',f=>f.p.release.sourceSha='d'.repeat(40)],['HTML',f=>f.p.release.htmlSha256='0'.repeat(64)],['tool version',f=>f.p.tooling.version='old'],['tool source',f=>delete f.p.tooling.sourceSha],['seek grid',f=>f.c.views[1].seekSec=65.05],['seek range',f=>f.c.views[1].seekSec=100],['checkpoint',f=>f.c.views[1].snapshotHash='0'.repeat(64)],['event',f=>f.c.refs[1].eventId='absent'],['commit',f=>f.c.refs[1].inputSeq++],['source label',f=>f.c.refs[1].originalSource='live'],['generic support',f=>f.c.refs.forEach(r=>r.role='support')],['fake provider',f=>f.c.refs[1].requestId='invented'],['fake signature',f=>f.c.refs[1].signedVerdict='verified'],['record pin',f=>f.c.controlledPair.after.sha256='0'.repeat(64)]];
 for(const[name,change]of changes){const f=await controlledBundle(t);change(f);const errors=await verifyBundle(f.p,f.dir);assert.ok(errors.length,name+' must fail');assert.ok(errors.some(e=>e.startsWith('s05:')),name);}
 const f=await controlledBundle(t);await rm(join(f.dir,f.c.controlledPair.before.file));assert.ok((await verifyBundle(f.p,f.dir)).length);
});
test('D05 rehashed changed seeds, clocks, inputs, extra items and outcome claims cannot pass controlled verification',async t=>{
 const{verifyBundle}=await import('./lib/demo-video.mjs');
 const changes=[['seed',x=>x.with.seed='changed'],['clock',x=>x.with.inputs[0].now++],['decision input',x=>x.with.inputs[0].decision.output.target_place='HQ'],['extra item',x=>x.with.initial.muses[0].inventory.push('coffee')],['no ability outcome',x=>x.with.events=x.with.events.filter(e=>!(e.muse===x.muse&&e.kind==='depart'&&e.data.speed==='bus'))],['missing classification',x=>delete x.classification]];
 for(const[name,change]of changes){const f=await controlledBundle(t);await rewriteControlled(f,'pair',change,{manifestPin:true});assert.ok((await verifyBundle(f.p,f.dir)).length,name);}
 for(const change of[x=>x.classification='live',x=>x.label='REPLAY',x=>x.sourceSha='d'.repeat(40),x=>x.runIds.with='foreign']){const f=await controlledBundle(t);await rewriteControlled(f,'manifest',change);assert.ok((await verifyBundle(f.p,f.dir)).length);}
});
test('D05 valid file hashes cannot conceal forged replay checkpoints, incompatible records or event/input substitutions',async t=>{
 const{verifyBundle}=await import('./lib/demo-video.mjs'),{bodyHash}=await import('../worker/core/run-log.ts');
 const f=await controlledBundle(t);await rewriteControlled(f,'after',r=>{const state=JSON.parse(r.inputs[0].afterSnapshot.body);state.muses[0].place='commons:garden';const body=JSON.stringify(state),hash=bodyHash(body);r.inputs[0].afterSnapshot={body,hash};r.inputs[0].afterHash=hash;r.inputs[1].beforeHash=hash;},{manifestPin:true});assert.ok((await verifyBundle(f.p,f.dir)).some(e=>e.includes('engine_checkpoint_mismatch')));
 for(const change of[x=>x.initialSnapshot.body+=' ',x=>x.catalogVersion='foreign',x=>x.events[0].kind='forged']){const g=await controlledBundle(t);await rewriteControlled(g,'after',change,{manifestPin:true});assert.ok((await verifyBundle(g.p,g.dir)).length);}
 const h=await controlledBundle(t);await rewriteControlled(h,'event',r=>r.input.afterHash='0'.repeat(64));assert.ok((await verifyBundle(h.p,h.dir)).some(e=>e.includes('reference_record_binding_mismatch')));
});
test('D05 ordinary cuts and public reference checks retain model/signed anchors; controlledPair is s05-only',async t=>{
 const{verifyBundle}=await import('./lib/demo-video.mjs'),f=await controlledBundle(t),ordinary=f.p.cuts[0];ordinary.refs.forEach(r=>{r.requestId=null;r.signedVerdict=null;r.role='support';});assert.ok((await verifyBundle(f.p,f.dir)).includes('s01:missing_evidence_anchor'));
 ordinary.controlledPair=structuredClone(f.c.controlledPair);assert.ok((await verifyBundle(f.p,f.dir)).some(e=>e.includes('s01:controlled_pair:s05_only')));
 assert.ok(validateReference({...ref,requestId:null,signedVerdict:null,role:'controlled-p1'},row).includes('model_request_or_signed_verdict_required'));
});
test('D05 continuous simulation annotation detects replacement, removal and invisibility even after restoration',async()=>{
 const{installControlledLabel,readControlledLabel}=await import('./lib/controlled-label.mjs'),{Script}=await import('node:vm');
 for(const mode of['text','remove','hide']){let node,visible=true,interval,mutation;const expected={text:'REPLAY | CONTROLLED COMPARISON (SIMULATION)',sourceSha:'a'.repeat(40),variant:'before'},sandbox={window:{innerWidth:1920,innerHeight:960},document:{elementsFromPoint:()=>[node],createElement(tag){if(tag==='style')return{style:{},isConnected:false,textContent:'',remove(){this.isConnected=false;}};return node={style:{},isConnected:false,textContent:'',showPopover(){},getBoundingClientRect:()=>({left:0,top:0,right:1900,bottom:60,width:1900,height:60}),remove(){this.isConnected=false;}};},body:{append(n){n.isConnected=true;}}},getComputedStyle:()=>({display:visible?'block':'none',visibility:'visible',opacity:'1'}),MutationObserver:class{constructor(fn){mutation=fn;}observe(){}disconnect(){}},setInterval(fn){interval=fn;return 1;},clearInterval(){}};
  new Script('('+installControlledLabel.toString()+')('+JSON.stringify(expected)+')').runInNewContext(sandbox);const read=()=>new Script('('+readControlledLabel.toString()+')()').runInNewContext(sandbox);assert.equal(read().valid,true);
  if(mode==='text')node.textContent='REPLAY';if(mode==='remove')node.isConnected=false;if(mode==='hide')visible=false;mutation();interval();node.textContent=expected.text;node.isConnected=true;visible=true;assert.equal(read().visible,true);assert.equal(read().valid,false,mode+' failure must stay sticky');
 }
});

test('D05 tooling pin covers ordinary takes without changing the frozen client release',async t=>{
 const{verifyMedia}=await import('./lib/demo-video.mjs'),f=await controlledMedia(t),release=structuredClone(f.p.release),path=join(f.dir,f.p.cuts[0].media[0].receipt),r=JSON.parse(await readFile(path,'utf8'));r.tooling.sourceSha='0'.repeat(40);await writeFile(path,JSON.stringify(r));await assert.rejects(()=>verifyMedia(f.p,f.dir),/tooling_capture_binding/);assert.deepEqual(f.p.release,release);
});
