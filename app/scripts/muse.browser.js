// Playwright CLI run-code callback. Open any page on the local dist server first
// (python3 -m http.server --directory dist). Checks the ten-Muse viewer and the actual map world
// at desktop size and in 390x844 touch emulation (not a physical-device result).
async(page)=>{
 const origin=new URL('/',page.url()),results=[];
 const ids=['00-jolly','01-sunny','02-moss','03-ripple','04-ember','05-bloom','06-ink','07-tempo','08-orbit','09-copper'];
 const residents=['00-jolly','01-sunny','07-tempo','02-moss','06-ink','08-orbit','05-bloom','03-ripple'];
 for(const mobile of[false,true]){
  const ctx=await page.context().browser().newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  try{
   await p.goto(new URL('characters/',origin).href,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__jolly?.getMetrics().ready,null,{timeout:30000});
   const viewer=[];
   for(const id of ids){
    await p.locator(`.roster button[data-id="${id}"]`).click();await p.waitForFunction(id=>{const m=window.__jolly.getMetrics();return m.ready&&m.variant===id&&window.__jolly.root?.name==='Muse_'+id;},id,{timeout:20000});
    const m=await p.evaluate(()=>window.__jolly.getMetrics());const sig=m.clips.find(c=>!['idle_breathe','walk','look_around','think','listen','talk','wave','sit_down','sit_idle','stand_up','celebrate','offer_item'].includes(c));
    if(m.clips.length!==(id==='00-jolly'?12:13))throw Error(id+' action list '+m.clips.length);
    if(!m.materials.some(x=>x.name.startsWith('Fleece')&&x.normal&&x.colorMap))throw Error(id+' fleece maps missing');
    if(id!=='00-jolly'&&!m.materials.some(x=>x.name.startsWith('Acc ')&&x.normal&&x.colorMap))throw Error(id+' accessory PBR maps missing');
    if(m.height<.85||m.height>1.05)throw Error(id+' height '+m.height);
    if(sig){await p.locator('#action').selectOption(sig);await p.waitForTimeout(300);const pose=()=>p.evaluate(()=>{const q=[];window.__jolly.root.traverse(o=>{if(o.isBone)q.push(...o.quaternion.toArray());});return q;});const a=await pose();let moved=0;for(let sample=0;sample<10&&moved<.01;sample++){await p.waitForTimeout(250);const b=await pose();moved=a.reduce((s,v,i)=>s+Math.abs(v-b[i]),0);}if(moved<.01)throw Error(id+' signature '+sig+' does not animate: '+moved);}
    await p.locator('#whole').click();await p.waitForTimeout(300);
    const extent=await p.evaluate(()=>{const w=window.__jolly,e=[Infinity,Infinity,-Infinity,-Infinity];w.root.updateMatrixWorld(true);w.root.traverseVisible(o=>{if(!o.isMesh)return;const v=o.position.clone();for(let k=0;k<o.geometry.attributes.position.count;k+=4){o.getVertexPosition(k,v);v.applyMatrix4(o.matrixWorld).project(w.camera);e[0]=Math.min(e[0],v.x);e[1]=Math.min(e[1],v.y);e[2]=Math.max(e[2],v.x);e[3]=Math.max(e[3],v.y);}});return e;});
    if(extent.some(v=>Math.abs(v)>.98))throw Error(id+' whole character cropped: '+extent);
    if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Viewer overflows horizontally');
    const tri=[];for(const l of['0','1','2']){await p.locator('#lod').selectOption(l);tri.push(await p.evaluate(()=>window.__jolly.getMetrics().triangles));if(!(await p.locator('#status').innerText()).includes('LOD'+l))throw Error('Stale detail status '+l);}await p.locator('#lod').selectOption('0');
    if(!(tri[0]<=28000&&tri[1]<=8000&&tri[2]<=3000&&tri[0]>tri[1]&&tri[1]>tri[2]))throw Error(id+' LOD triangles '+tri);
    viewer.push({id,signature:sig??null,triangles:tri});
   }
   for(const name of['Neutral','Smile','Curious','Thinking','Focused','Listening','Concerned','Delight']){await p.locator('#expression').selectOption(name);await p.waitForTimeout(30);const ok=await p.evaluate(name=>{let ok=true;window.__jolly.root.traverseVisible(m=>{const d=m.morphTargetDictionary,w=m.morphTargetInfluences;if(!d||!w)return;for(const n of['Smile','Curious','Thinking','Focused','Listening','Concerned','Delight'])if(d[n]!==undefined&&w[d[n]]!==(n===name?1:0))ok=false;});return ok;},name);if(!ok)throw Error('Facial state leaks: '+name);}
   for(const name of['studio','daylight','night']){await p.locator('#lighting').selectOption(name);if(await p.evaluate(()=>window.__jolly.getMetrics().lighting)!==name)throw Error('Light preset failed');}
   await p.locator('#pause').click();const paused=await p.evaluate(()=>window.__jolly.getMetrics().time);await p.waitForTimeout(200);if(await p.evaluate(()=>window.__jolly.getMetrics().time)!==paused)throw Error('Paused viewer advances');
   await ctx.route('https://tiles.openfreemap.org/**',async r=>{await new Promise(done=>setTimeout(done,6000));await r.continue().catch(()=>{});});
   await p.goto(new URL('?autoplay=0',origin).href,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__world?.getMetrics().ready,null,{timeout:60000});
   // Debug surface used by actions.browser.js: must stay a function returning world actors (lost once in #19).
   const actorApi=await p.evaluate(()=>({type:typeof window.__world.actor,root:!!window.__world.actor?.(0)?.root}));if(actorApi.type!=='function'||!actorApi.root)throw Error('__world.actor accessor missing: '+JSON.stringify(actorApi));
   // Muse card wants: text only (no markup), from harness/live data, with the private-reasons note as its own element.
   const want=await p.evaluate(()=>({text:document.getElementById('muse-want-text')?.textContent,html:document.getElementById('muse-want-text')?.innerHTML,note:document.getElementById('muse-want-note')?.textContent}));if(!/^Wants: \S/.test(want.text||'')||want.html!==want.text||want.note!=='Its reasons stay private.')throw Error('Muse card wants: '+JSON.stringify(want));
   const first=await p.evaluate(()=>window.__world.getMetrics());
   if(!first.characterKit||first.characters.map(c=>c.variant).join()!==residents.join())throw Error('World residents are not the rigged kit');
   await p.locator('#pause').click();const scenes=[];
   for(const t of[10,16,30,55,100,150,185]){await p.evaluate(t=>window.__world.seek(t),t);await p.waitForTimeout(240);const m=await p.evaluate(()=>window.__world.getMetrics());
    if(m.sceneId!==first.sceneId||m.characters.some((c,i)=>c.rootId!==first.characters[i].rootId))throw Error('A resident actor or the world was replaced at '+t);
    if(t>=16&&!m.bubbles.speech)throw Error('Dialogue framing failed '+t);if(m.canvasCount!==1)throw Error('A second world canvas was substituted');
    if(m.characters.filter(c=>c.lod===0).length>2)throw Error('More than two LOD0 actors');
    scenes.push({time:t,actions:m.characters.map(c=>c.action),lods:m.characters.map(c=>c.lod),drawCalls:m.drawCalls});}
   await p.evaluate(()=>{const w=window.__world,m=w.getMetrics().muses[3];w.select(3);w.map.jumpTo({center:w.alignmentAt(m.position[0],m.position[2]).geo,zoom:23.6,pitch:54,bearing:12});});await p.waitForTimeout(1500);
   const close=await p.evaluate(()=>window.__world.getMetrics());if(close.characters[3].lod!==0)throw Error('Selected close Muse is not LOD0: '+close.characters[3].lod);
   results.push({viewport:mobile?'390x844 touch emulation':'1440x1000',viewer,scenes,closeLods:close.characters.map(c=>c.lod),fps:close.fps,errors:[...errors,...close.errors]});if(errors.length||close.errors.length)throw Error([...errors,...close.errors].join(';'));
  }finally{await ctx.close();}
 }
 await page.bringToFront();return results;
}
