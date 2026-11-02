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
