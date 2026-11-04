import test,{after} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import * as maplibre from 'maplibre-gl';
import style from './current-main-map-style.json' with {type:'json'};import {createNativePreservingStyle} from './style-controller.mjs';
// Actual installed 6.16 StyleLayer classes, not a serialized StyleSpecification mock.
// TS type-only class declarations must not overwrite fields initialized by super().
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'musely-stylelayer-'));
after(()=>fs.rm(directory,{recursive:true,force:true}));
const out=path.join(directory,'layers.mjs'),integration=new URL('../',import.meta.url).pathname;
await build({stdin:{contents:"export {FillStyleLayer} from './node_modules/maplibre-gl/src/style/style_layer/fill_style_layer.ts'; export {FillExtrusionStyleLayer} from './node_modules/maplibre-gl/src/style/style_layer/fill_extrusion_style_layer.ts';",resolveDir:integration},tsconfigRaw:{compilerOptions:{useDefineForClassFields:false}},bundle:true,platform:'node',format:'esm',outfile:out});
const {FillStyleLayer,FillExtrusionStyleLayer}=await import(pathToFileURL(out).href);
class RuntimeLayerHarness extends EventEmitter{
 constructor(){super();this.layers=new Map(style.layers.filter(l=>['building','building-3d'].includes(l.id)).map(l=>[l.id,new (l.type==='fill'?FillStyleLayer:FillExtrusionStyleLayer)(structuredClone(l),{})]));this.style={getLayer:id=>this.layers.get(id),getPaintProperty:(id,p)=>this.layers.get(id).getPaintProperty(p)};this.writes=[];}
 getLayer(id){return maplibre.Map.prototype.getLayer.call(this,id)}
 getPaintProperty(id,p){return maplibre.Map.prototype.getPaintProperty.call(this,id,p)}
 setPaintProperty(id,p,v){this.writes.push([id,p]);this.layers.get(id).setPaintProperty(p,v)}
}
test('real Map getLayer returns real StyleLayer sourceLayer, never serialized source-layer',()=>{const m=new RuntimeLayerHarness();for(const id of ['building','building-3d']){const l=m.getLayer(id);assert.equal(l.sourceLayer,'building');assert.equal(l['source-layer'],undefined);assert.equal(l,m.layers.get(id));assert.equal(l.serialize()['source-layer'],'building')}});
test('actual StyleLayer enable and disable restore original paints and keep geometry contract',()=>{const m=new RuntimeLayerHarness(),before=new Map([...m.layers].map(([id,l])=>[id,l.serialize()])),c=createNativePreservingStyle(m);assert.equal(m.writes.length,0);assert.equal(c.enable().changed,2);assert.equal(c.active,true);assert.ok(Array.isArray(m.getPaintProperty('building-3d','fill-extrusion-color')));const result=c.disable();assert.deepEqual(result.conflicts,[]);for(const [id,l] of m.layers)assert.deepEqual(l.serialize(),before.get(id));c.dispose()});
test('actual StyleLayer sourceLayer drift blocks enable and prevents stale restore',()=>{const m=new RuntimeLayerHarness(),c=createNativePreservingStyle(m);m.getLayer('building-3d').sourceLayer='not-building';assert.throws(()=>c.enable(),/contract/);assert.equal(m.writes.length,0);m.getLayer('building-3d').sourceLayer='building';c.enable();m.getLayer('building-3d').sourceLayer='changed';assert.deepEqual(c.disable().conflicts,['building-3d']);c.dispose()});
test('real layer color edited by main is preserved on disposal',()=>{const m=new RuntimeLayerHarness(),c=createNativePreservingStyle(m,{enabled:true});m.getLayer('building-3d').setPaintProperty('fill-extrusion-color','#F0F0F0');assert.deepEqual(c.dispose().conflicts,['building-3d']);assert.equal(m.getPaintProperty('building-3d','fill-extrusion-color'),'#F0F0F0')});
