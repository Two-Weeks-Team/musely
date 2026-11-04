// Actual WorldDO/SQLite, fixture transport and sessions. No external provider/account calls.
import test from 'node:test';import assert from 'node:assert/strict';
import {bootWorldDo} from './test-support/world-life-harness.mjs';
import {ResidentLifeStore} from '../worker/core/resident-life-adapter.ts';
const ON={SOCIAL_STATUS_MODE:'public-v1',RESIDENT_BUDGET_MODE:'split-v1',DAILY_BUDGET_USD:'30',RESIDENT_ACTIONS_MODE:'action-v1',RESIDENT_VALUES_MODE:'confirmed-v1',RESIDENT_REFLECTION_MODE:'private-v1'};
test('private reflection installs the reviewed confirmed persona only behind all required server flags',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:ON});assert.equal(a.runtime.opts.residentReflection?.enabled,true);assert.match(a.runtime.opts.residentReflection.persona('nr_olive'),/ENFP/);assert(a.runtime.opts.residentReflection.persona('nr_olive').includes('낯선 이들을 즉흥으로 엮어 주는 호스트'));assert.equal(a.runtime.opts.residentReflection.persona('00-jolly'),'');assert.equal(a.runtime.opts.residentReflection.persona('pm_unknown'),'');
});
test('reflection OFF keeps private extension fields absent after a genuine signed MCP public greeting',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:{...ON,RESIDENT_REFLECTION_MODE:'off'}});assert.equal(a.runtime.opts.residentReflection,undefined);a.prepare();const r=await a.call('owner','greet',{to:'01-sunny',text:'A public hello',command_id:'reflection-off-installed'});assert.equal(r.body.result.isError,false);const life=new ResidentLifeStore(a.sql).load(a.runtime.worldId);assert(life.state.residents.every(r=>r.relationships===undefined&&r.reflection===undefined));
});
test('unknown reflection or missing confirmed values/actions fails closed at installation',async t=>{
 for(const x of[{RESIDENT_REFLECTION_MODE:'true'},{RESIDENT_VALUES_MODE:'off'},{RESIDENT_ACTIONS_MODE:'off'},{RESIDENT_BUDGET_MODE:'off'}])await assert.rejects(bootWorldDo(t,{mode:'sandbox-v1',envOverrides:{...ON,...x}}),/unsupported_RESIDENT_REFLECTION_MODE|reflection_require|resident_actions_require/);
});
test('installed private reflection consumes the shared ledger and cannot appear in public world, life or recordings',async t=>{
 let reflectionCalls=0;const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:ON,modelFetcher:async(_url,init)=>{const b=JSON.parse(init.body);assert.equal(b.response_format.json_schema.name,'resident_reflection');reflectionCalls++;const plan=JSON.parse(b.messages[1].content.split('>')[1].split('<')[0]),r=plan.relationships[0];return new Response(JSON.stringify({id:'fixture-private-reflection',choices:[{message:{content:JSON.stringify({relationships:[{other:r.other,relationship:'acquaintance',summary:'PRIVATE_NPC_SUMMARY_CANARY',feeling:'PRIVATE_NPC_FEELING_CANARY',evidenceIds:[r.facts[0].eventId]}]})}}],usage:{prompt_tokens:10,completion_tokens:10}}));}});
 a.prepare();a.edit(s=>{for(const m of s.muses){m.intent=null;m.beat={id:'resident_stay',clip:'idle_breathe',startedAt:Date.now(),endsAt:Date.now()+3600000,line:null};if(!['00-jolly','01-sunny'].includes(m.id))(s.paused??={})[m.id]={at:Date.now(),version:1,by:'fixture'};}});
 const hi=await a.call('owner','greet',{to:'01-sunny',text:'A public hello',command_id:'reflection-installed-greeting'});assert.equal(hi.body.result.isError,false);await a.runtime.heartbeat(Date.now()+60000);assert.equal(reflectionCalls,1);const life=new ResidentLifeStore(a.sql).load(a.runtime.worldId);assert.equal(life.state.residents.find(r=>r.id==='01-sunny').reflection.outcome,'live');assert.equal(a.world.status().residentBudget.resident.byKind.reflection.knownModelCalls,1);
 for(const x of[a.world.worldView(),a.world.worldLifeView(),a.runtime.runLog.lastInput()])assert.doesNotMatch(JSON.stringify(x),/PRIVATE_NPC_SUMMARY_CANARY|PRIVATE_NPC_FEELING_CANARY/);
});
