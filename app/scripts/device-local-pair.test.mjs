// Offline fixtures only: no listening sockets, browser/device/ADB or production requests.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateFreeze,EIGHT_KIT_PATHS,compareBaselineContext} from './device-metrics.mjs';
import {createMeasurementReport,finalizeMeasurement,measurementPassed,auditSource} from './device-benchmark.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),origin='http://127.0.0.1:18799',context={model:'SM-S918N',android:'16',chrome:'156',viewport:[411,742],dpr:1.5,route:'story-manual-210',cachePolicy:'unchanged-profile-cache'};
const opts={kind:'mobile-210',endpoint:'http://127.0.0.1:9222',targetId:'task'};
function pin(role='baseline-capture'){return{environment:'local-read-only-pair',role,status:'frozen',releaseSHA:'a'.repeat(40),origin,targetId:'task',referenceDevice:'SM-S918N',dpr:1.5,durationMs:210000,htmlSHA256:'b'.repeat(64),files:['index.html',...EIGHT_KIT_PATHS].map(path=>({path,sha256:path==='index.html'?'b'.repeat(64):'c'.repeat(64),bytes:1})),localPair:{port:18799,serverConfigSHA256:'d'.repeat(64),datasetSHA256:'e'.repeat(64)}};}
test('only explicit loopback pair accepts HTTP without claiming an actual Worker identity',()=>{
 assert.deepEqual(validateFreeze(pin(),opts),[]);
 for(const change of[p=>delete p.environment,p=>p.origin='http://localhost:18799',p=>p.origin='http://192.168.1.2:18799',p=>p.localPair.port=18800,p=>p.role='production',p=>p.workerVersion='11111111-2222-3333-4444-555555555555',p=>p.localPair.datasetSHA256='invalid']){const p=pin();change(p);assert.ok(validateFreeze(p,opts).length);}
 assert.ok(validateFreeze({...pin(),environment:undefined},opts).includes('https_origin_required'));
});
test('baseline capture records complete actual context but cannot become a comparison PASS',async()=>{
 const report=Object.assign(createMeasurementReport(opts,pin()),{complete:true,gate:{fps:true,p95:true,visible:true},metrics:{errors:[]},context,model:context.model,android:context.android,chrome:context.chrome,device:{viewport:context.viewport,dpr:{applied:1.5}},memory:{complete:true,peakKiB:100000,endKiB:90000,samples:[{complete:true,pssKiB:100000}]}});
 report.deviceSerialSHA256='f'.repeat(64);report.sourceBefore=report.sourceAfter={localPair:{...report.pin.localPair}};report.browserSource={rows:[{type:'Document',url:origin+'/?autoplay=0&perf=1&dpr=1.5',status:200,sha256:report.pin.htmlSHA256,bytes:1}]};
 await finalizeMeasurement(report,{evaluate:async()=>({errors:[]})});assert.equal(report.baselineCaptured,true);assert.equal(report.measuredChecksPass,false);assert.equal(report.memory.comparison,undefined);
 report.metrics.errors.push('handled failure');assert.equal(measurementPassed(report),false);
});
test('legacy baseline remains missing model,route,cache without backfill',()=>{
 const old={android:'16',chrome:'156',device:{viewport:[411,742],dpr:{device:2.625,applied:1.5}}},wire=JSON.stringify(old);assert.deepEqual(compareBaselineContext(old,context).missing,['model','route','cachePolicy']);assert.equal(JSON.stringify(old),wire);
});
async function fixture(clientSHA='a'.repeat(40),content='<html>OFFLINE CLIENT FIXTURE</html>'){
 const {prepareLocalPair}=await import('./lib/device-local-pair.mjs');
 const html=Buffer.from(content),files=['index.html',...EIGHT_KIT_PATHS].map(path=>({path,body:path==='index.html'?html:Buffer.from('OFFLINE GLB '+path)}));
 const dataset={schema:'musely-public-get-dataset-1',classification:'recorded public GET fixture; no live backend or model',routes:[{path:'/api/status',status:200,body:{model:{id:'offline',connected:false,live:false},session:null,owner:null}},{path:'/api/world',status:200,body:{version:1,muses:[]}},{path:'/api/world/events',status:200,body:[{seq:1},{seq:2}]},{path:'/api/owner/location',status:401,body:{error:'owner_session_required'}}]};
 return prepareLocalPair({origin,clientSHA,targetId:'task',role:'baseline-capture',files,dataset});
}
test('preparation has no network and pure handler serves only byte-pinned GET/HEAD resources',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK FORBIDDEN');};
 try{const p=await fixture();assert.deepEqual(validateFreeze(p.pin,opts),[]);assert.equal((await p.respond(new Request(origin+'/'))).status,200);const doc=await p.respond(new Request(origin+'/index.html'));assert.equal(sha(Buffer.from(await doc.arrayBuffer())),p.pin.htmlSHA256);
 for(const url of['/mcp','/api/claim/owner-muse','/api/owner/inbox','/../private','/api/world?token=private'])assert.ok((await p.respond(new Request(origin+url))).status>=400);
 assert.equal((await p.respond(new Request(origin+'/api/world',{method:'POST',body:'not transmitted'}))).status,405);
 assert.equal((await p.respond(new Request('http://127.0.0.1:18800/'))).status,403);
 assert.deepEqual(await(await p.respond(new Request(origin+'/api/world/events?since=1&limit=1'))).json(),[{seq:2}]);
 assert.equal((await p.respond(new Request(origin+'/',{method:'HEAD'}))).body,null);
 }finally{globalThis.fetch=previous;}
});
import {setImmediate as turn} from 'node:timers/promises';
import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
import {TargetCDP,runMeasurement,PAGE_EXPRESSIONS} from './device-benchmark.mjs';
async function offlineCollection(t,prepared,{baseline,pss=100000,changedDocument=false,lateFailure=false,hidden=false,changedAfter=false,missingPss=false}={}){
 const out=await mkdtemp(join(tmpdir(),'d04-pair-collector-'));t.after(()=>rm(out,{recursive:true,force:true}));
 const old={fetch:globalThis.fetch,connect:TargetCDP.connect,exec:childProcess.execFileSync},events=new Map(),pending=[],commands=[];let started,configReads=0;
 const frames=[];for(let i=1;i<=12600;i++)frames.push({at:i*1000/60,dt:1000/60});
 const c={on(name,fn){events.set(name,fn);},async send(method,params={}){commands.push({method,params});
  if(method==='Page.navigate'){pending.push(Promise.resolve(events.get('Network.responseReceived')?.({type:'Document',requestId:'doc',response:{url:params.url,status:200}})));pending.push(Promise.resolve(events.get('Network.loadingFinished')?.({requestId:'doc',encodedDataLength:prepared.pin.files.find(f=>f.path==='index.html').bytes})));events.get('Page.lifecycleEvent')?.({loaderId:'nav',name:'DOMContentLoaded'});return{loaderId:'nav'};}
  if(method==='Network.getResponseBody')return{body:(await(await prepared.respond(new Request(origin+'/'))).text())+(changedDocument?' changed':''),base64Encoded:false};
  if(method==='Page.captureScreenshot')return{data:Buffer.from('OFFLINE NOT SCREENSHOT').toString('base64')};return{};
 },async evaluate(expression){
  if(expression===PAGE_EXPRESSIONS.metadataExpression)return{ua:'Android Chrome OFFLINE FIXTURE',viewport:[411,742],dpr:{device:2.625,cap:1.5,applied:1.5},visibility:'visible',url:origin+'/'};
  if(expression===PAGE_EXPRESSIONS.performanceStartExpression){started=Date.now();return;}
  if(expression==='window.__d04.done')return Date.now()-started>=210000;
  if(expression==='window.__d04')return{done:true,frames,visibility:hidden?[{at:1000,state:'hidden'}]:[]};
  if(expression===PAGE_EXPRESSIONS.layoutExpression)return{overflowPx:0,controls:[]};
  if(expression.includes('getMetrics?.() ?? null'))return{errors:[]};return true;
 },async settleEvents(){while(pending.length)await Promise.all(pending.splice(0));},async close(){if(lateFailure)this.eventError='late protocol failure';}};
 globalThis.fetch=async url=>{const u=new URL(url);if(u.pathname==='/json/list')return new Response(JSON.stringify([{id:'task',type:'page',url:origin+'/',webSocketDebuggerUrl:'ws://OFFLINE-NOT-CONNECTED'}]));if(u.pathname==='/.well-known/d04-local-pair.json'&&++configReads===2&&changedAfter)return new Response('changed server config');return prepared.respond(new Request(url));};
 TargetCDP.connect=async()=>c;
 childProcess.execFileSync=(command,args)=>{assert.equal(command,'adb','no actual subprocess may run');const q=args.join(' ');if(q.includes('ro.product.model'))return'SM-S918N';if(q.includes('ro.build.version.release'))return'16';if(q.includes('dumpsys package'))return'versionName=156';if(q.includes('ps -A'))return'PID NAME\n1 com.android.chrome\n2 com.android.chrome_zygote\n3 com.android.chrome:sandboxed_process0\n4 com.android.chrome:privileged_process0';if(q.includes('dumpsys meminfo')){if(missingPss)throw Error('OFFLINE PSS MISSING');return'TOTAL PSS: '+pss;}throw Error('unexpected offline command');};syncBuiltinESMExports();
 let done=false;try{
  const p=structuredClone(prepared.pin);if(baseline){p.role='candidate';p.baselineSHA256=sha(await readFile(baseline));p.baselineContext=context;}
  const job=runMeasurement({...opts,execute:true,out,serial:'OFFLINE-SERIAL',baseline},p).finally(()=>{done=true;});
  for(let steps=0;!done&&steps<2000;steps++){await turn();t.mock.timers.tick(500);}const report=await job;return{report,out,commands};
 }finally{globalThis.fetch=old.fetch;TargetCDP.connect=old.connect;childProcess.execFileSync=old.exec;syncBuiltinESMExports();}
}
test('actual collector captures a fresh baseline then compares another client with the same pinned GET dataset',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-11-03T00:00:00Z')});
 const a=await offlineCollection(t,await fixture());assert.equal(a.report.baselineCaptured,true);assert.equal(a.report.measuredChecksPass,false);assert.equal(a.report.memory.comparison,undefined);assert.ok(a.report.memory.samples.length>=22);assert.deepEqual(a.report.context,context);assert.ok(!a.commands.some(x=>x.method==='Fetch.fulfillRequest'));
 const path=join(a.out,'results.json'),raw=await readFile(path),b=await offlineCollection(t,await fixture('b'.repeat(40),'<html>OFFLINE CANDIDATE</html>'),{baseline:path,pss:110000});
 assert.equal(b.report.complete,true);assert.equal(b.report.measuredChecksPass,true);assert.equal(b.report.memory.comparison.peak.allowedDeltaKiB,80000);assert.equal(b.report.baselineSHA256,sha(raw));assert.deepEqual(await readFile(path),raw);assert.equal(b.report.conditions.documentPolicy,'network document');
 const over=await offlineCollection(t,await fixture('b'.repeat(40)),{baseline:path,pss:130000});assert.equal(over.report.memory.comparison.numericPass,false);assert.equal(over.report.measuredChecksPass,false);
});
test('actual baseline collector refuses mismatched browser bytes,hidden frames and late cleanup faults',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-11-03T00:00:00Z')});
 for(const boundary of[{changedDocument:true},{hidden:true},{lateFailure:true},{changedAfter:true},{missingPss:true}]){const {report}=await offlineCollection(t,await fixture(),boundary);assert.equal(report.baselineCaptured,false);assert.equal(report.measuredChecksPass,false);if(boundary.changedDocument)assert.match(report.error,/actual browser document/);if(boundary.lateFailure)assert.equal(report.protocolError,'late protocol failure');if(boundary.changedAfter)assert.match(report.error,/hash mismatch/);if(boundary.missingPss){assert.equal(report.memory.complete,false);assert.equal(report.memory.peakKiB,null);}}
});
test('local source audit verifies server config,dataset,all route bodies and static served bytes',async()=>{
 const prepared=await fixture(),previous=globalThis.fetch;let tamper='';globalThis.fetch=async url=>{const response=await prepared.respond(new Request(url));if(tamper&&String(url).endsWith(tamper))return new Response('different bytes');return response;};
 try{const result=await auditSource(prepared.pin);assert.equal(result.localPair.datasetSHA256,prepared.pin.localPair.datasetSHA256);for(const path of['/.well-known/d04-local-pair.json','/.well-known/d04-public-get-dataset.json','/api/world',EIGHT_KIT_PATHS[0]]){tamper=path;await assert.rejects(()=>auditSource(prepared.pin),/mismatch|invalid/);}}finally{globalThis.fetch=previous;}
});
test('a fresh candidate baseline must be a complete capture from the same dataset and shared assets',async t=>{
 const {validateLocalBaseline}=await import('./lib/device-local-pair.mjs');const prepared=await fixture(),candidate={...prepared.pin,role:'candidate'},baseline={pin:prepared.pin,baselineCaptured:true,complete:true,memory:{complete:true},context,deviceSerialSHA256:'f'.repeat(64),sourceBefore:{localPair:prepared.pin.localPair},sourceAfter:{localPair:prepared.pin.localPair},browserSource:{rows:[{type:'Document',url:origin+'/?autoplay=0&perf=1&dpr=1.5',status:200,sha256:prepared.pin.htmlSHA256,bytes:prepared.pin.files.find(f=>f.path==='index.html').bytes}]}};
 assert.deepEqual(validateLocalBaseline(baseline,candidate,'f'.repeat(64)),[]);
 for(const mutate of[b=>b.baselineCaptured=false,b=>b.pin.localPair.datasetSHA256='0'.repeat(64),b=>b.pin.files[1].sha256='0'.repeat(64),b=>b.pin.files.push({path:'character-kit/runtime/attachments/04-ember.glb',sha256:'0'.repeat(64),bytes:1}),b=>b.pin.environment=undefined,b=>b.pin.role='candidate',b=>b.deviceSerialSHA256='0'.repeat(64),b=>b.pin.status='preparation',b=>b.pin.workerVersion='11111111-2222-3333-4444-555555555555']){const b=structuredClone(baseline);mutate(b);assert.ok(validateLocalBaseline(b,candidate,'f'.repeat(64)).length);}
});
