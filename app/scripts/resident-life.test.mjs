import test from 'node:test';
import assert from 'node:assert/strict';
import {createLife,restoreLife,saveLife,remember,recordPromise,proposeLifeTurn,noteServed,isCurrentLifeProposal} from '../src/engine/resident-life.ts';
import {HARNESSES} from '../src/engine/harness.ts';
const make=(n=8)=>createLife([{id:'reader',defaultGoal:'Find a story',home:'commons:bookshelf'}],Array.from({length:n},(_,i)=>({id:`resident-${i}`,roleId:'reader'})));
const input=s=>({now:100,hour:12,worldVersion:7,residentTurnAllowed:true,promiseLeadMs:100,allowedPlaceIds:['commons:bookshelf','commons:campfire'],authorities:s.residents.map(r=>({id:r.id,connected:false,paused:false}))});
const memory={id:'e1',kind:'declared',at:10,subject:'neighbor',publicSummary:'Asked for a book',source:'rule',evidenceId:'event:1'};
test('current harnesses map to role templates, without changing actor contracts',()=>{
const s=createLife(HARNESSES.map(h=>({id:h.id,defaultGoal:h.wants.goal,home:'commons:bookshelf'})),HARNESSES.map(h=>({id:h.id,roleId:h.id})));
assert.deepEqual(s.residents.map(r=>r.id),HARNESSES.map(h=>h.id));assert.equal(s.residents.length,10);
});
test('roles permit multiple distinct instances',()=>{const s=make();assert.equal(s.residents.length,8);assert.equal(new Set(s.residents.map(r=>r.roleId)).size,1);});
test('restart preserves memories, promises, routine, cursor metrics',()=>{
let s=remember(make(),'resident-0',memory);s=recordPromise(s,'resident-0',{id:'p',other:'neighbor',place:'commons:campfire',dueAt:200,status:'pending',evidenceId:'e2'});s=noteServed(s,'resident-0',20);
const restored=restoreLife(saveLife(s));assert.deepEqual(restored,s);assert.equal(restored.residents[0].promises[0].status,'pending');
});
test('memory deduplicates; conflicting evidence rejected',()=>{const s=remember(make(),'resident-0',memory);assert.deepEqual(remember(s,'resident-0',memory),s);assert.throws(()=>remember(s,'resident-0',{...memory,source:'live'}));});
test('memory keeps declared and inferred separate',()=>{const s=remember(remember(make(),'resident-0',memory),'resident-0',{...memory,id:'e2',kind:'inferred'});assert.deepEqual(s.residents[0].memories.map(m=>m.kind),['declared','inferred']);});
test('unknown actor is not added',()=>assert.throws(()=>remember(make(),'unknown',memory)));
test('bounded memories; promises never silently evicted',()=>{let s=make();for(let i=0;i<70;i++)s=remember(s,'resident-0',{...memory,id:`e${i}`});assert.equal(s.residents[0].memories.length,64);
for(let i=0;i<32;i++)s=recordPromise(s,'resident-0',{id:`p${i}`,other:'neighbor',place:'commons:campfire',dueAt:200,status:'pending',evidenceId:`e${i}`});assert.throws(()=>recordPromise(s,'resident-0',{id:'overflow',other:'n',place:'x',dueAt:200,status:'pending',evidenceId:'e'}));});
test('snapshot strips unknown private fields',()=>{const s=make();s.residents[0].privateReason='secret';s.residents[0].routine[0].secret='x';assert.equal(JSON.stringify(restoreLife(JSON.stringify(s))).includes('secret'),false);});
test('malformed and future schema fail closed',()=>{assert.throws(()=>restoreLife('{'));assert.throws(()=>restoreLife('{"schema":2,"residents":[]}'));const s=make();s.residents[0].served=-1;assert.throws(()=>restoreLife(JSON.stringify(s)));});
test('duplicate IDs and unknown role fail closed',()=>{assert.throws(()=>createLife([{id:'r',defaultGoal:'g',home:'p'}],[{id:'a',roleId:'r'},{id:'a',roleId:'r'}]));assert.throws(()=>createLife([], [{id:'a',roleId:'x'}]));});
test('connected and paused residents never receive proposal',()=>{const s=make();const i=input(s);i.authorities[0].connected=true;i.authorities[1].paused=true;assert.equal(proposeLifeTurn(s,i).residentId,'resident-2');});
test('missing actor, duplicate authority, denied budget fail closed',()=>{const s=make();assert.equal(proposeLifeTurn(s,{...input(s),authorities:[]}),null);assert.equal(proposeLifeTurn(s,{...input(s),residentTurnAllowed:false}),null);assert.throws(()=>proposeLifeTurn(s,{...input(s),authorities:[input(s).authorities[0],input(s).authorities[0]]}));});
test('allowed places govern routine and promises',()=>{let s=make(1);assert.equal(proposeLifeTurn(s,{...input(s),allowedPlaceIds:[]}),null);s=recordPromise(s,'resident-0',{id:'p',other:'n',place:'private:roof',dueAt:200,status:'pending',evidenceId:'e'});assert.equal(proposeLifeTurn(s,input(s)).placeId,'commons:bookshelf');});
test('promise supplies intent only; expiry falls back to routine',()=>{const s=recordPromise(make(1),'resident-0',{id:'p',other:'n',place:'commons:campfire',dueAt:200,status:'pending',evidenceId:'e'});const before=saveLife(s);assert.equal(proposeLifeTurn(s,input(s)).reason,'promise');assert.equal(proposeLifeTurn(s,{...input(s),now:201}).reason,'routine');assert.equal(saveLife(s),before);});
test('24 residents receive equal turns in controlled offline schedule',()=>{let s=make(24);const counts={};for(let i=0;i<240;i++){const p=proposeLifeTurn(s,{...input(s),now:i+100});counts[p.residentId]=(counts[p.residentId]??0)+1;s=noteServed(s,p.residentId,i+100);if(i===100)s=restoreLife(saveLife(s));}assert.equal(Object.keys(counts).length,24);assert.deepEqual([...new Set(Object.values(counts))],[10]);});
test('invalid clock and time reversal rejected',()=>{const s=make();assert.throws(()=>proposeLifeTurn(s,{...input(s),now:NaN}));assert.throws(()=>noteServed(noteServed(s,'resident-0',100),'resident-0',99));});
test('promise closure requires executed evidence, survives restart and rejects overwrite',async()=>{
 const {closePromise}=await import('../src/engine/resident-life.ts');
 let s=recordPromise(make(1),'resident-0',{id:'p',other:'n',place:'commons:campfire',dueAt:200,status:'pending',evidenceId:'agreement'});
 assert.throws(()=>closePromise(s,'resident-0','p','fulfilled',memory));
 const receipt={...memory,id:'receipt',kind:'executed',evidenceId:'server:result'};
 s=closePromise(s,'resident-0','p','fulfilled',receipt);
 assert.equal(restoreLife(saveLife(s)).residents[0].promises[0].status,'fulfilled');
 assert.deepEqual(closePromise(s,'resident-0','p','fulfilled',receipt),s);
 assert.throws(()=>closePromise(s,'resident-0','p','cancelled',receipt));
});

test('future promises do not displace routine outside explicit planning horizon',()=>{
 const s=recordPromise(make(1),'resident-0',{id:'p',other:'n',place:'commons:campfire',dueAt:10_000,status:'pending',evidenceId:'e'});
 assert.equal(proposeLifeTurn(s,input(s)).reason,'routine');
 assert.equal(proposeLifeTurn(s,{...input(s),promiseLeadMs:undefined}).reason,'routine');
 assert.equal(proposeLifeTurn(s,{...input(s),now:10_000,promiseLeadMs:0}).reason,'promise');
 for(const promiseLeadMs of [-1,NaN,Infinity,86_400_001]) assert.throws(()=>proposeLifeTurn(s,{...input(s),promiseLeadMs}));
});
test('queued proposal rejects changed version, authority, budget and places',()=>{
 const s=make(1),i=input(s),p=proposeLifeTurn(s,i);
 assert.equal(isCurrentLifeProposal(s,p,i),true);
 assert.equal(isCurrentLifeProposal(s,p,{...i,worldVersion:8}),false);
 assert.equal(isCurrentLifeProposal(s,p,{...i,authorities:[{id:p.residentId,connected:true,paused:false}]}),false);
 assert.equal(isCurrentLifeProposal(s,p,{...i,authorities:[]}),false);
 assert.equal(isCurrentLifeProposal(s,p,{...i,residentTurnAllowed:false}),false);
 assert.equal(isCurrentLifeProposal(s,p,{...i,allowedPlaceIds:[]}),false);
 assert.equal(isCurrentLifeProposal(s,{...p,source:'live'},i),false);
});
test('queued promise proposal expires without claiming execution',()=>{
 const s=recordPromise(make(1),'resident-0',{id:'p',other:'n',place:'commons:campfire',dueAt:200,status:'pending',evidenceId:'e'});
 const p=proposeLifeTurn(s,input(s));
 assert.equal(isCurrentLifeProposal(s,p,{...input(s),now:201}),false);
 assert.equal(s.residents[0].promises[0].status,'pending');
});
test('malformed truthy scheduler authorization is denied',()=>{
 const s=make();for(const residentTurnAllowed of [1,'yes',{},null,undefined]) assert.equal(proposeLifeTurn(s,{...input(s),residentTurnAllowed}),null);
});

test('idempotent retries do not depend on JSON property order',()=>{
 const reversed=Object.fromEntries(Object.entries(memory).reverse());
 const s=remember(make(),'resident-0',memory);assert.deepEqual(remember(s,'resident-0',reversed),s);
 const p={id:'p',other:'n',place:'commons:campfire',dueAt:200,status:'pending',evidenceId:'e'};
 const withPromise=recordPromise(s,'resident-0',p);assert.deepEqual(recordPromise(withPromise,'resident-0',Object.fromEntries(Object.entries(p).reverse())),withPromise);
});
