import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {actorLabel,actorRole,knownActorNamed} from '../src/engine/actor-display.ts';
import {ownerArea,areaContains} from '../src/engine/location.ts';
import {createWorld,tick} from '../src/engine/world.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Ledger} from '../worker/core/ledger.ts';
import {encounterOpportunities,startIntroduction,encounterNotices} from '../worker/core/encounters.ts';
globalThis.fetch=async()=>{throw Error('network disabled in personal-boundary test');};
const NOW=Date.parse('2026-11-03T20:00:00Z');
const decision={muse:'01-sunny',freedom:'where',source:'live',output:{decision:'walk',target_place:'Garden',target_agent:'',offer_item:'',want_item:'',public_reason:'Synthetic fixture',line:''}};
function addPersonal(s,id='pm_synthetic'){const m=structuredClone(s.muses[1]);m.id=id;m.controlMode='personal';m.travel=null;m.beat=null;m.intent=null;s.muses.push(m);return m;}
test('unknown display has no persona, resident alias, role or authority fallback',()=>{
 assert.equal(actorLabel('01-sunny'),'Sunny');assert.equal(actorLabel('pm_synthetic'),'Visiting Muse');assert.equal(actorRole('pm_synthetic'),null);
 assert.equal(knownActorNamed('Visiting Muse'),null);assert.equal(knownActorNamed('Sunny'),'01-sunny');
});
test('encounter observations and explicit introduction tolerate distinct personal IDs',()=>{
 const s=createWorld('personal-display',NOW),a=addPersonal(s),b=addPersonal(s,'pm_other');
 const opportunities=encounterOpportunities(s,'01-sunny',NOW).new_muses.filter(m=>m.id.startsWith('pm_'));
 assert.deepEqual(opportunities.map(m=>m.id).sort(),[a.id,b.id].sort());assert.ok(opportunities.every(m=>m.name==='Visiting Muse'&&m.role===null));
 tick(s,{now:NOW});assert.doesNotThrow(()=>encounterNotices(s,a.id));
 startIntroduction(s,a.id,'01-sunny',NOW);assert.ok(s.muses[1].memory.some(m=>m.includes('Visiting Muse')));
 assert.equal(a.controlMode,'personal');assert.equal(a.travel,null);assert.equal(a.intent,null);
});
for(const mode of ['personal','connected'])test(mode+' actor cannot receive an injected engine spotlight decision',()=>{
 const s=createWorld('boundary',NOW);s.spotlight.cursor=1;if(mode==='personal')s.muses[1].controlMode='personal';else s.inbox.connected['01-sunny']=NOW;
 const result=tick(s,{now:NOW,decision});assert.ok(result.events.some(e=>e.kind==='decision_rejected'&&e.data.reason==='personal or connected control'));
 assert.equal(result.state.muses[1].travel,null);assert.equal(result.state.muses[1].beat,null);
});
for(const mode of ['personal','connected'])test('late '+mode+' authority rejects an in-flight synthetic answer even without a version bump',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0;const sql={exec(q,...args){const st=db.prepare(q),rows=st.columns().length?st.all(...args):(st.run(...args),[]);return {toArray:()=>rows};},transactionSync(fn){const sp='tx'+depth++;db.exec('SAVEPOINT '+sp);try{const r=fn();db.exec('RELEASE '+sp);return r;}catch(e){db.exec('ROLLBACK TO '+sp);db.exec('RELEASE '+sp);throw e;}finally{depth--;}}};
 const ledger=new Ledger(sql,{dailyCapUsd:0});ledger.init();let rt;
 rt=new WorldRuntime(sql,{worldId:'authority-race',model:null,meetingGate:'off',ledger,beforeCommit:()=>{const s=rt.state();if(mode==='personal')s.muses[1].controlMode='personal';else s.inbox.connected['01-sunny']=NOW;sql.exec('UPDATE world SET state=? WHERE id=1',JSON.stringify(s));}});rt.init(NOW);
 const s=rt.state();s.spotlight.cursor=1;sql.exec('UPDATE world SET state=? WHERE id=1',JSON.stringify(s));
 rt.liveSpotlight=async()=>({decision,info:{source:'live'}});await rt.heartbeat(NOW);
 assert.ok(rt.events().some(e=>e.kind==='decision_discarded'&&e.data.reason==='personal or connected before commit'));assert.equal(rt.state().muses[1].travel,null);assert.equal(ledger.status().liveCalls,0);
});

test('unknown actor without controlMode or connection never inherits resident autonomy',()=>{
 const s=createWorld('unknown-authority',NOW),m=addPersonal(s,'unknown-fixture');delete m.controlMode;s.spotlight.cursor=s.muses.length-1;
 const result=tick(s,{now:NOW,decision:{...decision,muse:m.id}}),after=result.state.muses.find(a=>a.id===m.id);
 assert.equal(after.travel,null);assert.equal(after.beat,null);assert.equal(after.intent,null);
 assert.ok(!result.events.some(e=>e.muse===m.id&&['depart','beat','encounter_reply'].includes(e.kind)));
 assert.ok(result.events.some(e=>e.kind==='decision_rejected'&&e.muse===m.id));
});

test('unknown owner with valid area and stale presence cannot enter ambient resident stroll',()=>{
 const s=createWorld('unknown-owner',NOW),m=addPersonal(s,'unknown-owner');delete m.controlMode;s.owner.muse=m.id;s.spotlight.cursor=s.muses.length-1;
 assert.equal(areaContains(ownerArea(s.owner),m.place),true);
 const after=tick(s,{now:NOW+86_400_000}).state.muses.find(a=>a.id===m.id);assert.equal(after.travel,null);assert.equal(after.beat,null);
});
test('unknown actor without explicit public Wants is rejected rather than inheriting a resident persona',()=>{
 const s=createWorld('missing-wants',NOW),m=addPersonal(s);delete m.wants;const before=structuredClone(s);
 assert.throws(()=>tick(s,{now:NOW}),/requires explicit public Wants/);assert.deepEqual(s,before);
});
