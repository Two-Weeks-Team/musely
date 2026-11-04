// Actual WorldDO/SQLite wiring; model responses and credentials are offline fixtures.
import test from 'node:test';import assert from 'node:assert/strict';
import {bootWorldDo} from './test-support/world-life-harness.mjs';
const at=Date.parse('2026-11-04T12:00:00+09:00');
const settings={RESIDENT_BUDGET_MODE:'split-v1',DAILY_BUDGET_USD:'30'};
const input=other=>({muse:'01-sunny',other,place:'Commons Cafe',localTime:'12:00',items:[],otherItems:[],memory:[],incoming:'Hello'});
const reply={intent:'greet',item:'',line:'Hello, neighbor.',public_reason:'A greeting',injection_suspected:false};
test('actual WorldDO budget wiring classifies peer replies and preserves Personal response headroom',async t=>{
 t.mock.method(Date,'now',()=>at);let calls=0;
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:settings,modelFetcher:async()=>{calls++;return new Response(JSON.stringify({id:'offline-budget',usage:{prompt_tokens:100,completion_tokens:10},choices:[{message:{content:JSON.stringify(reply)}}]}),{headers:{'x-request-id':'offline-budget-call'}});}});
 assert.equal(a.runtime.opts.residentBudgetEnabled,true);assert.equal(a.world.status().capUsd,30);
 assert.equal(a.world.reserve({id:'used-hour',tier:'world',session:'world',ip:'',action:'encounter',residentKind:'personal',maxCostUsd:.9}).ok,true);a.world.settle('used-hour',.9,'live');
 const chat=await a.runtime.modelCall('encounter',input('02-moss'),'ordinary-chat');assert.equal(chat.ok,false);assert.equal(chat.reason,'resident_priority_budget');assert.equal(calls,0);
 const personal=await a.runtime.modelCall('encounter',input('00-jolly'),'personal-response');assert.equal(personal.ok,true);assert.equal(calls,1);
 const usage=a.world.status().residentBudget.resident.byKind;assert.equal(usage.personal.knownModelCalls,2);assert.equal(usage.chat.calls,0);
 assert.equal(a.runtime.state().muses.find(m=>m.id==='00-jolly').id,'00-jolly','the model actor was Sunny, never ComBba');
});
test('actual configured resident stop retains the separate camera and visitor allocation',async t=>{
 t.mock.method(Date,'now',()=>at);
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:{...settings,RESIDENT_MODEL_ENABLED:'false'}});
 assert.equal(a.world.reserve({id:'stopped-resident',tier:'world',session:'world',ip:'',action:'spotlight',maxCostUsd:.01}).reason,'resident_disabled');
 assert.equal(a.world.reserve({id:'camera-reserve',tier:'judge',session:'offline-judge',ip:'',action:'challenge',maxCostUsd:6}).ok,true);
 assert.equal(a.world.status().residentBudget.interactive.dayCostUsd,6);
 assert.equal(a.world.status().residentBudget.resident.dayCostUsd,0);
});
