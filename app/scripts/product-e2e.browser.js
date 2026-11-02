// D-01 default observer: fresh anonymous contexts and public GETs only. No operator/auth/action mode exists here.
// Existing authenticated tools are separate and require a concrete root execution plan. This observer never accepts D-01.
async (page, input = {}) => {
 const allowedInput = new Set(['environment','releasePin']);
 if(Object.keys(input).some(k=>!allowedInput.has(k)))throw Error('Unsupported observer input; credentials/actions do not belong here');
 const origin = new URL(page.url());
 if(origin.username || origin.password)throw Error('Credentialed observer origin refused');
 const local=['127.0.0.1','localhost'].includes(origin.hostname),product=['musely.net','www.musely.net'].includes(origin.hostname);
 if(!(local && ['http:','https:'].includes(origin.protocol)) && !(product && origin.protocol==='https:'))throw Error('Use the product HTTPS origin or a local read-only fixture');
 const environment=input.environment??(local?'local-read-only':'production-read-only');
 if(!['production-read-only','local-read-only','local-fixture'].includes(environment) || (environment==='production-read-only')!==!local)throw Error('Observer environment/origin mismatch');
 if(product)origin.hostname='musely.net';
 const target=new URL('/?autoplay=0',origin.origin),pin=input.releasePin;
 const pinFields=['releaseSha','deployId','configVersion','baseUrl','htmlSha256','operatorAttested'];
 if(pin && (Object.keys(pin).some(k=>!pinFields.includes(k)) || pin.operatorAttested!==true || typeof pin.releaseSha!=='string' || !/^[a-f0-9]{40}$/.test(pin.releaseSha) || typeof pin.htmlSha256!=='string' || !/^[a-f0-9]{64}$/.test(pin.htmlSha256) || typeof pin.deployId!=='string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(pin.deployId) || typeof pin.configVersion!=='string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(pin.configVersion) || new URL(pin.baseUrl).origin!==target.origin || new URL(pin.baseUrl).href!==target.origin+'/'))throw Error('Invalid observer release pin');
 const safeApi=new Set(['/api/status','/api/world','/api/world/events','/api/world/highlights','/api/world/event','/api/world/run','/api/world/run/inputs','/api/world/autonomy','/api/owner/location','/api/owner/session','/api/owner/inbox','/api/claim/owner-muse','/api/ritual/record']);
 const contexts=[],cases=[],blocked=[],requests=[],errors=[],identities=[];const browser=page.context().browser();
 const check=(session,name,ok,detail={})=>cases.push({session,name,ok:!!ok,detail});
 const compact=w=>({worldId:w?.worldId??null,day:w?.day??null,tick:w?.tick??null,version:w?.version??null,museIds:(w?.muses??[]).map(m=>m.id)});
 const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 for(const [session,viewport] of [['anonymous-A',{width:1280,height:800}],['anonymous-B',{width:390,height:844}]]){
  const ctx=await browser.newContext({viewport,permissions:[],acceptDownloads:false,serviceWorkers:'block'});contexts.push(ctx);const p=await ctx.newPage();
  p.on('pageerror',()=>errors.push({session,kind:'page_exception'}));
  await ctx.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),path=u.pathname,isApi=path.startsWith('/api/')||path==='/mcp'||path.startsWith('/.well-known/');
   const same=u.origin===target.origin || product && u.origin==='https://www.musely.net';
   const mapAsset=u.origin==='https://tiles.openfreemap.org';
   const permit=req.method()==='GET' && (isApi ? same && (safeApi.has(path)||/^\/api\/agents\/[^/]+\/card$/.test(path)) : same || mapAsset);
   const row={session,method:req.method(),path,origin:u.origin};requests.push(row);
   if(!permit){blocked.push(row);return route.abort('blockedbyclient');}
   return route.fallback();
  });
  const read=async path=>p.evaluate(async path=>{const r=await fetch(path,{method:'GET',credentials:'omit',cache:'no-store'});return {status:r.status,data:r.ok?await r.json():null};},path);
  try{
   const response=await p.goto(target.href,{waitUntil:'domcontentloaded',timeout:90000});
   const htmlSha256=response?await digest(await response.text()):null;
   check(session,'served HTML response',{value:response?.status()}.value===200,{status:response?.status()??null,htmlSha256});
   check(session,'HTML fingerprint captured; optional attested pin matches',!!htmlSha256&&(!pin||htmlSha256===pin.htmlSha256),{state:pin?'operator tuple plus observed HTML':'unverified: no release pin'});
   await p.waitForFunction(()=>window.__world?.getMetrics().ready,null,{timeout:90000});
   const initial=await read('/api/status'),world=await read('/api/world');
   check(session,'anonymous has no visitor or owner authority',initial.status===200 && initial.data?.session==null && initial.data?.owner==null,{http:initial.status,sessionPresent:!!initial.data?.session,ownerPresent:!!initial.data?.owner});
   check(session,'public server world has stable Muse identities',world.status===200 && typeof world.data?.worldId==='string' && world.data.muses?.length===10 && new Set(world.data.muses.map(m=>m.id)).size===10,{http:world.status,...compact(world.data)});
   const id=world.data?.muses?.[1]?.id;
   if(id){await p.evaluate(id=>window.__world.selectLive(id),id);await p.waitForTimeout(250);check(session,'selection uses the actual server Muse ID',await p.locator('#muse-card').getAttribute('data-muse-id')===id,{selectedId:id});}
   await p.evaluate(()=>window.__world.worldPanel.openTab('feed'));await p.waitForTimeout(250);
   const sources=await p.locator('#world-panel .legend .src').allTextContents();
   check(session,'source legend separates live rule scripted replay',sources.some(s=>s.startsWith('LIVE'))&&['RULE','SCRIPTED','REPLAY'].every(s=>sources.includes(s)),{sources});
   check(session,'viewport remains within the screen',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),{viewport});
   await p.screenshot({path:`output/product-e2e-${session}.png`});
   await p.evaluate(()=>window.__world.worldPanel.openTab('identity'));await p.waitForTimeout(250);
   const inbox=await read('/api/owner/inbox');check(session,'anonymous owner inbox remains protected',inbox.status===401||inbox.status===403,{http:inbox.status});
   await p.locator('.ritual-recorded .src').first().waitFor({timeout:10000});
   const recordLabel=await p.locator('.ritual-recorded .src').first().textContent();
   check(session,'a recorded ritual is labelled as replay',recordLabel?.includes('REPLAY'),{recordLabel,meaning:'no new-person/webcam proof inferred'});
   await p.reload({waitUntil:'domcontentloaded',timeout:90000});await p.waitForFunction(()=>window.__world?.getMetrics().ready,null,{timeout:90000});
   const after=await read('/api/status'),reconnected=await read('/api/world');
   check(session,'reconnect does not acquire authority',after.status===200 && after.data?.session==null && after.data?.owner==null,{http:after.status,sessionPresent:!!after.data?.session,ownerPresent:!!after.data?.owner});
   check(session,'reconnect returns to the same shared world',reconnected.status===200 && reconnected.data?.worldId===world.data?.worldId,{before:compact(world.data),after:compact(reconnected.data)});
   identities.push({session,htmlSha256,worldId:world.data?.worldId??null});
  }catch{check(session,'read-only observation completed',false,{reason:'observation_unavailable; no raw response or credential retained'});}
  finally{await ctx.close();}
 }
 check('all','no page exception',errors.length===0);
 check('all','two independent anonymous browser contexts',contexts.length===2 && contexts[0]!==contexts[1]);
 check('all','observer issued no service writes or model/MCP calls',!requests.some(r=>r.method!=='GET' && !blocked.includes(r)) && !requests.some(r=>r.path==='/mcp'&&!blocked.includes(r)));
 check('all','application attempted no product writes',!blocked.some(r=>r.origin===target.origin && r.method!=='GET'),{blockedCount:blocked.length});
 const humanPending=['real-owner-claim','real-webcam-ritual','real-Muse-platform-connection','real-activity','real-session-reconnect','connected-Muse-inbox-response','two-owner-approval','reward','revocation','no-agreement','one-side-refusal','changed-candidate','expired-task'];
 return {environment,scope:'anonymous-read-only-observer',acceptedD01:false,releaseBinding:pin?'operator-attested tuple; HTML checked only':'unverified',cases,requests,blocked,errors,identities,humanChecks:humanPending.map(kind=>({kind,status:'pending',reason:'requires a concrete operator/connected-real session plan and same-release redacted receipt'})),limitations:['Observer results are not actual account/webcam/approval acceptance','A fixture/trial/replay source never proves a connected real Muse','No production POST/auth/claim/revoke is implemented in this observer','No raw camera, cookie, bearer, private reason or full response body is saved']};
}
