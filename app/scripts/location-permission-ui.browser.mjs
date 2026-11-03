// Full built app, fresh isolated contexts; permission/position/world responses are synthetic.
// PLAYWRIGHT_MODULE is an existing playwright-core index.mjs. No shared Chrome or real GPS.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
if (!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE to existing playwright-core');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE),root=new URL('../',import.meta.url).pathname;
const ids=['00-jolly','01-sunny','02-moss','03-ripple','04-ember','05-bloom','06-ink','07-tempo','08-orbit','09-copper'];
const presets=[['hq','HQ commons'],['stanford','Stanford'],['san-francisco','San Francisco'],['oakland','Oakland'],['san-mateo','San Mateo'],['mountain-view','Mountain View'],['redwood-city','Redwood City'],['san-jose','San Jose']].map(([id,label])=>({id,label}));
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];let writes=0,externalForwarded=0;
try {
 for(const scenario of ['near','granted','denied','outside','failure','query-unavailable','owner-pending']){
  const ctx=await browser.newContext({viewport:{width:390,height:844}}),pending=[];
  await ctx.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url());if(q.method()!=='GET'){writes++;return r.abort();}
   if(u.protocol==='blob:')return r.continue();
   if(u.origin!=='http://localhost'){
    if(u.pathname==='/planet')return r.fulfill({json:{tilejson:'3.0.0',tiles:['http://localhost/empty/{z}/{x}/{y}.pbf'],minzoom:0,maxzoom:14,vector_layers:[]}});
    if(u.pathname.endsWith('.json'))return r.fulfill({json:{}});
    if(u.pathname.endsWith('.png'))return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMxkAAAAASUVORK5CYII=','base64')});
    return r.abort();
   }
   if(u.pathname.startsWith('/empty/')||u.pathname.endsWith('.pbf'))return r.fulfill({body:Buffer.alloc(0),contentType:'application/x-protobuf'});
   if(u.pathname==='/api/world')return r.fulfill({json:{worldId:'location-ui-fixture',day:'2026-11-04',tick:10,version:42,lastTickAt:Date.now(),nextSpotlight:{muse:'00-jolly',freedom:'where'},muses:ids.map(id=>({id,place:'commons:cafe',travel:null,beat:null,inventory:[],paused:null}))}});
   if(u.pathname==='/api/status')return r.fulfill({json:{model:{id:'fixture',connected:false,live:false},budget:{},turnstile:{configured:false},session:null,owner:null}});
   if(u.pathname==='/api/world/events'||u.pathname==='/api/world/highlights')return r.fulfill({json:[]});
   if(u.pathname==='/api/owner/location'){
    if(scenario==='owner-pending'){pending.push(r);return;}
    return r.fulfill({json:{source:'virtual',preset:'hq',cell_label:'HQ commons',presets,neighborhood_verified:false,muse:{id:'00-jolly',place:{id:'commons:cafe',name:'Commons Cafe'},travel:null}}});
   }
   if(u.pathname.startsWith('/api/'))return r.fulfill({status:503,json:{error:'local_fixture'}});
   if(u.pathname.includes('..'))return r.abort();
   try{const path=u.pathname==='/'?'index.html':u.pathname.slice(1),body=await readFile(root+'dist/'+path);return r.fulfill({body,contentType:path.endsWith('.html')?'text/html':/\.m?js$/.test(path)?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}
  });
  await ctx.addInitScript(s=>{
   window.locationViews=0;window.geoReads=0;
   Object.defineProperty(navigator,'permissions',{value:{query:async()=>{if(s==='query-unavailable')throw Error('fixture');return{state:s==='granted'?'granted':['denied','owner-pending'].includes(s)?'denied':'prompt',addEventListener(){}};}}});
   Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok,fail){window.geoReads++;if(s==='outside')ok({coords:{latitude:0,longitude:0}});else if(s==='failure')fail({code:2});else ok({coords:{latitude:37.4275,longitude:-122.1697}});}}});
  },scenario);
  const page=await ctx.newPage();await page.goto('http://localhost/',{waitUntil:'domcontentloaded'});await page.locator('#world-open').waitFor();
  const before=performance.now();let buttonClicks=2,selections=0;
  await page.locator('#world-open').click();await page.locator('#world-panel .tab[data-tab="location"]').click();
  if(!['granted','denied','owner-pending'].includes(scenario)){await page.locator('#device-location-request').click();buttonClicks++;}
  if(['denied','outside','failure','owner-pending'].includes(scenario)){
   await page.locator('#device-location-virtual').waitFor({state:'visible'});
   if(scenario==='owner-pending'){const previous=await page.locator('#device-location').evaluate(e=>(window.savedDevice=e,true));for(const r of pending)await r.fulfill({status:503,json:{error:'local_fixture'}});await page.getByText('동네 정보를 불러오지 못했어요 / Neighborhood details are unavailable',{exact:true}).waitFor({state:'attached'});assert.equal(await page.locator('#device-location').evaluate(e=>e===window.savedDevice),previous);}
   await page.locator('#device-location-virtual').selectOption('stanford');selections++;
   await page.locator('#device-location-view').click();buttonClicks++;
  }
  await page.waitForFunction(()=>!document.querySelector('#world-panel').matches(':popover-open'));
  const state=await page.evaluate(()=>({geo:window.geoReads,status:document.querySelector('#device-location').dataset.status,text:document.querySelector('#device-location').textContent,center:window.__world.map.getCenter().toArray()}));
  assert.equal(state.geo,['denied','owner-pending'].includes(scenario)?0:1);assert.match(state.text,/가까운 동네/);assert.doesNotMatch(state.text,/GPS|preset|cell|principal|Ask again|phase 2/);assert.ok(state.center.every(Number.isFinite));
  results.push({scenario,buttonClicks,selections,elapsedMs:Math.round(performance.now()-before),syntheticPositionReads:state.geo,blocked:false});await ctx.close();
 }
 assert.equal(writes,0);console.log(JSON.stringify({scope:'Full built app in fresh isolated Chromium contexts; local API/permission/position fixtures; UI time excludes OS prompt and GPS time',results,writes,externalForwarded,actualGPS:0,permissionChanges:0},null,2));
}finally{await browser.close();}
