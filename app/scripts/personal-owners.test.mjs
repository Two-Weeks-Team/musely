// Registry-only SQLite contract. No Worker route, provider, key material or world mutation is exercised.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {AgentKeys} from '../worker/core/agent-keys.ts';
import {PersonalOwners,createOwnershipAdapter} from '../worker/core/personal-owners.ts';

function storage(db) {
  let depth=0;
  return {
    sql:{exec(q,...bindings){
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(q)) throw Error('use transactionSync');
      const s=db.prepare(q);
      const rows=s.columns().length?s.all(...bindings):(s.run(...bindings),[]);
      return {toArray:()=>rows};
    }},
    transactionSync(fn){const name='personal_tx_'+depth++;db.exec('SAVEPOINT '+name);try{const value=fn();assert.ok(!value?.then,'transaction callback must be synchronous');db.exec('RELEASE '+name);return value;}catch(e){db.exec('ROLLBACK TO '+name);db.exec('RELEASE '+name);throw e;}finally{depth--;}}
  };
}
function boot(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());const owners=new PersonalOwners(storage(db));owners.init();return {db,owners};}

test('provider subject creates one stable private principal and auth version across providers/repeat logins',t=>{
  const {owners}=boot(t);
  const first=owners.ensurePrincipal({provider:'threads',subject:'synthetic-subject-A'},100);
  assert.ok(first,'verified-subject registry must create a principal');
  assert.match(first.id,/^pp_/);
  assert.equal(first.authVersion,1);
  assert.equal(first.createdAt,100);
  assert.deepEqual(owners.ensurePrincipal({provider:'threads',subject:'synthetic-subject-A'},200),first);
  assert.notEqual(owners.ensurePrincipal({provider:'another_provider',subject:'synthetic-subject-A'},200).id,first.id);
  assert.notEqual(owners.ensurePrincipal({provider:'threads',subject:'synthetic-subject-B'},200).id,first.id);
});

const identity=(owners,subject='A')=>owners.ensurePrincipal({provider:'threads',subject:'synthetic-'+subject},100);
const registration=(overrides={})=>({operationId:'registration-one',displayName:'ComBba',appearanceId:'00-jolly',agentId:'synthetic-agent-A',rootRef:'root_ref:synthetic-A',...overrides});
const code=want=>e=>e?.code===want;

test('same appearance and name still have isolated actor, principal, agent and root references',t=>{
  const {owners}=boot(t),a=identity(owners),b=identity(owners,'B');
  const first=owners.registerDraft(a.id,registration(),101);
  assert.ok(first,'registration must persist a draft actor');
  const second=owners.registerDraft(b.id,registration({agentId:'synthetic-agent-B',rootRef:'root_ref:synthetic-B'}),102);
  assert.ok(second);
  assert.notEqual(first.actorId,second.actorId);
  assert.equal(first.principalId,a.id);assert.equal(second.principalId,b.id);
  assert.equal(first.controlMode,'personal');assert.equal(first.status,'draft');
  const own=createOwnershipAdapter(owners);
  assert.equal(own.ownerOf(first.actorId),a.id);assert.equal(own.owns(a.id,first.actorId),true);assert.equal(own.owns(a.id,second.actorId),false);
  assert.equal(own.owns(b.id,first.actorId),false);
});

test('same operation and body returns the original actor, while changed input or a second operation conflicts',t=>{
  const {owners,db}=boot(t),a=identity(owners),input=registration();
  const first=owners.registerDraft(a.id,input,101);assert.ok(first);
  assert.deepEqual(owners.registerDraft(a.id,{...input},999),first);
  assert.throws(()=>owners.registerDraft(a.id,registration({displayName:'Another'}),102),code('operation_conflict'));
  assert.throws(()=>owners.registerDraft(a.id,registration({operationId:'new-operation'}),102),code('actor_exists'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM personal_actors').get().n,1);
});

test('one agent or root reference cannot be registered to a different owner, without partial rows',t=>{
  const {owners,db}=boot(t),a=identity(owners),b=identity(owners,'B');
  assert.ok(owners.registerDraft(a.id,registration(),101));
  for(const input of [registration({rootRef:'root_ref:B'}),registration({agentId:'synthetic-agent-B'})]){
    assert.throws(()=>owners.registerDraft(b.id,input,102),code('binding_conflict'));
    assert.equal(owners.actorForPrincipal(b.id),null);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM personal_profiles').get().n,1);
});

test('profile projection contains public fields only and caller mutation cannot rewrite persistence',t=>{
  const {owners}=boot(t),a=identity(owners);
  const actor=owners.registerDraft(a.id,registration({displayName:'  ComBba  '}),101);assert.ok(actor);
  const profile=owners.profile(actor.actorId);
  assert.deepEqual(profile,{actorId:actor.actorId,displayName:'ComBba',appearanceId:'00-jolly',revision:1});
  assert.deepEqual(Object.keys(profile).sort(),['actorId','appearanceId','displayName','revision']);
  assert.doesNotMatch(JSON.stringify(profile),/synthetic-|principal|provider|subject|rootRef|agentId/);
  profile.displayName='changed in memory';
  assert.equal(owners.profile(actor.actorId).displayName,'ComBba');
});

test('unknown actors are tagged unknown and cannot fall through to resident/RULE ownership',t=>{
  const {owners}=boot(t),own=createOwnershipAdapter(owners);
  assert.deepEqual(own.resolve('pm_not_registered'),{kind:'unknown',actorId:'pm_not_registered'});
  assert.throws(()=>own.ownerOf('pm_not_registered'),code('unknown_actor'));
  assert.equal(own.owns('owner','pm_not_registered'),false);
  assert.deepEqual(own.resolve('01-sunny'),{kind:'resident',actorId:'01-sunny'});
  assert.equal(own.ownerOf('01-sunny'),null);
});

test('fixed three legacy principal mappings remain exact and cannot be claimed by new registrations',t=>{
  const {owners}=boot(t),own=createOwnershipAdapter(owners);
  for(const [principalId,ownerId,actorId] of [['owner','owner:kim-sejun','00-jolly'],['demo-peer','system:demo-peer','09-copper'],['reviewer','system:reviewer','04-ember']]){
    assert.deepEqual(own.resolve(actorId),{kind:'legacy',actorId,principalId,ownerId});
    assert.equal(own.ownerOf(actorId),ownerId);assert.equal(own.owns(principalId,actorId),true);
    assert.equal(own.owns('arbitrary-new-owner',actorId),false);
  }
  const a=identity(owners);const actor=owners.registerDraft(a.id,registration(),101);assert.ok(actor);
  assert.notEqual(actor.actorId,'00-jolly');assert.equal(own.owns(a.id,'00-jolly'),false);
});

test('auth version changes and key metadata revocation never delete durable ownership',t=>{
  const {owners,db}=boot(t),a=identity(owners),actor=owners.registerDraft(a.id,registration(),101);assert.ok(actor);
  const own=createOwnershipAdapter(owners);
  assert.equal(owners.advanceAuthVersion(a.id,1).authVersion,2);
  assert.throws(()=>owners.advanceAuthVersion(a.id,1),code('auth_version_conflict'));
  // Synthetic metadata row only: no bearer is generated or supplied. Exercise the real existing revocation store.
  const keys=new AgentKeys(storage(db).sql);keys.init();
  db.prepare('INSERT INTO agent_keys (id, hash, muse, signer_kind, created_at) VALUES (?, ?, ?, ?, ?)').run('ak_synthetic','0'.repeat(64),actor.actorId,'server_custodial',0);
  assert.equal(keys.revoke('ak_synthetic',999).revokedAt,999);
  assert.equal(own.ownerOf(actor.actorId),a.id);assert.equal(own.owns(a.id,actor.actorId),true);
  assert.equal(owners.principal(a.id).authVersion,2);
});

test('registration rollback leaves no actor, profile or operation after a real SQLite insert failure',t=>{
  const {owners,db}=boot(t),a=identity(owners);
  // Force failure after actor insert, rather than mocking the store or its result.
  db.exec("CREATE TRIGGER fail_profile BEFORE INSERT ON personal_profiles BEGIN SELECT RAISE(ABORT, 'synthetic-db-failure'); END");
  assert.throws(()=>owners.registerDraft(a.id,registration(),101));
  for(const table of ['personal_actors','personal_profiles','personal_registrations'])assert.equal(db.prepare('SELECT count(*) AS n FROM '+table).get().n,0);
  assert.ok(owners.principal(a.id));
  db.exec('DROP TRIGGER fail_profile');assert.ok(owners.registerDraft(a.id,registration(),102));
});

test('invalid subject, unknown principal, malformed profile and raw credential references never persist',t=>{
  const {owners,db}=boot(t),a=identity(owners);
  for(const subject of ['', ' leading', 'x'.repeat(257)])assert.throws(()=>owners.ensurePrincipal({provider:'threads',subject}),code('invalid_identity'));
  assert.throws(()=>owners.ensurePrincipal({provider:'',subject:'A'}),code('invalid_identity'));
  assert.throws(()=>owners.registerDraft('pp_absent',registration(),101),code('unknown_principal'));
  for(const change of [{operationId:''},{displayName:''},{displayName:'x'.repeat(41)},{displayName:'hello\u202E'},{appearanceId:'unknown-asset'},{rootRef:'msly_not_a_reference'},{agentId:'msly_not_a_reference'}])assert.throws(()=>owners.registerDraft(a.id,registration(change),101),code('invalid_registration'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM personal_actors').get().n,0);
});

test('reopening the SQLite file and initializing twice preserve IDs, auth version and unrelated legacy rows',t=>{
  const dir=mkdtempSync(join(tmpdir(),'musely-personal-owners-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'registry.sqlite');
  let db=new DatabaseSync(file),owners=new PersonalOwners(storage(db));owners.init();const a=identity(owners),actor=owners.registerDraft(a.id,registration(),101);assert.ok(actor);
  owners.advanceAuthVersion(a.id,1);
  db.exec("CREATE TABLE legacy_sentinel (body TEXT); INSERT INTO legacy_sentinel VALUES ('paused/revoked/original-run-hash')");
  const before={actor:owners.actor(actor.actorId),profile:owners.profile(actor.actorId),principal:owners.principal(a.id)};db.close();
  db=new DatabaseSync(file);t.after(()=>db.close());owners=new PersonalOwners(storage(db));owners.init();owners.init();
  assert.deepEqual({actor:owners.actor(actor.actorId),profile:owners.profile(actor.actorId),principal:owners.principal(a.id)},before);
  assert.deepEqual(owners.registerDraft(a.id,registration(),999),actor);
  assert.equal(db.prepare('SELECT body FROM legacy_sentinel').get().body,'paused/revoked/original-run-hash');
});

async function simultaneous(file,principalId,inputs){
  const barrier=new SharedArrayBuffer(4),flag=new Int32Array(barrier);
  const source=`const {parentPort,workerData}=require('node:worker_threads'); const {DatabaseSync}=require('node:sqlite'); const assert=require('node:assert/strict');
  (async()=>{const {PersonalOwners}=await import(workerData.module);const db=new DatabaseSync(workerData.file);db.exec('PRAGMA busy_timeout=5000');
  const base=(${storage.toString()})(db);const st={sql:base.sql,transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const owners=new PersonalOwners(st);parentPort.postMessage({ready:true});Atomics.wait(new Int32Array(workerData.barrier),0,0);
  try{parentPort.postMessage({result:owners.registerDraft(workerData.principalId,workerData.input,101)});}catch(e){parentPort.postMessage({error:e.code??'unexpected'});}finally{db.close();}})().catch(e=>{throw e});`;
  let ready=0;
  return await Promise.all(inputs.map(input=>new Promise((resolve,reject)=>{
    const w=new Worker(source,{eval:true,workerData:{module:new URL('../worker/core/personal-owners.ts',import.meta.url).href,file,principalId,input,barrier}});
    w.on('error',reject);let result;
    w.on('message',m=>{if(m.ready){if(++ready===inputs.length){Atomics.store(flag,0,1);Atomics.notify(flag,0);}}else result=m;});
    w.on('exit',exit=>exit?reject(Error('synthetic worker exit '+exit)):resolve(result));
  })));
}
for(const sameOperation of [true,false])test('two real SQLite connections '+(sameOperation?'share one idempotent operation':'conflict on a second actor for the same principal'),async t=>{
  const dir=mkdtempSync(join(tmpdir(),'musely-personal-race-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'registry.sqlite');
  const db=new DatabaseSync(file);t.after(()=>db.close());const owners=new PersonalOwners(storage(db));owners.init();const a=identity(owners);
  const outcomes=await simultaneous(file,a.id,[registration(),registration({operationId:sameOperation?'registration-one':'second-operation'})]);
  if(sameOperation){assert.ok(outcomes.every(x=>x.result));assert.equal(outcomes[0].result.actorId,outcomes[1].result.actorId);}
  else {assert.equal(outcomes.filter(x=>x.result).length,1);assert.equal(outcomes.find(x=>x.error)?.error,'actor_exists');}
  assert.equal(db.prepare('SELECT count(*) AS n FROM personal_actors').get().n,1);assert.equal(db.prepare('SELECT count(*) AS n FROM personal_profiles').get().n,1);
});


test('internal registration refuses caller-selected identity, claim verdict and private material fields',t=>{
  const {owners}=boot(t),a=identity(owners);
  for(const change of [{actorId:'00-jolly'},{principalId:'owner'},{claimed:true},{rootJwk:{private:'synthetic-only'}},{key:'synthetic-only'}]){
    assert.throws(()=>owners.registerDraft(a.id,registration(change),101),code('invalid_registration'));
  }
  const actor=owners.registerDraft(a.id,registration(),101);
  assert.equal('claim' in actor,false);assert.equal('key' in actor,false);
});

test('auth version update rejects absent principals and exhaustion without resetting version/ownership',t=>{
  const {owners,db}=boot(t),a=identity(owners);
  assert.throws(()=>owners.advanceAuthVersion('pp_absent',1),code('unknown_principal'));
  assert.throws(()=>owners.advanceAuthVersion(a.id,NaN),code('auth_version_conflict'));
  db.prepare('UPDATE personal_principals SET auth_version = ? WHERE id = ?').run(Number.MAX_SAFE_INTEGER,a.id);
  assert.throws(()=>owners.advanceAuthVersion(a.id,Number.MAX_SAFE_INTEGER),code('auth_version_exhausted'));
  assert.equal(owners.principal(a.id).authVersion,Number.MAX_SAFE_INTEGER);
});
