// Isolated component with a synthetic owner/API; not whole-app, login or real-account acceptance.
export default async function socialStatusBrowser(page,language='ko'){
 const started=Date.now(),checks=[],actions=[];
 const check=(name,ok)=>checks.push({name,ok:!!ok});
 check('mount makes no request',await page.evaluate(()=>window.fixtureCalls.length===0));
 await page.locator('#fixture-open').click();actions.push('open');
 await page.locator('[data-action=mode]').waitFor({state:'visible'});
 check('one primary action',await page.locator('.social-status button.primary').count()===1);
 const firstStarted=Date.now();
 for(const mode of['do_not_disturb','busy','welcoming','auto']){
  await page.locator('[data-action=mode]').selectOption(mode);actions.push('select '+mode);
  await page.locator('[data-action=save]').click();actions.push('save');
  await page.waitForFunction(mode=>window.social.state().phase==='idle'&&window.social.state().data?.mode===mode,mode);
  check(mode+' current response displayed',await page.evaluate(mode=>window.social.state().data.mode===mode,mode));
 }
 const bounds=await page.locator('.social-status').evaluate(root=>({overflow:document.documentElement.scrollWidth>innerWidth,
  controls:[...root.querySelectorAll('button,select')].map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{height:r.height,inside:r.x>=0&&r.right<=innerWidth,hit:hit===e||e.contains(hit)};})}));
 check('no horizontal overflow',!bounds.overflow);check('controls reachable and at least 44px',bounds.controls.every(x=>x.inside&&x.hit&&x.height>=44));
 check('one GET, four explicit PATCHes',await page.evaluate(()=>window.fixtureCalls.map(x=>x.method).join(',')==='GET,PATCH,PATCH,PATCH,PATCH'));
 check('plain-language status text',await page.locator('.social-status').textContent().then(t=>!/(worldId|rootRef|revision|fixture|harness|scope)/.test(t)));
 check('language',await page.locator('.social-status').textContent().then(t=>t.includes(language==='ko'?'내 Muse 상태':'My Muse status')));
 return{classification:'fresh-profile isolated component; synthetic owner/API only',language,viewport:page.viewportSize(),actions:actions.length,firstChangeActions:3,elapsedMs:Date.now()-started,editingElapsedMs:Date.now()-firstStarted,checks,bounds,blockers:checks.filter(x=>!x.ok).map(x=>x.name),pass:checks.every(x=>x.ok)};
}

export async function wholeAppStatusBrowser(page,path){
 const personal=path.startsWith('personal'),started=Date.now(),actions=[],checks=[];const check=(name,ok)=>checks.push({name,ok:!!ok});
 await page.waitForFunction(()=>document.body.dataset.worldReady==='1');
 check('watching performs no personal or owner status request',await page.evaluate(()=>window.socialCalls.length===0));
 const details=personal?'#entry-social-status':'#owner-social-status';
 if(path==='owner'){await page.locator('#world-open').click();actions.push('world');await page.locator('[data-tab=identity]').click();actions.push('identity');}
 else{await page.locator('#entry-open').click();actions.push('door');}
 await page.locator(details).waitFor({state:'visible'});check('settings closed without a status read',await page.evaluate(()=>window.socialCalls.length===0));
 await page.locator(details+' summary').click();actions.push('status');
 const select=page.locator(details+' [data-action=mode]');await select.waitFor({state:'visible'});
 await select.selectOption('do_not_disturb');actions.push('select');await page.locator(details+' [data-action=save]').click();actions.push('save');
 await page.waitForFunction(()=>window.socialCalls.filter(x=>x.method==='PATCH').length===1);
 await page.waitForFunction(s=>document.querySelector(s+' [data-action=mode]')?.value==='do_not_disturb'&&!document.querySelector(s+' [data-action=refresh]')?.disabled,details);
 const calls=await page.evaluate(()=>window.socialCalls);check('own endpoint read then explicit write only',calls.length===2&&calls[0].method==='GET'&&calls[1].method==='PATCH'&&calls[0].path===(personal?'/api/personal/social-status':'/api/owner/social-status'));
 check('body contains preference and revision only',Object.keys(calls[1].body).sort().join(',')==='expectedRevision,mode'&&calls[1].body.mode==='do_not_disturb');
 check('one active primary while choosing status',await page.locator((personal?'#entry-panel':'#world-panel')+' button.primary:visible:not([disabled])').count()<=1);
 if(personal)check('no joining or key issuance triggered',await page.evaluate(()=>window.forbiddenStatusWrites===0&&document.querySelector('#entry-open').dataset.invitation==='complete'));
 const layout=await page.locator(details).evaluate(e=>{const r=e.getBoundingClientRect();return{inside:r.x>=0&&r.right<=innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};});check('no horizontal blocker',layout.inside&&!layout.overflow);
 await page.locator(details+' summary').click();actions.push('close status');
 return{classification:'whole local app, synthetic authenticated session/API; not actual account/provider',path,viewport:page.viewportSize(),actions:actions.length,changeActions:actions.length-1,elapsedMs:Date.now()-started,checks,blockers:checks.filter(x=>!x.ok).map(x=>x.name),pass:checks.every(x=>x.ok)};
}
