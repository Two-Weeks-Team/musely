import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const geo=JSON.parse(readFileSync('assets/geography.json')),data=JSON.parse(readFileSync('assets/map-context.json')),style=JSON.parse(readFileSync('assets/map-style.json'));
const m=p=>[(p[0]-geo.hq[0])*111320*Math.cos(geo.hq[1]*Math.PI/180),-(p[1]-geo.hq[1])*111320];
function ring([x,z],p){let c=false;for(let i=0,k=p.length-1;i<p.length;k=i++){let a=p[i],b=p[k];if((a[1]>z)!=(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
const buildings=data.building.flatMap(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(p=>p.map(r=>r.map(m))));
const occupied=p=>buildings.some(b=>ring(p,b[0])&&!b.slice(1).some(h=>ring(p,h)));
const grid=geo.gridBearingDeg*Math.PI/180,cell=(x,z,c)=>[c[0]+x*Math.cos(grid)-z*Math.sin(grid),c[1]+x*Math.sin(grid)+z*Math.cos(grid)];
const segDist=([px,pz],[ax,az],[bx,bz])=>{const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/l)):0;return Math.hypot(px-ax-t*dx,pz-az-t*dz);};
const roads=data.transportation.filter(f=>f.properties.class!=='path').flatMap(f=>(f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates).map(l=>({half:f.properties.class==='service'?2.8:4.5,points:l.map(m)})));
test('detailed patch fits mapped open ground, no HQ building hidden',()=>{const center=m(geo.commons);assert.ok(Math.hypot(...center)<40);for(let x=-12;x<=12;x+=.25)for(let z=-11;z<=11;z+=.25)assert.equal(occupied(cell(x,z,center)),false,`building intersection ${x},${z}`);const f=JSON.stringify(style.layers.find(l=>l.id==='building-3d').filter);assert.ok(!f.includes('285714890'));});
test('patch follows the mapped road grid and no vehicle road crosses it',()=>{
 const center=m(geo.commons),angle=([a,b])=>((Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI)%90+90)%90;
 // The long service roads bordering the commons runs on the same grid the scene is turned to.
 const segments=roads.filter(r=>r.half<3).flatMap(r=>r.points.slice(1).map((p,i)=>[r.points[i],p])).filter(([a,b])=>Math.hypot(b[0]-a[0],b[1]-a[1])>20&&segDist(center,a,b)<30);
 assert.ok(segments.length>=2,`only ${segments.length} service segments`);for(const s of segments)assert.ok(Math.abs(angle(s)-geo.gridBearingDeg%90)<3,`service road at ${angle(s)}°`);
 for(let x=-12;x<=12;x+=.5)for(let z=-11;z<=11;z+=.5){const p=cell(x,z,center);for(const r of roads)for(let i=1;i<r.points.length;i++)assert.ok(segDist(p,r.points[i-1],r.points[i])>=r.half,`road crosses commons at ${x},${z}`);}
});
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
