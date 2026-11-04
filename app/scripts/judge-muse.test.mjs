import {issueSession} from '../worker/core/session.ts';
import {JUDGE_MUSE} from '../src/engine/judge-muse.ts';
import {harnessById,harnessRoleId,HARNESSES,ACTOR_IDS} from '../src/engine/harness.ts';
import {residentValues,RESIDENT_VALUES} from '../src/engine/resident-values.ts';
import {isRuntimeControlled} from '../src/engine/inbox.ts';
import {knownResident} from '../worker/core/resident-life-adapter.ts';
import {definedOwnerOf} from '../worker/core/tasks.ts';
import {principalForToken,PRINCIPALS,ownsMuse} from '../worker/core/owner-session.ts';
import {loadRun,assertCompatible} from '../src/replay/player.ts';
import {currentVersions} from '../src/replay/versions.ts';
import {buildMessages,checkOutput,validate} from '../worker/core/actions.ts';
// Real Worker/WorldDO and SQLite. Auth/root/key material is synthetic; external networking is forbidden.
import {test,after} from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';import {DatabaseSync} from 'node:sqlite';
import {personalDigest,personalNonce,signPersonalSession} from '../worker/core/personal-session.ts';import {issueOwnerSession} from '../worker/core/owner-session.ts';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}',shortCircuit:true};return n(s,c);}`));
const HOST='https://musely.net',BASE='/api/judge',H={origin:HOST,'sec-fetch-site':'same-origin'},TOKEN='synthetic-personal-owner-emergency-000001';
const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('external networking prohibited');};after(()=>globalThis.fetch=original);
async function boot(t,{mode='shared-v1',life=true,values=true,social=true}={}){const {default:worker,WorldDO}=await import('../worker/index.ts');const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,ready;
 const sql={exec(q,...b){const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};}},transactionSync=fn=>{const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const v=fn();assert.ok(!v?.then);db.exec('RELEASE '+n);return v;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}};
 const ctx={storage:{sql,transactionSync,getAlarm:async()=>null,setAlarm:async()=>{}},blockConcurrencyWhile:fn=>(ready=fn())},root=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const env={PUBLIC_ORIGIN:HOST,ALLOWED_HOSTS:'musely.net,www.musely.net',SESSION_SECRET:'synthetic-personal-owner-session',THREADS_APP_ID:'123',OWNER_CONTROL_TOKEN:TOKEN,DEMO_PEER_CONTROL_TOKEN:'synthetic-personal-owner-demo-peer-000002',OWNER_ROOT_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',root.privateKey)),MODEL_BASE:'https://not-called.invalid',MODEL_ID:'synthetic',DAILY_BUDGET_USD:'1',SOCIAL_STATUS_MODE:social?'public-v1':'off',JUDGE_MUSE_MODE:mode,WORLD_LIFE_MODE:life?'sandbox-v1':'off',RESIDENT_VALUES_MODE:values?'confirmed-v1':'off'};
 const world=new WorldDO(ctx,env);await ready;env.WORLD={idFromName:()=> 'world',get:()=>world};env.ASSETS={fetch:async()=>new Response('asset')};
 const go=async(method,path,cookie='',body,extra={})=>{const r=await worker.fetch(new Request(HOST+path,{method,headers:{...H,cookie,...(body===undefined?{}:{'content-type':'application/json'}),...extra},body:body instanceof ReadableStream?body:body===undefined?undefined:JSON.stringify(body),...(body instanceof ReadableStream?{duplex:'half'}:{})}),env);return{status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};};
 const bind=async(subject='42',appId='123')=>{const now=Date.now(),sid=personalNonce(),flow={stateDigest:await personalDigest('state',personalNonce()),browserDigest:await personalDigest('browser',personalNonce()),appId,redirectUri:HOST+'/api/threads/callback',createdAt:now,expiresAt:now+600000};assert.ok(world.personalAuthBegin(flow));assert.ok(world.personalAuthConsume(flow,now));const sidDigest=await personalDigest('sid',sid),proof=world.personalAuthComplete(flow.stateDigest,appId,subject,sidDigest,now),cookie='musely_p='+await signPersonalSession(env.SESSION_SECRET,{v:1,sid,...proof});return{cookie,binding:{sidDigest,appId,proof}};};
 const judge='musely_s='+(await issueSession(env.SESSION_SECRET,'judge')).token,visitor='musely_s='+(await issueSession(env.SESSION_SECRET,'visitor')).token;
 const owner='musely_o='+(await issueOwnerSession(env.SESSION_SECRET,{owner:TOKEN,peer:env.DEMO_PEER_CONTROL_TOKEN},'owner')).token;
 const adopt=async b=>{const r=await go('POST','/api/personal/legacy-muse',b.cookie+'; '+owner,{operationId:'synthetic-adoption',displayName:'ComBba',appearanceId:'00-jolly',expectedRevision:0});assert.equal(r.status,200);assert.equal(r.body.adopted,true);};
 return{db,sql,world,env,go,bind,owner,adopt,judge,visitor,async restart(){const next=new WorldDO(ctx,env);await ready;env.WORLD.get=()=>next;return next;}};}


test('shared slot is separate from the original 26 values and ten appearance templates; token authentication stays three principals',async t=>{
 const x=await boot(t),m=x.world.runtime.state().muses.find(m=>m.id===JUDGE_MUSE.id);
 assert.equal(RESIDENT_VALUES.length,26);assert.equal(HARNESSES.length,10);assert.equal(ACTOR_IDS.length,28);assert.equal(m.residentRole,'01-sunny');assert.equal(m.profile,undefined);assert.equal(m.controlMode,undefined);
 assert.equal(harnessById(m.id).name,'Judge Muse');assert.equal(harnessRoleId(m.id),'01-sunny');assert.equal(residentValues(m.id).type,'ENFP');assert.deepEqual(residentValues(m.id).values,['kindness','curiosity']);
 assert.equal(x.world.worldLife.ownership(m.id),'resident');assert.equal(knownResident(m.id,()=> 'resident'),true);assert.equal(isRuntimeControlled(x.world.runtime.state(),m.id,Date.now()),false);assert.equal(definedOwnerOf(m.id),null);
 assert.deepEqual(PRINCIPALS.owner.muses,['00-jolly']);assert.deepEqual(PRINCIPALS.reviewer.muses,['04-ember']);assert.deepEqual(PRINCIPALS['demo-peer'].muses,['09-copper']);
 const tokens={reviewer:'synthetic-reviewer-token-0000000000000'};assert.equal(principalForToken(tokens,tokens.reviewer),'reviewer');assert.equal(ownsMuse({principal:'shared-judge'},'10-judge'),true);assert.equal(ownsMuse({principal:'shared-judge'},'00-jolly'),false);
 await assert.rejects(issueOwnerSession(x.env.SESSION_SECRET,tokens,'shared-judge'),/owner_principal_required/);
 assert.equal(x.db.prepare('SELECT count(*) n FROM agent_keys').get().n,0);assert.equal(x.world.trust.agentByMuse(m.id).kind,'resident');
});

test('exact judge DTO and four routes require the current judge cookie; other cookies never restore owner authority',async t=>{
 const x=await boot(t),personal=await x.bind();
 for(const cookie of ['',x.owner,x.visitor,personal.cookie])for(const route of ['muse','inbox','notifications','social-status'])assert.deepEqual(await x.go('GET',BASE+'/'+route,cookie).then(r=>[r.status,r.body]),[401,{error:'judge_session_required'}]);
 const account=await x.go('GET',BASE+'/muse',x.judge+'; '+x.owner+'; '+personal.cookie);
 assert.equal(account.status,200);assert.deepEqual(Object.keys(account.body),['account']);assert.deepEqual({...account.body.account,expiresAt:0},{kind:'judge',muse:'10-judge',displayName:'Judge Muse',appearanceId:'01-sunny',label:'Judge account · provided by the team',expiresAt:0});assert.ok(account.body.account.expiresAt>Date.now());assert.equal(account.cookies.length,0);
 assert.equal((await x.go('GET',BASE+'/muse',x.judge+'; '+x.judge)).status,401);
 for(const route of ['muse?muse=00-jolly','inbox?muse=04-ember','social-status?muse=pm_private'])assert.equal((await x.go('GET',BASE+'/'+route,x.judge)).status,403);
 for(const route of ['agent-keys','keys','reset','approve','say','location','profile','revoke','delegation'])assert.equal((await x.go('POST',BASE+'/'+route,x.judge,{})).status,404);
 assert.equal((await x.go('POST',BASE+'/muse',x.judge,{})).status,405);
 assert.equal((await x.go('GET',BASE+'/inbox?anything=1',x.judge)).status,400);assert.equal((await x.go('GET',BASE+'/muse?muse=10-judge&muse=10-judge',x.judge)).status,400);
 assert.deepEqual((await x.go('GET','/api/personal/owner/session',x.judge)).body,{owner:null});assert.deepEqual((await x.go('GET','/api/owner/session',x.judge)).body.owner,null);
});

test('shared status is a persisted CAS preference; Origin, unknown fields, competing judges and own scope are enforced',async t=>{
 const x=await boot(t),other='musely_s='+(await issueSession(x.env.SESSION_SECRET,'judge')).token;
 const start=await x.go('GET',BASE+'/social-status',x.judge);assert.deepEqual(start.body,{muse:'10-judge',mode:'auto',revision:0,status:'welcoming'});
 for(const extra of [{origin:''},{origin:'https://evil.invalid'},{'sec-fetch-site':'cross-site'}])assert.equal((await x.go('PATCH',BASE+'/social-status',x.judge,{mode:'busy',expectedRevision:0},extra)).status,403);
 assert.equal((await x.go('PATCH',BASE+'/social-status',x.judge,{mode:'busy',expectedRevision:0,muse:'00-jolly'})).status,400);
 const [a,b]=await Promise.all([x.go('PATCH',BASE+'/social-status',x.judge,{mode:'busy',expectedRevision:0}),x.go('PATCH',BASE+'/social-status',other,{mode:'do_not_disturb',expectedRevision:0})]);assert.deepEqual([a.status,b.status].sort(),[200,409]);
 const row=(await x.go('GET',BASE+'/social-status',other)).body;assert.equal(row.revision,1);const reopened=await x.restart();assert.deepEqual(reopened.judgeCall((await issueSession(x.env.SESSION_SECRET,'judge')).session,'social-status-get'),row);
 assert.equal(x.db.prepare("SELECT count(*) n FROM social_status_overrides WHERE actor_id != '10-judge'").get().n,0);
});

for(const loss of ['expiry','flag'])test('a late streamed status body cannot commit after judge '+loss,async t=>{
 const x=await boot(t);let controller;const stream=new ReadableStream({start(c){controller=c;}}),pending=x.go('PATCH',BASE+'/social-status',x.judge,stream);
 await new Promise(r=>setTimeout(r,20));const clock=Date.now;
 if(loss==='expiry')Date.now=()=>clock()+25*3600000;else x.env.JUDGE_MUSE_MODE='off';
 try{controller.enqueue(new TextEncoder().encode('{"mode":"busy","expectedRevision":0}'));controller.close();const r=await pending;assert.equal(r.status,loss==='expiry'?401:404);assert.equal(x.db.prepare('SELECT count(*) n FROM social_status_overrides').get().n,0);}finally{Date.now=clock;}
});

test('status body is bounded in bytes and time and cancels after an oversized first chunk',async t=>{
 const x=await boot(t);let pulls=0,cancelled=0;const stream=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled++;}},{highWaterMark:0});assert.equal((await x.go('PATCH',BASE+'/social-status',x.judge,stream)).status,400);assert.equal(pulls,1);assert.equal(cancelled,1);
 let stopped=0;const at=Date.now();assert.equal((await x.go('PATCH',BASE+'/social-status',x.judge,new ReadableStream({pull(){return new Promise(()=>{});},cancel(){stopped++;}}))).status,400);assert.ok(Date.now()-at<2000);assert.equal(stopped,1);
});

test('received public greetings, proposals and notifications have exact primitive projections; sentinels never leak',async t=>{
 const x=await boot(t),now=Date.now();
 x.world.runtime.commitExternal(now,'judge-private-projection',(s,emit)=>{
  for(const [id,other,kind,publicFlag,line] of [['received','10-judge','greet',true,'Hello, Judge Muse!'],['reply','10-judge','encounter_reply',false,'A public reply.'],['private','10-judge','greet',false,'PRIVATE_GREETING'],['other-owner','00-jolly','greet',true,'OTHER_OWNER'],['outgoing','01-sunny','greet',true,'OUTGOING']])emit({at:now,source:'rule',kind,muse:id==='outgoing'?'10-judge':'01-sunny',other,line,data:{public:publicFlag,note:'PRIVATE_EVENT_DETAIL'},tags:[]});
  const make=(id,from,to,extra={})=>({id,kind:'trade',from,to,status:'pending',awaiting:to,createdAt:now,deadline:now+1000,updatedAt:now,offer:{by:from,give:'fruit',want:'coffee'},round:0,history:[{by:from,action:'propose',at:now,private:'PRIVATE_HISTORY'}],approvals:{secret:'PRIVATE_APPROVAL'},candidate:{public_basis:'PRIVATE_CANDIDATE'},...extra});
  s.inbox.tasks.push(make('received-task','01-sunny','10-judge'),make('other-task','01-sunny','00-jolly'),make('outgoing-task','10-judge','02-moss'),make('received-counter','10-judge','02-moss',{awaiting:'10-judge',offer:{by:'02-moss',give:'tea',want:'fruit'}}));
  s.inbox.messages.push({id:'direct-private',from:'00-jolly',to:'10-judge',kind:'greet',at:now,text:'PRIVATE_DIRECT_MESSAGE',read:false});
  s.inbox.notifications.push({id:'judge-notice',muse:'10-judge',kind:'blocked',at:now,line:'PRIVATE_REASON_SUMMARY',ref:'task-ref',other:'01-sunny',detail:{condition:'PRIVATE_NOTIFICATION_DETAIL'}},{id:'other-notice',muse:'00-jolly',kind:'blocked',at:now,line:'OTHER_NOTICE',ref:'PRIVATE_OTHER_REF',other:'PRIVATE_OTHER'}, {id:'legacy-notice',kind:'blocked',at:now,line:'LEGACY_OWNER_NOTICE',ref:null,other:null});
 });
 const inbox=(await x.go('GET',BASE+'/inbox',x.judge)).body,notices=(await x.go('GET',BASE+'/notifications',x.judge)).body;
 assert.deepEqual(Object.keys(inbox),['muse','greetings','proposals','limit']);assert.equal(inbox.muse,'10-judge');assert.equal(inbox.limit,50);assert.equal(inbox.greetings.length,2);assert.equal(inbox.proposals.length,2);
 for(const row of inbox.greetings)assert.deepEqual(Object.keys(row),['id','at','from','kind','line','source']);
 for(const row of inbox.proposals)assert.deepEqual(Object.keys(row),['id','kind','from','status','createdAt','deadline','offer']);
 assert.deepEqual(inbox.proposals.map(p=>p.id).sort(),['received-counter','received-task']);assert.equal(inbox.proposals.find(p=>p.id==='received-counter').from,'02-moss');
 assert.deepEqual(notices,{muse:'10-judge',notifications:[{id:'judge-notice',kind:'blocked',at:now,line:'A request was blocked.',other:'01-sunny',ref:'task-ref'}],limit:50});
 assert.doesNotMatch(JSON.stringify({inbox,notices}),/PRIVATE_|OTHER_OWNER|OUTGOING|OTHER_NOTICE|LEGACY_OWNER_NOTICE|history|approval|candidate|direct-private|condition/);
});

test('flag off closes the API and freezes only the dedicated slot; restart on resumes without replacing history or credentials',async t=>{
 const x=await boot(t),before=x.world.runtime.state(),agent=x.world.trust.agentByMuse('10-judge'),events=x.world.runtime.events().length;
 x.env.JUDGE_MUSE_MODE='off';assert.equal(x.world.worldLife.ownership('10-judge'),'unknown');assert.equal(knownResident('10-judge',x.world.worldLife.ownership),false);assert.equal((await x.go('GET',BASE+'/muse',x.judge)).status,404);assert.equal(x.world.runtime.residentUnavailable('10-judge'),true);const off=await x.restart(),frozen=off.runtime.state();
 assert.equal(frozen.muses.length,28);assert.ok(frozen.muses.find(m=>m.id==='10-judge').residentFrozenAt!==undefined);for(const m of frozen.muses.filter(m=>m.id!=='10-judge'))assert.deepEqual(m,before.muses.find(n=>n.id===m.id));
 assert.ok(off.runtime.events().length>=events);assert.equal(off.trust.agentByMuse('10-judge').agentId,agent.agentId);
 x.env.JUDGE_MUSE_MODE='shared-v1';const on=await x.restart();assert.equal(on.runtime.state().muses.find(m=>m.id==='10-judge').residentFrozenAt,undefined);assert.equal(on.runtime.state().muses.filter(m=>m.id==='10-judge').length,1);assert.equal(on.trust.agentByMuse('10-judge').agentId,agent.agentId);assert.equal((await x.go('GET',BASE+'/muse',x.judge)).status,200);
 const freshOff=await boot(t,{mode:'off'});assert.equal(freshOff.world.runtime.state().muses.length,27);assert.equal(freshOff.world.trust.agentByMuse('10-judge'),null);
});

test('Judge receives normal autonomous RULE turns and English persona speech without a provider or owner approval',async t=>{
 const x=await boot(t),now=Date.now();x.world.runtime.commitExternal(now,'judge-only-turn',s=>{for(const m of s.muses){if(m.id!=='10-judge')(s.paused??={})[m.id]={at:now,version:1,by:'fixture'};m.travel=null;m.beat=null;m.intent=null;}s.spotlight.cursor=s.muses.findIndex(m=>m.id==='10-judge');});
 const heartbeat=await x.world.runtime.heartbeat(now);assert.equal(heartbeat.spotlight.source,'rule');assert.ok(x.world.runtime.events(0,10000).some(e=>e.kind==='spotlight_fallback'&&e.muse==='10-judge'&&e.source==='rule'));const events=x.world.runtime.events(0,10000).filter(e=>e.muse==='10-judge'&&['spotlight','depart','beat'].includes(e.kind));assert.ok(events.length>=2);assert.ok(events.every(e=>e.source==='rule'));assert.ok(events.some(e=>['depart','beat'].includes(e.kind)));assert.equal(x.world.ledger.status().liveCalls,0);
 const input=validate('spotlight',{muse:'10-judge',freedom:'where',localTime:'12:00',place:'The Campfire',places:[],muses:[],items:[],memory:[]}),prompt=buildMessages('spotlight',input);assert.match(JSON.stringify(prompt),/Always speak in English/);assert.match(JSON.stringify(prompt),/Judge Muse/);
 const output={freedom:'where',decision:'stay',target_place:'The Campfire',target_agent:'',offer_item:'',want_item:'',public_reason:'A quiet pause.',line:'잠깐 쉬어요.'};assert.equal(checkOutput('spotlight',input,output),'public_speech_not_english');
});

test('only team owner/reviewer can explicitly reset Judge; the old reviewer Ember default is preserved',async t=>{
 const x=await boot(t),before=x.world.runtime.state().muses.filter(m=>m.id!=='10-judge');x.env.REVIEWER_CONTROL_TOKEN='synthetic-reviewer-reset-token-000001';
 assert.equal((await x.go('POST',BASE+'/reset',x.judge,{})).status,404);
 assert.equal((await x.go('POST','/api/owner/reset',x.judge,{muse:'10-judge'})).status,401);
 const r=await x.go('POST','/api/owner/reset',x.owner,{muse:'10-judge'});assert.equal(r.status,200);assert.equal(r.body.muse,'10-judge');assert.deepEqual(x.world.runtime.state().muses.filter(m=>m.id!=='10-judge'),before);
 x.env.REVIEWER_CONTROL_TOKEN='synthetic-reviewer-reset-token-000001';const reviewer='musely_o='+(await issueOwnerSession(x.env.SESSION_SECRET,{owner:TOKEN,peer:x.env.DEMO_PEER_CONTROL_TOKEN,reviewer:x.env.REVIEWER_CONTROL_TOKEN},'reviewer')).token;
 assert.equal((await x.go('POST','/api/owner/reset',reviewer,{muse:'10-judge'})).status,200);const old=await x.go('POST','/api/owner/reset',reviewer,{});assert.equal(old.status,200);assert.equal(old.body.muse,'04-ember');
});

test('engine17 Judge checkpoints preserve exact snapshots and the original engine16 remains an exact predecessor',async t=>{
 const x=await boot(t),rt=x.world.runtime,r=rt.runLog.current,record={...r,inputs:rt.runLog.inputs(r.runId,0,1000),events:rt.events(0,10000,{runId:r.runId}),readThrough:rt.runLog.boundary(r.runId)},bytes=JSON.stringify(record);
 const player=loadRun(record);player.seek(Number.MAX_SAFE_INTEGER);assert.equal(player.getFrame().snapshotHash,record.inputs.at(-1).afterHash);assert.equal(player.getFrame().publicState.muses.filter(m=>m.id==='10-judge').length,1);assert.equal(JSON.stringify(record),bytes);
 const original={schemaVersion:'run-log-2',engineVersion:'engine-16',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-ffb109917767'};assert.doesNotThrow(()=>assertCompatible(original));assert.throws(()=>assertCompatible(original,currentVersions()));assert.throws(()=>assertCompatible({...original,catalogVersion:currentVersions().catalogVersion}));
});

test('Judge model turn uses the existing shared call and English guard; switching off during the provider await discards action',async t=>{
 for(const off of [false,true]){
 const x=await boot(t),now=Date.now(),model=x.world.runtime.opts.model;let calls=0,enter,release;const entered=new Promise(r=>enter=r),wait=new Promise(r=>release=r);
 model.key='synthetic-model-only';model.fetcher=async(_url,init)=>{calls++;const request=JSON.parse(init.body);assert.match(JSON.stringify(request.messages),/Judge Muse/);assert.match(JSON.stringify(request.messages),/Always speak in English/);enter();await wait;const freedom=request.messages[0].content.match(/freedom "(\w+)"/)?.[1]??'where';return new Response(JSON.stringify({id:'synthetic-judge-answer',choices:[{message:{content:JSON.stringify({freedom,decision:'stay',target_place:'The Campfire',target_agent:'',offer_item:'',want_item:'',public_reason:'A friendly pause.',line:'There is room to wonder together.'})}}],usage:{prompt_tokens:20,completion_tokens:30}}));};
 x.world.runtime.commitExternal(now,'judge-model-turn',s=>{for(const m of s.muses){if(m.id!=='10-judge')(s.paused??={})[m.id]={at:now,version:1,by:'fixture'};m.travel=null;m.beat=null;m.intent=null;}s.spotlight.cursor=s.muses.findIndex(m=>m.id==='10-judge');});
 const pending=x.world.runtime.heartbeat(now);await entered;if(off)x.env.JUDGE_MUSE_MODE='off';release();await pending;assert.equal(calls,1);const events=x.world.runtime.events(0,10000).filter(e=>e.muse==='10-judge'&&e.kind!=='resident_join');
 if(off){assert.ok(!events.some(e=>['beat','depart','greet'].includes(e.kind)));assert.ok(x.world.runtime.state().muses.find(m=>m.id==='10-judge').residentFrozenAt!==undefined);}else assert.ok(events.some(e=>e.source==='live'&&e.kind==='spotlight'));
 assert.equal(x.db.prepare('SELECT count(*) n FROM agent_keys').get().n,0);
 }
});

// Judge availability must remain effective when the separate old global label flag is off.
test('shared Judge preference is enforced by world contact policy even without the old global social flag',async t=>{
 const x=await boot(t,{social:false});const status=await x.go('PATCH',BASE+'/social-status',x.judge,{mode:'do_not_disturb',expectedRevision:0});assert.equal(status.status,200);assert.equal(status.body.status,'do_not_disturb');assert.equal(x.world.runtime.view(Date.now()).muses.find(m=>m.id==='10-judge').availability.status,'do_not_disturb');
});

test('judge routes use the existing per-route/session burst limiter before DO reads or mutations',async t=>{
 const x=await boot(t);let calls=0,doCalls=0;const call=x.world.judgeCall.bind(x.world);x.world.judgeCall=(...args)=>{doCalls++;return call(...args);};x.env.BURST={limit:async()=>{calls++;return{success:false};}};
 for(const [method,path,body]of[['GET','inbox',undefined],['PATCH','social-status',{mode:'busy',expectedRevision:0}]]){const r=await x.go(method,BASE+'/'+path,x.judge,body);assert.equal(r.status,429);assert.deepEqual(r.body,{error:'slow_down'});}
 assert.equal(calls,2);assert.equal(doCalls,0);assert.equal(x.db.prepare('SELECT count(*) n FROM social_status_overrides').get().n,0);
 const counts=new Map();x.env.BURST={limit:async({key})=>{const n=(counts.get(key)??0)+1;counts.set(key,n);return{success:n<=20};}};
 for(let n=0;n<20;n++)for(const path of['muse','inbox','notifications','social-status'])assert.equal((await x.go('GET',BASE+'/'+path,x.judge)).status,200,'four ordinary poll routes have independent limits');
 assert.equal(counts.size,4);assert.equal((await x.go('GET',BASE+'/inbox',x.judge)).status,429);
 const other='musely_s='+(await issueSession(x.env.SESSION_SECRET,'judge')).token;assert.equal((await x.go('GET',BASE+'/inbox',other)).status,200,'another judge session has its own limit');
});

test('Judge outgoing counteroffer is not attributed to its original proposer as a received trade',async t=>{
 const x=await boot(t),now=Date.now();x.world.runtime.commitExternal(now,'judge-outgoing-counter',s=>{s.inbox.tasks.push({id:'self-counter',kind:'trade',from:'01-sunny',to:'10-judge',awaiting:'01-sunny',status:'pending',createdAt:now,updatedAt:now,deadline:now+10000,offer:{by:'10-judge',give:'tea',want:'fruit'},round:1,history:[]});});
 assert.deepEqual((await x.go('GET',BASE+'/inbox',x.judge)).body.proposals,[]);
});

for(const boundary of ['body','commit'])test('Judge team reset rechecks current expiry at '+boundary+' and preserves state/inbox/notifications/events',async t=>{
 const x=await boot(t),now=Date.now();x.world.runtime.commitExternal(now,'judge-reset-preserve',s=>{s.muses.find(m=>m.id==='10-judge').memory=['preserve'];s.inbox.messages.push({id:'preserve-message',from:'01-sunny',to:'10-judge',kind:'greet',at:now,text:'preserve',read:false});s.inbox.notifications.push({id:'preserve-notice',muse:'10-judge',kind:'blocked',at:now,line:'preserve',ref:null,other:'01-sunny'});});
 const state=x.world.runtime.state(),events=x.world.runtime.events(0,10000),clock=Date.now;
 try{
  let response;
  if(boundary==='body'){let enter,controller;const entered=new Promise(r=>enter=r),stream=new ReadableStream({start(c){controller=c;},pull(){enter();return new Promise(()=>{});}},{highWaterMark:0});const pending=x.go('POST','/api/owner/reset',x.owner,stream);await entered;Date.now=()=>clock()+2*3600000;controller.enqueue(new TextEncoder().encode('{"muse":"10-judge"}'));controller.close();response=await pending;}
  else{const commit=x.world.runtime.commitExternal.bind(x.world.runtime);x.world.runtime.commitExternal=(at,label,mutate)=>commit(at,label,(s,emit)=>{Date.now=()=>clock()+2*3600000;return mutate(s,emit);});response=await x.go('POST','/api/owner/reset',x.owner,{muse:'10-judge'});}
  assert.equal(response.status,401);assert.deepEqual(response.body,{error:'owner_session_required'});assert.deepEqual(x.world.runtime.state(),state);assert.deepEqual(x.world.runtime.events(0,10000),events);
 }finally{Date.now=clock;}
 assert.throws(()=>x.world.resetMuse('10-judge',PRINCIPALS['demo-peer'].ownerId,{principal:'demo-peer',ownerId:PRINCIPALS['demo-peer'].ownerId,exp:now+3600000}),e=>e.code==='not_your_muse');
});

test('judge-only legacy notification reads stay scoped to Judge and current flag; explicit owner authority remains separate',async t=>{
 const x=await boot(t),now=Date.now();x.world.runtime.commitExternal(now,'legacy-notification-boundary',s=>{s.inbox.notifications.push({id:'owner-private-notice',muse:'00-jolly',kind:'blocked',at:now,line:'OWNER_PRIVATE_OVERVIEW',ref:'owner-ref',other:'01-sunny',detail:{private:'owner-owned'}},{id:'judge-only-notice',muse:'10-judge',kind:'blocked',at:now,line:'judge reason',ref:null,other:'02-moss'});});
 const scoped=await x.go('GET','/api/owner/notifications',x.judge);assert.equal(scoped.status,200);assert.deepEqual(scoped.body.notifications.map(n=>n.id),['judge-only-notice']);assert.ok(!JSON.stringify(scoped.body).includes('OWNER_PRIVATE_OVERVIEW'));
 const owner=await x.go('GET','/api/owner/notifications',x.judge+'; '+x.owner);assert.equal(owner.status,200);assert.deepEqual(owner.body.notifications.find(n=>n.id==='owner-private-notice').detail,{private:'owner-owned'});
 x.env.JUDGE_MUSE_MODE='off';assert.equal((await x.go('GET','/api/owner/notifications',x.judge)).status,404);
});

// Synthetic provider only: the same real WorldDO SQLite row survives object recreation.
test('WorldDO model transport persists fallback, projects only safe status and resets after either key changes',async t=>{
 const b=await boot(t);b.env.MODEL_API_KEY='synthetic-persistent-primary';b.env.MODEL_API_KEY_FALLBACK='synthetic-persistent-secondary';let world=await b.restart(),seen=[];
 globalThis.fetch=async(_url,init)=>{seen.push(init.headers.authorization);return init.headers.authorization==='Bearer synthetic-persistent-primary'?new Response('payment required',{status:402}):new Response(JSON.stringify({id:'synthetic-response',choices:[{message:{content:'{"line":"Hello"}'}}]}));};
 try{assert.equal((await world.modelCall('encounter',[],{})).ok,true);assert.equal(seen.length,2);assert.equal(world.status().modelKey,'fallback');assert.equal(world.status().modelKeyPrimaryRetries,0);world=await b.restart();assert.equal(world.status().modelKey,'fallback');await world.modelCall('encounter',[],{});assert.equal(seen.at(-1),'Bearer synthetic-persistent-secondary');const status=await b.go('GET','/api/status');assert.equal(status.body.modelKey,'fallback');assert.equal(status.body.modelKeyPinned,false);assert.ok(!JSON.stringify(status.body).includes('synthetic-persistent'));b.env.MODEL_API_KEY_FALLBACK='synthetic-rotated-secondary';world=await b.restart();assert.equal(world.status().modelKey,'primary');assert.equal(world.status().modelKeyPrimaryRetries,0);}finally{globalThis.fetch=()=>{throw Error('external networking prohibited');};}
});
