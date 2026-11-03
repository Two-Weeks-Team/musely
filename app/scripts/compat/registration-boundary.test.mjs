// Main188fcb7 registration compatibility. Local boot fixture, not actual provider login.
import {test,after} from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';import {DatabaseSync} from 'node:sqlite';
import {personalDigest,personalNonce,signPersonalSession,personalCookie} from '../../worker/core/personal-session.ts';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}',shortCircuit:true};return n(s,c);}`));
const savedFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('registration boundary forbids network');};
after(()=>{globalThis.fetch=savedFetch;assert.equal(networkAttempts,0);});
const O='https://musely.net',H={origin:O,'sec-fetch-site':'same-origin','content-type':'application/json'},D='/api/personal/draft',P='/api/personal/profile';
const intent=(x={})=>({operationId:'op-one',displayName:'  ComBba  ',appearanceId:'00-jolly',...x});
async function boot(t){const {default:worker,WorldDO}=await import('../../worker/index.ts');const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,ready,alarm=null;const sql={exec(q,...b){const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};}};const storage={sql,transactionSync(fn){const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const v=fn();assert.ok(!v?.then);db.exec('RELEASE '+n);return v;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--; }},getAlarm:async()=>alarm,setAlarm:async n=>alarm=n};const ctx={storage,blockConcurrencyWhile:fn=>(ready=fn())},env={MODEL_ID:'synthetic',MODEL_BASE:'https://not-called.invalid',PUBLIC_ORIGIN:O,ALLOWED_HOSTS:'musely.net',DAILY_BUDGET_USD:'1',SESSION_SECRET:'synthetic-session-secret',THREADS_APP_ID:'12345',THREADS_APP_SECRET:'synthetic-app-secret'};let do_;
 const restart=async()=>{do_=new WorldDO(ctx,env);await ready;env.WORLD={idFromName:()=> 'id',get:()=>do_};};await restart();const go=async(method,path,body,cookie,extra={})=>{const r=await worker.fetch(new Request(O+path,{method,headers:{...H,...(cookie?{cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)}),env);return{status:r.status,headers:r.headers,body:await r.json()};};
 const login=async(id='42')=>{const now=Date.now(),f={stateDigest:await personalDigest('state',personalNonce()),browserDigest:await personalDigest('browser',personalNonce()),appId:env.THREADS_APP_ID,redirectUri:O+'/api/threads/callback',createdAt:now,expiresAt:now+600000};assert.equal(do_.personalAuthBegin(f),true);assert.equal(do_.personalAuthConsume(f,now),true);const sid=personalNonce(),digest=await personalDigest('sid',sid),row=do_.personalAuthComplete(f.stateDigest,env.THREADS_APP_ID,id,digest,now);assert.ok(row);const proof={v:1,sid,...row};return{cookie:personalCookie(await signPersonalSession(env.SESSION_SECRET,proof)).split(';')[0],proof,digest};};
 return{db,go,login,restart,env,get do_(){return do_;}};}

import {createOwnershipAdapter} from '../../worker/core/personal-owners.ts';
import {serverAuthorityView} from '../../worker/core/world-life-server.ts';
import {inspectResidentSuggestion} from '../../worker/core/world-life-contract.ts';
test('registered draft stays personal, absent from world and ineligible for resident authority or MCP',async t=>{
 const a=await boot(t),u=await a.login();const before=JSON.stringify(a.do_.runtime.state());
 const r=await a.go('POST',D,intent(),u.cookie);assert.equal(r.status,200);const id=r.body.profile.actorId;
 const registry=a.do_.personalAuth.owners;
 assert.equal(createOwnershipAdapter(registry).resolve(id).kind,'personal');
 assert.equal(JSON.stringify(a.do_.runtime.state()),before,'registration must not enter or mutate live world');
 // Explicit synthetic future-entry probe: not claimed to be implemented world entry.
 const view=structuredClone(a.do_.runtime.state());view.muses.push({...structuredClone(view.muses[0]),id,controlMode:'resident'});
 const now=Date.now(),authority=serverAuthorityView(registry,view,now,['commons:campfire'],true);
 assert.equal(authority.actors.find(x=>x.id===id).personal,true,'client-like resident controlMode cannot override durable personal ownership');
 const verdict=inspectResidentSuggestion({id:'draft-probe',worldId:view.worldId,actorId:id,expectedVersion:view.version,createdAt:now,expiresAt:now+1000,action:'invite'},authority);
 assert.equal(verdict.ok,false);assert.equal(verdict.reason,'owner_authority_required');
 const mcp=await a.go('POST','/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_world_state',arguments:{}}},u.cookie);
 assert.equal(mcp.status,401,'personal cookie is not an MCP agent credential');
 const changed=await a.go('PATCH',P,{expectedRevision:1,displayName:'Resident lookalike'},u.cookie);assert.equal(changed.status,200);
 assert.equal(createOwnershipAdapter(registry).resolve(id).kind,'personal');assert.equal(JSON.stringify(a.do_.runtime.state()),before);
 const logout=await a.go('DELETE','/api/personal/session',undefined,u.cookie);assert.equal(logout.status,200);
 assert.equal((await a.go('GET',P,undefined,u.cookie)).status,401);assert.equal(createOwnershipAdapter(registry).resolve(id).kind,'personal','logout must not turn an owned draft into NPC');
 assert.equal(JSON.stringify(a.do_.runtime.state()),before);
});
