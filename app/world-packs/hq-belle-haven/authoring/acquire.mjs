import {gzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';import {PbfReader as Pbf} from 'pbf';import fs from 'node:fs';import crypto from 'node:crypto';
const origin=[-122.14991969950646,37.48313116566372], z=14,n=2**z;
const xy=([lon,lat])=>[Math.floor((lon+180)/360*n),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)];
const lo=xy([origin[0]-.018,origin[1]+.014]),hi=xy([origin[0]+.018,origin[1]-.014]);
const root=new URL('../',import.meta.url);const features=[],receipts=[];
for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++){
const url=`https://tiles.openfreemap.org/planet/20261101_080013_pt/${z}/${x}/${y}.pbf`;
const response=await fetch(url,{headers:{'User-Agent':'Musely-WorldPack-Authoring/1.0'}});if(!response.ok)throw Error(`${response.status} ${url}`);const bytes=Buffer.from(await response.arrayBuffer());receipts.push({url,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});const tile=new VectorTile(new Pbf(bytes));
for(const name of ['building','landcover','landuse','transportation']){const l=tile.layers[name];if(!l)continue;for(let i=0;i<l.length;i++){const original=l.feature(i).toGeoJSON(x,y,z);const parts=original.geometry.type==='MultiPolygon'?original.geometry.coordinates.map(coordinates=>({...original,geometry:{type:'Polygon',coordinates}})):[original];for(const f of parts){let c=[];function flat(a){if(typeof a[0]==='number')c.push(a);else a.forEach(flat)}flat(f.geometry.coordinates);if(!c.length||c.some(p=>Math.abs(p[0]-origin[0])>.018||Math.abs(p[1]-origin[1])>.014))continue;f.properties={...f.properties,sourceLayer:name,sourceTile:`${z}/${x}/${y}`,sourceFeatureId:f.id??null};features.push(f)}}}
}
fs.writeFileSync(new URL('detail.geojson.gz',root),gzipSync(JSON.stringify({type:'FeatureCollection',metadata:{source:'OpenFreeMap / OpenMapTiles / OpenStreetMap',version:'20261101_080013_pt',attribution:'OpenFreeMap © OpenMapTiles Data from OpenStreetMap contributors (ODbL)',license:'ODbL-1.0',captureDate:'2026-11-03',bounds:[origin[0]-.018,origin[1]-.014,origin[0]+.018,origin[1]+.014],coverage:'Whole geometries only; tile-edge fragments retained; not a surveyed or navigation dataset',receipts},features})));console.log(receipts,features.reduce((a,f)=>(a[f.properties.sourceLayer]=(a[f.properties.sourceLayer]||0)+1,a),{}));
