// Actual action validator/runtime, synthetic provider and private in-memory SQLite only.
import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {buildMessages,checkOutput,validate} from '../worker/core/actions.ts';
import {checkActivityOutput} from '../worker/core/resident-activity-schema.ts';
import {createWorld,tick} from '../src/engine/world.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';import {Ledger} from '../worker/core/ledger.ts';
const spot={muse:'01-sunny',freedom:'where',localTime:'18:00',place:'Commons Cafe',places:[{name:'서울 공원',kind:'park',distanceM:30}],muses:[{muse:'02-moss',place:'Commons Cafe',distanceM:1}],items:[],memory:[]};
const spotlight={freedom:'where',decision:'walk',target_place:'서울 공원',target_agent:'',offer_item:'',want_item:'',public_reason:'A nearby public place.',line:'A little stroll sounds lovely.'};
const enc={muse:'02-moss',other:'01-sunny',place:'Commons Cafe',localTime:'18:00',items:[],otherItems:[],memory:[]};
const encounter={intent:'greet',item:'',line:'Hello, Sunny. How are things growing?',public_reason:'A neighbor is nearby.',injection_suspected:false};
const trade={muse:'09-copper',other:'02-moss',give:'paper_map',want:'coffee',items:['coffee'],otherItems:['paper_map'],round:1};
const answer={decision:'reject',counter_give:'',counter_want:'',line:'I will keep mine for now.'};
test('resident model prompts require English for action, immediate reply and trade',()=>{
 for(const [action,input]of[['spotlight',spot],['encounter',enc],['trade',trade]])assert.match(JSON.stringify(buildMessages(action,validate(action,input))),/Always speak in English/);
});
test('resident non-English speech or public reasons never pass the model publication validator',()=>{
 for(const line of ['안녕하세요, 이웃님.','今日は良い日ですね。','你好，邻居。','Привет, сосед.','مرحبا يا صديقي.','Hola, como estas?','Bonjour mon ami!','Guten Tag, wie geht es dir?']){
  assert.match(checkOutput('spotlight',spot,{...spotlight,line})??'',/public_speech_not_english/,line);
  assert.match(checkOutput('encounter',enc,{...encounter,line})??'',/public_speech_not_english/,line);
  assert.match(checkOutput('trade',trade,{...answer,line})??'',/public_speech_not_english/,line);
 }
 assert.match(checkOutput('encounter',enc,{...encounter,public_reason:'이웃을 만났어요.'})??'',/public_speech_not_english/);
 assert.match(checkOutput('spotlight',spot,{...spotlight,decision:'친구 만나기'})??'',/public_speech_not_english/);
 assert.match(checkActivityOutput(spot,{...spotlight,line:'같이 걸어요.',duration_minutes:10})??'',/public_speech_not_english/);
});
test('English typography and trusted public place names stay allowed; a named place does not exempt surrounding non-English prose',()=>{
 for(const line of ["Let’s pause by the café — there’s no hurry.",'I will meet you at 서울 공원.','Sunny, good to see you!',''])assert.equal(checkOutput('spotlight',spot,{...spotlight,line}),null,line);
 assert.notEqual(checkOutput('spotlight',spot,{...spotlight,line:'서울 공원에서 만나요.'}),null);
 // The personal runtime never passes through this resident policy or gets its authored speech translated.
 assert.equal(checkOutput('encounter',{...enc,muse:'00-jolly'},{...encounter,line:'원래 개인 Muse의 말.'}),null);
});
const NOW=Date.parse('2026-11-04T12:00:00Z');
function boot(t,line){const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,calls=0;
 const sql={exec(q,...b){const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};},transactionSync(fn){const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const r=fn();db.exec('RELEASE '+n);return r;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}}};
 const ledger=new Ledger(sql,{dailyCapUsd:30,now:()=>NOW});ledger.init();
 const rt=new WorldRuntime(sql,{worldId:'speech-policy',ledger,residentValuesEnabled:true,meetingGate:'off',model:{base:'https://synthetic.invalid/v1',key:'synthetic',model:'synthetic',timeoutMs:1000,fetcher:async(_u,init)=>{calls++;const body=JSON.parse(init.body),freedom=body.messages[0].content.match(/freedom "(\w+)"/)?.[1]??'where';return new Response(JSON.stringify({id:'synthetic-response',choices:[{message:{content:JSON.stringify({...spotlight,freedom,target_place:'Commons Cafe',line})}}],usage:{prompt_tokens:20,completion_tokens:30}}),{headers:{'x-request-id':'synthetic-request'}});}}});rt.init(NOW);
 rt.commitExternal(NOW,'only-resident',s=>{for(const m of s.muses){m.travel=null;m.beat=null;m.intent=null;m.place='commons:cafe';if(m.id!=='01-sunny')(s.paused??={})[m.id]={at:NOW,version:1,by:'fixture'};}});
 rt.requestSpotlight('01-sunny',NOW,{origin:'visitor',requester:'synthetic-requester'});
 return{rt,sql,get calls(){return calls;}};
}
test('non-English resident spotlight makes one paid call, never uses its prose LIVE and records a RULE fallback',async t=>{
 const x=boot(t,'이웃에게 인사해요.');const result=await x.rt.heartbeat(NOW);
 assert.equal(x.calls,1);assert.equal(result.status,'committed');assert.equal(result.spotlight.source,'rule');assert.match(result.spotlight.reason,/public_speech_not_english/);
 assert.ok(x.rt.events().some(e=>e.kind==='spotlight_fallback'&&e.source==='rule'));
 const actions=x.rt.events().filter(e=>e.muse==='01-sunny'&&['beat','depart'].includes(e.kind));assert.ok(actions.length>0);assert.ok(actions.every(e=>e.source==='rule'),'actual fallback action source is RULE');
 for(const e of actions)if(e.kind==='beat'&&e.line)assert.match(e.line,/own pace|room here|warm welcome|Come along/);
 assert.equal(x.rt.runLog.lastInput().input.residentEnglishFallback,'01-sunny');
 assert.ok(!x.rt.events().some(e=>typeof e.line==='string'&&e.line.includes('이웃에게')));
 assert.equal(x.sql.exec("SELECT outcome FROM reservations WHERE action='spotlight'").toArray()[0].outcome,'rejected');
});

test('rejected immediate reply uses the answering resident English persona greeting with RULE provenance',()=>{
 const w=createWorld('english-reply',NOW);for(const m of w.muses){m.place='commons:cafe';m.travel=null;m.beat=null;m.intent=null;if(!['02-moss','01-sunny'].includes(m.id))(w.paused??={})[m.id]={at:NOW,version:1,by:'fixture'};}
 const out=tick(w,{now:NOW,residentActors:['02-moss'],residentReactions:[{triggerId:'passby:fixture',kind:'reply',reply:{muse:'02-moss',other:'01-sunny',place:'commons:cafe',encounterId:'english-policy-reply',source:'rule',output:null,reason:'output_rejected:public_speech_not_english'}}]},{residentValuesEnabled:true,residentSpeechHistory:[]});
 const reply=out.events.find(e=>e.kind==='encounter_reply'&&e.muse==='02-moss');assert.ok(reply);assert.equal(reply.source,'rule');assert.match(reply.line,/Sunny/);assert.match(reply.line,/small pause|growing|take your time|noticed/);assert.equal(reply.data.evidence,undefined);
});
