import './ui-language-fixture.mjs';
// Real component handlers in an offline DOM stand-in. Not a browser/Muse/account acceptance test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountPersonalEntry,personalAuthResult} from '../src/ui/personal-entry.ts';
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.childNodes=[];this.parentNode=null;this.dataset={};this.attrs={};this.value='';this.disabled=false;this._text='';}
 append(...nodes){for(const n of nodes){n.parentNode=this;this.childNodes.push(n);}}
 replaceChildren(...nodes){for(const n of this.childNodes)n.parentNode=null;this.childNodes=[];this._text='';this.append(...nodes);}
 remove(){if(this.parentNode){const xs=this.parentNode.childNodes;xs.splice(xs.indexOf(this),1);this.parentNode=null;}}
 set textContent(t){this.replaceChildren();this._text=String(t);}
 get textContent(){return this._text+this.childNodes.map(n=>n.textContent).join('');}
 setAttribute(k,v){this.attrs[k]=String(v);}
 getAttribute(k){return this.attrs[k]??null;}
}
const tree=(n,p)=>[...(p(n)?[n]:[]),...n.childNodes.flatMap(c=>tree(c,p))];
const action=(host,name)=>tree(host,n=>n.dataset.action===name)[0];
const form=host=>tree(host,n=>n.tagName==='FORM')[0];
const field=(host,name)=>tree(host,n=>n.name===name)[0];
const flush=()=>new Promise(r=>setImmediate(r));
const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(body)});
const PROFILE={actorId:'pm_11111111-1111-4111-8111-111111111111',displayName:'ComBba',appearanceId:'00-jolly',revision:1};
function setup(handler,extra={}){globalThis.document={createElement:t=>new Element(t)};const host=new Element('main'),calls=[],navigation=[];let ids=0;
 const c=mountPersonalEntry(host,{fetcher:async(url,init)=>{calls.push({url,...init});return handler(url,init);},navigate:url=>navigation.push(url),newOperationId:()=>`operation-${++ids}`,now:()=>1000,...extra});
 return{host,c,calls,navigation};}
const me=(authenticated=true)=>response(200,authenticated?{authenticated:true,expiresAt:100000,entry:{state:'viewing'}}:{authenticated:false,entry:{state:'viewing'}});
const profile=(p=PROFILE)=>response(200,{profile:p,entry:{state:p?'registered':'viewing'}});
const submit=async host=>{const f=form(host);assert.ok(f,'profile form exists');assert.equal(typeof f.onsubmit,'function');await f.onsubmit({preventDefault(){}});await flush();};
const click=async(host,name)=>{const b=action(host,name);assert.ok(b,name+' control exists');assert.equal(typeof b.onclick,'function');await b.onclick();await flush();};

test('explicit mount reads only me for a spectator and never starts auth or registers',async()=>{
 const t=setup(()=>me(false));await t.c.ready;
 assert.deepEqual(t.calls.map(x=>[x.url,x.method]),[['/api/personal/me','GET']]);
 assert.equal(t.c.state().phase,'observer');assert.equal(t.c.state().joined,false);
 assert.ok(action(t.host,'login'));assert.match(t.host.textContent,/watch/i);assert.equal(t.navigation.length,0);
});
test('authenticated profile is registered but never joined, and mount only performs two safe GETs',async()=>{
 const t=setup(url=>url.endsWith('/me')?me():profile());await t.c.ready;
 assert.equal(t.calls.length,2);assert.ok(t.calls.every(x=>x.method==='GET'));
 assert.equal(t.c.state().phase,'registered');assert.equal(t.c.state().joined,false);
 assert.match(t.host.textContent,/ComBba/);assert.match(t.host.textContent,/not entered/i);
});


test('sign in requires a button, sends no body and only navigates to the exact Threads endpoint',async()=>{
 const t=setup((url,init)=>url.endsWith('/me')?me(false):response(200,{authorizationUrl:'https://threads.com/oauth/authorize?client_id=public&state=synthetic'}));await t.c.ready;
 await click(t.host,'login');assert.deepEqual(t.calls.map(x=>x.method),['GET','POST']);assert.equal(t.calls[1].body,undefined);
 assert.deepEqual(t.navigation,['https://threads.com/oauth/authorize?client_id=public&state=synthetic']);assert.equal(t.c.state().joined,false);
 assert.ok(!t.host.textContent.includes('client_id'));assert.ok(!t.host.textContent.includes('synthetic'));
});
test('unsafe authorization URLs never navigate or appear in the DOM',async()=>{
 for(const authorizationUrl of ['http://threads.com/oauth/authorize','https://threads.com.evil.invalid/oauth/authorize','https://threads.com@evil.invalid/oauth/authorize','https://threads.com/oauth/authorize/','https://threads.com/oauth/authorize#CANARY','/oauth/authorize','javascript:CANARY']){
  const t=setup(url=>url.endsWith('/me')?me(false):response(200,{authorizationUrl}));await t.c.ready;await click(t.host,'login');assert.deepEqual(t.navigation,[]);assert.equal(t.c.state().phase,'error');assert.ok(!t.host.textContent.includes('CANARY'));
 }
});
for(const failure of ['network','503'])test('failed '+failure+' draft retries the same operation intent, without auto retry',async()=>{
 let attempts=0;const t=setup((url,init)=>{if(init.method==='GET')return url.endsWith('/me')?me():profile(null);attempts++;if(attempts===1){if(failure==='network')throw Error('CANARY_PRIVATE_ERROR');return response(503,{error:'CANARY_PRIVATE_ERROR'});}return profile();});await t.c.ready;
 field(t.host,'displayName').value='ComBba';await submit(t.host);assert.equal(attempts,1);assert.equal(t.c.state().phase,'error');assert.ok(!t.host.textContent.includes('CANARY'));
 await submit(t.host);const posts=t.calls.filter(x=>x.method==='POST');assert.equal(posts.length,2);assert.deepEqual(JSON.parse(posts[0].body),JSON.parse(posts[1].body));assert.equal(t.c.state().phase,'registered');assert.equal(t.c.state().joined,false);
});
test('changed failed draft input gets a new operationId rather than reusing a different intent',async()=>{
 const t=setup((url,init)=>init.method==='GET'?(url.endsWith('/me')?me():profile(null)):response(503,{}));await t.c.ready;
 field(t.host,'displayName').value='First';await submit(t.host);field(t.host,'displayName').value='Second';await submit(t.host);
 const writes=t.calls.filter(x=>x.method==='POST').map(x=>JSON.parse(x.body));assert.notEqual(writes[0].operationId,writes[1].operationId);assert.equal(writes[1].displayName,'Second');
});
test('same-tick duplicate form callbacks start only one request while busy',async()=>{
 let resolve;const held=new Promise(r=>resolve=r);const t=setup((url,init)=>init.method==='GET'?(url.endsWith('/me')?me():profile(null)):held);await t.c.ready;field(t.host,'displayName').value='ComBba';const f=form(t.host);assert.ok(f);
 const one=f.onsubmit({preventDefault(){}}),two=f.onsubmit({preventDefault(){}});await flush();assert.equal(t.calls.filter(x=>x.method==='POST').length,1);
 resolve(profile());await Promise.all([one,two]);assert.equal(t.c.state().phase,'registered');
});
test('same-tick sign-in callbacks and successful navigation do not start duplicate auth',async()=>{
 let resolve;const held=new Promise(r=>resolve=r);const t=setup(url=>url.endsWith('/me')?me(false):held);await t.c.ready;const b=action(t.host,'login');assert.ok(b);
 const one=b.onclick(),two=b.onclick();await flush();assert.equal(t.calls.filter(x=>x.method==='POST').length,1);resolve(response(200,{authorizationUrl:'https://threads.com/oauth/authorize?state=synthetic'}));await Promise.all([one,two]);await b.onclick();assert.equal(t.calls.filter(x=>x.method==='POST').length,1);
});
test('client rejects invalid names and noncatalog appearance before any write',async()=>{
 const t=setup(url=>url.endsWith('/me')?me():profile(null));await t.c.ready;
 for(const name of ['', 'x'.repeat(41),'hi\u202e']){field(t.host,'displayName').value=name;await submit(t.host);assert.equal(t.calls.filter(x=>x.method!=='GET').length,0);}
 field(t.host,'displayName').value='Valid';field(t.host,'appearanceId').value='foreign-asset';await submit(t.host);assert.equal(t.calls.filter(x=>x.method!=='GET').length,0);
});
test('profile update uses expectedRevision and rejects stale or foreign response profiles',async()=>{
 for(const changed of [{actorId:'pm_22222222-2222-4222-8222-222222222222',revision:2},{revision:1}]){
  const t=setup((url,init)=>init.method==='GET'?(url.endsWith('/me')?me():profile()):profile({...PROFILE,displayName:'Edited',...changed}));await t.c.ready;field(t.host,'displayName').value='Edited';await submit(t.host);
  const req=t.calls.find(x=>x.method==='PATCH');assert.equal(JSON.parse(req.body).expectedRevision,1);assert.equal(t.c.state().phase,'error');assert.notEqual(t.c.state().profile?.actorId,'pm_22222222-2222-4222-8222-222222222222');
 }
});
test('successful update keeps the same actor and renders public markup as literal text',async()=>{
 const name='<b>My Muse</b>';const t=setup((url,init)=>init.method==='GET'?(url.endsWith('/me')?me():profile()):profile({...PROFILE,displayName:name,revision:2}));await t.c.ready;field(t.host,'displayName').value=name;await submit(t.host);
 assert.equal(t.c.state().profile.actorId,PROFILE.actorId);assert.equal(t.c.state().profile.revision,2);assert.match(t.host.textContent,/<b>My Muse<\/b>/);assert.equal(tree(t.host,n=>n.tagName==='B').length,0);assert.equal(t.c.state().joined,false);
});
test('untrusted profile shapes are never rendered as registered or leaked into DOM',async()=>{
 for(const p of [{...PROFILE,rootRef:'CANARY_SECRET'},{...PROFILE,appearanceId:'not-catalog'},{...PROFILE,revision:0},{...PROFILE,revision:1.5},{...PROFILE,actorId:''},{...PROFILE,displayName:'x'.repeat(41)}]){
  const t=setup(url=>url.endsWith('/me')?me():profile(p));await t.c.ready;assert.equal(t.c.state().phase,'error');assert.equal(t.c.state().profile,null);assert.ok(!t.host.textContent.includes('CANARY'));assert.equal(t.c.state().joined,false);
 }
});
test('joined or inconsistent entry data is rejected rather than promoted',async()=>{
 for(const body of [{profile:PROFILE,entry:{state:'joined'}},{profile:null,entry:{state:'registered'}},{profile:PROFILE,entry:{state:'viewing'}}]){
  const t=setup(url=>url.endsWith('/me')?me():response(200,body));await t.c.ready;assert.equal(t.c.state().phase,'error');assert.equal(t.c.state().joined,false);
 }
});
test('failed me lookup makes no profile read and exposes only a fixed retry message',async()=>{
 const t=setup(()=>{throw Error('CANARY_TOKEN_AND_STACK');});await t.c.ready;assert.equal(t.calls.length,1);assert.equal(t.c.state().phase,'error');assert.equal(t.c.state().profile,null);assert.ok(!t.host.textContent.includes('CANARY'));assert.ok(action(t.host,'refresh'));
});
test('401 on a profile read or write clears previous ownership and editable data',async()=>{
 let fail=false;const t=setup((url,init)=>url.endsWith('/me')?me():fail?response(401,{error:'CANARY'}):profile());await t.c.ready;fail=true;field(t.host,'displayName').value='Edited';await submit(t.host);
 assert.equal(t.c.state().phase,'observer');assert.equal(t.c.state().profile,null);assert.equal(form(t.host),undefined);assert.ok(!t.host.textContent.includes('ComBba'));
});
test('refresh refuses a different actor in a still-authenticated component',async()=>{
 let second=false;const t=setup(url=>url.endsWith('/me')?me():profile(second?{...PROFILE,actorId:'pm_22222222-2222-4222-8222-222222222222',displayName:'CANARY_FOREIGN'}:PROFILE));await t.c.ready;second=true;await t.c.refresh();assert.equal(t.c.state().phase,'error');assert.equal(t.c.state().profile,null);assert.ok(!t.host.textContent.includes('CANARY_FOREIGN'));
});
test('explicit logout is one bodyless same-origin DELETE and clears profile',async()=>{
 const t=setup((url,init)=>init.method==='DELETE'?me(false):url.endsWith('/me')?me():profile());await t.c.ready;await click(t.host,'logout');const req=t.calls.find(x=>x.method==='DELETE');assert.equal(req.url,'/api/personal/session');assert.equal(req.body,undefined);assert.equal(t.c.state().phase,'observer');assert.equal(t.c.state().profile,null);assert.ok(!t.host.textContent.includes('ComBba'));
});
test('a late profile after signed-out refresh cannot restore an old session',async()=>{
 let resolve,signedOut=false;const held=new Promise(r=>resolve=r);const t=setup(url=>url.endsWith('/me')?me(!signedOut):held);await flush();signedOut=true;await t.c.refresh();resolve(profile());await t.c.ready;assert.equal(t.c.state().phase,'observer');assert.equal(t.c.state().profile,null);
});
test('a late write cannot restore a profile after signed-out refresh or dispose',async()=>{
 for(const dispose of [false,true]){let resolve,signedOut=false;const held=new Promise(r=>resolve=r);const t=setup((url,init)=>init.method!=='GET'?held:url.endsWith('/me')?me(!signedOut):profile(null));await t.c.ready;field(t.host,'displayName').value='ComBba';const pending=submit(t.host);await flush();
  if(dispose)t.c.dispose();else{signedOut=true;await t.c.refresh();}resolve(profile());await pending;assert.equal(t.c.state().profile,null);assert.equal(t.c.state().joined,false);if(dispose)assert.equal(t.host.childNodes.length,0);
 }
});
test('an expired session cannot submit and all requests use same-origin no-store redirect-error',async()=>{
 let now=1000;const t=setup(url=>url.endsWith('/me')?me():profile(null),{now:()=>now});await t.c.ready;now=100001;field(t.host,'displayName').value='ComBba';await submit(t.host);assert.equal(t.calls.filter(x=>x.method!=='GET').length,0);assert.equal(t.c.state().profile,null);
 for(const q of t.calls){assert.equal(q.credentials,'same-origin');assert.equal(q.mode,'same-origin');assert.equal(q.cache,'no-store');assert.equal(q.redirect,'error');}
});

test('pending logout blocks refresh authentication until its result settles; failed logout permits a deliberate recheck',async()=>{
 let reject;const held=new Promise((_r,j)=>reject=j);const t=setup((url,init)=>init.method==='DELETE'?held:url.endsWith('/me')?me():profile());await t.c.ready;
 const old=action(t.host,'logout').onclick();await flush();const reads=t.calls.filter(x=>x.method==='GET').length;await t.c.refresh();
 assert.equal(t.calls.filter(x=>x.method==='GET').length,reads);assert.equal(t.c.state().authenticated,null);assert.equal(form(t.host),undefined);assert.equal(action(t.host,'refresh').disabled,true);
 reject(Error('old logout failed'));await old;assert.equal(t.c.state().phase,'error');assert.equal(t.c.state().authenticated,null);assert.equal(form(t.host),undefined);assert.equal(action(t.host,'refresh').disabled,false);
 await t.c.refresh();assert.equal(t.c.state().phase,'registered');assert.equal(t.c.state().profile.actorId,PROFILE.actorId);
});
test('a missing profile after a bound actor cannot silently enable a different registration',async()=>{
 let missing=false;const t=setup(url=>url.endsWith('/me')?me():profile(missing?null:PROFILE));await t.c.ready;missing=true;await t.c.refresh();
 assert.equal(t.c.state().phase,'error');assert.equal(form(t.host),undefined);
});
test('an idempotent draft retry renders the server current profile without reverting a later edit',async()=>{
 let n=0;const updated={...PROFILE,displayName:'Current public name',revision:2};
 const t=setup((url,init)=>{if(init.method==='GET')return url.endsWith('/me')?me():profile(null);if(++n===1)throw Error('response lost');return profile(updated);});await t.c.ready;
 field(t.host,'displayName').value='ComBba';await submit(t.host);await submit(t.host);
 assert.equal(t.c.state().phase,'registered');assert.equal(t.c.state().profile.displayName,'Current public name');assert.equal(t.c.state().profile.revision,2);
 const writes=t.calls.filter(x=>x.method==='POST').map(x=>JSON.parse(x.body));assert.deepEqual(writes[0],writes[1]);assert.equal(t.calls.some(x=>x.method==='PATCH'),false);
});

test('pending sign-in keeps a manual read-only refresh available when navigation is cancelled or returns',async()=>{
 let signedIn=false;const t=setup((url,init)=>init.method==='POST'?response(200,{authorizationUrl:'https://threads.com/oauth/authorize?state=synthetic'}):url.endsWith('/me')?me(signedIn):profile());await t.c.ready;await click(t.host,'login');
 assert.equal(action(t.host,'refresh').disabled,false);signedIn=true;await click(t.host,'refresh');assert.equal(t.c.state().phase,'registered');assert.equal(t.c.state().joined,false);
});
test('operation intent creation failure is contained and sends no write or raw exception',async()=>{
 const t=setup(url=>url.endsWith('/me')?me():profile(null),{newOperationId:()=>{throw Error('CANARY_PRIVATE_FACTORY');}});await t.c.ready;field(t.host,'displayName').value='ComBba';
 await assert.doesNotReject(()=>submit(t.host));assert.equal(t.c.state().phase,'error');assert.equal(t.calls.some(x=>x.method!=='GET'),false);assert.ok(!t.host.textContent.includes('CANARY'));
});

test('an unconfirmed draft operation survives a read-only refresh before retrying the same intent',async()=>{
 let attempts=0;const t=setup((url,init)=>{if(init.method==='GET')return url.endsWith('/me')?me():profile(null);if(++attempts===1)throw Error('response lost');return profile();});await t.c.ready;
 field(t.host,'displayName').value='ComBba';await submit(t.host);await t.c.refresh();field(t.host,'displayName').value='ComBba';await submit(t.host);
 const writes=t.calls.filter(x=>x.method==='POST').map(x=>JSON.parse(x.body));assert.deepEqual(writes[0],writes[1]);assert.equal(t.c.state().phase,'registered');
});
test('a connection write barrier blocks profile refresh, save and logout until it settles',async()=>{
 const t=setup(url=>url.endsWith('/me')?me():profile());await t.c.ready;const reads=t.calls.length;t.c.setExternalBusy(true);await t.c.refresh();await action(t.host,'logout').onclick();await form(t.host).onsubmit({preventDefault(){}});assert.equal(t.calls.length,reads);assert.equal(action(t.host,'refresh').disabled,true);t.c.setExternalBusy(false);await t.c.refresh();assert.equal(t.calls.length,reads+2);t.c.dispose();
});
test('profile lifecycle publishes safe snapshots for connection fencing without changing registration into entry',async()=>{
 const states=[],t=setup(url=>url.endsWith('/me')?me():profile(),{onState:s=>states.push(s)});await t.c.ready;assert.ok(states.some(s=>s.authenticated===true&&s.profile?.actorId===PROFILE.actorId));assert.ok(states.every(s=>s.joined===false));t.c.dispose();assert.equal(states.at(-1).authenticated,false);assert.equal(states.at(-1).profile,null);
});

test('failed login return stays visible after profile reads, gives a next step and never retries automatically',async()=>{
 const t=setup(()=>me(false),{authResult:'failed'});await t.c.ready;
 assert.match(t.host.textContent,/연결을 마치지 못|could not finish/i);assert.match(t.host.textContent,/잠시 뒤|later/i);
 assert.deepEqual(t.calls.map(x=>x.method),['GET']);assert.equal(t.navigation.length,0);assert.ok(action(t.host,'login'));t.c.dispose();
});

test('signed-out door names the immediate Threads step and the next steps in both browser languages',async()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');try{for(const language of['en-US','ko-KR']){Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language}});const f=setup(()=>me(false));await f.c.ready;const heading=tree(f.host,n=>n.tagName==='H2')[0].textContent;assert.equal(heading,language.startsWith('ko')?'1 · Threads로 로그인':'1 · Sign in with Threads');assert.match(f.host.textContent,language.startsWith('ko')?/로그인 → 이름과 모습 선택 → 내 Muse가 세계에 입장/:/Sign in → pick a name and look → your Muse joins the world/);assert.equal(form(f.host),undefined);f.c.dispose();}}finally{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});

for(const language of ['en-US','ko-KR'])test(language+' invited beta notice precedes sign-in and error return uses fixed text plus watch',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');try{Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language}});
 const raw='PRIVATE_PROVIDER_ERROR_SENTINEL';for(const query of ['error='+raw,'error_reason='+raw,'personal=declined','personal=failed']){let watched=0;const f=setup(()=>me(false),{authResult:personalAuthResult(new URLSearchParams(query)),onWatch:()=>watched++});await f.c.ready;
 assert.match(f.host.textContent,language.startsWith('ko')?/베타: 초대받은 분만 로그인할 수 있어요. 관람은 누구나 바로 할 수 있어요./:/Beta: sign-in is open to invited testers. Watching is open to everyone./);assert.ok(f.host.textContent.indexOf(language.startsWith('ko')?'베타:':'Beta:')<f.host.textContent.lastIndexOf(language.startsWith('ko')?'Threads로 로그인':'Sign in with Threads'));assert.equal(f.host.textContent.includes(raw),false);assert.ok(tree(f.host,n=>n.attrs.role==='alert').length);await click(f.host,'watch');assert.equal(watched,1);assert.equal(f.navigation.length,0);assert.ok(f.calls.every(x=>x.method==='GET'));f.c.dispose();}
 assert.equal(personalAuthResult(new URLSearchParams('personal=authenticated')),'authenticated');assert.equal(personalAuthResult(new URLSearchParams('personal='+raw)),undefined);
 }finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;}
});
