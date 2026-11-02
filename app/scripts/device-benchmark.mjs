#!/usr/bin/env node
// D-04: dependency-free, exact-target CDP collector. Default is preparation only. Never closes a browser/tab,
// creates/removes an ADB forward, clears global caches, or changes another target. Node24 + adb (mobile only).
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {summarizeFrames,comparePss,compareContext,validateFreeze,DURATION_MS,eightPayload,compareBaselineContext,externalCodePaths} from './device-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export class TargetCDP {
 constructor(socket){this.socket=socket;this.next=0;this.pending=new Map();this.listeners=new Map();socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else for(const fn of this.listeners.get(m.method)??[])Promise.resolve(fn(m.params)).catch(error=>{this.eventError=String(error);});});socket.addEventListener('close',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('CDP disconnected'));}this.pending.clear();});}
 static async connect(url){const socket=new WebSocket(url);await new Promise((yes,no)=>{socket.addEventListener('open',yes,{once:true});socket.addEventListener('error',no,{once:true});});return new TargetCDP(socket);}
 on(method,fn){const a=this.listeners.get(method)??[];a.push(fn);this.listeners.set(method,a);}
 send(method,params={}){const id=++this.next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(method+' timed out'));},30000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});}
 async evaluate(expression){const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+(r.exceptionDetails.exception?.description??''));return r.result.value;}
 close(){this.socket.close();}
}
const adb=(serial,...args)=>execFileSync('adb',['-s',serial,...args],{encoding:'utf8',timeout:15000});
export function samplePss(serial){
 const list=adb(serial,'shell','ps','-A','-o','PID,NAME').split('\n').flatMap(line=>{const m=/^\s*(\d+)\s+(\S+)/.exec(line);return m&&(m[2]==='com.android.chrome'||m[2]==='com.android.chrome_zygote'||m[2].startsWith('com.android.chrome:'))?[{pid:m[1],name:m[2]}]:[];});
 const errors=[],processes=list.map(p=>{try{const text=adb(serial,'shell','dumpsys','meminfo',p.pid),m=/TOTAL PSS:\s*(\d+)/.exec(text);if(!m)throw Error('TOTAL PSS missing');return {...p,pssKiB:Number(m[1])};}catch(e){errors.push({pid:p.pid,error:String(e)});return {...p,pssKiB:null};}});
 return {at:new Date().toISOString(),complete:processes.length>0&&!errors.length,pssKiB:processes.length&&!errors.length?processes.reduce((s,p)=>s+p.pssKiB,0):null,processes,errors};
}
const metadataExpression=`(()=>({ua:navigator.userAgent,viewport:[innerWidth,innerHeight],dpr:window.__world?.pixelRatio??null,visibility:document.visibilityState,url:location.href}))()`;
const layoutExpression=`(()=>{const controls=['pause','plus','minus','bay','world-open','mode-story','mode-world','follow'].map(id=>{const e=document.getElementById(id);if(!e)return {id,offered:false};const r=e.getBoundingClientRect(),shown=r.width>0&&r.height>0;const hit=shown?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;return {id,offered:shown,inside:shown&&r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,hit:!!hit&&(hit===e||e.contains(hit))};});return {overflowPx:document.documentElement.scrollWidth-innerWidth,controls};})()`;
const characterBudgetExpression=`(()=>{const w=window.__world,textureIds=new Set(),unknown=[];let bytes=0;const rows=[];for(let i=0;i<8;i++){const a=w.actor(i);let draws=0;a.root.traverseVisible(o=>{if(o.isMesh)draws+=o.geometry.groups.length||1;});a.root.traverse(o=>{if(!o.isMesh)return;for(const m of(Array.isArray(o.material)?o.material:[o.material]))for(const t of Object.values(m)){if(!t?.isTexture||textureIds.has(t.uuid))continue;textureIds.add(t.uuid);const image=t.image;if(!image?.width||!image?.height){unknown.push(t.uuid);continue;}bytes+=image.width*image.height*4*(t.generateMipmaps?4/3:1);}});rows.push({id:a.variant,lod:a.lod,draws,triangles:a.visibleTriangles()});}return {characters:rows,textureEstimateBytes:bytes,textureCount:textureIds.size,unknownTextures:unknown,textureEstimation:'RGBA8 width*height*4;4/3 when mipmapped; unique GPU Texture UUIDs across loaded actor meshes'};})()`;
const renderExpression=`(()=>{const w=window.__world,m=w.getMetrics(),live=!!m.live?.active;return {mode:w.mode,live,actorCount:live?m.live.muses.length:m.characters?.length,lod0Count:live?m.live.muses.filter(x=>x.lod===0&&x.rendered).length:m.characters?.filter(x=>x.lod===0).length,drawCalls:m.drawCalls,triangles:m.triangles,characters:live?m.live.muses.map(x=>({id:x.id,lod:x.lod,rendered:x.rendered})):m.characters,layout:(${layoutExpression})};})()`;
const performanceStartExpression=`(()=>{window.__world.setMode('story');window.__world.startStory();const start=performance.now();window.__d04={start,frames:[],visibility:[],done:false};if(window.__d04Visibility)document.removeEventListener('visibilitychange',window.__d04Visibility);window.__d04Visibility=()=>window.__d04?.visibility.push({at:performance.now()-start,state:document.visibilityState});document.addEventListener('visibilitychange',window.__d04Visibility);if(document.visibilityState!=='visible')window.__d04Visibility();let last=start;const step=now=>{const s=window.__d04;if(!s)return;s.frames.push({at:now-start,dt:now-last});last=now;if(document.visibilityState!=='visible')s.visibility.push({at:now-start,state:document.visibilityState});if(now-start<210000)requestAnimationFrame(step);else s.done=true;};requestAnimationFrame(step);})()`;
const performanceCleanupExpression=`(()=>{if(window.__d04Visibility)document.removeEventListener('visibilitychange',window.__d04Visibility);delete window.__d04Visibility;delete window.__d04;})()`;
export const PAGE_EXPRESSIONS={metadataExpression,layoutExpression,characterBudgetExpression,renderExpression,performanceStartExpression,performanceCleanupExpression};
async function until(c,expression,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){const value=await c.evaluate(expression);if(value)return value;await delay(100);}throw Error('Page condition timeout');}
async function auditSource(pin){
 const url=pin.origin+'/',response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('HTML GET '+response.status);const body=Buffer.from(await response.arrayBuffer());if(sha(body)!==pin.htmlSHA256)throw Error('served HTML does not match frozen release');
 const status=await fetch(pin.origin+'/api/status',{cache:'no-store'});const rawStatus=await status.text();
 for(const path of externalCodePaths(body.toString('utf8'),pin.origin))if(!pin.files.some(f=>f.path===path))throw Error('runtime code missing from manifest '+path);
 const files=[];for(const file of pin.files??[]){if(!/^[A-Za-z0-9_./-]+$/.test(file.path)||file.path.includes('..'))throw Error('invalid manifest path');const r=await fetch(pin.origin+'/'+file.path,{cache:'no-store'});const bytes=Buffer.from(await r.arrayBuffer());const digest=sha(bytes);if(!r.ok||digest!==file.sha256||bytes.length!==file.bytes)throw Error('asset pin mismatch '+file.path);files.push({path:file.path,sha256:digest,bytes:bytes.length});}
 return {at:new Date().toISOString(),url,htmlSHA256:sha(body),htmlBytes:body.length,statusCode:status.status,statusSHA256:sha(rawStatus),publicStatus:JSON.parse(rawStatus),deploymentIdentity:'release/config/worker identity is root-attested in the freeze pin; public status has no release identity endpoint',files};
}
// Pure report producers share the same serialized-output seam as the collector.
const PROFILE_CACHE_POLICY='unchanged-profile-cache';
export const createMeasurementReport=(opts,pin)=> ({kind:opts.kind,pin,conditions:{durationMs:DURATION_MS,dprCap:1.5,route:'story-manual-210',cachePolicy:opts.kind==='first-load'?'target cache disabled; service worker bypass;4Mbps/150ms':PROFILE_CACHE_POLICY,documentPolicy:opts.kind==='first-load'?'network document':'frozen HTML interception',globalCacheCleared:false},startedAt:new Date().toISOString(),complete:false,writes:[],errors:[],memory:{samples:[]},cleanup:{targetClosed:false,browserClosed:false,forwardChanged:false}});
export const measurementContext=report=> ({model:report.model,android:report.android,chrome:report.chrome,viewport:report.device.viewport,dpr:report.device.dpr.applied,route:'story-manual-210',cachePolicy:PROFILE_CACHE_POLICY});
export async function runMeasurement(opts,pin){
 const refusals=validateFreeze(pin,opts);if(refusals.length)throw Error('Measurement refused before CDP: '+refusals.join(', '));
 if(!opts.execute)throw Error('Measurement requires explicit --execute after root release freeze');
 if(opts.kind==='mobile-210'&&(!opts.baseline||!pin.baselineContext))throw Error('mobile comparison requires --baseline and explicit baselineContext provenance before CDP');
 let baseline,baselineProvenance,baselineSHA256;
 if(opts.kind==='mobile-210'){
  const bytes=readFileSync(opts.baseline);baselineSHA256=sha(bytes);if(!/^[a-f0-9]{64}$/.test(pin.baselineSHA256??'')||baselineSHA256!==pin.baselineSHA256)throw Error('baseline hash does not match freeze declaration');
  baseline=JSON.parse(bytes);baselineProvenance=compareBaselineContext(baseline,pin.baselineContext);if(baselineProvenance.mismatches.length)throw Error('baseline context mismatch: '+baselineProvenance.mismatches.join(','));
 }
 if(!opts.out)throw Error('a new --out directory is required');if(existsSync(join(opts.out,'results.json')))throw Error('immutable result already exists');
 const targets=await(await fetch(opts.endpoint+'/json/list')).json();const target=targets.find(t=>t.id===opts.targetId&&t.type==='page');if(!target||new URL(target.url).origin!==pin.origin)throw Error('exact task target missing or wrong origin');
 mkdirSync(opts.out,{recursive:true});const report=createMeasurementReport(opts,pin);
 if(baseline){report.baselineSHA256=baselineSHA256;report.baselineArtifact=opts.baseline;report.baselineProvenance=baselineProvenance;}
 let c,networkChanged=false,intercepted=false,lifecycle=false;
 try{
  report.sourceBefore=await auditSource(pin);if(!pin.htmlFile&&opts.kind!=='first-load')throw Error('frozen htmlFile required for baseline-equivalent 210s route');
  const frozen=pin.htmlFile?readFileSync(pin.htmlFile):null;if(frozen&&sha(frozen)!==pin.htmlSHA256)throw Error('local frozen HTML pin mismatch');
  c=await TargetCDP.connect(target.webSocketDebuggerUrl);await c.send('Runtime.enable');await c.send('Page.enable');await c.send('Network.enable');
  report.preNavigationDevice=await c.evaluate(metadataExpression);if(report.preNavigationDevice.visibility!=='visible')throw Error('exact task tab must already be visible');
  if(pin.referenceDevice==='MacBookPro18,2'){report.model=execFileSync('sysctl',['-n','hw.model'],{encoding:'utf8'}).trim();if(report.model!==pin.referenceDevice||/HeadlessChrome/.test(report.preNavigationDevice.ua))throw Error('approved visible desktop reference required');}
  else{if(!opts.serial)throw Error('approved mobile reference requires --serial');report.model=adb(opts.serial,'shell','getprop','ro.product.model').trim();report.android=adb(opts.serial,'shell','getprop','ro.build.version.release').trim();report.chrome=adb(opts.serial,'shell','dumpsys','package','com.android.chrome').match(/versionName=(.*)/)?.[1]?.trim();if(report.model!==pin.referenceDevice||report.android!=='16'||!/Android/.test(report.preNavigationDevice.ua))throw Error('approved Android16 reference required');}
  if(opts.kind==='desktop-210'&&pin.referenceDevice!=='MacBookPro18,2'||opts.kind==='mobile-210'&&pin.referenceDevice!=='SM-S918N')throw Error('measurement kind/reference mismatch');
  const loads=new Set();c.on('Page.lifecycleEvent',e=>loads.add(e.loaderId+':'+e.name));await c.send('Page.setLifecycleEventsEnabled',{enabled:true});lifecycle=true;
  c.on('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails?.text??'page exception'));
  c.on('Network.loadingFinished',e=>{report.transferredBytes=(report.transferredBytes??0)+e.encodedDataLength;});
  c.on('Fetch.requestPaused',async e=>{
   if(!['GET','HEAD'].includes(e.request.method)){report.writes.push({method:e.request.method,path:new URL(e.request.url).pathname});await c.send('Fetch.failRequest',{requestId:e.requestId,errorReason:'BlockedByClient'});}
   else if(opts.kind!=='first-load'&&e.resourceType==='Document'&&e.request.url===pin.origin+'/?autoplay=0&perf=1&dpr=1.5')await c.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],body:frozen.toString('base64')});
   else await c.send('Fetch.continueRequest',{requestId:e.requestId});
  });await c.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});intercepted=true;
  if(opts.kind==='first-load'){
   networkChanged=true;await c.send('Network.setCacheDisabled',{cacheDisabled:true});await c.send('Network.setBypassServiceWorker',{bypass:true});await c.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:500000,uploadThroughput:500000});networkChanged=true;
  }
  const query=opts.kind==='first-load'?'?dpr=1.5':'?autoplay=0&perf=1&dpr=1.5';const nav=await c.send('Page.navigate',{url:pin.origin+'/'+query});if(nav.errorText)throw Error(nav.errorText);const navStart=Date.now();while(!loads.has(nav.loaderId+':DOMContentLoaded')){if(Date.now()-navStart>90000)throw Error('new navigation DOMContentLoaded timeout');await delay(50);}
  if(opts.kind==='first-load'){
   report.arrival=await c.evaluate(`(async()=>{const t={};while(performance.now()<60000){const w=window.__world,m=w?.getMetrics?.();if(m){if(!t.scene&&m.ready&&m.characterKit)t.scene=m.startup.sceneReadyAtMs;const readable=m.muses?.filter(x=>{const b=x.bounds,p=b.center;return b.height>=20&&p.x>=0&&p.y>=0&&p.x<=innerWidth&&p.y<=innerHeight&&document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS';})??[];if(m.ready&&m.characterKit&&m.characters?.length===8&&m.zoom>=20.35&&readable.length){return {...t,readable:performance.now(),readableCount:readable.length,actorCount:m.characters.length,zoom:m.zoom,dpr:w.pixelRatio,visibility:document.visibilityState};}}await new Promise(r=>setTimeout(r,50));}return t;})()`);
   report.gate={visible:report.arrival.visibility==='visible',eightActors:report.arrival.actorCount===8,dprPass:report.arrival.dpr?.cap===1.5&&report.arrival.dpr?.applied===1.5,sceneReadyPass:!!report.arrival.scene&&report.arrival.scene<=8000,actualReadableArrivalPass:!!report.arrival.readable&&report.arrival.readable<=8000};
  }else{
   await until(c,'window.__world?.getMetrics().ready&&window.__world.getMetrics().characterKit&&window.__world.getMetrics().characters?.length===8');report.device=await c.evaluate(metadataExpression);
   if(report.device.visibility!=='visible')throw Error('task tab is not visible; no other tab is activated');
   if(report.device.dpr?.cap!==1.5||report.device.dpr?.applied!==1.5)throw Error('actual DPR does not match1.5');
   if(['mobile-210','desktop-210'].includes(opts.kind)){
    await c.evaluate(performanceStartExpression);
    const began=Date.now();let nextPss=0,nextNote=0;
    while(!(await c.evaluate('window.__d04.done'))){const elapsed=Date.now()-began;if(elapsed>240000)throw Error('210s collector did not finish');if(opts.kind==='mobile-210'&&elapsed>=nextPss){report.memory.samples.push({elapsed:elapsed/1000,...samplePss(opts.serial)});writeFileSync(join(opts.out,'memory-progress.json'),JSON.stringify(report.memory.samples));nextPss+=10000;}if(elapsed>=nextNote){console.log('D04 '+opts.kind+' '+Math.round(elapsed/1000)+'s');nextNote+=30000;}await delay(500);}
    const raw=await c.evaluate('window.__d04');report.frames=raw.frames;report.visibilityChanges=raw.visibility;report.performance=summarizeFrames(raw.frames);report.metrics=await c.evaluate('window.__world.getMetrics()');
    report.gate={fps:report.performance.complete&&report.performance.medianFps>=(opts.kind==='desktop-210'?55:30),p95:report.performance.p95FrameMs<=(opts.kind==='desktop-210'?33:50),visible:raw.visibility.length===0};
    if(opts.kind==='mobile-210'){
     report.memory.samples.push({elapsed:(Date.now()-began)/1000,...samplePss(opts.serial)});const all=report.memory.samples.every(x=>x.complete);report.memory.complete=all;report.memory.peakKiB=all?Math.max(...report.memory.samples.map(x=>x.pssKiB)):null;report.memory.endKiB=all?report.memory.samples.at(-1).pssKiB:null;
     if(opts.baseline){report.memory.comparison=comparePss(baseline.memory,report.memory);report.context=measurementContext(report);report.contextMismatches=compareContext(pin.baselineContext,report.context);}
    }
   }else if(opts.kind==='eight-budget'){
    await until(c,'window.__world.getMetrics().characters?.every(x=>x.loadedLods.length===3)&&window.__world.getMetrics().characterUpgrade?.props');await c.evaluate("window.__world.startStory();document.getElementById('pause').click()");report.renderSamples=[];
    for(let t=0;t<=210;t++){await c.evaluate('window.__world.seek('+t+')');await delay(40);report.renderSamples.push({storyAt:t,...await c.evaluate(renderExpression),characterBudget:await c.evaluate(characterBudgetExpression)});}
    const s=report.renderSamples;report.gate={eightActorIdentity:s.every(x=>!x.live&&x.actorCount===8),lod0Cap:s.every(x=>x.lod0Count<=2),eightActorThreeDraw:s.every(x=>x.drawCalls<=90),characterDraw:s.every(x=>x.characterBudget.characters.every(c=>c.draws<=10)),lodTriangles:s.every(x=>x.characterBudget.characters.every(c=>c.triangles<=[28000,8000,3000][c.lod])),characterTexture:s.every(x=>!x.characterBudget.unknownTextures.length&&x.characterBudget.textureEstimateBytes<=96*1024*1024),sharedEightPayload:eightPayload(report.sourceBefore.files).pass};report.sampledMaxDraw=Math.max(...s.map(x=>x.drawCalls));report.sharedEightPayload=eightPayload(report.sourceBefore.files);
   }else{
    await c.evaluate("window.__world.setMode('world')");await until(c,'window.__world.getMetrics().live?.muses.length===10');report.renderSamples=[];
    for(let i=0;i<20;i++){report.renderSamples.push(await c.evaluate(renderExpression));await delay(500);}report.gate={tenActors:report.renderSamples.every(x=>x.live&&x.actorCount===10)};report.tenActorObservation={samples:20,seconds:10,maxDrawCalls:Math.max(...report.renderSamples.map(x=>x.drawCalls)),allTenSceneActors:report.renderSamples.every(x=>x.live&&x.actorCount===10),c11EightActorGate:null,note:'Ten world actors do not imply all ten are on screen; inspect camera/pose evidence. The eight-actor90-draw gate is not applied.'};
   }
   report.layout=await c.evaluate(layoutExpression);
  }
  report.device??=await c.evaluate(metadataExpression);const image=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(opts.out,'end.png'),Buffer.from(image.data,'base64'));if(c.eventError)throw Error(c.eventError);
  report.sourceAfter=await auditSource(pin);report.complete=true;
 }catch(error){report.error=String(error);}
 finally{
  if(c){const restore=async(method,params)=>{try{await c.send(method,params);}catch(error){(report.cleanup.restorationErrors??=[]).push({method,error:String(error)});}};if(networkChanged){await restore('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await restore('Network.setCacheDisabled',{cacheDisabled:false});await restore('Network.setBypassServiceWorker',{bypass:false});}if(intercepted)await restore('Fetch.disable');if(lifecycle)await restore('Page.setLifecycleEventsEnabled',{enabled:false});try{await c.evaluate(performanceCleanupExpression);}catch(error){(report.cleanup.restorationErrors??=[]).push({method:'visibility listener cleanup',error:String(error)});}c.close();report.cleanup.ownCdpConnectionClosed=true;}
  report.measuredChecksPass=report.complete&&!report.errors.length&&!report.writes.length&&!report.cleanup.restorationErrors?.length&&Object.values(report.gate??{}).every(x=>x===true)&&(opts.kind!=='mobile-210'||report.memory.complete===true&&report.memory.comparison?.numericPass===true&&report.baselineProvenance?.complete===true)&&!(report.contextMismatches?.length);report.acceptance='Separate device acceptance review required; collector completion is not overall C11 PASS';report.finishedAt=new Date().toISOString();writeFileSync(join(opts.out,'results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 }
 return report;
}
function options(argv){const out={};for(let i=0;i<argv.length;i++){const key=argv[i];if(!key.startsWith('--'))throw Error('unexpected argument');if(['--execute','--prepare','--metadata','--help'].includes(key))out[key.slice(2)]=true;else out[key.slice(2)]=argv[++i];}return { ...out,endpoint:out.cdp,targetId:out.target,kind:out.kind};}
export async function main(argv=process.argv.slice(2)){
 const opts=options(argv);
 if(opts.help||(!opts.execute&&!opts.metadata)){console.log('PREPARATION ONLY. Measurement requires --execute --pin frozen.json --cdp http://127.0.0.1:PORT --target EXACT_ID --kind mobile-210|desktop-210|first-load|eight-budget|live-observation --out NEW_DIR [--serial DEVICE --baseline baseline.json]. No browser/device connection was made.');return 0;}
 if(opts.metadata){if(!opts.endpoint||!opts.targetId)throw Error('metadata requires exact --cdp and --target');if(!['127.0.0.1','localhost','[::1]'].includes(new URL(opts.endpoint).hostname))throw Error('metadata endpoint must be local');const list=await(await fetch(opts.endpoint+'/json/list')).json();const target=list.find(x=>x.id===opts.targetId&&x.type==='page');console.log(JSON.stringify(target?{id:target.id,type:target.type,title:target.title,url:target.url}:null));return 0;}
 if(!opts.pin)throw Error('frozen --pin is required before CDP');const pin=JSON.parse(readFileSync(opts.pin));const report=await runMeasurement(opts,pin);console.log(JSON.stringify({complete:report.complete,error:report.error??null,gate:report.gate??null}));return report.measuredChecksPass?0:1;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(String(error));process.exitCode=2;});
