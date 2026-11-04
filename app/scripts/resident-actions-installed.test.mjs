// Actual WorldDO wiring over isolated SQLite. All sessions/keys and model configuration are fixtures.
import test from 'node:test';import assert from 'node:assert/strict';
import {bootWorldDo} from './test-support/world-life-harness.mjs';
import {CONNECTED_MS} from '../src/engine/inbox.ts';
const settings={RESIDENT_BUDGET_MODE:'split-v1',DAILY_BUDGET_USD:'30',RESIDENT_ACTIONS_MODE:'action-v1',RESIDENT_ACTION_MAX_CONCURRENT:'4'};
test('resident action flag requires split budgets and leaves legacy ownership unchanged',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:settings});
 assert.equal(a.runtime.opts.residentActions?.enabled,true);assert.equal(a.runtime.opts.residentActions.maxConcurrent,4);
 assert.equal(a.world.connected.d.ownerOf('09-copper'),'system:demo-peer');
 assert.equal(a.world.connected.d.ownerOf('04-ember'),'system:reviewer');
 const off=await bootWorldDo(t,{mode:'sandbox-v1'});assert.equal(off.runtime.opts.residentActions,undefined);assert.equal(off.runtime.opts.operatingResidentControl,undefined);
});
test('operator-control read hook resumes only fixed residents after revoked-key stale leases; active user control wins',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:settings}),control=a.runtime.opts.operatingResidentControl,now=Date.now();assert.equal(typeof control,'function');
 assert.equal(control('00-jolly',now),'unknown');assert.equal(control('pm_unknown',now),'unknown');assert.equal(control('01-sunny',now),'unknown');
 assert.equal(control('04-ember',now),'resident');assert.equal(control('09-copper',now),'connected');
 const before=a.db.prepare('SELECT muse_id,kind,agent_id FROM agents ORDER BY muse_id').all();
 a.world.revokeAgentKey(a.issued.peer.id);assert.equal(control('09-copper',now),'resident');
 assert.deepEqual(a.db.prepare('SELECT muse_id,kind,agent_id FROM agents ORDER BY muse_id').all(),before);
 a.edit(s=>{s.muses.find(m=>m.id==='04-ember').profile={actorId:'04-ember',displayName:'fixture',appearanceId:'04-ember',revision:1};});assert.equal(control('04-ember',now),'unknown');
});
test('operator-control clock and SQL failures fail closed without touching registry or keys',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:settings}),control=a.runtime.opts.operatingResidentControl,now=Date.now();
 assert.equal(control('09-copper',now+CONNECTED_MS),'resident');assert.equal(control('09-copper',NaN),'unknown');
 a.db.prepare('UPDATE agent_keys SET last_used_at=? WHERE id=?').run(now+10000,a.issued.peer.id);assert.equal(control('09-copper',now),'unknown');
 const original=a.world.connected.keys.lastActiveUse;a.world.connected.keys.lastActiveUse=()=>{throw Error('fixture SQL failure');};assert.equal(control('09-copper',now),'unknown');a.world.connected.keys.lastActiveUse=original;
});

test('invalid action configuration fails closed before a resident scheduler can start',async t=>{
 for(const envOverrides of [{RESIDENT_ACTIONS_MODE:'unknown'},{...settings,RESIDENT_ACTION_MAX_CONCURRENT:'9'},{...settings,RESIDENT_BUDGET_MODE:'off'}])await assert.rejects(bootWorldDo(t,{mode:'sandbox-v1',envOverrides}),/unsupported_RESIDENT_ACTIONS_MODE|invalid_RESIDENT_ACTION_MAX_CONCURRENT|resident_actions_require/);
});
test('actual owner MCP action never creates a paid model head and a following visitor can progress',async t=>{let calls=0;const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:settings,modelFetcher:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({freedom:'where',decision:'stay',target_place:'The Campfire',target_agent:'',offer_item:'',want_item:'',public_reason:'Enjoy a pause',line:'',duration_minutes:15})}}],usage:{prompt_tokens:10,completion_tokens:10}}));}});a.prepare();a.edit(s=>{for(const m of s.muses)if(!['00-jolly','01-sunny'].includes(m.id))(s.paused??={})[m.id]={at:Date.now(),version:1,by:'fixture'};});const hi=await a.call('owner','greet',{to:'01-sunny',text:'Hello neighbor',command_id:'owner-priority-regression'});assert.equal(hi.status,200);assert.equal(hi.body.result.isError,false);assert.deepEqual(a.runtime.state().spotlight.visitorQueue,[]);const now=Date.now();assert.equal(a.runtime.requestSpotlight('01-sunny',now,{origin:'visitor',requester:'following-visitor'}).ok,true);await a.runtime.heartbeat(now+60000);assert.deepEqual(a.runtime.state().spotlight.visitorQueue,[]);assert.ok(a.runtime.events(0,500).some(e=>e.kind==='greet'&&e.muse==='00-jolly'&&e.source==='live'));assert.ok(!a.runtime.events(0,500).some(e=>e.kind==='beat'&&e.muse==='00-jolly'&&e.source==='live'));assert.ok(calls>0);});
test('explicit worker spotlight refuses self-directed owner and active operator with a precise nonqueued response',async t=>{const secret='fixture-spotlight-session-secret';const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:{...settings,SESSION_SECRET:secret}});const {issueSession,sessionCookie}=await import('../worker/core/session.ts');const cookie=sessionCookie((await issueSession(secret,'judge')).token).split(';')[0];for(const muse of ['00-jolly','09-copper']){const res=await a.request('/api/world/spotlight',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({muse})});assert.equal(res.status,409);assert.deepEqual(await res.json(),{error:'self_directed'});}assert.deepEqual(a.runtime.state().spotlight.visitorQueue,[]);});
