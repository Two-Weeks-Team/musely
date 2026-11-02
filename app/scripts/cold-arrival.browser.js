// D-04 cold arrival diagnostic: first render and actual readable commons are distinct navigation-relative times.
// Fresh local contexts only; no real-device/FPS/PSS acceptance. Keep failed gates in the result.
async(page)=>{
 const browser=page.context().browser(),target=new URL(page.url());target.search='?dpr=1.5';const cases=[];
 for(const [vp,viewport] of [['desktop',{width:1440,height:1000}],['mobile-emulation',{width:390,height:844}]]){
  const context=await browser.newContext({viewport,deviceScaleFactor:vp==='desktop'?2:3,isMobile:vp!=='desktop',hasTouch:vp!=='desktop'});
  const p=await context.newPage(),cdp=await context.newCDPSession(p),errors=[],writes=[];let bytes=0;
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/api/**',r=>{if(r.request().method()!=='GET'){writes.push(r.request().method()+' '+new URL(r.request().url()).pathname);return r.abort();}return r.continue();});
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Network.setBypassServiceWorker',{bypass:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:500000,uploadThroughput:500000});
  cdp.on('Network.loadingFinished',e=>bytes+=e.encodedDataLength);
  try{
   await p.goto(target.href,{waitUntil:'commit',timeout:90000});
   const timeline=await p.evaluate(async()=>{
    const seen={};const end=performance.now()+45000;
    while(performance.now()<end){
     const w=window.__world,m=w?.getMetrics?.();
     if(m){
      if(!seen.scene&&m.ready&&m.characterKit){seen.scene=m.startup.sceneReadyAtMs;seen.firstLods=m.characters?.map(x=>x.lod);}
      const readable=m.muses?.filter(v=>{const b=v.bounds,c=b.center;if(b.height<20||c.x<0||c.y<0||c.x>innerWidth||c.y>innerHeight)return false;const hit=document.elementFromPoint(c.x,c.y);return hit?.tagName==='CANVAS';})??[];
      if(m.ready&&m.characterKit&&m.characters?.length===8&&m.zoom>=20.35&&readable.length){seen.readable=performance.now();seen.elapsed=m.elapsed;seen.zoom=m.zoom;seen.readableCount=readable.length;seen.heights=readable.map(x=>x.bounds.height);seen.dpr=w.pixelRatio;seen.startup=m.startup;seen.story=m.tour;return seen;}
     }
     await new Promise(r=>setTimeout(r,50));
    }
    return seen;
   });
   await p.screenshot({path:'output/cold-arrival-'+vp+'.png'});
   await p.evaluate(()=>{document.getElementById('pause').click();window.__world.seek(3);});await p.waitForTimeout(100);const seekZoom=await p.evaluate(()=>window.__world.map.getZoom());
   await p.evaluate(()=>window.__world.startStory());await p.waitForTimeout(3200);const manual=await p.evaluate(()=>({elapsed:window.__world.getMetrics().elapsed,zoom:window.__world.map.getZoom()}));
   const manualPreserved=Math.abs(seekZoom-(vp==='desktop'?11.079629629629629:10.429629629629629))<.01&&manual.elapsed>=2.7&&manual.elapsed<4&&manual.zoom<15;
   cases.push({vp,pass:!!timeline.readable&&timeline.readable<=8000&&manualPreserved&&errors.length===0&&writes.length===0,network:{downloadBitsPerSecond:4000000,latencyMs:150,cacheDisabled:true,bypassServiceWorker:true},timeline,manual:{...manual,seekZoom,preserved:manualPreserved},transferredBytes:bytes,errors,writes,scope:'local cold diagnostic, not final release/device acceptance'});
  }catch(e){cases.push({vp,pass:false,error:String(e),errors,writes});}
  finally{await context.close();}
 }
 return {cases};
}
