import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/engine/world.ts';
const api=await import('../src/engine/social-status.ts').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const at=Date.parse('2026-11-04T01:00:00Z');
const world=()=>createWorld('social-test',at);
test('public availability is one label, never the activity, owner override or private facts',()=>{
 assert.equal(typeof api.publicAvailability,'function');const s=world();s.owner.privateReason='PRIVATE_CANARY';s.owner.rawLatitude=37.4;
 assert.deepEqual(api.publicAvailability(s,'00-jolly',at),{status:'welcoming'});
 assert.deepEqual(Object.keys(api.publicAvailability(s,'00-jolly',at,'do_not_disturb')),['status']);
 assert.doesNotMatch(JSON.stringify(api.publicAvailability(s,'00-jolly',at)),/PRIVATE|37\.4|owner|place|schedule|reason/);
});
test('current movement/work is busy, rest and finished activity welcome; explicit owner mode wins',()=>{
 assert.equal(typeof api.resolveSocialStatus,'function');const s=world(),m=s.muses[0];
 m.travel={to:'commons:cafe',departAt:at,arriveAt:at+1e5,speed:'walk'};assert.equal(api.resolveSocialStatus(s,m.id,at),'busy');
 assert.equal(api.resolveSocialStatus(s,m.id,at,'welcoming'),'welcoming');assert.equal(api.resolveSocialStatus(s,m.id,at,'do_not_disturb'),'do_not_disturb');
 m.travel=null;m.beat={id:'repair',startedAt:at,endsAt:at+1e5,clip:'hammer',line:'PRIVATE_CANARY'};assert.equal(api.resolveSocialStatus(s,m.id,at),'busy');
 m.beat.id='campfire_sit';assert.equal(api.resolveSocialStatus(s,m.id,at),'welcoming');
 m.beat.id='unknown_work';assert.equal(api.resolveSocialStatus(s,m.id,at),'busy');
 m.beat.endsAt=at;assert.equal(api.resolveSocialStatus(s,m.id,at),'welcoming');
 assert.equal(api.resolveSocialStatus(s,m.id,at,'busy'),'busy');assert.equal(api.resolveSocialStatus(s,m.id,at,'auto'),'welcoming');
});
test('unknown identity, invalid mode/time and a missing actor fail closed without becoming a resident',()=>{
 assert.equal(typeof api.resolveSocialStatus,'function');const s=world();
 assert.equal(api.resolveSocialStatus(s,'ghost',at,'welcoming'),'do_not_disturb');
 for(const mode of['invalid',{},null])assert.equal(api.resolveSocialStatus(s,'00-jolly',at,mode),'do_not_disturb');
 assert.equal(api.resolveSocialStatus(s,'00-jolly',NaN),'do_not_disturb');
 s.paused={'00-jolly':{at,by:'owner',version:1}};assert.equal(api.resolveSocialStatus(s,'00-jolly',at),'do_not_disturb');
});
test('status policy removes clock gating; only welcoming permits approach and social residents favor personal peers',()=>{
 assert.equal(typeof api.interactionPolicy,'function');assert.equal(api.interactionPolicy('welcoming'),'approach');assert.equal(api.interactionPolicy('busy'),'wave');assert.equal(api.interactionPolicy('do_not_disturb'),'none');assert.equal(api.interactionPolicy('CANARY'),'none');
 const s=world();s.muses[0].controlMode='personal';const before=JSON.stringify(s);
 const social=api.personalApproachProbability(s,'01-sunny','00-jolly',at),quiet=api.personalApproachProbability(s,'06-ink','00-jolly',at);
 assert(social>quiet&&quiet>0&&social<=1);assert.equal(api.personalApproachProbability(s,'01-sunny','00-jolly',at,'busy'),0);assert.equal(api.personalApproachProbability(s,'01-sunny','00-jolly',at,'do_not_disturb'),0);
 assert.equal(api.personalApproachProbability(s,'ghost','00-jolly',at),0);assert.equal(api.personalApproachProbability(s,'00-jolly','01-sunny',at),0);
 assert.equal(api.personalApproachProbability(s,'01-sunny','00-jolly',at-8*3600000),social,'no 9am gate');assert.equal(JSON.stringify(s),before);
});
