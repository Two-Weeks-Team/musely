// Offline writer fixture for tool regressions. No provider/authentication/browser/network is used.
import {DatabaseSync} from 'node:sqlite';
import {WorldRuntime} from '../../worker/core/world-runtime.ts';
import {tick} from '../../src/engine/world.ts';
import {makeHooks} from '../../src/engine/rules.ts';
import {PLACES} from '../../src/engine/places.ts';
import {currentVersions} from '../../src/replay/versions.ts';
import {hash} from '../proof/evidence.mjs';
export function controlledFixture(sourceSha,htmlSha256){
 const start=Date.parse('2026-11-02T16:00:00Z'),muse='03-ripple',item='transit_pass',worldId='d05-offline-tool-test';
 const inputs=[{now:start+60000,spot:{muse,priority:false},decision:{muse,freedom:'where',source:'replay',output:{decision:'go',target_place:PLACES.find(p=>p.id==='bay:sf').name,target_agent:'',offer_item:'',want_item:'',public_reason:'Controlled test input; no provider',line:''}}},{now:start+80000,spot:{muse,priority:false},decision:null}];
 const run=withItem=>{const db=new DatabaseSync(':memory:');let depth=0,at=start;const sql={exec(q,...b){if(withItem&&/^INSERT INTO world\b/.test(q)){const s=JSON.parse(b[0]);s.muses.find(m=>m.id===muse).inventory.push(item);b[0]=JSON.stringify(s);}const st=db.prepare(q);if(/^\s*(SELECT|WITH|EXPLAIN)/i.test(q))return{toArray:()=>st.all(...b)};st.run(...b);return{toArray:()=>[]};},transactionSync(f){const sp='p'+depth++;db.exec('SAVEPOINT '+sp);try{const r=f();db.exec('RELEASE '+sp);return r;}catch(e){db.exec('ROLLBACK TO '+sp);db.exec('RELEASE '+sp);throw e;}finally{depth--;}}};
 try{const rt=new WorldRuntime(sql,{worldId,model:null,meetingGate:'off',hooks:makeHooks(),publicationNow:()=>at});rt.init(start);const initial=rt.state();for(const input of inputs){const before=rt.state(),next=tick(before,structuredClone(input),makeHooks());at=input.now;rt.commitExternal(at,'CONTROLLED_SIMULATION '+(withItem?'with':'without')+' input-sha256='+hash(input),(s,emit)=>{Object.assign(s,next.state,{version:before.version});next.events.forEach(emit);},()=>({action:'controlled_p1_tick',payload:input}));}
 const h=rt.runLog.current,events=rt.events(0,1000,{runId:h.runId});return{proof:{initial,seed:initial.seed,inputs:structuredClone(inputs),final:rt.state(),events},record:{...h,readThrough:rt.runLog.boundary(h.runId),inputs:rt.runLog.inputs(h.runId),events},eventRecords:Object.fromEntries(events.map(e=>[e.id,rt.eventRecord(e.id)]))};}finally{db.close();}};
 const before=run(false),after=run(true),pair={classification:'controlled-simulation',muse,item,without:before.proof,with:after.proof};
 const manifest={classification:'controlled-simulation',label:'REPLAY | CONTROLLED COMPARISON (SIMULATION) | VIRTUAL WORLD',sourceSha,htmlSha256,worldId,versions:currentVersions(),muse,item,seed:pair.with.seed,inputSha256:hash(inputs),runIds:{without:before.record.runId,with:after.record.runId},files:{}};
 return{before,after,pair,manifest};
}
