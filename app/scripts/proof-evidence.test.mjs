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
