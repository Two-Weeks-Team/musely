// Actual Worker/DO + SQLite and ephemeral in-memory fixture keys. Never actual provider, key file or model.
import {test} from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';import {DatabaseSync} from 'node:sqlite';
import {personalDigest,personalNonce,signPersonalSession,personalCookie} from '../worker/core/personal-session.ts';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}',shortCircuit:true};return n(s,c);}`));
const O='https://musely.net',H={origin:O,'sec-fetch-site':'same-origin','content-type':'application/json'},D='/api/personal/draft',P='/api/personal/profile';
const intent=(x={})=>({operationId:'op-one',displayName:'  ComBba  ',appearanceId:'00-jolly',...x});
async function boot(t){const {default:worker,WorldDO}=await import('../worker/index.ts');const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,ready,alarm=null;const sql={exec(q,...b){const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};}};const storage={sql,transactionSync(fn){const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const v=fn();assert.ok(!v?.then);db.exec('RELEASE '+n);return v;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--; }},getAlarm:async()=>alarm,setAlarm:async n=>alarm=n};const ctx={storage,blockConcurrencyWhile:fn=>(ready=fn())},env={MODEL_ID:'synthetic',MODEL_BASE:'https://not-called.invalid',PUBLIC_ORIGIN:O,ALLOWED_HOSTS:'musely.net',DAILY_BUDGET_USD:'1',SESSION_SECRET:'synthetic-session-secret',THREADS_APP_ID:'12345',THREADS_APP_SECRET:'synthetic-app-secret'};let do_;
 const restart=async()=>{do_=new WorldDO(ctx,env);await ready;env.WORLD={idFromName:()=> 'id',get:()=>do_};};await restart();const go=async(method,path,body,cookie,extra={})=>{const r=await worker.fetch(new Request(O+path,{method,headers:{...H,...(cookie?{cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)}),env);return{status:r.status,headers:r.headers,body:await r.json()};};
 const login=async(id='42')=>{const now=Date.now(),f={stateDigest:await personalDigest('state',personalNonce()),browserDigest:await personalDigest('browser',personalNonce()),appId:env.THREADS_APP_ID,redirectUri:O+'/api/threads/callback',createdAt:now,expiresAt:now+600000};assert.equal(do_.personalAuthBegin(f),true);assert.equal(do_.personalAuthConsume(f,now),true);const sid=personalNonce(),digest=await personalDigest('sid',sid),row=do_.personalAuthComplete(f.stateDigest,env.THREADS_APP_ID,id,digest,now);assert.ok(row);const proof={v:1,sid,...row};return{cookie:personalCookie(await signPersonalSession(env.SESSION_SECRET,proof)).split(';')[0],proof,digest};};
 return{db,go,login,restart,env,get do_(){return do_;}};}
const count=(a,table)=>a.db.prepare('SELECT count(*) n FROM '+table).get().n;
const publicProfile=p=>assert.deepEqual(Object.keys(p).sort(),['actorId','appearanceId','displayName','revision']);

test('draft API creates only one atomic draft/profile/private root and public projection without entering the world',async t=>{
 const a=await boot(t),u=await a.login(),world=JSON.stringify(a.do_.worldRun()),legacy=a.db.prepare('SELECT * FROM agents ORDER BY agent_id').all(),oldPrivate=a.db.prepare('SELECT * FROM private_keys ORDER BY kid').all();
 const r=await a.go('POST',D,intent(),u.cookie);assert.equal(r.status,200);assert.deepEqual(r.body.entry,{state:'registered'});publicProfile(r.body.profile);assert.equal(r.body.profile.displayName,'ComBba');assert.equal(r.body.profile.revision,1);assert.match(r.body.profile.actorId,/^pm_/);assert.equal(r.headers.get('cache-control'),'no-store');
 for(const table of ['personal_actors','personal_profiles','personal_registrations','personal_actor_roots'])assert.equal(count(a,table),1);assert.equal(JSON.stringify(a.do_.worldRun()),world);assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM agents ORDER BY agent_id').all())===JSON.stringify(legacy),true);assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM private_keys ORDER BY kid').all())===JSON.stringify(oldPrivate),true);assert.equal(count(a,'claims'),0);assert.equal((await a.go('GET','/api/personal/me',undefined,u.cookie)).body.entry.state,'viewing');assert.equal((await a.go('POST','/api/agent-keys',{},u.cookie)).status,401);
 const get=await a.go('GET',P,undefined,u.cookie);assert.deepEqual(get.body,r.body);assert.doesNotMatch(JSON.stringify(r.body),/principal|subject|agentId|rootRef|jwk|server_custodial|joined/);
});

test('same intent retry is idempotent despite generated references; changed intent/new operation conflicts and PATCH does not rewrite original intent',async t=>{
 const a=await boot(t),u=await a.login();const first=await a.go('POST',D,intent(),u.cookie);assert.equal(first.status,200);const retry=await a.go('POST',D,intent({displayName:'ComBba'}),u.cookie);assert.deepEqual(retry.body,first.body);assert.equal(count(a,'personal_actor_roots'),1);
 assert.equal((await a.go('POST',D,intent({displayName:'Changed'}),u.cookie)).status,409);assert.equal((await a.go('POST',D,intent({operationId:'op-two'}),u.cookie)).status,409);
 const patch=await a.go('PATCH',P,{expectedRevision:1,displayName:'New name'},u.cookie);assert.equal(patch.status,200);assert.equal(patch.body.profile.revision,2);assert.equal(patch.body.profile.appearanceId,'00-jolly');assert.deepEqual((await a.go('POST',D,intent(),u.cookie)).body,patch.body);assert.equal(count(a,'personal_actor_roots'),1);
});

test('two principals with identical public appearance/name never share profile/root/authority',async t=>{
 const a=await boot(t),u=await a.login(),v=await a.login('99');const x=await a.go('POST',D,intent(),u.cookie),y=await a.go('POST',D,intent(),v.cookie);assert.equal(x.status,200);assert.equal(y.status,200);assert.notEqual(x.body.profile.actorId,y.body.profile.actorId);assert.equal(count(a,'personal_actor_roots'),2);
 assert.equal((await a.go('PATCH',P,{expectedRevision:1,displayName:'Attack',actorId:y.body.profile.actorId},u.cookie)).status,400);assert.equal((await a.go('GET',P,undefined,v.cookie)).body.profile.displayName,'ComBba');assert.equal((await a.go('POST',D,{...intent(),principalId:v.proof.principalId},u.cookie)).status,400);
});

test('profile compare-and-swap allows only one concurrent revision and no credential changes',async t=>{
 const a=await boot(t),u=await a.login();assert.equal((await a.go('GET',P,undefined,u.cookie)).body.profile,null);assert.equal((await a.go('PATCH',P,{expectedRevision:1,displayName:'Nobody'},u.cookie)).status,409);assert.equal((await a.go('POST',D,intent(),u.cookie)).status,200);const roots=a.db.prepare('SELECT * FROM personal_actor_roots').all();
 const changes=await Promise.all(['A','B'].map(displayName=>a.go('PATCH',P,{expectedRevision:1,displayName,appearanceId:'01-sunny'},u.cookie)));assert.deepEqual(changes.map(x=>x.status).sort(),[200,409]);const p=(await a.go('GET',P,undefined,u.cookie)).body.profile;assert.equal(p.revision,2);assert.equal(p.appearanceId,'01-sunny');assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM personal_actor_roots').all())===JSON.stringify(roots),true);
});

test('validation rejects identities/unknown appearances/control-bidi/oversize; literal markup remains JSON text only',async t=>{
 const a=await boot(t),u=await a.login();for(const body of [intent({rootRef:'attacker'}),intent({agentId:'attacker'}),intent({claimed:true}),intent({appearanceId:'unknown'}),intent({displayName:' '}),intent({displayName:'x'.repeat(41)}),intent({displayName:'x\u202ey'}),intent({displayName:'x\u0000y'}),intent({operationId:'msly_not_operation'})])assert.equal((await a.go('POST',D,body,u.cookie)).status,400);
 assert.equal(count(a,'personal_actors'),0);const name='<img src=x onerror=alert(1)>';const r=await a.go('POST',D,intent({displayName:name}),u.cookie);assert.equal(r.status,200);assert.equal(r.body.profile.displayName,name);assert.match(r.headers.get('content-type'),/^application\/json/);for(const body of [{expectedRevision:0,displayName:'a'},{expectedRevision:1,displayName:'a',appearanceId:'unknown'},{expectedRevision:1,displayName:'a',rootRef:'x'}])assert.equal((await a.go('PATCH',P,body,u.cookie)).status,400);
});

test('registration races persist one root; restart preserves draft and profile without touching legacy records',async t=>{
 const a=await boot(t),u=await a.login();const r=await Promise.all([a.go('POST',D,intent(),u.cookie),a.go('POST',D,intent(),u.cookie)]);assert.deepEqual(r.map(x=>x.status),[200,200]);assert.deepEqual(r[0].body,r[1].body);assert.equal(count(a,'personal_actor_roots'),1);const before=(await a.go('GET',P,undefined,u.cookie)).body;await a.restart();assert.deepEqual((await a.go('GET',P,undefined,u.cookie)).body,before);assert.equal(count(a,'personal_actor_roots'),1);
});

test('authentication/Origin/bounded body failures produce no registrations or privilege promotion',async t=>{
 const a=await boot(t),u=await a.login();for(const [method,path,body] of [['POST',D,intent()],['GET',P,undefined],['PATCH',P,{expectedRevision:1,displayName:'a'}]])assert.equal((await a.go(method,path,body)).status,401);
 assert.equal((await a.go('POST',D,intent(),u.cookie,{origin:'https://evil.invalid'})).status,403);assert.equal((await a.go('POST',D,intent({displayName:'x'.repeat(5000)}),u.cookie)).status,400);
 assert.equal((await a.go('DELETE','/api/personal/session',undefined,u.cookie)).status,200);assert.equal((await a.go('POST',D,intent(),u.cookie)).status,401);assert.equal(count(a,'personal_actors'),0);
});

test('registration configuration failures and SQL failures are safe503 rather than anonymous401 or free-text errors',async t=>{
 const a=await boot(t),u=await a.login();delete a.env.SESSION_SECRET;assert.equal((await a.go('GET',P,undefined,u.cookie)).status,503);a.env.SESSION_SECRET='synthetic-session-secret';const original=a.do_.personalDraftRegister;a.do_.personalDraftRegister=async()=>{throw Error('SYNTHETIC_PRIVATE_SQL_FAILURE');};const r=await a.go('POST',D,intent(),u.cookie);assert.equal(r.status,503);assert.deepEqual(r.body,{error:'registration_unavailable'});a.do_.personalDraftRegister=original;
});

test('serialized RPC registry errors preserve only allowlisted public status codes without custom prototypes',async t=>{
 const a=await boot(t),u=await a.login();
 for(const [name,method,path,body] of [['personalDraftRegister','POST',D,intent()],['personalProfileRead','GET',P,undefined],['personalProfilePatch','PATCH',P,{expectedRevision:1,displayName:'Name'}]]){
  const original=a.do_[name];
  for(const [code,status]of [['personal_session_required',401],['invalid_registration',400],['operation_conflict',409],['actor_exists',409],['binding_conflict',409],['draft_required',409],['revision_conflict',409],['registration_incomplete',503],['PRIVATE_RPC_CANARY',503]]){
   a.do_[name]=async()=>{throw Object.assign(new Error('PRIVATE_RPC_CANARY'),{name:'PersonalRegistryError',code});};
   const r=await a.go(method,path,body,u.cookie);assert.equal(r.status,status,code);assert.equal(r.body.error,status===503?'registration_unavailable':code);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE_RPC_CANARY/);
  }
  a.do_[name]=async()=>{throw Object.assign(new Error('PRIVATE_RPC_CANARY'),{code:'invalid_registration'});};
  const unexpected=await a.go(method,path,body,u.cookie);assert.deepEqual(unexpected.body,{error:'registration_unavailable'});assert.equal(unexpected.status,503);a.do_[name]=original;
 }
});
