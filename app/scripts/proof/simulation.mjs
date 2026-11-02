// Local-only controlled evidence. Fresh ephemeral crypto roots never leave this process.
import {DatabaseSync} from 'node:sqlite';
import {Trust, OWNER_SLOT} from '../../worker/core/trust.ts';
import {WorldRuntime} from '../../worker/core/world-runtime.ts';
import {runP0} from '../../worker/core/a2a.ts';
import {revokeMuse} from '../../worker/core/owner-control.ts';
import {publicState} from '../../worker/core/run-log.ts';
import {createWorld,tick} from '../../src/engine/world.ts';
import {makeHooks} from '../../src/engine/rules.ts';
import {PLACES} from '../../src/engine/places.ts';
export async function buildControlledProof() {
 const db=new DatabaseSync(':memory:');let depth=0;
 const sql={exec(q,...b){const s=db.prepare(q);if(/^\s*(SELECT|WITH|EXPLAIN)/i.test(q))return {toArray:()=>s.all(...b)};s.run(...b);return {toArray:()=>[]};},transactionSync(f){const sp='p'+depth++;db.exec('SAVEPOINT '+sp);try{const r=f();db.exec('RELEASE '+sp);return r;}catch(e){db.exec('ROLLBACK TO '+sp);db.exec('RELEASE '+sp);throw e;}finally{depth--;}}};
 const trust=new Trust(sql);trust.init();
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),ownerRoot=await crypto.subtle.exportKey('jwk',pair.privateKey);
 await trust.ensureAgents(ownerRoot);let at=Date.now();
 const runtime=new WorldRuntime(sql,{worldId:'d02-local-simulation',model:null,meetingGate:'off',hooks:makeHooks(),delegationValid:m=>!trust.suspended(m),publicationNow:()=>at});runtime.init(at);
 runtime.commitExternal(at,'local-test-item',(s)=>s.muses.find(m=>m.id===OWNER_SLOT).inventory.push('coffee','postage_stamp'));
 const ctx={trust,runtime,ownerRoot,ownerClaimed:true,baseUrl:'https://example.invalid',now:()=>at,requestedBy:'owner'};
 await runP0(ctx);at++;await revokeMuse(ctx,OWNER_SLOT,'local-simulation-owner');
 const beforeRefusal=publicState(runtime.state());at++;await runP0(ctx);const afterRefusal=publicState(runtime.state());
 const events=runtime.events(0,1000),verified=events.find(e=>e.kind==='a2a_verified'),trade=events.find(e=>e.kind==='trade_completed'),revoked=events.find(e=>e.kind==='delegation_revoked'),refused=events.find(e=>e.kind==='a2a_refused');
 if(!verified||!trade||!refused)throw Error('Local P0 fixture did not reach the required actual command outcomes');
 const record=runtime.eventRecord(verified.id);
 const start=Date.parse('2026-11-02T16:00:00Z'),initial=createWorld('d02-controlled-p1',start),muse='03-ripple',item='transit_pass',destination=PLACES.find(p=>p.id==='bay:sf');
 const inputs=[{now:start+60000,spot:{muse,priority:false},decision:{muse,freedom:'where',source:'replay',output:{decision:'go',target_place:destination.name,target_agent:'',offer_item:'',want_item:'',public_reason:'Controlled public input; no model call',line:''}}}];
 const run=withItem=>{let state=structuredClone(initial);if(withItem)state.muses.find(m=>m.id===muse).inventory.push(item);const first=structuredClone(state),log=[];for(const input of inputs){const r=tick(state,structuredClone(input),makeHooks());state=r.state;log.push(...r.events);}return {initial:first,seed:first.seed,inputs:structuredClone(inputs),final:state,events:log};};
 const p1={classification:'controlled-simulation',muse,item,without:run(false),with:run(true)};
 const scene={classification:'simulation',worldId:record.run.worldId,runId:record.runId,eventId:verified.id,version:record.input.versionAfter,snapshotHash:record.input.afterHash};
 db.close();return {classification:'simulation',limitations:['Ephemeral local roots only; no production owner claim','No provider calls or operational writes','P2 scene descriptor is a controlled test fixture, not a captured production scene'],p0:{verified,trade,revoked,refused,beforeRefusal,afterRefusal},p1,p2:{scene,record},events};
}
