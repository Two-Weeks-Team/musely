// Real WorldDO with isolated SQLite, synthetic sessions and keys; no external identity/provider calls.
import test from 'node:test';import assert from 'node:assert/strict';
import {bootWorldDo} from './test-support/world-life-harness.mjs';
import {personalDigest,personalNonce} from '../worker/core/personal-session.ts';
const ON={SOCIAL_STATUS_MODE:'public-v1',THREADS_APP_ID:'123'};
async function own(a,subject){
 if(!a.nestedTx){let depth=0;a.storage.transactionSync=fn=>{const name='social_'+depth++;a.db.exec('SAVEPOINT '+name);try{const value=fn();a.db.exec('RELEASE '+name);return value;}catch(e){a.db.exec('ROLLBACK TO '+name);a.db.exec('RELEASE '+name);throw e;}finally{depth--;}};a.nestedTx=true;}
 const now=Date.now(),flow={stateDigest:await personalDigest('state',personalNonce()),browserDigest:await personalDigest('browser',personalNonce()),appId:'123',redirectUri:'https://musely.net/api/threads/callback',createdAt:now,expiresAt:now+600000};
 assert.equal(a.world.personalAuthBegin(flow),true);assert(a.world.personalAuthConsume(flow,now));
 const sidDigest=await personalDigest('sid',personalNonce()),proof=a.world.personalAuthComplete(flow.stateDigest,'123',subject,sidDigest,now),binding={sidDigest,proof,appId:'123'};
 const profile=await a.world.personalDraftRegister(binding,{operationId:'draft-'+subject,displayName:'Neighbor '+subject,appearanceId:'01-sunny'});
 a.edit(s=>s.muses.push({...structuredClone(s.muses[1]),id:profile.actorId,profile,controlMode:'personal',travel:null,beat:null}));return{binding,profile};
}
const forbidden=e=>e?.code==='social_status_forbidden';
test('WorldDO social preferences are own-only, private, CAS-bound and do not change world, keys or replay',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:ON});const x=await own(a,'42'),y=await own(a,'99'),before=JSON.stringify(a.runtime.state()),keys=JSON.stringify(a.db.prepare('SELECT * FROM agent_keys').all());
 const first=a.world.personalSocialStatusGet(x.binding);assert.equal(first.muse,x.profile.actorId);assert.equal(first.mode,'auto');
 const saved=a.world.personalSocialStatusSet(x.binding,{mode:'do_not_disturb',expectedRevision:0});assert.equal(saved.revision,1);
 assert.equal(a.world.personalSocialStatusGet(y.binding).mode,'auto');
 assert.throws(()=>a.world.personalSocialStatusSet(x.binding,{mode:'busy',expectedRevision:0}),e=>e.code==='social_status_conflict');
 assert.throws(()=>a.world.personalSocialStatusGet({...y.binding,proof:{...y.binding.proof,principalId:x.binding.proof.principalId}}));
 assert.equal(JSON.stringify(a.runtime.state()),before);assert.equal(JSON.stringify(a.db.prepare('SELECT * FROM agent_keys').all()),keys);
 const view=a.world.worldView(),muse=view.muses.find(m=>m.id===x.profile.actorId);assert.deepEqual(muse.availability,{status:'do_not_disturb'});assert.deepEqual(Object.keys(muse.availability),['status']);
 assert.doesNotMatch(JSON.stringify(view),/social_status_overrides|expectedRevision|sidDigest|principalId/);
 assert.equal(JSON.stringify(a.runtime.state()),before,'public projection never injects current overrides into recorded state');
 a.world.personalAuthRevoke(x.binding.sidDigest,x.binding.proof,'123',Date.now());assert.throws(()=>a.world.personalSocialStatusGet(x.binding));
});
test('legacy session cannot set another principal status; OFF cannot write or expose preferences',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:ON});const p=await a.ownerFor('owner'),owner={principal:p.principal,ownerId:p.ownerId,exp:p.exp};
 a.world.ownerSocialStatusSet(owner,'00-jolly',{mode:'busy',expectedRevision:0});assert.equal(a.world.ownerSocialStatusGet(owner,'00-jolly').status,'busy');
 assert.throws(()=>a.world.ownerSocialStatusSet(owner,'04-ember',{mode:'welcoming',expectedRevision:0}),forbidden);
 assert.throws(()=>a.world.ownerSocialStatusGet({...owner,exp:Date.now()-1},'00-jolly'),forbidden);
 const off=await bootWorldDo(t,{mode:'sandbox-v1'});assert.throws(()=>off.world.ownerSocialStatusGet(owner,'00-jolly'),e=>e.code==='social_status_unavailable');assert.equal(Object.hasOwn(off.world.worldView().muses[0],'availability'),false);
});

test('current personal session, entry and application binding are required before preference access',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:ON}),x=await own(a,'1234');
 assert.throws(()=>a.world.personalSocialStatusGet({...x.binding,appId:'456'}));
 assert.throws(()=>a.world.personalSocialStatusGet({...x.binding,proof:{...x.binding.proof,expiresAt:Date.now()-1}}));
 a.edit(s=>{s.muses=s.muses.filter(m=>m.id!==x.profile.actorId);});
 assert.throws(()=>a.world.personalSocialStatusSet(x.binding,{mode:'welcoming',expectedRevision:0}),forbidden);
 assert.equal(a.db.prepare('SELECT count(*) n FROM social_status_overrides').get().n,0);
});

test('MCP current world exposes own and neighbor status labels only; recorded state and OFF stay unchanged',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:ON});a.prepare();
 const p=await a.ownerFor('owner'),q=await a.ownerFor('demo-peer');
 a.world.ownerSocialStatusSet(p,'00-jolly',{mode:'busy',expectedRevision:0});
 a.world.ownerSocialStatusSet(q,'09-copper',{mode:'do_not_disturb',expectedRevision:0});
 const read=await a.call('owner','get_world_state');assert.equal(read.status,200);assert.equal(read.body.result.isError,false);
 const dto=read.body.result.structuredContent;assert.deepEqual(dto.muse.availability,{status:'busy'});assert.deepEqual(dto.neighbors.find(n=>n.id==='09-copper').availability,{status:'do_not_disturb'});
 for(const n of[dto.muse,...dto.neighbors])assert.deepEqual(Object.keys(n.availability),['status']);
 assert.equal(a.runtime.state().muses.some(m=>Object.hasOwn(m,'availability')),false);
 const off=await bootWorldDo(t,{mode:'sandbox-v1'}),old=(await off.call('owner','get_world_state')).body.result.structuredContent;
 assert.equal(Object.hasOwn(old.muse,'availability'),false);assert.equal(old.neighbors.some(n=>Object.hasOwn(n,'availability')),false);
});

test('actual resident model packet receives only public availability labels from private preferences',async t=>{
 const packets=[];const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:{...ON,RESIDENT_BUDGET_MODE:'split-v1',DAILY_BUDGET_USD:'30',RESIDENT_ACTIONS_MODE:'action-v1'},modelFetcher:async(_url,init)=>{const packet=JSON.parse(init.body);packets.push(packet);return new Response(JSON.stringify({id:'fixture-public-labels',usage:{prompt_tokens:10,completion_tokens:10},choices:[{message:{content:JSON.stringify({freedom:'where',decision:'rest',target_place:'Commons Cafe',target_agent:'',offer_item:'',want_item:'',line:'',public_reason:'A quiet break',duration_minutes:15})}}]}),{headers:{'x-request-id':'fixture-public-labels'}});}});
 const owner=await a.ownerFor('owner');a.world.ownerSocialStatusSet(owner,'00-jolly',{mode:'busy',expectedRevision:0});await a.runtime.heartbeat(Date.now());
 const activity=packets.find(p=>p.response_format.json_schema.name==='resident_next_activity');assert(activity);
 const metadata=activity.messages.filter(m=>m.role==='user').flatMap(m=>{try{const x=JSON.parse(m.content);return x.public_availability??[];}catch{return[];}});
 assert.deepEqual(metadata.find(x=>x.actor_id==='00-jolly'),{actor_id:'00-jolly',status:'busy'});
 assert.doesNotMatch(JSON.stringify(metadata),/mode|revision|sid|reason|location|schedule/);
});
