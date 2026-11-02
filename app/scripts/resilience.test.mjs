// D-03 boundary regressions against real SQLite/runtime/model code; outbound requests stay in the test stub.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {register} from 'node:module';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
import {Ledger,STALE_RESERVATION_MS} from '../worker/core/ledger.ts';
import {callModel} from '../worker/core/model.ts';
import {makeHooks} from '../src/engine/rules.ts';
import fault from './fixtures/model-fault-worker.mjs';
function sqlite(file=':memory:') {
  const db=new DatabaseSync(file);let depth=0;
  return {close:()=>db.close(),exec(q,...b){if(/^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i.test(q))throw Error('Use transactionSync');const st=db.prepare(q);if(/^\s*(select|with|explain)/i.test(q))return{toArray:()=>st.all(...b)};st.run(...b);return{toArray:()=>[]};},transactionSync(fn){const p='t'+depth++;db.exec('SAVEPOINT '+p);try{const r=fn();if(r?.then)throw Error('sync only');db.exec('RELEASE '+p);return r;}catch(e){db.exec('ROLLBACK TO '+p);db.exec('RELEASE '+p);throw e;}finally{depth--;}}};
}
function runtime(sql,clock,{mode='503',key='test-only-not-provider-key',cap=1,fetcher}={}) {
 const ledger=new Ledger(sql,{dailyCapUsd:cap,now:()=>clock.now});ledger.init();
 const rt=new WorldRuntime(sql,{worldId:'d03-isolated',meetingGate:async()=>()=>({ok:false,event:null}),hooks:makeHooks(),ledger,model:{base:'https://musely-d03-stub.invalid/'+mode,key,model:'muse-spark-1.3',timeoutMs:8000,fetcher:fetcher??((u,init)=>fault.fetch(new Request(u,init)))}});rt.init(clock.now);return{rt,ledger};
}
test('D03 429 and 503 settle once, preserve honest fallback sources and the following world tick',async()=>{
 for(const [mode,reason] of [['429','rate_limited'],['503','upstream']]){
  const sql=sqlite(),clock={now:Date.parse('2026-11-03T16:00:00Z')};const {rt,ledger}=runtime(sql,clock,{mode});
  const [a,b]=await Promise.all([rt.heartbeat(clock.now),rt.heartbeat(clock.now)]);
  assert.deepEqual([a.status,b.status].sort(),['committed','skipped_duplicate']);
  const fallback=rt.events().filter(e=>e.kind==='spotlight_fallback');assert.equal(fallback.length,1);assert.equal(fallback[0].data.reason,reason);assert.notEqual(fallback[0].source,'live');
  const row=sql.exec('SELECT * FROM reservations').toArray();assert.equal(row.length,1);assert.equal(row[0].cost,mode==='429'?0:row[0].amount);assert.equal(ledger.status().reservedUsd,0);
  clock.now+=60000;assert.equal((await rt.heartbeat(clock.now)).status,'committed');assert.equal(rt.state().tick,2);
  assert.equal(new Set(rt.events(0,5000).map(e=>e.id)).size,rt.events(0,5000).length);sql.close();
 }
});
test('D03 actual eight-second deadline aborts an uncooperative upstream, never accepting its answer',async()=>{
 let signal,calls=0;const before=performance.now();
 const result=await callModel({base:'https://musely-d03-stub.invalid',key:'test-only',model:'muse-spark-1.3',timeoutMs:8000,fetcher:async(_u,init)=>{calls++;signal=init.signal;return new Promise(()=>{});}},'spotlight',[]);
 const elapsed=performance.now()-before;assert.equal(result.ok,false);assert.equal(result.kind,'timeout');assert.equal(signal.aborted,true);assert.equal(calls,1);assert.ok(elapsed>=7900 && elapsed<12000,`actual deadline ${elapsed} ms`);
});
test('D03 cold reconstruction after a pre-call reservation never calls twice or loses the following alarm',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'musely-d03-')),file=join(dir,'world.sqlite');let sql;
 try{const clock={now:Date.parse('2026-11-03T16:00:00Z')};sql=sqlite(file);const first=runtime(sql,clock),state=first.rt.state();
  const id=`d03-isolated:${state.day}:${state.tick}:spotlight`;assert.equal(first.ledger.reserve({id,tier:'world',session:'world',ip:'',action:'spotlight',maxCostUsd:0.01}).ok,true);
  const snapshot=JSON.stringify(state);sql.close();sql=sqlite(file);let calls=0;
  const resumed=runtime(sql,clock,{fetcher:async(u,init)=>{calls++;return fault.fetch(new Request(u,init));}});assert.equal(JSON.stringify(resumed.rt.state()),snapshot);
  const result=await resumed.rt.heartbeat(clock.now);assert.equal(result.spotlight.reason,'already_reserved');assert.equal(calls,0);assert.equal(resumed.rt.state().tick,1);
  clock.now+=STALE_RESERVATION_MS+1000;assert.equal((await resumed.rt.heartbeat(clock.now)).status,'committed');assert.equal(calls,1);
  const r=sql.exec('SELECT cost FROM reservations WHERE id = ?',id).toArray()[0];assert.equal(r.cost,0.01);assert.equal(resumed.ledger.status().reservedUsd,0);
 }finally{sql?.close();await rm(dir,{recursive:true,force:true});}
});
test('D03 UTC budget midnight and Menlo Park world midnight survive duplicate alarms and restart separately',async()=>{
 for(const [start,expectedWorldDay,expectedBudgetDay] of [['2026-11-03T23:59:00Z','2026-11-03','2026-11-04'],['2026-11-04T07:59:00Z','2026-11-04','2026-11-04']]){
  const sql=sqlite(),clock={now:Date.parse(start)};
  // Passing an empty key deliberately disables all outbound model calls.
  const s=runtime(sql,clock,{key:''});await s.rt.heartbeat(clock.now);clock.now+=60000;
  const restarted=runtime(sql,clock,{key:''});const results=await Promise.all([restarted.rt.heartbeat(clock.now),restarted.rt.heartbeat(clock.now)]);
  assert.deepEqual(results.map(r=>r.status).sort(),['committed','skipped_duplicate']);assert.equal(restarted.rt.state().day,expectedWorldDay);assert.equal(restarted.ledger.status().day,expectedBudgetDay);
  assert.equal(restarted.rt.state().tick,2);const events=restarted.rt.events(0,5000);assert.equal(new Set(events.map(e=>e.id)).size,events.length);sql.close();
 }
});
test('D03 the real DO alarm retries do not duplicate ticks and an unexpected failure still re-arms the alarm',async()=>{
 register('data:text/javascript,'+encodeURIComponent(`export async function resolve(spec,ctx,next){if(spec==='cloudflare:workers')return{url:'data:text/javascript,export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}',shortCircuit:true};return next(spec,ctx);}`));
 const {WorldDO}=await import('../worker/world-do.ts');const sql=sqlite();let alarm=null,ready,scheduled=0;
 const ctx={storage:{sql,transactionSync:fn=>sql.transactionSync(fn),getAlarm:async()=>alarm,setAlarm:async at=>{scheduled++;alarm=at;}},blockConcurrencyWhile:fn=>(ready=fn())};
 const env={MODEL_ID:'muse-spark-1.3',MODEL_BASE:'https://musely-d03-stub.invalid/503',DAILY_BUDGET_USD:'1',TURNSTILE_SITEKEY:'',ALLOWED_HOSTS:'localhost',PUBLIC_ORIGIN:'http://localhost'};
 try{const d=new WorldDO(ctx,env);await ready;const before=d.worldView().tick;
  await Promise.all([d.alarm(),d.alarm()]);assert.equal(d.worldView().tick,before+1);assert.ok(alarm>Date.now());
  const count=scheduled;
  // Only the failed call boundary is replaced; the production alarm's finally/retention/storage path runs for real.
  d.runtime.heartbeat=async()=>{throw Error('isolated unexpected heartbeat failure');};
  await assert.rejects(d.alarm(),/isolated unexpected/);assert.equal(scheduled,count+1);assert.ok(alarm>Date.now());
 }finally{sql.close();}
});

test('D03 healthy recovery matches the real serialized spotlight context for every freedom',async()=>{
 const {buildMessages,checkOutput}=await import('../worker/core/actions.ts');
 const {spotlightInput}=await import('../src/engine/world.ts');
 const sql=sqlite(),clock={now:Date.parse('2026-11-03T16:00:00Z')};
 try {
  const {rt}=runtime(sql,clock,{key:''});
  for(const freedom of ['where','who','offer','plan']){
   const input=spotlightInput(rt.state(),'00-jolly',freedom,clock.now);
   const result=await callModel({base:'https://musely-d03-stub.invalid/healthy',key:'test-only',model:'muse-spark-1.3',timeoutMs:8000,fetcher:(u,init)=>fault.fetch(new Request(u,init))},'spotlight',buildMessages('spotlight',input));
   assert.equal(result.ok,true);
   assert.equal(checkOutput('spotlight',input,result.output),null,freedom);
   if(freedom==='who'||freedom==='offer')assert.ok(input.muses.some(m=>m.muse===result.output.target_agent),freedom+' selects a real peer');
  }
 } finally {sql.close();}
});
