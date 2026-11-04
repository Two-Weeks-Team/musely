// Isolated diagnostic controller. No production import. Requires deliberate harness
// construction; default OFF. Never hides layers, changes geometry/filter or source.
import {circleOutline} from './region.mjs';
export const NATIVE_STYLE_ENABLED=false;
const targets=[['building','fill','fill-color'],['building-3d','fill-extrusion','fill-extrusion-color']];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function colorExpression(original,radius=500){
 const ring=circleOutline(radius).geometry.coordinates[0];
 const exterior={type:'Polygon',coordinates:[[[ -180,-90],[180,-90],[180,90],[-180,90],[-180,-90]],[...ring].reverse()]};
 // Only whole polygons safely within circle receive tint; others use original.
 return ['case',['all',['==',['geometry-type'],'Polygon'],['>',['distance',exterior],2]],'#B99B77',structuredClone(original??'#000000')];
}
export function createDiagnosticNativeStyle(map,{diagnosticHarness=false,radius=500}={}){
 if(!diagnosticHarness)throw Error('Diagnostic harness only; actual product GPU not validated');
 let active=false,stale=false,snapshots=[];
 function disable(){const conflicts=[];for(const s of snapshots){const l=map.getLayer(s.id);if(!stale&&l?.type===s.type&&l.source===s.source&&l.sourceLayer===s.sourceLayer&&same(map.getPaintProperty(s.id,s.property),s.owned)){map.setPaintProperty(s.id,s.property,s.original===undefined?null:structuredClone(s.original));}else conflicts.push(s.id)}active=false;snapshots=[];return{active,conflicts};}
 const onStyleLoad=()=>{stale=true;active=false;};map.on('style.load',onStyleLoad);
 return {get active(){return active},enable(){if(active)return{active:true,changed:0};if(snapshots.length)disable();stale=false;
 const plans=targets.map(([id,type,property])=>{const l=map.getLayer(id);if(l?.type!==type||l.source!=='openmaptiles'||l.sourceLayer!=='building')throw Error('Native building contract changed');const original=structuredClone(map.getPaintProperty(id,property));return{id,type,source:l.source,sourceLayer:l.sourceLayer,property,original,owned:colorExpression(original,radius)}});
 try{for(const p of plans){snapshots.push(p);map.setPaintProperty(p.id,p.property,p.owned)}active=true;return{active:true,changed:plans.length};}catch(e){disable();throw e}},disable,dispose(){const result=disable();map.off('style.load',onStyleLoad);return result}};
}

/** Feature-OFF runtime seam: caller may opt into the native-only color mode.
 * Never load/mount the regional GLB in this mode. Existing native geometry remains.
 * No application bootstrap imports this function automatically.
 */
export function createNativePreservingStyle(map,{enabled=false,radius=500}={}) {
 const controller=createDiagnosticNativeStyle(map,{diagnosticHarness:true,radius});
 try {if(enabled)controller.enable();} catch(error){controller.dispose();throw error;}
 return controller;
}
export const NATIVE_ONLY_RENDER_POLICY=Object.freeze({buildings:'native',roads:'native',water:'native',ground:'native',regionalGlb:false,extraProps:false});
