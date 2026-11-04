// Real WorldRuntime/SQLite/engine: fixed 24-NPC roster, no provider or personal admission service.
import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {WorldRuntime,MAX_MODEL_CALLS} from '../worker/core/world-runtime.ts';import {Ledger} from '../worker/core/ledger.ts';
import {PersonalOwners,createOwnershipAdapter} from '../worker/core/personal-owners.ts';
import {ResidentLifeStore} from '../worker/core/resident-life-adapter.ts';import {createLife} from '../src/engine/resident-life.ts';
import {ACTOR_IDS,HARNESS_IDS,hasActorHarness,harnessById,harnessRoleId,isResidentInstance} from '../src/engine/harness.ts';
import {RESIDENT_INSTANCES,RESIDENT_ROSTER_MODE} from '../src/engine/resident-catalog.ts';import {isRuntimeControlled} from '../src/engine/inbox.ts';
import {createWorld,tick,TICK_MS,spotlightFor} from '../src/engine/world.ts';import {PLACES} from '../src/engine/places.ts';import {itemSpec} from '../src/engine/items.ts';
import {validate,buildMessages} from '../worker/core/actions.ts';import {Trust} from '../worker/core/trust.ts';
import {publicState} from '../worker/core/run-log.ts';import {loadRun} from '../src/replay/player.ts';
globalThis.fetch=()=>{throw Error('external network prohibited in roster tests');};
const NOW=Date.parse('2026-11-03T20:00:00Z'),LEGACY=['00-jolly','04-ember','09-copper'];
function sqlFor(db){let depth=0;return {exec(q,...b){const st=db.prepare(q),rows=st.columns().length?st.all(...b):(st.run(...b),[]);return {toArray:()=>rows};},transactionSync(fn){const sp='roster'+depth++;db.exec('SAVEPOINT '+sp);try{const r=fn();db.exec('RELEASE '+sp);return r;}catch(e){db.exec('ROLLBACK TO '+sp);db.exec('RELEASE '+sp);throw e;}finally{depth--;}}};}
function boot(t,{file=':memory:',enabled=true,roster=RESIDENT_ROSTER_MODE,cap=0,model=null,ownershipOverride,beforeCommit}={}){
 const db=new DatabaseSync(file);t.after(()=>db.close());const sql=sqlFor(db),owners=new PersonalOwners({sql,transactionSync:sql.transactionSync});owners.init();const base=createOwnershipAdapter(owners);
 const ownership=id=>{const k=base.resolve(id).kind;return ownershipOverride?.(id)??(k==='unknown'&&isResidentInstance(id)?'resident':k);};
 const initialState=createLife(HARNESS_IDS.map(id=>({id,defaultGoal:harnessById(id).wants.goal,home:'commons:garden'})),HARNESS_IDS.filter(id=>!LEGACY.includes(id)).map(id=>({id,roleId:id})));
 const p={enabled,roster,initialState,allowedPlaceIds:PLACES.filter(p=>p.zone==='commons').map(p=>p.id),ownershipKind:ownership};
 const ledger=new Ledger(sql,{dailyCapUsd:cap,now:()=>NOW});ledger.init();const opts={worldId:'roster-test',ledger,model,meetingGate:'off',residentLife:p,beforeCommit};const runtime=new WorldRuntime(sql,opts);runtime.init(NOW);return {db,sql,owners,base,ownership,policy:p,ledger,runtime,opts,store:new ResidentLifeStore(sql)};
}
test('catalog separates 17 immutable instance IDs from ten reusable role and appearance templates',()=>{
 assert.equal(RESIDENT_INSTANCES.length,17);assert.equal(HARNESS_IDS.length,10);assert.equal(ACTOR_IDS.length,27);assert.equal(new Set(ACTOR_IDS).size,27);
 for(const r of RESIDENT_INSTANCES){assert.equal(harnessById(r.id).id,r.id);assert.equal(harnessRoleId(r.id),r.roleId);assert.equal(harnessById(r.id).name,r.name);assert.ok(HARNESS_IDS.includes(r.appearanceId));}
 for(const id of ['nr_forged','pm_alba','constructor','__proto__']){assert.equal(isResidentInstance(id),false);assert.equal(hasActorHarness(id),false);assert.throws(()=>harnessById(id));}
});
test('explicit opt-in enrolls 24 real NPCs plus three legacy actors in WorldState and LifeStore',t=>{
 const c=boot(t),s=c.runtime.state();assert.equal(s.muses.length,27);assert.equal(s.muses.filter(m=>c.ownership(m.id)==='resident').length,24);assert.equal(c.store.load(c.runtime.worldId).state.residents.length,24);
 assert.equal(c.runtime.events(0,100).filter(e=>e.kind==='resident_join').length,17);assert.equal(s.version,1);
 for(const m of s.muses.filter(m=>isResidentInstance(m.id))){assert.equal(m.residentRole,harnessRoleId(m.id));assert.equal(isRuntimeControlled(s,m.id,NOW),false);assert.ok(m.inventory.every(id=>itemSpec(id)?.transferable===false));}
});
test('OFF and missing roster keep the ten-actor baseline and never create extra identities',t=>{
 for(const opts of [{enabled:false},{roster:null}]){const c=boot(t,opts);assert.equal(c.runtime.state().muses.length,10);assert.equal(c.runtime.events().length,0);}
});
test('known catalog ID without enrollment marker stays externally controlled',()=>{
 const s=createWorld('no-enrollment',NOW),m=structuredClone(s.muses[1]);m.id='nr_alba';s.muses.push(m);s.spotlight.cursor=10;assert.equal(isRuntimeControlled(s,m.id,NOW),true);const after=tick(s,{now:NOW}).state.muses.at(-1);assert.equal(after.travel,null);assert.equal(after.beat,null);
});
test('real SQLite reopen and repeated init preserve identities, state and enrollment receipts without duplication',t=>{
 const dir=mkdtempSync(join(tmpdir(),'resident-roster-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'world.sqlite'),a=boot(t,{file});
 a.runtime.commitExternal(NOW+1,'fixture-memory',s=>{s.muses.find(m=>m.id==='nr_alba').memory=['Remembered public encounter'];});const state=a.runtime.state(),life=a.store.load(a.runtime.worldId),events=a.runtime.events(0,1000);
 const b=boot(t,{file});assert.deepEqual(b.runtime.state(),state);assert.deepEqual(b.store.load(b.runtime.worldId),life);assert.deepEqual(b.runtime.events(0,1000),events);b.runtime.init(NOW+2);assert.equal(b.runtime.state().muses.length,27);assert.equal(b.runtime.events(0,1000).filter(e=>e.kind==='resident_join').length,17);
});
test('enrollment event-write failure rolls back world members and life additions together',t=>{
 const c=boot(t,{roster:null}),state=c.runtime.state(),life=c.store.load(c.runtime.worldId);c.policy.roster=RESIDENT_ROSTER_MODE;
 c.db.exec("CREATE TRIGGER fail_enroll BEFORE INSERT ON events WHEN NEW.kind='resident_join' BEGIN SELECT RAISE(ABORT,'injected enrollment failure'); END");
 const retry=new WorldRuntime(c.sql,c.opts);assert.throws(()=>retry.init(NOW+1),/injected enrollment failure/);assert.deepEqual(c.runtime.state(),state);assert.deepEqual(c.store.load(c.runtime.worldId),life);assert.equal(c.runtime.events().length,0);
 c.db.exec('DROP TRIGGER fail_enroll');retry.init(NOW+2);assert.equal(retry.state().muses.length,27);
});
test('personal or unknown ownership and identity collisions prevent the whole enrollment',t=>{
 for(const kind of ['personal','unknown']){assert.throws(()=>boot(t,{ownershipOverride:id=>id==='nr_alba'?kind:undefined}),/ownership conflict/);}
 const c=boot(t,{roster:null});c.runtime.commitExternal(NOW,'fixture-collision',s=>{const m=structuredClone(s.muses[1]);m.id='nr_alba';m.controlMode='personal';s.muses.push(m);});const before=c.runtime.state();c.policy.roster=RESIDENT_ROSTER_MODE;assert.throws(()=>new WorldRuntime(c.sql,c.opts).init(NOW+1),/identity collision/);assert.deepEqual(c.runtime.state(),before);
});
test('24 actual NPCs receive normal scheduler turns and produce activities with zero model budget',async t=>{
 const c=boot(t);for(let i=0;i<108;i++)await c.runtime.heartbeat(NOW+i*TICK_MS);const events=c.runtime.events(0,20000),s=c.runtime.state();
 const spotlight=new Set(events.filter(e=>e.kind==='spotlight').map(e=>e.muse));for(const m of s.muses)assert.ok(spotlight.has(m.id),'turn for '+m.id);
 const active=new Set(events.filter(e=>['depart','arrive','beat'].includes(e.kind)).map(e=>e.muse));for(const r of RESIDENT_INSTANCES)assert.ok(active.has(r.id),'activity for '+r.id);
 assert.equal(c.ledger.status().liveCalls,0);assert.equal(c.store.load(c.runtime.worldId).state.residents.length,24);assert.ok(c.store.load(c.runtime.worldId).state.residents.some(r=>isResidentInstance(r.id)&&r.memories.length));
});
test('visitor priority remains immediate and resumes the ordinary 27-actor cursor',async t=>{
 const c=boot(t);c.runtime.commitExternal(NOW,'fixture-visitor',s=>{s.spotlight.visitorQueue=['nr_rowan'];});assert.equal(spotlightFor(c.runtime.state(),NOW).muse,'nr_rowan');const r=await c.runtime.heartbeat(NOW);assert.equal(r.spotlight.muse,'nr_rowan');assert.equal(c.runtime.state().spotlight.visitorQueue.length,0);
});
test('actual roster join and subsequent world snapshots replay identities and enrollment markers',async t=>{
 const c=boot(t);for(let i=0;i<3;i++)await c.runtime.heartbeat(NOW+i*TICK_MS);const run=c.runtime.runLog.current,inputs=c.runtime.runLog.inputs(run.runId,0,1000),events=c.runtime.events(0,20000,{runId:run.runId});const captured={...run,inputs,events,readThrough:{inputSeq:inputs.at(-1).seq,eventSeq:events.at(-1).seq,inputs:inputs.length,events:events.length}};
 const player=loadRun(captured);player.seek(Number.MAX_SAFE_INTEGER);assert.deepEqual(player.getFrame().publicState,publicState(c.runtime.state()));assert.equal(player.getFrame().publicState.muses.length,27);assert.equal(player.getFrame().publicState.muses.find(m=>m.id==='nr_alba').residentRole,'01-sunny');
});
test('server peer allowlist cannot make a personal Muse a model actor or be supplied in client JSON',()=>{
 const input={muse:'nr_alba',other:'pm_peer',place:'Garden',localTime:'12:00',items:[],otherItems:[],memory:[]};assert.throws(()=>validate('encounter',{...input,trustedPeerIds:['pm_peer']}));const validated=validate('encounter',input,['pm_peer']);assert.match(JSON.stringify(buildMessages('encounter',validated)),/Visiting Muse/);assert.throws(()=>validate('encounter',{...input,muse:'pm_peer'},['pm_peer']));assert.throws(()=>validate('encounter',{...input,other:'pm_unverified'},['pm_peer']));
});
function modelTransport(){const requests=[];let inFlight=0,max=0;return {requests,get max(){return max;},config:{base:'https://synthetic.invalid/v1',key:'SYNTHETIC-NOT-A-CREDENTIAL',model:'synthetic',timeoutMs:1000,fetcher:async(_url,init)=>{const r=JSON.parse(init.body);requests.push(r);inFlight++;max=Math.max(max,inFlight);await new Promise(r=>setImmediate(r));inFlight--;const enc=r.response_format.json_schema.name==='encounter_reply',freedom=r.messages[0].content.match(/freedom "(\w+)"/)?.[1]??'where';return new Response(JSON.stringify({id:'fixture',choices:[{message:{content:JSON.stringify(enc?{intent:'greet',item:'',line:'Hello, visiting neighbor.',public_reason:'Public encounter',injection_suspected:false}:{freedom,decision:'stay',target_place:'',target_agent:'',offer_item:'',want_item:'',public_reason:'Fixture',line:''})}}],usage:{prompt_tokens:100,completion_tokens:50}}));}}};}
test('27 actors still share the same concurrency and daily budget rather than one model loop each',async t=>{
 const m=modelTransport(),c=boot(t,{cap:.02,model:m.config});for(let i=0;i<10;i++)await c.runtime.heartbeat(NOW+i*TICK_MS);assert.ok(m.requests.length>0);assert.ok(m.max<=MAX_MODEL_CALLS);assert.ok(m.requests.length<=10*(1+MAX_MODEL_CALLS));const budget=c.ledger.status();assert.ok(budget.spentUsd<=.02);assert.ok(budget.remainingUsd>=0);
});
test('registered synthetic personal peer can receive NPC conversation without any decision made for the personal actor',async t=>{
 const m=modelTransport(),c=boot(t,{cap:5,model:m.config}),principal=c.owners.ensurePrincipal({provider:'fixture',subject:'synthetic-owner'},NOW),actor=c.owners.registerDraft(principal.id,{operationId:'fixture',displayName:'Synthetic peer',appearanceId:'01-sunny',agentId:'synthetic-agent',rootRef:'root_ref:synthetic'},NOW);
 // Explicit synthetic entry only. The real personal admission/Trust/delegation contract is not implemented here.
 c.runtime.commitExternal(NOW,'fixture-personal-world',s=>{for(const x of s.muses)(s.paused??={})[x.id]={at:NOW,version:s.version,by:'fixture'};const npc=s.muses.find(x=>x.id==='nr_alba');delete s.paused[npc.id];npc.place='commons:garden';npc.beat={id:'look_around',clip:'idle_breathe',startedAt:NOW,endsAt:NOW+10*TICK_MS,line:null};const p={...structuredClone(npc),id:actor.actorId,controlMode:'personal',residentRole:undefined,beat:null,inventory:[],wants:{goal:'Public visiting goal',items:[],source:'connected',updatedAt:NOW},intent:{kind:'greet',target:npc.id}};s.muses.push(p);s.inbox.connected[p.id]=NOW;s.spotlight.cursor=s.muses.indexOf(npc);});
 await c.runtime.heartbeat(NOW);const events=c.runtime.events(0,10000);assert.ok(events.some(e=>e.kind==='encounter_reply'&&e.muse==='nr_alba'&&e.other===actor.actorId));assert.ok(m.requests.some(r=>r.response_format.json_schema.name==='encounter_reply'));assert.ok(!m.requests.some(r=>r.messages[0].content.includes('You are Visiting Muse')));
 const personal=c.runtime.state().muses.find(x=>x.id===actor.actorId);assert.equal(personal.controlMode,'personal');assert.equal(personal.travel,null);assert.equal(personal.beat,null);assert.ok(!events.some(e=>e.muse===actor.actorId&&['depart','beat','encounter_reply'].includes(e.kind)));assert.ok(!c.store.load(c.runtime.worldId).state.residents.some(r=>r.id===actor.actorId));assert.ok(c.runtime.state().inbox.messages.some(x=>x.from==='nr_alba'&&x.to===actor.actorId&&x.kind==='greet'&&x.text==='Hello, visiting neighbor.'));
});
test('signed resident identities are opt-in, distinct, restart-idempotent and reject arbitrary or personal IDs',async t=>{
 const c=boot(t),trust=new Trust(c.sql);trust.init();await trust.ensureAgents(null);assert.equal(trust.agentByMuse('nr_alba'),null);await trust.ensureAgents(null,RESIDENT_INSTANCES.map(r=>r.id));const ids=RESIDENT_INSTANCES.map(r=>trust.agentByMuse(r.id).agentId);assert.equal(new Set(ids).size,17);const card=await trust.card('nr_alba',null,{claimed:false,fingerprint:null},'https://synthetic.invalid');assert.ok(card);await trust.ensureAgents(null,RESIDENT_INSTANCES.map(r=>r.id));assert.deepEqual(RESIDENT_INSTANCES.map(r=>trust.agentByMuse(r.id).agentId),ids);await assert.rejects(trust.ensureAgents(null,['pm_personal']),/invalid resident agent roster/);await assert.rejects(trust.ensureAgents(null,['nr_forged']),/invalid resident agent roster/);
});

test('OFF freezes only enrolled 17 actors and model calls, retaining state through restart and reactivation',async t=>{
 const m=modelTransport(),c=boot(t,{cap:1,model:m.config});
 c.runtime.commitExternal(NOW,'fixture-active-resident',s=>{const a=s.muses.find(m=>m.id==='nr_alba');a.travel={to:'commons:garden',departAt:NOW,arriveAt:NOW+10*TICK_MS,speed:'walk',chosen:true};a.memory=['Keep public memory'];a.reflection='Keep reflection';});
 const original=c.runtime.state().muses.find(m=>m.id==='nr_alba'),life=c.store.load(c.runtime.worldId);c.policy.enabled=false;
 for(const id of RESIDENT_INSTANCES.map(r=>r.id)){const out=await c.runtime.liveSpotlight(c.runtime.state(),id,'where',NOW);assert.equal(out.decision,null);}
 assert.equal(m.requests.length,0);await c.runtime.heartbeat(NOW+TICK_MS);const frozen=c.runtime.state().muses.find(m=>m.id==='nr_alba');assert.equal(frozen.residentFrozenAt,NOW+TICK_MS);assert.deepEqual(frozen.travel,original.travel);assert.deepEqual(frozen.memory,original.memory);
 const restarted=new WorldRuntime(c.sql,c.opts);restarted.init(NOW+2*TICK_MS);await restarted.heartbeat(NOW+20*TICK_MS);const after=restarted.state().muses.find(m=>m.id==='nr_alba');assert.deepEqual(after,frozen);assert.deepEqual(c.store.load(c.runtime.worldId),life);
 assert.equal(restarted.state().muses.length,27);assert.ok(restarted.events(0,10000).some(e=>HARNESS_IDS.includes(e.muse)&&['depart','beat'].includes(e.kind)));assert.ok(!restarted.events(0,10000).some(e=>isResidentInstance(e.muse)&&['depart','arrive','beat','greet','encounter_reply','trade_completed'].includes(e.kind)));
 c.policy.enabled=true;restarted.init(NOW+21*TICK_MS);await restarted.heartbeat(NOW+21*TICK_MS);const resumed=restarted.state().muses.find(m=>m.id==='nr_alba');assert.equal(resumed.residentFrozenAt,undefined);assert.equal(resumed.travel.arriveAt,original.travel.arriveAt+20*TICK_MS);assert.deepEqual(resumed.memory,original.memory);assert.equal(restarted.events(0,10000).filter(e=>e.kind==='resident_join').length,17);
});
test('OFF changed while a synthetic resident model reply is in flight discards it before commit',async t=>{
 const m=modelTransport();let c;c=boot(t,{cap:1,model:m.config,beforeCommit:()=>{c.policy.enabled=false;}});c.runtime.commitExternal(NOW,'fixture-alba-turn',s=>{s.spotlight.cursor=s.muses.findIndex(m=>m.id==='nr_alba');});
 await c.runtime.heartbeat(NOW);assert.ok(m.requests.length>0);assert.ok(c.runtime.events(0,1000).some(e=>e.kind==='decision_discarded'&&e.muse==='nr_alba'));const actor=c.runtime.state().muses.find(m=>m.id==='nr_alba');assert.equal(actor.residentFrozenAt,NOW);assert.equal(actor.travel,null);assert.equal(actor.beat,null);
});
test('engine roster freeze list cannot pause a legacy or personal actor and preserves personal control',()=>{
 const s=createWorld('freeze-boundary',NOW);s.muses[1].controlMode='personal';const out=tick(s,{now:NOW,residentFrozen:HARNESS_IDS});assert.ok(out.state.muses.every(m=>m.residentFrozenAt===undefined));assert.equal(out.state.muses[1].controlMode,'personal');assert.equal(out.state.muses[1].travel,null);assert.equal(out.state.muses[1].beat,null);assert.ok(out.events.some(e=>e.kind==='beat'||e.kind==='depart'));
});
test('OFF does not auto-accept invitations, gather frozen residents, or close their own open invitation',async t=>{
 const {inviteUpkeep}=await import('../worker/core/messages.ts');const {isResidentFrozen}=await import('../src/engine/inbox.ts');const c=boot(t);c.policy.enabled=false;await c.runtime.heartbeat(NOW);const s=c.runtime.state();for(const m of s.muses){m.place='commons:campfire';m.travel=null;m.beat=null;}
 const invitation=(id,from,to)=>({id,from,to,place:'commons:campfire',note:null,at:NOW,expiresAt:NOW+100*TICK_MS,status:'open',answers:Object.fromEntries(to.map(id=>[id,{answer:'accept',via:'rule',at:NOW}]))});
 s.inbox.invites=[invitation('frozen-inviter','nr_alba',['01-sunny','02-moss']),invitation('frozen-guests','01-sunny',['nr_alba','nr_olive'])];
 assert.ok(isResidentFrozen(s,'nr_alba'));const before=JSON.stringify(s.inbox.invites);assert.deepEqual(inviteUpkeep(s,NOW+TICK_MS),[]);assert.equal(JSON.stringify(s.inbox.invites),before);
});
test('external public greetings persist only factual resident receipts and share rollback with their event',t=>{
 const c=boot(t);c.runtime.commitExternal(NOW,'fixture-peer',s=>{const p=structuredClone(s.muses[1]);p.id='pm_public_peer';p.controlMode='personal';s.muses.push(p);});
 const greet=(now,label)=>c.runtime.commitExternal(now,label,(_s,emit)=>emit({at:now,source:'live',kind:'greet',muse:'pm_public_peer',other:'nr_alba',place:'commons:cafe',line:'PUBLIC_OPENER_NOT_MEMORY',data:{public:true,stage:'say_hello'},tags:[]}));
 greet(NOW+1,'public-hello');const saved=c.store.load(c.runtime.worldId),memory=saved.state.residents.find(r=>r.id==='nr_alba').memories;assert.ok(memory.some(m=>m.subject==='pm_public_peer'&&m.publicSummary==='Committed greet event received'));assert.doesNotMatch(JSON.stringify(saved),/PUBLIC_OPENER_NOT_MEMORY/);
 c.db.exec("CREATE TRIGGER fail_greet BEFORE INSERT ON events WHEN NEW.kind='greet' BEGIN SELECT RAISE(ABORT,'greet commit failed'); END");const state=c.runtime.state();assert.throws(()=>greet(NOW+2,'failed-public-hello'),/greet commit failed/);assert.deepEqual(c.store.load(c.runtime.worldId),saved);assert.deepEqual(c.runtime.state(),state);
 c.db.exec('DROP TRIGGER fail_greet');c.policy.enabled=false;greet(NOW+3,'disabled-public-hello');assert.deepEqual(c.store.load(c.runtime.worldId),saved);
});
test('exact prior engine5 checkpoint tuple remains readable and mixed published versions are rejected',async()=>{
 const {assertCompatible}=await import('../src/replay/player.ts');const published={schemaVersion:'run-log-2',engineVersion:'engine-5',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-c7068bfa0238'};assert.doesNotThrow(()=>assertCompatible(published));assert.throws(()=>assertCompatible({...published,catalogVersion:'catalog-unpublished'}));
});
test('OFF is authoritative before the first external invite and immediately on restart, before any alarm',async t=>{
 const {inviteCampfire}=await import('../worker/core/messages.ts'),c=boot(t);c.runtime.commitExternal(NOW,'fixture-invite-ready',s=>{s.muses[0].inventory.push('invite_token');const a=s.muses.find(m=>m.id==='nr_alba');a.wants.items=['invite_token'];a.travel=null;a.beat=null;});
 const invite=(runtime,at,label)=>{let result;runtime.commitExternal(at,label,(s,emit)=>{result=inviteCampfire(s,'00-jolly',{to:['nr_alba'],text:null},()=>null,emit,emit,at);});return result;};
 c.policy.enabled=false;assert.equal(c.runtime.residentUnavailable('nr_alba'),true);assert.equal(c.runtime.residentUnavailable('01-sunny'),false);assert.equal(c.runtime.residentUnavailable('pm_unknown'),false);assert.equal(c.runtime.state().muses.find(m=>m.id==='nr_alba').residentFrozenAt,undefined);assert.equal(invite(c.runtime,NOW+1,'off-first-invite').reason,'no_invitee_available');assert.equal(c.runtime.state().muses.find(m=>m.id==='nr_alba').travel,null);assert.ok(c.runtime.state().muses[0].inventory.includes('invite_token'));
 c.policy.enabled=true;c.runtime.init(NOW+2);assert.equal(c.runtime.state().muses.find(m=>m.id==='nr_alba').residentFrozenAt,undefined);c.policy.enabled=false;const restarted=new WorldRuntime(c.sql,c.opts);restarted.init(NOW+3);assert.equal(restarted.state().muses.find(m=>m.id==='nr_alba').residentFrozenAt,NOW+3);assert.equal(invite(restarted,NOW+4,'off-restart-invite').reason,'no_invitee_available');
 c.policy.enabled=true;assert.equal(invite(restarted,NOW+5,'on-resumed-invite').ok,true);assert.equal(restarted.state().muses.find(m=>m.id==='nr_alba').residentFrozenAt,undefined);assert.equal(restarted.state().muses.find(m=>m.id==='nr_alba').travel.to,'commons:campfire');
});
test('long signed-command event references cannot make public greetings fail the bounded memory contract',t=>{
 const c=boot(t),label='cmd-agent-'+('a'.repeat(96))+'-'+('b'.repeat(64));const events=c.runtime.commitExternal(NOW,label,(_s,emit)=>emit({at:NOW,source:'live',kind:'greet',muse:'01-sunny',other:'nr_alba',place:'commons:cafe',line:'Public hello',data:{public:true},tags:[]}));assert.ok(events[0].id.length>160);const saved=c.store.load(c.runtime.worldId);for(const id of ['01-sunny','nr_alba']){const m=saved.state.residents.find(r=>r.id===id).memories.at(-1);assert.ok(m.id.length<=160);assert.match(m.evidenceId,/^event-sha256:[a-f0-9]{64}$/);}
});
