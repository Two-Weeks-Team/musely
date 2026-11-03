// Local deterministic GET fixtures: UI entry evidence only, not a personal Muse connection or device-performance proof.
async (page) => {
 const browser=page.context().browser(),base=new URL(page.url());base.search='';
 const cases=[],writes=[],blocked=[],errors=[];
 const check=(vp,name,ok,detail)=>cases.push({vp,name,ok:!!ok,detail});
 for(const size of [{width:390,height:844},{width:1440,height:1000}]){
  const vp=size.width+'x'+size.height,context=await browser.newContext({viewport:size,isMobile:size.width<700,hasTouch:size.width<700,deviceScaleFactor:1});
  await context.addInitScript(()=>{window.__entryCopies=[];window.__entryHardware=0;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.__entryCopyFail)throw Error('copy denied');window.__entryCopies.push(text);}}});if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{window.__entryHardware++;return Promise.reject(Error('UI test forbids camera'));};if(navigator.geolocation)navigator.geolocation.getCurrentPosition=()=>{window.__entryHardware++;};});
  const p=await context.newPage();p.setDefaultTimeout(6000);p.on('pageerror',e=>errors.push({vp,message:e.message}));
  const ids=['00-jolly','01-sunny','02-moss','03-ripple','04-ember','05-bloom','06-ink','07-tempo','08-orbit','09-copper'];
  const world={worldId:'entry-ui-fixture',day:'2026-11-03',tick:10,version:42,lastTickAt:Date.now(),nextSpotlight:{muse:'00-jolly',freedom:'where'},muses:ids.map(id=>({id,place:'commons:cafe',travel:null,beat:null,inventory:['coffee'],wants:{goal:'Meet a neighbor',items:['tea'],source:'harness'},paused:null}))};
  await context.route('**/*',route=>{
   const req=route.request(),u=new URL(req.url());
   if(!['http:','https:'].includes(u.protocol))return route.continue();
   if(req.method()!=='GET'){writes.push({vp,method:req.method(),path:u.pathname});return route.abort();}
   if(u.origin!==base.origin){
    blocked.push({vp,path:u.pathname,external:true,fixture:true});
    if(u.pathname==='/planet')return route.fulfill({json:{tilejson:'3.0.0',tiles:[base.origin+'/entry-empty/{z}/{x}/{y}.pbf'],minzoom:0,maxzoom:14,vector_layers:[]}});
    if(u.pathname.endsWith('.json'))return route.fulfill({json:{}});
    if(u.pathname.endsWith('.png'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMxkAAAAASUVORK5CYII=','base64')});
    return route.abort();
   }
   if(u.pathname.startsWith('/entry-empty/'))return route.fulfill({contentType:'application/x-protobuf',body:Buffer.alloc(0)});
   if(u.pathname==='/api/status')return route.fulfill({json:{model:{id:'fixture-model',connected:true,live:true},budget:{day:world.day,capUsd:1,spentUsd:0,reservedUsd:0,remainingUsd:1,liveCalls:0},turnstile:{configured:false},session:null,owner:null}});
   if(u.pathname==='/api/personal/me')return route.fulfill({json:{authenticated:false,entry:{state:'viewing'}}});
   if(u.pathname==='/api/world')return route.fulfill({json:world});
   if(u.pathname==='/api/world/events'||u.pathname==='/api/world/highlights')return route.fulfill({json:[]});
   if(u.pathname==='/api/owner/location')return route.fulfill({json:{source:'virtual',preset:'hq',cell_label:'HQ commons',neighborhood_verified:false,muse:{id:'00-jolly',place:{id:'commons:cafe',name:'Commons Cafe'},travel:null}}});
   if(u.pathname.startsWith('/api/')){blocked.push({vp,path:u.pathname,unexpectedAPI:true});return route.fulfill({status:503,json:{error:'ui_fixture_not_an_actual_service'}});}
   return route.continue();
  });
  try{
   await p.goto(base.href,{waitUntil:'domcontentloaded'});
   await p.waitForFunction(()=>window.__world?.getMetrics().ready,null,{timeout:90000});
   await p.waitForFunction(()=>window.__world.mode==='story'||document.getElementById('muse-card')?.dataset.version==='42',null,{timeout:6000});
   const before=await p.evaluate(()=>({mode:window.__world.mode,...window.__world.getMetrics()}));
   check(vp,'first visit opens the shared live world',before.mode==='world',{mode:before.mode});
   check(vp,'the visible world projects the fixture snapshot rather than a local entry trial',await p.locator('#muse-card').getAttribute('data-version')==='42');
   check(vp,'first camera is close to the visible commons',before.zoom>=20.5,{zoom:before.zoom});
   check(vp,'no registration or permission panel opens automatically',await p.locator(':popover-open').count()===0);
   check(vp,'large welcome never covers ordinary zoomed-out viewing',await p.locator('#welcome').isHidden());
   await p.evaluate(()=>window.__world.map.jumpTo({zoom:10.25}));await p.waitForTimeout(400);
   check(vp,'zooming out cannot resurrect the large welcome',await p.locator('#welcome').isHidden());
   check(vp,'watching keeps the same world and actors',await p.evaluate(b=>{const a=window.__world.getMetrics();return a.sceneId===b.sceneId&&a.museIds.every((id,i)=>id===b.museIds[i]);},before));
   const door=p.locator('#entry-open');
   const invitation=()=>door.evaluate(el=>({expanded:el.getAttribute('aria-expanded'),controls:el.getAttribute('aria-controls'),label:el.getAttribute('aria-label'),join:el.dataset.joinState,invitation:el.dataset.invitation,animation:getComputedStyle(el).animationName,duration:getComputedStyle(el).animationDuration,shadow:getComputedStyle(el).boxShadow,rect:{width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}}));
   let d=await invitation();
   check(vp,'the door is visible and unobscured within the viewport',await door.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&(hit===el||el.contains(hit));}));
   check(vp,'a small labelled door has an approximately 44px target',d.rect.width>=44&&d.rect.height>=44&&!!(await door.locator('svg').count())&&/Muse/i.test(d.label??''),d);
   check(vp,'invitation gently pulses for four seconds before joining',d.animation!=='none'&&d.duration==='4s'&&d.invitation==='active'&&d.join==='viewing',d);
   check(vp,'the door declares its collapsed guide relationship',d.expanded==='false'&&d.controls==='entry-panel',d);
   await door.click();await p.waitForSelector('#entry-panel:popover-open');d=await invitation();
   check(vp,'clicking the door opens only the guide and keeps pulsing',d.expanded==='true'&&d.animation!=='none'&&d.invitation==='active'&&d.join==='viewing',d);
   const guide=(await p.locator('#entry-panel').textContent())+'\n'+await p.locator('#entry-setup-text').inputValue();
   check(vp,'the real guide offers explicit personal setup and a permission-bound first meeting',/sign.in|profile/i.test(guide)&&/https:\/\/musely.net\/mcp/.test(guide)&&/secure/i.test(guide)&&/say_hello\(to\)/.test(guide)&&/decide for yourself/i.test(guide),guide);
   check(vp,'ordinary setup has no staged timer or local trial controls',await p.locator('#connect-play,#entry-trial,#entry-wear').count()===0);
   await p.screenshot({path:'output/guide-'+vp+'.png'});
   await p.locator('.entry-body > details.entry-advanced > summary').click();
   const copy=p.locator('#entry-copy-setup');
   if(await copy.count()){
    await copy.click();
    check(vp,'copy contains only public connector setup and no fixed after-meeting script',await p.evaluate(()=>window.__entryCopies.length===1&&window.__entryCopies[0].includes('https://musely.net/mcp')&&window.__entryCopies[0].includes('secure')&&window.__entryCopies[0].includes('say_hello(to)')&&/decide for yourself/i.test(window.__entryCopies[0])&&!/msly_/.test(window.__entryCopies[0])));
    await p.evaluate(()=>{window.__entryCopyFail=true;});await copy.click();
    check(vp,'clipboard refusal leaves readable setup and an unjoined invitation',await p.locator('#entry-setup-text').isVisible()&&await door.getAttribute('data-join-state')==='viewing'&&/could not copy/i.test(await p.locator('#entry-copy-status').textContent()));
   }else check(vp,'public setup can be copied without pretending to join',false);
   await p.waitForTimeout(4300);d=await invitation();
   check(vp,'copying or waiting beyond the old staged timer cannot finish entry',d.join==='viewing'&&d.invitation==='active'&&d.animation!=='none'&&await p.locator('#connect-state').count()===0,d);
   await p.keyboard.press('Escape');await p.waitForTimeout(150);d=await invitation();
   check(vp,'Escape closes the guide and returns focus to the door',await p.locator('#entry-panel').isHidden()&&d.expanded==='false'&&await door.evaluate(el=>document.activeElement===el),d);
   if(await p.locator('#entry-panel').isVisible())await p.locator('#close-entry').click();
   await p.locator('#mode-story').click();await door.click();
   const watch=p.locator('#entry-watch');
   if(await watch.count()){await watch.click();check(vp,'watching returns to the shared world rather than replaying Story',await p.evaluate(()=>window.__world.mode==='world'));}
   else{check(vp,'watching remains available from setup',false);await p.locator('#close-entry').click();}
   await p.emulateMedia({reducedMotion:'reduce'});d=await invitation();
   check(vp,'reduced motion keeps a steady unfinished invitation with no pulse',d.animation==='none'&&d.shadow!=='none'&&d.invitation==='active'&&d.join==='viewing',d);
   await p.evaluate(()=>window.__world.map.jumpTo({zoom:21.2}));await p.waitForTimeout(150);
   check(vp,'door interactions preserve the existing scene and actor identities',await p.evaluate(b=>{const a=window.__world.getMetrics();return a.sceneId===b.sceneId&&a.museIds.every((id,i)=>id===b.museIds[i]);},before));
   check(vp,'entry never asks for camera or location',await p.evaluate(()=>window.__entryHardware===0));
   await p.screenshot({path:'output/door-'+vp+'.png'});
   const story=new URL(base);story.search='?autoplay=1';await p.goto(story.href,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__world?.getMetrics().ready,null,{timeout:90000});
   check(vp,'Story remains an explicit autoplay opt-in',await p.evaluate(()=>window.__world.mode==='story')&&await p.locator('#entry-open').getAttribute('data-invitation')==='active');
   const ordinary=new URL(base);ordinary.search='?entry=connect';await p.goto(ordinary.href,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__world?.getMetrics().ready,null,{timeout:90000});
   check(vp,'a legacy connection query cannot open the staged path without preview opt-in',await p.locator(':popover-open').count()===0&&await p.locator('#entry-open').getAttribute('data-join-state')==='viewing');
   const preview=new URL(base);preview.search='?autoplay=0&entryPreview=1&entry=connect';await p.goto(preview.href,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__world?.getMetrics().ready,null,{timeout:90000});
   check(vp,'the staged walkthrough is explicitly labelled and opt-in',await p.locator('#entry-panel').isVisible()&&await p.locator('#connect-play').count()===1&&/STAGED/.test(await p.locator('#entry-panel').textContent()));
   await p.locator('#connect-play').click();await p.waitForFunction(()=>window.__world.onboarding.state.connect==='connected_staged',null,{timeout:7000});
   check(vp,'opt-in staged completion remains a labelled local preview',/staged/i.test(await p.locator('#entry-open').textContent())&&await p.locator('#entry-open').getAttribute('data-join-state')!== 'joined');


  }catch(e){check(vp,'entry fixture completes',false,String(e));}
  finally{await context.close();}
 }
 check('all','the UI attempted no writes',writes.length===0,writes);
 check('all','no unexpected API path or effectful claim read',!blocked.some(r=>r.unexpectedAPI),blocked.filter(r=>r.unexpectedAPI));
 check('all','no uncaught application exceptions',errors.length===0,errors);
 return {classification:'local fixture UI evidence; actual Muse/auth/camera/device acceptance not measured',cases,writes,blocked,errors};
}
