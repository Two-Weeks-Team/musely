import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evidenceIds} from '../worker/core/run-log.ts';
import {bootWorldDo} from './test-support/world-life-harness.mjs';
import {spotlightInput} from '../src/engine/world.ts';
import {validate} from '../worker/core/actions.ts';

test('recorded provider usage keeps only two measured integer counts and a host mode enum',()=>{
 const out=evidenceIds({requestId:'usage-request',providerUsage:{inputTokens:321,outputTokens:42,rawPrompt:'PRIVATE_USAGE_CANARY'},perceptionMode:'local-v1',rawResponse:'PRIVATE_USAGE_CANARY'});
 assert.deepEqual(out.providerUsage,{inputTokens:321,outputTokens:42});
 assert.equal(out.perceptionMode,'local-v1');
 assert.doesNotMatch(JSON.stringify(out),/PRIVATE_USAGE_CANARY/);
});
test('missing or malformed token counts remain unmeasured and cannot carry strings or arbitrary modes',()=>{
 for(const inputTokens of[undefined,'321',-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1]){
  const out=evidenceIds({providerUsage:{inputTokens,outputTokens:42},perceptionMode:'PRIVATE_USAGE_CANARY'});
  assert.equal(out.providerUsage,undefined);assert.equal(out.perceptionMode,undefined);
 }
});
test('installed NPC calls attribute real provider usage to the actual OFF or local input path',async t=>{
 for(const mode of['off','local-v1']){
  const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:{LOCAL_PERCEPTION_MODE:mode},modelFetcher:async()=>new Response(JSON.stringify({id:'usage-response',usage:{prompt_tokens:321,completion_tokens:42,extra:'PRIVATE_USAGE_CANARY'},choices:[{message:{content:JSON.stringify({freedom:'where',decision:'rest',target_place:'Commons Cafe',target_agent:'',offer_item:'',want_item:'',public_reason:'A pause',line:''})}}]}))});
  a.edit(s=>{const m=s.muses.find(m=>m.id==='01-sunny');m.place='commons:cafe';m.travel=null;m.beat=null;m.intent=null;});
  const now=Date.now(),input=validate('spotlight',spotlightInput(a.runtime.state(),'01-sunny','where',now));
  const result=await a.runtime.modelCall('spotlight',input,'usage-fixture-'+mode);
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(result.evidence.providerUsage,{inputTokens:321,outputTokens:42});
  assert.equal(result.evidence.perceptionMode,mode);
  assert.deepEqual(evidenceIds(result.evidence).providerUsage,{inputTokens:321,outputTokens:42});
  assert.doesNotMatch(JSON.stringify(result.evidence),/PRIVATE_USAGE_CANARY/);
 }
});
