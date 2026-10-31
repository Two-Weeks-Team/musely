import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const geo=JSON.parse(readFileSync('assets/geography.json')),data=JSON.parse(readFileSync('assets/map-context.json')),style=JSON.parse(readFileSync('assets/map-style.json'));
const m=p=>[(p[0]-geo.hq[0])*111320*Math.cos(geo.hq[1]*Math.PI/180),-(p[1]-geo.hq[1])*111320];
function ring([x,z],p){let c=false;for(let i=0,k=p.length-1;i<p.length;k=i++){let a=p[i],b=p[k];if((a[1]>z)!=(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
const buildings=data.building.flatMap(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(p=>p.map(r=>r.map(m))));
const occupied=p=>buildings.some(b=>ring(p,b[0])&&!b.slice(1).some(h=>ring(p,h)));
test('detailed patch fits mapped open ground, no HQ building hidden',()=>{const center=m(geo.commons);assert.ok(Math.abs(center[1]-30)<.01);for(let x=-12;x<=12;x+=.25)for(let z=-11;z<=11;z+=.25)assert.equal(occupied([center[0]+x,center[1]+z]),false,`building intersection ${x},${z}`);const f=JSON.stringify(style.layers.find(l=>l.id==='building-3d').filter);assert.ok(!f.includes('285714890'));});
test('entire geographic ground and water use canonical Musely night palette',()=>{assert.equal(style.layers.find(l=>l.type==='background').paint['background-color'],'#1B2436');for(const l of style.layers)if(l.type==='fill')assert.ok(['#101623','#1B2436','#232E47'].includes(l.paint['fill-color']),l.id);});
const arrival=JSON.parse(readFileSync('assets/arrival-map.json'));
const water=arrival.features.filter(f=>f.properties.kind==='water').flatMap(f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates);
const wet=p=>water.some(polygon=>ring(p,polygon[0])&&!polygon.slice(1).some(hole=>ring(p,hole)));
test('embedded Bay overview preserves land underneath the entire authored commons',()=>{
 const [[west,south],[east,north]]=arrival.metadata.bounds;
 assert.ok(geo.commons[0]>west&&geo.commons[0]<east&&geo.commons[1]>south&&geo.commons[1]<north);
 for(let x=-geo.patchHalfWidth;x<=geo.patchHalfWidth;x++)for(let z=-geo.patchHalfDepth;z<=geo.patchHalfDepth;z++){
  const point=[geo.commons[0]+x/(111320*Math.cos(geo.commons[1]*Math.PI/180)),geo.commons[1]-z/111320];
  assert.equal(wet(point),false,`overview water intersects commons at ${x},${z}`);
 }
});
