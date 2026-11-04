// Local TLS → Worker/DO → real SQLite. No provider, production or native Muse call.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpsWorld,JOLLY,COPPER} from './test-support/https-world.mjs';
const value=r=>r.structuredContent;
const effects=(r,committed,applied)=>assert.deepEqual([r.command.committed,r.command.applied],[committed,applied]);
const count=(t,table)=>t.db.prepare('SELECT count(*) n FROM '+table).get().n;

test('stale precommit spends no nonce/row; same ID fresh succeeds once; duplicate has no new effects',async tc=>{
 const t=await httpsWorld(tc),world=value(await t.tool(JOLLY,'get_world_state')),id='freshness-same-id-01';
 const rows=count(t,'commands'),nonces=count(t,'nonces'),v=t.state().version;
 const stale=value(await t.tool(JOLLY,'greet',{text:'Hello there',command_id:id,expected_version:world.world_version+7}));
 assert.equal(stale.refused,'stale_world');
 assert.equal(count(t,'commands'),rows);assert.equal(count(t,'nonces'),nonces);assert.equal(t.state().version,v);
 const e=t.events().find(e=>e.data?.command_id===id&&e.data.reason==='stale_world');
 assert.equal(e.data.expected_version,world.world_version+7);assert.equal(e.data.observed_world_version,v);
 effects(stale,false,false);
 const fresh=value(await t.tool(JOLLY,'get_world_state'));
 assert.ok(Number.isSafeInteger(fresh.observed_at));assert.ok(fresh.observed_at>=world.observed_at);
 const args={text:'Hello there',command_id:id,expected_version:fresh.world_version};
 const first=value(await t.tool(JOLLY,'greet',args));effects(first,true,true);
 assert.equal(count(t,'commands'),rows+1);assert.equal(count(t,'nonces'),nonces+2);
 const after=t.state().version,events=t.events().length;
 const duplicate=value(await t.tool(JOLLY,'greet',args));effects(duplicate,false,false);assert.equal(duplicate.command.duplicate,true);
 assert.equal(count(t,'commands'),rows+1);assert.equal(count(t,'nonces'),nonces+2);assert.equal(t.state().version,after);assert.equal(t.events().length,events);
 const refused=value(await t.tool(JOLLY,'move',{to:t.muse(JOLLY).place,command_id:'freshness-rule-refusal'}));
 assert.equal(refused.refused,'already_here');effects(refused,true,false);
 effects(value(await t.tool(JOLLY,'move',{to:t.muse(JOLLY).place,command_id:'freshness-rule-refusal'})),false,false);
});

test('due heartbeat changes the global version; a safe greeting still commits without a chosen retry',async tc=>{
 const t=await httpsWorld(tc);
 // A real peer message is unread upkeep, not an artificial version override.
 await t.tool(COPPER,'greet',{to:JOLLY,text:'Good morning'});
 const world=value(await t.tool(JOLLY,'get_world_state'));
 const hb=value(await t.tool(JOLLY,'heartbeat_check'));assert.ok(hb.messages.length>0);assert.ok(t.state().version>world.world_version);
 assert.equal(hb.world_version,t.state().version,'heartbeat reports the post-upkeep version, not the read it invalidated');
 assert.ok(Number.isSafeInteger(hb.observed_at));assert.ok(hb.observed_at>=world.observed_at);
 const accepted=value(await t.tool(JOLLY,'greet',{text:'Good morning',command_id:'freshness-hb-order',expected_version:world.world_version}));assert.equal(accepted.ok,true);effects(accepted,true,true);
 const fresh=value(await t.tool(JOLLY,'get_world_state'));
 const duplicate=value(await t.tool(JOLLY,'greet',{text:'Good morning',command_id:'freshness-hb-order',expected_version:fresh.world_version}));assert.equal(duplicate.command.duplicate,true);effects(duplicate,false,false);
});

test('heartbeat returns a usable post-upkeep version and a no-op recheck cannot invalidate it',async tc=>{
 const t=await httpsWorld(tc);
 await t.tool(COPPER,'greet',{to:JOLLY,text:'Good morning'});
 const hb=value(await t.tool(JOLLY,'heartbeat_check')),version=t.state().version;
 assert.equal(hb.world_version,version);assert.ok(hb.messages.length>0);
 const next=value(await t.tool(JOLLY,'heartbeat_check'));assert.equal(next.world_version,version);
 assert.equal(t.state().version,version);assert.deepEqual(next.messages,[]);
 effects(value(await t.tool(JOLLY,'greet',{text:'Good morning',command_id:'freshness-post-upkeep-version',expected_version:next.world_version})),true,true);
});

test('world, heartbeat and hello deliver the same freshness guidance across places without choosing actions',async tc=>{
 const t=await httpsWorld(tc),contexts=[];
 for(const place of ['commons:cafe','commons:garden']){
  t.edit(s=>{for(const m of s.muses){m.place=place;m.travel=null;}});
  contexts.push(value(await t.tool(JOLLY,'get_world_state')).continuation);
  contexts.push(value(await t.tool(JOLLY,'heartbeat_check')).continuation);
 }
 contexts.push(value(await t.tool(JOLLY,'say_hello',{to:COPPER})).continuation);
 for(const c of contexts){assert.deepEqual(c,contexts[0]);assert.equal(c.server_acts_for_muse,false);assert.match(c.prompt,/heartbeat.*before.*fresh get_world_state/i);assert.match(c.prompt,/same command_id/);assert.match(c.prompt,/connector.call.*time budgets/i);assert.match(c.prompt,/next run/i);assert.match(c.prompt,/doing nothing is also valid/);assert.doesNotMatch(c.prompt,/must trade|always accept|always reject/i);}
 const list=(await t.rpc(t.keys[JOLLY].key,'tools/list')).body.result.tools;
 for(const name of ['get_world_state','heartbeat_check','say_hello'])assert.match(list.find(t=>t.name===name).description,/fresh get_world_state/i);
});
