import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Continuity, validatePin} from './lib/resilience-monitor.mjs';
import {observeGet,currentDeployment,gitSourceState} from './lib/resilience-io.mjs';
const HOUR = 3600000;
const pin = {issueId: 63, environment: 'production-read-only', releaseSha: 'a'.repeat(40), deployId: 'deployment-1', versionIds: ['version-1'], configVersion: 'config-1', configSha256: 'b'.repeat(64), htmlSha256: 'c'.repeat(64), workerName: 'musely', baseUrl: 'https://musely.net', operatorAttested: true};
const sample = (monoMs, extra = {}) => ({monoMs, at: 1800000000000 + monoMs, identity: {deployId: pin.deployId, versionIds: pin.versionIds}, sourceSha: pin.releaseSha, sourceClean: true, configSha256: pin.configSha256, htmlSha256: pin.htmlSha256, world: {worldId: 'w', day: '2026-11-02', tick: monoMs / 60000, version: monoMs / 60000, lastTickAt: 1800000000000 + monoMs}, status: {model: {id:'muse-spark-1.3',connected: true, live: true}, budget: {day:'2026-11-02',capUsd:12,spentUsd:0,reservedUsd:0,liveCalls:0,remainingUsd:12}}, run: {runId:'r',worldId:'w',schemaVersion:'run-log-2',engineVersion:'engine-2',harnessVersion:'harness-test',catalogVersion:'catalog-test',seed:'w:2026-11-02',startedAt:1800000000000,initialSnapshot:{hash:'d'.repeat(64),bytes:100},inputs:{count:0,lastSeq:0,lastAt:null},events:0,stateHash:'e'.repeat(64)}, events: [], ...extra});
function complete(t, extra = {}) {for (let m = 0; m <= 4 * HOUR; m += 60000) t.observe(sample(m, extra)); return t.summary();}
test('a short or sparse observation cannot claim a four-hour run', () => {
  const t = new Continuity(pin); t.observe(sample(0)); t.observe(sample(4 * HOUR));
  assert.equal(t.summary().result, 'failed');
  const short = new Continuity(pin); short.observe(sample(0)); short.observe(sample(60000));
  assert.equal(short.summary().result, 'incomplete');
});
test('continuous four-hour GET observations earn only observation eligibility, never fault acceptance', () => {
  const result = complete(new Continuity(pin));
  assert.equal(result.result, 'observed_continuous'); assert.equal(result.faultAcceptance, 'not_measured');
  assert.equal(result.elapsedMs, 4 * HOUR); assert.equal(result.samples, 241);
});
test('a recovered outage remains a failed continuous run, with recovery separately recorded', () => {
  const t = new Continuity(pin);t.observe(sample(0));t.observe(sample(60000,{error:'request_timeout'}));
  assert.equal(t.observe(sample(120000)).recovered, true);
  for(let m=180000;m<=4*HOUR;m+=60000)t.observe(sample(m));
  assert.equal(t.summary().result,'failed');assert.equal(t.summary().recoveries,1);
});
test('redeploy, mixed versions, local edits and changed HTML/config each invalidate a fixed build run', () => {
  for(const changed of [{identity:{deployId:'new',versionIds:pin.versionIds}},{identity:{deployId:pin.deployId,versionIds:['another']}},{sourceClean:false},{htmlSha256:'d'.repeat(64)},{configSha256:'e'.repeat(64)}]) {
    const t=new Continuity(pin);t.observe(sample(0));const r=t.observe(sample(60000,changed));assert.ok(r.issues.includes('identity_changed'));
  }
});
test('a stalled or rewound world and duplicate event IDs are failures; a real midnight advances', () => {
  const t=new Continuity(pin);t.observe(sample(0));
  assert.ok(t.observe(sample(240000,{world:sample(0).world})).issues.includes('world_stalled'));
  const n=new Continuity(pin);n.observe(sample(60000));
  assert.ok(n.observe(sample(120000,{world:sample(0).world})).issues.includes('world_rewound'));
  const d=new Continuity(pin);assert.ok(d.observe(sample(0,{events:[{id:'x'},{id:'x'}]})).issues.includes('duplicate_event_id'));
  const midnight=new Continuity(pin);midnight.observe(sample(0));
  assert.deepEqual(midnight.observe(sample(60000,{world:{...sample(60000).world,day:'2026-11-03'}})).issues,[]);
});
test('pins require source/deployment/config evidence and credential-free HTTPS production URLs', () => {
  assert.equal(validatePin(pin),true);
  for(const p of [{...pin,deployId:''},{...pin,operatorAttested:false},{...pin,baseUrl:'https://user:secret@musely.net'},{...pin,baseUrl:'https://musely.net/?key=secret'},{...pin,environment:'fixture'}]) assert.throws(()=>validatePin(p));
});
test('unknown pin fields cannot smuggle credentials into evidence and malformed status never counts healthy',()=>{
 assert.throws(()=>validatePin({...pin,token:'do-not-persist'}));
 const t=new Continuity(pin);assert.ok(t.observe(sample(0,{status:{model:{},budget:{}}})).issues.includes('invalid_response'));
});
test('GET observation refuses redirects, omits cookie/authorization headers and bounds a stalled body',async()=>{
  let request;const r=await observeGet('https://musely.net/api/status',{fetcher:async(_u,init)=>{request=init;return new Response('{}',{headers:{'set-cookie':'never save this',authorization:'secret'}});}});
  assert.equal(request.method,'GET');assert.equal(request.credentials,'omit');assert.equal(request.redirect,'manual');assert.deepEqual(request.headers,{Connection:'close'});
  assert.deepEqual(r.headers,{'content-type':'text/plain;charset=UTF-8'});assert.equal(r.body,'{}');
  await assert.rejects(observeGet('https://musely.net/',{maxBytes:3,fetcher:async()=>new Response('1234')}),/response_too_large/);
  await assert.rejects(observeGet('https://musely.net/',{timeoutMs:15,fetcher:async()=>new Response(new ReadableStream({start(){}}))}),/request_timeout/);
});
test('deployment list ordering is explicit and a gradual rollout cannot pass a single-build pin',()=>{
  const row=(id,at,versions=[{version_id:'v1',percentage:100}])=>({id,created_on:at,versions});
  assert.equal(currentDeployment([row('new','2026-11-02'),row('old','2026-11-01')]).deployId,'new');
  assert.throws(()=>currentDeployment([row('mix','2026-11-02',[{version_id:'v1',percentage:50},{version_id:'v2',percentage:50}])]),/mixed/);
});

test('malformed or foreign run summaries never earn continuous observation',()=>{
 for(const run of [null,{}, {...sample(0).run,worldId:'foreign'}, {...sample(0).run,inputs:{count:-1,lastSeq:0,lastAt:null}}, {...sample(0).run,stateHash:'invalid'}]){const result=complete(new Continuity(pin),{run});assert.equal(result.result,'failed');assert.ok(result.failures.some(f=>f.reason==='invalid_response'));}
});

test('a round finishing after the deadline still needs a sample at the boundary',()=>{
 const t=new Continuity(pin);t.observe(sample(0));for(let m=60000;m<4*HOUR;m+=60000)t.observe(sample(m));t.observe(sample(4*HOUR-1000));
 // This round began at 3:59:59 and finished 17 seconds later; finish time is not an observation.
 assert.equal(t.needsObservation(),true);t.observe(sample(4*HOUR+16000));assert.equal(t.needsObservation(),false);assert.equal(t.summary().result,'observed_continuous');
});

test('run input counters agree without assuming run-local global sequence numbers',()=>{
 const base=sample(0).run;for(const inputs of [{count:0,lastSeq:42,lastAt:1800000000001},{count:0,lastSeq:0,lastAt:1800000000001},{count:1,lastSeq:0,lastAt:1800000000001},{count:43,lastSeq:42,lastAt:1800000000001},{count:1,lastSeq:42,lastAt:null}])assert.ok(new Continuity(pin).observe(sample(0,{run:{...base,inputs}})).issues.includes('invalid_response'));
 assert.deepEqual(new Continuity(pin).observe(sample(0,{run:{...base,inputs:{count:1,lastSeq:42,lastAt:1800000000000}}})).issues,[]);
});

// Real Git repositories, not a mocked status command: cwd must never narrow the intended app scope.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execGit=promisify(execFile);
for(const cwdName of ['root','app'])for(const change of ['tracked','untracked'])test(`git source state detects ${change} app edits from ${cwdName} cwd`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'d03-source-state-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'app','worker'),{recursive:true});await writeFile(join(root,'app','worker','index.ts'),'// initial fixture\n');
 const git=(...args)=>execGit('git',args,{cwd:root,timeout:10000});
 await git('init','--quiet');await git('add','app/worker/index.ts');await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','-m','fixture');
 const cwd=cwdName==='root'?root:join(root,'app'),initial=await gitSourceState(cwd),head=(await git('rev-parse','HEAD')).stdout.trim();
 assert.deepEqual(initial,{sourceSha:head,sourceClean:true});
 await writeFile(join(root,'app','worker',change==='tracked'?'index.ts':'untracked.ts'),'// changed fixture\n');
 assert.deepEqual(await gitSourceState(cwd),{sourceSha:head,sourceClean:false});
});


// These fail if transport/body errors lose their bounded receipt or expose arbitrary error text.
test('GET fetch failure preserves only allowlisted error name/cause and fetch stage without retry',async()=>{
 let calls=0;
 const sensitive='DO_NOT_PERSIST_cookie_key_url_stack';
 const error=new TypeError(sensitive,{cause:{code:'UND_ERR_SOCKET',message:sensitive,headers:{cookie:sensitive}}});
 error.stack=sensitive;
 await assert.rejects(observeGet('https://musely.net/api/world/events?tail=100',{fetcher:async(_url,init)=>{
  calls++;throw error;
 }}),e=>{assert.equal(e.message,'observation_failed');assert.deepEqual(e.failure,{errorName:'TypeError',causeCode:'UND_ERR_SOCKET',stage:'fetch'});assert.equal(JSON.stringify(e).includes(sensitive),false);return true;});
 assert.equal(calls,1);
});
test('GET body failure retains body stage; unknown names/codes cannot become receipt text',async()=>{
 for(const [error,want] of [
  [new TypeError('private body error',{cause:{code:'ECONNRESET'}}),{errorName:'TypeError',causeCode:'ECONNRESET',stage:'body'}],
  [{name:'DO_NOT_PERSIST_name',message:'DO_NOT_PERSIST_message',cause:{code:'DO_NOT_PERSIST_code'}},{errorName:null,causeCode:null,stage:'body'}],
 ]){
  let calls=0;
  await assert.rejects(observeGet('https://musely.net/api/status',{fetcher:async()=>{calls++;return new Response(new ReadableStream({start(c){c.error(error);}}));}}),e=>{assert.equal(e.message,'observation_failed');assert.deepEqual(e.failure,want);assert.equal(JSON.stringify(e).includes('DO_NOT_PERSIST'),false);return true;});
  assert.equal(calls,1);
 }
});
test('GET deadline and byte-bound failures keep their classification and body-stage receipt',async()=>{
 await assert.rejects(observeGet('https://musely.net/',{timeoutMs:10,fetcher:async()=>new Response(new ReadableStream({start(){}}))}),e=>{assert.equal(e.message,'request_timeout');assert.deepEqual(e.failure,{errorName:'Error',causeCode:null,stage:'body'});return true;});
 await assert.rejects(observeGet('https://musely.net/',{maxBytes:3,fetcher:async()=>new Response('1234')}),e=>{assert.equal(e.message,'response_too_large');assert.deepEqual(e.failure,{errorName:'Error',causeCode:null,stage:'body'});return true;});
});
test('actual monitor round persists sanitized request failure, four successful raw receipts and failed continuity',async()=>{
 for(const prefix of['','reuse-']){
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('./resilience-monitor.mjs',import.meta.url),'utf8');
 const roundSource=source.slice(source.indexOf('async function round() {'),source.indexOf('\nawait round();'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const fixture=sample(0),cfg=Buffer.from('{}'),localPin={...pin,configSha256:(await import('./lib/resilience-io.mjs')).sha256(cfg),htmlSha256:(await import('./lib/resilience-io.mjs')).sha256('{}')};
 const tracker=new Continuity(localPin),writes=[],calls=[];
 const actualObserve=async(url,options)=>observeGet(url,{...options,fetcher:async(u,init)=>{
  calls.push({url:u,method:init.method,headers:init.headers});
  if(new URL(u).pathname==='/api/world/events')throw new TypeError('DO_NOT_PERSIST_message',{cause:{code:'UND_ERR_SOCKET',headers:{cookie:'DO_NOT_PERSIST_cookie'}}});
  const data={'/':'{}','/api/status':JSON.stringify(fixture.status),'/api/world':JSON.stringify(fixture.world),'/api/world/run':JSON.stringify(fixture.run)};
  return new Response(data[new URL(u).pathname],{headers:{'content-type':'application/json'}});
 }});
 const run=new AsyncFunction('tracker','pin','start','identity','gitSourceState','source','readFile','config','observeGet','sha256','writeFile','join','out','file','basename','appendFile','console','const interrupted=false;'+roundSource+';await round();');
 await run(tracker,localPin,performance.now(),async()=>fixture.identity,async()=>({sourceSha:pin.releaseSha,sourceClean:true}),'fixture-source',async()=>cfg,'fixture-config',actualObserve,(await import('./lib/resilience-io.mjs')).sha256,async(path,text)=>writes.push({path,text}),join,'fixture-out',name=>join('fixture-out',prefix+name),basename,async(path,text)=>writes.push({path,text}),{log(){}});
 const raw=JSON.parse(writes.find(w=>w.path.endsWith('raw-00000.json')).text),failed=raw.requests.find(r=>r.error);
 assert.equal(raw.requests.length,5);assert.equal(raw.requests.filter(r=>r.status===200).length,4);
 assert.equal(failed.error,'observation_failed');assert.deepEqual(failed.failure,{errorName:'TypeError',causeCode:'UND_ERR_SOCKET',stage:'fetch'});
 assert.equal(failed.method,'GET');assert.equal(failed.url,'https://musely.net/api/world/events?tail=100');
 assert.equal(JSON.stringify(writes).includes('DO_NOT_PERSIST'),false);
 assert.equal(calls.length,5);assert.ok(calls.every(r=>r.method==='GET'&&r.headers.Connection==='close'));
 assert.equal(tracker.summary().result,'failed');assert.equal(tracker.failures[0].reason,'observation_failed');
 assert.equal(JSON.parse(writes.find(w=>w.path.endsWith('samples.jsonl')).text).raw,prefix+'raw-00000.json');
 }
});


test('GET sanitizer checks and stores the same single-read name/code primitives for fetch and body errors',async()=>{
 for(const stage of ['fetch','body']){
  let names=0,codes=0;const cause={},original=new Error('DO_NOT_PERSIST_message',{cause});
  Object.defineProperty(original,'name',{get(){return ++names===1?'TypeError':'DO_NOT_PERSIST_name';}});
  Object.defineProperty(cause,'code',{get(){return ++codes===1?'UND_ERR_SOCKET':'DO_NOT_PERSIST_code';}});
  const fetcher=async()=>{if(stage==='fetch')throw original;return new Response(new ReadableStream({start(c){c.error(original);}}));};
  await assert.rejects(observeGet('https://musely.net/api/status',{fetcher}),e=>{assert.deepEqual(e.failure,{errorName:'TypeError',causeCode:'UND_ERR_SOCKET',stage});assert.equal(JSON.stringify(e).includes('DO_NOT_PERSIST'),false);return true;});
  assert.equal(names,1);assert.equal(codes,1);
 }
});
test('GET sanitizer contains throwing name/cause/code accessors without leaking their replacement error',async()=>{
 for(const stage of ['fetch','body'])for(const field of ['name','cause','code']){
  const original=new Error('DO_NOT_PERSIST_original'),fail=()=>{throw Error('DO_NOT_PERSIST_accessor');};
  Object.defineProperty(original,'name',field==='name'?{get:fail}:{value:'TypeError'});
  if(field==='cause')Object.defineProperty(original,'cause',{get:fail});
  else {const cause={};Object.defineProperty(cause,'code',field==='code'?{get:fail}:{value:'UND_ERR_SOCKET'});original.cause=cause;}
  const fetcher=async()=>{if(stage==='fetch')throw original;return new Response(new ReadableStream({start(c){c.error(original);}}));};
  await assert.rejects(observeGet('https://musely.net/api/status',{fetcher}),e=>{assert.equal(e.message,'observation_failed');assert.deepEqual(e.failure,{errorName:field==='name'?null:'TypeError',causeCode:field==='name'?'UND_ERR_SOCKET':null,stage});assert.equal(JSON.stringify(e).includes('DO_NOT_PERSIST'),false);return true;});
 }
});
