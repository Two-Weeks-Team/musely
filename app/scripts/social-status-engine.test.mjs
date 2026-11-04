// Real engine and WorldDO/SQLite; all principals and status preferences are isolated fixtures.
import test from 'node:test';import assert from 'node:assert/strict';
import {createWorld,tick,TICK_MS,spotlightFor} from '../src/engine/world.ts';
import {makeHooks} from '../src/engine/rules.ts';
import {scheduleCues,liveFrames,CUE_DELAY_MS} from '../src/ui/live-scene-core.ts';
import {bootWorldDo} from './test-support/world-life-harness.mjs';
const AT=Date.parse('2026-11-04T17:00:00Z'),A='01-sunny',B='02-moss';
function pair(){const s=createWorld('social-engine',AT);s.muses=s.muses.filter(m=>[A,B].includes(m.id));for(const m of s.muses){m.place='commons:cafe';m.travel=null;m.beat={id:'look_around',clip:'look_around',startedAt:AT-1000,endsAt:AT+3600000,line:null};m.lastMet={};}s.muses[0].intent={kind:'greet',target:B};return s;}
function hooks(status){return{...makeHooks(),canMeet:()=>({ok:true,event:null}),socialStatus:(_s,id)=>id===B?status:'welcoming'};}
const social=e=>['encounter','greet','trade_proposed','trade_completed','resident_wave'].includes(e.kind);
test('DND blocks a fresh automatic contact even with a preexisting intent; OFF keeps original path',()=>{
 const s=pair(),before=JSON.stringify(s),on=tick(s,{now:AT},hooks('do_not_disturb'));
 assert.equal(on.events.filter(social).length,0);assert.equal(JSON.stringify(s),before);
 assert(tick(s,{now:AT},{...makeHooks(),canMeet:()=>({ok:true,event:null})}).events.some(e=>e.kind==='greet'));
});
test('busy gives only an in-place wave without consuming the later conversation cooldown',()=>{
 const s=pair(),out=tick(s,{now:AT},hooks('busy'));
 assert.deepEqual(out.events.filter(social).map(e=>e.kind),['resident_wave']);assert.equal(out.events.find(e=>e.kind==='resident_wave').muse,A);
 assert.equal(out.state.muses[0].place,s.muses[0].place);assert.equal(out.state.muses[0].travel,null);
 assert.deepEqual(out.state.muses.map(m=>m.lastMet),s.muses.map(m=>m.lastMet));
 assert.deepEqual(tick(out.state,{now:AT+TICK_MS},hooks('busy')).events.filter(social).map(e=>e.kind),['resident_wave']);
 const open=tick(out.state,{now:AT+TICK_MS},hooks('welcoming'));
 assert.ok(open.events.some(e=>e.kind==='encounter'));
 assert.equal(tick(open.state,{now:AT+2*TICK_MS},hooks('welcoming')).events.filter(e=>e.kind==='encounter').length,0);
});
test('signature refusal and pause precede status: a busy label cannot authorize even a wave',()=>{
 const s=pair();let checks=0;const h={...hooks('busy'),canMeet:()=>{checks++;return{ok:false,event:null};}};
 assert.equal(tick(s,{now:AT},h).events.filter(social).length,0);assert.equal(checks,1);
 s.paused={[B]:{at:AT,version:s.version,by:'fixture'}};assert.equal(tick(s,{now:AT},hooks('busy')).events.filter(social).length,0);
});
test('already-committed travel still arrives while changed DND prevents its new contact; pending contracts remain',()=>{
 const s=pair(),a=s.muses[0];a.place='commons:hq';a.beat=null;a.travel={to:'commons:cafe',departAt:AT-60000,arriveAt:AT,speed:'walk',chosen:true};
 s.inbox.tasks.push({id:'fixture-pending',kind:'trade',from:A,to:B,status:'pending',awaiting:B,createdAt:AT-1000,deadline:AT+100000,updatedAt:AT-1000,offer:{by:A,give:'fruit',want:'coffee'},round:0,history:[]});
 const out=tick(s,{now:AT},hooks('do_not_disturb'));assert.equal(out.state.muses[0].place,'commons:cafe');assert.equal(out.state.muses[0].travel,null);
 assert.equal(out.events.filter(social).length,0);assert.deepEqual(out.state.inbox.tasks,s.inbox.tasks);
});
test('personal and active connected actors never acquire a wave or an automatic approach on their behalf',()=>{
 const s=pair();for(const m of s.muses)m.controlMode='personal';assert.equal(tick(s,{now:AT},hooks('busy')).events.filter(social).length,0);
 for(const m of s.muses){delete m.controlMode;s.inbox.connected[m.id]=AT;}assert.equal(tick(s,{now:AT},hooks('busy')).events.filter(social).length,0);
});
test('a stale social intent cannot start a new automatic trip after target changed away from welcoming',()=>{
 const s=pair(),a=s.muses[0];a.beat=null;a.place='commons:hq';const out=tick(s,{now:AT},hooks('do_not_disturb'));
 assert.equal(out.state.muses[0].travel,null);assert.equal(out.state.muses[0].intent,null);
});
test('RULE destination weights favor a welcoming personal peer, without forcing a target or acting for that peer',()=>{
 let welcome=0,dnd=0;const destinations=new Set();
 for(let n=0;n<500;n++)for(const mode of['welcoming','do_not_disturb']){
  const s=createWorld('weight',AT);s.seed='seed-'+n;s.muses=s.muses.filter(m=>[A,'00-jolly'].includes(m.id));const a=s.muses.find(m=>m.id===A),p=s.muses.find(m=>m.id==='00-jolly');
  a.place='commons:hq';a.travel=null;a.beat=null;p.place='commons:cafe';p.controlMode='personal';p.travel=null;p.beat=null;
  const out=tick(s,{now:AT},{socialStatus:(_s,id)=>id===p.id?mode:'welcoming'});const to=out.state.muses.find(m=>m.id===A).travel?.to;
  if(mode==='welcoming'){if(to==='commons:cafe')welcome++;if(to)destinations.add(to);}else if(to==='commons:cafe')dnd++;
  assert.equal(out.state.muses.find(m=>m.id===p.id).travel,null);
 }
 assert(welcome>dnd,`welcoming ${welcome} must exceed DND ${dnd}`);assert(destinations.size>2,'weighting is not a scripted destination');
});
test('WorldDO consumes the private SQLite override through actual engine hooks; OFF has no new hook',async t=>{
 const x=await bootWorldDo(t,{envOverrides:{SOCIAL_STATUS_MODE:'public-v1'}}),p=await x.ownerFor('owner'),proof={principal:p.principal,ownerId:p.ownerId,exp:p.exp};
 x.world.ownerSocialStatusSet(proof,'00-jolly',{mode:'do_not_disturb',expectedRevision:0});
 assert.equal(typeof x.runtime.opts.hooks.socialStatus,'function');const s=createWorld('installed',AT);s.muses=s.muses.filter(m=>[A,'00-jolly'].includes(m.id));
 for(const m of s.muses){m.place='commons:cafe';m.travel=null;m.beat={id:'look_around',clip:'look_around',startedAt:AT-1,endsAt:AT+1e6,line:null};}s.muses.find(m=>m.id===A).intent={kind:'greet',target:'00-jolly'};
 const out=tick(s,{now:AT},{...x.runtime.opts.hooks,canMeet:()=>({ok:true,event:null})});assert.equal(out.events.filter(social).length,0);
 const off=await bootWorldDo(t);assert.equal(off.runtime.opts.hooks.socialStatus,undefined);
});
test('corrupt SQLite preference fails closed for engine and public projection while private reads stay unavailable',async t=>{
 const x=await bootWorldDo(t,{envOverrides:{SOCIAL_STATUS_MODE:'public-v1'}}),p=await x.ownerFor('owner'),proof={principal:p.principal,ownerId:p.ownerId,exp:p.exp};
 x.world.ownerSocialStatusSet(proof,'00-jolly',{mode:'busy',expectedRevision:0});x.db.exec('PRAGMA ignore_check_constraints=ON');x.db.prepare('UPDATE social_status_overrides SET mode=?').run('CORRUPT_CANARY');
 assert.equal(x.runtime.opts.socialStatus(x.runtime.state(),'00-jolly',AT),'do_not_disturb');
 assert.equal(x.runtime.opts.hooks.socialStatus(x.runtime.state(),'00-jolly',AT),'do_not_disturb');
 assert.deepEqual(x.world.worldView().muses.find(m=>m.id==='00-jolly').availability,{status:'do_not_disturb'});
 assert.throws(()=>x.world.ownerSocialStatusGet(proof,'00-jolly'),e=>e.code==='social_status_unavailable');
 assert.throws(()=>x.world.ownerSocialStatusSet(proof,'00-jolly',{mode:'welcoming',expectedRevision:1}),e=>e.code==='social_status_unavailable');
 assert.doesNotMatch(JSON.stringify(x.world.worldView()),/CORRUPT_CANARY/);
});

test('welcoming reaches the original item/claim gates while busy or DND never starts a new automatic trade',()=>{
 const s=pair();s.muses[0].inventory=['fruit'];s.muses[0].wants.items=['coffee'];s.muses[1].inventory=['coffee'];s.muses[1].wants.items=['fruit'];
 assert(tick(s,{now:AT},hooks('welcoming')).events.some(e=>e.kind==='trade_proposed'));
 for(const status of['busy','do_not_disturb'])assert.equal(tick(s,{now:AT},hooks(status)).events.some(e=>e.kind==='trade_proposed'),false);
 const denied={...hooks('welcoming'),canProposeTrade:()=>false};assert.equal(tick(s,{now:AT},denied).events.some(e=>e.kind==='trade_proposed'),false);
});
test('an automatic model approach cannot begin a trip to a newly busy or DND peer',()=>{
 for(const status of['busy','do_not_disturb']){
  const s=pair();s.muses[0].place='commons:hq';s.muses[0].beat=null;s.muses[0].intent=null;
  while(spotlightFor(s,AT).freedom!=='who')s.tick++;
  const decision={muse:A,freedom:'who',source:'live',output:{decision:'greet',target_place:'',target_agent:B,offer_item:'',want_item:'',public_reason:'',line:''}};
  const out=tick(s,{now:AT,spot:{muse:A,priority:false},decision},hooks(status));
  assert(out.events.some(e=>e.kind==='decision_rejected'&&e.data.reason==='social contact unavailable'));assert.equal(out.state.muses[0].intent,null);
 }
});
test('actual WorldDO heartbeat commits busy wave or DND silence with run/input binding and real fixture Card verification',async t=>{
 for(const mode of['busy','do_not_disturb']){
  const x=await bootWorldDo(t,{envOverrides:{SOCIAL_STATUS_MODE:'public-v1'}}),owner=await x.ownerFor('owner');
  x.world.ownerSocialStatusSet({principal:owner.principal,ownerId:owner.ownerId,exp:owner.exp},'00-jolly',{mode,expectedRevision:0});
  const now=Date.now()+TICK_MS;
  x.edit(s=>{for(const m of s.muses){m.travel=null;m.beat={id:'look_around',clip:'look_around',startedAt:now-1,endsAt:now+3600000,line:null};if(![A,'00-jolly'].includes(m.id))(s.paused??={})[m.id]={at:now,version:s.version,by:'fixture'};}const a=s.muses.find(m=>m.id===A),b=s.muses.find(m=>m.id==='00-jolly');a.place=b.place='commons:cafe';a.intent={kind:'greet',target:b.id};a.lastMet={};b.lastMet={};});
  const before=x.runtime.events(0,2000).at(-1)?.seq??0,out=await x.runtime.heartbeat(now);assert.equal(out.status,'committed');
  const events=x.runtime.events(before,2000).filter(e=>e.muse===A&&e.other==='00-jolly'&&social(e));
  assert.deepEqual(events.map(e=>e.kind),mode==='busy'?['resident_wave']:[]);
  if(mode==='busy'){const wave=events[0];assert(wave.runId);assert(Number.isSafeInteger(wave.inputSeq));assert(x.db.prepare('SELECT after_hash FROM run_inputs WHERE run_id=? AND seq=?').get(wave.runId,wave.inputSeq)?.after_hash);}
 }
});

test('engine busy event projects to exactly one visible in-place actor wave, without a peer gesture or contact',()=>{
 const out=tick(pair(),{now:AT},hooks('busy')),event=out.events.find(e=>['wave','resident_wave'].includes(e.kind));assert(event);
 const cues=scheduleCues([event]);assert.equal(cues.length,1);const cue=cues[0];
 assert.equal(cue.muse,A);assert.equal(cue.clip,'wave');assert.equal(cue.end-cue.start,3000);assert.equal(cue.contact,false);assert.equal(cue.face,false);assert.equal(cue.line,null);assert.equal(cue.handoff,null);
 assert.equal(cues.some(c=>c.muse===B),false);
 const now=AT+CUE_DELAY_MS+1000,base=liveFrames(out.state,[],now),shown=liveFrames(out.state,cues,now);
 assert.equal(shown.get(A).clip,'wave');assert.equal(shown.get(B).clip,base.get(B).clip);
 for(const id of[A,B]){assert.equal(shown.get(id).x,base.get(id).x);assert.equal(shown.get(id).z,base.get(id).z);assert.equal(shown.get(id).yaw,base.get(id).yaw);assert.equal(out.state.muses.find(m=>m.id===id).travel,null);}
});
