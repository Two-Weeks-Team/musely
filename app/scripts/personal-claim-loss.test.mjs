// Real Worker/WorldDO + SQLite; every upstream call is a synthetic fetch. No provider or model networking.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
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
function provider(t){const calls=[],old=globalThis.fetch;let expected='',subject='987654321';const tokens=new Map();t.after(()=>{globalThis.fetch=old;});globalThis.fetch=async(url,init)=>{calls.push({path:new URL(url).pathname});const u=new URL(url);if(u.pathname==='/oauth/access_token'){const token='SYNTHETIC_SHORT_CLAIM_CANARY_'+subject;tokens.set(token,subject);return new Response(JSON.stringify({access_token:token,token_type:'bearer'}));}if(u.pathname==='/v1.0/me')return new Response(JSON.stringify({id:tokens.get(u.searchParams.get('access_token'))??subject,username:'synthetic-handle'}));if(u.pathname==='/v1.0/me/threads')return new Response(JSON.stringify({data:[{id:'123400001',text:expected,permalink:'https://www.threads.com/@synthetic-handle/post/Synthetic1',username:'synthetic-handle',owner:{id:subject}}]}));if(u.pathname==='/access_token')return new Response(JSON.stringify({access_token:'SYNTHETIC_LONG_CLAIM_CANARY_'+subject,token_type:'bearer',expires_in:5184000}));throw Error('unexpected external call');};return{calls,setText:s=>expected=s,setSubject:s=>subject=s};}
const callback=(t,f,code='synthetic-code')=>t.go('GET',CALLBACK+'?'+new URLSearchParams({state:f.state,code}),{cookie:f.c});
const login=async t=>{const f=await start(t),r=await callback(t,f);assert.equal(r.status,303);const c=cookie(r,'musely_p');assert.ok(c);return{f,r,c};};

const jsonHeaders=c=>({...H,cookie:c,'content-type':'application/json'});
async function participant(a,up,subject,displayName){up.setSubject(subject);const u=await login(a),h=jsonHeaders(u.c);const d=await a.go('POST','/api/personal/draft',h,JSON.stringify({operationId:'draft-'+subject,displayName,appearanceId:'00-jolly'}));assert.equal(d.status,200);const profile=(await d.json()).profile;const desc=await(await a.go('GET','/api/personal/claim',{cookie:u.c})).json();up.setText(desc.text);const begin=await a.go('POST','/api/personal/claim/start',h,JSON.stringify({expectedVersion:0}));assert.equal(begin.status,200);const state=new URL((await begin.json()).authorizationUrl).searchParams.get('state'),c=cookie(begin,'musely_pcf');assert.equal((await callback(a,{state,c},'claim-'+subject)).headers.get('location'),'/?personalClaim=claimed');
 assert.equal((await a.go('POST','/api/personal/authority',h,JSON.stringify({expectedVersion:0,scopes:['world_entry','walk_and_greet','world_item_trade','world_invite']}))).status,200);const k=await(await a.go('POST','/api/personal/keys',h,JSON.stringify({operationId:'key-'+subject,expectedVersion:1}))).json();const at=await(await a.go('POST','/api/personal/entry-attempts',h,JSON.stringify({operationId:'entry-'+subject,keyId:k.row.id,expectedGrantVersion:1,expectedProfileRevision:1,worldId:a.dobj.worldView().worldId}))).json();const {hashAgentKey}=await import('../worker/core/agent-keys.ts');const hash=await hashAgentKey(k.key),call=async(name,args={})=>{const r=await a.dobj.mcp(hash,'tools/call',{name,arguments:args},false);assert.equal(r.status,'ok');return r.result;};assert.equal((await call('enter_world',{attempt_id:at.attempt.id,command_id:'enter-'+subject})).structuredContent.ok,true);return{profile,h,call,cookie:u.c};}
async function setup(t){const a=await boot(t),up=provider(t),one=await participant(a,up,'987654321','One');return{a,one,up,id:one.profile.actorId};}
function pending(a,id){const at=Date.now();a.dobj.runtime.commitExternal(at,'synthetic-pending-only',s=>{
 const task=(tid,kind,from,to,status='pending')=>({id:tid,kind,from,to,status,awaiting:status==='pending'?to:null,createdAt:at,deadline:at+600000,updatedAt:at,round:0,history:[],...(kind==='trade'?{offer:{by:from,give:'coffee',want:'pastry'}}:kind==='meetup'?{candidates:[],stage:'owner_approval',answers:{[from]:'accept',[to]:'accept'}}:{help:{service:'repair',item:'gadget',part:null,asked:false,result:null,note:null}})});
 s.inbox.tasks.push(task('task_in','trade','09-copper',id),task('task_out','help',id,'04-ember'),task('task_meet','meetup',id,'02-moss'),task('task_closed','trade',id,'09-copper','completed'),task('task_other','trade','00-jolly','09-copper'));
 const invite=(iid,from,to,status='open')=>({id:iid,from,to:[to],place:'commons:campfire',note:'SYNTHETIC_PRIVATE_NOTE',at,expiresAt:at+600000,status,answers:{[to]:{answer:'accept',via:'live',at,comingAt:at}}});
 (s.inbox.invites??=[]).push(invite('invite_out',id,'09-copper'),invite('invite_in','09-copper',id),invite('invite_closed',id,'04-ember','gathered'),invite('invite_other','04-ember','09-copper'));
 const m=s.muses.find(m=>m.id===id);m.travel={to:'commons:garden',departAt:at,arriveAt:at+60000,speed:'walk'};
 });}
const state=a=>a.dobj.runtime.state();
const preserve=a=>{const s=state(a);return JSON.stringify({muses:s.muses,paused:s.paused,connected:s.inbox.connected,agents:a.db.prepare('SELECT * FROM agents').all(),keys:a.db.prepare('SELECT * FROM personal_authority_keys').all(),grants:a.db.prepare('SELECT * FROM personal_authority').all(),profiles:a.db.prepare('SELECT * FROM personal_profiles').all()});};
const revoke=(a,one,v=1)=>a.go('DELETE','/api/personal/claim',one.h,JSON.stringify({expectedVersion:v}));
const events=a=>a.dobj.worldEvents(0,2000);

test('WorldDO installs real lazy refresh and confirmed owner claim-loss callback',async t=>{
 const {a,one,id}=await setup(t);let ids=[];const refresh=a.dobj.personalClaims.refresh.bind(a.dobj.personalClaims);a.dobj.personalClaims.refresh=async x=>{ids.push(x);return refresh(x);};await a.dobj.trust.refreshPersonalClaims([id,id,'00-jolly']);assert.deepEqual(ids,[id]);
 pending(a,id);const old=state(a),protectedState=preserve(a),beforeEvents=events(a).length;
 const response=await revoke(a,one);assert.equal(response.status,200);assert.equal((await response.json()).status,'claim_revoked');
 const s=state(a);assert.equal(s.version,old.version+1);assert.equal(preserve(a),protectedState);
 for(const tid of ['task_in','task_out','task_meet']){const task=s.inbox.tasks.find(x=>x.id===tid);assert.equal(task.status,'cancelled');assert.equal(task.awaiting,null);assert.equal(task.history.at(-1).action,'cancel');}
 for(const tid of ['task_closed','task_other'])assert.deepEqual(s.inbox.tasks.find(x=>x.id===tid),old.inbox.tasks.find(x=>x.id===tid));
 assert.equal(s.inbox.invites.find(x=>x.id==='invite_out').status,'cancelled');assert.deepEqual(s.inbox.invites.find(x=>x.id==='invite_in').answers[id].answer,'unavailable');assert.equal(s.inbox.invites.find(x=>x.id==='invite_in').answers[id].comingAt,undefined);
 for(const iid of ['invite_closed','invite_other'])assert.deepEqual(s.inbox.invites.find(x=>x.id===iid),old.inbox.invites.find(x=>x.id===iid));
 const added=events(a).slice(beforeEvents);assert.equal(added.length,5);for(const e of added){assert.equal(e.data.reason,'claim_revoked');assert.doesNotMatch(JSON.stringify(e),/SYNTHETIC_|subject|token|post_id|principal|fingerprint|claim-flow/i);}
 const n=events(a).length,v=s.version;assert.equal((await revoke(a,one,2)).status,200);assert.equal(state(a).version,v);assert.equal(events(a).length,n,'repeat changes no world log');
});
test('confirmed loss with no affected world work commits no world version/event',async t=>{const {a,one}=await setup(t),s=JSON.stringify(state(a)),n=events(a).length;assert.equal((await revoke(a,one)).status,200);assert.equal(JSON.stringify(state(a)),s);assert.equal(events(a).length,n);});
for(const failure of ['world','event'])test('claim and world together roll back on '+failure+' SQL failure',async t=>{
 const {a,one,id}=await setup(t);pending(a,id);const before=dbText(a.db),world=JSON.stringify(state(a));
 a.db.exec(failure==='world'?"CREATE TEMP TRIGGER reject_loss BEFORE UPDATE ON world BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SQL_FAILURE'); END":"CREATE TEMP TRIGGER reject_loss BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SQL_FAILURE'); END");
 const response=await revoke(a,one);assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/SYNTHETIC_SQL_FAILURE/);assert.equal(dbText(a.db),before);assert.equal(JSON.stringify(state(a)),world);assert.equal(a.dobj.trust.personalClaim(id).claimed,true);
 a.db.exec('DROP TRIGGER reject_loss');assert.equal((await revoke(a,one)).status,200);assert.equal(state(a).inbox.tasks.find(x=>x.id==='task_in').status,'cancelled');
});
for(const result of ['missing','mismatch','unavailable'])test('refresh after temporary unavailable handles '+result+' without pausing or revoking authority',async t=>{
 const {a,id}=await setup(t);pending(a,id);a.db.prepare("UPDATE personal_claims SET status='unavailable',checked_at=0 WHERE actor_id=?").run(id);const protectedState=preserve(a),v=state(a).version;let calls=0;
 globalThis.fetch=async url=>{calls++;const u=new URL(url);if(u.pathname==='/v1.0/me')return new Response(JSON.stringify({id:'987654321',username:'synthetic-handle'}));assert.equal(u.pathname,'/v1.0/123400001');if(result==='missing')return new Response('{}',{status:404});if(result==='unavailable')return new Response('{}',{status:503});return new Response(JSON.stringify({id:'123400001',owner:{id:'987654321'},text:'SYNTHETIC_EDITED_TEXT',is_reply:false}));};
 await a.dobj.trust.refreshPersonalClaims([id]);assert.equal(calls,2);assert.equal(preserve(a),protectedState);
 if(result==='unavailable'){assert.equal(state(a).version,v);assert.equal(state(a).inbox.tasks.find(x=>x.id==='task_in').status,'pending');}else{assert.equal(state(a).version,v+1);assert.equal(state(a).inbox.tasks.find(x=>x.id==='task_in').status,'cancelled');assert.ok(events(a).some(e=>e.data?.reason===(result==='missing'?'claim_revoked':'claim_mismatch')));}
});
test('loss helper ignores legacy actors and unconfirmed states even if work exists',async t=>{
 const {a,id}=await setup(t);pending(a,id);const {losePersonalClaim}=await import('../worker/core/personal-claim-loss.ts');const s=JSON.stringify(state(a)),n=events(a).length;
 for(const status of ['unavailable','reauth_required','pending_claim','claimed'])losePersonalClaim(a.dobj.runtime,a.dobj.trust,id,status,2,Date.now());losePersonalClaim(a.dobj.runtime,a.dobj.trust,'00-jolly','claim_revoked',2,Date.now());assert.equal(JSON.stringify(state(a)),s);assert.equal(events(a).length,n);
});
