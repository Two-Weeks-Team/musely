// Actual WorldDO class under Node, but Cloudflare base/storage/alarm scheduling are LOCAL fixtures.
// Not a workerd deployment or provider-login test. All credentials are ephemeral test-only values.
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {handleMcpHttp} from '../../worker/core/mcp-server.ts';
import {connectedRoutes} from '../../worker/core/owner-api.ts';
import {issueOwnerSession,readOwnerSession} from '../../worker/core/owner-session.ts';
const shim='data:text/javascript,'+encodeURIComponent('export class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}');
const hook=registerHooks({resolve(specifier,context,next){return specifier==='cloudflare:workers'?{url:shim,shortCircuit:true}:next(specifier,context);}});
const {WorldDO}=await import('../../worker/world-do.ts');const {default:worker}=await import('../../worker/index.ts');hook.deregister();
export const HOST='https://musely.net',FIRE='commons:campfire',OWNER='00-jolly',PEER='09-copper';
export async function bootWorldDo(t,{campfires,mode,modelFetcher}={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let tx=false,alarm=null,ready;
 const sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 const transactionSync=fn=>{assert.equal(tx,false,'fixture disallows nested transactions');db.exec('BEGIN');tx=true;try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}finally{tx=false;}};
 const storage={sql,transactionSync,getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;}};
 const ctx={storage,blockConcurrencyWhile(fn){ready=fn();}};
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const root=await crypto.subtle.exportKey('jwk',pair.privateKey);
 const tokens={owner:'fixture-owner-control-token-000001',peer:'fixture-peer-control-token-000002'};
 const env={PUBLIC_ORIGIN:HOST,ALLOWED_HOSTS:'musely.net',DAILY_BUDGET_USD:modelFetcher?'20':'0.00001',OWNER_ROOT_JWK:JSON.stringify(root),OWNER_CONTROL_TOKEN:tokens.owner,DEMO_PEER_CONTROL_TOKEN:tokens.peer,MODEL_BASE:'https://invalid.test',MODEL_ID:'offline-fixture',MODEL_API_KEY:modelFetcher?'fixture-model-key':undefined,WORLD_LIFE_MODE:mode};
 let world=new WorldDO(ctx,env);await ready;
 // Test-only server configuration injection; production WorldDO never enables this policy.
 if(campfires)world.connected.d.campfires=campfires;
 // Claim is deliberately a setup fixture, not a real external identity verification result.
 world.setClaim('owner-muse',{status:'claimed',path:'fixture',fingerprint:'fixture-only',machineVerified:false});
 const cfg={secret:'fixture-owner-session-secret',tokens,origins:[HOST]};
 const ownerFor=async principal=>{const {token}=await issueOwnerSession(cfg.secret,tokens,principal);return readOwnerSession(cfg.secret,token,tokens);};
 const issue=async principal=>{const req=new Request(HOST+'/api/agent-keys',{method:'POST',headers:{'content-type':'application/json',origin:HOST}});const res=await connectedRoutes(req,new URL(req.url),{owner:await ownerFor(principal)},world,cfg);assert.equal(res.status,201);return res.json();};
 const issued={owner:await issue('owner'),peer:await issue('demo-peer')};let seq=0;
 const call=async(who,name,args={},override={})=>{const res=await handleMcpHttp(new Request(HOST+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name,arguments:args}}),headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+issued[who].key,...override}}),world,{allowedHosts:['musely.net']});return {status:res.status,body:await res.json()};};
 await call('owner','get_world_state');await call('peer','get_world_state');
 // Test-only introspection. No public runtime/property access or production hook is introduced.
 env.WORLD={idFromName:()=> 'fixture-world',get:()=>world};
 let runtime=world.runtime;
 if(modelFetcher)runtime.opts.model.fetcher=modelFetcher;
 const restart=async()=>{world=new WorldDO(ctx,env);await ready;runtime=world.runtime;if(modelFetcher)runtime.opts.model.fetcher=modelFetcher;};
 const request=(path,options={})=>worker.fetch(new Request(HOST+path,options),env);
 const edit=fn=>runtime.commitExternal(Date.now(),'fixture-'+(++seq),fn);
 const prepare=()=>edit(s=>{for(const m of s.muses){m.place=FIRE;m.travel=null;m.beat=null;m.wants.items=['invite_token'];}s.muses.find(m=>m.id===OWNER).inventory.push('invite_token','invite_token');});
 return {db,sql,storage,get world(){return world;},get runtime(){return runtime;},call,edit,prepare,issued,ownerFor,cfg,env,request,restart};
}
