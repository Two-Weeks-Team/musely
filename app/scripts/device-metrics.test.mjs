import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeFrames,comparePss,validateFreeze,compareContext} from './device-metrics.mjs';

test('210-second FPS includes empty seconds rather than silently dropping a long stall',()=>{
 const frames=[];for(let second=0;second<80;second++)for(let f=1;f<=60;f++)frames.push({at:second*1000+f*1000/60-.01,dt:1000/60});frames.push({at:210001,dt:130001});
 const r=summarizeFrames(frames);assert.equal(r.fpsBuckets.length,210);assert.equal(r.medianFps,0);assert.equal(r.zeroFrameSeconds,130);assert.equal(r.complete,true);
});
test('an incomplete RAF run cannot pass just because its observed FPS is high',()=>{const r=summarizeFrames([{at:1000,dt:16.7}]);assert.equal(r.complete,false);assert.equal(r.durationMs,1000);});
test('PSS uses max(20 percent,64MiB) separately for peak and end, including exact boundaries',()=>{
 const b={peakKiB:100000,endKiB:90000};const pass=comparePss(b,{peakKiB:165536,endKiB:155536});assert.equal(pass.numericPass,true);assert.equal(pass.peak.allowedDeltaKiB,65536);assert.equal(comparePss(b,{peakKiB:165537,endKiB:155536}).numericPass,false);
 const large=comparePss({peakKiB:1514268,endKiB:1341987},{peakKiB:1817121,endKiB:1610384});assert.equal(large.numericPass,true);assert.equal(large.peak.allowedDeltaKiB,302853.60000000003);
});
test('missing or zero PSS is unknown, never a zero-memory success',()=>{assert.equal(comparePss({peakKiB:0,endKiB:1},{peakKiB:1,endKiB:1}).numericPass,null);assert.equal(comparePss({peakKiB:100,endKiB:100},{peakKiB:null,endKiB:10}).numericPass,null);});
test('DPR,viewport,device,OS,browser,route and cache provenance must match before memory comparison acceptance',()=>{
 const c={model:'SM-S918N',android:'16',chrome:'156',viewport:[411,742],dpr:1.5,route:'story-manual-210',cachePolicy:'unchanged-profile-cache'};
 assert.deepEqual(compareContext(c,{...c}),[]);for(const key of Object.keys(c)){const n={...c,[key]:key==='viewport'?[390,844]:'other'};assert.ok(compareContext(c,n).includes(key),key);}
 assert.ok(compareContext(c,{...c,cachePolicy:null}).includes('cachePolicy'));
});
test('freeze gate rejects all measurement before a pinned release and refuses another mobile target',async()=>{
 assert.ok(validateFreeze({}, {kind:'mobile-210',endpoint:'http://127.0.0.1:9222',targetId:'task-target'}).length);
 const pin={...await freezeFixture(),status:'frozen',referenceDevice:'SM-S918N',releaseSHA:'a'.repeat(40),workerVersion:'12345678-1234-1234-1234-123456789abc',configSHA256:'b'.repeat(64),htmlSHA256:'c'.repeat(64),origin:'https://musely.net',targetId:'task-target',dpr:1.5,durationMs:210000};
 assert.ok(validateFreeze({...pin,referenceDevice:null},{kind:'mobile-210',endpoint:'http://127.0.0.1:9222',targetId:'task-target'}).includes('approved_reference_required'));
 assert.deepEqual(validateFreeze(pin,{kind:'mobile-210',endpoint:'http://127.0.0.1:9222',targetId:'task-target'}),[]);
 assert.ok(validateFreeze(pin,{kind:'mobile-210',endpoint:'http://127.0.0.1:9222',targetId:'other'}).includes('wrong_target'));
 assert.ok(validateFreeze(pin,{kind:'first-load',endpoint:'http://remote.example:9222',targetId:'task-target'}).includes('nonlocal_cdp'));
 assert.ok(validateFreeze({...pin,workerVersion:'-'.repeat(36)},{kind:'mobile-210',endpoint:'http://127.0.0.1:9222',targetId:'task-target'}).includes('worker_version_required'));
 assert.ok(validateFreeze({...pin,dpr:2},{kind:'mobile-210',endpoint:'http://127.0.0.1:9222',targetId:'task-target'}).includes('dpr_not_1_5'));
});

test('collector refuses an unfrozen plan before any CDP request or output creation',async t=>{
 const {createServer}=await import('node:http');const {runMeasurement}=await import('./device-benchmark.mjs');let requests=0;
 const server=createServer((q,r)=>{requests++;r.end('[]');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 await assert.rejects(runMeasurement({kind:'mobile-210',targetId:'task-target',endpoint:'http://127.0.0.1:'+server.address().port,execute:true,out:'/not-created'},{}),/release_not_frozen/);assert.equal(requests,0);
});
test('target CDP replies/errors are correlated and disconnect clears every pending timer',async()=>{
 const {TargetCDP}=await import('./device-benchmark.mjs');class Socket extends EventTarget{send(text){this.last=JSON.parse(text);}close(){this.dispatchEvent(new Event('close'));}reply(body){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(body)}));}}
 const socket=new Socket(),cdp=new TargetCDP(socket);const ok=cdp.send('Page.test');socket.reply({id:socket.last.id,result:{done:true}});assert.deepEqual(await ok,{done:true});assert.equal(cdp.pending.size,0);
 const bad=cdp.send('Page.test');socket.reply({id:socket.last.id,error:{message:'refused'}});await assert.rejects(bad,/refused/);assert.equal(cdp.pending.size,0);
 const closed=cdp.send('Page.test');cdp.close();await assert.rejects(closed,/CDP disconnected/);assert.equal(cdp.pending.size,0);
});

test('eight-actor payload requires every shared kit file and does not apply its budget to ten-actor extras',async()=>{
 const {EIGHT_KIT_PATHS,eightPayload}=await import('./device-metrics.mjs');const files=EIGHT_KIT_PATHS.map(path=>({path,bytes:1024}));
 const before=eightPayload(files);assert.equal(before.pass,true);assert.equal(before.bytes,12*1024);assert.equal(eightPayload(files.slice(1)).pass,null);
 assert.equal(eightPayload([...files,{path:'character-kit/runtime/attachments/09-copper.glb',bytes:20*1024*1024}]).bytes,before.bytes);
 assert.equal(eightPayload(files.map(x=>({...x,bytes:2*1024*1024}))).pass,false);
});


test('every injected page expression parses without evaluating a browser or starting measurement',async()=>{
 const {Script}=await import('node:vm');const {PAGE_EXPRESSIONS}=await import('./device-benchmark.mjs');
 for(const[name,text]of Object.entries(PAGE_EXPRESSIONS))assert.doesNotThrow(()=>new Script(text),name);
});

const context={model:'SM-S918N',android:'16',chrome:'156',viewport:[411,742],dpr:1.5,route:'story-manual-210',cachePolicy:'unchanged-profile-cache'};
async function freezeFixture(){const {EIGHT_KIT_PATHS}=await import('./device-metrics.mjs');return {status:'frozen',referenceDevice:'SM-S918N',releaseSHA:'a'.repeat(40),workerVersion:'12345678-1234-1234-1234-123456789abc',configSHA256:'b'.repeat(64),htmlSHA256:'c'.repeat(64),origin:'https://musely.net',targetId:'target',dpr:1.5,durationMs:210000,files:[{path:'index.html',sha256:'c'.repeat(64),bytes:1},...EIGHT_KIT_PATHS.map(path=>({path,sha256:'d'.repeat(64),bytes:1}))]};}
const opts={kind:'mobile-210',endpoint:'http://127.0.0.1:9222',targetId:'target'};
test('required HTML and all twelve served GLBs must be unique and bound before measurement',async()=>{
 const p=await freezeFixture();assert.deepEqual(validateFreeze(p,opts),[]);
 for(const change of [p=>delete p.files,p=>p.files=[],p=>p.files.pop(),p=>p.files.push(p.files[0]),p=>p.files[0].sha256='0'.repeat(64),p=>p.files[1].sha256='invalid',p=>p.files[1].bytes=-1,p=>p.files[1].path='../private']){const bad=structuredClone(p);change(bad);assert.ok(validateFreeze(bad,opts).length);}
});
test('baseline artifact context rather than pin declarations governs provenance',async()=>{
 const {compareBaselineContext}=await import('./device-metrics.mjs');
 const full=compareBaselineContext({context},context);assert.deepEqual(full.mismatches,[]);assert.equal(full.complete,true);
 const forged=compareBaselineContext({context:{...context,model:'other',dpr:3}},context);assert.deepEqual(forged.mismatches.sort(),['dpr','model']);assert.equal(forged.complete,false);assert.ok(compareBaselineContext({context,device:{dpr:{applied:3}}},context).conflicts.includes('dpr'));
 const legacy=compareBaselineContext({device:{viewport:[411,742],dpr:{device:2.625,applied:1.5}},android:'16',chrome:'156'},context);
 assert.deepEqual(legacy.mismatches,[]);assert.equal(legacy.recorded.model,undefined);assert.deepEqual(legacy.missing.sort(),['cachePolicy','model','route']);assert.equal(legacy.complete,false);
});
test('baseline hash or recorded context mismatch is rejected before any CDP/source request',async t=>{
 const {runMeasurement}=await import('./device-benchmark.mjs'),{mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createHash}=await import('node:crypto');
 const dir=await mkdtemp(join(tmpdir(),'d04-baseline-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'baseline.json'),raw=JSON.stringify({context:{...context,dpr:3},memory:{peakKiB:1,endKiB:1}});await writeFile(path,raw);
 const pin={...await freezeFixture(),baselineContext:context,baselineSHA256:createHash('sha256').update(raw).digest('hex')},before=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('unexpected request');};
 try{await assert.rejects(()=>runMeasurement({...opts,execute:true,out:join(dir,'out'),baseline:path},pin),/baseline.*context/);await assert.rejects(()=>runMeasurement({...opts,execute:true,out:join(dir,'out2'),baseline:path},{...pin,baselineSHA256:'0'.repeat(64)}),/baseline.*hash/);assert.equal(requests,0);}finally{globalThis.fetch=before;}
});

test('static runtime JS/CSS references including module preloads require served source coverage',async()=>{
 const {externalCodePaths}=await import('./device-metrics.mjs');
 assert.deepEqual(externalCodePaths('<script src="/runtime.js"></script><link href="styles.css" rel="stylesheet"><link rel=modulepreload href="chunk.js">','https://musely.net'),['runtime.js','styles.css','chunk.js']);
 assert.deepEqual(externalCodePaths('<script>const example=\'<script src="/not-loaded.js">\';</script><!-- <script src="/comment.js"> -->','https://musely.net'),[]);
 assert.throws(()=>externalCodePaths('<script src="https://other.invalid/main.js"></script>','https://musely.net'),/not_pinned/);
});
test('visibility changes are retained while RAF is suspended and its independent listener is removed',async()=>{
 const {Script}=await import('node:vm'),{PAGE_EXPRESSIONS}=await import('./device-benchmark.mjs');let clock=0,queued=0;
 class Doc extends EventTarget{visibilityState='visible';handlers=new Set();addEventListener(n,fn,...rest){if(n==='visibilitychange')this.handlers.add(fn);super.addEventListener(n,fn,...rest);}removeEventListener(n,fn,...rest){this.handlers.delete(fn);super.removeEventListener(n,fn,...rest);}}
 const document=new Doc(),window={__world:{setMode(){},startStory(){}}},sandbox={document,window,performance:{now:()=>clock},requestAnimationFrame(){queued++;}};
 new Script(PAGE_EXPRESSIONS.performanceStartExpression).runInNewContext(sandbox);assert.equal(queued,1);clock=100;document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));clock=200;document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));
 assert.deepEqual(Array.from(window.__d04.visibility,e=>e.state),['hidden','visible']);assert.equal(document.handlers.size,1);
 new Script(PAGE_EXPRESSIONS.performanceCleanupExpression).runInNewContext(sandbox);assert.equal(document.handlers.size,0);assert.equal(window.__d04,undefined);assert.equal(window.__d04Visibility,undefined);
});
test('cold-arrival browser callback exposes identical pass and ok false for gate and catch failures',async()=>{
 const {readFile}=await import('node:fs/promises'),{Script}=await import('node:vm');const source=await readFile(new URL('./cold-arrival.browser.js',import.meta.url),'utf8'),callback=new Script('('+source+')').runInNewContext({URL});
 for(const throws of [false,true]){let i=0;const browser={newContext:async()=>{const index=i++,p={on(){},route:async()=>{},goto:async()=>{if(throws)throw Error('fixture navigation failed');},screenshot:async()=>{},waitForTimeout:async()=>{},evaluate:async fn=>{const s=fn.toString();if(s.includes('const seen'))return {readable:9001};if(s.includes('elapsed:'))return {elapsed:3,zoom:10};if(s.includes('map.getZoom'))return index===0?11.079629629629629:10.429629629629629;return undefined;}};return {newPage:async()=>p,newCDPSession:async()=>({send:async()=>{},on(){}}),close:async()=>{}};}};
 const result=await callback({url:()=> 'http://127.0.0.1:1',context:()=>({browser:()=>browser})});assert.equal(result.cases.length,2);assert.ok(result.cases.every(c=>c.pass===false&&c.ok===false));assert.equal(result.cases.some(c=>c.ok===false),true,'common runner must exit as failure');}
});

test('runtime script omitted from manifest fails source audit before CDP opens',async t=>{
 const {runMeasurement,TargetCDP}=await import('./device-benchmark.mjs'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createHash}=await import('node:crypto');
 const dir=await mkdtemp(join(tmpdir(),'d04-source-'));t.after(()=>rm(dir,{recursive:true,force:true}));const html='<script src="/runtime.js"></script>',pin=await freezeFixture();pin.htmlSHA256=createHash('sha256').update(html).digest('hex');pin.files[0]={path:'index.html',sha256:pin.htmlSHA256,bytes:Buffer.byteLength(html)};
 const prior=globalThis.fetch,connect=TargetCDP.connect;let opened=false;
 globalThis.fetch=async url=>new Response(new URL(url).pathname==='/json/list'?JSON.stringify([{id:'target',type:'page',url:pin.origin,webSocketDebuggerUrl:'ws://127.0.0.1:1/mock'}]):new URL(url).pathname==='/'?html:'{}');TargetCDP.connect=async()=>{opened=true;throw Error('must not connect');};
 try{const result=await runMeasurement({...opts,kind:'first-load',execute:true,out:join(dir,'out')},pin);assert.match(result.error,/runtime code missing from manifest/);assert.equal(result.measuredChecksPass,false);assert.equal(opened,false);}finally{globalThis.fetch=prior;TargetCDP.connect=connect;}
});

test('every recorded baseline alias participates in conflict detection without filling missing history',async()=>{
 const {compareBaselineContext}=await import('./device-metrics.mjs');
 for(const key of Object.keys(context))for(const location of ['context','top','device','conditions']){
  const bad=key==='viewport'?[390,844]:key==='dpr'?3:'different',b={context:{...context},[key]:context[key],device:{[key]:context[key]},conditions:{[key]:context[key]}};
  if(location==='top')b[key]=bad;else b[location][key]=bad;
  const r=compareBaselineContext(b,context);assert.ok(r.conflicts.includes(key),`${key}/${location}`);assert.equal(r.complete,false);
 }
 const good=compareBaselineContext({context,device:{dpr:{applied:1.5,device:2.625}},conditions:context},context);assert.equal(good.complete,true);
 const missing=compareBaselineContext({device:{dpr:{device:2.625}}},context);assert.ok(missing.missing.includes('dpr'));assert.equal(missing.complete,false);
});
test('runtime tag tokens retain quoted angles, skip raw text and honor only the first base href',async()=>{
 const {externalCodePaths}=await import('./device-metrics.mjs'),origin='https://musely.net';
 assert.deepEqual(externalCodePaths('<script data-label="a>b" src="/runtime.js"></script>',origin),['runtime.js']);
 assert.deepEqual(externalCodePaths('<base href="/code/"><base href="/ignored/"><script src="runtime.js"></script><link title=\'a>b\' rel="stylesheet" href="style.css">',origin),['code/runtime.js','code/style.css']);
 assert.deepEqual(externalCodePaths('<base href><base href="/ignored/"><script src="runtime.js"></script>',origin),['runtime.js']);
 assert.deepEqual(externalCodePaths('<script>const x=\'<base href="/fake/"><script src="fake.js">\';</script><!-- <base href="/comment/"> --><script src="runtime.js"></script>',origin),['runtime.js']);
 for(const html of ['<base href="https://foreign.invalid/"><script src="runtime.js"></script>','<base href="/code/"><script src="runtime.js?v=1"></script>'])assert.throws(()=>externalCodePaths(html,origin),/not_pinned/);
});

test('a serialized collector report can be reused as a consistent baseline without editing its evidence',async()=>{
 const {createMeasurementReport,measurementContext}=await import('./device-benchmark.mjs'),{compareBaselineContext}=await import('./device-metrics.mjs');
 const report=createMeasurementReport(opts,await freezeFixture());
 Object.assign(report,{model:'SM-S918N',android:'16',chrome:'156',device:{viewport:[411,742],dpr:{device:2.625,applied:1.5}}});
 report.context=measurementContext(report);
 const wire=JSON.stringify(report),baseline=JSON.parse(wire),result=compareBaselineContext(baseline,context);
 assert.deepEqual(result.conflicts,[],'fresh collector output must not conflict with its own cache policy');
 assert.equal(result.complete,true);assert.deepEqual(result.missing,[]);assert.deepEqual(result.mismatches,[]);
 assert.equal(baseline.conditions.cachePolicy,'unchanged-profile-cache');assert.equal(baseline.context.cachePolicy,'unchanged-profile-cache');
 assert.equal(baseline.conditions.documentPolicy,'frozen HTML interception');
 assert.equal(JSON.stringify(baseline),wire,'baseline validation must not rewrite historical evidence');
 const changed=JSON.parse(wire);changed.conditions.cachePolicy='cache-disabled';assert.ok(compareBaselineContext(changed,context).conflicts.includes('cachePolicy'),'a genuine conflicting policy must still be rejected');
});

test('handled application errors fail the actual acceptance gate for every measurement kind',async()=>{
 const {createMeasurementReport,measurementPassed}=await import('./device-benchmark.mjs');
 for(const kind of ['first-load','desktop-210','mobile-210','eight-budget','live-observation']){
  const report=createMeasurementReport({kind},{});Object.assign(report,{complete:true,gate:{measured:true},metrics:{errors:[]},memory:{complete:true,comparison:{numericPass:true}},baselineProvenance:{complete:true}});
  assert.equal(measurementPassed(report),true,kind+' error-free existing result');
  report.metrics.errors.push('MapLibre: failed map resource');assert.equal(measurementPassed(report),false,kind+' handled error');
 }
});
test('uncaught application errors still fail and absent metrics cannot be inferred error-free',async()=>{
 const {createMeasurementReport,measurementPassed}=await import('./device-benchmark.mjs');
 const report=createMeasurementReport({kind:'first-load'},{});Object.assign(report,{complete:true,gate:{measured:true},metrics:{errors:[]}});
 report.errors.push('Uncaught page exception');assert.equal(measurementPassed(report),false);report.errors=[];
 for(const metrics of [undefined,null,{}, {errors:null},{errors:'not an array'}]){report.metrics=metrics;assert.equal(measurementPassed(report),false,'missing or malformed application error observation');}
});

test('the common finalizer freshly collects application metrics for every kind and refuses missing observations',async()=>{
 const {createMeasurementReport,finalizeMeasurement}=await import('./device-benchmark.mjs'),{Script}=await import('node:vm');
 for(const kind of ['first-load','desktop-210','mobile-210','eight-budget','live-observation']){
  const report=createMeasurementReport({kind},{});Object.assign(report,{complete:true,gate:{measured:true},metrics:{errors:['stale sample']},memory:{complete:true,comparison:{numericPass:true}},baselineProvenance:{complete:true}});
  let reads=0,current={errors:[]};const c={evaluate:async expression=>new Script(expression).runInNewContext({window:{__world:{getMetrics(){reads++;return structuredClone(current);}}}})};
  await finalizeMeasurement(report,c);assert.equal(reads,1,kind+' final metrics were read');assert.equal(report.measuredChecksPass,true);assert.deepEqual(report.metrics,current);
  current.errors.push('handled map failure');await finalizeMeasurement(report,c);assert.equal(reads,2);assert.equal(report.measuredChecksPass,false);assert.deepEqual(report.metrics.errors,['handled map failure']);
  current={errors:[]};report.errors.push('uncaught exception');await finalizeMeasurement(report,c);assert.equal(report.measuredChecksPass,false);report.errors=[];
  await finalizeMeasurement(report,{evaluate:async()=>null});assert.equal(report.measuredChecksPass,false);assert.equal(report.metrics,null);
  report.metrics={errors:[]};await finalizeMeasurement(report,{evaluate:async()=>{throw Error('metrics read failed');}});assert.equal(report.measuredChecksPass,false);assert.equal(report.metrics,null);assert.match(report.metricsReadError,/metrics read failed/);
  report.metrics={errors:[]};await finalizeMeasurement(report,null);assert.equal(report.measuredChecksPass,false);assert.equal(report.metrics,null);
 }
});


test('managed edge code is accepted only with an explicit exact vendor pin',async()=>{
 const {externalCodePaths}=await import('./device-metrics.mjs');
 const url='https://static.cloudflareinsights.com/beacon.min.js/v123abc',file={url,sha256:'a'.repeat(64),bytes:100};
 const html='<script src="'+url+'"></script>';
 assert.throws(()=>externalCodePaths(html,'https://musely.net'),/not_pinned/);
 assert.deepEqual(externalCodePaths(html,'https://musely.net',[file]),[]);
 for(const bad of [{...file,sha256:'bad'},{...file,bytes:0},{...file,url:url+'?key=x'},{...file,url:'https://other.invalid/beacon.min.js/v123abc'}])assert.throws(()=>externalCodePaths(html,'https://musely.net',[bad]),/not_pinned/);
 assert.throws(()=>externalCodePaths(html.replace('v123abc','v456def'),'https://musely.net',[file]),/not_pinned/);
});

test('managed telemetry stays aborted and audited while every variant remains a fatal write',async()=>{
 const {createMeasurementReport,measurementPassed,finalizeMeasurement}=await import('./device-benchmark.mjs');
 const pin={origin:'https://musely.net'},report=createMeasurementReport({kind:'desktop-210'},pin);
 Object.assign(report,{complete:true,gate:{fps:true},metrics:{errors:[]}});
 const row={method:'POST',origin:pin.origin,path:'/cdn-cgi/rum',query:false,fragment:false,credentials:false,action:'aborted'};
 report.writes=[row];assert.equal(measurementPassed(report),true);
 for(const changed of [{method:'GET'},{origin:'https://foreign.invalid'},{path:'/api/muse'},{query:true},{fragment:true},{credentials:true},{action:'abort-pending'}, {query:undefined}]){report.writes=[{...row,...changed}];assert.equal(measurementPassed(report),false,JSON.stringify(changed));}
 report.writes=[row];await finalizeMeasurement(report,{evaluate:async()=>({errors:[]})});assert.equal(report.writes.length,1);assert.equal(report.networkAudit.deniedTelemetry.length,1);assert.equal(report.networkAudit.fatalWriteAttempts.length,0);assert.equal(report.networkAudit.continuedWriteRequests,0);assert.equal(report.measuredChecksPass,true);
});

test('source audit binds HTML content negotiation and the exact external script bytes',async()=>{
 const {auditSource}=await import('./device-benchmark.mjs'),{createHash}=await import('node:crypto');const hash=x=>createHash('sha256').update(x).digest('hex');
 const origin='https://musely.net',url='https://static.cloudflareinsights.com/beacon.min.js/v123abc',code='/* pinned managed edge code */',html='<script src="'+url+'"></script>';
 const pin={origin,htmlAccept:'text/html',htmlSHA256:hash(html),files:[{path:'index.html',sha256:hash(html),bytes:Buffer.byteLength(html)}],externalCodeFiles:[{url,sha256:hash(code),bytes:Buffer.byteLength(code)}]},before=globalThis.fetch;
 let content=code,accepts=[];globalThis.fetch=async(target,opts={})=>{if(target===url)return new Response(content);if(target===origin+'/api/status')return new Response('{}');accepts.push(opts.headers?.Accept);return new Response(html);};
 try{const result=await auditSource(pin);assert.deepEqual(accepts,['text/html','text/html']);assert.equal(result.externalCodeFiles.length,1);assert.equal(result.externalCodeFiles[0].sha256,hash(code));content=code+' changed';await assert.rejects(()=>auditSource(pin),/external code pin mismatch/);}finally{globalThis.fetch=before;}
});

test('first-load attests actual browser response bytes, status and final URL, not a parallel Node probe',async()=>{
 const {BrowserSourceAudit}=await import('./device-benchmark.mjs'),{createHash}=await import('node:crypto');const hash=x=>createHash('sha256').update(x).digest('hex');
 const origin='https://musely.net',url=origin+'/?dpr=1.5',vendor='https://static.cloudflareinsights.com/beacon.min.js/v123abc',html='<html>actual browser</html>',code='/* versioned script */',pin={htmlSHA256:hash(html),files:[{path:'index.html',bytes:Buffer.byteLength(html)}],externalCodeFiles:[{url:vendor,sha256:hash(code),bytes:Buffer.byteLength(code)}]};
 const build=async(change={})=>{const audit=new BrowserSourceAudit(pin,url);audit.response({requestId:'d',type:'Document',response:{url:change.url??url,status:change.status??200}});audit.response({requestId:'s',type:'Script',response:{url:vendor,status:200}});await audit.finished('d',async()=>({body:change.html??html,base64Encoded:false}));if(!change.missing)await audit.finished('s',async()=>({body:Buffer.from(change.code??code).toString('base64'),base64Encoded:true}));return audit;};
 const positive=await build();assert.equal((await positive.verify(0)).rows.length,2);
 for(const change of [{html:html+' changed'},{code:code+' changed'},{status:503},{url:origin+'/'},{missing:true}]){const audit=await build(change);await assert.rejects(()=>audit.verify(0),/actual browser/);}
 const error=await build({missing:true});await error.finished('s',async()=>{throw Error('unavailable');});await assert.rejects(()=>error.verify(0),/actual browser/);
});

test('a missing interception job for a public map GET is recorded without permitting writes or masking application errors',async()=>{
 const {stalePublicMapRead,createMeasurementReport,measurementPassed}=await import('./device-benchmark.mjs');const request={method:'GET',url:'https://tiles.openfreemap.org/planet/20261025_080012_pt/14/2633/6350.pbf'},error=Error('Invalid InterceptionId.');
 assert.equal(stalePublicMapRead(request,error),true);
 for(const changed of [{method:'POST'},{url:request.url+'?token=x'},{url:request.url+'#x'},{url:request.url.replace('tiles.openfreemap.org','foreign.invalid')},{url:'https://musely.net/api/muse'},{url:request.url.replace('https://','https://user:pass@')},{url:request.url.replace('.pbf','.js')}])assert.equal(stalePublicMapRead({...request,...changed},error),false);
 assert.equal(stalePublicMapRead(request,Error('Failed to continue request')),false);
 const report=createMeasurementReport({kind:'first-load'},{origin:'https://musely.net'});Object.assign(report,{complete:true,gate:{arrival:true},metrics:{errors:['actual MapLibre failure']},interceptionErrors:[{classification:'stale-public-map-read'}]});assert.equal(measurementPassed(report),false);
});

test('final verdict rejects fatal interception and sticky protocol errors even with otherwise passing metrics',async()=>{
 const {createMeasurementReport,measurementPassed}=await import('./device-benchmark.mjs');const passing=()=>Object.assign(createMeasurementReport({kind:'first-load'},{origin:'https://musely.net'}),{complete:true,gate:{arrival:true},metrics:{errors:[]}});
 assert.equal(measurementPassed(passing()),true);
 for(const detail of [{interceptionErrors:[{classification:'fatal'}]},{interceptionErrors:[{}]},{protocolError:'late handler failed'}])assert.equal(measurementPassed(Object.assign(passing(),detail)),false);
 assert.equal(measurementPassed(Object.assign(passing(),{interceptionErrors:[{classification:'stale-public-map-read'}]})),true);
});

test('stale tile exception excludes bare query and fragment separators and malformed URLs',async()=>{
 const {stalePublicMapRead}=await import('./device-benchmark.mjs');const url='https://tiles.openfreemap.org/planet/20261025_080012_pt/14/2633/6350.pbf';
 for(const value of [url+'?',url+'#',url+'?#','not a URL'])assert.equal(stalePublicMapRead({method:'GET',url:value},Error('Invalid InterceptionId.')),false);
});

test('TargetCDP drains asynchronous handlers through close and preserves the first failure',async()=>{
 const {TargetCDP}=await import('./device-benchmark.mjs');class Socket extends EventTarget{send(){}close(){this.dispatchEvent(new Event('close'));}emit(){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({method:'Late.event',params:{}})}));}}
 const socket=new Socket(),c=new TargetCDP(socket);let release;const gate=new Promise(resolve=>release=resolve);c.on('Late.event',async()=>{await gate;throw Error('after cleanup');});socket.emit();let closed=false;const close=c.close().then(()=>closed=true);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(closed,false);release();await close;assert.equal(c.eventError,'Error: after cleanup');assert.equal(c.eventTasks.size,0);
 c.on('Other.event',()=>{throw Error('second');});socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({method:'Other.event',params:{}})}));await c.settleEvents();assert.equal(c.eventError,'Error: after cleanup');
});

async function offlineFirstLoad(t,{stage='sourceAfter',url='https://foreign.invalid/private',method='GET',error='Failed to continue request',failSourceAfter=null}={}){
 const {TargetCDP,runMeasurement}=await import('./device-benchmark.mjs'),{EIGHT_KIT_PATHS}=await import('./device-metrics.mjs'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createHash}=await import('node:crypto'),{default:childProcess}=await import('node:child_process'),{syncBuiltinESMExports}=await import('node:module');
 const dir=await mkdtemp(join(tmpdir(),'d04-late-'));t.after(()=>rm(dir,{recursive:true,force:true}));const origin='https://musely.net',html='<html>offline fixture</html>',bytes=Buffer.byteLength(html),digest=createHash('sha256').update(html).digest('hex');
 const pin={...await freezeFixture(),referenceDevice:'MacBookPro18,2',htmlSHA256:digest,files:['index.html',...EIGHT_KIT_PATHS].map(path=>({path,sha256:digest,bytes}))};
 class Socket extends EventTarget{
  reply(id,result={},failure){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(failure?{id,error:{message:failure}}:{id,result})}));}
  event(name,params){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({method:name,params})}));}
  fault(){this.event('Fetch.requestPaused',{request:{method,url},requestId:'late-request'});}
  send(text){const {id,method:command,params}=JSON.parse(text);
   if(command==='Page.navigate'){this.event('Network.responseReceived',{requestId:'doc',type:'Document',response:{url:origin+'/?dpr=1.5',status:200}});this.event('Network.loadingFinished',{requestId:'doc',encodedDataLength:bytes});this.event('Page.lifecycleEvent',{loaderId:'nav',name:'DOMContentLoaded'});return this.reply(id,{loaderId:'nav'});}
   if(command==='Network.getResponseBody')return this.reply(id,{body:html,base64Encoded:false});
   if(command==='Page.captureScreenshot')return this.reply(id,{data:Buffer.from('offline placeholder').toString('base64')});
   if(command==='Runtime.evaluate'){let value={visibility:'visible',ua:'Chrome fixture',viewport:[1440,1000],dpr:{cap:1.5,applied:1.5}};if(params.expression.includes('const t={}'))value={scene:4000,readable:7000,actorCount:8,visibility:'visible',dpr:{cap:1.5,applied:1.5}};else if(params.expression.includes('getMetrics?.() ?? null'))value={errors:[]};return this.reply(id,{result:{value}});}
   if(command==='Fetch.continueRequest')return setTimeout(()=>this.reply(id,{},error),5);
   if(command==='Fetch.disable'&&stage==='cleanup')this.fault();
   this.reply(id,{});
  }
  close(){this.dispatchEvent(new Event('close'));}
 }
 const socket=new Socket(),c=new TargetCDP(socket),oldFetch=globalThis.fetch,oldConnect=TargetCDP.connect,oldExec=childProcess.execFileSync;let rootReads=0;const commands=[];const send=socket.send.bind(socket);socket.send=text=>{commands.push(JSON.parse(text));return send(text);};
 globalThis.fetch=async target=>{const u=new URL(target);if(u.pathname==='/json/list')return new Response(JSON.stringify([{id:'target',type:'page',url:origin+'/',webSocketDebuggerUrl:'ws://offline.invalid'}]));if(u.pathname==='/api/status')return new Response('{}');if(u.href===origin+'/'&&++rootReads===2){if(failSourceAfter)throw failSourceAfter;if(stage==='sourceAfter')socket.fault();}return new Response(html);};TargetCDP.connect=async()=>c;childProcess.execFileSync=()=> 'MacBookPro18,2';syncBuiltinESMExports();
 try{const report=await runMeasurement({kind:'first-load',endpoint:'http://127.0.0.1:1',targetId:'target',execute:true,out:dir},pin);return {report,commands,c};}finally{globalThis.fetch=oldFetch;TargetCDP.connect=oldConnect;childProcess.execFileSync=oldExec;syncBuiltinESMExports();}
}

test('fatal events during sourceAfter and asynchronous cleanup fail the serialized collector verdict',async t=>{
 for(const stage of ['sourceAfter','cleanup']){const {report,c}=await offlineFirstLoad(t,{stage});assert.equal(report.complete,true);assert.equal(report.interceptionErrors[0].classification,'fatal');assert.equal(report.measuredChecksPass,false);assert.match(report.protocolError,/Failed to continue request/);assert.equal(c.eventTasks.size,0);assert.equal(report.cleanup.ownCdpConnectionClosed,true);}
});

test('offline firstload keeps narrow stale tile reads nonfatal, strict RUM denials and inspector buffers',async t=>{
 const {report,commands}=await offlineFirstLoad(t,{url:'https://tiles.openfreemap.org/planet/20261025_080012_pt/14/2633/6350.pbf',error:'Invalid InterceptionId.'});assert.equal(report.measuredChecksPass,true);assert.equal(report.interceptionErrors[0].classification,'stale-public-map-read');assert.deepEqual(commands.find(x=>x.method==='Network.enable').params,{maxTotalBufferSize:64*1024*1024,maxResourceBufferSize:16*1024*1024});assert.equal(commands.filter(x=>x.method==='Fetch.continueRequest').length,1,'no retry');
 for(const separator of ['?','#']){const {report}=await offlineFirstLoad(t,{url:'https://musely.net/cdn-cgi/rum'+separator,method:'POST'});assert.equal(report.measuredChecksPass,separator==='?');assert.equal(report.writes[0][separator==='?'?'query':'fragment'],true);assert.equal(report.writes[0].action,'aborted');assert.equal(report.networkAudit.continuedWriteRequests,0);}
});

test('every public source probe closes its own connection with a finite deadline; HTTP errors and tampering still fail without retry',async()=>{
 const {auditSource}=await import('./device-benchmark.mjs'),{createHash}=await import('node:crypto');const hash=x=>createHash('sha256').update(x).digest('hex'),origin='https://musely.net',vendor='https://static.cloudflareinsights.com/beacon.min.js/v123abc',html='<script src="/runtime.js"></script><script src="'+vendor+'"></script>',js='/* fixture */',pin={origin,htmlAccept:'text/html',htmlSHA256:hash(html),files:[{path:'index.html',bytes:Buffer.byteLength(html),sha256:hash(html)},{path:'runtime.js',bytes:Buffer.byteLength(js),sha256:hash(js)}],externalCodeFiles:[{url:vendor,bytes:Buffer.byteLength(js),sha256:hash(js)}]};
 const before=globalThis.fetch;let calls=[],badURL=null,tamper=false;globalThis.fetch=async(url,opts={})=>{calls.push({url,opts});return new Response(url===badURL?(tamper?'changed':'failure'):url===origin+'/api/status'?'{}':url===origin+'/'||url===origin+'/index.html'?html:js,{status:url===badURL&&!tamper?503:200});};
 try{await auditSource(pin);assert.equal(calls.length,5);for(const {opts} of calls){assert.equal(opts.headers.Connection,'close');assert.ok(opts.signal instanceof AbortSignal);assert.equal(opts.signal.aborted,false);}assert.deepEqual(calls.filter(x=>[origin+'/',origin+'/index.html'].includes(x.url)).map(x=>x.opts.headers.Accept),['text/html','text/html']);assert.equal(calls.at(-1).opts.redirect,'error');assert.equal(calls.at(-1).opts.credentials,'omit');
  for(const url of [origin+'/',origin+'/api/status',origin+'/runtime.js',vendor]){badURL=url;calls=[];await assert.rejects(()=>auditSource(pin));assert.equal(calls.filter(x=>x.url===url).length,1,'no retry on HTTP failure');}
  tamper=true;for(const url of [origin+'/',origin+'/runtime.js',vendor]){badURL=url;calls=[];await assert.rejects(()=>auditSource(pin));assert.equal(calls.filter(x=>x.url===url).length,1,'no retry on altered bytes');}
 }finally{globalThis.fetch=before;}
});

test('public-probe timeout propagates once and cause diagnostics retain only bounded code/name',async()=>{
 const {auditSource,errorCauseMetadata}=await import('./device-benchmark.mjs');const beforeFetch=globalThis.fetch,beforeTimeout=AbortSignal.timeout;let calls=0,deadline;
 AbortSignal.timeout=ms=>{deadline=ms;const c=new AbortController();queueMicrotask(()=>c.abort(new DOMException('fixture timeout','TimeoutError')));return c.signal;};globalThis.fetch=async(url,opts)=>{calls++;return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(opts.signal.reason),{once:true}));};
 try{await assert.rejects(()=>auditSource({origin:'https://musely.net'}),error=>error.name==='TimeoutError');assert.equal(calls,1);assert.equal(deadline,10000);}finally{globalThis.fetch=beforeFetch;AbortSignal.timeout=beforeTimeout;}
 const failure=Error('fetch failed',{cause:Object.assign(Error('sensitive cause message'),{code:'UND_ERR_SOCKET',stack:'sensitive stack',headers:{authorization:'sensitive key'},socket:{remoteAddress:'sensitive address'}})});
 assert.deepEqual(errorCauseMetadata(failure),{code:'UND_ERR_SOCKET',name:'Error'});assert.equal(JSON.stringify(errorCauseMetadata(failure)).includes('sensitive'),false);assert.deepEqual(errorCauseMetadata({cause:{code:'https://private.invalid/?key=secret',name:'invalid/name'}}),{code:null,name:null});assert.equal(errorCauseMetadata(Error('no cause')),null);
});

test('query-state metadata distinguishes none, empty and nonempty without changing telemetry permission',async t=>{
 const {urlQueryState}=await import('./device-benchmark.mjs');for(const [url,state] of [['https://example.invalid/path','none'],['https://example.invalid/path?','empty'],['https://example.invalid/path?#x','empty'],['https://example.invalid/path?private=value','nonempty'],['https://example.invalid/path#?private=value','none']])assert.equal(urlQueryState(url),state);
 for(const [suffix,state] of [['','none'],['?','empty'],['?private=value','nonempty']]){const {report}=await offlineFirstLoad(t,{method:'POST',url:'https://musely.net/cdn-cgi/rum'+suffix});assert.equal(report.writes[0].queryState,state);assert.equal(report.writes[0].query,suffix.includes('?'));assert.equal(report.writes[0].action,'aborted');assert.equal(report.measuredChecksPass,suffix===''||suffix==='?');assert.equal(JSON.stringify(report).includes('private=value'),false);}
});


test('sourceAfter transport failure keeps the collector failed and stores only cause code/name',async t=>{
 const failure=TypeError('fetch failed',{cause:Object.assign(Error('private diagnostic message'),{code:'UND_ERR_SOCKET',headers:{authorization:'secret'},socket:{remoteAddress:'private'},stack:'private stack'})});
 const {report}=await offlineFirstLoad(t,{failSourceAfter:failure});assert.equal(report.complete,false);assert.equal(report.measuredChecksPass,false);assert.equal(report.error,'TypeError: fetch failed');assert.deepEqual(report.errorCause,{code:'UND_ERR_SOCKET',name:'Error'});assert.equal(JSON.stringify(report).includes('private diagnostic message'),false);assert.equal(JSON.stringify(report).includes('authorization'),false);
});

test('only explicit empty-query RUM denials join legacy no-query records; unknown or contradictory rows stay fatal',async()=>{
 const {deniedTelemetry,createMeasurementReport,measurementPassed}=await import('./device-benchmark.mjs'),origin='https://musely.net',legacy={method:'POST',origin,path:'/cdn-cgi/rum',query:false,fragment:false,credentials:false,action:'aborted'};
 for(const row of [legacy,{...legacy,queryState:'none'},{...legacy,query:true,queryState:'empty'}])assert.equal(deniedTelemetry(row,origin),true);
 for(const changed of [{query:false,queryState:'empty'},{query:false,queryState:'nonempty'},{query:false,queryState:'unknown'},{query:false,queryState:null},{query:true},{query:true,queryState:'none'},{query:true,queryState:'nonempty'},{query:true,queryState:'unknown'},{query:undefined,queryState:'empty'},{query:'true',queryState:'empty'},{query:true,queryState:'empty',fragment:true},{query:true,queryState:'empty',credentials:true},{query:true,queryState:'empty',origin:'https://foreign.invalid'},{query:true,queryState:'empty',path:'/api/muse'},{query:true,queryState:'empty',action:'abort-pending'},{query:true,queryState:'empty',method:'GET'}]){
  const row={...legacy,...changed};assert.equal(deniedTelemetry(row,origin),false,JSON.stringify(changed));const report=Object.assign(createMeasurementReport({kind:'first-load'},{origin}),{complete:true,gate:{arrival:true},metrics:{errors:[]},writes:[row]});assert.equal(measurementPassed(report),false);
 }
});
