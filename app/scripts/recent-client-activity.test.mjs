// Entirely in-memory: actual production classes, no HTTP/listen/provider/secret or real account.
import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../worker/core/ledger.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Trust} from '../worker/core/trust.ts';
import {ConnectedHost} from '../worker/core/connected.ts';
import {hashAgentKey} from '../worker/core/agent-keys.ts';
import {tick} from '../src/engine/world.ts';
const T0=Date.parse('2026-11-03T16:00:00Z'),MUSE='00-jolly';
async function setup(){
 const db=new DatabaseSync(':memory:');let depth=0;const sql={exec(q,...params){const s=db.prepare(q);if(/^\s*(SELECT|WITH)/i.test(q))return{toArray:()=>s.all(...params)};s.run(...params);return{toArray:()=>[]};},transactionSync(fn){const name='tx'+depth++;db.exec('SAVEPOINT '+name);try{const r=fn();db.exec('RELEASE '+name);return r;}catch(e){db.exec('ROLLBACK TO '+name);db.exec('RELEASE '+name);throw e;}finally{depth--;}}};
 const ledger=new Ledger(sql,{dailyCapUsd:1});ledger.init();const trust=new Trust(sql);trust.init();const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),root=await crypto.subtle.exportKey('jwk',pair.privateKey);await trust.ensureAgents(root);const runtime=new WorldRuntime(sql,{worldId:'offline-recent-activity',meetingGate:'off',ledger,model:null,hooks:{},delegationValid:m=>!trust.suspended(m)});runtime.init(T0);let now=T0;const host=new ConnectedHost({sql,trust,runtime,hooks:{},baseUrl:'https://offline.invalid',ownerRoot:()=>root,ownerClaimed:()=>true,now:()=>now});host.init();const issued=await host.issueKey(),keyHash=await hashAgentKey(issued.key);
 runtime.commitExternal(T0,'offline-ready',s=>{const m=s.muses.find(m=>m.id===MUSE);m.place='commons:hq';m.travel=null;m.beat=null;m.intent=null;});
 const first=await host.mcp(keyHash,'tools/list',{},false);assert.equal(first.status,'ok');return{runtime,host,keyHash,setNow:n=>now=n,close:()=>db.close()};
}
test('first just-observed client call blocks the owner ambient trip',async()=>{const t=await setup();try{const r=tick(t.runtime.state(),{now:T0+1});assert.equal(r.events.filter(e=>e.muse===MUSE&&e.kind==='depart').length,0);}finally{t.close();}});
test('a successful same-client call five minutes later also blocks ambient travel for its next two minutes',async()=>{const t=await setup();try{t.setNow(T0+300000);const call=await t.host.mcp(t.keyHash,'tools/list',{},false);assert.equal(call.status,'ok');const state=t.runtime.state();const recordedActivity=state.inbox.connected[MUSE],r=tick(state,{now:T0+300001});const departures=r.events.filter(e=>e.muse===MUSE&&e.kind==='depart');console.log(JSON.stringify({lastPersistedConnection:recordedActivity,lastSuccessfulClientCall:T0+300000,nextTick:T0+300001,departures:departures.map(e=>({kind:e.kind,source:e.source,speed:e.data.speed,to:e.data.to}))}));assert.equal(departures.length,0,'fresh actual client dispatch within2min must take priority over ambient travel');}finally{t.close();}});
