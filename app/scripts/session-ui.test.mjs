// Synthetic DOM/SDK only. No Turnstile service, credentials, cookies or network.
import nativeTest from 'node:test';
const test=(name,fn)=>nativeTest(name,{timeout:1500},fn);
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const code=(await build({entryPoints:[new URL('../src/live.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'offline',setup(b){b.onResolve({filter:/^\.\/ui\/(isolation|resource-state)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('isolation')?'export const isolation={replay:false};':'export const BLOCKED="blocked";'}));}}]})).outputFiles[0].text;
let sequence=0;
const flush=()=>new Promise(r=>setImmediate(r));
class El extends EventTarget{
 constructor(tag){super();this.tagName=tag;this.children=[];this.attrs={};this.dataset={};this.textContent='';this.open=false;}
 append(...xs){for(const x of xs){x.parentElement=this;this.children.push(x);}}
 setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k]??null;}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);this.parentElement=null;}
 showPopover(){this.open=true;} hidePopover(){this.open=false;const e=new Event('toggle');e.newState='closed';this.dispatchEvent(e);}
 matches(selector){return selector===':popover-open'&&this.open;} focus(){} get isConnected(){return !!this.parentElement;}
}
const walk=e=>[e,...e.children.flatMap(walk)];
async function fixture(t){
 const originals=Object.fromEntries(['document','window','location','history','fetch','setTimeout','clearTimeout'].map(k=>[k,globalThis[k]]));
 const doc=new EventTarget();doc.visibilityState='visible';doc.body=new El('body');doc.head=new El('head');doc.createElement=t=>new El(t);doc.activeElement=null;
 const calls=[],renders=[],removed=[],timers=new Map();let timerId=0;
 const sdk={render(host,opts){renders.push({host,opts});return 'synthetic-widget';},remove(id){removed.push(id);}};
 Object.assign(globalThis,{document:doc,window:{turnstile:sdk},location:{search:'',pathname:'/',hash:''},history:{replaceState(){}},fetch:async(path,init)=>{calls.push({path,init});assert.equal(path,'/api/session');return{ok:true,json:async()=>({tier:'visitor',expiresAt:100,quota:{perHour:3,usedThisHour:0}})};},setTimeout:(f,ms)=>{timers.set(++timerId,{f,ms});return timerId;},clearTimeout:id=>timers.delete(id)});
 t.after(()=>Object.assign(globalThis,originals));
 const {ensureSession}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#'+sequence++);
 const status={session:null,turnstile:{configured:true,sitekey:'synthetic-public-sitekey'}};
 const start=()=>{const promise=ensureSession(status);promise.catch(()=>{});return promise;};
 const loaded=async()=>{const s=doc.head.children.at(-1);assert.ok(s,'SDK script appended');s.onload();await flush();};
 const card=()=>walk(doc.body).find(e=>e.className==='session-verification');
 const cancel=()=>walk(doc.body).find(e=>e.dataset.action==='cancel-verification');
 const timeout=async()=>{const row=[...timers].find(([,t])=>t.ms>500&&t.ms<=120000);assert.ok(row,'bounded verification timer');timers.delete(row[0]);row[1].f();await flush();};
 return{doc,calls,renders,removed,timers,start,loaded,card,cancel,timeout,ensureSession,status};
}
test('visitor widget is inside a dedicated open top-layer card with explanation and one cancel action',async t=>{
 const f=await fixture(t),p=f.start();await f.loaded();const c=f.card();assert.ok(c);assert.equal(c.getAttribute('popover'),'manual');assert.equal(c.open,true);assert.match(walk(c).map(e=>e.textContent).join(' '),/확인|verification/i);assert.ok(walk(c).includes(f.renders[0].host));assert.equal(walk(c).filter(e=>e.tagName==='button').length,1);f.cancel().onclick();await assert.rejects(p);assert.equal(f.calls.length,0);
});
test('success posts exactly once and removes its widget/card; later SDK callbacks do nothing',async t=>{
 const f=await fixture(t),p=f.start();await f.loaded();const o=f.renders[0].opts;o.callback('synthetic-not-a-real-token');o.callback('ignored-synthetic');assert.equal((await p).tier,'visitor');assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(f.calls[0].init.body),{turnstile:'synthetic-not-a-real-token'});assert.equal(f.card(),undefined);assert.equal(f.removed.length,1);o.callback('late-synthetic');o['error-callback']();await flush();assert.equal(f.calls.length,1);assert.equal(f.removed.length,1);
});
for(const kind of['cancel','closed','hidden','timeout'])test(`${kind} blocks late token and never posts a session`,async t=>{
 const f=await fixture(t),p=f.start();await f.loaded();const o=f.renders[0].opts;
 if(kind==='cancel'){assert.ok(f.cancel());f.cancel().onclick();}else if(kind==='closed'){assert.ok(f.card());f.card().hidePopover();}else if(kind==='hidden'){f.doc.visibilityState='hidden';f.doc.dispatchEvent(new Event('visibilitychange'));}else await f.timeout();
 await assert.rejects(p);o.callback('late-synthetic');await flush();assert.equal(f.calls.length,0);assert.equal(f.removed.length,1);assert.equal(f.card(),undefined);assert.equal(f.timers.size,0);
});
test('cancel while script loads prevents a late SDK render and post',async t=>{
 const f=await fixture(t),p=f.start(),lateLoad=f.doc.head.children.at(-1).onload;assert.ok(f.cancel());f.cancel().onclick();await assert.rejects(p);lateLoad();await flush();assert.equal(f.renders.length,0);assert.equal(f.calls.length,0);
});
test('script failure cleans up and only an explicit new invocation loads again',async t=>{
 const f=await fixture(t),p=f.start();f.doc.head.children.at(-1).onerror();await assert.rejects(p);assert.equal(f.card(),undefined);assert.equal(f.calls.length,0);const n=f.doc.head.children.length;await flush();assert.equal(f.doc.head.children.length,n);const q=f.start();assert.notEqual(f.doc.head.children.at(-1),undefined);await f.loaded();assert.equal(f.renders.length,1);f.cancel().onclick();await assert.rejects(q);
});
test('callback then hide in the same turn cannot begin a session POST',async t=>{
 const f=await fixture(t),p=f.start();await f.loaded();f.renders[0].opts.callback('synthetic-not-a-real-token');f.doc.visibilityState='hidden';f.doc.dispatchEvent(new Event('visibilitychange'));await assert.rejects(p);assert.equal(f.calls.length,0);
});
test('hidden document cannot start SDK or session requests; existing session remains a no-op',async t=>{
 const f=await fixture(t);f.doc.visibilityState='hidden';await assert.rejects(f.start());assert.equal(f.doc.head.children.length,0);assert.equal(f.calls.length,0);const existing={tier:'visitor',expiresAt:100,quota:{perHour:3,usedThisHour:0}};assert.equal(await f.ensureSession({...f.status,session:existing}),existing);
});
test('SDK error or expiry cleans up without session POST or automatic retry',async t=>{
 for(const name of['error-callback','expired-callback','timeout-callback']){
  const f=await fixture(t),p=f.start();await f.loaded();f.renders[0].opts[name]();await assert.rejects(p);f.renders[0].opts.callback('late-synthetic');await flush();assert.equal(f.calls.length,0);assert.equal(f.removed.length,1);assert.equal(f.card(),undefined);
 }
});
test('pending session POST is aborted on cancel and its late result cannot resolve the session',async t=>{
 const f=await fixture(t);let release;globalThis.fetch=async(path,init)=>{f.calls.push({path,init});return new Promise(r=>release=r);};const p=f.start();await f.loaded();f.renders[0].opts.callback('synthetic-not-a-real-token');await flush();assert.equal(f.calls.length,1);f.cancel().onclick();await assert.rejects(p);assert.equal(f.calls[0].init.signal.aborted,true);release({ok:true,json:async()=>({tier:'visitor'})});await flush();assert.equal(f.calls.length,1);assert.equal(f.removed.length,1);
});
test('session refusal is final for that invocation and does not expose provider data',async t=>{
 const f=await fixture(t);globalThis.fetch=async()=>({ok:false,status:403});const p=f.start();await f.loaded();f.renders[0].opts.callback('synthetic-not-a-real-token');await assert.rejects(p,/Could not confirm/);assert.equal(f.card(),undefined);assert.equal(f.removed.length,1);
});
test('judge path remains separate and sends one existing judge POST without an SDK card',async t=>{
 const f=await fixture(t);globalThis.location.search='?judge=synthetic-judge';const answer=await f.ensureSession(f.status);assert.equal(answer.tier,'visitor');assert.equal(f.doc.head.children.length,0);assert.equal(f.card(),undefined);assert.equal(f.calls.length,1);assert.deepEqual(JSON.parse(f.calls[0].init.body),{judge:'synthetic-judge'});
});
test('a stalled SDK script times out and its late load cannot render a widget',async t=>{
 const f=await fixture(t),p=f.start(),lateLoad=f.doc.head.children.at(-1).onload;await f.timeout();await assert.rejects(p,/timed out/);lateLoad();await flush();assert.equal(f.renders.length,0);assert.equal(f.calls.length,0);assert.equal(f.card(),undefined);
});
test('synchronous terminal SDK callback still removes the returned widget exactly once',async t=>{
 const f=await fixture(t);window.turnstile.render=(host,opts)=>{opts['error-callback']();return 'synthetic-sync-error';};const p=f.start();await f.loaded();await assert.rejects(p);assert.equal(f.removed.length,1);assert.equal(f.calls.length,0);assert.equal(f.card(),undefined);
});
test('explicit retry after a stalled SDK timeout creates a new load and ignores old load/error callbacks',async t=>{
 const f=await fixture(t),p=f.start(),old=f.doc.head.children.at(-1),lateLoad=old.onload,lateError=old.onerror;
 await f.timeout();await assert.rejects(p);const q=f.start(),fresh=f.doc.head.children.at(-1);assert.notEqual(fresh,old,'explicit retry needs a fresh SDK script');lateLoad();lateError();await flush();assert.equal(f.renders.length,0);await f.loaded();assert.equal(f.renders.length,1);f.cancel().onclick();await assert.rejects(q);assert.equal(f.calls.length,0);
});
test('cancelling one shared SDK waiter leaves another waiter intact; successful SDK load stays cached',async t=>{
 const f=await fixture(t),p=f.start(),old=f.doc.head.children.at(-1),firstCancel=f.cancel(),q=f.start();assert.equal(f.doc.head.children.length,1);firstCancel.onclick();await assert.rejects(p);assert.equal(f.doc.head.children.at(-1),old);await f.loaded();assert.equal(f.renders.length,1);f.cancel().onclick();await assert.rejects(q);const r=f.start();await flush();assert.equal(f.doc.head.children.length,1);assert.equal(f.renders.length,2);f.cancel().onclick();await assert.rejects(r);assert.equal(f.calls.length,0);
});
