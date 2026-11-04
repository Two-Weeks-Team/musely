// Real Worker/WorldDO and SQLite. Auth/root/key material is synthetic; external networking is forbidden.
import {test,after} from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';import {DatabaseSync} from 'node:sqlite';
import {personalDigest,personalNonce,signPersonalSession} from '../worker/core/personal-session.ts';import {issueOwnerSession} from '../worker/core/owner-session.ts';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}',shortCircuit:true};return n(s,c);}`));
const HOST='https://musely.net',BASE='/api/personal/owner',H={origin:HOST,'sec-fetch-site':'same-origin'},TOKEN='synthetic-personal-owner-emergency-000001';
const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('external networking prohibited');};after(()=>globalThis.fetch=original);
async function boot(t){const {default:worker,WorldDO}=await import('../worker/index.ts');const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,ready;
 const sql={exec(q,...b){const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};}},transactionSync=fn=>{const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const v=fn();assert.ok(!v?.then);db.exec('RELEASE '+n);return v;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}};
 const ctx={storage:{sql,transactionSync,getAlarm:async()=>null,setAlarm:async()=>{}},blockConcurrencyWhile:fn=>(ready=fn())},root=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const env={PUBLIC_ORIGIN:HOST,ALLOWED_HOSTS:'musely.net,www.musely.net',SESSION_SECRET:'synthetic-personal-owner-session',THREADS_APP_ID:'123',OWNER_CONTROL_TOKEN:TOKEN,DEMO_PEER_CONTROL_TOKEN:'synthetic-personal-owner-demo-peer-000002',OWNER_ROOT_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',root.privateKey)),MODEL_BASE:'https://not-called.invalid',MODEL_ID:'synthetic',DAILY_BUDGET_USD:'1',SOCIAL_STATUS_MODE:'public-v1'};
 const world=new WorldDO(ctx,env);await ready;env.WORLD={idFromName:()=> 'world',get:()=>world};env.ASSETS={fetch:async()=>new Response('asset')};
 const go=async(method,path,cookie='',body,extra={})=>{const r=await worker.fetch(new Request(HOST+path,{method,headers:{...H,cookie,...(body===undefined?{}:{'content-type':'application/json'}),...extra},body:body instanceof ReadableStream?body:body===undefined?undefined:JSON.stringify(body),...(body instanceof ReadableStream?{duplex:'half'}:{})}),env);return{status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};};
 const bind=async(subject='42',appId='123')=>{const now=Date.now(),sid=personalNonce(),flow={stateDigest:await personalDigest('state',personalNonce()),browserDigest:await personalDigest('browser',personalNonce()),appId,redirectUri:HOST+'/api/threads/callback',createdAt:now,expiresAt:now+600000};assert.ok(world.personalAuthBegin(flow));assert.ok(world.personalAuthConsume(flow,now));const sidDigest=await personalDigest('sid',sid),proof=world.personalAuthComplete(flow.stateDigest,appId,subject,sidDigest,now),cookie='musely_p='+await signPersonalSession(env.SESSION_SECRET,{v:1,sid,...proof});return{cookie,binding:{sidDigest,appId,proof}};};
 const owner='musely_o='+(await issueOwnerSession(env.SESSION_SECRET,{owner:TOKEN,peer:env.DEMO_PEER_CONTROL_TOKEN},'owner')).token;
 const adopt=async b=>{const r=await go('POST','/api/personal/legacy-muse',b.cookie+'; '+owner,{operationId:'synthetic-adoption',displayName:'ComBba',appearanceId:'00-jolly',expectedRevision:0});assert.equal(r.status,200);assert.equal(r.body.adopted,true);};
 return{db,sql,world,env,go,bind,owner,adopt};}

test('adopted personal session reads the existing owner DTO without a token exchange or new key/delegation',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);const keys=x.db.prepare('SELECT count(*) n FROM agent_keys').get().n,version=x.world.worldView().version;
 const r=await x.go('GET',BASE+'/session',b.cookie);assert.equal(r.status,200);assert.equal(r.body.owner.principal,'owner');assert.deepEqual(r.body.owner.muses,['00-jolly']);assert.equal(r.body.owner.expiresAt,b.binding.proof.expiresAt);assert.equal(r.cookies.length,0);assert.ok(r.body.delegation.some(d=>d.muse==='00-jolly'));assert.equal(x.db.prepare('SELECT count(*) n FROM agent_keys').get().n,keys);assert.equal(x.world.worldView().version,version);
 assert.deepEqual((await x.go('GET',BASE+'/session')).body,{owner:null});assert.equal((await x.go('POST',BASE+'/session',b.cookie,{token:TOKEN})).status,405);
});

test('personal owner adapters reuse profile, inbox, location, keys and explicit revoke/redelegate even while joined is false',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);
 for(const path of ['/inbox','/notifications','/location','/profile','/social-status?muse=00-jolly','/agent-keys'])assert.equal((await x.go('GET',BASE+path,b.cookie)).status,200,path);
 assert.equal((await x.go('POST',BASE+'/location',b.cookie,{source:'virtual',preset:'stanford'})).status,200);
 const key=await x.go('POST',BASE+'/agent-keys',b.cookie,{});assert.equal(key.status,201);assert.ok(key.body.key.startsWith('msly_'));assert.equal(key.cookies.length,0);
 assert.equal((await x.go('POST',BASE+'/revoke',b.cookie,{})).status,200);assert.ok(x.world.trust.suspended('00-jolly'));
 assert.equal((await x.go('GET',BASE+'/session',b.cookie)).body.delegation[0].status,'revoked');
 assert.equal((await x.go('POST',BASE+'/redelegate',b.cookie,{})).status,200);assert.equal(x.world.trust.suspended('00-jolly'),false);
 assert.equal((await x.go('DELETE',BASE+'/agent-keys/'+key.body.id,b.cookie)).status,200);
});

test('unbound, pm, judge, emergency and cross-Muse credentials never gain personal owner authority; logout revokes the actual personal sid',async t=>{
 const x=await boot(t),b=await x.bind(),other=await x.bind('43');await x.adopt(b);
 assert.deepEqual((await x.go('GET',BASE+'/session',other.cookie)).body,{owner:null});
 assert.deepEqual((await x.go('GET',BASE+'/session',x.owner)).body,{owner:null});
 await x.world.personalDraftRegister(other.binding,{operationId:'draft',displayName:'Other',appearanceId:'01-sunny'});
 assert.equal((await x.go('POST',BASE+'/revoke',other.cookie,{})).status,403);
 for(const target of ['09-copper','04-ember'])assert.equal((await x.go('POST',BASE+'/revoke',b.cookie,{muse:target})).status,403);
 assert.equal((await x.go('POST',BASE+'/revoke',b.cookie,{muse:'pm_00000000-0000-4000-8000-000000000000'})).status,400);
 for(const extra of [{origin:'https://evil.invalid'},{origin:''},{'sec-fetch-site':'cross-site'}])assert.equal((await x.go('POST',BASE+'/revoke',b.cookie,{},extra)).status,403);
 assert.deepEqual((await x.go('DELETE',BASE+'/session',b.cookie)).body,{owner:null});assert.equal((await x.go('POST',BASE+'/revoke',b.cookie,{})).status,401);assert.deepEqual((await x.go('GET',BASE+'/session',b.cookie)).body,{owner:null});
 const fresh=await x.bind();assert.deepEqual((await x.go('DELETE','/api/personal/session',fresh.cookie)).body,{authenticated:false,entry:{state:'viewing'}});assert.equal((await x.go('POST',BASE+'/revoke',fresh.cookie,{})).status,401);
 assert.ok((await x.go('POST','/api/owner/session','',{token:TOKEN})).cookies.some(c=>c.startsWith('musely_o=')),'the old emergency exchange stays available');
});

test('P0, claim and ritual adapters use the personal binding without changing the old positive record on reads',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);
 const old={at:Date.now()-1000,passed:true,results:[],requestId:'old-positive',model:'synthetic',tier:'owner'};x.world.ritualRecord(old,'fixture',true);
 assert.equal((await x.go('GET',BASE+'/ritual/record',b.cookie)).body.record.requestId,'old-positive');
 assert.equal((await x.go('GET',BASE+'/status',b.cookie)).body.owner.principal,'owner');
 const claim=await x.go('POST',BASE+'/claim/permalink',b.cookie,{permalink:'https://www.threads.com/@combba82/post/ABCDE12345'});assert.equal(claim.status,200);assert.equal(claim.body.record.path,'owner_direct');
 assert.equal((await x.go('POST',BASE+'/p0/run',b.cookie)).status,200);
 assert.equal((await x.go('POST',BASE+'/ritual/start',b.cookie)).status,401,'the separate visitor model quota/session remains required');
 const {issueSession,sessionCookie}=await import('../worker/core/session.ts');const visitor=sessionCookie((await issueSession(x.env.SESSION_SECRET,'visitor')).token).split(';')[0];
 const start=await x.go('POST',BASE+'/ritual/start',b.cookie+'; '+visitor);assert.equal(start.status,200);assert.equal(start.body.steps.length,3);assert.equal((await x.go('GET',BASE+'/ritual/record',b.cookie)).body.record.requestId,'old-positive');
 assert.equal((await x.go('POST',BASE+'/muse',b.cookie+'; '+visitor,{action:'spotlight',input:{}})).status,400,'the camera adapter does not become arbitrary Muse proxy authority');
});

const barrier=()=>{let enter,release;return{entered:new Promise(r=>enter=r),wait:new Promise(r=>release=r),enter:()=>enter(),release:()=>release()};};
test('logout during a streamed body prevents the later owner mutation',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);let controller;const stream=new ReadableStream({start(c){controller=c;}}),pending=x.go('POST',BASE+'/revoke',b.cookie,stream);
 await new Promise(r=>setTimeout(r,20));await x.go('DELETE',BASE+'/session',b.cookie);controller.enqueue(new TextEncoder().encode('{}'));controller.close();assert.equal((await pending).status,401);assert.equal(x.world.trust.suspended('00-jolly'),false);
});
test('logout during key hashing prevents both key insertion and issuance event',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);const gate=barrier(),digest=crypto.subtle.digest.bind(crypto.subtle),before=x.db.prepare('SELECT count(*) n FROM agent_keys').get().n;
 crypto.subtle.digest=async(algorithm,data)=>{if(new TextDecoder().decode(data).startsWith('msly_')){gate.enter();await gate.wait;}return digest(algorithm,data);};t.after(()=>crypto.subtle.digest=digest);
 const pending=x.go('POST',BASE+'/agent-keys',b.cookie,{});await gate.entered;await x.go('DELETE',BASE+'/session',b.cookie);gate.release();assert.equal((await pending).status,401);assert.equal(x.db.prepare('SELECT count(*) n FROM agent_keys').get().n,before);assert.equal(x.world.runtime.events().filter(e=>e.kind==='agent_key_issued').length,0);
});
test('logout during delegation preparation prevents registry revocation and world pause together',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);const gate=barrier(),revoke=x.world.trust.revoke.bind(x.world.trust),before=x.world.worldView().version;
 x.world.trust.revoke=async(...args)=>{gate.enter();await gate.wait;return revoke(...args);};
 const pending=x.go('POST',BASE+'/revoke',b.cookie,{});await gate.entered;await x.go('DELETE',BASE+'/session',b.cookie);gate.release();assert.equal((await pending).status,401);assert.equal(x.world.trust.suspended('00-jolly'),false);assert.equal(x.world.worldView().version,before);assert.equal(x.world.runtime.state().paused?.['00-jolly'],undefined);
});
for(const loss of ['authVersion','app','subject','provider','root','world'])test('personal owner fails closed when current adoption '+loss+' changes',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);
 if(loss==='authVersion')x.db.prepare('UPDATE personal_principals SET auth_version=auth_version+1').run();
 if(loss==='app')x.env.THREADS_APP_ID='456';
 if(loss==='subject')x.db.prepare("UPDATE personal_principals SET subject='123:999'").run();
 if(loss==='provider')x.db.prepare("UPDATE personal_principals SET provider='other'").run();
 if(loss==='root')x.db.prepare("UPDATE personal_legacy_adoptions SET root_binding='{}'").run();
 if(loss==='world')x.db.prepare("UPDATE personal_legacy_adoptions SET world_id='other-world'").run();
 const r=await x.go('POST',BASE+'/revoke',b.cookie,{});assert.ok([401,403,503].includes(r.status));assert.equal(x.world.trust.suspended('00-jolly'),false);
});

test('P0 crypto await cannot create an executor or world action after personal logout',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);const {grantItem}=await import('../src/engine/items.ts');
 x.world.runtime.commitExternal(Date.now(),'synthetic-p0-ready',s=>{const a=s.muses.find(m=>m.id==='00-jolly'),other=s.muses.find(m=>m.id==='02-moss');for(const m of[a,other]){m.place='commons:cafe';m.travel=null;m.beat=null;}grantItem(s.items,a,'coffee',Date.now(),a.place,'craft');grantItem(s.items,other,'fruit',Date.now(),other.place,'craft');});
 const gate=barrier(),executor=x.world.trust.executor.bind(x.world.trust),keys=x.db.prepare('SELECT count(*) n FROM private_keys').get().n,before=x.world.runtime.events().length;
 x.world.trust.executor=async(...args)=>{gate.enter();await gate.wait;return executor(...args);};
 const pending=x.go('POST',BASE+'/p0/run',b.cookie);await gate.entered;await x.go('DELETE',BASE+'/session',b.cookie);gate.release();assert.equal((await pending).status,401);assert.equal(x.db.prepare('SELECT count(*) n FROM private_keys').get().n,keys);assert.equal(x.world.runtime.events().length,before);
});

test('ritual provider completion after logout cannot replace the existing positive record or commit a judged event',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);const old={at:Date.now()-1000,passed:true,results:[],requestId:'preserved-positive',model:'synthetic',tier:'owner'};x.world.ritualRecord(old,'fixture',true);
 const {issueSession,sessionCookie}=await import('../worker/core/session.ts'),visitor=sessionCookie((await issueSession(x.env.SESSION_SECRET,'visitor')).token).split(';')[0],cookies=b.cookie+'; '+visitor;
 const start=await x.go('POST',BASE+'/ritual/start',cookies),before=x.world.runtime.events().length;assert.equal(start.status,200);x.env.MODEL_API_KEY='synthetic-model-key';const gate=barrier(),blocked=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url)=>{assert.equal(String(url),x.env.MODEL_BASE+'/chat/completions');calls++;gate.enter();await gate.wait;return new Response(JSON.stringify({id:'synthetic-ritual',usage:{prompt_tokens:1,completion_tokens:1},choices:[{message:{content:JSON.stringify({results:start.body.steps.map(s=>({step:s.id,passed:true,confidence:.99,observation:'Synthetic frame'}))})}}]}),{headers:{'x-request-id':'synthetic-ritual-request'}});};t.after(()=>globalThis.fetch=blocked);
 const pending=x.go('POST',BASE+'/muse',cookies,{action:'challenge',input:{challengeId:start.body.id,frames:Array(3).fill('data:image/jpeg;base64,AAAA')}});await gate.entered;await x.go('DELETE',BASE+'/session',b.cookie);gate.release();assert.equal((await pending).status,401);assert.equal(calls,1);assert.deepEqual(x.world.ritualOwnerRecord(),old);assert.equal(x.world.runtime.events().length,before);
 const again=await x.bind();assert.equal((await x.go('POST',BASE+'/muse',again.cookie+'; '+visitor,{action:'challenge',input:{challengeId:start.body.id,frames:Array(3).fill('data:image/jpeg;base64,AAAA')}})).status,400);assert.equal(calls,1,'the consumed ritual is never sent twice');
});

test('personal owner cookie namespace, duplicate-cookie denial and cross-owner key hiding stay independent of emergency credentials',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);
 assert.equal((await x.go('POST','/api/owner/revoke',b.cookie,{})).status,401);
 assert.deepEqual((await x.go('GET',BASE+'/session',b.cookie+'; '+b.cookie)).body,{owner:null});
 const dto=await x.go('GET',BASE+'/session',b.cookie);assert.equal(dto.body.owner.label,'ComBba · owner');assert.doesNotMatch(JSON.stringify(dto.body),/principalId|sidDigest|authVersion|"tk"|Jolly/);
 const peer=await x.world.connected.issueKey('09-copper'),key=await x.go('POST',BASE+'/agent-keys',b.cookie,{});assert.equal(key.status,201);
 assert.ok(!(await x.go('GET',BASE+'/agent-keys',b.cookie)).body.keys.some(k=>k.id===peer.id));assert.equal((await x.go('DELETE',BASE+'/agent-keys/'+peer.id,b.cookie)).status,404);assert.equal(x.world.connected.keys.byId(peer.id).revokedAt,null);
 const out=await x.go('DELETE',BASE+'/session',b.cookie+'; '+x.owner);assert.ok(out.cookies.some(c=>c.includes('Path=/api/personal;')&&c.includes('Max-Age=0')));assert.ok(!out.cookies.some(c=>c.startsWith('musely_o=')));assert.deepEqual((await x.go('GET',BASE+'/session',b.cookie+'; '+x.owner)).body,{owner:null});
 assert.equal((await x.go('GET','/api/owner/session',x.owner)).body.owner.principal,'owner','the independent emergency session remains separate');
});

for(const operation of ['agent-keys','revoke'])test('personal owner '+operation+' and its world evidence roll back together on commit failure',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);const keys=x.db.prepare('SELECT count(*) n FROM agent_keys').get().n,agent=x.world.trust.agentByMuse('00-jolly'),version=x.world.trust.delegationVersion(agent.agentId),events=x.world.runtime.events().length;
 x.db.exec("CREATE TEMP TRIGGER fail_owner_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'synthetic-commit-failure'); END");
 const r=await x.go('POST',BASE+'/'+operation,b.cookie,{});assert.equal(r.status,503);assert.deepEqual(r.body,{error:'owner_unavailable'});assert.equal(x.db.prepare('SELECT count(*) n FROM agent_keys').get().n,keys);assert.equal(x.world.trust.delegationVersion(agent.agentId),version);assert.equal(x.world.trust.suspended('00-jolly'),false);assert.equal(x.world.runtime.events().length,events);
});

for(const [path,body] of [['/profile',{expectedRevision:1,displayName:'Changed'}],['/social-status?muse=00-jolly',{expectedRevision:0,mode:'busy'}]])test('logout during '+path+' body reports session loss through reused route error mapping',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);let controller;const stream=new ReadableStream({start(c){controller=c;}}),pending=x.go('PATCH',BASE+path,b.cookie,stream);
 await new Promise(r=>setTimeout(r,20));await x.go('DELETE',BASE+'/session',b.cookie);controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));controller.close();const r=await pending;assert.equal(r.status,401);assert.deepEqual(r.body,{error:'personal_session_required'});assert.equal(x.world.legacyProfile.view().displayName,'ComBba');
});

async function entered(gate){let timer;try{await Promise.race([gate.entered,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('synthetic gate not reached')),3000))]);}finally{clearTimeout(timer);}}
async function ownerMutationSnapshot(x){const {createHash}=await import('node:crypto'),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');return{privateKeys:x.db.prepare('SELECT count(*) n FROM private_keys').get().n,executors:x.db.prepare('SELECT count(*) n FROM executors').get().n,events:x.db.prepare('SELECT count(*) n FROM events').get().n,nonces:x.db.prepare('SELECT count(*) n FROM nonces').get().n,rowHashes:Object.fromEntries(['private_keys','executors','events','nonces'].map(table=>[table,hash(x.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())])),stateHash:hash(x.world.runtime.state())};}
test('special status response cannot restore owner identity after logout during visitor quota await',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);const {issueSession,sessionCookie}=await import('../worker/core/session.ts'),visitor=sessionCookie((await issueSession(x.env.SESSION_SECRET,'visitor')).token).split(';')[0],gate=barrier(),quota=x.world.quota.bind(x.world);
 x.world.quota=async(...args)=>{gate.enter();await gate.wait;return quota(...args);};const before=await ownerMutationSnapshot(x),pending=x.go('GET',BASE+'/status',b.cookie+'; '+visitor);await entered(gate);assert.equal((await x.go('DELETE',BASE+'/session',b.cookie)).status,200);gate.release();const result=await pending;assert.equal(result.status,401);assert.deepEqual(result.body,{error:'personal_session_required'});assert.deepEqual((await x.go('GET',BASE+'/session',b.cookie)).body,{owner:null});assert.deepEqual(await ownerMutationSnapshot(x),before);
});

test('actual P0 peer-card crypto completion after logout stores no peer credential, refusal event or nonce',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);x.world.setClaim('owner-muse',{status:'claimed',path:'synthetic',fingerprint:'synthetic-only'});const {grantItem}=await import('../src/engine/items.ts');
 x.world.runtime.commitExternal(Date.now(),'synthetic-peer-p0',s=>{const owner=s.muses.find(m=>m.id==='00-jolly'),peer=s.muses.find(m=>m.id==='02-moss');for(const m of[owner,peer]){m.place='commons:cafe';m.travel=null;m.beat=null;}grantItem(s.items,owner,'coffee',Date.now(),owner.place,'craft');grantItem(s.items,peer,'fruit',Date.now(),peer.place,'craft');});
 await x.world.trust.executor('00-jolly','server_custodial',JSON.parse(x.env.OWNER_ROOT_JWK));
 const gate=barrier(),sign=crypto.subtle.sign.bind(crypto.subtle);let ecdsa=0;
 crypto.subtle.sign=async(algorithm,...args)=>{if((typeof algorithm==='string'?algorithm:algorithm?.name)==='ECDSA'&&++ecdsa===2){gate.enter();await gate.wait;}return sign(algorithm,...args);};t.after(()=>crypto.subtle.sign=sign);
 const before=await ownerMutationSnapshot(x),pending=x.go('POST',BASE+'/p0/run',b.cookie);await entered(gate);assert.equal((await x.go('DELETE',BASE+'/session',b.cookie)).status,200);gate.release();const result=await pending;assert.equal(result.status,401);assert.deepEqual(result.body,{error:'personal_session_required'});assert.deepEqual(await ownerMutationSnapshot(x),before);
});

test('personal owner logout rejects the first nonempty chunk and cancels without reading a 16MiB body',async t=>{
 const x=await boot(t);let pulls=0,cancelled=false;const stream=new ReadableStream({pull(c){if(pulls<16){pulls++;c.enqueue(new Uint8Array(1024*1024));}else c.close();},cancel(){cancelled=true;}},{highWaterMark:0});
 const r=await x.go('DELETE',BASE+'/session','',stream);assert.equal(r.status,400);assert.deepEqual(r.body,{error:'body_not_allowed'});assert.equal(pulls,1);assert.equal(cancelled,true);
});

test('personal owner logout bounds a pending body reader and cancels it instead of waiting forever',async t=>{
 const x=await boot(t);let controller,cancelled=false,timer;const stream=new ReadableStream({start(c){controller=c;},cancel(){cancelled=true;}},{highWaterMark:0});
 const pending=x.go('DELETE',BASE+'/session','',stream),result=await Promise.race([pending,new Promise(r=>timer=setTimeout(()=>r('pending'),2500))]);clearTimeout(timer);
 if(result==='pending'){controller.close();await pending;}assert.notEqual(result,'pending');assert.equal(result.status,400);assert.equal(cancelled,true);
});

test('a normally closed empty body still performs the same durable personal owner logout',async t=>{
 const x=await boot(t),b=await x.bind();await x.adopt(b);const stream=new ReadableStream({start(c){c.close();}}),r=await x.go('DELETE',BASE+'/session',b.cookie,stream);assert.equal(r.status,200);assert.deepEqual(r.body,{owner:null});assert.deepEqual((await x.go('GET',BASE+'/session',b.cookie)).body,{owner:null});assert.ok(r.cookies.some(c=>c.includes('Path=/api/personal;')&&c.includes('Max-Age=0')));
});
