import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createWorld,tick,spotlightFor} from '../src/engine/world.ts';
import {resolveMeeting} from '../src/engine/rules.ts';
import {placeById} from '../src/engine/places.ts';
import {grantItem} from '../src/engine/items.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {ResidentGoalStore} from '../worker/core/resident-wants-model.ts';
import {runResidentGoalTurn} from '../worker/core/resident-goal-loop.ts';
const T=Date.parse('2026-11-04T01:00:00Z'),PM='pm_11111111-1111-4111-8111-111111111111';
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('offline personal proposal fixture');};
after(()=>{globalThis.fetch=originalFetch;});
function peer(s){const m={...structuredClone(s.muses[0]),id:PM,controlMode:'personal',profile:{actorId:PM,displayName:'Fixture',appearanceId:'00-jolly',revision:1},place:'commons:garden',travel:null,beat:null,inventory:[],wants:{goal:'A public fixture need',items:['tea'],source:'connected',updatedAt:T}};s.muses.push(m);return m;}
function meeting(guard){const s=createWorld('meeting',T),a=s.muses.find(m=>m.id==='01-sunny'),b=peer(s);a.place=b.place;a.travel=null;a.beat=null;a.inventory=['tea'];a.wants.items=['coffee'];b.inventory=['coffee'];const events=resolveMeeting(s.items,s,a,b,placeById(a.place),()=>0,T,guard);return {s,events,a,b};}
test('verified personal peer reaches a pending Task without an invented acceptance',()=>{
 let calls=0;const x=meeting(()=>{calls++;return true;});assert.equal(calls,1);assert.ok(x.events.some(e=>e.kind==='trade_proposed'));assert.equal(x.s.inbox.tasks.length,1);assert.equal(x.s.inbox.tasks[0].awaiting,PM);assert.equal(x.s.inbox.tasks[0].status,'pending');assert.equal(x.events.some(e=>e.kind==='trade_completed'),false);
});
test('personal peer requires an explicitly true trusted proposal guard',()=>{for(const guard of [undefined,()=>false]){const x=meeting(guard);assert.equal(x.s.inbox.tasks.length,0);assert.deepEqual(x.events.map(e=>e.kind),['greet']);}});
test('personal actor never becomes an autonomous resident proposer',()=>{const x=meeting(()=>false);const events=resolveMeeting(x.s.items,x.s,x.b,x.a,placeById(x.b.place),()=>0,T,()=>true);assert.deepEqual(events,[]);});
test('resident offer intent uses explicit current authority for a personal peer instead of a permanent prefix ban',()=>{
 for(const guard of [undefined,()=>false,()=>true]){
  const s=createWorld('offer',T);s.spotlight.cursor=1;for(const m of s.muses){m.travel=null;m.beat=null;m.intent=null;}
  const b=peer(s);let spot;for(let i=0;i<40;i++){s.tick=i;spot=spotlightFor(s,T);if(spot.freedom==='offer')break;}assert.equal(spot.freedom,'offer');
  const a=s.muses.find(m=>m.id===spot.muse);a.inventory=['tea'];a.place=b.place;a.wants.items=['coffee'];b.inventory=['coffee'];
  const result=tick(s,{now:T,spot:{muse:a.id,priority:false},decision:{muse:a.id,freedom:'offer',source:'live',output:{decision:'offer',target_agent:PM,offer_item:'tea',want_item:'coffee',target_place:'',public_reason:'',line:''}}},guard?{canProposeTrade:guard}:{});
  assert.equal(result.events.some(e=>e.kind==='trade_intent'&&e.muse===a.id),guard?.()===true);
 }
});
function goalFixture(t,hook,authorizePeer=true){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0;
 const sql={exec(q,...b){const st=db.prepare(q),rows=st.columns().length?st.all(...b):(st.run(...b),[]);return{toArray:()=>rows};},transactionSync(fn){const name='t'+depth++;db.exec('SAVEPOINT '+name);try{const r=fn();db.exec('RELEASE '+name);return r;}catch(e){db.exec('ROLLBACK TO '+name);db.exec('RELEASE '+name);throw e;}finally{depth--;}}};
 const runtime=new WorldRuntime(sql,{worldId:'goal',model:null,meetingGate:'off',hooks:hook===undefined?{}:{canProposeTrade:hook}});runtime.init(T);
 const goals=new ResidentGoalStore(sql);goals.init();
 runtime.commitExternal(T,'fixture',s=>{s.spotlight.cursor=2;for(const m of s.muses){m.travel=null;m.beat=null;m.intent=null;}const a=s.muses.find(m=>m.id==='02-moss'),b=peer(s);a.place=b.place;a.inventory=['clover_seed','tea'];grantItem(s.items,b,'garden_pass',T,b.place,'craft');});
 const policy={enabled:true,goals,ownership:id=>id==='02-moss'?'resident':'personal',authorize:(_s,_a,b)=>b===null||authorizePeer,goalBeatsFor:()=>['garden_plant']};
 return{runtime,policy};
}
test('actual SQLite goal caller admits a public personal candidate only with current claim and authority',t=>{
 const x=goalFixture(t,()=>true);const out=runResidentGoalTurn(x.runtime,x.policy,T);assert.equal(out.kind,'proposed');const tasks=x.runtime.state().inbox.tasks;assert.equal(tasks.length,1);assert.equal(tasks[0].to,PM);assert.equal(tasks[0].status,'pending');assert.equal(tasks[0].history.length,1);
});
test('actual SQLite goal caller fails closed for absent/false claim hook or lost policy authority',t=>{
 for(const [hook,authority] of [[undefined,true],[()=>false,true],[()=>true,false]]){const x=goalFixture(t,hook,authority);runResidentGoalTurn(x.runtime,x.policy,T);assert.equal(x.runtime.state().inbox.tasks.length,0);}
});
