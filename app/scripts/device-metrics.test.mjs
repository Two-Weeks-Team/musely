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
test('freeze gate rejects all measurement before a pinned release and refuses another mobile target',()=>{
 assert.ok(validateFreeze({}, {kind:'mobile-210',endpoint:'http://127.0.0.1:9222',targetId:'task-target'}).length);
 const pin={status:'frozen',referenceDevice:'SM-S918N',releaseSHA:'a'.repeat(40),workerVersion:'12345678-1234-1234-1234-123456789abc',configSHA256:'b'.repeat(64),htmlSHA256:'c'.repeat(64),origin:'https://musely.net',targetId:'task-target',dpr:1.5,durationMs:210000};
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
