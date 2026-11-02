// Playwright CLI run-code callback. Open the target preview URL first.
// This browser check is separate from the Node unit-test suite.
async (page)=>{
 const browser=page.context().browser(),target=new URL(page.url());target.search='';
 const cases=[];
 for(const mobile of [false,true]){
  const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await ctx.route('https://tiles.openfreemap.org/**',async r=>{await new Promise(done=>setTimeout(done,6000));await r.continue().catch(()=>{});});
  try{
   await p.goto(target.href,{waitUntil:'domcontentloaded'});
   await p.waitForFunction(()=>window.__world?.getMetrics().ready&&window.__world.map.queryRenderedFeatures().some(f=>f.source==='arrival-overview'),{},{timeout:4500}).catch(()=>{});
   const early=await p.evaluate(()=>{const m=window.__world?.getMetrics();return{ready:m?.ready,time:performance.now(),startup:m?.startup,features:window.__world?.map.queryRenderedFeatures().filter(f=>f.source==='arrival-overview').length};});
   if(!early.ready)throw Error('The local Muse world still waits for online map downloads.');
   if(!early.features)throw Error('No geographic overview is visible while online tiles are delayed.');
   const onStage=await p.locator('.world-caption').textContent();
   if(/no live agent call|scripted world story/i.test(onStage))throw Error('Technical disclosure is still repeated over the world.');
   await p.waitForFunction(()=>window.__world.getMetrics().elapsed>=8.5);
   const arrived=await p.evaluate(()=>{const m=window.__world.getMetrics();return{elapsed:m.elapsed,zoom:m.zoom,height:m.muses[0].bounds.height,sceneId:m.sceneId,museIds:m.museIds};});
   if(arrived.height<20)throw Error('Muses remain too small after the opening zoom.');
   await p.locator('#pause').click();
   for(const t of [20,55,100,150,185]){
    await p.evaluate(t=>window.__world.seek(t),t);await p.waitForTimeout(250);
    const m=await p.evaluate(()=>window.__world.getMetrics());
    if(!m.bubbles.speech)throw Error('Dialogue is missing at '+t+'s.');
    if(m.sceneId!==arrived.sceneId||m.museIds.some((id,i)=>id!==arrived.museIds[i]))throw Error('Opening changed the world or Muse identities.');
    if(/\d+\s*\/\s*34/.test(await p.locator('#story-speaker').textContent()))throw Error('Dialogue counter is exposed over the world.');
   }
   await p.waitForFunction(()=>window.__world.getMetrics().startup.onlineMapReadyAtMs>0,{},{timeout:30000});
   await ctx.unroute('https://tiles.openfreemap.org/**');
   await ctx.route('https://tiles.openfreemap.org/**',r=>r.abort());
   await p.locator('#bay').click();
   await p.waitForFunction(()=>window.__world.map.getZoom()<11&&!window.__world.map.isMoving(),{},{timeout:10000});
   await p.waitForFunction(()=>window.__world.map.queryRenderedFeatures().some(f=>f.source==='arrival-overview'),{},{timeout:2000});
   const returned=await p.evaluate(()=>({zoom:window.__world.map.getZoom(),features:window.__world.map.queryRenderedFeatures().filter(f=>f.source==='arrival-overview').length}));
   await p.locator('#about').click();
   if(!await p.locator('#about-dialog').isVisible()||!await p.locator('#about-dialog').textContent().then(t=>t.includes('not observed live conversations')))throw Error('Preview disclosure is not reachable in About.');
   await p.locator('#close-about').click();
   cases.push({viewport:mobile?'390x844 touch emulation':'1440x900',early,arrived,returned,errors});
   if(errors.length)throw Error('Application errors: '+errors.join('; '));
  }finally{await ctx.close();}
 }
 return {cases};
}
