import{test}from'node:test';import assert from'node:assert/strict';import{positionAt}from'../src/activity.ts';
test('moving Muse routes retain personal space throughout the210s scene',()=>{for(let t=0;t<210;t+=.1)for(let i=0;i<8;i++)for(let j=i+1;j<8;j++){const a=positionAt(i,t),b=positionAt(j,t);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=.62,`Muses${i}/${j} intersect at${t}`);}});
