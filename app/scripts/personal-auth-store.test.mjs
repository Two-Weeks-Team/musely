// Real SQLite transactions + provider DI. No sockets, secrets, actors, or world state are provisioned.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PersonalAuthStore,personalDigest,personalNonce,readPersonalProof,signPersonalSession,PERSONAL_FLOW_TTL_MS,PERSONAL_SESSION_TTL_MS} from '../worker/core/personal-session.ts';
import {personalThreadsIdentity} from '../worker/core/threads.ts';
const app='12345',redirectUri='https://musely.net/api/threads/callback',now=1000000;
function boot(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0;
 const storage={sql:{exec(q,...b){const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};}},transactionSync(fn){const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const v=fn();assert.ok(!v?.then);db.exec('RELEASE '+n);return v;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}}};
 const store=new PersonalAuthStore(storage);store.init();return{db,store,storage};
}
async function flow(store,at=now){const state=personalNonce(),browser=personalNonce();const f={stateDigest:await personalDigest('state',state),browserDigest:await personalDigest('browser',browser),appId:app,redirectUri,createdAt:at,expiresAt:at+PERSONAL_FLOW_TTL_MS};assert.equal(store.begin(f),true);return f;}
async function issued(store,at=now){const f=await flow(store,at);assert.equal(store.consume(f,at),true);const sid=personalNonce(),digest=await personalDigest('sid',sid);const p=store.complete(f.stateDigest,app,'42',digest,at);assert.ok(p);return{f,sid,digest,p,proof:{v:1,sid,...p}};}
const count=(db,table)=>db.prepare('SELECT count(*) n FROM '+table).get().n;

test('OAuth SQL completion is one-time, rejects late responses, and commits principal/session together',async t=>{
 const {store,db}=boot(t),f=await flow(store),sid=await personalDigest('sid',personalNonce());
 assert.equal(store.complete(f.stateDigest,app,'42',sid,now),null,'unconsumed proof cannot issue');
 assert.equal(store.consume(f,now),true);assert.equal(store.consume(f,now),false);
 assert.equal(store.complete(f.stateDigest,app,'42',sid,f.expiresAt),null,'deadline applies after provider too');assert.equal(count(db,'personal_principals'),0);
 const fresh=await flow(store);assert.equal(store.consume(fresh,now),true);assert.ok(store.complete(fresh.stateDigest,app,'42',sid,now));assert.equal(store.complete(fresh.stateDigest,app,'42',await personalDigest('sid',personalNonce()),now),null);assert.equal(count(db,'personal_auth_sessions'),1);
});

test('failed session INSERT rolls back newly-created principal and completion flag',async t=>{
 const {store,db,storage}=boot(t),f=await flow(store);assert.equal(store.consume(f,now),true);const original=storage.sql.exec;storage.sql.exec=(q,...b)=>{if(q.startsWith('INSERT INTO personal_auth_sessions'))throw Error('synthetic-insert-failure');return original(q,...b);};
 assert.throws(()=>store.complete(f.stateDigest,app,'42','a'.repeat(64),now),/synthetic-insert-failure/);storage.sql.exec=original;
 assert.equal(count(db,'personal_principals'),0);assert.equal(count(db,'personal_auth_sessions'),0);assert.equal(db.prepare('SELECT completed_at FROM personal_auth_flows').get().completed_at,null);
});

test('two independently-authenticated flows for the same app subject converge; different app subjects never merge',async t=>{
 const {store,db}=boot(t),flows=await Promise.all([flow(store),flow(store)]);const results=await Promise.all(flows.map(async f=>{assert.equal(store.consume(f,now),true);return store.complete(f.stateDigest,app,'42',await personalDigest('sid',personalNonce()),now);}));
 assert.equal(results[0].principalId,results[1].principalId);assert.equal(count(db,'personal_principals'),1);assert.equal(count(db,'personal_auth_sessions'),2);
 const f=await flow(store);const g={...f,stateDigest:'d'.repeat(64),appId:'555'};assert.equal(store.begin(g),true);assert.equal(store.consume(g,now),true);const other=store.complete(g.stateDigest,'555','42','c'.repeat(64),now);assert.notEqual(other.principalId,results[0].principalId);
});

test('sid revocation affects only that session; authVersion changes invalidate all without deleting ownership rows',async t=>{
 const {store,db}=boot(t),x=await issued(store),y=await issued(store);assert.equal(x.p.principalId,y.p.principalId);assert.equal(store.active(x.digest,x.p,app,now),true);
 assert.equal(store.revoke(x.digest,x.p,app,now),true);assert.equal(store.active(x.digest,x.p,app,now),false);assert.equal(store.active(y.digest,y.p,app,now),true);assert.equal(store.active(y.digest,y.p,'other-app',now),false);
 store.owners.advanceAuthVersion(y.p.principalId,1);assert.equal(store.active(y.digest,y.p,app,now),false);assert.equal(count(db,'personal_principals'),1);assert.equal(count(db,'personal_actors'),0);
});

test('session proof has exact schema/domain/time bound; correctly-signed tampering cannot bypass SQL binding',async t=>{
 const {store}=boot(t),x=await issued(store),secret='synthetic-session-secret';const token=await signPersonalSession(secret,x.proof,now);assert.deepEqual(await readPersonalProof(secret,token,now),x.proof);
 assert.equal(await readPersonalProof('another',token,now),null);assert.equal(await readPersonalProof(secret,token+'.trailing',now),null);assert.equal(await readPersonalProof(secret,token,now+PERSONAL_SESSION_TTL_MS),null);assert.equal(await readPersonalProof(secret,token,now-1),null);
 for(const changed of [{...x.proof,authVersion:2},{...x.proof,principalId:'pp_'+crypto.randomUUID()},{...x.proof,sid:personalNonce()}]){
  const p=await readPersonalProof(secret,await signPersonalSession(secret,changed,now),now);assert.ok(p);assert.equal(store.active(await personalDigest('sid',p.sid),p,app,now),false);
 }
 for(const invalid of [{...x.proof,extra:'owner'},{...x.proof,expiresAt:now+PERSONAL_SESSION_TTL_MS+1},{...x.proof,authVersion:1.5},{...x.proof,issuedAt:NaN}])await assert.rejects(signPersonalSession(secret,invalid,now));
});

test('flow digests are separated, bounded/pruned on writes only, and additive init leaves session/registry unchanged',async t=>{
 const {store,db}=boot(t),value=personalNonce(),digests=await Promise.all(['state','browser','sid'].map(x=>personalDigest(x,value)));assert.equal(new Set(digests).size,3);
 const f=await flow(store);for(const bad of [{...f,stateDigest:'raw'},{...f,appId:'bad'},{...f,redirectUri:'http://musely.net/api/threads/callback'},{...f,expiresAt:f.expiresAt+1}])assert.equal(store.begin(bad),false);
 for(let i=1;i<256;i++)assert.equal(store.begin({...f,stateDigest:i.toString(16).padStart(64,'0')}),true);
 assert.equal(store.begin({...f,stateDigest:'f'.repeat(64)}),false);assert.equal(count(db,'personal_auth_flows'),256);
 const before=JSON.stringify(db.prepare('SELECT * FROM personal_auth_flows').all());store.init();assert.equal(JSON.stringify(db.prepare('SELECT * FROM personal_auth_flows').all()),before);
 assert.equal(store.begin({...f,stateDigest:'e'.repeat(64),createdAt:f.expiresAt,expiresAt:f.expiresAt+PERSONAL_FLOW_TTL_MS}),true);assert.equal(count(db,'personal_auth_flows'),1);
});

test('provider fetch and body stalls each abort under one deadline, without retry or leaking thrown errors',async()=>{
 const original=Date.now;Date.now=()=>1000; // Native timer remains real; avoid CPU scheduling deciding which fake phase is reached.
 try {for(const mode of ['fetch','body']){
  let calls=0,aborted=false,cancelled=false;
  const fetcher=async(_u,init)=>{calls++;init.signal.addEventListener('abort',()=>aborted=true);if(mode==='fetch')return new Promise(()=>{});return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}));};
  await assert.rejects(personalThreadsIdentity({appId:app,appSecret:'SYNTHETIC_SECRET',redirectUri,timeoutMs:5,fetcher},'SYNTHETIC_CODE'),e=>e.name==='ThreadsLoginError'&&e.message==='threads_login_failed'&&e.cause===undefined);
  assert.equal(calls,1);assert.equal(aborted,true);if(mode==='body')assert.equal(cancelled,true);
 }}finally{Date.now=original;}
});

test('same deadline spans both provider calls; a late me body cannot produce a verified subject',async()=>{
 const original=Date.now;Date.now=()=>1000;
 try {let calls=0,cancelled=false;
 const fetcher=async(_u,init)=>{calls++;if(calls===1)return new Response('{"access_token":"SYNTHETIC_TOKEN"}');return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"id":"42"'));},cancel(){cancelled=true;}}));};
 await assert.rejects(personalThreadsIdentity({appId:app,appSecret:'secret',redirectUri,timeoutMs:5,fetcher},'code'),e=>e.message==='threads_login_failed');assert.equal(calls,2);assert.equal(cancelled,true);
 }finally{Date.now=original;}
});

test('provider wrong token shape/invalid UTF8/throwing metadata remain fixed safe errors and skip me',async()=>{
 const variants=[()=>new Response('{"access_token":42}'),()=>new Response('{"access_token":""}'),()=>new Response('{"access_token":"token","token_type":"other"}'),()=>new Response(new Uint8Array([0xff])),()=>{throw Object.defineProperty({},'message',{get(){throw Error('PRIVATE_GETTER');}});}];
 for(const variant of variants){let calls=0;await assert.rejects(personalThreadsIdentity({appId:app,appSecret:'secret',redirectUri,fetcher:async()=>{calls++;return variant();}},'code'),e=>e.name==='ThreadsLoginError'&&e.message==='threads_login_failed'&&e.cause===undefined);assert.equal(calls,1);}
});

test('an overdue timer cannot accept a response after the total provider deadline or start another fetch',async()=>{
 const original=Date.now;let clock=1000,calls=0;Date.now=()=>clock;
 try {await assert.rejects(personalThreadsIdentity({appId:app,appSecret:'secret',redirectUri,timeoutMs:10000,fetcher:async()=>{calls++;clock+=10001;return new Response(calls===1?'{"access_token":"SYNTHETIC_TOKEN"}':'{"id":"42"}');}},'code'),e=>e.name==='ThreadsLoginError');assert.equal(calls,1);}
 finally {Date.now=original;}
});

test('diagnostic migration preserves old rows across restart and failure cannot issue a session or overwrite another browser',async t=>{
 const {store,db}=boot(t),f=await flow(store);const original=JSON.stringify(db.prepare('SELECT state_digest,browser_digest,consumed_at,completed_at FROM personal_auth_flows').get());
 for(const column of ['failed_at','failure_reason','failure_meta_code','failure_meta_subcode'])db.exec('ALTER TABLE personal_auth_flows DROP COLUMN '+column);
 store.init();store.init();assert.equal(JSON.stringify(db.prepare('SELECT state_digest,browser_digest,consumed_at,completed_at FROM personal_auth_flows').get()),original);
 assert.equal(store.fail(f,{reason:'token_exchange_failed'},now),false,'unconsumed flow cannot be marked by diagnostic caller');assert.equal(store.consume(f,now),true);
 for(const binding of [{...f,browserDigest:'d'.repeat(64)},{...f,appId:'555'},{...f,redirectUri:'https://evil.invalid/api/threads/callback'}])assert.equal(store.fail(binding,{reason:'me_fetch_failed'},now),false);
 assert.equal(store.fail(f,{reason:'me_fetch_failed',metaCode:'PRIVATE_CODE_CANARY',metaSubcode:Infinity},now),true);
 const row=db.prepare('SELECT * FROM personal_auth_flows').get();assert.equal(row.failure_reason,'me_fetch_failed');assert.equal(row.failure_meta_code,null);assert.equal(row.failure_meta_subcode,null);
 assert.equal(store.fail(f,{reason:'session_store_failed'},now),false);assert.equal(store.complete(f.stateDigest,app,'42','c'.repeat(64),now),null);assert.equal(count(db,'personal_auth_sessions'),0);
 store.init();assert.deepEqual(db.prepare('SELECT * FROM personal_auth_flows').get(),row);
});

test('a consumed flow that expires during provider work still records failure but can never issue a session',async t=>{
 const {store,db}=boot(t),f=await flow(store);assert.equal(store.consume(f,f.expiresAt-1),true);
 assert.equal(store.complete(f.stateDigest,app,'42','c'.repeat(64),f.expiresAt),null);
 assert.equal(store.fail(f,{reason:'state_invalid'},f.expiresAt),true);
 assert.equal(db.prepare('SELECT failure_reason FROM personal_auth_flows').get().failure_reason,'state_invalid');assert.equal(count(db,'personal_auth_sessions'),0);
});

test('received token HTTP status survives empty, oversized or unreadable error bodies',async()=>{
 for(const [status,body]of [[400,null],[503,null],[400,'x'.repeat(65537)],[503,new ReadableStream({start(c){c.error(Error('PRIVATE_BODY_CANARY'));}})]]){
  await assert.rejects(personalThreadsIdentity({appId:app,appSecret:'synthetic',redirectUri,fetcher:async()=>new Response(body,{status})},'synthetic-code'),e=>e.diagnostic?.reason===(status===400?'token_exchange_http_4xx':'token_exchange_http_5xx'));
 }
});
