import{test}from'node:test';import assert from'node:assert/strict';
import{checkTrade,emptyLedger,RULES}from'../src/engine/items.ts';
import{PLACE_BY_ID,placeById}from'../src/engine/places.ts';
const day='2026-11-04',origin='commons:cafe';
test('canonical trade policy is fifty metres with exact inclusive boundary',t=>{
 assert.equal(RULES.tradeRangeM,50);
 const p=placeById(origin),ledger=emptyLedger();
 const a={id:'03-ripple',place:origin,inventory:['transit_pass']};
 for(const distance of[50,50.001,75,99.9]){const id='trade-boundary:'+distance;PLACE_BY_ID.set(id,{...p,id,x:p.x+distance});t.after(()=>PLACE_BY_ID.delete(id));const b={id:'02-moss',place:id,inventory:['clover_seed']};assert.deepEqual(checkTrade(ledger,day,a,b,'transit_pass','clover_seed'),distance<=50?{ok:true}:{ok:false,reason:'too_far'});}
});
