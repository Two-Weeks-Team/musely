import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {WorldRuntime} from '../worker/core/world-runtime.ts';
const built=await build({entryPoints:[new URL('../src/ui/recorded-replay.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {mountRecordedReplay}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
class Node{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.childNodes=[];this.parentNode=null;this.dataset={};this.attrs={};this._text='';this.className='';this.value='';this.disabled=false;this.classList={add:(...s)=>{this.className+=' '+s.join(' ');},remove:()=>{},toggle:()=>false};}
 get textContent(){return this._text+this.childNodes.map(x=>x.textContent).join('');}set textContent(t){this._text=String(t);this.replaceChildren();}
 append(...nodes){for(const n of nodes){if(n.parentNode)n.remove();this.childNodes.push(n);n.parentNode=this;}}
 replaceChildren(...nodes){for(const n of this.childNodes)n.parentNode=null;this.childNodes=[];this.append(...nodes);}
 remove(){if(this.parentNode){this.parentNode.childNodes=this.parentNode.childNodes.filter(x=>x!==this);this.parentNode=null;}}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
 get isConnected(){return this.connectedRoot||!!this.parentNode?.isConnected;}
 contains(x){return x===this||this.childNodes.some(n=>n.contains(x));}closest(){return null;}focus(){}
}
const all=n=>[n,...n.childNodes.flatMap(all)];
function fixture(){const db=new DatabaseSync(':memory:');let depth=0;const sql={exec(q,...b){const st=db.prepare(q);if(/^\s*(select|with|explain)/i.test(q))return{toArray:()=>st.all(...b)};st.run(...b);return{toArray:()=>[]};},transactionSync(fn){const s='t'+depth++;db.exec('SAVEPOINT '+s);try{const r=fn();db.exec('RELEASE '+s);return r;}catch(e){db.exec('ROLLBACK TO '+s);db.exec('RELEASE '+s);throw e;}finally{depth--;}}};const at=Date.parse('2026-11-02T12:00:00Z'),rt=new WorldRuntime(sql,{worldId:'w',model:null,meetingGate:'off',publicationNow:()=>at+1000});rt.init(at);rt.commitExternal(at+1000,'review-autonomy',(_s,emit)=>{
 emit({at:at+1000,source:'live',kind:'encounter',muse:'00-jolly',other:'01-sunny',data:{encounterId:'one',initiatedByIntent:true,actorOrigin:'connected'},tags:[]});
 emit({at:at+1000,source:'live',kind:'spotlight',muse:'00-jolly',data:{evidence:{model:'recorded-model',requestId:'req-one'}},tags:[]});
 emit({at:at+1000,source:'live',kind:'spotlight',muse:'01-sunny',data:{evidence:{model:'recorded-model',requestId:null}},tags:[]});
 });const h=rt.runLog.current;return{db,record:{...h,readThrough:rt.runLog.boundary(h.runId),inputs:rt.runLog.inputs(h.runId),events:rt.events(0,100,{runId:h.runId})}};}
test('review recorded autonomy exposes its sample and missing evidence notes in the actual UI',async()=>{
 const old={document:globalThis.document,window:globalThis.window,location:globalThis.location,HTMLElement:globalThis.HTMLElement};
 globalThis.HTMLElement=Node;globalThis.document={createElement:t=>new Node(t),activeElement:null,hidden:false};globalThis.location={href:'https://musely.net/',origin:'https://musely.net'};
 const {db,record}=fixture();globalThis.window={fetch:async url=>{const u=new URL(url);const data=u.pathname==='/api/world/run'?(u.searchParams.has('runId')?record:{runId:record.runId,runs:[record]}):u.pathname.endsWith('/inputs')?record.inputs:record.events;return{ok:true,status:200,json:async()=>structuredClone(data)};}};
 const host=new Node();host.connectedRoot=true;const view=mountRecordedReplay(host,{describe:e=>e.kind,museName:id=>id,placeName:id=>id,at:ms=>String(ms),showEvidence(){}},()=>{});
 try{await all(host).find(n=>n.tagName==='BUTTON'&&n.textContent==='Load recorded run').onclick();const range=all(host).find(n=>n.getAttribute('aria-label')==='Recorded replay position');range.value='999';range.oninput();const table=all(host).find(n=>n.className.includes('recorded-autonomy'));console.log(JSON.stringify({table:table.textContent}));assert.match(table.textContent,/n=1 meetings/,'C09 sample size must accompany the percentage');assert.match(table.textContent,/without request id/,'missing model evidence must remain visible');assert.match(table.textContent,/3 live \/ 0 rule \/ 0 scripted \/ 0 replay/,'original sources and counts remain explicit');assert.match(table.textContent,/runId:/);assert.match(host.textContent,/Stored window:/);assert.match(host.textContent,/Sample/);assert.match(host.textContent,/Notes/);}finally{view.destroy();db.close();Object.assign(globalThis,old);}
});
test('recorded load exposes rate waiting and cancellation returns to live without another GET',async t=>{
 const old={document:globalThis.document,window:globalThis.window,location:globalThis.location,HTMLElement:globalThis.HTMLElement};t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-11-03T00:00:00Z')});
 globalThis.HTMLElement=Node;globalThis.document={createElement:tag=>new Node(tag),activeElement:null,hidden:false};globalThis.location={href:'https://musely.net/',origin:'https://musely.net'};
 let reads=0,signal;globalThis.window={fetch:async(_url,init)=>{reads++;signal=init.signal;return{ok:false,status:429};}};
 const host=new Node();host.connectedRoot=true;let active=false;const view=mountRecordedReplay(host,{describe:e=>e.kind,museName:id=>id,placeName:id=>id,at:ms=>String(ms),showEvidence(){}},a=>{active=a;});
 try{
  const find=text=>all(host).find(n=>n.tagName==='BUTTON'&&n.textContent===text),cancel=find('Cancel loading');assert.ok(cancel,'recording loads must have an accessible cancel control');assert.equal(cancel.hidden,true);
  const pending=find('Load recorded run').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(cancel.hidden,false);assert.equal(cancel.disabled,false);assert.match(host.textContent,/rate|wait|retry/i);assert.equal(active,true);assert.equal(reads,1);
  cancel.onclick();await pending;assert.equal(signal.aborted,true);assert.equal(active,false);assert.equal(find('Load recorded run').disabled,false);assert.equal(cancel.hidden,true);assert.match(host.textContent,/cancel/i);
  t.mock.timers.tick(120000);assert.equal(reads,1,'cancelled retry cannot issue a later GET');
 }finally{view.destroy();Object.assign(globalThis,old);}
});
