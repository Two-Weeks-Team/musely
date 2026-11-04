import {Map,setWorkerUrl} from 'maplibre-gl';
import style from './current-main-map-style.json';
import geography from '../fixtures/app/assets/geography.json';
import {centerLngLat} from './region.mjs';
import {createDiagnosticNativeStyle} from './style-controller.mjs';
setWorkerUrl(new URL('./maplibre-gl-worker.mjs',import.meta.url).href);
const status=document.querySelector('#status'),errors=[];
const map=new Map({container:'map',style,center:centerLngLat,zoom:18,pitch:54,bearing:geography.cameraBearingDeg,preserveDrawingBuffer:true});
let controller;const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
map.on('error',e=>{errors.push(String(e.error));status.textContent='Map error: '+String(e.error)});
map.once('load',()=>{controller=createDiagnosticNativeStyle(map,{diagnosticHarness:true,radius:500});buttons.forEach(b=>b.disabled=false);status.textContent='Native map ON; tint OFF; no GLB; live tiles are not fixed-pack-verified.';});
document.querySelector('#original').onclick=()=>{const result=controller.disable();status.textContent=`Native map ON; tint OFF; conflicts: ${result.conflicts.join(',')||'none'}`};
document.querySelector('#tint').onclick=()=>{controller.enable();status.textContent='Native map ON; circle tint ON; geometry/filter/height/source unchanged; no GLB.'};
document.querySelector('#entry').onclick=()=>map.jumpTo({center:centerLngLat,zoom:21.2,pitch:54,bearing:geography.cameraBearingDeg});
document.querySelector('#near').onclick=()=>map.jumpTo({center:centerLngLat,zoom:18,pitch:54,bearing:geography.cameraBearingDeg});
document.querySelector('#wide').onclick=()=>map.jumpTo({center:centerLngLat,zoom:16,pitch:54,bearing:geography.cameraBearingDeg});
// Diagnostic evidence only; no hidden layer toggles or automatic style changes.
window.nativeStyleProof={map,getState:()=>({tint:controller?.active??false,errors:[...errors],camera:{center:map.getCenter(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()},sourceLoaded:map.isSourceLoaded('openmaptiles'),renderedBuildings:map.queryRenderedFeatures({layers:['building','building-3d']}).length,noGLB:true}),dispose:()=>controller?.dispose()};
