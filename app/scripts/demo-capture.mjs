// Operator imports this into an existing local Playwright host AFTER explicit Chrome slot transfer.
// No Chromium executable or account is discovered/launched here. A fresh context has no cookies or grants.
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {performance} from 'node:perf_hooks';
import {publicReadAllowed,verifyBundle,checkHtml,sha,writeNew} from './lib/demo-video.mjs';
export async function captureDemoCut(browser,plan,cutId,dir,{prepare,play=true,runId:chosenRunId,seconds}={}){
 const errors=await verifyBundle(plan,dir);if(errors.length)throw Error(errors.join('\n'));
 const cut=plan.cuts.find(c=>c.id===cutId);if(!cut)throw Error('unknown_cut');
 const runId=chosenRunId??cut.refs[0].runId,refs=cut.refs.filter(r=>r.runId===runId);if(!refs.length)throw Error('unknown_take_run');
 const view=cut.views?.find(v=>v.runId===runId)??cut;
 const takeSeconds=seconds??cut.duration;if(!Number.isFinite(takeSeconds)||takeSeconds<=0||takeSeconds>cut.duration)throw Error('bad_take_duration');
 await checkHtml(plan);const mediaDir=resolve(dir,'capture',cut.id,runId);await mkdir(mediaDir,{recursive:true});
 const context=await browser.newContext({viewport:{width:1920,height:960},recordVideo:{dir:mediaDir,size:{width:1920,height:960}},serviceWorkers:'block',permissions:[],acceptDownloads:false});
 let blocked=0,video,page,started,clip,videoEpoch;const requests=[];
 try{
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),same=u.origin===new URL(plan.origin).origin;
   const api=u.pathname.startsWith('/api/')||u.pathname==='/mcp';
   // External tile/font/static GETs are permitted; every data/API request is same-origin and allowlisted.
   const ok=req.method()==='GET'&&(!api||same&&publicReadAllowed(req.url(),plan.origin));
   if(!ok){blocked++;return route.abort('blockedbyclient');}
   if(same&&api)requests.push({method:'GET',path:u.pathname,at:new Date().toISOString()});return route.continue();
  });
  videoEpoch=performance.now();page=await context.newPage();video=page.video();await page.goto(new URL('/?autoplay=0',plan.origin).href,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__world?.getMetrics().ready,{timeout:90_000});
  await page.evaluate(()=>window.__world.worldPanel.openTab('replay'));
  const root=page.locator('.recorded-replay');await root.getByRole('button',{name:'Find recorded runs',exact:true}).click();
  await root.locator('select[aria-label="Recorded run"]').selectOption(runId);
  await root.getByRole('button',{name:'Load recorded run',exact:true}).click();
  await page.waitForFunction(id=>{const r=document.querySelector('.recorded-replay');return r?.dataset.status==='ready'&&r.dataset.runId===id;},runId);
  const position=root.locator('[aria-label="Recorded replay position"]');await position.fill(String(view.seekSec));await position.dispatchEvent('input');
  // On-screen evidence stage: recorded source label, controls, table and scene all come from the product UI.
  const observed=await root.evaluate(e=>({runId:e.dataset.runId,hash:e.dataset.snapshotHash,label:e.textContent.includes('REPLAY · RECORDED WORLD')}));
  if(!observed.label||observed.runId!==runId||observed.hash!==view.snapshotHash)throw Error('recorded_ui_mismatch');
  const frames=await page.evaluate(()=>window.__world.liveScene.projection.events.map(e=>e.id));
  if(refs.some(r=>!frames.includes(r.eventId)))throw Error('selected_event_not_yet_visible_at_seek');
  if(prepare)await prepare(page,root,cut);
  started=performance.now();if(play)await root.getByRole('button',{name:'Play recorded run',exact:true}).click();
  // The operator can refine camera/cut framing in a subsequent take; this read-only take has no hidden actions.
  await new Promise(r=>setTimeout(r,(takeSeconds+1)*1000));await context.close();clip=await video.path();
  await checkHtml(plan);if(blocked)throw Error('capture_blocked_requests:'+blocked);
  const receipt={kind:'recorded_public_capture',cutId,sourceSha:plan.release.sourceSha,deployId:plan.release.deployId,configVersion:plan.release.configVersion,htmlSha256:plan.release.htmlSha256,runId,seekSec:view.seekSec,startOffsetSec:(started-videoEpoch)/1000,offsetBasis:'monotonic page creation; inspect first frame during human review',refs,observed,blockedRequests:blocked,requests,at:new Date().toISOString(),wallSeconds:(performance.now()-started)/1000,finalAcceptance:'not_measured'};
  const receiptFile=resolve(mediaDir,'receipt.json');await writeNew(receiptFile,JSON.stringify(receipt,null,2)+'\n');
  return {file:relative(resolve(dir),clip),sha256:sha(await readFile(clip)),receipt:relative(resolve(dir),receiptFile),duration:takeSeconds};
 }finally{await context.close();}
}
