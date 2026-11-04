import test from 'node:test';
import assert from 'node:assert/strict';
import {BEATS} from '../src/engine/beats.ts';
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
test('movement and explicit making are busy; stationary activities and unknown beats welcome; owner mode wins',()=>{
 assert.equal(typeof api.resolveSocialStatus,'function');const s=world(),m=s.muses[0];
 m.travel={to:'commons:cafe',departAt:at,arriveAt:at+1e5,speed:'walk'};assert.equal(api.resolveSocialStatus(s,m.id,at),'busy');
 assert.equal(api.resolveSocialStatus(s,m.id,at,'welcoming'),'welcoming');assert.equal(api.resolveSocialStatus(s,m.id,at,'do_not_disturb'),'do_not_disturb');
 m.travel=null;m.beat={id:'repair',startedAt:at,endsAt:at+1e5,clip:'hammer',line:'PRIVATE_CANARY'};assert.equal(api.resolveSocialStatus(s,m.id,at),'busy');
 m.beat.id='campfire_sit';assert.equal(api.resolveSocialStatus(s,m.id,at),'welcoming');
 m.beat.id='resident_stay';assert.equal(api.resolveSocialStatus(s,m.id,at),'welcoming');
 m.beat.id='unknown_work';assert.equal(api.resolveSocialStatus(s,m.id,at),'welcoming');
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


test('the entire current activity catalog welcomes conversation except explicit making and repair',()=>{
 const s=world(),m=s.muses[1],busy=['cafe_fix_gadget','garden_plant','repair','craft'];
 for(const b of BEATS){m.beat={id:b.id,clip:b.clips[0],startedAt:at,endsAt:at+60000,line:null};
  assert.equal(api.resolveSocialStatus(s,m.id,at,'auto',true),busy.includes(b.id)?'busy':'welcoming',b.id);}
 assert.deepEqual(BEATS.filter(b=>b.result?.craft).map(b=>b.id),['garden_plant']);
 m.beat={id:'resident_stay',clip:'idle_breathe',startedAt:at,endsAt:at+60000,line:null};assert.equal(api.resolveSocialStatus(s,m.id,at,'auto',true),'welcoming');
});
test('daily rhythm never closes a stationary resident, while explicit modes, travel and making retain priority',()=>{
 const s=world(),m=s.muses.find(x=>x.id==='01-sunny');m.travel=null;m.beat=null;
 for(let hour=0;hour<24;hour++){
  const now=Date.parse('2026-11-04T08:00:00Z')+hour*3600000;
  assert.equal(api.resolveSocialStatus(s,m.id,now,'auto',true),'welcoming',String(hour));
  assert.equal(api.resolveSocialStatus(s,m.id,now,'busy',true),'busy');assert.equal(api.resolveSocialStatus(s,m.id,now,'do_not_disturb',true),'do_not_disturb');
 }
});
test('availability remains status-only and does not inspect private reasons, schedules or pending agreements',()=>{
 const s=world(),m=s.muses[0];m.beat={id:'read',clip:'read_book',startedAt:at,endsAt:at+60000,line:null};
 for(const key of['owner','inbox','calendar','location','privateLifeReflection'])Object.defineProperty(s,key,{get(){throw Error('PRIVATE_CANARY');}});
 assert.deepEqual(api.publicAvailability(s,m.id,at,'auto',true),{status:'welcoming'});
});
