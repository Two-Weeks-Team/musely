import {test} from 'node:test';import assert from 'node:assert/strict';
import {createWorld} from '../src/engine/world.ts';
import {PLACE_BY_ID,placeById,distanceM} from '../src/engine/places.ts';
import {publicActorPosition} from '../src/engine/speech.ts';
import {localPerception,diffLocalPerception} from '../src/engine/local-perception.ts';
const NOW=1000;
const actor=(id,extra={})=>({id,place:'bay:sf',travel:null,beat:null,inventory:[],memory:[],reflection:'',lastMet:{},intent:null,wants:{goal:'Public goal',items:['tea'],source:'harness',updatedAt:NOW},...extra});
const world=(actors)=>({...createWorld('perception-test',NOW),muses:actors});
function atDistance(id,metres){const from=placeById('bay:sf'),to=placeById(metres<=100?'bay:sf:reading':'bay:oakland');return actor(id,{travel:{to:to.id,departAt:0,arriveAt:distanceM(from,to)/metres*NOW,speed:'walk'}});}
test('conversation details come from public identity, wants and transferable unexpired holdings only',()=>{
 const s=world([actor('00-jolly'),actor('01-sunny',{inventory:['tea','tea','sun_badge','stamp_park','taxi_token','UNKNOWN_ITEM'],reflection:'PRIVATE_REFLECTION',memory:['PRIVATE_MEMORY']})]);
 s.items.expiry['01-sunny']=[{item:'taxi_token',at:0,expiresAt:NOW}];
 Object.defineProperty(s,'inbox',{get(){throw Error('private inbox must not be read');}});
 const p=localPerception(s,'00-jolly',NOW);assert.equal(p.conversation.length,1);assert.equal(p.conversation[0].name,'Sunny');assert.deepEqual(p.conversation[0].tradeItems,[{id:'tea',name:'Tea'}]);assert.deepEqual(p.conversation[0].wants,{goal:'Public goal',items:['tea']});assert.doesNotMatch(JSON.stringify(p),/PRIVATE|UNKNOWN_ITEM|memory|reflection|owner|lastMet/);
});
test('50m is detailed, above 50 through 400m is anonymous grouped counts, beyond 400 absent',t=>{
 // Registered virtual catalog fixtures keep the measured x-axis boundaries exactly 50 and 400, not 400+rounding.
 const origin=placeById('bay:sf');for(const metres of[50,400,400.01]){const id='perception-test:'+metres;PLACE_BY_ID.set(id,{...origin,id,name:'Boundary place',x:origin.x+metres});t.after(()=>PLACE_BY_ID.delete(id));}
 const near=actor('01-sunny',{place:'perception-test:50'}),far=actor('02-moss',{place:'perception-test:400'}),outside=actor('03-ripple',{place:'perception-test:400.01'});
 const pos=publicActorPosition(near,NOW);assert.equal(Math.hypot(pos.x-origin.x,pos.z-origin.z),50);
 far.wants.goal='FAR_WANTS_CANARY';far.inventory=['SECRET_FAR_ITEM'];
 const p=localPerception(world([actor('00-jolly'),near,far,outside]),'00-jolly',NOW,{socialStatus:(_s,id)=>id==='02-moss'?'busy':'welcoming'});
 assert.deepEqual(p.conversation.map(x=>x.id),['01-sunny']);assert.equal(p.visibleGroups.reduce((n,g)=>n+g.count,0),1);assert.equal(p.visibleGroups[0].statuses.busy,1);assert.doesNotMatch(JSON.stringify(p.visibleGroups),/02-moss|Moss|03-ripple|Ripple|FAR_WANTS|SECRET_FAR|inventory|name.*Muse/);
});
test('in-progress travel uses the common interpolated position, not its stale start place',()=>{
 const moving=atDistance('01-sunny',100),s=world([actor('00-jolly'),moving]);
 assert.equal(localPerception(s,'00-jolly',NOW).conversation.length,0);assert.equal(localPerception(s,'00-jolly',NOW/4).conversation.length,1);
});
test('unknown, duplicate and deleted or malformed profiles never borrow a resident name',()=>{
 const p={actorId:'pm_a',displayName:'<Public name>',appearanceId:'00-jolly',revision:1};
 const s=world([actor('00-jolly'),actor('pm_a',{profile:p}),actor('pm_missing'),actor('02-moss',{profile:{...p,actorId:'foreign'}}),actor('03-ripple'),actor('03-ripple')]);
 const projected=localPerception(s,'00-jolly',NOW);assert.deepEqual(projected.conversation.map(x=>[x.id,x.name]),[['pm_a','<Public name>']]);
 assert.equal(localPerception(s,'pm_missing',NOW),null);assert.equal(localPerception(s,'absent',NOW),null);assert.equal(localPerception(s,'00-jolly',NaN),null);
});
test('place brief is catalog-derived and its optional item pool is never treated as guaranteed acquisition',()=>{
 const s=world([actor('00-jolly',{place:'commons:cafe'})]);
 const uninstalled=localPerception(s,'00-jolly',NOW);assert.deepEqual(uninstalled.place.availableItems,[]);assert.equal(uninstalled.place.itemsKnown,false);
 const p=localPerception(s,'00-jolly',NOW,{publicCatalogItems:kind=>kind==='cafe'?['tea','UNKNOWN','sun_badge']:[]});
 assert.equal(p.place.kind,'cafe');assert.ok(p.place.activities.some(a=>a.id==='cafe_people_watch'));assert.equal(p.place.itemsKnown,true);assert.deepEqual(p.place.availableItems.map(i=>i.id),['tea','sun_badge']);assert.doesNotMatch(JSON.stringify(p),/guaranteed|canAcquire|UNKNOWN/);
 const broken=localPerception(s,'00-jolly',NOW,{publicCatalogItems:()=>{throw Error('PRIVATE_ERROR');},socialStatus:()=>{throw Error('PRIVATE_ERROR');}});assert.equal(broken.place.itemsKnown,false);assert.doesNotMatch(JSON.stringify(broken),/PRIVATE_ERROR/);
});
test('gatherings are gathered-only host DTOs at the current place, never private invitation state',()=>{
 const s=world([actor('00-jolly',{place:'commons:campfire'})]);
 const gatherings=[{id:'g1',placeId:'commons:campfire',status:'gathered',count:3,note:'PRIVATE_NOTE',invitees:['PRIVATE_INVITEE']},{id:'g2',placeId:'commons:campfire',status:'open',count:4},{id:'g3',placeId:'bay:sf',status:'gathered',count:4}];
 const p=localPerception(s,'00-jolly',NOW,{gatherings});assert.deepEqual(p.gatherings,[{id:'g1',placeId:'commons:campfire',status:'gathered',count:3}]);assert.doesNotMatch(JSON.stringify(p),/PRIVATE/);
});
test('same states and same side of a distance boundary produce no trigger, a real crossing produces one stable notice',()=>{
 const before=world([actor('00-jolly'),atDistance('01-sunny',51)]),after=world([actor('00-jolly'),atDistance('01-sunny',49)]);
 assert.deepEqual(diffLocalPerception(before,before,'00-jolly',NOW,NOW),[]);
 const notices=diffLocalPerception(before,after,'00-jolly',NOW,NOW);assert.equal(notices.length,1);assert.equal(notices[0].kind,'conversation_entered');assert.equal(notices[0].peerId,'01-sunny');assert.deepEqual(notices,diffLocalPerception(before,after,'00-jolly',NOW,NOW));
 assert.equal(diffLocalPerception(after,before,'00-jolly',NOW,NOW)[0].kind,'conversation_left');
});
test('arrival and public grid changes derive only from actor movement, with no repeated or cross-world notice',()=>{
 const a=actor('00-jolly',{place:'commons:cafe',travel:{to:'bay:sf',departAt:0,arriveAt:2000,speed:'bus'}}),before=world([a]),after=world([actor('00-jolly',{place:'bay:sf'})]);
 const n=diffLocalPerception(before,after,'00-jolly',NOW,2000);assert.ok(n.some(x=>x.kind==='place_arrival'&&x.placeId==='bay:sf'));assert.ok(n.some(x=>x.kind==='area_changed'));assert.deepEqual(diffLocalPerception(after,after,'00-jolly',2000,2001),[]);assert.deepEqual(diffLocalPerception(before,{...after,worldId:'other'},'00-jolly',NOW,2000),[]);
});
test('a moving observer has no fictitious current-place briefing; time-only travel crossings use each observation time',()=>{
 const s=world([actor('00-jolly'),atDistance('01-sunny',100)]);
 const n=diffLocalPerception(s,s,'00-jolly',NOW/4,NOW);assert.equal(n.length,1);assert.equal(n[0].kind,'conversation_left');
 const travelling=world([atDistance('00-jolly',100)]);const p=localPerception(travelling,'00-jolly',NOW);assert.equal(p.place,null);assert.deepEqual(p.gatherings,[]);
 assert.deepEqual(diffLocalPerception(s,s,'00-jolly',NOW,NOW-1),[]);
});
test('same-side distance changes, actor reordering and status changes do not repeat contact notices',()=>{
 const before=world([actor('00-jolly'),atDistance('01-sunny',20)]),after=world([atDistance('01-sunny',30),actor('00-jolly')]);
 assert.deepEqual(diffLocalPerception(before,after,'00-jolly',NOW,NOW,{socialStatus:()=> 'busy'}),[]);
});
test('privacy getters are never read; invalid status/capability DTOs fail closed without copying their error text',()=>{
 const peer=actor('01-sunny');for(const key of['memory','reflection','intent','lastMet'])Object.defineProperty(peer,key,{get(){throw Error('PRIVATE_GETTER');}});
 const s=world([actor('00-jolly'),peer]);for(const key of['inbox','owner'])Object.defineProperty(s,key,{get(){throw Error('PRIVATE_GETTER');}});
 const p=localPerception(s,'00-jolly',NOW,{socialStatus:()=>({status:'welcoming',reason:'PRIVATE_REASON'}),publicCatalogItems:()=>['tea','tea','postcard:UNKNOWN_PLACE','UNKNOWN_ITEM']});
 assert.equal(p.conversation[0].status,'do_not_disturb');assert.deepEqual(p.place.availableItems,[{id:'tea',name:'Tea'}]);assert.doesNotMatch(JSON.stringify(p),/PRIVATE_|UNKNOWN/);
});
test('invalid public geometry is excluded rather than borrowing an actor start place',()=>{
 const invalid=actor('01-sunny',{travel:{to:'MISSING',departAt:0,arriveAt:2000,speed:'walk'}}),s=world([actor('00-jolly'),invalid]);assert.equal(localPerception(s,'00-jolly',NOW).conversation.length,0);
 assert.equal(localPerception(s,'01-sunny',NOW),null);
});
test('deep-frozen input stays unchanged and every returned collection is detached',()=>{
 const s=world([actor('00-jolly'),actor('01-sunny',{inventory:['tea']})]),before=JSON.stringify(s);
 const freeze=x=>{if(x&&typeof x==='object'){Object.freeze(x);Object.values(x).forEach(freeze);}return x;};freeze(s);
 const p=localPerception(s,'00-jolly',NOW);p.conversation[0].wants.items.push('fruit');p.conversation[0].tradeItems[0].name='Changed';p.place.activities.length=0;
 assert.equal(JSON.stringify(s),before);assert.equal(localPerception(s,'00-jolly',NOW).conversation[0].tradeItems[0].name,'Tea');
});
