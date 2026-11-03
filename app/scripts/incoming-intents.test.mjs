// Local TLS → Worker/DO/SQLite. Synthetic residents; no account, scheduler or provider calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {httpsWorld, JOLLY, COPPER} from './test-support/https-world.mjs';

test('both inbox and world reads show a resident intention that has not become a Task', async tc => {
  const t = await httpsWorld(tc);
  t.edit(s => {
    s.muses.find(m => m.id === '05-bloom').intent = {kind:'trade',target:JOLLY,give:'tea',want:null};
    s.muses.find(m => m.id === '01-sunny').intent = {kind:'trade',target:JOLLY,give:'coffee',want:'fruit'};
  });
  const before = JSON.stringify(t.state());
  for (const tool of ['heartbeat_check','get_world_state']) {
    const out = await t.tool(JOLLY,tool);
    assert.equal(out.isError,false);
    const signals = out.structuredContent.incoming_trade_intents;
    assert.deepEqual(signals.map(x=>x.from),['01-sunny','05-bloom']);
    const bloom = signals.find(x=>x.from==='05-bloom');
    assert.equal(bloom.give,'tea'); assert.equal(bloom.want,null);
    assert.equal(bloom.status,'intent_only'); assert.equal(bloom.task_id,null);
    assert.equal(bloom.in_trade_range,true);
    assert.deepEqual(JSON.parse(out.content[0].text).incoming_trade_intents,signals);
    if(tool==='heartbeat_check')assert.deepEqual(out.structuredContent.tasks_for_you,[]);
    else assert.equal(out.structuredContent.inbox.tasks_waiting_for_you,0);
  }
  assert.equal(JSON.stringify(t.state()),before,'reads add no Task, answer, item, message or world commit');
});

test('intent visibility is addressed to its target and preserves an unrelated Task',async tc=>{
  const t=await httpsWorld(tc),at=Date.now();
  t.edit(s=>{
    s.muses.find(m=>m.id==='05-bloom').intent={kind:'trade',target:JOLLY,give:'tea',want:null,private_reason:'SYNTHETIC_PRIVATE_REASON'};
    s.muses.find(m=>m.id==='01-sunny').intent={kind:'trade',target:COPPER,give:'coffee',want:null};
    s.muses.find(m=>m.id==='02-moss').intent={kind:'greet',target:JOLLY};
    s.inbox.tasks.push({id:'task_signal',kind:'trade',from:COPPER,to:JOLLY,status:'pending',awaiting:JOLLY,createdAt:at,deadline:at+1800000,updatedAt:at,round:0,history:[],offer:{by:COPPER,give:'tea',want:'fruit'}});
  });
  const out=(await t.tool(JOLLY,'heartbeat_check')).structuredContent;
  assert.deepEqual(out.incoming_trade_intents.map(x=>x.from),['05-bloom']);
  assert.doesNotMatch(JSON.stringify(out.incoming_trade_intents),/SYNTHETIC_PRIVATE_REASON|private_reason/);
  assert.deepEqual(out.tasks_for_you.map(x=>x.id),['task_signal']);
  assert.equal((await t.tool(JOLLY,'get_world_state')).structuredContent.inbox.tasks_waiting_for_you,1);
  const peer=(await t.tool(COPPER,'get_world_state')).structuredContent;
  assert.deepEqual(peer.incoming_trade_intents.map(x=>x.from),['01-sunny']);
  t.edit(s=>{for(const m of s.muses)m.intent=null;});
  for(const tool of ['get_world_state','heartbeat_check'])assert.deepEqual((await t.tool(JOLLY,tool)).structuredContent.incoming_trade_intents,[]);
});

test('moving, paused and out-of-range senders are facts, never invitations to apply an exchange',async tc=>{
  const t=await httpsWorld(tc),at=Date.now();
  t.edit(s=>{
    const bloom=s.muses.find(m=>m.id==='05-bloom');
    bloom.intent={kind:'trade',target:JOLLY,give:'tea',want:null};
    bloom.travel={to:'commons:garden',departAt:at,arriveAt:at+60000,speed:'walk'};
  });
  let signal=(await t.tool(JOLLY,'get_world_state')).structuredContent.incoming_trade_intents[0];
  assert.equal(signal.travelling,true);assert.equal(signal.in_trade_range,false);
  t.edit(s=>{s.muses.find(m=>m.id==='05-bloom').travel=null;(s.paused??={})['05-bloom']={at,version:2,by:'fixture'};});
  signal=(await t.tool(JOLLY,'heartbeat_check')).structuredContent.incoming_trade_intents[0];
  assert.equal(signal.paused,true);assert.equal(signal.in_trade_range,false);
  t.edit(s=>{delete s.paused['05-bloom'];s.muses.find(m=>m.id==='05-bloom').place='bay:stanford:garden';});
  signal=(await t.tool(JOLLY,'get_world_state')).structuredContent.incoming_trade_intents[0];
  assert.equal(signal.travelling,false);assert.equal(signal.in_trade_range,false);
  assert.equal(t.state().inbox.tasks.length,0);
});
