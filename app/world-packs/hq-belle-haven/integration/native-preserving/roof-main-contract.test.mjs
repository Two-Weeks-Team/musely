import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {stripTypeScriptTypes} from 'node:module';
import * as T from 'three';
import {MercatorCoordinate} from 'maplibre-gl';
import {centerLngLat,sceneToGeo} from './region.mjs';
import {ROOF_POLICY} from './roof-geometry.mjs';

// Unlike the older explicitly pinned historical fixtures, these files are the
// actual checked-out app. CI must notice drift in the live integration contract.
const read = p=>fs.readFileSync(new URL('../../../../'+p,import.meta.url),'utf8');
const main=read('src/main.ts'), style=JSON.parse(read('assets/map-style.json'));
const geography=JSON.parse(read('assets/geography.json'));
const fixtureStyle=JSON.parse(fs.readFileSync(new URL('current-main-map-style.json',import.meta.url),'utf8'));
test('current checkout preserves native style, geography, place and dependency contracts',()=>{
  assert.deepEqual(style,fixtureStyle);
  assert.deepEqual(geography,JSON.parse(fs.readFileSync(new URL('../fixtures/app/assets/geography.json',import.meta.url),'utf8')));
  assert.equal(read('src/engine/places.ts'),fs.readFileSync(new URL('../fixtures/app/src/engine/places.ts',import.meta.url),'utf8'));
  assert.equal(JSON.parse(read('package.json')).dependencies['maplibre-gl'],'6.16.0');
  assert.equal(JSON.parse(fs.readFileSync(createRequire(import.meta.url).resolve('maplibre-gl/package.json'),'utf8')).version,'6.16.0');
  assert.ok(main.includes('map.triggerRepaint()'));
  assert.ok(main.includes('if(visualSettings.roofs)roofVisual=createNativeRoofDetails(map,{enabled:true,radius:500})'),'product explicitly enables native-only roof details behind its maintenance kill setting');
  assert.ok(!main.includes('createNativePreservingStyle')&&!main.includes('mountWorldPack'),'archival regional GLB and color replacement are not product entry paths');
});
test('actual main coordinates and entry camera match the roof diagnostic including subdivision maxZoom',()=>{
  const declarations=main.split('\n').filter(l=>/^const (anchor=|gridYaw=|toGeo=|localMatrix=)/.test(l)).join('\n');
  const actual=Function('geography','MercatorCoordinate','T',stripTypeScriptTypes(declarations)+';return {toGeo};')(geography,MercatorCoordinate,T);
  for(const [x,z] of [[0,2],[100,0],[-300,300]]){
    const p=actual.toGeo(x,z), expected=sceneToGeo(x,z);
    assert.ok(Math.abs(p.lng-expected[0])<1e-10&&Math.abs(p.lat-expected[1])<1e-10);
  }
  assert.deepEqual(sceneToGeo(0,2),centerLngLat);
  const product=main.match(/const map=new LibreMap\(([^\n]+)\);/)[1];
  const diagnostic=fs.readFileSync(new URL('roof-browser-entry.mjs',import.meta.url),'utf8');
  for(const field of ['maxZoom','minZoom','maxPitch','pitch']){
    const re=new RegExp(`${field}:([\\d.]+)`);
    assert.equal(diagnostic.match(re)[1],product.match(re)[1],field);
  }
  assert.ok(product.includes(':21.2')); assert.ok(diagnostic.includes('zoom:21.2'));
  assert.ok(!product.includes('zoomLevelsToOverscale')&&!diagnostic.includes('zoomLevelsToOverscale'),'both use installed v6 default');
});
test('reverified live TileJSON pins parent maxzoom while child canonical zooms remain separate',()=>{
  const receipt=JSON.parse(fs.readFileSync(new URL('roof-fixtures/receipts.json',import.meta.url),'utf8'));
  const bytes=fs.readFileSync(new URL('roof-fixtures/tilejson.json',import.meta.url));
  assert.equal(bytes.length,receipt.tileJSON.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),receipt.tileJSON.sha256);
  const tilejson=JSON.parse(bytes);
  assert.equal(tilejson.maxzoom,ROOF_POLICY.sourceZoom);
  assert.deepEqual(tilejson.tiles,[ROOF_POLICY.tileTemplate]);
  assert.ok(ROOF_POLICY.maxCanonicalZoom>tilejson.maxzoom);
});
