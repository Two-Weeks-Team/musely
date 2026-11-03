// All sessions, actors and cryptographic material are synthetic, isolated native SQLite fixtures.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PersonalAuthStore,personalDigest,personalNonce} from '../worker/core/personal-session.ts';
import {PersonalRegistration} from '../worker/core/personal-registration.ts';
import {PersonalAuthority} from '../worker/core/personal-authority.ts';
import {hashAgentKey,looksLikeAgentKey,AgentKeys} from '../worker/core/agent-keys.ts';
import {Trust} from '../worker/core/trust.ts';
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
async function boot(t,options={}) {
 const db=new DatabaseSync(options.database??':memory:');let closed=false;t.after(()=>{if(!closed)db.close();});let depth=0,clock=1_000_000;
 const storage={sql:{exec(q,...b){const s=db.prepare(q),r=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>r};}},transactionSync(fn){const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const x=fn();assert.ok(!x?.then);db.exec('RELEASE '+n);return x;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}}};
 const auth=new PersonalAuthStore(storage);auth.init();const registration=new PersonalRegistration(storage,auth,{now:()=>clock});registration.init();const service=new PersonalAuthority(storage,auth,{now:()=>clock,...options});service.init();
 const binding=async(subject='42')=>{const flow={stateDigest:await personalDigest('state',personalNonce()),browserDigest:await personalDigest('browser',personalNonce()),appId:'123',redirectUri:'https://musely.net/api/threads/callback',createdAt:clock,expiresAt:clock+600000};assert.ok(auth.begin(flow));assert.ok(auth.consume(flow,clock));const sidDigest=await personalDigest('sid',personalNonce()),proof=auth.complete(flow.stateDigest,'123',subject,sidDigest,clock);return{sidDigest,proof,appId:'123'};};
 const draft=async(subject='42')=>{const b=await binding(subject);const p=await registration.register(b,{operationId:'draft',displayName:'Same name',appearanceId:'00-jolly'});return{b,p};};
 return{db,storage,auth,registration,service,binding,draft,setClock:n=>clock=n,close:()=>{db.close();closed=true;}};
}
const code=c=>e=>e?.code===c;
const grant=(a,b,expectedVersion=0,scopes=['walk_and_greet'])=>a.service.grant(b,{expectedVersion,scopes});
const issue=(a,b,operationId='issue-one',expectedVersion=1)=>a.service.issueKey(b,{operationId,expectedVersion});
const count=(a,table)=>a.db.prepare('SELECT count(*) n FROM '+table).get().n;
const rows=a=>a.db.prepare('SELECT * FROM personal_authority_keys').all();
const rootRows=a=>a.db.prepare('SELECT * FROM personal_actor_roots ORDER BY actor_id').all();

test('own authority is explicit and default-denied; unknown differs from known resident',async t=>{
 const a=await boot(t),{b,p}=await a.draft();const own=await a.service.own(b);assert.equal(own.actorId,p.actorId);assert.equal(own.version,0);assert.equal(own.active,false);assert.deepEqual(own.scopes,[]);assert.deepEqual(a.service.resolve('missing'),{kind:'unknown',actorId:'missing'});assert.equal(a.service.resolve('01-sunny').kind,'resident');assert.equal(a.service.resolve('00-jolly').kind,'legacy');assert.equal(a.service.resolve(p.actorId).kind,'personal');await assert.rejects(issue(a,b),code('authority_required'));assert.equal(count(a,'personal_authority_keys'),0);
});
test('explicit scope grant and one-time key return persist only a hash; retry is metadata-only',async t=>{
 const a=await boot(t),{b,p}=await a.draft();const before=rootRows(a);const g=await grant(a,b);assert.equal(g.version,1);const first=await issue(a,b);assert.equal(first.status,'issued');assert.ok(looksLikeAgentKey(first.key));const retry=await issue(a,b);assert.equal(retry.status,'already_issued');assert.equal(Object.hasOwn(retry,'key'),false);assert.equal(retry.row.id,first.row.id);assert.equal(rows(a).length,1);assert.equal(rows(a)[0].hash,await hashAgentKey(first.key));assert.doesNotMatch(JSON.stringify(rows(a)),/msly_/);const authorization=await a.service.authorizeKey(await hashAgentKey(first.key),'walk_and_greet');assert.equal(authorization.actorId,p.actorId);assert.equal(authorization.agentId,a.auth.owners.actor(p.actorId).agentId);assert.equal(await a.service.authorizeKey(await hashAgentKey(first.key),'world_item_gift'),null);assert.deepEqual(rootRows(a),before);assert.doesNotMatch(JSON.stringify(a.service.listKeys(b)),/private|jwk|rootRef|principal|hash|msly_/);
});
test('same name and appearance do not grant cross-principal key or root authority',async t=>{
 const a=await boot(t),x=await a.draft(),y=await a.draft('99');await grant(a,x.b);await grant(a,y.b);const first=await issue(a,x.b);assert.deepEqual(a.service.listKeys(y.b),[]);assert.throws(()=>a.service.revokeKey(y.b,first.row.id),code('key_not_found'));const forged={...y.b,proof:{...y.b.proof,principalId:x.b.proof.principalId}};await assert.rejects(issue(a,forged),code('personal_session_required'));const auth=await a.service.authorizeKey(await hashAgentKey(first.key),'walk_and_greet');assert.equal(auth.actorId,x.p.actorId);assert.notEqual((await a.service.own(y.b)).agentId,auth.agentId);
});

test('authority revoke is durable before keys exist, regrant never rebinds an old key',async t=>{
 const a=await boot(t),{b}=await a.draft();await grant(a,b);const first=await issue(a,b);const h=await hashAgentKey(first.key);const revoked=a.service.revokeAuthority(b,1);assert.equal(revoked.active,false);assert.equal(revoked.version,2);assert.equal(await a.service.authorizeKey(h,'walk_and_greet'),null);await assert.rejects(issue(a,b,'after-revoke',2),code('authority_required'));await grant(a,b,2);assert.equal(await a.service.authorizeKey(h,'walk_and_greet'),null);const retried=await issue(a,b);assert.equal(retried.row.id,first.row.id);assert.equal(Object.hasOwn(retried,'key'),false);assert.equal(rows(a)[0].grant_version,1);const second=await issue(a,b,'new-explicit-operation',3);assert.equal((await a.service.authorizeKey(await hashAgentKey(second.key),'walk_and_greet')).version,3);
});
test('revoke before any key and repeated init preserve the suspension',async t=>{
 const a=await boot(t),{b}=await a.draft();await grant(a,b);a.service.revokeAuthority(b,1);const reopened=new PersonalAuthority(a.storage,a.auth,{now:()=>1000000});reopened.init();reopened.init();assert.equal((await reopened.own(b)).active,false);await assert.rejects(reopened.issueKey(b,{operationId:'blocked',expectedVersion:2}),code('authority_required'));assert.equal(rows(a).length,0);
});
test('key revoke is isolated, idempotent, and a lost issue response cannot resurrect it',async t=>{
 const a=await boot(t),{b}=await a.draft();await grant(a,b);const one=await issue(a,b),two=await issue(a,b,'second');a.service.revokeKey(b,one.row.id);const before=a.service.listKeys(b);a.setClock(1000100);a.service.revokeKey(b,one.row.id);assert.deepEqual(a.service.listKeys(b),before);assert.equal(await a.service.authorizeKey(await hashAgentKey(one.key),'walk_and_greet'),null);assert.ok(await a.service.authorizeKey(await hashAgentKey(two.key),'walk_and_greet'));assert.equal((await issue(a,b)).status,'already_issued');assert.equal(rows(a).length,2);
});
for(const phase of ['generation','hash'])for(const mode of ['logout','expiry','authVersion','authority','root-change'])test(phase+' await rechecks '+mode+' without orphan key or operation',async t=>{
 const entered=deferred(),release=deferred();const options=phase==='generation'?{generateKey:async()=>{entered.resolve();await release.promise;return 'msly_'+'s'.repeat(43);}}:{hashKey:async k=>{entered.resolve();await release.promise;return hashAgentKey(k);}};
 const a=await boot(t,options),{b,p}=await a.draft();await grant(a,b);const pending=issue(a,b);await entered.promise;
 if(mode==='logout')a.auth.revoke(b.sidDigest,b.proof,b.appId,1000000);
 if(mode==='expiry')a.setClock(b.proof.expiresAt);
 if(mode==='authVersion')a.auth.owners.advanceAuthVersion(b.proof.principalId,b.proof.authVersion);
 if(mode==='authority')a.service.revokeAuthority(b,1);
 if(mode==='root-change')a.db.prepare('UPDATE personal_actors SET root_ref=? WHERE actor_id=?').run('root_ref:changed',p.actorId);
 release.resolve();await assert.rejects(pending,e=>['personal_session_required','authority_required','authority_changed','authority_incomplete'].includes(e.code));assert.equal(rows(a).length,0);assert.equal(count(a,'personal_authority_key_operations'),0);
});

test('same-operation concurrent generation has exactly one raw winner and one durable result',async t=>{
 let n=0;const entered=deferred(),release=deferred();const a=await boot(t,{generateKey:async()=>{if(++n===2)entered.resolve();await release.promise;return 'msly_'+(n===2?'a':'b').repeat(43);}}),{b}=await a.draft();await grant(a,b);const x=issue(a,b),y=issue(a,b);await entered.promise;release.resolve();const result=await Promise.all([x,y]);assert.deepEqual(result.map(x=>x.status).sort(),['already_issued','issued']);assert.equal(result[0].row.id,result[1].row.id);assert.equal(rows(a).length,1);assert.equal(count(a,'personal_authority_key_operations'),1);
});

test('changed issue intent is refused without generating another key',async t=>{
 let generated=0;const a=await boot(t,{generateKey:async()=>{generated++;return 'msly_'+'a'.repeat(43);}}),{b}=await a.draft();await grant(a,b);await issue(a,b);await grant(a,b,1);await assert.rejects(issue(a,b,'issue-one',2),code('operation_conflict'));assert.equal(generated,1);assert.equal(rows(a).length,1);
});

test('session logout does not erase ownership, mutate grant or silently revoke an explicit key',async t=>{
 const a=await boot(t),{b,p}=await a.draft();await grant(a,b);const first=await issue(a,b);a.auth.revoke(b.sidDigest,b.proof,b.appId,1000000);assert.equal(a.service.resolve(p.actorId).kind,'personal');assert.ok(await a.service.authorizeKey(await hashAgentKey(first.key),'walk_and_greet'));assert.throws(()=>a.service.listKeys(b),code('personal_session_required'));const fresh=await a.binding();assert.equal(a.service.listKeys(fresh).length,1);
});

test('profile changes never change the immutable actor/root/grant/key binding',async t=>{
 const a=await boot(t),{b}=await a.draft();await grant(a,b);const first=await issue(a,b),before=rootRows(a),stored=rows(a);a.registration.patch(b,{expectedRevision:1,displayName:'Changed',appearanceId:'03-ripple'});assert.deepEqual(rootRows(a),before);assert.deepEqual(rows(a),stored);assert.ok(await a.service.authorizeKey(await hashAgentKey(first.key),'walk_and_greet'));
});

test('scope validation is explicit: forbidden, unknown, duplicate, omitted or empty scopes never grant',async t=>{
 const a=await boot(t),{b}=await a.draft();for(const scopes of [[],['unknown'],['payment'],['walk_and_greet','walk_and_greet'],null])await assert.rejects(a.service.grant(b,{expectedVersion:0,scopes}),code('invalid_authority'));assert.equal((await a.service.own(b)).version,0);await assert.rejects(a.service.grant(b,{expectedVersion:0,scopes:['walk_and_greet'],claimed:true}),code('invalid_authority'));const g=await grant(a,b);await assert.rejects(grant(a,b),code('authority_conflict'));assert.equal(g.scopes.length,1);
});

test('wrong, missing or corrupted roots fail closed without generating a bearer or touching a global root',async t=>{
 for(const mode of ['missing','agent','private','public','keypair']){let generated=0;const a=await boot(t,{generateKey:async()=>{generated++;throw Error('must not generate');}}),{b,p}=await a.draft();await grant(a,b);if(mode==='missing')a.db.prepare('DELETE FROM personal_actor_roots').run();if(mode==='agent')a.db.prepare('UPDATE personal_actor_roots SET agent_id=?').run('wrong');if(mode==='private')a.db.prepare('UPDATE personal_actor_roots SET private_jwk=?').run('private-invalid');if(mode==='public')a.db.prepare('UPDATE personal_actor_roots SET public_jwk=?').run('{}');if(mode==='keypair'){const y=await a.draft('99'),other=a.db.prepare('SELECT private_jwk FROM personal_actor_roots WHERE actor_id=?').get(y.p.actorId);a.db.prepare('UPDATE personal_actor_roots SET private_jwk=? WHERE actor_id=?').run(other.private_jwk,p.actorId);}await assert.rejects(issue(a,b),code('authority_incomplete'));assert.equal(generated,0);assert.equal(rows(a).length,0);}
});

test('SQL operation insert failure rolls back a prepared key and permits only an explicit retry',async t=>{
 const a=await boot(t),{b}=await a.draft();await grant(a,b);const orig=a.storage.sql.exec;a.storage.sql.exec=(q,...args)=>{if(q.startsWith('INSERT INTO personal_authority_key_operations'))throw Error('synthetic SQL failure');return orig(q,...args);};await assert.rejects(issue(a,b));assert.equal(rows(a).length,0);assert.equal(count(a,'personal_authority_key_operations'),0);a.storage.sql.exec=orig;assert.equal((await issue(a,b)).status,'issued');
});

test('key generation and hashing failures never persist or leak raw failure text through error codes',async t=>{
 for(const options of [{generateKey:async()=>{throw Error('SYNTHETIC_PRIVATE_FAILURE');}},{generateKey:async()=> 'invalid'}, {hashKey:async()=>{throw Error('SYNTHETIC_PRIVATE_FAILURE');}},{hashKey:async()=> 'bad'}]){const a=await boot(t,options),{b}=await a.draft();await grant(a,b);await assert.rejects(issue(a,b),e=>e.code==='key_generation_failed'&&!e.message.includes('SYNTHETIC_PRIVATE_FAILURE'));assert.equal(rows(a).length,0);}
});

test('legacy Trust and agent keys remain byte-identical; no legacy key is accepted as personal',async t=>{
 const a=await boot(t),trust=new Trust(a.storage.sql),legacy=new AgentKeys(a.storage.sql);trust.init();legacy.init();a.storage.sql.exec('INSERT INTO agent_keys (id,hash,muse,signer_kind,created_at) VALUES (?,?,?,?,?)','ak_existing','e'.repeat(64),'00-jolly','server_custodial',500);a.storage.sql.exec('INSERT INTO private_keys (kid,jwk) VALUES (?,?)','legacy-synthetic-root','synthetic-private-marker');const dump=()=>JSON.stringify(['agent_keys','agents','private_keys','delegation_versions','delegated','executors'].map(table=>a.db.prepare('SELECT * FROM '+table).all()));const before=dump();const {b}=await a.draft();await grant(a,b);const key=await issue(a,b);a.service.revokeKey(b,key.row.id);a.service.revokeAuthority(b,1);a.service.init();assert.equal(dump(),before);assert.equal(await a.service.authorizeKey('e'.repeat(64),'walk_and_greet'),null);
});

test('revoke during async authorization suppresses its result, including a previously authorized hash',async t=>{
 const a=await boot(t),{b}=await a.draft();await grant(a,b);const key=await issue(a,b),hash=await hashAgentKey(key.key);assert.ok(await a.service.authorizeKey(hash,'walk_and_greet'));const pending=a.service.authorizeKey(hash,'walk_and_greet');a.service.revokeKey(b,key.row.id);assert.equal(await pending,null);
});
test('concurrent grants perform version CAS and scope changes cannot widen an existing key',async t=>{
 const a=await boot(t),{b}=await a.draft();const done=await Promise.allSettled([grant(a,b),grant(a,b,0,['world_item_gift'])]);assert.equal(done.filter(x=>x.status==='fulfilled').length,1);assert.equal(done.find(x=>x.status==='rejected').reason.code,'authority_conflict');const current=await a.service.own(b),key=await issue(a,b);await grant(a,b,1,['world_item_gift','walk_and_greet']);assert.equal(await a.service.authorizeKey(await hashAgentKey(key.key),current.scopes[0]),null);assert.equal(rows(a)[0].grant_version,1);
});
test('input mutation during awaits cannot change the approved issue operation or grant scopes',async t=>{
 const entered=deferred(),release=deferred();const a=await boot(t,{generateKey:async()=>{entered.resolve();await release.promise;return 'msly_'+'a'.repeat(43);}}),{b}=await a.draft();const input={expectedVersion:0,scopes:['walk_and_greet']},pendingGrant=a.service.grant(b,input);input.scopes[0]='world_item_gift';input.expectedVersion=10;assert.deepEqual((await pendingGrant).scopes,['walk_and_greet']);const op={operationId:'stable',expectedVersion:1},pending=a.service.issueKey(b,op);await entered.promise;op.operationId='changed';op.expectedVersion=20;release.resolve();const first=await pending;const retry=await issue(a,b,'stable');assert.equal(retry.row.id,first.row.id);assert.equal(count(a,'personal_authority_key_operations'),1);
});
test('unknown actor ownership never falls into automatic resident approval even after logout',async t=>{
 const a=await boot(t),{b,p}=await a.draft();a.auth.revoke(b.sidDigest,b.proof,b.appId,1000000);assert.deepEqual(a.service.resolve('pm_missing'),{kind:'unknown',actorId:'pm_missing'});assert.equal(a.service.resolve(p.actorId).kind,'personal');assert.equal(a.service.resolve('04-ember').kind,'legacy');
});


test('physical SQLite close/reopen and repeated init preserve hashes, operations, roots and explicit suspension',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'musely-personal-authority-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const database=join(dir,'synthetic.sqlite'),a=await boot(t,{database}),{b}=await a.draft();await grant(a,b);const first=await issue(a,b);a.service.revokeAuthority(b,1);const before={keys:rows(a),roots:rootRows(a),ops:a.db.prepare('SELECT * FROM personal_authority_key_operations').all()};a.close();const reopened=await boot(t,{database});reopened.service.init();assert.deepEqual(rows(reopened),before.keys);assert.deepEqual(rootRows(reopened),before.roots);assert.deepEqual(reopened.db.prepare('SELECT * FROM personal_authority_key_operations').all(),before.ops);assert.equal((await reopened.service.own(b)).active,false);assert.equal((await issue(reopened,b)).status,'already_issued');assert.equal(await reopened.service.authorizeKey(await hashAgentKey(first.key),'walk_and_greet'),null);reopened.close();
});

test('synchronous own-key snapshot is usable inside the entry transaction and fails closed on foreign/stale/revoked bindings',async t=>{
 const a=await boot(t),x=await a.draft(),y=await a.draft('99');await grant(a,x.b);await grant(a,y.b);const first=await issue(a,x.b);const snapshot=a.storage.transactionSync(()=>a.service.currentOwnKey(x.b,first.row.id,'walk_and_greet'));assert.equal(snapshot.authority.actorId,x.p.actorId);assert.equal(snapshot.authority.version,1);assert.equal(snapshot.key.id,first.row.id);assert.doesNotMatch(JSON.stringify(snapshot),/private|jwk|hash|msly_/);assert.equal(a.service.currentOwnKey(y.b,first.row.id,'walk_and_greet'),null);assert.equal(a.service.currentOwnKey(x.b,first.row.id,'world_item_gift'),null);assert.equal(a.service.currentOwnKey(x.b,'unknown','walk_and_greet'),null);await grant(a,x.b,1);assert.equal(a.service.currentOwnKey(x.b,first.row.id,'walk_and_greet'),null);const next=await issue(a,x.b,'explicit-second',2);a.service.revokeKey(x.b,next.row.id);assert.equal(a.service.currentOwnKey(x.b,next.row.id,'walk_and_greet'),null);a.auth.revoke(x.b.sidDigest,x.b.proof,x.b.appId,1000000);assert.throws(()=>a.service.currentOwnKey(x.b,first.row.id,'walk_and_greet'),code('personal_session_required'));
});

test('world_entry is explicit personal-only consent and is never added to an existing grant or legacy scopes',async t=>{
 const a=await boot(t),{b}=await a.draft();await grant(a,b);const old=await issue(a,b);assert.equal(a.service.currentOwnKey(b,old.row.id,'world_entry'),null);const next=await grant(a,b,1,['world_entry']);assert.deepEqual(next.scopes,['world_entry']);const key=await issue(a,b,'entry-only',2);assert.ok(a.service.currentOwnKey(b,key.row.id,'world_entry'));assert.equal(a.service.currentOwnKey(b,key.row.id,'walk_and_greet'),null);assert.equal(a.service.currentOwnKey(b,old.row.id,'world_entry'),null);
});
