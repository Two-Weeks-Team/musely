// Real Worker/WorldDO + SQLite; every upstream call is a synthetic fetch. No provider or model networking.
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
 const {default:worker,WorldDO}=await import('../../worker/index.ts');const db=new DatabaseSync(':memory:');t.after(()=>db.close());let depth=0,ready,alarm=null;
 const sql={exec(q,...b){if(/^\s*(BEGIN|SAVEPOINT|RELEASE|COMMIT|ROLLBACK)/i.test(q))throw Error('transactionSync required');const s=db.prepare(q),rows=s.columns().length?s.all(...b):(s.run(...b),[]);return{toArray:()=>rows};}};
 const transactionSync=fn=>{const n='tx'+depth++;db.exec('SAVEPOINT '+n);try{const v=fn();assert.ok(!v?.then);db.exec('RELEASE '+n);return v;}catch(e){db.exec('ROLLBACK TO '+n);db.exec('RELEASE '+n);throw e;}finally{depth--;}};
 const ctx={storage:{sql,transactionSync,getAlarm:async()=>alarm,setAlarm:async x=>{alarm=x;}},blockConcurrencyWhile:fn=>(ready=fn())};
 const env={WORLD_LIFE_MODE:'sandbox-v1',MODEL_ID:'synthetic-model',MODEL_BASE:'https://not-called.invalid/v1',DAILY_BUDGET_USD:'1',PUBLIC_ORIGIN:ORIGIN,ALLOWED_HOSTS:'musely.net,www.musely.net',SESSION_SECRET:'synthetic-personal-session-secret',OWNER_CONTROL_TOKEN:OWNER,THREADS_APP_ID:'123456789',THREADS_APP_SECRET:'synthetic-provider-secret',...override};
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


async function bootstrap(t,scopes=['world_entry']){const a=await boot(t,t.envOverride??{}),calls=provider(t),u=await login(a);const draft=await a.go('POST','/api/personal/draft',{...H,cookie:u.c,'content-type':'application/json'},JSON.stringify({operationId:'draft-one',displayName:'Synthetic participant',appearanceId:'00-jolly'}));assert.equal(draft.status,200);const profile=(await draft.json()).profile;const grant=await a.go('POST','/api/personal/authority',{...H,cookie:u.c,'content-type':'application/json'},JSON.stringify({expectedVersion:0,scopes}));assert.equal(grant.status,200,'explicit personal grant must be available');const issue=await a.go('POST','/api/personal/keys',{...H,cookie:u.c,'content-type':'application/json'},JSON.stringify({operationId:'entry-key',expectedVersion:1}));assert.equal(issue.status,200);const key=await issue.json();return{...a,get dobj(){return a.dobj;},calls,cookie:u.c,profile,key,async status(){return(await a.go('GET','/api/personal/status',{cookie:u.c})).json();},async attempt(operationId='entry-attempt'){const worldId=a.dobj.worldView().worldId;const r=await a.go('POST','/api/personal/entry-attempts',{...H,cookie:u.c,'content-type':'application/json'},JSON.stringify({operationId,keyId:key.row.id,expectedGrantVersion:1,expectedProfileRevision:profile.revision,worldId}));assert.equal(r.status,200);return(await r.json()).attempt;},async mcp(name,args){const {hashAgentKey}=await import('../../worker/core/agent-keys.ts');return a.dobj.mcp(await hashAgentKey(key.key),'tools/call',{name,arguments:args},false);}};}
function toolValue(out){assert.equal(out.status,'ok');return out.result.structuredContent;}

export {bootstrap as installedPersonal,toolValue,H,dbText};
