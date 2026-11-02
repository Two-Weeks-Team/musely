// Offline integration: actual Worker cache/router, DO page bounds and loader/player; no remote fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {setImmediate as turn} from 'node:timers/promises';
import {loadRecordedRun} from '../src/replay/loader.ts';
import {loadRun,recordedStateHash} from '../src/replay/player.ts';
import {currentVersions} from '../src/replay/versions.ts';
import {publicState} from '../worker/core/run-log.ts';
import {createWorld} from '../src/engine/world.ts';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='cloudflare:workers')return{url:'data:text/javascript,export class DurableObject {}',shortCircuit:true};return n(s,c);}`));
const {default:worker,WorldDO}=await import('../worker/index.ts');
const T=Date.parse('2026-11-03T00:00:00Z');
function record(n,padding=0){
 const world=publicState(createWorld('offline-loader',T)),runId='offline-run';
 const snap=i=>{const body=JSON.stringify({...world,version:i,tick:i,lastTickAt:T+i*60000,...(padding?{syntheticPadding:'x'.repeat(padding)}:{})});return{body,hash:recordedStateHash(body)};};
 const initialSnapshot=snap(0),inputs=[];let before=initialSnapshot;
 for(let i=1;i<=n;i++){const after=snap(i);inputs.push({seq:i,runId,at:T+i*60000,kind:'external',label:'offline',day:world.day,tick:i,versionBefore:i-1,versionAfter:i,beforeHash:before.hash,afterHash:after.hash,itemsHead:null,itemsSeq:null,events:0,input:null,afterSnapshot:after,afterSnapshotError:null});before=after;}
 return{...currentVersions(),worldId:world.worldId,seed:world.seed,runId,startedAt:T,origin:'fresh',prevRunId:null,legacy:null,initialSnapshot,inputs,events:[],readThrough:{inputSeq:n,eventSeq:0,inputs:n,events:0}};
}
function transport(t,r){
 const old=globalThis.caches,cache=new Map(),calls=[],denied=[],buckets=new Map();globalThis.caches={default:{match:async q=>cache.get(q.url)?.clone(),put:async(q,v)=>cache.set(q.url,v.clone())}};t.after(()=>{globalThis.caches=old;});
 const log={runById:()=>r,inputs:(_id,since,limit)=>r.inputs.filter(x=>x.seq>since).slice(0,limit)};
 const rpc={worldRun:id=>id?{...r,inputs:undefined,events:undefined}:{runId:r.runId,runs:[r]},worldRunInputs:(...a)=>WorldDO.prototype.worldRunInputs.call({runtime:{runLog:log}},...a),worldEvents:()=>[]};
 const env={PUBLIC_ORIGIN:'https://offline.invalid',ALLOWED_HOSTS:'offline.invalid',WORLD:{idFromName:()=>0,get:()=>rpc},BURST:{limit:async({key})=>{assert.equal(key,'runlog:192.0.2.1');const window=Math.floor(Date.now()/60000),count=(buckets.get(window)??0)+1;buckets.set(window,count);return{success:count<=20};}}};
 return{calls,denied,read:async(path,init)=>{assert.equal(init.method,'GET');const res=await worker.fetch(new Request(env.PUBLIC_ORIGIN+path,{...init,headers:{'cf-connecting-ip':'192.0.2.1'}}),env);calls.push(path);if(res.status===429)denied.push(path);return res;}};
}
function clock(t){t.mock.timers.enable({apis:['Date','setTimeout'],now:T});}
function advanceWaits(t,progress){return p=>{progress.push(p);if(p.phase==='waiting')setImmediate(()=>t.mock.timers.tick(60001));};}
for(const {n,padding=0} of[{n:289},{n:4096},{n:76,padding:450000}])test(`cold ${n}-input${padding?' byte-bounded':''} run completes without raising or bypassing BURST`,async t=>{
 clock(t);const r=record(n,padding),s=transport(t,r),progress=[];
 const loaded=await loadRecordedRun(s.read,undefined,undefined,{onProgress:advanceWaits(t,progress)}),player=loadRun(loaded);player.seek(player.getState().durationSec);
 assert.equal(player.getFrame().publicState.version,n);assert.equal(loaded.inputs.length,n);assert.ok(s.denied.length>=1);assert.ok(progress.some(p=>p.phase==='waiting'));assert.ok(progress.some(p=>p.phase==='inputs'&&p.loaded===n&&p.total===n));
 assert.equal(s.calls.filter(p=>p==='/api/world/run').length,1,'never restart list/header after a rate wait');assert.equal(s.calls.filter(p=>p.includes('snapshot=1')).length,1);
 for(const path of s.denied)assert.equal(s.calls.filter(p=>p===path).length,2,'retry the failed cursor only, preserving prior pages');
});
test('cancellation interrupts429 wait before another request',async t=>{
 clock(t);let calls=0;const controller=new AbortController(),progress=[];
 const promise=loadRecordedRun(async()=>{calls++;return{ok:false,status:429};},'r',controller.signal,{onProgress:p=>progress.push(p)});
 const outcome=assert.rejects(promise,/cancel|abort/i);await turn();assert.ok(progress.some(p=>p.phase==='waiting'));controller.abort();await outcome;t.mock.timers.tick(120000);assert.equal(calls,1);
});
test('cancellation interrupts a read even when the supplied transport ignores its signal',async t=>{
 clock(t);const controller=new AbortController();const promise=loadRecordedRun(()=>new Promise(()=>{}),'r',controller.signal);const outcome=assert.rejects(promise,/cancel|abort/i);controller.abort();await outcome;
});
test('persistent429 reaches a finite whole-load deadline without a final extra request',async t=>{
 clock(t);let calls=0;const progress=[];
 await assert.rejects(loadRecordedRun(async()=>{calls++;return{ok:false,status:429};},'r',undefined,{onProgress:advanceWaits(t,progress)}),/deadline/i);
 assert.ok(progress.length>1);assert.ok(calls<=31);assert.ok(Date.now()-T<=30*60*1000+60001);
});
test('a stalled transport fails after its finite read timeout',async t=>{
 clock(t);const p=loadRecordedRun(()=>new Promise(()=>{}),'r');const outcome=assert.rejects(p,/timed out/i);await turn();t.mock.timers.tick(20000);await outcome;
});
test('a stalled response body also has a finite read timeout',async t=>{
 clock(t);const p=loadRecordedRun(async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}),'r');const outcome=assert.rejects(p,/timed out/i);await turn();t.mock.timers.tick(20000);await outcome;
});
test('other HTTP failures remain immediate and are never retried',async t=>{
 clock(t);for(const status of[400,403,404,500,503]){let calls=0;await assert.rejects(loadRecordedRun(async()=>{calls++;return{ok:false,status};},'r'),new RegExp('HTTP '+status));assert.equal(calls,1);}assert.equal(Date.now(),T);
});
test('oversized initial snapshot is rejected before input or event pages',async t=>{
 clock(t);const r=record(1);r.initialSnapshot.body='x'.repeat(512*1024+1);const s=transport(t,r);await assert.rejects(loadRecordedRun(s.read,r.runId),e=>e.code==='record_too_large');assert.equal(s.calls.length,1);
});
test('oversized committed snapshot is rejected before the next page',async t=>{
 clock(t);const r=record(20);r.inputs[0].afterSnapshot.body='x'.repeat(512*1024+1);const s=transport(t,r);await assert.rejects(loadRecordedRun(s.read,r.runId),e=>e.code==='record_too_large');assert.equal(s.calls.length,2);
});
test('cumulative snapshot budget is enforced while paging instead of buffering the whole run',async t=>{
 clock(t);const r=record(1,500000),row=r.inputs[0];r.inputs=Array.from({length:140},(_,i)=>({...row,seq:i+1}));r.readThrough={inputSeq:140,eventSeq:0,inputs:140,events:0};const s=transport(t,r);
 await assert.rejects(loadRecordedRun(s.read,r.runId,undefined,{onProgress:advanceWaits(t,[])}),e=>e.code==='record_too_large');
 assert.ok(s.calls.at(-1).includes('/inputs?'));assert.ok(Number(new URL(s.calls.at(-1),'https://offline.invalid').searchParams.get('since'))<136,'reject without requesting final page');
});
