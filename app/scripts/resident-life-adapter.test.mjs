import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorld,spotlightFor,tick,TICK_MS} from '../src/engine/world.ts';
import {createLife,recordPromise,saveLife} from '../src/engine/resident-life.ts';
import {residentProposalForWorld,rememberCommittedResidentEvents,ResidentLifeStore} from '../worker/core/resident-life-adapter.ts';
const now=Date.parse('2026-11-03T20:00:00Z');
const setup=()=>{const world=createWorld('life-test',now);const life=createLife([{id:'host',defaultGoal:'Meet neighbors',home:'commons:campfire'}],world.muses.map(m=>({id:m.id,roleId:'host'})));return {world,life};};
const opts={enabled:true,residentTurnAllowed:true,allowedPlaceIds:['commons:campfire']};
function sqlFor(db){return {exec(q,...args){const stmt=db.prepare(q);return {toArray:()=>stmt.all(...args)};},transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};}
// DO exec executes immediately, including writes; faithfully preserve that in the local seam.
function durableSql(db){const sql=sqlFor(db);sql.exec=(q,...args)=>{const rows=db.prepare(q).all(...args);return {toArray:()=>rows};};return sql;}
test('adapter uses real engine spotlight, disabled by default and leaves world untouched',()=>{
 const {world,life}=setup(),before=JSON.stringify(world);world.spotlight.cursor=3;
 assert.equal(residentProposalForWorld(life,world,now,opts).residentId,spotlightFor(world,now).muse);
 assert.equal(residentProposalForWorld(life,world,now,{...opts,enabled:false}),null);
 world.spotlight.cursor=0;assert.equal(JSON.stringify(world),before);
});
test('real visitor priority is never replaced; existing streak still controls rotation',()=>{
 const {world,life}=setup();world.spotlight.visitorQueue=['04-ember'];
 assert.equal(residentProposalForWorld(life,world,now,opts),null);
 world.spotlight.streak=2;
 assert.equal(residentProposalForWorld(life,world,now,opts).residentId,'00-jolly');
});
test('persistent personal control remains excluded after connected presence expires',()=>{
 const {world,life}=setup();world.muses[0].controlMode='personal';
 assert.equal(residentProposalForWorld(life,world,now+86_400_000,opts),null);
 delete world.muses[0].controlMode;world.inbox.connected['00-jolly']=now;
 assert.equal(residentProposalForWorld(life,world,now,opts),null);
});
test('paused, travelling, busy and budget-denied actor cannot receive resident proposal',()=>{
 for(const kind of ['paused','travel','beat','budget']){
 const {world,life}=setup();if(kind==='paused')world.paused={'00-jolly':{at:now,version:0,by:'owner'}};
 if(kind==='travel')world.muses[0].travel={to:'commons:cafe',departAt:now,arriveAt:now+60_000,speed:'walk'};
 if(kind==='beat')world.muses[0].beat={id:'b',clip:'idle',startedAt:now,endsAt:now+60_000,line:null};
 assert.equal(residentProposalForWorld(life,world,now,{...opts,residentTurnAllowed:kind!=='budget'}),null);
 }});
test('actual engine arrival events enter factual memory with provenance and no raw text/data',()=>{
 const {world,life}=setup();world.muses[1].travel={to:'commons:campfire',departAt:now-60_000,arriveAt:now,speed:'walk'};
 const result=tick(world,{now:now+TICK_MS});const events=result.events.map(e=>({...e,line:'private text',data:{secret:'do not copy'}}));
 const next=rememberCommittedResidentEvents(life,result.state,events,now+TICK_MS);
 const memories=next.residents.flatMap(r=>r.memories);assert.ok(memories.some(m=>m.publicSummary==='Committed arrive event'));
 assert.ok(memories.every(m=>m.kind==='executed'&&m.source==='rule'));assert.ok(!saveLife(next).includes('private text'));assert.ok(!saveLife(next).includes('do not copy'));
 assert.deepEqual(rememberCommittedResidentEvents(next,result.state,events,now+TICK_MS),next);
});
test('event intake excludes personal actors, future and unknown/unsupported events',()=>{
 const {world,life}=setup();world.muses[0].controlMode='personal';
 const event={id:'e',tick:0,at:now,source:'rule',kind:'arrive',muse:'00-jolly',place:'commons:cafe',tags:[]};
 assert.deepEqual(rememberCommittedResidentEvents(life,world,[event,{...event,muse:'ghost'},{...event,muse:'01-sunny',at:now+1},{...event,muse:'01-sunny',kind:'trade_intent'}],now),life);
});
test('real SQLite restart persists memory, promises and CAS revision',()=>{
 const dir=mkdtempSync(join(tmpdir(),'musely-life-')),path=join(dir,'life.sqlite');let db=new DatabaseSync(path);
 try{let store=new ResidentLifeStore(durableSql(db));store.init();const {life}=setup();const state=recordPromise(life,'00-jolly',{id:'p',other:'01-sunny',place:'commons:campfire',dueAt:now,status:'pending',evidenceId:'agreement'});
 assert.equal(store.save('test',null,state),0);db.close();db=new DatabaseSync(path);store=new ResidentLifeStore(durableSql(db));store.init();assert.deepEqual(store.load('test'),{revision:0,state});
 assert.throws(()=>store.save('test',null,life),/stale/);assert.equal(store.save('test',0,state),1);assert.throws(()=>store.save('test',0,life),/stale/);assert.deepEqual(store.load('test').state,state);assert.equal(store.load('other'),null);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('SQL write failure rolls back prior value',()=>{
 const db=new DatabaseSync(':memory:');try{const sql=durableSql(db),store=new ResidentLifeStore(sql);store.init();const {life}=setup();store.save('test',null,life);
 const original=sql.exec;sql.exec=(q,...args)=>{const result=original(q,...args);if(q.startsWith('INSERT'))throw new Error('injected failure');return result;};
 assert.throws(()=>store.save('test',0,life),/injected/);assert.equal(store.load('test').revision,0);
 }finally{db.close();}
});
