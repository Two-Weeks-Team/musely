// Real Worker/WorldDO + SQLite; every upstream call is a synthetic fetch. No provider or model networking.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {issueSession} from '../worker/core/session.ts';
import {issueOwnerSession} from '../worker/core/owner-session.ts';
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
test('claim state is consistent for each personal caller and peer, permitting only explicitly delegated exchanges',async t=>{
 const a=await boot(t),up=provider(t),one=await participant(a,up,'987654321','One'),two=await participant(a,up,'987654322','Two');
 a.dobj.runtime.commitExternal(Date.now(),'fixture-items',(s)=>{s.muses.find(m=>m.id===one.profile.actorId).inventory.push('coffee');s.muses.find(m=>m.id===two.profile.actorId).inventory.push('pastry');});
 const reg=(await one.call('register_agent')).structuredContent;assert.equal(reg.claim.owner_claimed,true);const card=(await one.call('get_agent_card')).structuredContent;assert.equal(card.verification.ok,true);assert.equal(card.card['x-musely'].owner_claimed,reg.claim.owner_claimed);assert.equal(card.card['x-musely'].claim_fingerprint,a.dobj.trust.personalClaim(one.profile.actorId).fingerprint);
 const offer=await one.call('propose_trade',{to:two.profile.actorId,give:'coffee',want:'pastry',command_id:'claim-gates-offer'});assert.equal(offer.isError,false,JSON.stringify(offer.structuredContent));assert.equal(offer.structuredContent.task.status,'pending');
 const done=await two.call('accept_trade',{task_id:offer.structuredContent.task.id,command_id:'claim-gates-accept'});assert.equal(done.isError,false,JSON.stringify(done.structuredContent));assert.equal(done.structuredContent.task.status,'completed');
});

async function pair(t){const a=await boot(t),up=provider(t),one=await participant(a,up,'987654321','One'),two=await participant(a,up,'987654322','Two');a.dobj.runtime.commitExternal(Date.now(),'fixture-items',s=>{s.muses.find(m=>m.id===one.profile.actorId).inventory.push('coffee','invite_token');s.muses.find(m=>m.id===two.profile.actorId).inventory.push('pastry');});return{a,one,two};}
const proposal=(one,two,id)=>one.call('propose_trade',{to:two.profile.actorId,give:'coffee',want:'pastry',command_id:id});
const rows=a=>a.db.prepare('SELECT count(*) n FROM commands').get().n;
const nonceCount=a=>a.db.prepare('SELECT count(*) n FROM nonces').get().n;
for(const side of ['caller','peer'])test('unclaimed '+side+' cannot trade; ordinary greeting remains permitted',async t=>{
 const {a,one,two}=await pair(t),id=(side==='caller'?one:two).profile.actorId;
 a.db.prepare("UPDATE personal_claims SET status='claim_revoked' WHERE actor_id=?").run(id);
 const n=rows(a),nonces=nonceCount(a),out=await proposal(one,two,'unclaimed-'+side);
 assert.equal(out.isError,true);assert.match(out.structuredContent.refused,/pending_claim/);assert.equal(rows(a),n);assert.equal(nonceCount(a),nonces);
 const hello=await one.call('greet',{to:two.profile.actorId,text:'Hello there',command_id:'unclaimed-greet-'+side});assert.equal(hello.isError,false,JSON.stringify(hello.structuredContent));
});
for(const side of ['caller','peer'])for(const change of ['revoke','generation','root','upgrade'])test('async refresh '+side+' '+change+' cannot upgrade or reuse an old claim snapshot',async t=>{
 const {a,one,two}=await pair(t),id=(side==='caller'?one:two).profile.actorId;
 if(change==='upgrade')a.db.prepare("UPDATE personal_claims SET status='claim_revoked' WHERE actor_id=?").run(id);
 a.dobj.trust.setPersonalClaimRefresh(async actor=>{if(actor!==id)return;if(change==='revoke')a.db.prepare("UPDATE personal_claims SET status='claim_revoked' WHERE actor_id=?").run(id);if(change==='generation')a.db.prepare('UPDATE personal_claims SET version=version+1 WHERE actor_id=?').run(id);if(change==='root')a.db.prepare("UPDATE personal_claims SET root_ref='root_ref:changed' WHERE actor_id=?").run(id);if(change==='upgrade')a.db.prepare("UPDATE personal_claims SET status='claimed' WHERE actor_id=?").run(id);});
 const n=rows(a),nonces=nonceCount(a),out=await proposal(one,two,'async-'+side+'-'+change);assert.equal(out.isError,true);assert.equal(out.structuredContent.command.committed,false);assert.equal(rows(a),n);assert.equal(nonceCount(a),nonces);assert.equal(a.dobj.runtime.state().inbox.tasks.length,0);
});
test('stored duplicate and in-flight duplicate never refresh personal claims or repeat effects',async t=>{
 const {a,one,two}=await pair(t);let calls=0,release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 a.dobj.trust.setPersonalClaimRefresh(async()=>{calls++;entered();await gate;});
 const first=proposal(one,two,'duplicate-claim-test');await ready;const before=calls;
 const busy=await proposal(one,two,'duplicate-claim-test');assert.equal(busy.structuredContent.refused,'in_progress');assert.equal(calls,before);release();
 const done=await first;assert.equal(done.isError,false);const count=calls,n=rows(a),tasks=a.dobj.runtime.state().inbox.tasks.length;
 a.db.prepare("UPDATE personal_claims SET status='claim_revoked'").run();
 const duplicate=await proposal(one,two,'duplicate-claim-test');assert.equal(duplicate.isError,false);assert.equal(duplicate.structuredContent.command.duplicate,true);assert.equal(duplicate.structuredContent.command.committed,false);assert.equal(calls,count);assert.equal(rows(a),n);assert.equal(a.dobj.runtime.state().inbox.tasks.length,tasks);
});
test('invite preserves partial consent while an unclaimed personal invitee stays unavailable',async t=>{
 const {a,one,two}=await pair(t);a.db.prepare("UPDATE personal_claims SET status='claim_revoked' WHERE actor_id=?").run(two.profile.actorId);
 const out=await one.call('invite_campfire',{to:[two.profile.actorId,'02-moss'],command_id:'partial-claim-invite'});assert.equal(out.isError,false,JSON.stringify(out.structuredContent));
 const invite=a.dobj.runtime.state().inbox.invites.at(-1);assert.equal(invite.answers[two.profile.actorId].answer,'unavailable');assert.notEqual(invite.answers['02-moss'].answer,'unavailable');
});
for(const change of ['revoke','generation','root'])test('meeting proof rechecks '+change+' after real Card crypto',async t=>{
 const {a,one,two}=await pair(t);const {MeetingCheck}=await import('../worker/core/a2a.ts'),orig=a.dobj.trust.card.bind(a.dobj.trust),id=two.profile.actorId;
 a.dobj.trust.card=async(...args)=>{const signed=await orig(...args);if(args[0]===id){if(change==='revoke')a.db.prepare("UPDATE personal_claims SET status='claim_revoked' WHERE actor_id=?").run(id);if(change==='generation')a.db.prepare('UPDATE personal_claims SET version=version+1 WHERE actor_id=?').run(id);if(change==='root')a.db.prepare("UPDATE personal_claims SET root_ref='root_ref:changed' WHERE actor_id=?").run(id);}return signed;};
 const c={trust:a.dobj.trust,ownerRoot:null,ownerClaimed:false,baseUrl:ORIGIN},s=a.dobj.runtime.state(),at=Date.now();const gate=await new MeetingCheck(()=>c).prepare(s,at);const out=gate(s,s.muses.find(m=>m.id===one.profile.actorId),s.muses.find(m=>m.id===id),{id:'commons:cafe'},Date.now());assert.equal(out.ok,false);assert.equal(out.event.data.refused[id],'pending_claim');
});
test('fresh personal meeting proof permits both claims, then rejects loss before the synchronous commit',async t=>{
 const {a,one,two}=await pair(t),{MeetingCheck}=await import('../worker/core/a2a.ts'),s=a.dobj.runtime.state(),id=two.profile.actorId;
 const gate=await new MeetingCheck(()=>({trust:a.dobj.trust,ownerRoot:null,ownerClaimed:false,baseUrl:ORIGIN})).prepare(s,Date.now());
 const args=[s,s.muses.find(m=>m.id===one.profile.actorId),s.muses.find(m=>m.id===id),{id:'commons:cafe'},Date.now()];assert.equal(gate(...args).ok,true);
 a.db.prepare("UPDATE personal_claims SET status='claim_revoked' WHERE actor_id=?").run(id);assert.equal(gate(...args).ok,false);
});
test('unclaimed personal walk stays available and refresh only deduplicates personal actors',async t=>{
 const {a,one,two}=await pair(t);a.db.prepare("UPDATE personal_claims SET status='claim_revoked' WHERE actor_id=?").run(one.profile.actorId);
 let refreshed=[];a.dobj.trust.setPersonalClaimRefresh(async id=>{refreshed.push(id);});
 const out=await one.call('move',{to:'commons:garden',command_id:'unclaimed-still-walks'});assert.equal(out.isError,false,JSON.stringify(out.structuredContent));assert.deepEqual(refreshed,[]);
 await a.dobj.trust.refreshPersonalClaims(['00-jolly',one.profile.actorId,one.profile.actorId,two.profile.actorId,'unknown']);assert.deepEqual(refreshed.sort(),[one.profile.actorId,two.profile.actorId].sort());
});

test('automatic meeting refreshes overdue personal proof before signing any admission',async t=>{
 const {a,one,two}=await pair(t),id=two.profile.actorId;
 a.db.prepare('UPDATE personal_claims SET checked_at=0 WHERE actor_id=?').run(id);
 let calls=0;globalThis.fetch=async url=>{calls++;const u=new URL(url);if(u.pathname==='/v1.0/me')return Response.json({id:'987654322'});assert.equal(u.pathname,'/v1.0/123400001');return new Response('{}',{status:404});};
 const {MeetingCheck}=await import('../worker/core/a2a.ts'),s=a.dobj.runtime.state();
 const gate=await new MeetingCheck(()=>({trust:a.dobj.trust,ownerRoot:null,ownerClaimed:false,baseUrl:ORIGIN})).prepare(s,Date.now());
 assert.equal(calls,2);assert.equal(a.dobj.trust.personalClaim(id).claimed,false);
 assert.equal(gate(s,s.muses.find(m=>m.id===one.profile.actorId),s.muses.find(m=>m.id===id),{id:'commons:cafe'},Date.now()).ok,false);
});

test('claim loss during real heartbeat preparation cannot restore a Task from the old snapshot',async t=>{
 const {a,one,two}=await pair(t),id=two.profile.actorId;
 const offered=await proposal(one,two,'before-heartbeat-claim-loss');assert.equal(offered.isError,false);const taskId=offered.structuredContent.task.id;
 a.db.prepare('UPDATE personal_claims SET checked_at=0 WHERE actor_id=?').run(id);
 const authority=JSON.stringify(a.db.prepare('SELECT * FROM personal_authority WHERE actor_id=?').get(id));
 globalThis.fetch=async url=>new URL(url).pathname==='/v1.0/me'?Response.json({id:'987654322'}):new Response('{}',{status:404});
 const done=await a.dobj.runtime.heartbeat(Date.now()+60000);assert.equal(done.status,'committed');
 assert.equal(a.dobj.runtime.state().inbox.tasks.find(x=>x.id===taskId).status,'cancelled');
 assert.equal(a.dobj.trust.personalClaim(id).claimed,false);
 assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM personal_authority WHERE actor_id=?').get(id)),authority);
 assert.equal(a.dobj.runtime.state().paused?.[id],undefined);
});

for(const action of ['meeting','heartbeat','proposal','invite'])test('successful due proof refresh uses its new authoritative clock for '+action,async t=>{
 const {a,one,two}=await pair(t),id=two.profile.actorId,desc=await(await a.go('GET','/api/personal/claim',{cookie:two.cookie})).json();
 a.db.prepare('UPDATE personal_claims SET checked_at=0 WHERE actor_id=?').run(id);
 if(action==='heartbeat')a.dobj.runtime.commitExternal(Date.now(),'fixture-co-located-meeting',s=>{for(const target of [id,'02-moss']){const m=s.muses.find(m=>m.id===target);m.place='commons:cafe';m.travel=null;m.beat=null;m.lastMet={};}s.muses.find(m=>m.id==='02-moss').intent={kind:'greet',target:id};});
 let calls=0;globalThis.fetch=async url=>{calls++;await new Promise(r=>setTimeout(r,8));const u=new URL(url);if(u.pathname==='/v1.0/me')return Response.json({id:'987654322'});assert.equal(u.pathname,'/v1.0/123400001');return Response.json({id:'123400001',owner:{id:'987654322'},text:desc.text});};
 const began=Date.now();
 if(action==='proposal'){const out=await proposal(one,two,'successful-rechecked-proposal');assert.equal(out.isError,false,JSON.stringify(out.structuredContent));}
 else if(action==='invite'){const out=await one.call('invite_campfire',{to:[id],command_id:'successful-rechecked-invite'});assert.equal(out.isError,false);assert.notEqual(a.dobj.runtime.state().inbox.invites.at(-1).answers[id]?.answer,'unavailable');}
 else if(action==='heartbeat'){assert.equal((await a.dobj.runtime.heartbeat(began)).status,'committed');assert.ok(a.dobj.worldEvents(0,2000).some(e=>e.kind==='cards_verified'&&[e.muse,e.other].includes(id)&&[e.muse,e.other].includes('02-moss')),'real heartbeat meeting uses current proof, not its old logical event time');}
 else{const {MeetingCheck}=await import('../worker/core/a2a.ts'),s=a.dobj.runtime.state(),gate=await new MeetingCheck(()=>({trust:a.dobj.trust,ownerRoot:null,ownerClaimed:false,baseUrl:ORIGIN})).prepare(s,began);assert.equal(gate(s,s.muses.find(m=>m.id===one.profile.actorId),s.muses.find(m=>m.id===id),{id:'commons:cafe'},Date.now()).ok,true);}
 assert.equal(calls,2);assert.equal(a.dobj.trust.personalClaim(id).claimed,true);assert.ok(a.db.prepare('SELECT checked_at FROM personal_claims WHERE actor_id=?').get(id).checked_at>began);
});
