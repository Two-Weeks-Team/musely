// Operator imports this into an existing local Playwright host AFTER explicit Chrome slot transfer.
// No Chromium executable or account is discovered/launched here. A fresh context has no cookies or grants.
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import {controlledBinding,DEMO_TOOL_VERSION} from './lib/controlled-p1.mjs';
import {storedMcpBinding,storedMcpLabelFor} from './lib/stored-mcp.mjs';
import {storedGiftBinding,storedGiftLabelFor} from './lib/stored-gift.mjs';
import {controlledLabelFor,installControlledLabel,readControlledLabel} from './lib/controlled-label.mjs';
import {captureRequestPolicy,verifyBundle,checkHtml,sha,writeNew,cutViews,annotationFor} from './lib/demo-video.mjs';
export async function captureDemoCut(browser,plan,cutId,dir,{prepare,play=true,viewId,runId:chosenRunId,seconds}={}){
 const errors=await verifyBundle(plan,dir);if(errors.length)throw Error(errors.join('\n'));
 const cut=plan.cuts.find(c=>c.id===cutId);if(!cut)throw Error('unknown_cut');
 const views=cutViews(cut),view=viewId?views.find(v=>v.id===viewId):chosenRunId?views.filter(v=>v.runId===chosenRunId).length===1?views.find(v=>v.runId===chosenRunId):null:views.length===1?views[0]:null;
 if(!view||chosenRunId&&chosenRunId!==view.runId)throw Error('explicit_view_required_or_mismatch');
 const runId=view.runId,refs=cut.refs.filter(r=>r.runId===runId),takeId=randomUUID();
 const takeSeconds=seconds??view.duration;if(takeSeconds!==view.duration)throw Error('take_duration_must_match_view');
 await checkHtml(plan);const mediaDir=resolve(dir,'capture',cut.id,view.id,takeId);await mkdir(mediaDir,{recursive:true});
 const context=await browser.newContext({viewport:{width:1920,height:960},recordVideo:{dir:mediaDir,size:{width:1920,height:960}},serviceWorkers:'block',permissions:[],acceptDownloads:false});
 let blocked=0,video,page,started,clip,videoEpoch,phase='bootstrap',continuedWriteRequests=0;const requests=[],bootstrapDeniedReads=[],deniedTelemetry=[],fatalDeniedRequests=[];
 const audit=()=>({denialsAreAccessReceipts:false,meaning:'Entries record denied attempts and their abort outcomes, never successful-access receipts. Zero continued writes is not zero network attempts.',bootstrapDeniedReads,deniedTelemetry,fatalDeniedRequests,blockedRequests:blocked,continuedWriteRequests});
 try{
  await context.route('**/*',async route=>{
   const req=route.request(),method=req.method(),url=req.url(),u=new URL(url),same=u.origin===new URL(plan.origin).origin;
   const kind=captureRequestPolicy(url,method,plan.origin,phase);
   if(kind!=='public-read'){
    const row={method,path:u.pathname,phase,sameOrigin:same,action:'aborted',at:new Date().toISOString()};
    try{await route.abort('blockedbyclient');(kind==='bootstrap-denied-read'?bootstrapDeniedReads:kind==='denied-telemetry'?deniedTelemetry:fatalDeniedRequests).push(row);}
    catch{fatalDeniedRequests.push({...row,action:'abort-failed'});}
    blocked=fatalDeniedRequests.length;return;
   }
   if(method!=='GET')continuedWriteRequests++;
   if(same&&(u.pathname.startsWith('/api/')||u.pathname==='/mcp'))requests.push({method,path:u.pathname,at:new Date().toISOString()});return route.continue();
  });
  videoEpoch=performance.now();page=await context.newPage();video=page.video();await page.goto(new URL('/?autoplay=0',plan.origin).href,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__world?.getMetrics().ready,null,{timeout:90_000});
  await page.evaluate(()=>window.__world.worldPanel.openTab('replay'));
  const root=page.locator('.recorded-replay');await root.getByRole('button',{name:'Find recorded runs',exact:true}).click();
  await root.locator('select[aria-label="Recorded run"]').selectOption(runId);
  await root.getByRole('button',{name:'Load recorded run',exact:true}).click();
  await page.waitForFunction(id=>{const r=document.querySelector('.recorded-replay');return r?.dataset.status==='ready'&&r.dataset.runId===id;},runId);
  const position=root.locator('[aria-label="Recorded replay position"]');await position.fill(String(view.seekSec));await position.dispatchEvent('input');
  // On-screen evidence stage: recorded source label, controls, table and scene all come from the product UI.
  const checkpoint=async()=>{
   const observed=await root.evaluate(e=>({runId:e.dataset.runId,hash:e.dataset.snapshotHash,label:e.textContent.includes('REPLAY · RECORDED WORLD')}));
   if(!observed.label||observed.runId!==runId||observed.hash!==view.snapshotHash)throw Error('recorded_ui_mismatch');
   const frames=await page.evaluate(()=>window.__world.liveScene.projection.events.map(e=>e.id));
   if(refs.some(r=>!frames.includes(r.eventId)))throw Error('selected_event_not_yet_visible_at_seek');return observed;
  };
  await checkpoint();if(prepare)await prepare(page,root,cut);
  // Framing/evidence actions may not silently change the checkpoint the receipt claims.
  const annotation=annotationFor(plan,cut,view);
  if(annotation){await page.evaluate(installControlledLabel,annotation);if((await page.evaluate(readControlledLabel))?.valid!==true)throw Error('provenance_label_missing');}
  const observed=await checkpoint();
  if(blocked)throw Error('capture_blocked_requests:'+blocked);
  phase='recording';started=performance.now();if(play)await root.getByRole('button',{name:'Play recorded run',exact:true}).click();
  // The operator can refine camera/cut framing in a subsequent take; this read-only take has no hidden actions.
  await new Promise(r=>setTimeout(r,(takeSeconds+1)*1000));const label=annotation?await page.evaluate(readControlledLabel):null,controlledLabel=cut.controlledPair?label:null,storedMcpLabel=cut.storedMcpVerifier?label:null,storedGiftLabel=cut.storedGiftVerifier?label:null;if(annotation&&label?.valid!==true)throw Error('provenance_label_lost');await context.close();clip=await video.path();
  await checkHtml(plan);if(blocked)throw Error('capture_blocked_requests:'+blocked);
  const file=relative(resolve(dir),clip),bytes=await readFile(clip),media={file,sha256:sha(bytes),bytes:bytes.length};
  const receipt={schema:'musely-demo-capture-2',kind:'recorded_public_capture',cutId,viewId:view.id,takeId,release:structuredClone(plan.release),tooling:structuredClone(plan.tooling??{version:DEMO_TOOL_VERSION}),...(cut.controlledPair?{controlledPair:controlledBinding(cut),controlledLabel}:{}),...(cut.storedMcpVerifier?{storedMcpVerifier:storedMcpBinding(cut),storedMcpLabel}:{}),...(cut.storedGiftVerifier?{storedGiftVerifier:storedGiftBinding(cut),storedGiftLabel}:{}),runId,seekSec:view.seekSec,durationSeconds:takeSeconds,label:'REPLAY',virtual:true,originalSources:[...new Set(refs.map(r=>r.originalSource))].sort(),media,startOffsetSec:(started-videoEpoch)/1000,offsetBasis:'monotonic page creation; inspect first frame during human review',refs,observed,provenanceLabel:label,...audit(),requests,at:new Date().toISOString(),wallSeconds:(performance.now()-started)/1000,finalAcceptance:'not_measured'};
  const receiptFile=resolve(mediaDir,'receipt.json');await writeNew(receiptFile,JSON.stringify(receipt,null,2)+'\n');
  return {file,sha256:media.sha256,receipt:relative(resolve(dir),receiptFile),duration:takeSeconds,viewId:view.id,takeId,runId,refs};
 }finally{try{await context.close();}finally{await writeNew(resolve(mediaDir,'network-audit.json'),JSON.stringify(audit(),null,2)+'\n');}}
}
