// I-03B transport fixture: real localhost TLS → Worker entry → WorldDO → ES256/JCS → SQLite transaction.
// Only cloudflare:workers' base class and Durable Object storage are substituted. No model or real account is used.
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {createServer, request, Agent} from 'node:https';
import {mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return {url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true};
  return next(spec, ctx);
}`));
const OWNER_TOKEN = 'i03b-test-owner-token-0000000000000001', PEER_TOKEN = 'i03b-test-peer-token-00000000000000002';
export const JOLLY = '00-jolly', COPPER = '09-copper';
export async function httpsWorld(test) {
  const dir = mkdtempSync(join(tmpdir(), 'musely-mcp-tls-'));
  const keyFile = join(dir, 'key.pem'), certFile = join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', keyFile, '-out', certFile], {stdio: 'ignore'});
  const cert = readFileSync(certFile), agent = new Agent({ca: cert, keepAlive: true});
  const {default: worker, WorldDO} = await import('../../worker/index.ts');
  const db = new DatabaseSync(':memory:');let depth = 0, ready, alarm = null, env;
  const sql = {exec(q, ...b) { if (/^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK|RELEASE|END)\b/i.test(q)) throw new Error('use transactionSync'); const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }};
  const transactionSync = fn => { const sp = 'tx' + depth++; db.exec('SAVEPOINT ' + sp); try { const r = fn(); assert.ok(!r || typeof r.then !== 'function', 'transaction is synchronous'); db.exec('RELEASE ' + sp); return r; } catch (e) { db.exec('ROLLBACK TO ' + sp); db.exec('RELEASE ' + sp); throw e; } finally { depth--; } };
  const ctx = {storage: {sql, transactionSync, getAlarm: async () => alarm, setAlarm: async x => { alarm = x; }}, blockConcurrencyWhile: fn => (ready = fn())};
  const wire = [], trace=[];
  const server = createServer({key: readFileSync(keyFile), cert}, async (req, res) => {
    try {
      const chunks=[];for await (const chunk of req) chunks.push(chunk);
      const body=Buffer.concat(chunks).toString(), headers=new Headers();
      for(const [k,v] of Object.entries(req.headers)) if(v!==undefined) headers.set(k,Array.isArray(v)?v.join(', '):v);
      const result=await worker.fetch(new Request(env.PUBLIC_ORIGIN+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body}: {})}),env);
      res.writeHead(result.status,Object.fromEntries(result.headers));const text=await result.text();res.end(text);
      // Response-only trace. Request authorization, cookies and owner control tokens are never logged.
      wire.push({path:req.url,status:result.status,text});
    } catch(e) {res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(e)}));}
  });
  test.after(async()=>{agent.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});if(process.env.MCP_SMOKE_EVIDENCE){mkdirSync(process.env.MCP_SMOKE_EVIDENCE,{recursive:true});writeFileSync(join(process.env.MCP_SMOKE_EVIDENCE,'fixture-'+dir.split('/').at(-1)+'.json'),JSON.stringify({test:test.name,origin,kind:'localhost TLS + Worker/WorldDO SQLite fixture; no real account/model/deployment',tls_certificate_verified:trace.length?trace.every(x=>x.tls_verified===true):null,server_closed:!server.listening,certificate_removed:true,trace},null,2)+'\n');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='https://127.0.0.1:'+server.address().port;
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  env={MODEL_ID:'muse-spark-1.3',MODEL_BASE:'https://api.meta.ai/v1',DAILY_BUDGET_USD:'1',TURNSTILE_SITEKEY:'x',ALLOWED_HOSTS:new URL(origin).host,PUBLIC_ORIGIN:origin,SESSION_SECRET:'i03b-test-session-secret',OWNER_CONTROL_TOKEN:OWNER_TOKEN,DEMO_PEER_CONTROL_TOKEN:PEER_TOKEN,OWNER_ROOT_JWK:JSON.stringify(await crypto.subtle.exportKey('jwk',pair.privateKey))};
  const t={sql,db,env,ctx,wire,origin,server};
  t.restart=async()=>{t.dobj=new WorldDO(ctx,env);await ready;env.WORLD={idFromName:()=> 'id',get:()=>t.dobj};};await t.restart();env.ASSETS={fetch:async()=>new Response('asset')};
  t.go=(method,path,body,headers={})=>new Promise((resolve,reject)=>{
    const req=request(origin+path,{agent,method,headers:{'content-type':'application/json',...headers}},res=>{const tls=res.socket.authorized,tlsProtocol=res.socket.getProtocol();let text='';res.setEncoding('utf8');res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:text?JSON.parse(text):null,tls,tlsProtocol}));});
    req.on('error',reject);if(body!==undefined)req.write(typeof body==='string'?body:JSON.stringify(body));req.end();
  });
  t.state=()=>t.dobj.runtime.state();t.muse=id=>t.state().muses.find(m=>m.id===id);t.task=id=>t.state().inbox.tasks.find(x=>x.id===id);
  t.events=()=>t.dobj.worldEvents(0,5000);t.edit=fn=>t.dobj.runtime.commitExternal(Date.now(),'test-'+Math.random(),st=>fn(st));
  t.claim=claimed=>t.dobj.setClaim('owner-muse',{agent:'owner-muse',status:claimed?'claimed':'pending_claim',path:'worker_token',handle:'fixture',fingerprint:'fixture',permalink:null,mediaId:null,postedText:null,verifiedAt:Date.now(),checkedAt:Date.now(),machineVerified:true,note:'local fixture only'});t.claim(true);
  t.cookies={};t.keys={};let seq=0;
  t.rpc=async(key,method,params={},modern=true)=>{const response=await t.go('POST','/mcp',{jsonrpc:'2.0',id:++seq,method,params:modern?{...params,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}:params},{authorization:'Bearer '+key,'mcp-protocol-version':modern?'2026-07-28':'2025-06-18',...(modern?{'mcp-method':method,...(method==='tools/call'?{'mcp-name':params.name}:{})}:{})});const r=response.body?.result?.structuredContent;trace.push({method,tool:params.name??null,protocol:modern?'2026-07-28':'2025-06-18',tls_verified:response.tls,tls_protocol:response.tlsProtocol,http_status:response.status,rpc_error:response.body?.error?.code??null,refused:r?.refused??null,command:r?.command??null,envelope:r?.envelope??null});return response;};
  t.tool=async(muse,name,args={},modern=true)=>{const r=await t.rpc(t.keys[muse].key,'tools/call',{name,arguments:args},modern);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result??r.body;};
  for(const [muse,token] of [[JOLLY,OWNER_TOKEN],[COPPER,PEER_TOKEN]]){
    const login=await t.go('POST','/api/owner/session',{token},{origin});assert.equal(login.status,200,JSON.stringify(login.body));t.cookies[muse]=login.headers['set-cookie'][0].split(';')[0];
    const issued=await t.go('POST','/api/agent-keys',{}, {origin,cookie:t.cookies[muse]});assert.equal(issued.status,201);t.keys[muse]=issued.body;
    assert.equal((await t.tool(muse,'get_world_state')).isError,false);
  }
  t.edit(st=>{for(const m of st.muses){m.place='commons:cafe';m.travel=null;m.beat=null;}});
  t.decide=(muse,body)=>t.go('POST','/api/owner/approvals',body,{origin,cookie:t.cookies[muse]});
  return t;
}
export const domainState = t => ({muses: t.state().muses.map(m=>({id:m.id,place:m.place,travel:m.travel,inventory:m.inventory,wants:m.wants,reflection:m.reflection,memory:m.memory})),items:t.state().items,tasks:t.state().inbox.tasks,mail:t.state().inbox.mail,messages:t.state().inbox.messages,invites:t.state().inbox.invites});
