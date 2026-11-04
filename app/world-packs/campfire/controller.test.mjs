import {test} from 'node:test';
import assert from 'node:assert/strict';
import {campfireLod, campfireFrame, createCampfireController} from './controller.ts';
const snap = {placeId:'commons:campfire', observedAt:1000, receiptId:'arrival:1', arrivedMuseIds:['a','b','a']};
test('distance boundaries and invalid distances fail closed',()=>{
 assert.deepEqual([0,18,18.1,60,60.1,200,201,NaN,-1,Infinity].map(campfireLod), ['near','near','mid','mid','far','far','hidden','hidden','hidden','hidden']);
});
test('no events never creates attendance or sparks',()=>{
 const f=campfireFrame('commons:campfire',3,1000);assert.equal(f.attendees,0);assert.equal(f.seatsOccupied,0);assert.equal(f.sparksVisible,false);
});
test('authoritative same-place snapshot deduplicates arrivals',()=>{
 const f=campfireFrame('commons:campfire',3,1000,snap);assert.equal(f.attendees,2);assert.equal(f.seatsOccupied,2);assert.equal(f.sparksVisible,true);
});
test('other place, stale, future and missing receipt cannot animate attendance',()=>{
 for(const s of [{...snap,placeId:'elsewhere'},{...snap,observedAt:-60000},{...snap,observedAt:1001},{...snap,receiptId:''}]) assert.equal(campfireFrame('commons:campfire',3,1000,s).attendees,0);
});
test('far LOD removes flame/sparks while preserving factual count',()=>{
 const f=campfireFrame('commons:campfire',100,1000,snap);assert.equal(f.flameScale,0);assert.equal(f.sparksVisible,false);assert.equal(f.attendees,2);
});
test('dispose is idempotent, deduplicates ownership and update stops',()=>{
 let draws=0, detached=0,disposed=0; const r={dispose(){disposed++}};
 const c=createCampfireController('commons:campfire',{render(){draws++},detach(){detached++},ownedResources:[r,r]});
 c.update(2,1000,snap);c.dispose();c.dispose();c.update(2,1000,snap);
 assert.deepEqual([draws,detached,disposed],[1,1,1]);
});
test('failing resource does not prevent remaining cleanup',()=>{
 let cleaned=false; const c=createCampfireController('p',{render(){},detach(){},ownedResources:[{dispose(){throw Error('bad')}},{dispose(){cleaned=true}}]});
 assert.throws(()=>c.dispose(),AggregateError); assert.equal(cleaned,true); assert.doesNotThrow(()=>c.dispose());
});
test('snapshot arrays are not mutated and input IDs remain separate from role names',()=>{
 const ids=Object.freeze(['resident-1','resident-2']); assert.equal(campfireFrame('p',0,0,{placeId:'p',observedAt:0,receiptId:'r',arrivedMuseIds:ids}).attendees,2);
});

test('malformed adapter arrival arrays fail closed',()=>{
 for(const arrivedMuseIds of [null,undefined,{},'a']) {
  const f=campfireFrame('commons:campfire',1,1000,{...snap,arrivedMuseIds});
  assert.equal(f.attendees,0);assert.equal(f.sparksVisible,false);
 }
});
