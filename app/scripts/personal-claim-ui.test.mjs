// Offline component/API stand-ins; no actual account, post, browser, key or HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const implementation=await import('../src/ui/personal-claim.ts').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.childNodes=[];this.dataset={};this.attrs={};this.disabled=false;this._text='';this.hidden=false;}
 append(...xs){for(const x of xs){x.parentNode=this;this.childNodes.push(x);}}
 replaceChildren(...xs){for(const x of this.childNodes)x.parentNode=null;this.childNodes=[];this._text='';this.append(...xs);}
 remove(){if(this.parentNode)this.parentNode.childNodes=this.parentNode.childNodes.filter(x=>x!==this);}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
 set textContent(v){this.replaceChildren();this._text=String(v);}get textContent(){return this._text+this.childNodes.map(x=>x.textContent).join('');}
}
const all=(n,f)=>[...(f(n)?[n]:[]),...n.childNodes.flatMap(x=>all(x,f))];
const action=(t,id)=>all(t.host,n=>n.dataset.action===id)[0];
const flush=()=>new Promise(r=>setImmediate(r));
const P={actorId:'pm_11111111-1111-4111-8111-111111111111',displayName:'<img src=x onerror=bad()>',appearanceId:'00-jolly',revision:1};
const F='abcdef0123456789'+'a'.repeat(48),DISPLAY='abcd ef01 2345 6789';
const dto=(extra={})=>({actorId:P.actorId,status:'pending_claim',claimed:false,version:0,fingerprint:F,display:DISPLAY,text:'I am claiming my Muse on Musely. Fingerprint: abcd ef01 2345 6789 · musely.net',permalink:null,verifiedAt:null,checkedAt:null,...extra});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,redirected:false,json:async()=>structuredClone(data)});
const AUTH='https://threads.com/oauth/authorize?client_id=public&scope=threads_basic&response_type=code&state=personal-claim-v1.synthetic_nonce';
function setup(handler=()=>response(dto()),extra={}){
 assert.equal(typeof implementation.mountPersonalClaim,'function','claim component must exist');
 const visibility=new Map();globalThis.document={visibilityState:'visible',createElement:t=>new Element(t),addEventListener:(k,f)=>visibility.set(k,f),removeEventListener:k=>visibility.delete(k)};const host=new Element('main'),calls=[],copies=[],navigation=[],expanded=[],locks=[],lost=[];
 const c=implementation.mountPersonalClaim(host,{fetcher:async(url,init)=>{calls.push({url,...init});return handler(url,init);},clipboard:{writeText:async text=>copies.push(text)},navigate:url=>navigation.push(url),onExpanded:v=>expanded.push(v),onWriteBusy:v=>locks.push(v),onSessionLost:()=>lost.push(true),...extra});
 return{host,c,calls,copies,navigation,expanded,locks,lost,sync:()=>c.syncProfile({authenticated:true,profile:P,busy:false}),visibility,hide(){document.visibilityState='hidden';visibility.get('visibilitychange')?.();},show(){document.visibilityState='visible';visibility.get('visibilitychange')?.();}};
}
async function click(t,id){const b=action(t,id);assert.ok(b,id+' exists');await b.onclick();await flush();}
test('claim DTO binds exact own actor, public fingerprint/display/text and safe fields',()=>{
 assert.equal(typeof implementation.parsePersonalClaim,'function','claim parser must exist');
 assert.equal(implementation.parsePersonalClaim(dto(),P.actorId).text,dto().text);
 for(const extra of[{actorId:'00-jolly'},{display:'wrong'},{text:'CANARY'},{status:'joined'},{claimed:true},{version:-1},{fingerprint:F.toUpperCase()},{permalink:'javascript:CANARY'},{checkedAt:NaN},{privateToken:'CANARY'}])assert.throws(()=>implementation.parsePersonalClaim(dto(extra),P.actorId));
});
test('mount is inert; signed-out and uncertain profiles never fetch, sync only reads claim',async()=>{
 const t=setup();assert.equal(t.calls.length,0);await t.c.syncProfile({authenticated:false,profile:null,busy:false});await t.c.syncProfile({authenticated:null,profile:null,busy:true});assert.equal(t.calls.length,0);await t.sync();assert.deepEqual(t.calls.map(x=>[x.url,x.method]),[['/api/personal/claim','GET']]);assert.equal(t.c.state().joined,false);assert.equal(t.c.state().claim.claimed,false);assert.equal(t.copies.length,0);assert.equal(t.navigation.length,0);t.c.dispose();
});
test('one primary progresses through exact public copy, manual Threads publication, explicit verification',async()=>{
 const t=setup((_u,i)=>i.method==='GET'?response(dto()):response({authorizationUrl:AUTH}));await t.sync();assert.equal(t.c.state().expanded,true);assert.equal(all(t.host,n=>n.className==='primary').length,1);assert.match(t.host.textContent,/암호화/);assert.match(t.host.textContent,/일반 로그인/);
 await click(t,'copy-claim');assert.deepEqual(t.copies,[dto().text]);assert.equal(t.calls.length,1);const publish=action(t,'publish-claim');assert.equal(publish.href,'https://www.threads.com/');await publish.onclick();assert.equal(t.calls.length,1);await click(t,'verify-claim');assert.deepEqual(t.calls.map(x=>x.method),['GET','POST']);assert.deepEqual(JSON.parse(t.calls[1].body),{expectedVersion:0});assert.deepEqual(t.navigation,[AUTH]);assert.equal(t.c.state().claim.claimed,false);assert.equal(t.c.state().joined,false);assert.doesNotMatch(t.host.textContent,/synthetic_nonce|client_id/);t.c.dispose();
});
test('only fresh GET truth can claim; callback query is never consumed as proof',async()=>{
 let actual=false;const t=setup(()=>response(dto(actual?{status:'claimed',claimed:true,version:1,verifiedAt:100,checkedAt:100}:{})));await t.sync();assert.equal(t.c.state().claim.claimed,false);actual=true;await t.c.refresh();assert.equal(t.c.state().claim.claimed,true);assert.equal(t.c.state().joined,false);assert.match(t.host.textContent,/입장.*아니|entry.*separate/i);t.c.dispose();
});
test('unsafe authorization URL, scope, response type, state or extra fields never navigate or leak',async()=>{
 for(const answer of[{authorizationUrl:'https://threads.com.evil.invalid/oauth/authorize'},{authorizationUrl:AUTH.replace('threads_basic','threads_basic,threads_content_publish')},{authorizationUrl:AUTH.replace('response_type=code','response_type=token')},{authorizationUrl:AUTH.replace('personal-claim-v1.','personal-v1.')},{authorizationUrl:AUTH+'#CANARY'},{authorizationUrl:AUTH,token:'CANARY'}]){
  const t=setup((_u,i)=>i.method==='GET'?response(dto()):response(answer));await t.sync();await click(t,'verify-claim');assert.equal(t.navigation.length,0);assert.equal(t.c.state().phase,'error');assert.doesNotMatch(t.host.textContent,/CANARY|client_id/);t.c.dispose();
 }
});
test('every request is same-origin no-store, and only the latest version is deleted by a click',async()=>{
 const t=setup((_u,i)=>response(i.method==='DELETE'?dto({status:'claim_revoked',version:8,checkedAt:100}):dto({version:7})));await t.sync();assert.equal(t.calls.length,1);await click(t,'cancel-claim');assert.deepEqual(JSON.parse(t.calls[1].body),{expectedVersion:7});assert.equal(t.c.state().claim.status,'claim_revoked');for(const c of t.calls){assert.equal(c.credentials,'same-origin');assert.equal(c.mode,'same-origin');assert.equal(c.redirect,'error');assert.equal(c.cache,'no-store');}t.c.dispose();
});
test('busy verification has one POST and cannot be superseded by a refresh',async()=>{
 let finish;const held=new Promise(r=>finish=r);const t=setup((_u,i)=>i.method==='GET'?response(dto()):held);await t.sync();const old=action(t,'verify-claim');const pending=old.onclick();await old.onclick();await t.c.refresh();assert.equal(t.calls.length,2);finish(response({authorizationUrl:AUTH}));await pending;assert.equal(t.navigation.length,1);assert.deepEqual(t.locks,[true,false]);t.c.dispose();
});
test('logout or actor switch aborts pending writes and never follows old authorization',async()=>{
 for(const next of[{authenticated:false,profile:null,busy:false},{authenticated:true,profile:{...P,actorId:'pm_22222222-2222-4222-8222-222222222222'},busy:false}]){
  let finish,currentActor=P.actorId;const held=new Promise(r=>finish=r),t=setup((_u,i)=>i.method==='POST'?held:response(dto({actorId:currentActor})));await t.sync();const pending=action(t,'verify-claim').onclick();const oldSignal=t.calls.at(-1).signal;currentActor=next.profile?.actorId??P.actorId;await t.c.syncProfile(next);assert.equal(oldSignal.aborted,true);finish(response({authorizationUrl:AUTH}));await pending;assert.equal(t.navigation.length,0);assert.equal(t.c.state().joined,false);t.c.dispose();
 }
});
test('late foreign read, malformed/private response and generic failures never render raw fields',async()=>{
 for(const answer of[dto({actorId:'00-jolly',text:'CANARY'}),dto({privateReason:'CANARY'}),null]){
  const t=setup(()=>response(answer));await t.sync();assert.equal(t.c.state().claim,null);assert.equal(t.c.state().phase,'error');assert.doesNotMatch(t.host.textContent,/CANARY/);t.c.dispose();
 }
 const t=setup(()=>{throw Error('CANARY_SECRET');});await t.sync();assert.doesNotMatch(t.host.textContent,/CANARY/);t.c.dispose();
});
test('closing or disposing aborts reads and ignores late results, preserving alternate setup',async()=>{
 for(const operation of['close','dispose']){let finish;const held=new Promise(r=>finish=r),t=setup(()=>held);const pending=t.sync();const signal=t.calls[0].signal;if(operation==='close')t.c.setVisible(false);else t.c.dispose();assert.equal(signal.aborted,true);finish(response(dto({status:'claimed',claimed:true,verifiedAt:100,checkedAt:100})));await pending;assert.equal(t.c.state().claim,null);assert.equal(t.c.state().joined,false);if(operation==='close'){t.c.setExpanded(false);assert.equal(t.expanded.at(-1),false);t.c.dispose();}}
});
test('late clipboard callbacks cannot restore a signed-out profile or repeat copying',async()=>{
 let finish;const held=new Promise(r=>finish=r),t=setup(undefined,{clipboard:{writeText:()=>held}});await t.sync();const copy=action(t,'copy-claim'),pending=copy.onclick();await copy.onclick();await t.c.syncProfile({authenticated:false,profile:null,busy:false});finish();await pending;assert.equal(t.c.state().claim,null);assert.equal(t.c.state().phase,'observer');t.c.dispose();
});
test('401 loses local proof, notifies profile once, and never retries automatically',async()=>{
 const t=setup(()=>response({reason:'CANARY'},401));await t.sync();assert.equal(t.calls.length,1);assert.equal(t.c.state().claim,null);assert.equal(t.lost.length,1);assert.doesNotMatch(t.host.textContent,/CANARY/);t.c.dispose();
});
test('profile names and server public claim text use text nodes only',async()=>{
 const t=setup();await t.sync();assert.ok(t.host.textContent.includes(P.displayName));assert.equal(all(t.host,n=>n.tagName==='IMG').length,0);assert.ok(all(t.host,n=>n.tagName==='TEXTAREA')[0].readOnly);t.c.dispose();
});

// Bundle the existing door entry point in memory, then exercise its real callbacks without a browser.
const bundled=await build({entryPoints:[new URL('../src/ui/onboarding.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm'});
const {mountOnboarding}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].contents).toString('base64'));
function onboardingFixture(claimed=false){
 const events=new Map(),body=new Element('body'),header=new Element('header');body.append(header);
 Element.prototype.querySelector=function(s){return all(this,n=>s[0]==='#'?n.id===s.slice(1):s[0]==='.'?n.className?.split(' ').includes(s.slice(1)):n.tagName===s.toUpperCase())[0]??null;};
 Element.prototype.insertBefore=function(n,b){n.parentNode=this;const i=this.childNodes.indexOf(b);this.childNodes.splice(i<0?this.childNodes.length:i,0,n);};
 Element.prototype.addEventListener=function(k,f){(this.handlers??={})[k]=f;};Element.prototype.removeEventListener=function(k){delete this.handlers?.[k];};
 Element.prototype.focus=function(){};Element.prototype.matches=function(){return !!this.popoverOpen;};Element.prototype.showPopover=function(){this.popoverOpen=true;};Element.prototype.hidePopover=function(){this.popoverOpen=false;};
 globalThis.document={body,visibilityState:'visible',createElement:t=>{const e=new Element(t);e.classList={add:c=>e.className=(e.className??'')+' '+c};return e;},createElementNS:(ns,t)=>{const e=new Element(t);e.namespaceURI=ns;return e;},querySelector:s=>body.querySelector(s),getElementById:id=>body.querySelector('#'+id),addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k)};
 const calls=[],c=mountOnboarding({onWatch(){},initial:new URLSearchParams('personalClaim=claimed'),getWorldId:()=>null,personal:{now:()=>1000,fetcher:async(u,i)=>{calls.push([u,i.method]);if(u.endsWith('/me'))return response({authenticated:true,expiresAt:100000,entry:{state:'viewing'}});if(u.endsWith('/profile'))return response({profile:P,entry:{state:'registered'}});if(u.endsWith('/claim'))return response(dto(claimed?{status:'claimed',claimed:true,verifiedAt:100,checkedAt:100}:{}));return response({connection:{connected:false,lastSeenAt:null},profile:P,authority:null,keys:[],entry:{state:'viewing',actor:{id:P.actorId,displayName:P.displayName,appearanceId:P.appearanceId,profileRevision:1},attempt:null,receipt:null,reason:'setup_required'}});}}});
 return{body,c,calls};
}
test('callback opens a read-only current check, claim never completes the door, and closing claim restores setup',async()=>{
 for(const claimed of[false,true]){const t=onboardingFixture(claimed);await flush();await flush();assert.equal(t.c.state.open,true);assert.ok(t.calls.some(([u])=>u==='/api/personal/claim'));assert.ok(t.calls.every(([,m])=>m==='GET'));const door=t.body.querySelector('#entry-open');assert.equal(door.dataset.invitation,'active');const connection=all(t.body,n=>n.className==='entry-connection')[0];assert.equal(connection.hidden,!claimed);if(!claimed){await action({host:t.body},'later-claim').onclick();assert.equal(connection.hidden,false);}t.c.dispose();}
});
test('a pending verification cannot reopen connection actions via the claim toggle',async()=>{
 let finish;const held=new Promise(r=>finish=r),t=setup((_u,i)=>i.method==='GET'?response(dto()):held);await t.sync();const pending=action(t,'verify-claim').onclick();assert.equal(action(t,'toggle-claim').disabled,true);finish(response({authorizationUrl:AUTH}));await pending;t.c.dispose();
});
test('an initial unavailable response exposes a read-only retry without hiding all recovery',async()=>{
 const t=setup(()=>response({},503));await t.sync();assert.equal(t.c.state().expanded,true);assert.ok(action(t,'refresh-claim'));assert.ok(action(t,'later-claim'));assert.equal(t.calls.length,1);t.c.dispose();
});
test('foreign or nonadvancing delete response never becomes a local cancellation proof',async()=>{
 for(const change of[{version:3},{actorId:'00-jolly',version:4},{version:4,status:'claimed',claimed:true,verifiedAt:100}]){const t=setup((_u,i)=>response(i.method==='GET'?dto({version:3}):dto({status:'claim_revoked',...change})));await t.sync();await click(t,'cancel-claim');assert.equal(t.c.state().phase,'error');assert.equal(t.c.state().claim,null);t.c.dispose();}
});

test('backgrounding aborts each request phase, ignores late replies, and resumes with only a fresh GET',async()=>{
 for(const method of['GET','POST','DELETE']){let finish,hold=method==='GET';const held=new Promise(r=>finish=r),t=setup((_u,i)=>hold&&i.method===method?held:response(dto()));
  let pending;if(method==='GET')pending=t.sync();else{await t.sync();hold=true;pending=action(t,method==='POST'?'verify-claim':'cancel-claim').onclick();}
  const signal=t.calls.at(-1).signal,old=action(t,'verify-claim');t.hide();const count=t.calls.length;if(old)await old.onclick();hold=false;finish(method==='POST'?response({authorizationUrl:AUTH}):response(dto({status:'claimed',claimed:true,verifiedAt:100,checkedAt:100})));await pending;
  assert.equal(signal.aborted,true,method+' aborts on hidden');assert.equal(t.calls.length,count);assert.equal(t.navigation.length,0);assert.equal(t.c.state().claim,null);t.show();await flush();assert.equal(t.calls.at(-1).method,'GET');assert.equal(t.calls.length,count+1);assert.equal(t.c.state().claim.claimed,false);t.c.dispose();assert.equal(t.visibility.size,0);
 }
});
test('hidden mount or clipboard completion never begins a write or restores old UI',async()=>{
 let finish;const held=new Promise(r=>finish=r),t=setup(undefined,{clipboard:{writeText:()=>held}});await t.sync();const pending=action(t,'copy-claim').onclick();t.hide();finish();await pending;assert.equal(t.c.state().claim,null);const count=t.calls.length;await t.c.refresh();assert.equal(t.calls.length,count);t.show();await flush();assert.ok(action(t,'copy-claim'));t.c.dispose();
 const hidden=setup();document.visibilityState='hidden';await hidden.sync();assert.equal(hidden.calls.length,0);hidden.show();await flush();assert.equal(hidden.calls.length,1);assert.equal(hidden.calls[0].method,'GET');hidden.c.dispose();
});
