// D-04 layout regression only: local deterministic GET fixtures, no device/FPS/memory acceptance measurement.
// Run with the repository's Playwright callback runner against built local dist. It owns only fresh contexts.
async(page)=>{
 const base=new URL(page.url());base.search='?autoplay=0&entryPreview=1&dpr=1.5';
 const browser=page.context().browser(),cases=[],writes=[],errors=[];
 const check=(vp,name,ok,detail)=>cases.push({vp,name,pass:!!ok,detail});
 for(const size of [{width:360,height:640},{width:390,height:844},{width:1440,height:1000}]){
  const vp=size.width+'x'+size.height,context=await browser.newContext({viewport:size,deviceScaleFactor:1.5,isMobile:size.width<700,hasTouch:size.width<700});
  const p=await context.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push({vp,message:e.message}));
  const ids=['00-jolly','01-sunny','02-moss','03-ripple','04-ember','05-bloom','06-ink','07-tempo','08-orbit','09-copper'];
  const world={worldId:'musely',day:'2026-11-02',tick:10,version:42,lastTickAt:Date.now(),nextSpotlight:{muse:'00-jolly',freedom:'where'},muses:ids.map(id=>({id,place:'commons:cafe',travel:null,beat:null,inventory:['coffee'],memory:[],reflection:'',wants:{goal:'Meet a neighbor',items:['tea'],source:'harness'}}))};
  await p.route('**/api/**',route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){writes.push({vp,method:request.method(),path:url.pathname});return route.abort();}
   if(url.pathname==='/api/status')return route.fulfill({json:{model:{id:'fixture-model',connected:true,live:true},budget:{day:'2026-11-02',capUsd:1,spentUsd:0,reservedUsd:0,liveCalls:0,remainingUsd:1},turnstile:{sitekey:'fixture',configured:false},session:null}});
   if(url.pathname==='/api/owner/location')return route.fulfill({json:{source:'virtual',preset:'stanford',cell_label:'Stanford',cell:'fixture-cell',neighborhood_verified:true,set_at:Date.now(),muse:{id:'00-jolly',place:{id:'commons:cafe',name:'Commons café'},at_owner_cell:false,travelling_to:{id:'bay:stanford',name:'Stanford'},speed:'walk',eta_ms:1_800_000,arrive_at:Date.now()+1_800_000}}});
   if(url.pathname==='/api/world')return route.fulfill({json:world});
   if(url.pathname==='/api/world/events'||url.pathname==='/api/world/highlights')return route.fulfill({json:[]});
   return route.fulfill({status:503,json:{error:'read_only_layout_fixture'}});
  });
  const geometry=()=>p.evaluate(()=>{
   const rect=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,hidden:el.hidden,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight};};
   return {header:rect('header'),footer:rect('footer'),welcome:rect('#welcome'),card:rect('#muse-card'),bodyOverflow:document.documentElement.scrollWidth-innerWidth};
  });
  const reachable=async(selector,label,scroll=true)=>{
   const el=p.locator(selector);
   try{
    if(scroll)await el.scrollIntoViewIfNeeded();
    const value=await el.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,inside:r.x>=-1&&r.y>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,hit:hit===el||el.contains(hit),visible:!!r.width&&!!r.height};});
    check(vp,label,value.inside&&value.hit&&value.visible,value);return value.inside&&value.hit&&value.visible;
   }catch(e){check(vp,label,false,String(e));return false;}
  };
  try{
   await p.goto(base.href,{waitUntil:'domcontentloaded'});
   await p.waitForFunction(()=>window.__world?.getMetrics().ready,null,{timeout:90000});await p.waitForTimeout(500);
   let g=await geometry();await p.screenshot({path:'output/welcome-'+vp+'.png'});
   check(vp,'welcome clears wrapped header',g.welcome.y>=g.header.bottom+7,g);
   check(vp,'welcome clears footer and fits viewport',g.welcome.bottom<=g.footer.y-7&&g.welcome.y>=0&&g.welcome.bottom<=size.height,g);
   check(vp,'no document horizontal overflow',g.bodyOverflow<=1,g.bodyOverflow);
   if(await reachable('#enter','welcome enter is reachable by scrolling')){
    await p.locator('#enter').click();await p.waitForSelector('#entry-panel:popover-open');
    check(vp,'welcome entry choice actually opens',await p.locator('#entry-panel').isVisible());
    await p.locator('#close-entry').click();
   }
   if(await reachable('#visit','welcome Find my Muse is reachable by scrolling')){
    await p.locator('#about').focus();await p.keyboard.press('Tab');check(vp,'keyboard reaches Find my Muse without footer interception',await p.locator('#visit').evaluate(el=>document.activeElement===el));await p.keyboard.press('Enter');await p.waitForFunction(()=>window.__world.map.getZoom()>20.5,null,{timeout:12000});
    await p.waitForSelector('#muse-card',{state:'visible'});check(vp,'Find my Muse actually reaches close-up',true);
   }else await p.evaluate(()=>window.__world.map.jumpTo({zoom:21.7}));
   await p.waitForTimeout(500);g=await geometry();
   check(vp,'selected card clears header/footer',g.card.y>=g.header.bottom+7&&g.card.bottom<=g.footer.y-7,g);
   await reachable('#follow','Follow Muse is unobscured');
   if(await reachable('#follow','Follow Muse can be clicked')){await p.locator('#follow').click();await p.waitForTimeout(100);check(vp,'Follow changes state',await p.locator('#follow').evaluate(el=>el.classList.contains('active')));}
   for(const [selector,label] of [['#pause','pause'],['#plus','zoom in'],['#minus','zoom out'],['#bay','Bay'],['#world-open','World panel'],['#mode-story','Story mode'],['#mode-world','World mode']])await reachable(selector,'essential '+label+' reachable');
   await p.locator('#world-open').click();await p.waitForSelector('#world-panel:popover-open');
   const panel=await p.locator('#world-panel').boundingBox();check(vp,'World panel fits viewport',panel.x>=0&&panel.y>=0&&panel.x+panel.width<=size.width+1&&panel.y+panel.height<=size.height+1,panel);
   await p.locator('#world-panel .close').click();
   await p.locator('#mode-story').click();await p.waitForTimeout(300);
   check(vp,'Story control really switches modes',await p.evaluate(()=>window.__world.mode==='story'));
   await p.locator('#mode-world').click();await p.waitForTimeout(300);
   check(vp,'World control really switches back',await p.evaluate(()=>window.__world.mode==='world'));
   await p.screenshot({path:'output/layout-'+vp+'.png'});
   const last=await geometry();check(vp,'mode transition keeps document overflow at zero',last.bodyOverflow<=1,last);
  }catch(e){check(vp,'layout flow completed',false,String(e));}
  finally{await context.close();}
 }
 check('all','no API writes attempted',writes.length===0,writes);check('all','no application exceptions',errors.length===0,errors);
 return {fixture:'local read-only layout; not device performance acceptance',cases,writes,errors};
}
