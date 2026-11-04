// Real Worker/WorldDO + SQLite; every upstream call is a synthetic fetch. No provider or model networking.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {issueSession} from '../worker/core/session.ts';
import {issueOwnerSession} from '../worker/core/owner-session.ts';
import {personalDigest} from '../worker/core/personal-session.ts';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}',shortCircuit:true};return n(s,c);}`));
const ORIGIN='https://musely.net', START='/api/personal/auth/threads/start', CALLBACK='/api/threads/callback', ME='/api/personal/me', LOGOUT='/api/personal/session';
const OWNER='synthetic-owner-control-token-0000000001';
const H={origin:ORIGIN,'sec-fetch-site':'same-origin'};
const cookie=(r,name)=>r.headers.getSetCookie().find(x=>x.startsWith(name+'='))?.split(';')[0];
const dbText=db=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({name})=>[name,db.prepare('SELECT * FROM '+name).all()]));
async function boot(t,override={}){
 const {default:worker,WorldDO}=await import('../worker/index.ts');const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,ready,alarm=null;
 const sql={exec(q,...b){if(/^\s*(BEGIN|SAVEPOINT|RELEASE|COMMIT|ROLLBACK)/i.test(q))throw Error('transactionSync required');const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};}};
 const transactionSync=fn=>{const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const v=fn();assert.ok(!v?.then);db.exec('RELEASE '+n);return v;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}};
 const ctx={storage:{sql,transactionSync,getAlarm:async()=>alarm,setAlarm:async x=>{alarm=x;}},blockConcurrencyWhile:fn=>(ready=fn())};
 const env={MODEL_ID:'synthetic-model',MODEL_BASE:'https://not-called.invalid/v1',DAILY_BUDGET_USD:'1',PUBLIC_ORIGIN:ORIGIN,ALLOWED_HOSTS:'musely.net,www.musely.net',SESSION_SECRET:'synthetic-personal-session-secret',OWNER_CONTROL_TOKEN:OWNER,THREADS_APP_ID:'123456789',THREADS_APP_SECRET:'synthetic-provider-secret',...override};
 let dobj;
 const restart=async()=>{dobj=new WorldDO(ctx,env);await ready;env.WORLD={idFromName:()=> 'world',get:()=>dobj};};await restart();env.ASSETS={fetch:async()=>new Response('asset')};
 const go=(method,path,headers={},body)=>worker.fetch(new Request(ORIGIN+path,{method,headers,body,...(body instanceof ReadableStream?{duplex:"half"}:{})}),env);
 return{env,db,go,restart,get dobj(){return dobj;}};
}
const start=async t=>{const r=await t.go('POST',START,H);assert.equal(r.status,200,'personal login start must exist');const b=await r.json();const u=new URL(b.authorizationUrl);assert.equal(u.origin,'https://threads.com');assert.equal(u.pathname,'/oauth/authorize');assert.equal(u.searchParams.get('scope'),'threads_basic');assert.equal(u.searchParams.get('redirect_uri'),ORIGIN+CALLBACK);assert.equal(u.searchParams.get('response_type'),'code');assert.match(u.searchParams.get('state'),/^personal-v1\.[A-Za-z0-9_-]{43}$/);const c=cookie(r,'musely_pf');assert.ok(c);assert.match(c? r.headers.get('set-cookie'):'',/Path=\/api\/threads;/);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);assert.equal(r.headers.get('cache-control'),'no-store');return{r,b,u,c,state:u.searchParams.get('state')};};
function provider(t,options={}){
 const old=globalThis.fetch,calls=[];t.after(()=>{globalThis.fetch=old;});globalThis.fetch=async(url,init)=>{
  calls.push({url:String(url),init});const u=new URL(url);
  if(options.fetcher)return options.fetcher(u,init,calls);
  if(u.pathname==='/oauth/access_token')return new Response(JSON.stringify(options.token??{access_token:'synthetic-private-provider-token',token_type:'bearer',user_id:123456789}));
  if(u.pathname==='/v1.0/me')return new Response(JSON.stringify(options.me??{id:'987654321',username:'synthetic-handle'}));
  throw Error('unexpected external request');
 };return calls;
}
const callback=(t,f,code='synthetic-code')=>t.go('GET',CALLBACK+'?'+new URLSearchParams({state:f.state,code}),{cookie:f.c});
const login=async t=>{const f=await start(t),r=await callback(t,f);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/?personal=authenticated');const c=cookie(r,'musely_p');assert.ok(c);return{f,r,c};};
const snapshot=t=>JSON.stringify(t.dobj.worldRun());

test('personal start/basic-only→callback→pure me/logout; tokens never stored, no actor/key/claim/world entry',async t=>{
 const a=await boot(t),calls=provider(t);const before=dbText(a.db),run=snapshot(a);const f=await start(a);assert.equal(calls.length,0);
 const body=JSON.stringify(f.b);assert.doesNotMatch(body,/synthetic-provider-secret|content_publish/);
 assert.ok(!dbText(a.db).includes(f.state));assert.ok(!dbText(a.db).includes(f.c.split('=')[1]));
 const r=await callback(a,f);assert.equal(r.status,303);const c=cookie(r,'musely_p');assert.ok(c);assert.match(r.headers.getSetCookie().find(x=>x.startsWith('musely_p=')),/HttpOnly; Secure; SameSite=Strict/);
 assert.equal(calls.length,2);assert.equal(calls[0].url,'https://graph.threads.com/oauth/access_token');assert.equal(calls[0].init.method,'POST');const form=new URLSearchParams(calls[0].init.body);assert.equal(form.get('code'),'synthetic-code');assert.equal(form.get('redirect_uri'),ORIGIN+CALLBACK);assert.equal(calls[1].url.split('?')[0],'https://graph.threads.com/v1.0/me');
 for(const q of calls){assert.equal(q.init.credentials,'omit');assert.equal(q.init.redirect,'manual');assert.equal(q.init.cache,'no-store');assert.ok(q.init.signal);}
 const p=a.db.prepare('SELECT * FROM personal_principals').get();assert.equal(p.subject,'123456789:987654321');assert.equal(p.provider,'threads');
 assert.doesNotMatch(dbText(a.db),/synthetic-private-provider-token|synthetic-code|synthetic-provider-secret|synthetic-handle/);
 for(const table of ['personal_actors','personal_profiles','personal_registrations','claims'])assert.equal(a.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
 const dbBefore=dbText(a.db),me=await a.go('GET',ME,{cookie:c});assert.deepEqual(await me.json(),{authenticated:true,expiresAt:p.created_at+3600000,entry:{state:'viewing'}});assert.equal(dbText(a.db),dbBefore);assert.equal(calls.length,2);assert.equal(snapshot(a),run);
 const logout=await a.go('DELETE',LOGOUT,{...H,cookie:c});assert.equal(logout.status,200);assert.deepEqual(await (await a.go('GET',ME,{cookie:c})).json(),{authenticated:false,entry:{state:'viewing'}});assert.equal(a.db.prepare('SELECT count(*) n FROM personal_principals').get().n,1);assert.notEqual(before,dbText(a.db));
});

test('callback is atomically consumed before provider await: same flow parallel/replay creates only one session',async t=>{
 const a=await boot(t);let release;const barrier=new Promise(r=>{release=r;});let reached;const entered=new Promise(r=>{reached=r;});const calls=provider(t,{fetcher:async(u)=>{if(u.pathname==='/oauth/access_token'){reached();await barrier;return new Response('{"access_token":"private"}');}return new Response('{"id":"42"}');}});
 const f=await start(a);const first=callback(a,f);await entered;const second=await callback(a,f);assert.equal(second.status,400);assert.equal(calls.length,1);release();assert.equal((await first).status,303);assert.equal((await callback(a,f)).status,400);assert.equal(calls.length,2);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_auth_sessions').get().n,1);
});

test('state/browser/TTL/app/redirect/purpose tampering and duplicate callback parameters reject before exchange',async t=>{
 const a=await boot(t),calls=provider(t);for(const change of ['browser','state','expiry','app','redirect','purpose','duplicate']){
  const f=await start(a);let path=CALLBACK+'?'+new URLSearchParams({state:f.state,code:'valid'}),c=f.c;
  if(change==='browser')c='musely_pf='+ 'a'.repeat(43);if(change==='state')path=path.replace(f.state,'personal-v1.'+'b'.repeat(43));if(change==='duplicate')path+='&state='+f.state;
  const columns={expiry:['expires_at',0],app:['app_id','other'],redirect:['redirect_uri','https://evil.invalid/'],purpose:['purpose','claim']};if(columns[change])a.db.prepare('UPDATE personal_auth_flows SET '+columns[change][0]+'=?').run(columns[change][1]);
  assert.equal((await a.go('GET',path,{cookie:c})).status,400,change);
 }assert.equal(calls.length,0);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_principals').get().n,0);
});

test('cancelled/failed provider flow is single-use with fixed safe errors and no raw canary logs',async t=>{
 const a=await boot(t);const logs=[],old=console.error;t.after(()=>console.error=old);console.error=(...x)=>logs.push(x);const calls=provider(t,{fetcher:()=>{throw Error('PRIVATE_PROVIDER_CANARY');}});
 const f=await start(a),r=await callback(a,f);assert.equal(r.status,303);assert.equal(new URL(r.headers.get('location'),ORIGIN).searchParams.get('personal'),'failed');assert.doesNotMatch(await r.text(),/PRIVATE|synthetic-code/);assert.equal((await callback(a,f)).status,400);assert.equal(calls.length,1);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE|synthetic-code/);assert.ok(logs.length>=1);
 const c=await start(a),cancel=await a.go('GET',CALLBACK+'?'+new URLSearchParams({state:c.state,error:'access_denied',error_description:'PRIVATE_CANCEL'}),{cookie:c.c});assert.equal(cancel.status,303);assert.equal(cancel.headers.get('location'),'/?personal=declined');assert.equal((await callback(a,c)).status,400);assert.equal(calls.length,1);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_principals').get().n,0);
});

test('identity is app-scoped id, not mutable username or client principal; auth versions revoke all old sessions',async t=>{
 const a=await boot(t);let id='42',handle='first';provider(t,{fetcher:async u=>new Response(JSON.stringify(u.pathname==='/oauth/access_token'?{access_token:'private'}:{id,username:handle}))});
 const x=await login(a);handle='renamed';const y=await login(a);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_principals').get().n,1);
 const principal=a.db.prepare('SELECT id FROM personal_principals').get().id;
 a.db.prepare('UPDATE personal_principals SET auth_version=auth_version+1 WHERE id=?').run(principal);
 for(const c of [x.c,y.c])assert.equal((await (await a.go('GET',ME,{cookie:c})).json()).authenticated,false);
 id='99';await login(a);a.env.THREADS_APP_ID='555555';await login(a);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_principals').get().n,3);
});

test('legacy cookies never authenticate personal or inherit authority; Origin and no-body guards fail closed',async t=>{
 const a=await boot(t),calls=provider(t);const judge=(await issueSession(a.env.SESSION_SECRET,'judge')).token;const owner=(await issueOwnerSession(a.env.SESSION_SECRET,{owner:OWNER},'owner')).token;
 for(const c of ['musely_s='+judge,'musely_o='+owner,'musely_p='+owner,'musely_p='+judge])assert.equal((await(await a.go('GET',ME,{cookie:c})).json()).authenticated,false);
 for(const headers of [{},{origin:'https://evil.invalid'}, {...H,'sec-fetch-site':'cross-site'}]){assert.equal((await a.go('POST',START,headers)).status,403);assert.equal((await a.go('DELETE',LOGOUT,headers)).status,403);}
 assert.equal((await a.go('POST',START,H,'{"principal":"owner"}')).status,400);assert.equal((await a.go('GET',START)).status,405);assert.equal(calls.length,0);
 const {c}=await login(a);for(const name of ['musely_o','musely_s']){const r=await a.go('GET',name==='musely_o'?'/api/owner/session':'/api/status',{cookie:name+'='+c.split('=')[1]});const b=await r.json();assert.equal(name==='musely_o'?b.owner:b.session,null);}
 assert.equal((await a.go('POST','/api/agent-keys',{...H,cookie:c},'{}')).status,401);
});

test('session signature/expiry/sid revocation and restart preserve subject mapping without GET mutations',async t=>{
 const a=await boot(t);provider(t);const {c}=await login(a);const tables=dbText(a.db);await a.restart();assert.equal(dbText(a.db),tables);assert.equal((await (await a.go('GET',ME,{cookie:c})).json()).authenticated,true);
 assert.equal((await (await a.go('GET',ME,{cookie:c+'x'})).json()).authenticated,false);
 assert.equal((await (await a.go('GET',ME,{cookie:c+'; '+c})).json()).authenticated,false);
 a.db.prepare('UPDATE personal_auth_sessions SET expires_at=0').run();assert.equal((await(await a.go('GET',ME,{cookie:c})).json()).authenticated,false);
});

test('provider malformed/HTTP/redirect/oversize responses never create a principal or token row and do not retry',async t=>{
 const a=await boot(t);let mode='http';const calls=provider(t,{fetcher:async u=>{
  if(mode==='http')return new Response('{"error":{"message":"PRIVATE_PROVIDER_ERR_CANARY"}}',{status:400});
  if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://evil.invalid/'}});
  if(mode==='large')return new Response('x'.repeat(65537));
  if(mode==='invalid-json')return new Response('not json');
  if(u.pathname==='/oauth/access_token')return new Response('{"access_token":"SECRET_TOKEN_CANARY"}');
  return new Response(JSON.stringify({id:mode==='numeric-id'?9007199254740993:''}));
 }});
 for(mode of ['http','redirect','large','invalid-json','numeric-id','missing-id']){const n=calls.length,f=await start(a),r=await callback(a,f);assert.equal(new URL(r.headers.get('location'),ORIGIN).searchParams.get('personal'),'failed',mode);assert.equal(calls.length-n,mode==='numeric-id'||mode==='missing-id'?2:1);}
 assert.equal(a.db.prepare('SELECT count(*) n FROM personal_principals').get().n,0);assert.doesNotMatch(dbText(a.db),/PRIVATE_PROVIDER_ERR_CANARY|SECRET_TOKEN_CANARY|synthetic-code/);
});

test('shared registered callback routes only prefixed state to personal; cookie presence cannot switch legacy claim semantics',async t=>{
 const a=await boot(t),calls=provider(t,{fetcher:async()=>new Response('{"error":{"message":"synthetic legacy rejection"}}',{status:400})});
 const personal=await start(a),old=await a.go('GET','/api/threads/start');assert.equal(old.status,302);const legacy=new URL(old.headers.get('location')),oldCookie=cookie(old,'musely_ts');assert.ok(oldCookie);assert.equal(legacy.searchParams.get('scope'),'threads_basic,threads_content_publish');assert.equal(legacy.searchParams.get('redirect_uri'),ORIGIN+CALLBACK);
 const oldError=console.error;console.error=()=>{};try{
  const r=await a.go('GET',CALLBACK+'?'+new URLSearchParams({state:legacy.searchParams.get('state'),code:'synthetic-bad-claim-code'}),{cookie:oldCookie+'; '+personal.c});assert.equal(r.status,302);assert.match(r.headers.get('location'),/^\/\?claim=failed&step=exchange/);assert.equal(new URL(calls[0].url).origin,'https://graph.threads.net');
 }finally{console.error=oldError;}
 const count=calls.length;
 assert.equal((await a.go('GET',CALLBACK+'?'+new URLSearchParams({state:personal.state,code:'synthetic'}),{cookie:oldCookie})).status,400,'legacy cookie cannot bind personal flow');
 assert.equal((await a.go('GET',CALLBACK+'?state='+legacy.searchParams.get('state')+'&state='+personal.state+'&code=synthetic',{cookie:oldCookie+'; '+personal.c})).status,400,'mixed duplicate state cannot downgrade to legacy');
 assert.equal((await a.go('GET',CALLBACK+'?state=personal-v1.bad&code=synthetic',{cookie:oldCookie+'; '+personal.c})).status,400);
 assert.equal(calls.length,count);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_principals').get().n,0);
});

test('provider secret availability never bypasses durable local logout of an already-verified session',async t=>{
 const a=await boot(t),calls=provider(t),{c}=await login(a);delete a.env.THREADS_APP_SECRET;
 assert.equal((await (await a.go('GET',ME,{cookie:c})).json()).authenticated,true,'local session is independent of provider token credentials');
 assert.equal((await a.go('POST',START,H)).status,503);
 assert.equal((await a.go('DELETE',LOGOUT,{...H,cookie:c})).status,200);
 a.env.THREADS_APP_SECRET='synthetic-provider-secret';assert.equal((await (await a.go('GET',ME,{cookie:c})).json()).authenticated,false,'restoring provider config must not resurrect a logged-out sid');assert.equal(calls.length,2);
 const fresh=await login(a),appId=a.env.THREADS_APP_ID;delete a.env.THREADS_APP_ID;assert.equal((await a.go('DELETE',LOGOUT,{...H,cookie:fresh.c})).status,503,'missing local binding cannot report durable logout success');a.env.THREADS_APP_ID=appId;assert.equal((await(await a.go('GET',ME,{cookie:fresh.c})).json()).authenticated,true);
});

// Cloudflare presents real empty HTTP writes as closed non-null streams.
test('closed empty HTTP streams permit personal start and logout without granting world entry',async t=>{
 const a=await boot(t),calls=provider(t),empty=()=>new ReadableStream({start(c){c.close();}});
 const startAnswer=await a.go('POST',START,H,empty());assert.equal(startAnswer.status,200);assert.ok((await startAnswer.json()).authorizationUrl);
 const u=await login(a);const out=await a.go('DELETE',LOGOUT,{...H,cookie:u.c},empty());assert.equal(out.status,200);assert.equal((await(await a.go('GET',ME,{cookie:u.c})).json()).authenticated,false);assert.equal(calls.length,2);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_actors').get().n,0);
});
test('nonempty and errored HTTP streams fail closed before personal auth state changes',async t=>{
 const a=await boot(t),calls=provider(t);for(const method of ['POST','DELETE'])for(const kind of ['data','error']){let cancelled=false;const stream=new ReadableStream({start(c){if(kind==='error')c.error(Error('synthetic stream error'));else c.enqueue(new Uint8Array([0]));},cancel(){cancelled=true;}});const r=await a.go(method,method==='POST'?START:LOGOUT,H,stream);assert.equal(r.status,400);assert.equal((await r.json()).error,'body_not_allowed');if(kind==='data')assert.equal(cancelled,true);}
 assert.equal(calls.length,0);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_auth_flows').get().n,0);
});

test('stalled empty-write stream is bounded and cancelled without a durable auth flow',{timeout:3000},async t=>{
 const a=await boot(t);let cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true;}});const r=await a.go('POST',START,H,stream);assert.equal(r.status,400);assert.equal(cancelled,true);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_auth_flows').get().n,0);
});

test('failed callback persists only bounded diagnostic categories and numeric Meta details, never private provider data',async t=>{
 const a=await boot(t),logs=[];const old=console.error;t.after(()=>console.error=old);console.error=(...x)=>logs.push(x);
 provider(t,{fetcher:()=>new Response(JSON.stringify({error:{message:'PRIVATE_DIAGNOSTIC_CANARY',code:100,error_subcode:10,fbtrace_id:'PRIVATE_TRACE_CANARY'}}),{status:400})});
 const f=await start(a),r=await callback(a,f);
 assert.equal(r.status,303);assert.equal(new URL(r.headers.get('location'),ORIGIN).searchParams.get('personal'),'failed');
 const row=a.db.prepare('SELECT * FROM personal_auth_flows').get();
 assert.equal(row.failure_reason,'token_exchange_http_4xx');assert.equal(row.failure_meta_code,100);assert.equal(row.failure_meta_subcode,10);assert.ok(row.failed_at>=row.consumed_at);
 assert.ok(logs.some(x=>JSON.stringify(x).includes('token_exchange_http_4xx')));
 assert.doesNotMatch(JSON.stringify(logs)+dbText(a.db),/PRIVATE_DIAGNOSTIC_CANARY|PRIVATE_TRACE_CANARY|synthetic-code|synthetic-private-provider-token/);
 const before=JSON.stringify(row);assert.equal((await callback(a,f)).status,400);assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM personal_auth_flows').get()),before,'replay cannot overwrite first failure');
});

test('me failure and session persistence failure remain distinguishable without authenticating or leaking',async t=>{
 const a=await boot(t),logs=[];const old=console.error;t.after(()=>console.error=old);console.error=(...x)=>logs.push(x);
 let mode='me';provider(t,{fetcher:u=>u.pathname==='/oauth/access_token'?new Response('{"access_token":"PRIVATE_TOKEN_CANARY"}'):mode==='me'?new Response('{"error":{"code":190,"message":"PRIVATE_ME_CANARY"}}',{status:400}):new Response('{"id":"42"}')});
 let f=await start(a),r=await callback(a,f);assert.equal(r.status,303);assert.equal(a.db.prepare('SELECT failure_reason FROM personal_auth_flows WHERE state_digest=?').get(await (await import('../worker/core/personal-session.ts')).personalDigest('state',f.state)).failure_reason,'me_fetch_failed');
 mode='store';const original=a.dobj.personalAuthComplete;a.dobj.personalAuthComplete=()=>{throw Error('PRIVATE_STORE_CANARY');};
 f=await start(a);r=await callback(a,f);a.dobj.personalAuthComplete=original;assert.equal(r.status,303);
 const rows=a.db.prepare('SELECT failure_reason FROM personal_auth_flows ORDER BY created_at').all();assert.deepEqual(rows.map(x=>x.failure_reason),['me_fetch_failed','session_store_failed']);
 assert.equal(cookie(r,'musely_p'),undefined);assert.doesNotMatch(JSON.stringify(logs)+dbText(a.db),/PRIVATE_TOKEN_CANARY|PRIVATE_ME_CANARY|PRIVATE_STORE_CANARY/);
});

test('session signing failure and diagnostic SQL outage still return a safe failed redirect with no session cookie',async t=>{
 const a=await boot(t),logs=[];const old=console.error;t.after(()=>console.error=old);console.error=(...x)=>logs.push(x);provider(t);
 const complete=a.dobj.personalAuthComplete.bind(a.dobj);a.dobj.personalAuthComplete=(...args)=>({...complete(...args),issuedAt:-1});
 let f=await start(a),r=await callback(a,f);assert.equal(r.status,303);assert.equal(cookie(r,'musely_p'),undefined);
 assert.equal(a.db.prepare('SELECT failure_reason FROM personal_auth_flows').get().failure_reason,'session_sign_failed');
 a.dobj.personalAuthFailure=()=>{throw Error('PRIVATE_DIAGNOSTIC_SQL_CANARY');};f=await start(a);r=await callback(a,f);assert.equal(r.status,303);assert.equal(cookie(r,'musely_p'),undefined);
 assert.ok(JSON.stringify(logs).includes('personal_auth_diagnostic_store_failed'));assert.doesNotMatch(JSON.stringify(logs)+await r.text(),/PRIVATE_DIAGNOSTIC_SQL_CANARY|synthetic-code/);
});

test('provider HTTP 5xx and malformed numeric diagnostics stay bounded without retry',async t=>{
 const a=await boot(t),logs=[];const old=console.error;t.after(()=>console.error=old);console.error=(...x)=>logs.push(x);
 const calls=provider(t,{fetcher:()=>new Response('{"error":{"code":"PRIVATE_NUMBER_CANARY","error_subcode":2147483648}}',{status:503})});
 const f=await start(a),r=await callback(a,f);assert.equal(r.status,303);assert.equal(calls.length,1);
 const row=a.db.prepare('SELECT * FROM personal_auth_flows').get();assert.equal(row.failure_reason,'token_exchange_http_5xx');assert.equal(row.failure_meta_code,null);assert.equal(row.failure_meta_subcode,null);assert.doesNotMatch(JSON.stringify(logs)+dbText(a.db),/PRIVATE_NUMBER_CANARY/);
});

test('browser invalid callback shows a safe route back while keeping HTTP400 and zero provider calls',async t=>{
 const a=await boot(t),calls=provider(t),r=await a.go('GET',CALLBACK+'?state=personal-v1.invalid&code=PRIVATE_URL_CANARY',{accept:'text/html'});
 assert.equal(r.status,400);assert.match(r.headers.get('content-type'),/text\/html/);const html=await r.text();assert.match(html,/href="\/"/);assert.doesNotMatch(html,/PRIVATE_URL_CANARY|<script/);assert.equal(calls.length,0);
});

test('state consume RPC failure after a durable commit is logged and guided without re-exchange or auth cookie',async t=>{
 const a=await boot(t),logs=[];const old=console.error;t.after(()=>console.error=old);console.error=(...x)=>logs.push(x);const calls=provider(t);
 const consume=a.dobj.personalAuthConsume.bind(a.dobj);a.dobj.personalAuthConsume=(...args)=>{consume(...args);throw Error('PRIVATE_CONSUME_RPC_CANARY');};
 const f=await start(a),r=await callback(a,f);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/?personal=failed');assert.equal(cookie(r,'musely_p'),undefined);assert.equal(calls.length,0);
 const row=a.db.prepare('SELECT * FROM personal_auth_flows').get();assert.equal(row.failure_reason,null,'ambiguous ownership is logged without changing the flow');assert.match(JSON.stringify(logs),/state_store_failed/);assert.doesNotMatch(JSON.stringify(logs)+dbText(a.db),/PRIVATE_CONSUME_RPC_CANARY|synthetic-code/);
});

test('ambiguous replay consume RPC cannot mark the valid in-flight callback failed',async t=>{
 const a=await boot(t),logs=[];const old=console.error;t.after(()=>console.error=old);console.error=(...x)=>logs.push(x);
 let release,entered;const held=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 provider(t,{fetcher:async u=>{if(u.pathname==='/oauth/access_token'){entered();await held;return new Response('{"access_token":"synthetic-private"}');}return new Response('{"id":"42"}');}});
 const consume=a.dobj.personalAuthConsume.bind(a.dobj);a.dobj.personalAuthConsume=(...args)=>{const ok=consume(...args);if(!ok)throw Error('PRIVATE_REPLAY_RPC_CANARY');return ok;};
 const f=await start(a),first=callback(a,f);await ready;const replay=await callback(a,f);release();const r=await first;
 assert.equal(replay.status,303);assert.equal(r.status,303);assert.ok(cookie(r,'musely_p'));assert.equal(a.db.prepare('SELECT * FROM personal_auth_flows').get().failed_at,null);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_auth_sessions').get().n,1);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_REPLAY_RPC_CANARY/);
});

test('valid personal cancellation uses error_reason presence once and rejects mixed or duplicate query fields before provider work',async t=>{
 const a=await boot(t),calls=provider(t);
 for(const query of [{error_reason:'PRIVATE_REASON_CANARY'},{error:'PRIVATE_ERROR_CANARY',error_reason:'PRIVATE_REASON_CANARY'},{error_reason:''}]){
  const f=await start(a),r=await a.go('GET',CALLBACK+'?'+new URLSearchParams({state:f.state,...query}),{cookie:f.c,accept:'text/html'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/?personal=declined');assert.equal(cookie(r,'musely_p'),undefined);assert.doesNotMatch(await r.text(),/PRIVATE_(?:REASON|ERROR)_CANARY/);const flow=a.db.prepare('SELECT failure_reason,consumed_at FROM personal_auth_flows WHERE state_digest=?').get(await personalDigest('state',f.state));assert.equal(flow.failure_reason,'provider_declined');assert.ok(flow.consumed_at);assert.equal((await callback(a,f)).status,400);
 }
 for(const suffix of ['code=synthetic&error_reason=cancel','error_reason=one&error_reason=two','error=one&error=two','error_description=one&error_description=two']){
  const f=await start(a),r=await a.go('GET',CALLBACK+'?state='+encodeURIComponent(f.state)+'&'+suffix,{cookie:f.c,accept:'text/html'});assert.equal(r.status,400);const row=a.db.prepare('SELECT consumed_at FROM personal_auth_flows ORDER BY created_at DESC,rowid DESC LIMIT 1').get();assert.equal(row.consumed_at,null);
 }
 assert.equal(calls.length,0);assert.equal(a.db.prepare('SELECT count(*) n FROM personal_auth_sessions').get().n,0);
});

test('state-less cancellation has a fixed browser return link while the legacy JSON400 contract and zero-auth boundary stay intact',async t=>{
 const a=await boot(t),calls=provider(t),before=dbText(a.db);
 for(const query of ['error=PRIVATE_ERROR_CANARY','error_reason=PRIVATE_REASON_CANARY','error=one&error_reason=two']){
  const r=await a.go('GET',CALLBACK+'?'+query,{accept:'text/html'});assert.equal(r.status,400);assert.match(r.headers.get('content-type'),/text\/html/);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.match(await r.text(),/href="\/"/);assert.equal(r.headers.get('location'),null);assert.equal(r.headers.getSetCookie().length,0);
  const api=await a.go('GET',CALLBACK+'?'+query,{accept:'application/json'});assert.equal(api.status,400);assert.deepEqual(await api.json(),{error:'state_mismatch'});
 }
 assert.equal(dbText(a.db),before);assert.equal(calls.length,0);
});
