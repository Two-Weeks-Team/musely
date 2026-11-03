// Offline card fixtures: synthetic frames only; no browser, camera, session or model calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled = await build({entryPoints:[new URL('../src/ui/ritual.ts',import.meta.url).pathname], bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'offline-session',setup(b){b.onResolve({filter:/^\.\.\/live$/},()=>({path:'live',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const sparkStatus=()=>globalThis.ritualFixture.status(); export const ensureSession=()=>globalThis.ritualFixture.session();'}));}}]});
const {ritualCard}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
class Node {
 constructor(tag){this.tagName=tag;this.childNodes=[];this.attrs={};this.disabled=false;this.isConnected=true;}
 set textContent(v){this.text=String(v);this.childNodes=[];} get textContent(){return (this.text??'')+this.childNodes.map(n=>n.textContent).join('');}
 append(...nodes){this.childNodes.push(...nodes);} replaceChildren(...nodes){this.text='';this.childNodes=nodes;}
 setAttribute(k,v){this.attrs[k]=String(v);} focus(){document.activeElement=this;} scrollIntoView(){this.scrolled=true;}
 closest(){return ritualFixture.open?{}:null;} remove(){this.removed=true;}
 async play(){} getContext(){return {drawImage(){ritualFixture.captures++;}};} toDataURL(){return 'data:image/jpeg;base64,OFFLINE';}
}
const walk=n=>[n,...n.childNodes.flatMap(walk)];
const button=(card,text)=>walk(card).find(n=>n.tagName==='button'&&n.textContent===text&&!n.removed);
const response=(data,status=200,serverNow=Date.now())=>({ok:status<300,status,headers:{get:name=>name==='date'?new Date(serverNow).toUTCString():null},json:async()=>data});
async function fixture(t,{pendingCamera=false,cameraError=null,ttl=180000}={}){
 const originals={document:globalThis.document,navigator:globalThis.navigator,fetch:globalThis.fetch,MutationObserver:globalThis.MutationObserver,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const timers=new Map();let next=0;const observers=[];const listeners=new Map();
 const state={open:true,captures:0,stopped:0,statusCalls:0,sessionCalls:0,starts:0,posts:[],done:0,now:Date.now(),status:async()=>{state.statusCalls++;return {};},session:async()=>{state.sessionCalls++;}};
 globalThis.ritualFixture=state;
 globalThis.document={visibilityState:'visible',documentElement:{},createElement:tag=>new Node(tag),addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:(k,f)=>{if(listeners.get(k)===f)listeners.delete(k);}};
 globalThis.MutationObserver=class {constructor(f){this.f=f;observers.push(this);} observe(){} disconnect(){this.off=true;}};
 globalThis.setTimeout=(f,ms)=>{timers.set(++next,{f,ms});return next;};globalThis.clearTimeout=id=>timers.delete(id);
 const camera=deferred(),stream={getTracks:()=>[{stop(){state.stopped++;}}]};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>cameraError?Promise.reject(Object.assign(new Error('camera fixture'),{name:cameraError})):pendingCamera?camera.promise:Promise.resolve(stream)}}});
 globalThis.fetch=async(url,init)=>{if(url==='/api/ritual/record')return response({record:null});if(url==='/api/ritual/start'){state.starts++;return response({id:'fixture',steps:[{id:'a',text:'raise one hand'},{id:'b',text:'turn your head'},{id:'c',text:'show three fingers'}],expiresAt:state.now+ttl},200,state.now);}if(url==='/api/muse'){state.posts.push(JSON.parse(init.body));return response({source:'live',output:{results:[]}});}throw Error('Unexpected offline request');};
 const card=ritualCard(()=>state.done++);await flush();
 const start=button(card,'카메라로 시작 · Try the ritual');start.onclick();await flush();
 const tick=async()=>{const timer=[...timers].find(([,v])=>v.ms===1000);assert.ok(timer,'countdown timer');timers.delete(timer[0]);timer[1].f();await flush();};
 const countdown=async()=>{await tick();await tick();await tick();};
 const click=async(text)=>{const b=button(card,text);assert.ok(b,`button ${text}`);assert.equal(b.disabled,false);b.onclick();await flush();};
 const dismiss=async(kind)=>{if(kind==='hidden'){document.visibilityState='hidden';listeners.get('visibilitychange')?.();}else if(kind==='removed'){card.isConnected=false;for(const o of observers)if(!o.off)o.f();}else{state.open=false;listeners.get('toggle')?.();for(const o of observers)if(!o.off)o.f();}await flush();};
 t.after(()=>{for(const [k,v]of Object.entries(originals))Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});delete globalThis.ritualFixture;});
 return {state,card,start,camera,stream,timers,tick,countdown,click,dismiss};
}
test('preview is focused and waits without session or challenge use, then each move needs its own readiness',async t=>{
 const f=await fixture(t);const stage=walk(f.card).find(n=>n.className==='ritual-stage');
 assert.equal(f.state.starts,0,'preview must not consume challenge');assert.equal(f.state.statusCalls,0);assert.equal(f.state.sessionCalls,0);
 assert.equal(document.activeElement,stage);assert.equal(stage.scrolled,true);assert.equal(stage.tabIndex,-1);
 await f.click('준비됐어요 · Ready');assert.equal(f.state.starts,0);await f.countdown();assert.equal(f.state.starts,1);assert.equal(f.state.captures,0);
 for(let i=0;i<3;i++){assert.equal(f.state.captures,i);assert.equal(f.state.posts.length,0);await f.click('동작 준비됐어요 · Ready for this move');await f.countdown();}
 assert.equal(f.state.captures,3);assert.equal(f.state.posts.length,1);assert.equal(f.state.posts[0].input.frames.length,3);assert.equal(f.state.stopped,1);assert.equal(f.state.done,1);
});
test('cancel during pending permission stops a late stream and never starts a challenge',async t=>{
 const f=await fixture(t,{pendingCamera:true});await f.click('취소 · Cancel');f.camera.resolve(f.stream);await flush();
 assert.equal(f.state.stopped,1);assert.equal(f.state.starts,0);assert.equal(f.state.posts.length,0);assert.equal(f.start.disabled,false);
});
for(const [name,expected] of [
 ['NotAllowedError',[/Site information.*Site settings.*Camera/,/macOS.*Privacy & Security.*Camera/,/camera policy/]],
 ['NotFoundError',[/No camera was found/,/Connect or enable/]],
 ['NotReadableError',[/Another app may be using it/,/device may be unavailable/]],
])test(`${name} gives actionable camera guidance without a challenge or upload`,async t=>{
 const f=await fixture(t,{cameraError:name});
 for(const pattern of expected)assert.match(f.card.textContent,pattern);
 assert.equal(f.state.starts,0);assert.equal(f.state.posts.length,0);assert.equal(f.state.captures,0);assert.equal(f.start.disabled,false);
});
for(const kind of ['hidden','removed','closed'])test(`${kind} releases preview and sends no frames`,async t=>{
 const f=await fixture(t);await f.dismiss(kind);assert.equal(f.state.stopped,1);assert.equal(f.state.posts.length,0);assert.equal(f.state.starts,0);assert.equal(f.start.disabled,false);
});
test('dismissal between prepared moves discards captured frames and prevents upload',async t=>{
 const f=await fixture(t);await f.click('준비됐어요 · Ready');await f.countdown();await f.click('동작 준비됐어요 · Ready for this move');await f.countdown();assert.equal(f.state.captures,1);
 await f.dismiss('hidden');assert.equal(f.state.stopped,1);assert.equal(f.state.posts.length,0);
});
test('expired challenge while waiting for a move stops without upload or replacement challenge',async t=>{
 const f=await fixture(t,{ttl:60000});await f.click('준비됐어요 · Ready');await f.countdown();const expiry=[...f.timers].find(([,v])=>v.ms>30000);assert.ok(expiry);f.timers.delete(expiry[0]);expiry[1].f();await flush();
 assert.equal(f.state.stopped,1);assert.equal(f.state.starts,1);assert.equal(f.state.posts.length,0);assert.match(f.card.textContent,/expired/i);
});
for(const kind of ['hidden','removed','closed'])test(`${kind} during permission wait stops a late camera stream`,async t=>{
 const f=await fixture(t,{pendingCamera:true});await f.dismiss(kind);f.camera.resolve(f.stream);await flush();assert.equal(f.state.stopped,1);assert.equal(f.state.starts,0);assert.equal(f.state.posts.length,0);
});
test('repeated start and readiness clicks do not duplicate a challenge or capture',async t=>{
 const f=await fixture(t);f.start.onclick();await flush();const initial=button(f.card,'준비됐어요 · Ready');initial.onclick();initial.onclick();await flush();await f.countdown();assert.equal(f.state.starts,1);
 const move=button(f.card,'동작 준비됐어요 · Ready for this move');move.onclick();move.onclick();await flush();await f.countdown();assert.equal(f.state.captures,1);assert.equal(f.state.posts.length,0);await f.dismiss('closed');
});

for(const offset of [600000,-600000])test(`device clock offset ${offset} does not consume a fresh server challenge`,async t=>{
 const f=await fixture(t);const now=Date.now;Date.now=()=>f.state.now+offset;t.after(()=>{Date.now=now;});
 await f.click('준비됐어요 · Ready');await f.countdown();
 assert.equal(f.state.starts,1);const expiry=[...f.timers.values()].find(v=>v.ms>30000);assert.ok(expiry,'a fresh challenge must keep time to prepare');assert.ok(expiry.ms<=180000);
 await f.click('동작 준비됐어요 · Ready for this move');await f.countdown();assert.equal(f.state.captures,1);await f.dismiss('closed');
});
