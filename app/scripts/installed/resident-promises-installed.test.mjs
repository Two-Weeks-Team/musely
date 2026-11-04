// Actual signed legacy-owner MCP path. Dynamic pm_* invitation remains pending-claim blocked by main.
import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {bootWorldDo,OWNER} from '../test-support/world-life-harness.mjs';
const fetch=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('No network in installed promise tests');};after(()=>{globalThis.fetch=fetch;assert.equal(calls,0);});
const now=Date.parse('2026-11-03T20:00:00Z'),residents=['nr_alba','nr_harbor'];
const life=x=>JSON.parse(x.db.prepare('SELECT state FROM resident_life').get().state);
const promises=(x,id)=>life(x).residents.find(r=>r.id===id).promises;
async function invite(x,id='promise-invite'){const r=await x.call('owner','invite_campfire',{to:residents,command_id:id});assert.equal(r.body.result?.isError,false,JSON.stringify(r.body));return x.runtime.state().inbox.invites.at(-1);}
test('signed owner invitation records rule promises, actual travel and committed gathering close them atomically',async t=>{
 let clock=now;t.mock.method(Date,'now',()=>clock);const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();x.edit(s=>{for(const id of residents)s.muses.find(m=>m.id===id).place='commons:benches';});
 const inv=await invite(x);assert.equal(inv.status,'open');for(const id of residents){assert.equal(promises(x,id).length,1);assert.equal(promises(x,id)[0].status,'pending');assert.equal(promises(x,id)[0].other,OWNER);assert.equal(x.runtime.state().muses.find(m=>m.id===id).travel.to,'commons:campfire');}
 const ends=Math.max(...residents.map(id=>x.runtime.state().muses.find(m=>m.id===id).travel.arriveAt));clock=ends+1;await x.world.alarm();const closed=x.runtime.state().inbox.invites.find(i=>i.id===inv.id);assert.equal(closed.status,'gathered');for(const id of residents)assert.equal(promises(x,id)[0].status,'fulfilled');assert.equal(life(x).residents.some(r=>r.id===OWNER),false);
 const before=life(x);await x.restart();assert.deepEqual(life(x),before);
});
test('actual expiry closes accepted promises after downtime without inventing attendance',async t=>{
 let clock=now;t.mock.method(Date,'now',()=>clock);const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();x.edit(s=>{s.muses.find(m=>m.id===OWNER).place='commons:benches';for(const id of residents)s.muses.find(m=>m.id===id).place='commons:benches';});const inv=await invite(x,'promise-expiry');clock=inv.expiresAt+1;await x.restart();for(const id of residents)assert.equal(promises(x,id)[0].status,'pending');await x.world.alarm();assert.equal(x.runtime.state().inbox.invites.find(i=>i.id===inv.id).status,'expired');for(const id of residents)assert.equal(promises(x,id)[0].status,'cancelled');
});
test('promise-store failure rolls signed invitation, inventory, nonce and server projection back',async t=>{
 let clock=now;t.mock.method(Date,'now',()=>clock);const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();x.edit(s=>{for(const id of residents)s.muses.find(m=>m.id===id).place='commons:benches';});const before=x.runtime.state(),row=life(x),commands=x.db.prepare('SELECT count(*) n FROM commands').get().n;
 x.db.exec("CREATE TEMP TRIGGER fail_promise BEFORE UPDATE ON resident_life BEGIN SELECT RAISE(ABORT,'promise save failure'); END");const r=await x.call('owner','invite_campfire',{to:residents,command_id:'promise-rollback'});assert(r.body.result?.isError||r.body.error);assert.deepEqual(x.runtime.state(),before);assert.deepEqual(life(x),row);assert.equal(x.db.prepare('SELECT count(*) n FROM commands').get().n,commands);assert.equal(x.db.prepare('SELECT count(*) n FROM world_life_invites').get().n,0);x.db.exec('DROP TRIGGER fail_promise');await invite(x,'promise-rollback');for(const id of residents)assert.equal(promises(x,id).length,1);
});
test('signed multi-place obligations stay separate and owner revocation cancels both without inventing fulfillment',async t=>{
 let clock=now;t.mock.method(Date,'now',()=>clock);const x=await bootWorldDo(t,{mode:'sandbox-v1'});x.prepare();
 const groups=[residents,['nr_basil','nr_indigo']];for(const [n,place]of ['commons:garden','commons:benches'].entries()){const r=await x.call('owner','invite_campfire',{to:groups[n],place_id:place,command_id:'promise-place-'+n});assert.equal(r.body.result?.isError,false,JSON.stringify(r.body));}
 for(const [n,group]of groups.entries())for(const id of group){assert.equal(promises(x,id).length,1);assert.equal(promises(x,id)[0].place,['commons:garden','commons:benches'][n]);assert.equal(promises(x,id)[0].status,'pending');}
 x.world.ownerRevoke(OWNER,'owner:fixture');clock+=60000;await x.world.alarm();assert(x.runtime.state().inbox.invites.every(i=>i.status==='cancelled'));for(const id of groups.flat())assert(promises(x,id).every(p=>p.status==='cancelled'));
});
