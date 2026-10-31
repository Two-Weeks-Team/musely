// Playwright CLI run-code callback. Open the local character proof URL first.
async(page)=>{
 const origin=new URL('/',page.url()),results=[];
 for(const mobile of[false,true]){
  const ctx=await page.context().browser().newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile}),p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  try{
   await p.goto(origin.href,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__jolly?.getMetrics().ready);
   const start=await p.evaluate(()=>window.__jolly.getMetrics());if(start.clips.length!==12||start.skins!==4)throw Error('Missing imported rig/actions');
   if(!start.materials.some(m=>m.name==='Fleece'&&m.normal&&m.colorMap&&m.roughnessMap))throw Error('Portable fleece maps missing');
   if(start.materials.some(m=>m.emission?.some(v=>v!==0)))throw Error('Body or face is emissive');
   await p.locator('#action').selectOption('wave');await p.waitForTimeout(350);
   const first=await p.evaluate(()=>window.__jolly.root.getObjectByName('UpperArm_R').quaternion.toArray());await p.waitForTimeout(450);
   const second=await p.evaluate(()=>window.__jolly.root.getObjectByName('UpperArm_R').quaternion.toArray());if(first.every((v,i)=>Math.abs(v-second[i])<.01))throw Error('Exported wave does not animate');
   for(const name of['Neutral','Smile','Curious','Thinking','Focused','Listening','Concerned','Delight']){await p.locator('#expression').selectOption(name);const check=await p.evaluate(name=>{let ok=true;window.__jolly.root.traverse(m=>{const d=m.morphTargetDictionary,w=m.morphTargetInfluences;if(!d||!w)return;for(const n of['Smile','Curious','Thinking','Focused','Listening','Concerned','Delight'])if(w[d[n]]!==(n===name?1:0))ok=false;});return ok;},name);if(!check)throw Error('Facial state leaks across presets: '+name);}
   for(const name of['studio','daylight','night']){await p.locator('#lighting').selectOption(name);if(await p.evaluate(()=>window.__jolly.getMetrics().lighting)!==name)throw Error('Light preset failed');}
   await p.locator('#pause').click();const paused=await p.evaluate(()=>window.__jolly.getMetrics().time);await p.waitForTimeout(200);if(await p.evaluate(()=>window.__jolly.getMetrics().time)!==paused)throw Error('Paused character advances');
   await ctx.route('https://tiles.openfreemap.org/**',async r=>{await new Promise(done=>setTimeout(done,6000));await r.continue().catch(()=>{});});
   await p.goto(new URL('world/?character=jolly',origin).href,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__world?.getMetrics().ready,{},{timeout:15000});
   const firstWorld=await p.evaluate(()=>window.__world.getMetrics());if(!firstWorld.characterCandidate||firstWorld.muses.length!==8)throw Error('Base absent from actual map world');
   await p.locator('#pause').click();const scenes=[];
   for(const t of[10,16,20,55,100,150,185]){await p.evaluate(t=>window.__world.seek(t),t);await p.waitForTimeout(240);const m=await p.evaluate(()=>window.__world.getMetrics());if(m.sceneId!==firstWorld.sceneId||m.characterCandidate.rootId!==firstWorld.characterCandidate.rootId)throw Error('Map zoom replaced the actor or world');if(t>=16&&!m.bubbles.speech)throw Error('Dialogue framing failed '+t);if(m.canvasCount!==1)throw Error('A second world canvas was substituted');scenes.push({time:t,action:m.characterCandidate.action,expression:m.characterCandidate.expression,drawCalls:m.drawCalls});}
   await p.locator('.portrait').nth(0).click();await p.locator('#follow').click();await p.waitForTimeout(2500);const followed=await p.evaluate(()=>window.__world.getMetrics());if(!followed.follow||followed.selected!==0)throw Error('Following the new base failed');
   results.push({viewport:mobile?'390x844 touch emulation':'1440x1000',imported:start,scenes,follow:true,errors});if(errors.length)throw Error(errors.join(';'));
  }finally{await ctx.close();}
 }
 await page.bringToFront();return results;
}
