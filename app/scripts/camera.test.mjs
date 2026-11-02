import {test}from'node:test';import assert from'node:assert/strict';import{tourCameraAt}from'../src/camera.ts';import{LINES}from'../src/story.ts';
test('camera remains continuous at every directed-tour boundary for every Muse',()=>{for(const mobile of[false,true])for(let p=0;p<8;p++)for(const t of[2,4,8,14,18,24,34,47,61,76,141,170,202,210,...LINES.flatMap(l=>[l.start-2,l.start,l.start+2])].filter(t=>t>=0)){const a=tourCameraAt(t-.0001,p,mobile),b=tourCameraAt(t+.0001,p,mobile);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.001,`Muse${p} center jumps at${t}`);assert.ok(Math.abs(a.zoom-b.zoom)<.001);assert.ok(Math.abs(a.bay-b.bay)<.001);}});
test('the opening reaches readable commons scale within eight story seconds on desktop and mobile',()=>{for(const mobile of[false,true]){const c=tourCameraAt(8,0,mobile);assert.ok(c.zoom>=(mobile?20.65:21.3),`opening still distant at8s: zoom${c.zoom}`);assert.equal(c.x,0);assert.equal(c.z,0);}});

test('only the first automatic entry reaches the original eight-second camera pose at three seconds',()=>{
 for(const mobile of[false,true]){
  assert.deepEqual(tourCameraAt(3,0,mobile,true),tourCameraAt(8,0,mobile,false));
  assert.ok(tourCameraAt(3,0,mobile,false).zoom<14,'manual Story retains the original intro');
  for(let t=8;t<=210;t+=.25)assert.deepEqual(tourCameraAt(t,0,mobile,true),tourCameraAt(t,0,mobile,false),'camera rejoins the original timeline at '+t);
 }
});
test('accelerated first-entry camera follows the same geographic intro curve and joins continuously at3s/8s',()=>{
 for(const mobile of[false,true]){
  for(let t=0;t<3;t+=.1)assert.deepEqual(tourCameraAt(t,0,mobile,true),tourCameraAt(t*8/3,0,mobile,false));
  for(const t of[3,8]){const a=tourCameraAt(t-.00001,0,mobile,true),b=tourCameraAt(t+.00001,0,mobile,true);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.001);assert.ok(Math.abs(a.zoom-b.zoom)<.001);}
 }
});
