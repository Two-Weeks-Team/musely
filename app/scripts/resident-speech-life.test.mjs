// Actual SQLite/Runtime and pure engine; provider is synthetic, no network.
import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {WorldRuntime} from '../worker/core/world-runtime.ts';import {Ledger} from '../worker/core/ledger.ts';
import {createWorld,tick} from '../src/engine/world.ts';import {harnessRoleId} from '../src/engine/harness.ts';
import {ruleResidentUtterance} from '../src/engine/resident-utterance.ts';import {snapshotBody,bodyHash} from '../worker/core/run-log.ts';
const NOW=Date.parse('2026-11-04T05:00:00Z');
function boot(t,{enabled=true,line='My own chosen words: {place}.',actor='06-ink',onCommit}={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,deny=false,clock=NOW;
 const sql={exec(q,...b){if(deny&&q.includes('SELECT muse, at, line FROM events'))throw Error('fixture-history-unavailable');const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};},transactionSync(fn){const id='s'+depth++;db.exec('SAVEPOINT '+id);try{const r=fn();db.exec('RELEASE '+id);return r;}catch(e){db.exec('ROLLBACK TO '+id);db.exec('RELEASE '+id);throw e;}finally{depth--;}}};
 const ledger=new Ledger(sql,{dailyCapUsd:30,now:()=>clock});ledger.init();const calls=[];
 const opts={worldId:'speech-runtime',ledger,meetingGate:'off',residentValuesEnabled:enabled,publicationNow:()=>clock,onCommit,
 residentActions:{enabled:true,maxConcurrent:4},residentLife:{enabled:true,ownershipKind:id=>id==='00-jolly'?'personal':'resident',allowedPlaceIds:['commons:cafe'],initialState:{schema:1,residents:[{id:actor,roleId:actor,goal:'A quiet break',routine:[{hour:0,place:'commons:cafe'}],memories:[],promises:[],lastServedAt:0,served:0}]}},
 model:{base:'https://offline.invalid',key:'fixture-only',model:'fixture',timeoutMs:100,fetcher:async(_u,init)=>{calls.push(JSON.parse(init.body).response_format.json_schema.name);return new Response(JSON.stringify({id:'fixture-response',choices:[{message:{content:JSON.stringify({freedom:'plan',decision:'recommend_book',target_place:'',target_agent:'',offer_item:'',want_item:'',public_reason:'A quiet break',line,duration_minutes:5})}}],usage:{prompt_tokens:10,completion_tokens:10}}));}}};
 const runtime=new WorldRuntime(sql,opts);runtime.init(NOW);const s=runtime.state();for(const m of s.muses){m.place='commons:cafe';m.beat=null;m.travel=null;m.intent=null;if(m.id!==actor)(s.paused??={})[m.id]={at:NOW,version:1,by:'fixture'};}sql.exec('UPDATE world SET state=?,version=? WHERE id=1',JSON.stringify(s),s.version);
 return{runtime,sql,opts,calls,denyHistory:()=>deny=true,clock:n=>clock=n};
}
const speech=(id,line,at=NOW,kind='encounter_reply')=>({at,source:'live',kind,muse:id,place:'commons:cafe',line,data:{evidence:{requestId:'fixture-public-request'},decision:'recommend_book'},tags:[]});
test('LIVE selected stay preserves exact provider words in event, current state and hashed checkpoint',async t=>{
 const x=boot(t);await x.runtime.heartbeat(NOW);const e=x.runtime.events().find(e=>e.kind==='beat'&&e.muse==='06-ink');assert.equal(e.source,'live');assert.equal(e.line,'My own chosen words: {place}.');assert.ok(e.data.evidence.reservationId);assert.equal(x.runtime.state().muses.find(m=>m.id==='06-ink').beat.line,e.line);
 const input=x.runtime.runLog.lastInput();assert.equal(input.afterSnapshot.hash,input.afterHash);assert.equal(bodyHash(input.afterSnapshot.body),input.afterHash);assert.equal(input.afterSnapshot.body,snapshotBody(x.runtime.state()));assert.match(JSON.parse(input.afterSnapshot.body).muses.find(m=>m.id==='06-ink').beat.line,/^text-sha256:/);
 const original=input.afterSnapshot.body;x.clock(NOW+300000);const reopened=new WorldRuntime(x.sql,x.opts);reopened.init(NOW+300000);await reopened.heartbeat(NOW+300000);const last=reopened.events().filter(e=>e.kind==='beat'&&e.muse==='06-ink').at(-1);assert.equal(last.line,null);assert.ok(last.data.evidence.reservationId);assert.equal(reopened.state().muses.find(m=>m.id==='06-ink').beat.line,null);assert.equal(reopened.runLog.lastInput().input.residentActions.turns[0].used,true);assert.equal(input.afterSnapshot.body,original);
});
test('nine unrelated residents start actual RULE activities in their own persona without the borrowed Vega line',()=>{
 for(const id of ['02-moss','03-ripple','05-bloom','06-ink','nr_cedar','nr_harbor','nr_nova','nr_rowan','nr_indigo']){let found=false;
  for(let seed=0;seed<100&&!found;seed++){const s=createWorld('speech-'+seed,NOW);if(!s.muses.some(m=>m.id===id)){const m=structuredClone(s.muses.find(m=>m.id===harnessRoleId(id)));s.muses.push({...m,id,residentRole:harnessRoleId(id)});}for(const m of s.muses){m.place='commons:benches';m.beat=null;m.travel=null;m.intent=null;if(m.id!==id)(s.paused??={})[m.id]={at:NOW,version:1,by:'fixture'};}
   const out=tick(s,{now:NOW,residentActors:[id],residentFallback:[id]},{residentValuesEnabled:true,residentSpeechHistory:[]});const e=out.events.find(e=>e.muse===id&&e.kind==='beat'&&e.data.beat==='observe_sky');if(!e)continue;found=true;assert.equal(e.source,'rule');assert.equal(e.line,ruleResidentUtterance(out.state,id,'observe_sky',NOW));assert.doesNotMatch(e.line,/Vega/);assert.equal(out.state.muses.find(m=>m.id===id).beat.line,e.line);
  }assert.equal(found,true,id+' fixture must reach the actual sky beat');
 }
});
test('complete SQLite history beyond 500 rows silences only resident speech and survives restart until exact 30 minute boundary',t=>{
 const x=boot(t),id='06-ink';x.runtime.commitExternal(NOW-1000,'old-line',(_s,emit)=>{emit(speech(id,'Same public line.',NOW-1000));for(let i=0;i<600;i++)emit({...speech('00-jolly',null,NOW-999),kind:'fixture-noise'});});
 const reopened=new WorldRuntime(x.sql,x.opts);reopened.init(NOW);const old=x.runtime.events().find(e=>e.line==='Same public line.'),again=reopened.commitExternal(NOW,'repeat',(_s,emit)=>emit(speech(id,'Same public line.')))[0];assert.equal(again.line,null);assert.equal(again.data.evidence.requestId,'fixture-public-request');assert.equal(x.sql.exec('SELECT line FROM events WHERE id = ?',old.id).toArray()[0].line,'Same public line.');
 assert.equal(reopened.commitExternal(NOW+1799000,'boundary',(_s,emit)=>emit(speech(id,'Same public line.',NOW+1799000)))[0].line,'Same public line.');
});
test('same logical spotlight/beat shares one filter decision; later actual speech is independently suppressed and state matches',t=>{
 const x=boot(t),id='06-ink';const out=x.runtime.commitExternal(NOW,'companions',(s,emit)=>{s.muses.find(m=>m.id===id).beat={id:'recommend_book',clip:'talk',startedAt:NOW,endsAt:NOW+300000,line:'One choice.'};emit(speech(id,'One choice.',NOW,'spotlight'));emit({...speech(id,'One choice.',NOW,'beat'),data:{beat:'recommend_book',evidence:{requestId:'fixture-public-request'}}});emit(speech(id,'One choice.'));});
 assert.deepEqual(out.map(e=>e.line),['One choice.','One choice.',null]);assert.equal(x.runtime.state().muses.find(m=>m.id===id).beat.line,'One choice.');
 x.runtime.commitExternal(NOW+1,'new-beat',(s,emit)=>{s.muses.find(m=>m.id===id).beat={id:'recommend_book',clip:'talk',startedAt:NOW+1,endsAt:NOW+300001,line:'One choice.'};emit({...speech(id,'One choice.',NOW+1,'beat'),data:{beat:'recommend_book'}});});assert.equal(x.runtime.state().muses.find(m=>m.id===id).beat.line,null);
});
test('transaction throw leaves no cooldown, state or event residue and history failure cannot fall back to unfiltered speech',async t=>{
 let fail=true;const x=boot(t,{onCommit:()=>{if(fail)throw Error('fixture-rollback');}}),before=x.runtime.state(),n=x.runtime.events().length;
 assert.throws(()=>x.runtime.commitExternal(NOW,'rollback',(_s,emit)=>emit(speech('06-ink','Fresh after rollback.'))));assert.deepEqual(x.runtime.state(),before);assert.equal(x.runtime.events().length,n);fail=false;
 assert.equal(x.runtime.commitExternal(NOW+1,'safe',(_s,emit)=>emit(speech('06-ink','Fresh after rollback.',NOW+1)))[0].line,'Fresh after rollback.');const stable=snapshotBody(x.runtime.state());x.denyHistory();assert.throws(()=>x.runtime.commitExternal(NOW+2,'no-history',(_s,emit)=>emit(speech('06-ink','No fallback.',NOW+2))));assert.equal(snapshotBody(x.runtime.state()),stable);await assert.rejects(()=>x.runtime.heartbeat(NOW+60000));assert.equal(x.calls.length,0);
});
test('Personal and connected operator speech is untouched; feature OFF preserves repeated original words',t=>{
 const x=boot(t);const out=x.runtime.commitExternal(NOW,'own-words',(s,emit)=>{s.inbox.connected['04-ember']=NOW;for(const id of ['00-jolly','04-ember'])for(let i=0;i<2;i++)emit(speech(id,'My signed words.'));});assert.deepEqual(out.map(e=>e.line),Array(4).fill('My signed words.'));
 const y=boot(t,{enabled:false});assert.deepEqual(y.runtime.commitExternal(NOW,'old-behavior',(_s,emit)=>{emit(speech('06-ink','Original words.'));emit(speech('06-ink','Original words.'));}).map(e=>e.line),['Original words.','Original words.']);
});
