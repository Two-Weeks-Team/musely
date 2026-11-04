// Real WorldDO + SQLite, synthetic sessions/model transport only. No real keys or provider calls.
import test from 'node:test';import assert from 'node:assert/strict';
import {bootWorldDo} from './test-support/world-life-harness.mjs';
const ON={SOCIAL_STATUS_MODE:'public-v1',RESIDENT_BUDGET_MODE:'split-v1',DAILY_BUDGET_USD:'30',RESIDENT_ACTIONS_MODE:'action-v1',RESIDENT_VALUES_MODE:'confirmed-v1'};
test('confirmed resident values install the same server-only flag in runtime, RULE hooks, private preferences and public labels',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:ON});assert.equal(a.runtime.opts.residentValuesEnabled,true);assert.equal(a.runtime.opts.hooks.residentValuesEnabled,true);
 const at=Date.parse('2026-11-04T16:00:00Z');t.mock.method(Date,'now',()=>at);a.edit(s=>{const m=s.muses.find(m=>m.id==='01-sunny');m.travel=null;m.beat=null;});
 const state=a.runtime.state();assert.equal(a.runtime.opts.socialStatus(state,'01-sunny',at),'welcoming');assert.deepEqual(a.world.worldView().muses.find(m=>m.id==='01-sunny').availability,{status:'welcoming'});
 const before=JSON.stringify(a.runtime.state());a.world.worldView();assert.equal(JSON.stringify(a.runtime.state()),before,'public values projection must not store schedule or preference labels');
});
test('absent or off values retain the legacy runtime and RULE options and do not enable reflection',async t=>{
 for(const mode of [undefined,'off']){const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:{SOCIAL_STATUS_MODE:'public-v1',...(mode?{RESIDENT_VALUES_MODE:mode}:{})}});assert.notEqual(a.runtime.opts.residentValuesEnabled,true);assert.notEqual(a.runtime.opts.hooks.residentValuesEnabled,true);assert.notEqual(a.runtime.opts.residentReflection?.enabled,true);}
});
test('unknown resident values configuration fails closed before a scheduler starts',async t=>{
 await assert.rejects(bootWorldDo(t,{mode:'sandbox-v1',envOverrides:{...ON,RESIDENT_VALUES_MODE:'browser-on'}}),/unsupported_RESIDENT_VALUES_MODE/);
});
test('actual model request receives the confirmed individual persona only with the trusted flag',async t=>{
 const packets=[];const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:ON,modelFetcher:async(_url,init)=>{packets.push(JSON.parse(init.body));return new Response(JSON.stringify({id:'fixture-confirmed-values',usage:{prompt_tokens:10,completion_tokens:10},choices:[{message:{content:JSON.stringify({freedom:'where',decision:'rest',target_place:'Commons Cafe',target_agent:'',offer_item:'',want_item:'',line:'',public_reason:'Rest for a while',duration_minutes:15})}}]}),{headers:{'x-request-id':'fixture-confirmed-values'}});}});
 a.edit(s=>{for(const m of s.muses){if(m.id==='nr_olive'){m.travel=null;m.beat=null;}else(s.paused??={})[m.id]={at:Date.now(),version:1,by:'fixture'};}});await a.runtime.heartbeat(Date.now()+60000);
 const activity=packets.find(p=>p.response_format?.json_schema?.name==='resident_next_activity');assert(activity,'eligible resident gets an activity choice');const text=JSON.stringify(activity.messages);assert.match(text,/ENFP/);assert(text.includes('낯선 이들을 즉흥으로 엮어 주는 호스트'));assert(text.includes('들뜨고 빠른 말투'));
});
