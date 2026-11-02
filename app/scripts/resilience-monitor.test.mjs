import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Continuity, validatePin} from './lib/resilience-monitor.mjs';
import {observeGet,currentDeployment} from './lib/resilience-io.mjs';
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
  assert.equal(request.method,'GET');assert.equal(request.credentials,'omit');assert.equal(request.redirect,'manual');assert.equal(request.headers,undefined);
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
