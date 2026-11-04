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
