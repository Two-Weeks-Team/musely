// Local pure engine + real SQLite/runtime/crypto only; no account, key API or network use.
import {test,after} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {createWorld,tick,canWave,WAVE_COOLDOWN_MS,localClock,spotlightInput,encounterInput} from '../src/engine/world.ts';
import {dayPhase,greetingFitsPhase,TIME_ZONE} from '../src/engine/world-clock.ts';
import {ruleResidentGreeting} from '../src/engine/resident-utterance.ts';
import {WorldRuntime} from '../worker/core/world-runtime.ts';import {Ledger} from '../worker/core/ledger.ts';import {Trust} from '../worker/core/trust.ts';
import {MeetingCheck,verifyMeeting} from '../worker/core/a2a.ts';import {makeHooks} from '../src/engine/rules.ts';
import {bindWorldClock,worldClockMessage} from '../worker/core/world-clock-input.ts';import {validate,buildMessages} from '../worker/core/actions.ts';import {activityMessages} from '../worker/core/resident-activity-schema.ts';
import {loadRun,assertCompatible} from '../src/replay/player.ts';import {currentVersions} from '../src/replay/versions.ts';
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('external networking prohibited');};after(()=>globalThis.fetch=originalFetch);
const NOW=Date.now(),A='01-sunny',B='02-moss';
function together(s,now=NOW){s.muses=s.muses.filter(m=>[A,B].includes(m.id));for(const m of s.muses){m.place='commons:cafe';m.travel=null;m.intent=null;m.inventory=[];m.beat={id:'resident_stay',clip:'idle_breathe',startedAt:now,endsAt:now+4*3600000,line:null};}return s;}
function sqlFor(db){let depth=0;return{exec(q,...b){const stmt=db.prepare(q),rows=stmt.columns().length?stmt.all(...b):(stmt.run(...b),[]);return{toArray:()=>rows};},transactionSync(fn){const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const x=fn();db.exec('RELEASE '+n);return x;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}}};}
async function boot(t,{model=null,busy=true}={}){const db=new DatabaseSync(':memory:');t.after(()=>db.close());const sql=sqlFor(db),ledger=new Ledger(sql,{dailyCapUsd:10,now:()=>NOW});ledger.init();const trust=new Trust(sql);trust.init();await trust.ensureAgents(null);let runtime;const context=()=>({trust,runtime,baseUrl:'https://synthetic.invalid',ownerRoot:null,ownerClaimed:false,now:()=>NOW});const meeting=new MeetingCheck(context),opts={worldId:'wave-clock',ledger,model,meetingGate:(s,now)=>meeting.prepare(s,now),hooks:{...makeHooks(),socialStatus:(_s,id)=>busy&&id===B?'busy':'welcoming'}};runtime=new WorldRuntime(sql,opts);runtime.init(NOW);runtime.commitExternal(NOW,'two-neighbors',s=>{const w=together(s);s.muses=w.muses;});return{db,sql,ledger,trust,runtime,opts,context,meeting};}

test('wave is unordered-pair limited for thirty minutes across ticks, separate from conversational lastMet',()=>{
 const s=together(createWorld('wave',NOW)),hooks={socialStatus:(_s,id)=>id===B?'busy':'welcoming'};
 const first=tick(s,{now:NOW},hooks);assert.equal(first.events.filter(e=>e.kind==='resident_wave').length,1);assert.deepEqual(first.state.muses.map(m=>m.lastMet),[{},{}]);assert.equal(first.state.muses[0].lastWave[B],NOW);assert.equal(first.state.muses[1].lastWave[A],NOW);
 assert.equal(canWave(first.state,A,B,NOW+WAVE_COOLDOWN_MS-1),false);assert.equal(canWave(first.state,B,A,NOW+WAVE_COOLDOWN_MS-1),false);
 const again=tick(first.state,{now:NOW+60000},hooks);assert.equal(again.events.filter(e=>e.kind==='resident_wave').length,0);
 const boundary=tick(again.state,{now:NOW+WAVE_COOLDOWN_MS},hooks);assert.equal(boundary.events.filter(e=>e.kind==='resident_wave').length,1);
 const converse=tick(first.state,{now:NOW+60000},{...makeHooks(),socialStatus:()=> 'welcoming'});assert.equal(converse.events.filter(e=>e.kind==='encounter').length,1,'a wave must never consume the conversation cooldown');
});

test('immediate/passby reaction waves share the same persisted pair cooldown without speaking for personal Muse',()=>{
 const s=together(createWorld('reaction-wave',NOW));s.muses[1].controlMode='personal';
 const wave=(from,to,key)=>({reply:{muse:from,other:to,encounterId:key,source:'rule',output:null},triggerId:'passby:'+key,kind:'wave'}),hooks={socialStatus:()=> 'busy'};
 const a=tick(s,{now:NOW,residentActors:[A],residentReactions:[wave(A,B,'1')]},hooks);assert.equal(a.events.filter(e=>e.kind==='resident_wave').length,1);
 const b=tick(a.state,{now:NOW+60000,residentActors:[A],residentReactions:[wave(A,B,'2')]},hooks);assert.equal(b.events.filter(e=>e.kind==='resident_wave'||e.kind==='resident_passby').length,0);assert.equal(b.events.some(e=>e.muse===B&&e.line),false);
 const c=tick(b.state,{now:NOW+WAVE_COOLDOWN_MS,residentActors:[A],residentReactions:[wave(A,B,'3')]},hooks);assert.equal(c.events.filter(e=>e.kind==='resident_wave').length,1);
});

test('real crypto rechecks remain live while wave contacts cool down; original card records survive restart',async t=>{
 const x=await boot(t);let verifies=0;const verify=crypto.subtle.verify.bind(crypto.subtle);crypto.subtle.verify=async(...args)=>{verifies++;return verify(...args);};t.after(()=>crypto.subtle.verify=verify);
 await x.runtime.heartbeat(NOW);const first=verifies;assert.ok(first>=4);assert.equal(x.runtime.events().filter(e=>e.kind==='cards_verified').length,1);
 await x.runtime.heartbeat(NOW+60000);assert.ok(verifies>first,'verification remains internal on every check');assert.equal(x.runtime.events().filter(e=>e.kind==='cards_verified').length,1);assert.equal(x.runtime.events().filter(e=>e.kind==='resident_wave').length,1);
 const restarted=new WorldRuntime(x.sql,x.opts);restarted.init(NOW+120000);await restarted.heartbeat(NOW+WAVE_COOLDOWN_MS);assert.equal(restarted.events().filter(e=>e.kind==='resident_wave').length,2);assert.equal(restarted.events().filter(e=>e.kind==='cards_verified').length,2);
 const ctx={...x.context(),runtime:restarted};await verifyMeeting(ctx,B,A,'commons:cafe');assert.equal(restarted.events().filter(e=>e.kind==='cards_verified').length,3,'the direct recheck remains in the raw ledger');
 await x.trust.revoke(B);await restarted.heartbeat(NOW+WAVE_COOLDOWN_MS+60000);assert.ok(restarted.events().some(e=>e.kind==='meeting_refused'),'revocation still refuses independently of public success suppression');
});

test('raw card success and failure records are never rewritten or removed by the human Feed projection',async t=>{
 const x=await boot(t),positive={at:NOW,source:'live',kind:'cards_verified',muse:A,other:B,data:{aVerifiesB:{ok:true},bVerifiesA:{ok:true}},tags:[]};
 x.runtime.commitExternal(NOW,'same-commit',(_s,emit)=>{emit(positive);emit({...positive,muse:B,other:A});emit({...positive,data:{aVerifiesB:{ok:false},bVerifiesA:{ok:true}},tags:['impostor_rejected']});});
 assert.equal(x.runtime.events().filter(e=>e.kind==='cards_verified').length,3);
 x.runtime.commitExternal(NOW,'tail-not-history',(_s,emit)=>{for(let i=0;i<600;i++)emit({at:NOW,source:'rule',kind:'fixture',muse:null,data:{},tags:[]});emit(positive);});
 assert.equal(x.runtime.events(0,10000).filter(e=>e.kind==='cards_verified').length,4);assert.equal(x.runtime.feedEvents(0,10000).some(e=>e.kind==='cards_verified'),false);
});

test('world clock uses LA phases, both DST sides and civil midnight, independent of KST observer date',()=>{
 const cases=[['2026-11-04T13:59:00Z','05:59','night'],['2026-11-04T14:00:00Z','06:00','morning'],['2026-11-04T20:00:00Z','12:00','afternoon'],['2026-11-05T01:00:00Z','17:00','evening'],['2026-11-05T05:00:00Z','21:00','night'],['2026-11-05T08:00:00Z','00:00','night'],['2026-07-01T13:00:00Z','06:00','morning']];
 for(const [iso,time,phase] of cases){const clock=localClock(Date.parse(iso));assert.equal(clock.hhmm,time);assert.equal(dayPhase(clock.hour),phase);}
 assert.equal(TIME_ZONE,'America/Los_Angeles');assert.equal(localClock(Date.parse('2026-11-04T13:03:00Z')).hhmm,'05:03','22:03 KST is not an LA night');
});

test('prepared speech prompts carry exact server clock, timezone and phase; client clock fields cannot forge it',()=>{
 const at=Date.parse('2026-11-05T01:00:00Z'),world=createWorld('clock',at);
 for(const [action,raw] of [['spotlight',spotlightInput(world,A,'where',at)],['encounter',encounterInput(world,A,B,'commons:cafe',null,at)],['trade',{muse:A,other:B,give:'fruit',want:'coffee',items:[],otherItems:[],round:1}]]){
  const validated=validate(action,{...raw,world_clock:{phase:'morning'},timeZone:'Asia/Seoul',phase:'morning'});assert.equal(worldClockMessage(validated),null);
  bindWorldClock(validated,at);const messages=buildMessages(action,validated),clock=messages.filter(m=>typeof m.content==='string'&&m.content.startsWith('Current world local date/time:'));assert.equal(clock.length,1);assert.match(clock[0].content,/2026-11-04 17:00/);assert.match(clock[0].content,/TIME_ZONE: America\/Los_Angeles/);assert.match(clock[0].content,/Day phase: evening/);assert.doesNotMatch(JSON.stringify(messages),/Asia\/Seoul/);
  assert.equal(worldClockMessage({...validated}),null,'untrusted object copying never carries the clock brand');
  if(action==='spotlight')assert.equal(activityMessages(validated,null).filter(m=>typeof m.content==='string'&&m.content.startsWith('Current world local date/time:')).length,1);
 }
});

test('RULE greeting templates reject wrong phases before public proper-name substitution and retain thirty-minute no-repeat',()=>{
 for(const phase of ['morning','afternoon','evening','night'])for(const word of ['morning','afternoon','evening','night'])assert.equal(greetingFitsPhase('Good '+word+', {name}.',phase),phase===word);
 const s=together(createWorld('greeting-clock',NOW));s.muses[1].profile={actorId:B,displayName:'Morning Star',appearanceId:B,revision:1};
 const at=Date.parse('2026-11-05T05:00:00Z'),line=ruleResidentGreeting(s,A,B,at,[]);assert.ok(line.includes('Morning Star'),'a public proper name is preserved at night');const again=ruleResidentGreeting(s,A,B,at+1,[{muse:A,at,line}]);assert.notEqual(again,line);
});

test('engine19 keeps original18/17/16 exact tuples and new wave receipts in read-only snapshots',async t=>{
 const x=await boot(t);await x.runtime.heartbeat(NOW);const run=x.runtime.runLog.current,record={...run,inputs:x.runtime.runLog.inputs(run.runId,0,100),events:x.runtime.events(0,10000,{runId:run.runId}),readThrough:x.runtime.runLog.boundary(run.runId)},original=JSON.stringify(record),player=loadRun(record);player.seek(Number.MAX_SAFE_INTEGER);assert.equal(player.getFrame().publicState.muses.find(m=>m.id===A).lastWave[B],NOW);assert.equal(JSON.stringify(record),original);
 assert.equal(currentVersions().engineVersion,'engine-19');for(const [version,catalog]of[['engine-18','catalog-d42ba8247057'],['engine-17','catalog-d42ba8247057'],['engine-16','catalog-ffb109917767']]){const old={schemaVersion:'run-log-2',engineVersion:version,harnessVersion:'harness-c0c69e98b5e8',catalogVersion:catalog};assert.doesNotThrow(()=>assertCompatible(old));assert.throws(()=>assertCompatible(old,currentVersions()));}
});

test('actual prepared runtime spotlight and encounter provider requests include the same current world clock',async t=>{
 const phases=[],actions=[],model={base:'https://synthetic.invalid',key:'synthetic',model:'synthetic',timeoutMs:1000,fetcher:async(_url,init)=>{
  const request=JSON.parse(init.body),clock=request.messages.filter(m=>typeof m.content==='string'&&m.content.startsWith('Current world local date/time:'));assert.equal(clock.length,1);phases.push(clock[0].content);const action=request.response_format.json_schema.name;actions.push(action);
  const freedom=request.messages[0].content.match(/freedom "(\w+)"/)?.[1]??'where',output=action==='spotlight_decision'?{freedom,decision:'stay',target_place:'Commons Cafe',target_agent:'',offer_item:'',want_item:'',public_reason:'A public pause.',line:'Hello there.'}:{intent:'greet',item:'',line:'Good to see you.',public_reason:'A public greeting.',injection_suspected:false};
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:10,completion_tokens:10}}));
 }};
 const x=await boot(t,{model,busy:false});await x.runtime.heartbeat(NOW);assert.ok(actions.includes('spotlight_decision'));assert.ok(actions.includes('encounter_reply'));assert.equal(new Set(phases).size,1);const clock=localClock(NOW);assert.ok(phases[0].includes(clock.date+' '+clock.hhmm));assert.ok(phases[0].includes('Day phase: '+dayPhase(clock.hour)));
});

test('public Feed/Highlights filter before LIMIT, progress beyond hidden-only pages, and preserve exact raw replay records',async t=>{
 const x=await boot(t),rt=x.runtime;
 const emitBatch=(label,visible)=>rt.commitExternal(NOW,label,(_s,emit)=>{for(let i=0;i<600;i++)emit({at:NOW,source:'rule',kind:i%2?'perception_notice':'cards_verified',muse:A,other:B,line:null,data:{public:true},tags:['system']});for(const line of visible)emit({at:NOW,source:'rule',kind:'greet',muse:A,other:B,line,data:{public:true},tags:['actual_greeting']});});
 emitBatch('hidden-before-visible',['First visible','Second visible']);const page=rt.feedEvents(0,2);assert.equal(page.length,2);assert.deepEqual(page.map(e=>e.line),['First visible','Second visible']);const cursor=page.at(-1).seq;
 assert.ok(page[0].seq>600);assert.deepEqual(rt.feedEvents(0,10,{tail:2}).map(e=>e.line),['First visible','Second visible']);assert.equal(rt.highlights(2).length,2);assert.ok(rt.highlights(2).every(e=>e.kind==='greet'));
 emitBatch('hidden-only',[]);assert.deepEqual(rt.feedEvents(cursor,2),[]);
 emitBatch('new-visible',['Third visible']);const next=rt.feedEvents(cursor,1);assert.equal(next.length,1);assert.equal(next[0].line,'Third visible');assert.ok(next[0].seq>cursor+600);
 const raw=rt.events(0,10000),before=JSON.stringify(raw),run=rt.runLog.current,record={...run,inputs:rt.runLog.inputs(run.runId,0,100),events:rt.events(0,10000,{runId:run.runId}),readThrough:rt.runLog.boundary(run.runId)};
 assert.equal(raw.filter(e=>e.kind==='perception_notice').length,900);assert.equal(raw.filter(e=>e.kind==='cards_verified').length,900);assert.equal(record.events.length,record.readThrough.events);
 const player=loadRun(record);player.seek(Number.MAX_SAFE_INTEGER);assert.equal(player.getFrame().snapshotHash,record.inputs.at(-1).afterHash);rt.feedEvents(0,2);rt.highlights(2);assert.equal(JSON.stringify(rt.events(0,10000)),before);
});

test('real Worker default Feed omits system rows while explicit runId/day reads and event evidence stay original',async t=>{
 const {registerHooks}=await import('node:module'),shim='data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}',hook=registerHooks({resolve(s,c,n){return s==='cloudflare:workers'?{url:shim,shortCircuit:true}:n(s,c);}});
 let worker,WorldDO;try{({default:worker,WorldDO}=await import('../worker/index.ts'));}finally{hook.deregister();}
 const x=await boot(t),rt=x.runtime;rt.commitExternal(NOW,'view-routing',(_s,emit)=>{emit({at:NOW,source:'rule',kind:'perception_notice',muse:A,data:{public:true},tags:['perception']});emit({at:NOW,source:'rule',kind:'greet',muse:A,other:B,line:'Hello.',data:{public:true},tags:['greeting']});});
 const raw=rt.events(0,10000),stub={worldEvents:(...a)=>WorldDO.prototype.worldEvents.call({runtime:rt},...a),worldHighlights:(...a)=>WorldDO.prototype.worldHighlights.call({runtime:rt},...a)},env={PUBLIC_ORIGIN:'https://musely.net',ALLOWED_HOSTS:'musely.net',WORLD:{idFromName:()=> 'world',get:()=>stub}};
 const get=async query=>(await worker.fetch(new Request('https://musely.net/api/world/events'+query),env)).json();assert.ok(!(await get('')).some(e=>e.kind==='perception_notice'));assert.deepEqual(await get('?runId='+rt.runLog.current.runId+'&limit=2000'),raw);assert.deepEqual(await get('?day='+rt.state().day+'&limit=2000'),raw);
});
