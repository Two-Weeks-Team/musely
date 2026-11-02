// D03 local read-only rendering fixture. Run against frozen dist, never against the operating demo.
async page => {
  const target=new URL(page.url());
  if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname))throw Error('D03 tile injection is local only');
  target.search='?autoplay=0';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();
  const writes=[],errors=[],results=[];let tiles=0;
  const ids=['00-jolly','01-sunny','02-moss','03-ripple','04-ember','05-bloom','06-ink','07-tempo','08-orbit','09-copper'];
  let w={worldId:'d03-local-fixture',day:'2026-11-02',tick:1,version:1,lastTickAt:Date.now(),nextSpotlight:{muse:'00-jolly',freedom:'where'},muses:ids.map(id=>({id,place:'commons:cafe',travel:null,beat:null,inventory:['coffee'],reflection:'',wants:{goal:'Meet a neighbor',items:[],source:'harness'}}))};
  const events=()=>[{seq:w.tick,id:'d03-fallback-'+w.tick,tick:w.tick,at:w.lastTickAt,source:'scripted',kind:'spotlight_fallback',muse:'00-jolly',other:null,data:{reason:'upstream'},tags:[]}];
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',route=>{
    const r=route.request(),u=new URL(r.url());
    if(!['GET','HEAD'].includes(r.method())){writes.push(u.pathname);return route.abort();}
    if(u.hostname==='tiles.openfreemap.org'){tiles++;return route.abort('failed');}
    if(u.pathname.startsWith('/api/')){
      if(r.method()!=='GET'){writes.push(u.pathname);return route.abort();}
      if(u.pathname==='/api/world')return route.fulfill({json:w});
      if(u.pathname==='/api/world/events')return route.fulfill({json:events()});
      if(u.pathname==='/api/status')return route.fulfill({json:{model:{id:'muse-spark-1.3',connected:false,live:false},budget:{capUsd:12,spentUsd:12,reservedUsd:0,remainingUsd:0,liveCalls:0},session:null,turnstile:{configured:false},aiGateway:false}});
      return route.fulfill({status:503,json:{error:'d03_local_fixture'}});
    }
    return route.continue();
  });
  const check=(name,ok,detail)=>{results.push({name,pass:!!ok,detail});if(!ok)throw Error(name+': '+JSON.stringify(detail));};
  try{
    await p.goto(target.href,{waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>window.__world?.getMetrics().ready && window.__world.worldPanel.world?.worldId==='d03-local-fixture',null,{timeout:90000});
    await p.evaluate(()=>window.__world.setMode('world'));
    await p.waitForTimeout(5000);
    const before=await p.evaluate(()=>window.__world.getMetrics().frame);
    w={...w,tick:2,version:2,lastTickAt:Date.now()};await p.evaluate(()=>window.__world.worldPanel.refresh());await p.waitForTimeout(400);
    const state=await p.evaluate(()=>({frame:window.__world.getMetrics().frame,tick:window.__world.worldPanel.world.tick,note:document.getElementById('network-note').textContent,noteHidden:document.getElementById('network-note').hidden,source:document.getElementById('muse-source').textContent,events:window.__world.worldPanel.events}));
    check('tile requests actually failed',tiles>0,tiles);
    check('tile failure is visible and does not stop rendering or world observations',!state.noteHidden && state.frame>before && state.tick===2,state);
    check('fallback keeps its recorded non-live source',state.events.some(e=>e.kind==='spotlight_fallback'&&e.source==='scripted'&&e.data.reason==='upstream'),state.source);
    check('fixture performs no writes and has no application exception',!writes.length&&!errors.length,{writes,errors});
    await p.screenshot({path:'output/d03-tile-fallback.png'});
    return {environment:'local-read-only-fixture',productionFaultInjection:false,results,writes,errors};
  }finally{await context.close();}
}
