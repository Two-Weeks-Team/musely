import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {grantItem} from '../../src/engine/items.ts';
import {bootWorldDo} from '../test-support/world-life-harness.mjs';
const original=globalThis.fetch;let attempted=0;globalThis.fetch=()=>{attempted++;throw Error('offline roster test');};after(()=>{globalThis.fetch=original;assert.equal(attempted,0);});
test('trusted installation admits twenty-four resident identities and seventeen separate signed-card roots once',async t=>{
 const x=await bootWorldDo(t,{mode:'sandbox-v1'}),life=JSON.parse(x.db.prepare('SELECT state FROM resident_life').get().state),state=x.runtime.state();assert.equal(state.muses.length,27);assert.equal(life.residents.length,24);assert.equal(new Set(life.residents.map(r=>r.id)).size,24);
 const added=state.muses.filter(m=>m.id.startsWith('nr_'));assert.equal(added.length,17);assert(added.every(m=>!m.profile&&m.controlMode!=='personal'));const agents=x.db.prepare("SELECT agent_id FROM agents WHERE muse_id LIKE 'nr_%'").all();assert.equal(new Set(agents.map(a=>a.agent_id)).size,17);assert.equal(x.runtime.events(0,1000).filter(e=>e.kind==='resident_join').length,17);
 const row=x.db.prepare('SELECT revision,state FROM resident_life').get();await x.restart();assert.equal(x.runtime.state().muses.length,27);assert.deepEqual(x.db.prepare('SELECT revision,state FROM resident_life').get(),row);assert.equal(x.runtime.events(0,1000).filter(e=>e.kind==='resident_join').length,17);
});
test('actual alarms advance multiple distinct residents with recorded routine movement while personal slots stay controlled',async t=>{
 let clock=Date.parse('2026-11-03T20:00:00Z');t.mock.method(Date,'now',()=>clock);const x=await bootWorldDo(t,{mode:'sandbox-v1'});
 for(let n=0;n<60;n++){clock+=60000;await x.world.alarm();}
 const events=x.runtime.events(0,10000),moved=new Set(events.filter(e=>e.kind==='depart'&&e.muse?.startsWith('nr_')).map(e=>e.muse));assert(moved.size>=10,'at least ten distinct newly admitted residents really moved, not just seeded records');assert(events.every(e=>e.muse!=='pm_forged'));
 const life=JSON.parse(x.db.prepare('SELECT state FROM resident_life').get().state);assert(life.residents.some(r=>r.id.startsWith('nr_')&&r.served>0));assert(life.residents.every(r=>!['00-jolly','04-ember','09-copper'].includes(r.id)));
});
for(const action of ['invite_campfire','propose_trade','give_gift'])test('OFF before the first alarm immediately blocks signed '+action+' affecting an enrolled NPC',async t=>{
 const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();x.edit(s=>{const owner=s.muses.find(m=>m.id==='00-jolly'),npc=s.muses.find(m=>m.id==='nr_alba');owner.inventory=[];npc.inventory=[];grantItem(s.items,owner,'invite_token',Date.now(),owner.place,'craft');grantItem(s.items,owner,'tea',Date.now(),owner.place,'craft');grantItem(s.items,npc,'garden_pass',Date.now(),npc.place,'craft');npc.wants.items=['tea'];});
 const before=x.runtime.state(),npcBefore=before.muses.find(m=>m.id==='nr_alba'),ownerBefore=before.muses.find(m=>m.id==='00-jolly');x.env.WORLD_LIFE_MODE='off';
 const args=action==='invite_campfire'?{to:['nr_alba']}:action==='propose_trade'?{to:'nr_alba',give:'tea',want:'garden_pass'}:{to:'nr_alba',item:'tea'};const reply=await x.call('owner',action,{...args,command_id:'immediate-off-'+action});assert.equal(reply.body.result.isError,true);
 const after=x.runtime.state(),npc=after.muses.find(m=>m.id==='nr_alba'),owner=after.muses.find(m=>m.id==='00-jolly');assert.deepEqual(npc.inventory,npcBefore.inventory);assert.deepEqual(owner.inventory,ownerBefore.inventory);assert.deepEqual(npc.travel,npcBefore.travel);assert.deepEqual(npc.beat,npcBefore.beat);assert.equal(after.inbox.tasks.length,before.inbox.tasks.length);assert.equal((after.inbox.invites??[]).length,(before.inbox.invites??[]).length);
});
