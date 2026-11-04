// Current engine18 behavior and checkpoint-only replay; all model responses are synthetic.
import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {WorldRuntime} from '../worker/core/world-runtime.ts';import {Ledger} from '../worker/core/ledger.ts';import {makeHooks} from '../src/engine/rules.ts';
import {loadRun,assertCompatible} from '../src/replay/player.ts';import {currentVersions} from '../src/replay/versions.ts';
const NOW=Date.parse('2026-11-04T12:00:00Z');
function boot(t,{model=false}={}){const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,calls=0;const sql={exec(q,...b){const st=db.prepare(q),rows=st.columns().length?st.all(...b):(st.run(...b),[]);return{toArray:()=>rows};},transactionSync(fn){const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const result=fn();db.exec('RELEASE '+n);return result;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}}};
 const ledger=new Ledger(sql,{dailyCapUsd:30,now:()=>NOW});ledger.init();
 const runtime=new WorldRuntime(sql,{worldId:'speech-version',ledger,meetingGate:'off',hooks:makeHooks(),model:model?{base:'https://synthetic.invalid',key:'synthetic',model:'synthetic',timeoutMs:1000,fetcher:async(_u,init)=>{calls++;const request=JSON.parse(init.body),freedom=request.messages[0].content.match(/freedom "(\w+)"/)?.[1]??'where';return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({freedom,decision:'stay',target_place:'Commons Cafe',target_agent:'',offer_item:'',want_item:'',public_reason:'A public pause.',line:'잠시 쉬어요.'})}}],usage:{prompt_tokens:20,completion_tokens:30}}));}}:null});runtime.init(NOW);return{runtime,sql,get calls(){return calls;}};}
function record(rt){const r=rt.runLog.current;return{...r,inputs:rt.runLog.inputs(r.runId,0,1000),events:rt.events(0,10000,{runId:r.runId}),readThrough:rt.runLog.boundary(r.runId)};}
test('engine18 is distinct while the original engine15 exact tuple stays checkpoint-compatible',()=>{
 assert.deepEqual(currentVersions(),{schemaVersion:'run-log-2',engineVersion:'engine-18',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-d42ba8247057'});
 const original={schemaVersion:'run-log-2',engineVersion:'engine-15',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-ffb109917767'},bytes=JSON.stringify(original);
 assert.doesNotThrow(()=>assertCompatible(original));assert.throws(()=>assertCompatible(original,currentVersions()));assert.throws(()=>assertCompatible({...original,catalogVersion:'catalog-unknown'}));assert.equal(JSON.stringify(original),bytes);
});
test('current runtime enables persona greetings with complete history independently of the old values flag',async t=>{
 const x=boot(t);x.runtime.commitExternal(NOW,'two-neighbors',s=>{for(const m of s.muses){m.place='commons:cafe';m.travel=null;m.intent=null;m.beat={id:'look_around',clip:'look_around',line:null,startedAt:NOW,endsAt:NOW+3600000};m.lastMet={};if(!['01-sunny','02-moss'].includes(m.id))(s.paused??={})[m.id]={at:NOW,version:1,by:'fixture'};}});
 await x.runtime.heartbeat(NOW);const greeting=x.runtime.events().find(e=>e.kind==='greet'&&e.data.public);assert.ok(greeting);assert.equal(greeting.source,'rule');assert.doesNotMatch(greeting.line,/^Hi (?:Sunny|Moss)!$/);assert.match(greeting.line,/Sunny|Moss/);assert.equal(x.calls,0);
});
test('English fallback input, exact RULE speech and snapshot survive checkpoint projection without model replay',async t=>{
 const x=boot(t,{model:true});x.runtime.commitExternal(NOW,'resident-only',s=>{for(const m of s.muses){m.place='commons:cafe';m.travel=null;m.intent=null;m.beat=null;if(m.id!=='01-sunny')(s.paused??={})[m.id]={at:NOW,version:1,by:'fixture'};}});x.runtime.requestSpotlight('01-sunny',NOW,{origin:'visitor',requester:'synthetic'});
 await x.runtime.heartbeat(NOW);assert.equal(x.calls,1);const r=record(x.runtime),bytes=JSON.stringify(r),player=loadRun(r);player.seek(Number.MAX_SAFE_INTEGER);const frame=player.getFrame();
 assert.equal(frame.inputs.at(-1).input.residentEnglishFallback,'01-sunny');assert.equal(frame.snapshotHash,r.inputs.at(-1).afterHash);assert.deepEqual(frame.publicState,JSON.parse(r.inputs.at(-1).afterSnapshot.body));
 const original=r.events.filter(e=>e.muse==='01-sunny'&&['beat','depart','spotlight_fallback'].includes(e.kind));assert.ok(original.length);for(const e of original){const restored=frame.events.find(q=>q.id===e.id);assert.equal(restored.source,'rule');assert.equal(restored.line,e.line);assert.equal(restored.recorded.versions.engineVersion,'engine-18');}
 assert.equal(JSON.stringify(r),bytes);assert.equal(x.calls,1,'checkpoint playback never calls the model');
});
