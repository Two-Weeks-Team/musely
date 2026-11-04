// Local TLS -> real Worker/SQLite only; no Native, model, permanent credential or production request.
import test from 'node:test';import assert from 'node:assert/strict';
import {httpsWorld,JOLLY,COPPER} from './test-support/https-world.mjs';
const count=(t,table)=>t.db.prepare('SELECT count(*) n FROM '+table).get().n;
const read=async t=>(await t.tool(JOLLY,'get_world_state')).structuredContent.world_version;
for(const tool of ['greet','say_hello'])test(tool+' accepts an older plan after unrelated activity, once, with verified original speech',async tc=>{
 const t=await httpsWorld(tc),v=await read(t);t.edit(s=>{s.muses.find(m=>m.id==='02-moss').reflection='Unrelated activity';});
 const args={to:COPPER,text:'Hello, neighbor!',expected_version:v,command_id:'safe-old-'+tool},before=count(t,'commands');
 const first=(await t.tool(JOLLY,tool,args)).structuredContent;assert.equal(first.ok,true);assert.equal(first.said,args.text);assert.equal(first.envelope.verified,true);assert.equal(first.command.applied,true);assert.equal(first.command.expected_version,v);assert.equal(count(t,'commands'),before+1);
 const n=count(t,'nonces'),events=t.events().length,version=t.state().version,again=(await t.tool(JOLLY,tool,args)).structuredContent;assert.equal(again.command.duplicate,true);assert.equal(t.state().version,version);assert.equal(t.events().length,events);assert.equal(count(t,'nonces'),n);
});
for(const conflict of ['distance','paused','busy','introduced'])test('older greeting refuses current '+conflict+' conflict without a nonce or stored result',async tc=>{
 const t=await httpsWorld(tc),v=await read(t);t.edit(s=>{const m=s.muses.find(m=>m.id===COPPER);if(conflict==='distance')m.place='bay:stanford:reading';else if(conflict==='paused')(s.paused??={})[COPPER]=true;else if(conflict==='busy')m.beat={id:'repair',line:'Repairing',startedAt:Date.now(),endsAt:Date.now()+60_000};else(m.introductions??={})[JOLLY]={id:'existing',at:Date.now(),place:m.place};});
 const version=t.state().version,n=count(t,'nonces'),rows=count(t,'commands'),out=(await t.tool(JOLLY,conflict==='introduced'?'say_hello':'greet',{to:COPPER,text:'Hello, neighbor!',expected_version:v,command_id:'conflict-'+conflict})).structuredContent;
 assert.equal(out.refused,'stale_world');assert.equal(out.command.world_version,version);assert.equal(out.command.committed,false);assert.equal(t.state().version,version);assert.equal(count(t,'nonces'),n);assert.equal(count(t,'commands'),rows);assert.equal(t.events().filter(e=>e.kind==='greet').length,0);
});
test('commit guard rechecks local premises after the initial version check; strict item/move plans stay strict',async tc=>{
 const t=await httpsWorld(tc),v=await read(t),original=t.dobj.runtime.commitCommand.bind(t.dobj.runtime);let once=true;
 t.dobj.runtime.commitCommand=(...args)=>{if(once){once=false;t.edit(s=>{s.muses.find(m=>m.id===COPPER).place='bay:stanford:reading';});}return original(...args);};
 const n=count(t,'nonces'),rows=count(t,'commands'),out=(await t.tool(JOLLY,'greet',{to:COPPER,text:'Hello!',expected_version:v,command_id:'commit-premises'})).structuredContent;assert.equal(out.refused,'stale_world');assert.equal(out.step,'commit');assert.equal(count(t,'nonces'),n);assert.equal(count(t,'commands'),rows);
 t.dobj.runtime.commitCommand=original;for(const [tool,args]of [['move',{to:'commons:garden'}],['propose_trade',{to:COPPER,give:'coffee',want:'fruit'}]]){const result=(await t.tool(JOLLY,tool,{...args,expected_version:v,command_id:'strict-'+tool})).structuredContent;assert.equal(result.refused,'stale_world');assert.equal(result.command.committed,false);}
 assert.equal(count(t,'nonces'),n);assert.equal(count(t,'commands'),rows);
});
test('late key revocation still blocks a greeting after asynchronous executor work',async tc=>{
 const t=await httpsWorld(tc),v=await read(t),trust=t.dobj.trust,original=trust.custodialExecutor.bind(trust);let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 trust.custodialExecutor=async(...a)=>{const result=await original(...a);entered();await gate;return result;};
 const pending=t.tool(JOLLY,'greet',{to:COPPER,text:'Hello!',expected_version:v,command_id:'late-revoked-key'});await ready;t.dobj.connected.keys.revoke(t.keys[JOLLY].id,Date.now());release();const out=(await pending).structuredContent;assert.equal(out.refused,'agent_key_revoked');assert.equal(out.command.committed,false);assert.equal(t.events().filter(e=>e.kind==='greet').length,0);
});
test('current explicit private availability is checked using the real status store without exposing its value',async tc=>{
 const t=await httpsWorld(tc);t.env.SOCIAL_STATUS_MODE='public-v1';await t.restart();const v=await read(t);
 t.db.prepare('INSERT INTO social_status_overrides(world_id,actor_id,mode,revision) VALUES(?,?,?,1)').run(t.state().worldId,COPPER,'do_not_disturb');
 t.edit(s=>{s.muses.find(m=>m.id==='02-moss').reflection='Other activity';});const n=count(t,'nonces'),rows=count(t,'commands');
 const out=(await t.tool(JOLLY,'greet',{to:COPPER,text:'Hello!',expected_version:v,command_id:'explicit-status-conflict'})).structuredContent;
 assert.equal(out.refused,'stale_world');assert.equal(out.command.world_version,t.state().version);assert.equal(count(t,'nonces'),n);assert.equal(count(t,'commands'),rows);assert.equal(t.events().filter(e=>e.kind==='greet').length,0);
});
