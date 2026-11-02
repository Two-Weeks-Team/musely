import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyP0,verifyP1,correlateP2,recountEvidence,verifyRelease} from './proof/evidence.mjs';
import {buildControlledProof} from './proof/simulation.mjs';
test('D02 actual local crypto/commit P0 isolates revocation from replay IDs, pair limits and state mutation',async()=>{
 const b=await buildControlledProof(); assert.equal(verifyP0(b.p0).stateUnchanged,true);
 for(const mutate of [p=>p.refused.data.reason='pair_limit',p=>p.refused.data.envelope.nonce=p.verified.data.envelope.nonce,p=>p.afterRefusal.muses[0].inventory.push('tea')]){const p=structuredClone(b.p0);mutate(p);assert.throws(()=>verifyP0(p),/invalid_evidence/);}
});
test('D02 controlled P1 uses the identical engine snapshot, seed and clock with only Transit Pass added',async()=>{
 const b=await buildControlledProof();assert.equal(verifyP1(b.p1).modelCalls,0);
 for(const mutate of [p=>p.with.seed+='other',p=>p.with.inputs[0].now++,p=>p.with.initial.muses[0].place='commons:garden']){const p=structuredClone(b.p1);mutate(p);assert.throws(()=>verifyP1(p),/invalid_evidence/);}
});
test('D02 P2 correlates actual local event/run/input/hash to signature verdict without inventing model IDs',async()=>{
 const b=await buildControlledProof(), linked=correlateP2(b.p2.scene,b.p2.record);assert.equal(linked.evidence.kind,'signature-verdict');assert.equal(linked.evidence.requestId,undefined);
 assert.throws(()=>correlateP2({...b.p2.scene,eventId:'other'},b.p2.record),/mismatch/);
 assert.throws(()=>correlateP2({...b.p2.scene,snapshotHash:'changed'},b.p2.record),/hash mismatch/);
});
const at=1800000000000,scope={worldId:'w',runIds:['a','b'],from:at,to:at+1000,day:null,complete:false,partialReason:'page 2 unavailable'};
const event=(id,kind,data={},extra={})=>({id,kind,data,source:'rule',muse:'00-jolly',at,tags:[],runId:'a',...extra});
test('D02 all six raw-record counts agree with independent oracle; duplicate delivery, two runs and partial remain explicit',()=>{
 const events=[event('a1','encounter',{encounterId:'m1',initiatedByIntent:true,actorOrigin:'connected'}),event('a2','encounter',{encounterId:'m1',initiatedByIntent:true}),event('a3','encounter',{encounterId:'m2',initiatedByIntent:false}),event('a4','approval_requested',{requestId:'approve1'}),event('a5','approval_requested',{requestId:'approve1'}),event('a6','a2a_verified',{verificationId:'v1'},{source:'live'}),event('a7','a2a_verified',{verificationId:'v1'},{source:'live'}),event('b1','spotlight',{evidence:{requestId:'request1'}},{runId:'b',source:'live'}),event('b2','spotlight',{evidence:{replayOf:'request1'}},{runId:'b',source:'replay'}),event('b3','trade_completed',{beforeHash:'before',afterHash:'after'},{runId:'b',tags:['ability_change']}),event('b4','injection_blocked',{}, {runId:'b'}),event('b5','decision_rejected',{}, {runId:'b'})];events.push(structuredClone(events[0]));
 const r=recountEvidence(events,scope);assert.equal(r.oracle.sample.duplicateIds,1);assert.equal(r.oracle.sample.duplicateEncounters,1);assert.equal(r.oracle.sample.duplicateVerifications,1);
 assert.deepEqual(Object.fromEntries(Object.entries(r.values).map(([k,v])=>[k,v.value])),{starts:'50%',interventions:'1',signatures:'1 passed · 0 refused',models:'1 live · 1 replay · 0 scenario',abilities:'1 changes',blocks:'1 instructions blocked · 1 out-of-scope decisions refused'});
 assert.equal(r.byRun.length,2);assert.equal(r.byRun[1].values.starts.measured,false);assert.equal(r.oracle.scope.complete,false);assert.match(r.ui.period,/partial sample/);
});
test('D02 zero-denominator/empty/missing model evidence is unmeasured; out-of-period raw rows cannot pass',()=>{
 const r=recountEvidence([],scope);assert.ok(Object.values(r.values).every(v=>!v.measured&&v.value==='Not measured'));
 assert.equal(recountEvidence([event('x','spotlight',{evidence:{model:'m'}},{source:'live'})],scope).values.models.measured,false);
 assert.throws(()=>recountEvidence([event('x','beat',{}, {at:at+2000})],scope),/outside/);
});
test('D02 C10 simulation can never supply deployment or physical acceptance by omission',()=>{
 const meta={classification:'simulation',issueId:62,owner:'Codex',commitSha:'source',environment:'local SQLite',configVersion:'test',testedAt:'now',command:'node test',result:'local-only',artifact:'local.json',limitations:['No deployed owner claim or provider call']};
 assert.equal(verifyRelease(meta).status,'local-only');assert.throws(()=>verifyRelease({...meta,classification:'live'}),/deployId/);
});
test('D02 same-business P0 cannot attribute a different delegation or scope to the revocation',async()=>{
 const b=await buildControlledProof();for(const key of ['delegation_ref','scope','scope_hash','agent_id']){const p=structuredClone(b.p0);p.refused.data.envelope[key]='different';assert.throws(()=>verifyP0(p),/invalid_evidence/);}
});
test('D02 declared P1 seed must equal the actual initial snapshot seed',async()=>{
 const {p1}=await buildControlledProof();p1.with.seed=p1.without.seed='invented-seed';assert.throws(()=>verifyP1(p1),/seed/);
});
test('D02 duplicate event ids from different run identities are ambiguous, not silently collapsed',()=>{
 assert.throws(()=>recountEvidence([event('collision','beat'),event('collision','injection_blocked',{}, {runId:'b'})],scope),/identity/);
});
test('D02 collection route spy permits only public GETs and correlates a finite actual RunLog prefix',async()=>{
 const {collectPublicProof,publicReader}=await import('./proof/collect.mjs'),b=await buildControlledProof(),calls=[],events=b.events,runId=b.p2.record.runId,from=Math.min(...events.map(e=>e.at)),to=Math.max(...events.map(e=>e.at))+1;
 const local=recountEvidence(events,{worldId:'d02-local-simulation',runIds:[runId],from,to,day:null,complete:true});
 const fake=async(url,init)=>{calls.push({url,init});const u=new URL(url);let body;
 if(u.pathname==='/api/world/run')body={...b.p2.record.run,readThrough:{eventSeq:events.at(-1).seq,events:events.length}};
 else if(u.pathname==='/api/world/events')body=events.filter(e=>e.seq>Number(u.searchParams.get('since'))).slice(0,2);
 else if(u.pathname==='/api/world/autonomy')body={...local.oracle,values:local.values};
 else if(u.pathname==='/api/world/event')body=b.p2.record;else throw Error('unexpected route');return {ok:true,status:200,json:async()=>body};};
 const meta={classification:'live',issueId:62,owner:'test operator',commitSha:'fixture',environment:'mock public GET',configVersion:'fixture',testedAt:'now',command:'test',result:'fixture',artifact:'test',limitations:['Synthetic fixture only'],deployId:'fixture',URL:'https://example.invalid'};
 const r=await collectPublicProof({base:'https://example.invalid',meta,runId,from,to,scenes:[b.p2.scene]},fake);assert.equal(r.status,'raw-recount-matched');assert.equal(r.correlations.length,1);assert.ok(calls.every(c=>c.init.method==='GET'&&c.init.credentials==='omit'&&!c.init.body));
 const channel=publicReader('https://example.invalid',fake),n=calls.length;await assert.rejects(channel.read('/api/owner/revoke'),/public_read_path/);await assert.rejects(channel.read('https://other.invalid/api/world/run'),/public_read_path/);assert.equal(calls.length,n);
 await assert.rejects(collectPublicProof({base:'https://example.invalid',meta,runId,from,to},async()=>({ok:false,status:503})),/public_get_failed:503/);
});
test('D02 equal six values cannot hide a different oracle sample or run cohort',async()=>{
 const {collectPublicProof}=await import('./proof/collect.mjs'),rows=[event('only','beat')],s={...scope,runIds:['a'],complete:true},local=recountEvidence(rows,s);
 const meta={classification:'live',issueId:62,owner:'test',commitSha:'test',environment:'mock',configVersion:'test',testedAt:'now',command:'test',result:'fixture',artifact:'test',limitations:[],deployId:'fixture',URL:'https://example.invalid'};
 for(const change of [r=>r.sample.events++,r=>r.scope.runIds=['foreign']]){
  const server={...structuredClone(local.oracle),values:local.values};change(server);
  const read=async url=>({ok:true,status:200,json:async()=>new URL(url).pathname==='/api/world/run'?{runId:'a',worldId:'w',readThrough:{eventSeq:1,events:1}}:new URL(url).pathname==='/api/world/events'?[{...rows[0],seq:1}]:server});
  const r=await collectPublicProof({base:'https://example.invalid',meta,runId:'a',from:s.from,to:s.to},read);assert.equal(r.status,'partial-or-mismatch');
 }
});
test('D02 blank C10 evidence fields cannot be promoted to a release acceptance record',()=>{
 const meta={classification:'simulation',issueId:62,owner:'Codex',commitSha:'source',environment:'local',configVersion:'test',testedAt:'now',command:'test',result:'local-only',artifact:'local.json',limitations:[]};
 for(const key of ['owner','commitSha','environment','testedAt','command','result','artifact'])assert.throws(()=>verifyRelease({...meta,[key]:' '}),/missing/);
});
test('D02 P0 full-state digest must also stay unchanged, beyond the public allow-list',async()=>{
 const {p0}=await buildControlledProof();p0.fullStateAfterHash='changed-private-state';assert.throws(()=>verifyP0(p0),/full state/);
});

async function publicFixture(){
 const b=await buildControlledProof(),events=b.events,runId=b.p2.record.runId,from=Math.min(...events.map(e=>e.at)),to=Math.max(...events.map(e=>e.at))+1;
 const local=recountEvidence(events,{worldId:'d02-local-simulation',runIds:[runId],from,to,day:null,complete:true});
 const meta={classification:'live',issueId:62,owner:'local test',commitSha:'a'.repeat(40),environment:'mock',configVersion:'test',testedAt:'now',command:'test',result:'fixture',artifact:'test',limitations:['Synthetic only'],deployId:'test',URL:'https://example.invalid'};
 const response=(change=()=>{})=>async url=>{const path=new URL(url).pathname;let body;
 if(path==='/api/world/run')body={...b.p2.record.run,readThrough:{eventSeq:events.at(-1).seq,events:events.length}};
 else if(path==='/api/world/events')body=events;
 else if(path==='/api/world/autonomy'){body={...structuredClone(local.oracle),values:structuredClone(local.values)};change(body);}else body=b.p2.record;
 return new Response(JSON.stringify(body));};return {b,events,runId,from,to,meta,response};
}
test('D02 P2 rejects another run input even if sequence/version/hash match',async()=>{
 const b=await buildControlledProof(),r=structuredClone(b.p2.record);r.input.runId='foreign';assert.throws(()=>correlateP2(b.p2.scene,r),/mismatch/);
});
test('D02 declared origin is bound before any collection request',async()=>{
 const {collectPublicProof}=await import('./proof/collect.mjs'),t=await publicFixture();let called=false;
 await assert.rejects(()=>collectPublicProof({base:'https://other.invalid',...t},async()=>{called=true;return new Response('{}');}),/origin/);assert.equal(called,false);
});
test('D02 complete oracle metadata mismatches cannot hide behind equal six values',async()=>{
 const {collectPublicProof}=await import('./proof/collect.mjs'),t=await publicFixture();
 for(const change of [s=>s.sample.received++,s=>s.sample.duplicateIds++,s=>s.sample.duplicateEncounters++,s=>s.sample.duplicateVerifications++,s=>s.sample.firstAt--,s=>s.sample.lastAt++,s=>s.sources.live++,s=>s.origins.connected++,s=>s.starts.meetings++,s=>s.models.liveWithoutId++])assert.equal((await collectPublicProof({base:t.meta.URL,...t},t.response(change))).status,'partial-or-mismatch');
});
test('D02 preserves original GET bytes, hashes and parsed input/run cohort',async()=>{
 const {publicReader}=await import('./proof/collect.mjs'),text=' { "event":{"id":"e","runId":"r","inputSeq":2},"runId":"r","run":{"worldId":"w"},"input":{"runId":"r","seq":2} }\n';
 const r=publicReader('https://example.invalid',async(_u,init)=>{assert.equal(init.credentials,'omit');return new Response(text);});await r.read('/api/world/event?id=e');const receipt=r.receipts[0];
 assert.equal(Buffer.from(receipt.rawBodyBase64,'base64').toString(),text);assert.equal(receipt.requestOrigin,'https://example.invalid');assert.equal(receipt.cohort.inputRunId,'r');assert.equal(receipt.cohort.inputSeq,2);
 const {createHash}=await import('node:crypto');assert.equal(receipt.rawSha256,createHash('sha256').update(text).digest('hex'));assert.equal(receipt.rawSource,'response-body-bytes');
});
test('D02 bounds response bytes, total bytes and fetch/body time',async()=>{
 const {publicReader}=await import('./proof/collect.mjs');
 const large=publicReader('https://example.invalid',async()=>new Response(JSON.stringify({padding:'a'.repeat(100)})),{maxBodyBytes:32});await assert.rejects(()=>large.read('/api/world/run'),/body_limit/);
 const total=publicReader('https://example.invalid',async()=>new Response('{"a":1}'),{maxBodyBytes:20,maxTotalBytes:10});await total.read('/api/world/run');await assert.rejects(()=>total.read('/api/world/run'),/total_limit/);
 const slow=publicReader('https://example.invalid',async()=>{await new Promise(r=>setTimeout(r,80));return new Response('{}');},{timeoutMs:10});await assert.rejects(()=>slow.read('/api/world/run'),/timeout/);
 const slowBody=publicReader('https://example.invalid',async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{}'));setTimeout(()=>{try{c.close();}catch{}},80);}})),{timeoutMs:10});await assert.rejects(()=>slowBody.read('/api/world/run'),/timeout/);
});

test('D02 timeout never adds a late receipt from an injected fetch that ignored abort',async()=>{
 const {publicReader}=await import('./proof/collect.mjs'),r=publicReader('https://example.invalid',async()=>{await new Promise(r=>setTimeout(r,30));return new Response('{}');},{timeoutMs:5});
 await assert.rejects(()=>r.read('/api/world/run'),/timeout/);await new Promise(r=>setTimeout(r,50));assert.equal(r.receipts.length,0);
});
test('D02 string complete flags and altered day never declare matched evidence',async()=>{
 const {collectPublicProof}=await import('./proof/collect.mjs'),t=await publicFixture();
 for(const change of [s=>s.scope.complete='false',s=>s.scope.day='invented',s=>s.partial=true,s=>s.scope.partialReason='unexpected partial reason'])assert.equal((await collectPublicProof({base:t.meta.URL,...t},t.response(change))).status,'partial-or-mismatch');
});
test('D02 retains whole raw pages outside selected interval and rejects scenes outside its frozen cohort',async()=>{
 const {collectPublicProof}=await import('./proof/collect.mjs'),t=await publicFixture(),from=t.from+1;
 const selected=t.events.filter(e=>e.at>=from),counts=recountEvidence(selected,{worldId:'d02-local-simulation',runIds:[t.runId],from,to:t.to,day:null,complete:true});
 const reader=async url=>new URL(url).pathname==='/api/world/autonomy'?new Response(JSON.stringify({...counts.oracle,values:counts.values})):t.response()(url);
 const r=await collectPublicProof({base:t.meta.URL,...t,from},reader);assert.equal(r.status,'raw-recount-matched');
 const page=r.receipts.find(r=>new URL(r.URL).pathname==='/api/world/events'),raw=JSON.parse(Buffer.from(page.rawBodyBase64,'base64'));
 assert.equal(raw.length,t.events.length);assert.ok(raw.length>r.events.length);assert.deepEqual(page.cohort.eventIds,raw.map(e=>e.id));
 await assert.rejects(()=>collectPublicProof({base:t.meta.URL,...t,from,scenes:[t.b.p2.scene]},reader),/frozen event cohort/);
});
