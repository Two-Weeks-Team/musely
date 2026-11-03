import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {build} from 'esbuild';
import {buildRoofDetails, roofGeo, roofLocal, insetConvex, ROOF_POLICY} from './roof-geometry.mjs';
import {createNativeRoofDetails, nativeRoofContract, ROOF_SOURCE_ID, ROOF_LAYER_ID} from './roof-controller.mjs';
import receipts from './roof-fixtures/receipts.json' with {type:'json'};
import style from './current-main-map-style.json' with {type:'json'};

const dir = fs.mkdtempSync(path.join(os.tmpdir(),'musely-roof-'));
after(() => fs.rmSync(dir,{recursive:true,force:true}));
await build({stdin:{contents:"export {Tile} from './node_modules/maplibre-gl/src/tile/tile.ts'; export {FillExtrusionStyleLayer} from './node_modules/maplibre-gl/src/style/style_layer/fill_extrusion_style_layer.ts';",resolveDir:new URL('../',import.meta.url).pathname}, tsconfigRaw:{compilerOptions:{useDefineForClassFields:false}},bundle:true,platform:'node',format:'esm',outfile:path.join(dir,'runtime.mjs')});
const {Tile,FillExtrusionStyleLayer} = await import(pathToFileURL(path.join(dir,'runtime.mjs')).href);
const realFeatures = [];
for (const receipt of receipts.receipts) {
  const parts = receipt.url.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/).slice(1).map(Number);
  const [z,x,y] = parts, bytes = fs.readFileSync(new URL(`roof-fixtures/${z}-${x}-${y}.pbf`,import.meta.url));
  assert.equal(bytes.length, receipt.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), receipt.sha256);
  const vector = new VectorTile(new PbfReader(bytes));
  // Actual installed MapLibre querySourceFeatures implementation, including the
  // runtime tile property and actual MVT geometry. Not a JSON-shape map mock.
  Tile.prototype.querySourceFeatures.call({latestFeatureIndex:{rawTileData:bytes,loadVTLayers:()=>vector.layers,getId:f=>f.id},tileID:{canonical:{z,x,y},overscaledZ:20}}, realFeatures, {sourceLayer:'building'});
}
const square = (id=1,x=100,y=0,size=14,height=5) => ({type:'Feature',id,tile:{z:14,x:2632,y:6349},properties:{render_height:height,render_min_height:0},geometry:{type:'Polygon',coordinates:[[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]].map(roofGeo)]}});

test('actual immutable native PBFs and installed Tile query produce nonempty safe roof geometry', () => {
  assert.ok(realFeatures.some(f => f.geometry.type === 'MultiPolygon'));
  assert.ok(realFeatures.every(f => f.tile.z === 14));
  const data = buildRoofDetails(realFeatures);
  assert.ok(data.report.buildings >= 10);
  assert.equal(data.features.length, data.report.buildings * 2);
  assert.ok(data.report.rejected['tile-boundary-or-unverified-tile'] > 0);
  for (const f of data.features) {
    assert.equal(f.properties.fictional,true);
    assert.ok(f.properties.base >= f.properties.nativeHeight + 0.1599);
    assert.ok(f.properties.top > f.properties.base);
    for (const c of f.geometry.coordinates.flat()) assert.ok(Math.hypot(...roofLocal(c)) < 498);
  }
});
test('safe square has disjoint raised inset panel and parapet; input is untouched', () => {
  const f = square(), before = JSON.stringify(f), data = buildRoofDetails([f]);
  assert.equal(data.report.buildings,1); assert.equal(JSON.stringify(f),before);
  assert.equal(data.features[0].geometry.coordinates.length,2);
  const outer = data.features[0].geometry.coordinates[0].map(roofLocal);
  for(const [x,y] of outer) {assert.ok(x >= 100.3999 && x <= 113.6001);assert.ok(y >= 0.3999 && y <= 13.6001);}
});
test('repeated same-feature components and wrapped source duplicates produce a single roof', () => {
  const f=square(); f.geometry={type:'MultiPolygon',coordinates:[f.geometry.coordinates, f.geometry.coordinates]};
  assert.equal(buildRoofDetails([f]).report.buildings,1);
  const g=square(); assert.equal(buildRoofDetails([g,structuredClone(g)]).report.buildings,1);
});
test('identical geometry under distinct IDs and stacked heights never overlays twice', () => {
  const f=square(), g=structuredClone(f);g.id=2;
  assert.equal(buildRoofDetails([f,g]).report.buildings,0);
  g.properties.render_height=9;assert.equal(buildRoofDetails([f,g]).report.buildings,0);
});
test('ambiguous same-tile ID, neighboring and overlapping buildings reject', () => {
  assert.equal(buildRoofDetails([square(),square(1,120)]).report.buildings,0);
  assert.equal(buildRoofDetails([square(),square(2,110)]).report.buildings,0);
  assert.equal(buildRoofDetails([square(),square(2,114.1)]).report.buildings,0);
});
test('courtyards, concave and narrow roofs reject without arbitrary simplification', () => {
  const f=square();f.geometry.coordinates.push(square(2,104,4,3).geometry.coordinates[0]);
  assert.equal(buildRoofDetails([f]).report.buildings,0);
  assert.equal(insetConvex([[0,0],[10,0],[10,3],[3,3],[3,10],[0,10]],0.4),null);
  assert.equal(insetConvex([[0,0],[1,0],[1,50],[0,50]],0.8),null);
});
test('commons, circular boundary, unknown tile, tile boundary and unsupported heights reject', () => {
  for (const f of [square(1,0,0),square(1,490,0),{...square(),tile:undefined},{...square(),tile:{z:13,x:1316,y:3174}},square(1,340,0),square(1,100,0,14,2)]) assert.equal(buildRoofDetails([f]).report.buildings,0);
  const f=square();f.properties.hide_3d=false;assert.equal(buildRoofDetails([f]).report.buildings,0);
});
test('malformed or excessive components reject the entire source before partial admission', () => {
  const f=square();f.geometry={type:'MultiPolygon',coordinates:Array.from({length:20001},()=>f.geometry.coordinates)};
  assert.equal(buildRoofDetails([f]).report.rejected['source-geometry-budget'],1);
  assert.equal(buildRoofDetails([square(),{geometry:{type:'Polygon',coordinates:null}}]).report.rejected['uninspectable-source-geometry'],1);
});

class Harness extends EventEmitter {
  constructor() {
    super();this.sources=new Map([[ROOF_POLICY.source,{type:'vector',maxzoom:14,tiles:[ROOF_POLICY.tileTemplate]}]]);
    this.layers=new Map([['building-3d',new FillExtrusionStyleLayer(structuredClone(style.layers.find(l=>l.id==='building-3d')), {})]]);
    this.features=[square()];this.zoom=20;this.moving=false;this.terrain=null;this.projection={type:'mercator'};this.loaded=true;this.detailLoaded=true;this.writes=[];
  }
  getLayer(id){return this.layers.get(id)} getSource(id){return this.sources.get(id)} getTerrain(){return this.terrain} getProjection(){return this.projection}
  getZoom(){return this.zoom} isMoving(){return this.moving} isSourceLoaded(id){return id===ROOF_SOURCE_ID?this.detailLoaded:this.loaded}
  getPaintProperty(id,p){return this.layers.get(id).getPaintProperty(p)}
  getLayoutProperty(id,p){return this.layers.get(id).getLayoutProperty(p)}
  getFilter(id){return this.layers.get(id).filter}
  setLayoutProperty(id,p,v){this.writes.push([id,p,v]);this.layers.get(id).setLayoutProperty(p,v);this.emit('styledata')}
  querySourceFeatures(){return this.features}
  addSource(id,s){this.sources.set(id,{...s});this.emit('styledata')}
  removeSource(id){this.sources.delete(id);this.emit('styledata')}
  addLayer(l){if(this.failAddLayer)throw Error('injected addLayer failure');this.layers.set(l.id,new FillExtrusionStyleLayer(l,{}));this.emit('styledata')}
  removeLayer(id){this.layers.delete(id);this.emit('styledata')}
  idle(){this.emit('idle')}
}
function activate(h,c){c.enable();h.idle();assert.equal(c.status().reason,'detail-render-pending');h.idle();assert.equal(c.active,true)}
test('default OFF; enabled controller adds actual raised geometry and never edits native layer', () => {
  const h=new Harness(),before=h.getLayer('building-3d').serialize(),c=createNativeRoofDetails(h);
  assert.equal(nativeRoofContract(h),null);assert.equal(h.sources.size,1);assert.equal(c.active,false);
  activate(h,c);assert.equal(h.getSource(ROOF_SOURCE_ID).data.features.length,2);
  assert.deepEqual(h.getLayer('building-3d').serialize(),before);assert.ok(h.writes.every(([id])=>id===ROOF_LAYER_ID));
  c.disable();assert.equal(h.sources.size,1);assert.equal(h.layers.size,1);c.dispose();assert.equal(h.eventNames().length,0);
});
test('source loading hides immediately, new source never displays stale data, idle rebuilds', () => {
  const h=new Harness(),c=createNativeRoofDetails(h);activate(h,c);const old=h.getSource(ROOF_SOURCE_ID);
  h.loaded=false;h.emit('sourcedataloading',{sourceId:'openmaptiles'});assert.equal(c.active,false);assert.equal(h.getLayoutProperty(ROOF_LAYER_ID,'visibility'),'none');
  h.features=[square(2,140)];h.idle();assert.equal(h.getSource(ROOF_SOURCE_ID),old);
  h.loaded=true;h.emit('sourcedata',{sourceId:'openmaptiles'});h.idle();assert.notEqual(h.getSource(ROOF_SOURCE_ID),old);h.idle();h.idle();assert.equal(c.active,true);c.dispose();
});
test('continuous actual-main repaint loop progresses without any idle event', () => {
  const main=fs.readFileSync(new URL('latest-main.ts',import.meta.url),'utf8');assert.ok(main.includes('map.triggerRepaint()'));
  const h=new Harness(),c=createNativeRoofDetails(h);c.enable();h.emit('render');h.emit('render');assert.equal(c.active,true);
  const source=h.getSource(ROOF_SOURCE_ID);for(let i=0;i<120;i++)h.emit('render');assert.equal(h.getSource(ROOF_SOURCE_ID),source,'stable frames must not rebuild source');
  h.moving=true;h.emit('movestart');h.emit('render');assert.equal(c.active,false);
  h.moving=false;h.emit('moveend');h.emit('render');h.emit('render');h.emit('render');assert.equal(c.active,true);c.dispose();
});
test('cached-tile movement hides and re-queries even without source events', () => {
  const h=new Harness(),c=createNativeRoofDetails(h);activate(h,c);
  h.moving=true;h.emit('movestart');assert.equal(c.active,false);h.features=[];h.moving=false;h.emit('moveend');h.idle();
  assert.equal(c.status().reason,'no-admitted-roofs');assert.equal(h.getSource(ROOF_SOURCE_ID),undefined);c.dispose();
});
test('terrain, projection, zoom and native paint drift fail closed', () => {
  for (const mutate of [h=>{h.terrain={source:'dem'};h.emit('terrain')},h=>{h.projection={type:'globe'};h.emit('projectiontransition')},h=>{h.zoom=16;h.emit('zoom')},h=>{h.getLayer('building-3d').setPaintProperty('fill-extrusion-height',9);h.emit('styledata')},h=>{h.getSource('openmaptiles').tiles=['other-version'];h.emit('styledata')}]) {
    const h=new Harness(),c=createNativeRoofDetails(h);activate(h,c);mutate(h);assert.equal(c.active,false);assert.equal(h.getLayoutProperty(ROOF_LAYER_ID,'visibility'),'none');h.idle();assert.equal(c.active,false);c.dispose();
  }
});
test('errors and style reload require explicit reenable, never restore stale native data', () => {
  const h=new Harness(),c=createNativeRoofDetails(h);activate(h,c);h.emit('error',{sourceId:'openmaptiles'});h.idle();assert.equal(c.status().enabled,false);assert.equal(c.active,false);
  activate(h,c);h.emit('style.load');assert.equal(c.status().enabled,false);assert.equal(h.getSource(ROOF_SOURCE_ID),undefined);h.idle();assert.equal(c.active,false);c.dispose();
});
test('partial add failure cleans owned source; existing foreign layer/source is untouched', () => {
  const h=new Harness();h.failAddLayer=true;const c=createNativeRoofDetails(h);c.enable();assert.equal(h.getSource(ROOF_SOURCE_ID),undefined);assert.equal(c.status().enabled,false);c.dispose();
  const h2=new Harness(),foreign={foreign:true};h2.sources.set(ROOF_SOURCE_ID,foreign);const c2=createNativeRoofDetails(h2);c2.enable();assert.equal(c2.active,false);c2.dispose();assert.equal(h2.getSource(ROOF_SOURCE_ID),foreign);
});
test('dispose preserves concurrently replaced layer/source and removes listeners', () => {
  const h=new Harness(),c=createNativeRoofDetails(h);activate(h,c);const foreign={foreign:true};h.sources.set(ROOF_SOURCE_ID,foreign);h.layers.set(ROOF_LAYER_ID,foreign);
  c.dispose();assert.equal(h.sources.get(ROOF_SOURCE_ID),foreign);assert.equal(h.layers.get(ROOF_LAYER_ID),foreign);assert.equal(h.eventNames().length,0);assert.throws(()=>c.enable(),/disposed/);
});
test('map removal releases listeners without accessing a destroyed style', () => {
  const h=new Harness(),c=createNativeRoofDetails(h);activate(h,c);
  h.getLayer=()=>{throw Error('destroyed style')};h.emit('remove');
  assert.equal(h.eventNames().length,0);assert.equal(c.status().reason,'map-removed');assert.equal(c.active,false);c.dispose();
});
