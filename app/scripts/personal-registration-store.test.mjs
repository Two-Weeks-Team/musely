// Native SQLite/WebCrypto synthetic fixtures only. Never print/export fixture private JWKs to test output.
import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {PersonalAuthStore,personalDigest,personalNonce} from '../worker/core/personal-session.ts';
import {PersonalRegistration} from '../worker/core/personal-registration.ts';
import {generateKeyPair,importPrivateJwk,signBytes,verifyBytes} from '../src/identity/jws.ts';
const intent=(x={})=>({operationId:'op-one',displayName:'Name',appearanceId:'00-jolly',...x});
async function boot(t,options={}){const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,clock=1000000;const storage={sql:{exec(q,...b){const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};}},transactionSync(fn){const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const v=fn();assert.ok(!v?.then);db.exec('RELEASE '+n);return v;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}}};const auth=new PersonalAuthStore(storage);auth.init();const store=new PersonalRegistration(storage,auth,{...options,now:()=>clock});store.init();const binding=async(subject='42')=>{const f={stateDigest:await personalDigest('state',personalNonce()),browserDigest:await personalDigest('browser',personalNonce()),appId:'123',redirectUri:'https://musely.net/api/threads/callback',createdAt:clock,expiresAt:clock+600000};assert.equal(auth.begin(f),true);assert.equal(auth.consume(f,clock),true);const sidDigest=await personalDigest('sid',personalNonce()),proof=auth.complete(f.stateDigest,'123',subject,sidDigest,clock);return{sidDigest,proof,appId:'123'};};return{db,storage,auth,store,binding,setClock:n=>clock=n};}
const count=(a,table)=>a.db.prepare('SELECT count(*) n FROM '+table).get().n;
const empty=a=>{for(const table of ['personal_actors','personal_profiles','personal_registrations','personal_actor_roots'])assert.equal(count(a,table),0);};
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};

test('stored actor-scoped root reloads with original codecs; two actors cannot share signing identity and no JWK is public',async t=>{
 const a=await boot(t),x=await a.binding(),y=await a.binding('99'),p=await a.store.register(x,intent()),q=await a.store.register(y,intent());const rows=a.db.prepare('SELECT * FROM personal_actor_roots').all();assert.equal(rows.length,2);assert.notEqual(rows[0].root_ref,rows[1].root_ref);assert.notEqual(rows[0].agent_id,rows[1].agent_id);const root=await importPrivateJwk(JSON.parse(rows.find(r=>r.actor_id===p.actorId).private_jwk));const other=JSON.parse(rows.find(r=>r.actor_id===q.actorId).public_jwk);assert.equal(root.kid,rows.find(r=>r.actor_id===p.actorId).agent_id);const bytes=new TextEncoder().encode('synthetic actor binding');const signature=await signBytes(root.privateKey,bytes);assert.equal(await verifyBytes(root.publicJwk,bytes,signature),true);assert.equal(await verifyBytes(other,bytes,signature),false);assert.doesNotMatch(JSON.stringify(p),/root|jwk|agent|principal|subject|private|custodial/);assert.equal(a.store.profile(y).actorId,q.actorId);
});

for(const mode of ['sid-revoke','authVersion','expiry'])test('keygen await rechecks '+mode+' before persisting any root/draft',async t=>{
 const entered=deferred(),release=deferred();const a=await boot(t,{generateRoot:async()=>{entered.resolve();await release.promise;return generateKeyPair(true);}}),b=await a.binding();const pending=a.store.register(b,intent());await entered.promise;
 if(mode==='sid-revoke')assert.equal(a.auth.revoke(b.sidDigest,b.proof,b.appId,1000000),true);if(mode==='authVersion')a.auth.owners.advanceAuthVersion(b.proof.principalId,b.proof.authVersion);if(mode==='expiry')a.setClock(b.proof.expiresAt);release.resolve();await assert.rejects(pending,e=>e.code==='personal_session_required');empty(a);assert.equal(count(a,'personal_principals'),1);
});

test('root INSERT failure rolls back all nested registry rows, leaves no orphan, and can be explicitly retried',async t=>{
 let generated=0;const a=await boot(t,{generateRoot:async()=>{generated++;return generateKeyPair(true);}}),b=await a.binding(),original=a.storage.sql.exec;a.storage.sql.exec=(q,...args)=>{if(q.startsWith('INSERT INTO personal_actor_roots'))throw Error('synthetic SQL failure');return original(q,...args);};await assert.rejects(a.store.register(b,intent()),e=>e.message==='synthetic SQL failure');empty(a);a.storage.sql.exec=original;const result=await a.store.register(b,intent());assert.ok(result.actorId);assert.equal(generated,2);assert.equal(count(a,'personal_actor_roots'),1);assert.equal((await a.store.register(b,intent())).actorId,result.actorId);assert.equal(generated,2,'idempotent retry must not keygen');
});

test('same-operation concurrent keygen has one durable root/result; losing generated material is never persisted',async t=>{
 let n=0;const both=deferred(),release=deferred();const a=await boot(t,{generateRoot:async()=>{if(++n===2)both.resolve();await release.promise;return generateKeyPair(true);}}),b=await a.binding();const x=a.store.register(b,intent()),y=a.store.register(b,intent());await both.promise;release.resolve();const result=await Promise.all([x,y]);assert.equal(result[0].actorId,result[1].actorId);assert.equal(count(a,'personal_actor_roots'),1);assert.equal(count(a,'personal_registrations'),1);
});

test('different operations or changed intents racing one principal never persist a second/orphan root',async t=>{
 for(const edit of [{operationId:'op-two'},{displayName:'Other'}]){let n=0;const both=deferred(),release=deferred();const a=await boot(t,{generateRoot:async()=>{if(++n===2)both.resolve();await release.promise;return generateKeyPair(true);}}),b=await a.binding();const x=a.store.register(b,intent()),y=a.store.register(b,intent(edit));await both.promise;release.resolve();const r=await Promise.allSettled([x,y]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.ok(r.some(x=>x.status==='rejected'&&['actor_exists','operation_conflict'].includes(x.reason.code)));assert.equal(count(a,'personal_actor_roots'),1);assert.equal(count(a,'personal_profiles'),1);}
});

test('keygen/export failure writes nothing and does not log private failure text',async t=>{
 for(const generateRoot of [async()=>{throw Error('SYNTHETIC_PRIVATE_FAILURE');},()=>generateKeyPair(false)]){const a=await boot(t,{generateRoot}),b=await a.binding();await assert.rejects(a.store.register(b,intent()));empty(a);}
});

test('profile CAS/root-link failures do not mutate identity, root, or ownership',async t=>{
 const a=await boot(t),b=await a.binding();const p=await a.store.register(b,intent());a.db.prepare('UPDATE personal_profiles SET revision=?').run(Number.MAX_SAFE_INTEGER);assert.throws(()=>a.store.patch(b,{expectedRevision:Number.MAX_SAFE_INTEGER,displayName:'Other'}),e=>e.code==='revision_conflict');a.db.prepare('UPDATE personal_actors SET root_ref=? WHERE actor_id=?').run('root_ref:unrelated',p.actorId);assert.throws(()=>a.store.profile(b),e=>e.code==='registration_incomplete');assert.equal(count(a,'personal_actor_roots'),1);assert.equal(count(a,'personal_actors'),1);
});
