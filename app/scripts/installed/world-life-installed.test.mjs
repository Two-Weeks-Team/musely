// Run only in the complete pinned dependency composition. Actual WorldDO wiring, mocked host.
import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {bootWorldDo,OWNER,PEER} from '../test-support/world-life-harness.mjs';
import {grantItem} from '../../src/engine/items.ts';
const original=globalThis.fetch;let attempts=0;globalThis.fetch=()=>{attempts++;throw Error('installed test forbids network');};after(()=>{globalThis.fetch=original;assert.equal(attempts,0);});
const GARDEN='commons:garden',v=r=>r.body.result?.structuredContent;
const count=(x,t)=>x.db.prepare('SELECT count(*) n FROM '+t).get().n;

test('WorldDO OFF creates no projection/goal tables and exposes no status endpoint',async t=>{const x=await bootWorldDo(t);assert.equal((await x.request('/api/world/life')).status,404);assert.equal(x.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('world_life_invites','resident_wants_goals','resident_life')").get().n,0);});
test('trusted installed mode wires signed multisite MCP to durable projection and public read view',async t=>{
 const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();
 const r=await x.call('owner','invite_campfire',{to:[PEER,'01-sunny'],place_id:GARDEN,command_id:'installed-invite-0001'});assert.equal(r.body.result.isError,false);
 const id=x.runtime.state().inbox.invites[0].id;assert.equal(count(x,'world_life_invites'),1);
 let reply=await x.request('/api/world/life');assert.equal(reply.status,200);let view=await reply.json();assert.equal(view.invitations[0].id,id);assert.equal(view.invitations[0].placeId,GARDEN);assert.equal(view.invitations[0].status,'open');assert(!view.invitations[0].accepted.includes(PEER));
 assert.equal((await x.call('peer','answer_campfire',{invite_id:id,answer:'accept',command_id:'installed-answer-0001'})).body.result.isError,false);
 view=await (await x.request('/api/world/life')).json();assert(view.invitations[0].accepted.includes(PEER));assert.equal(count(x,'world_life_invites'),1);
 assert.doesNotMatch(JSON.stringify(view),/private_jwk|root_ref|fixture-owner-control/);
});
test('projection persistence failure rolls back signed command, nonce result, inventory and world',async t=>{
 const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();const before=structuredClone(x.runtime.state()),commands=count(x,'commands');
 x.db.exec("CREATE TRIGGER stop_projection BEFORE INSERT ON world_life_invites BEGIN SELECT RAISE(ABORT,'fixture projection failure'); END");
 const r=await x.call('owner','invite_campfire',{to:[PEER],place_id:GARDEN,command_id:'installed-rollback-0001'});assert(r.body.result?.isError||r.body.error);
 assert.deepEqual(x.runtime.state(),before);assert.equal(count(x,'world_life_invites'),0);assert.equal(count(x,'commands'),commands);
 x.db.exec('DROP TRIGGER stop_projection');assert.equal((await x.call('owner','invite_campfire',{to:[PEER],place_id:GARDEN,command_id:'installed-rollback-0001'})).body.result.isError,false);assert.equal(count(x,'world_life_invites'),1);
});
test('targeted committed evidence works after more than20000 unrelated event rows',async t=>{
 const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();
 const row=x.db.prepare('SELECT * FROM events LIMIT 1').get();const fields=Object.keys(row).filter(k=>k!=='seq');const insert=x.db.prepare('INSERT INTO events ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')');
 x.db.exec('BEGIN');for(let i=0;i<20010;i++){const r={...row,id:'padding-'+i,kind:'fixture_padding',data:'{}'};insert.run(...fields.map(k=>r[k]));}x.db.exec('COMMIT');
 assert.equal((await x.call('owner','invite_campfire',{to:[PEER],place_id:GARDEN,command_id:'installed-late-0001'})).body.result.isError,false);assert.equal(count(x,'world_life_invites'),1);
});
test('mode withdrawal blocks new venue and hides endpoint without deleting stored receipts',async t=>{
 const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();x.env.WORLD_LIFE_MODE='off';assert.equal(v(await x.call('owner','invite_campfire',{to:[PEER],place_id:GARDEN,command_id:'installed-off-0001'})).refused,'multi_campfire_disabled');assert.equal((await x.request('/api/world/life')).status,404);assert.equal(count(x,'world_life_invites'),0);
});
test('OFF withdrawal stops resident store revisions through alarm and restart; reactivation requires installed restart',async t=>{
 let clock=Date.parse('2026-11-03T20:00:00Z');t.mock.method(Date,'now',()=>clock);const x=await bootWorldDo(t,{mode:'sandbox-v1'});
 const row=()=>x.db.prepare('SELECT revision,state FROM resident_life').get(),before=row();x.env.WORLD_LIFE_MODE='off';clock+=60000;await x.world.alarm();assert.deepEqual(row(),before);assert.equal(count(x,'resident_wants_goals'),0);
 await x.restart();clock+=60000;await x.world.alarm();assert.deepEqual(row(),before);assert.equal((await x.request('/api/world/life')).status,404);
 x.env.WORLD_LIFE_MODE='sandbox-v1';assert.equal((await x.request('/api/world/life')).status,404,'OFF-booted instance must not pretend new services were installed');await x.restart();assert.equal((await x.request('/api/world/life')).status,200);clock+=60000;await x.world.alarm();assert(row().revision>before.revision);
});
test('restart preserves committed projection and authenticates existing signed key without duplicate spend',async t=>{
 const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();const args={to:[PEER],place_id:GARDEN,command_id:'installed-restart-0001'};
 assert.equal((await x.call('owner','invite_campfire',args)).body.result.isError,false);const before=x.runtime.state(),view=await(await x.request('/api/world/life')).json();
 await x.restart();assert.equal(count(x,'world_life_invites'),1);assert.equal((await x.call('owner','invite_campfire',args)).body.result.isError,false);assert.deepEqual(x.runtime.state(),before);assert.deepEqual((await(await x.request('/api/world/life')).json()).invitations,view.invitations);
});
test('overdue open invitation never blocks restart and only actual upkeep commits expiry; failure rolls back',async t=>{
 let clock=Date.parse('2026-11-03T20:00:00Z');t.mock.method(Date,'now',()=>clock);const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();
 assert.equal((await x.call('owner','invite_campfire',{to:[PEER],place_id:GARDEN,command_id:'installed-downtime-0001'})).body.result.isError,false);x.edit(s=>{s.muses[0].reflection='unrelated commit';});clock+=31*60000;await x.restart();
 assert.equal(x.runtime.state().inbox.invites[0].status,'open');let view=await(await x.request('/api/world/life')).json();assert.equal(view.invitations[0].status,'open');assert.equal(view.invitations[0].awaitingUpkeep,true);
 const before=structuredClone(x.runtime.state());x.db.exec("CREATE TRIGGER stop_expiry_projection BEFORE UPDATE ON world_life_invites BEGIN SELECT RAISE(ABORT,'fixture expiry projection failure'); END");await assert.rejects(x.world.alarm(),/fixture expiry projection failure/);assert.deepEqual(x.runtime.state(),before);x.db.exec('DROP TRIGGER stop_expiry_projection');await x.world.alarm();
 assert.equal(x.runtime.state().inbox.invites[0].status,'expired');view=await(await x.request('/api/world/life')).json();assert.equal(view.invitations[0].status,'expired');assert.equal(view.invitations[0].awaitingUpkeep,false);
});
test('first opt-in after legacy invite downtime waits for committed upkeep before creating projection',async t=>{
 let clock=Date.parse('2026-11-03T20:00:00Z');t.mock.method(Date,'now',()=>clock);const x=await bootWorldDo(t);x.prepare();assert.equal((await x.call('owner','invite_campfire',{to:[PEER],command_id:'installed-first-optin-0001'})).body.result.isError,false);clock+=31*60000;x.env.WORLD_LIFE_MODE='sandbox-v1';await x.restart();assert.equal(count(x,'world_life_invites'),0);assert.equal(x.runtime.state().inbox.invites[0].status,'open');await x.world.alarm();assert.equal(count(x,'world_life_invites'),1);assert.equal((await(await x.request('/api/world/life')).json()).invitations[0].status,'expired');
});
test('actual WorldDO alarm creates a catalog goal, starts use and persists verified completion',async t=>{
 let clock=Date.parse('2026-11-03T20:00:00Z');t.mock.method(Date,'now',()=>clock);
 const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.edit(s=>{s.spotlight.cursor=2;for(const m of s.muses){m.travel=null;m.beat=null;}const m=s.muses.find(m=>m.id==='02-moss');m.place=GARDEN;m.inventory=[];grantItem(s.items,m,'clover_seed',clock,GARDEN,'craft');grantItem(s.items,m,'garden_pass',clock,GARDEN,'craft');});
 clock+=60000;await x.world.alarm();assert.equal(x.runtime.state().muses.find(m=>m.id==='02-moss').beat?.id,'garden_plant');
 clock+=13*60000;await x.world.alarm();const goals=JSON.parse(x.db.prepare('SELECT body FROM resident_wants_goals WHERE json_extract(body,\'$.muse\')=?').get('02-moss').body);assert.equal(goals.status,'fulfilled');assert.equal(count(x,'resident_wants_receipts'),1);assert(x.runtime.state().muses.find(m=>m.id==='02-moss').inventory.includes('bloom'));
 const view=await (await x.request('/api/world/life')).json();assert(view.goals.some(g=>g.muse==='02-moss'&&g.status==='fulfilled'));assert(!view.goals.some(g=>g.muse===OWNER||g.muse===PEER));
});
test('resident public need becomes pending offer; only signed personal acceptance exchanges items before autonomous use',async t=>{
 let clock=Date.parse('2026-11-03T20:00:00Z');t.mock.method(Date,'now',()=>clock);const x=await bootWorldDo(t,{mode:'sandbox-v1'});
 x.edit(s=>{s.spotlight.cursor=2;for(const m of s.muses){m.travel=null;m.beat=null;m.inventory=[];}const actor=s.muses.find(m=>m.id==='02-moss'),peer=s.muses.find(m=>m.id===PEER);actor.place=peer.place=GARDEN;grantItem(s.items,actor,'clover_seed',clock,GARDEN,'craft');grantItem(s.items,actor,'tea',clock,GARDEN,'craft');grantItem(s.items,peer,'garden_pass',clock,GARDEN,'craft');});
 assert.equal((await x.call('peer','update_wants',{goal:'Share a tea',items:['tea'],command_id:'installed-personal-wants-0001'})).body.result.isError,false);
 clock+=60000;await x.world.alarm();assert(!x.runtime.state().inbox.tasks.some(t=>t.from==='02-moss'),'personal spotlight gets its requested turn first');
 clock+=60000;await x.world.alarm();const task=x.runtime.state().inbox.tasks.find(t=>t.from==='02-moss'&&t.to===PEER);assert(task);assert.equal(task.status,'pending');assert.equal(task.awaiting,PEER);assert(x.runtime.state().muses.find(m=>m.id===PEER).inventory.includes('garden_pass'));
 assert.equal((await x.call('peer','accept_trade',{task_id:task.id,command_id:'installed-personal-accept-0001'})).body.result.isError,false);assert(x.runtime.state().muses.find(m=>m.id==='02-moss').inventory.includes('garden_pass'));
 x.edit(s=>{s.spotlight.cursor=2;});clock+=60000;await x.world.alarm();clock+=60000;await x.world.alarm();assert.equal(x.runtime.state().muses.find(m=>m.id==='02-moss').beat?.id,'garden_plant');clock+=13*60000;await x.world.alarm();assert.equal(count(x,'resident_wants_receipts'),1);
});
test('WorldDO configured model uses mock transport through actual heartbeat trade caller and labels system provenance',async t=>{
 let clock=Date.parse('2026-11-03T20:00:00Z'),calls=0;t.mock.method(Date,'now',()=>clock);
 const x=await bootWorldDo(t,{mode:'sandbox-v1',modelFetcher:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({decision:'accept',counter_give:'',counter_want:'',line:'ignored'})}}],usage:{prompt_tokens:10,completion_tokens:10}}),{headers:{'x-request-id':'installed-mock'}});}});
 // Pending task and goal are explicit setup fixtures for this caller test, not discovery evidence.
 x.edit(s=>{s.spotlight.cursor=2;for(const m of s.muses){m.travel=null;m.beat=null;m.inventory=[];}const a=s.muses.find(m=>m.id==='02-moss'),b=s.muses.find(m=>m.id===PEER);a.place=b.place=GARDEN;grantItem(s.items,a,'tea',clock,GARDEN,'craft');grantItem(s.items,b,'garden_pass',clock,GARDEN,'craft');s.inbox.tasks.push({id:'fixture-negotiation',kind:'trade',from:PEER,to:a.id,status:'pending',awaiting:a.id,createdAt:clock,deadline:clock+600000,updatedAt:clock,round:0,offer:{by:PEER,give:'garden_pass',want:'tea'},history:[]});});
 const goal={id:'fixture-goal',muse:'02-moss',beat:'garden_plant',createdAt:clock,expiresAt:clock+86400000,status:'active'};x.db.prepare('INSERT INTO resident_wants_goals(world_id,goal_id,revision,body) VALUES (?,?,?,?)').run('musely',goal.id,0,JSON.stringify(goal));
 clock+=60000;await x.world.alarm();assert.equal(x.runtime.state().inbox.tasks.find(t=>t.id==='fixture-negotiation').status,'completed');assert(calls>=1);const e=x.runtime.events(0,1000).find(e=>e.kind==='trade_completed');assert.equal(e.data.actorOrigin,'system');assert.equal(e.data.decisionSource,'resident_model');assert.equal(e.data.evidence.requestId,'installed-mock');
});
test('trusted mode withdrawal while model is pending prevents the late exchange and resident-store write',async t=>{
 let clock=Date.parse('2026-11-03T20:00:00Z'),x;t.mock.method(Date,'now',()=>clock);
 x=await bootWorldDo(t,{mode:'sandbox-v1',modelFetcher:async()=>{x.env.WORLD_LIFE_MODE='off';return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({decision:'accept',counter_give:'',counter_want:'',line:'ignored'})}}],usage:{prompt_tokens:10,completion_tokens:10}}));}});
 x.edit(s=>{s.spotlight.cursor=2;for(const m of s.muses){m.travel=null;m.beat=null;m.inventory=[];}const a=s.muses.find(m=>m.id==='02-moss'),b=s.muses.find(m=>m.id===PEER);a.place=b.place=GARDEN;grantItem(s.items,a,'tea',clock,GARDEN,'craft');grantItem(s.items,b,'garden_pass',clock,GARDEN,'craft');s.inbox.tasks.push({id:'fixture-late',kind:'trade',from:PEER,to:a.id,status:'pending',awaiting:a.id,createdAt:clock,deadline:clock+600000,updatedAt:clock,round:0,offer:{by:PEER,give:'garden_pass',want:'tea'},history:[]});});
 const goal={id:'fixture-late-goal',muse:'02-moss',beat:'garden_plant',createdAt:clock,expiresAt:clock+86400000,status:'active'};x.db.prepare('INSERT INTO resident_wants_goals(world_id,goal_id,revision,body) VALUES (?,?,?,?)').run('musely',goal.id,0,JSON.stringify(goal));const revision=x.db.prepare('SELECT revision FROM resident_life').get().revision;
 clock+=60000;await x.world.alarm();assert.equal(x.runtime.state().inbox.tasks.find(t=>t.id==='fixture-late').status,'pending');assert(x.runtime.state().muses.find(m=>m.id===PEER).inventory.includes('garden_pass'));assert.equal(x.db.prepare('SELECT revision FROM resident_life').get().revision,revision);assert.equal(count(x,'resident_wants_decisions'),0);
});
test('goal-idle precedence cannot claim that a blocked resident routine was served',async t=>{
 let clock=Date.parse('2026-11-03T20:00:00Z');t.mock.method(Date,'now',()=>clock);const x=await bootWorldDo(t,{mode:'sandbox-v1'});
 x.edit(s=>{s.spotlight.cursor=2;for(const m of s.muses){m.travel=null;m.beat=null;m.inventory=[];}s.muses.find(m=>m.id==='02-moss').place=GARDEN;});
 const row=x.db.prepare('SELECT state FROM resident_life').get(),life=JSON.parse(row.state),m=life.residents.find(m=>m.id==='02-moss');m.routine=[{hour:0,place:'commons:benches'}];x.db.prepare('UPDATE resident_life SET state=?').run(JSON.stringify(life));
 clock+=60000;await x.world.alarm();const state=x.runtime.state(),actual=state.muses.find(m=>m.id==='02-moss'),after=JSON.parse(x.db.prepare('SELECT state FROM resident_life').get().state).residents.find(m=>m.id==='02-moss');
 assert.equal(actual.place,GARDEN);assert.equal(actual.travel,null);assert.equal(after.served,m.served);assert.equal(after.lastServedAt,m.lastServedAt);
 const record=x.runtime.runLog.inputs(x.runtime.runLog.current.runId).at(-1);assert(record.input.residentGoalIdle.includes('02-moss'));assert.equal(record.input.residentLife,undefined);
});
