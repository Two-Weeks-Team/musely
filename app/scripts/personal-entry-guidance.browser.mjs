// Full built UI + synthetic account/authority/key/status. No real auth, provider, bearer or MCP.
import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
if(!process.env.PLAYWRIGHT_MODULE)throw Error('Use an existing PLAYWRIGHT_MODULE');
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE),root=new URL('../',import.meta.url).pathname;
const P={actorId:'pm_11111111-1111-4111-8111-111111111111',displayName:'Sample Muse',appearanceId:'00-jolly',revision:1};
const K={id:'pak_11111111-1111-4111-8111-111111111111',actorId:P.actorId,signerKind:'server_custodial',grantVersion:1,createdAt:100,revokedAt:null};
const ids=['00-jolly','01-sunny','02-moss','03-ripple','04-ember','05-bloom','06-ink','07-tempo','08-orbit','09-copper'];
const b=await chromium.launch({channel:'chrome',headless:true}),results=[];let remoteForwarded=0;
try{for(const width of[390,1280]){
 const ctx=await b.newContext({viewport:{width,height:844}});let profile=null,authority=null,key=false,connected=false,joined=false,a=null;const writes=[],errors=[];
 const entry=()=>({state:joined?'joined':a?'joining':'viewing',actor:profile?{id:P.actorId,displayName:P.displayName,appearanceId:P.appearanceId,profileRevision:1}:null,attempt:a?{id:a.id,expiresAt:a.expiresAt,status:'pending'}:null,receipt:joined?{id:'receipt-current-fixture',actorId:P.actorId,worldId:'entry-guidance-fixture',committedAt:Date.now()}:null,reason:joined?null:a?'waiting_connector':'setup_required'});
 await ctx.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.protocol==='blob:')return r.continue();
  if(u.origin!=='http://localhost'){if(u.pathname==='/planet')return r.fulfill({json:{tilejson:'3.0.0',tiles:['http://localhost/empty/{z}/{x}/{y}.pbf'],minzoom:0,maxzoom:14,vector_layers:[]}});if(u.pathname.endsWith('.json'))return r.fulfill({json:{}});if(u.pathname.endsWith('.png'))return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMxkAAAAASUVORK5CYII=','base64')});return r.abort();}
  if(q.method()!=='GET'){
   writes.push({path:u.pathname,method:q.method()});const data=q.postDataJSON();
   if(u.pathname==='/api/personal/draft'){assert.equal(data.displayName,P.displayName);profile=P;return r.fulfill({json:{profile,entry:{state:'registered'}}});}
   if(u.pathname==='/api/personal/authority'){assert.deepEqual(data.scopes,['world_entry','walk_and_greet']);authority={actorId:P.actorId,version:1,active:true,scopes:data.scopes};return r.fulfill({json:{authority}});}
   if(u.pathname==='/api/personal/keys'){assert.equal(key,false);key=true;return r.fulfill({json:{status:'issued',key:'msly_'+'S'.repeat(43),row:K}});}
   if(u.pathname==='/api/personal/entry-attempts'){const now=Date.now();a={id:'pea_11111111-1111-4111-8111-111111111111',actorId:P.actorId,keyId:K.id,grantVersion:1,profileRevision:1,worldId:'entry-guidance-fixture',scopeHash:'75a27b5c8e0369f8440ce477dec2fe2d0c0bdd6513b605e3fb57e90b8d3ee823',createdAt:now,expiresAt:now+600000,status:'pending',validity:'pending'};return r.fulfill({json:{attempt:a,entry:entry()}});}
   return r.abort();
  }
  if(u.pathname==='/api/personal/me')return r.fulfill({json:{authenticated:true,expiresAt:Date.now()+3600000,entry:{state:'viewing'}}});
  if(u.pathname==='/api/personal/profile')return r.fulfill({json:{profile,entry:{state:profile?'registered':'viewing'}}});
  if(u.pathname==='/api/personal/status')return r.fulfill({json:{profile,authority,keys:key?[K]:[],entry:entry(),connection:{connected,lastSeenAt:connected?Date.now():null}}});
  if(u.pathname==='/api/world')return r.fulfill({json:{worldId:'entry-guidance-fixture',day:'2026-11-04',tick:10,version:42,lastTickAt:Date.now(),nextSpotlight:{muse:'00-jolly',freedom:'where'},muses:ids.map(id=>({id,place:'commons:cafe',travel:null,beat:null,inventory:[],paused:null}))}});
  if(u.pathname==='/api/status')return r.fulfill({json:{model:{id:'fixture',connected:false,live:false},budget:{},turnstile:{configured:false},session:null,owner:null}});
  if(u.pathname==='/api/world/events'||u.pathname==='/api/world/highlights')return r.fulfill({json:[]});
  if(u.pathname==='/api/owner/location')return r.fulfill({json:{source:'virtual',preset:'hq',cell_label:'HQ commons',muse:{id:'00-jolly',place:{id:'commons:cafe',name:'Cafe'},travel:null}}});
  if(u.pathname.startsWith('/api/'))return r.fulfill({status:503,json:{error:'local_fixture'}});
  if(u.pathname.includes('..'))return r.abort();
  try{const path=u.pathname==='/'?'index.html':u.pathname.slice(1);return r.fulfill({body:await readFile(root+'dist/'+path),contentType:path.endsWith('.html')?'text/html':/\.m?js$/.test(path)?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}
 });
 await ctx.addInitScript(()=>{window.safeCopies=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async s=>{window.safeCopies.push(s.startsWith('msly_')?'synthetic-key':'public-invitation');}}});if(navigator.geolocation)navigator.geolocation.getCurrentPosition=()=>{throw Error('No GPS');};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{throw Error('No camera');};});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto('http://localhost/',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__world?.liveScene?.liveProjection.world);const start=performance.now();
 await p.locator('#entry-open').click();await p.locator('[name=displayName]').fill(P.displayName);
 const primary=async()=>{const xs=p.locator('#entry-panel button.primary:visible');assert.equal(await xs.count(),1);return xs.first();};
 await(await primary()).click();await p.locator('[name=scope-world_entry]').waitFor({state:'visible'});assert.equal(writes.length,1);
 await p.locator('[name=scope-world_entry]').check();await p.locator('[name=scope-walk_and_greet]').check();await(await primary()).click();
 await p.locator('[data-action=issue-key].primary').waitFor();await(await primary()).click();await p.locator('[data-action=copy-key].primary').waitFor();
 assert.equal(await p.locator('.entry-setup-picture[role=img]').count(),3);assert.equal(await p.locator('[name=one-time-key]').getAttribute('type'),'password');assert.equal(await p.locator('[data-action=copy-key]').count(),1);
 await(await primary()).click();await p.locator('[data-action=dismiss-key].primary').waitFor();await(await primary()).click();assert.equal(await p.locator('[name=one-time-key]').count(),0);assert.equal(await p.locator('#entry-open').getAttribute('data-invitation'),'active');
 connected=true;await p.waitForFunction(()=>document.querySelector('.personal-connection').dataset.connected==='true',{},{timeout:10000});assert.equal(await p.locator('#entry-open').getAttribute('data-invitation'),'active');assert.match(await p.locator('.entry-connection-state').innerText(),/아직 세계 입장 완료는 아니/);
 await p.locator('[data-action=create-attempt].primary').waitFor();await(await primary()).click();await p.locator('[data-action=copy-setup].primary').waitFor();await(await primary()).click();joined=true;
 await p.waitForFunction(()=>document.querySelector('#entry-open').dataset.invitation==='complete',{},{timeout:10000});assert.equal(await p.locator('.personal-connection').getAttribute('data-joined'),'true');
 const visibleText=await p.locator('#entry-panel').innerText();assert.doesNotMatch(visibleText,/principal|attempt_id|register_agent|enter_world|permission version|pak_|msly_/);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(await p.evaluate(()=>window.safeCopies),['synthetic-key','public-invitation']);assert.deepEqual(errors,[]);
 await p.locator('[data-action=watch-muse].primary').click();assert.equal(await p.locator('#entry-panel').evaluate(e=>e.matches(':popover-open')),false);
 results.push({width,buttonClicks:9,permissionChoices:2,elapsedMs:Math.round(performance.now()-start),writes:writes.length,blocked:false,actualCredential:false});await ctx.close();
 }
 console.log(JSON.stringify({scope:'Full built UI with simulated authenticated account/status and synthetic one-time key; 5-second polls included; no actual Muse/account/provider',results,remoteForwarded,actualAuth:0,actualKey:0,camera:0,model:0},null,2));
}finally{await b.close();}
