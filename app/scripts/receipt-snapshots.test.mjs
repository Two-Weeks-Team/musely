// Receipt-only evidence over actual SQLite. No archive expansion, HTTP, keys, provider or model calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ReceiptSnapshots} from '../worker/core/receipt-snapshots.ts';
import {createWorld} from '../src/engine/world.ts';
import {snapshotBody,bodyHash,PRIVATE} from '../worker/core/run-log.ts';
import {MAX_REPLAY_SNAPSHOT_BYTES} from '../src/replay/versions.ts';
const code=c=>e=>e?.code===c&&e.message===c;
function setup(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());const sql={exec(q,...b){const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};}};const store=new ReceiptSnapshots(sql);store.init();return{db,store};}
function fixture(kind='legacy_adoption'){
 const s=createWorld('receipt-test',1_000_000),m=s.muses.find(m=>m.id==='00-jolly');if(kind==='personal_entry')m.id='pm_12345678-1234-4234-8234-123456789abc';m.profile={actorId:m.id,displayName:'ComBba',appearanceId:'00-jolly',revision:1};
 const b={kind,actorId:m.id,worldId:s.worldId,runId:'run-1-test',inputSeq:1,eventId:'2026-11-04:0:receipt-test:1',afterHash:bodyHash(snapshotBody(s))};return{s,b,m};
}
const count=a=>a.db.prepare('SELECT count(*) n FROM receipt_snapshots').get().n;
test('put stores exact existing public snapshot, read returns it without writes; restart/retry are idempotent',t=>{
 const a=setup(t),{s,b}=fixture(),body=snapshotBody(s);assert.equal(a.store.read(b),null);assert.equal(a.store.put(b,s),body);assert.equal(a.store.read(b),body);const before=a.db.prepare('SELECT * FROM receipt_snapshots').all();assert.equal(a.store.put(b,s),body);assert.deepEqual(a.db.prepare('SELECT * FROM receipt_snapshots').all(),before);const again=new ReceiptSnapshots({exec(q,...v){const st=a.db.prepare(q);return{toArray:()=>st.all(...v)};}});assert.equal(again.read(b),body);assert.equal(count(a),1);
});
test('private location/conditions/reasons/unknown credentials are never stored, public free text uses original hashes',t=>{
 const a=setup(t),{s,b,m}=fixture();s.secret='PRIVATE_UNKNOWN_TOKEN';s.owner={source:'gps',muse:m.id,verified:true,setAt:1_000_000,cell:'PRIVATE_CELL',preset:'PRIVATE_PRESET',target:{lat:'PRIVATE_LAT'},area:'PRIVATE_AREA'};m.anchor='PRIVATE_ANCHOR';m.reflection='PRIVATE_REFLECTION';m.memory=['PRIVATE_MEMORY'];m.wants.goal='PRIVATE_GOAL';m.beat={id:'read',clip:'idle',startedAt:1,endsAt:2,line:'PRIVATE_SPEECH'};
 s.inbox.tasks.push({id:'task_a',kind:'meetup',from:m.id,to:'02-moss',status:'pending',awaiting:null,createdAt:1,deadline:2,updatedAt:1,round:0,history:[],candidate:{time:'PRIVATE_TIME',place:'PRIVATE_PLACE',public_basis:'PRIVATE_CONDITION'},candidates:[{private:'PRIVATE_CONDITION'}],approvals:{private:'PRIVATE_REASON'},owners:{private:'PRIVATE_OWNER'},confirmed:{private:'PRIVATE_CONFIRMED'}});s.inbox.notifications.push({id:'n',kind:'blocked',at:1,line:'PRIVATE_REASON',ref:null,other:null,detail:{token:'PRIVATE_DETAIL'}});
 b.afterHash=bodyHash(snapshotBody(s));const body=a.store.put(b,s);assert.equal(body,snapshotBody(s));assert.doesNotMatch(body,/PRIVATE_/);const publicState=JSON.parse(body);assert.equal(publicState.owner.cell,PRIVATE);assert.match(publicState.muses.find(x=>x.id===m.id).reflection,/^text-sha256:/);assert.equal(a.store.read(b),body);assert.doesNotMatch(JSON.stringify(a.db.prepare('SELECT * FROM receipt_snapshots').all()),/PRIVATE_/);
});
for(const kind of ['personal_entry','legacy_adoption'])test('supports exact '+kind+' membership/profile binding',t=>{const a=setup(t),{s,b}=fixture(kind);assert.equal(a.store.read(b),null);assert.equal(a.store.read({...b,kind:kind==='personal_entry'?'legacy_adoption':'personal_entry'}),null);a.store.put(b,s);assert.equal(a.store.read(b),snapshotBody(s));});
for(const field of ['kind','actorId','worldId','runId','inputSeq','eventId','afterHash'])test('cross-binding '+field+' read is null and same-event different tuple is refused',t=>{
 const a=setup(t),{s,b}=fixture();a.store.put(b,s);const other={...b,[field]:field==='kind'?'personal_entry':field==='actorId'?'02-moss':field==='inputSeq'?2:field==='afterHash'?'a'.repeat(64):'different'};assert.equal(a.store.read(other),null);if(field!=='eventId')assert.throws(()=>a.store.put(other,s));assert.equal(count(a),1);
});
for(const bad of ['body','kind','actor_id','world_id','run_id','input_seq','after_hash'])test('in-place '+bad+' corruption is never returned or overwritten',t=>{
 const a=setup(t),{s,b}=fixture();a.store.put(b,s);a.db.prepare('UPDATE receipt_snapshots SET '+bad+'=?').run(bad==='input_seq'?999:'CORRUPTION');assert.equal(a.store.read(b),null);assert.throws(()=>a.store.put(b,s),code('receipt_snapshot_conflict'));assert.equal(count(a),1);
});
for(const change of ['missing','duplicate','profile','world','hash','oversize'])test('invalid '+change+' proof fails before any row is inserted',t=>{
 const a=setup(t),{s,b,m}=fixture();if(change==='missing')s.muses=s.muses.filter(x=>x.id!==m.id);if(change==='duplicate')s.muses.push(structuredClone(m));if(change==='profile')m.profile.actorId='02-moss';if(change==='world')s.worldId='other';if(change==='oversize')m.inventory=['🧭'.repeat(MAX_REPLAY_SNAPSHOT_BYTES/3)];if(change!=='hash')b.afterHash=bodyHash(snapshotBody(s));else b.afterHash='a'.repeat(64);assert.throws(()=>a.store.put(b,s),code('receipt_snapshot_invalid'));assert.equal(count(a),0);assert.equal(a.store.read(b),null);
});
test('external SQL rollback removes new evidence; no implicit independent commit',t=>{
 const a=setup(t),{s,b}=fixture();a.db.exec('BEGIN');a.store.put(b,s);assert.equal(count(a),1);a.db.exec('ROLLBACK');assert.equal(count(a),0);assert.equal(a.store.read(b),null);
});
test('SQL failure is a fixed error without raw diagnostic text',t=>{
 const a=setup(t),{s,b}=fixture();a.db.exec("CREATE TEMP TRIGGER reject_snapshot BEFORE INSERT ON receipt_snapshots BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_CANARY'); END");assert.throws(()=>a.store.put(b,s),code('receipt_snapshot_unavailable'));assert.equal(count(a),0);
});
test('read rejects an actually stored oversized UTF-8 body even with matching hash and tuple',t=>{
 const a=setup(t),{s,b,m}=fixture();m.inventory=['🧭'.repeat(MAX_REPLAY_SNAPSHOT_BYTES/3)];const body=snapshotBody(s);b.afterHash=bodyHash(body);a.db.prepare('INSERT INTO receipt_snapshots(kind,actor_id,world_id,run_id,input_seq,event_id,after_hash,body) VALUES(?,?,?,?,?,?,?,?)').run(b.kind,b.actorId,b.worldId,b.runId,b.inputSeq,b.eventId,b.afterHash,body);assert.ok(new TextEncoder().encode(body).byteLength>MAX_REPLAY_SNAPSHOT_BYTES);assert.equal(a.store.read(b),null);
});
