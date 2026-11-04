import {viewFor} from './view-policy.mjs';
import * as T from 'three';
import {Map,setWorkerUrl,Marker} from 'maplibre-gl';
import {mountRegionPack,frameFor} from './adapter.mjs';
import geography from './fixtures/app/assets/geography.json' with {type:'json'};
import {PLACES} from './fixtures/app/src/engine/places.ts';
setWorkerUrl('/integration/browser-dist/maplibre-gl-worker.mjs');
const errors=[];const map=new Map({container:'map',style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#dee8eb'}}]},...viewFor('entry'),attributionControl:false,interactive:false});
map.on('error',e=>errors.push(String(e.error)));
const frame=frameFor(geography),scene=new T.Scene(),camera=new T.Camera();
scene.add(new T.HemisphereLight(0xffffff,0x7d847b,2.0));const sun=new T.DirectionalLight(0xffefd7,2.1);sun.position.set(-200,600,300);scene.add(sun);
let renderer,mounted=null,ready=false,rendered=0,drawCalls=0,triangles=0;
const layer={id:'world-pack-proof',type:'custom',renderingMode:'3d',onAdd(map,gl){renderer=new T.WebGLRenderer({canvas:map.getCanvas(),context:gl,antialias:true});renderer.autoClear=false;renderer.outputColorSpace=T.SRGBColorSpace;},render(gl,args){camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(frame.toMercatorMatrix);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();renderer.resetState();renderer.render(scene,camera);rendered++;drawCalls=renderer.info.render.calls;triangles=renderer.info.render.triangles;}};
map.on('load',()=>{map.addLayer(layer);ready=true;map.triggerRepaint();});
for(const [label,ll,color]of [['HQ reference',geography.hq,'#e46f42'],['Commons origin',geography.commons,'#7046ba']]){const el=document.createElement('div');el.className='marker';el.style.background=color;el.textContent=label;new Marker({element:el}).setLngLat(ll).addTo(map);}
function alignment(){let max=0,n=0;for(const p of PLACES.filter(p=>p.zone==='neighborhood')){const q=frame.toScene(p.lng,p.lat),v=new T.Vector3(q.x,0,q.z).applyMatrix4(camera.projectionMatrix),mapPoint=map.project([p.lng,p.lat]);const x=(v.x+1)/2*map.getCanvas().clientWidth,y=(1-v.y)/2*map.getCanvas().clientHeight;max=Math.max(max,Math.hypot(x-mapPoint.x,y-mapPoint.y));n++;}return {places:n,maxPixelError:max};}
window.proof={get ready(){return ready},async enable(){if(mounted)return;const bytes=await(await fetch('/region-lod0.glb')).arrayBuffer();mounted=await mountRegionPack({parent:scene,bytes,geography,enabled:true});document.querySelector('#state').textContent='ON · opt-in regional GLB';map.triggerRepaint();},disable(){mounted?.dispose();mounted=null;document.querySelector('#state').textContent='OFF · no regional objects';map.triggerRepaint();},view(mode){map.jumpTo(viewFor(mode==='near'?'entry':'overview'));map.triggerRepaint();},metrics(){return {ready,enabled:!!mounted,rendered,drawCalls,triangles,alignment:alignment(),errors,threeRevision:T.REVISION,maplibreVersion:'6.16.0',canvasCount:document.querySelectorAll('canvas').length,webgl2:renderer?.getContext() instanceof WebGL2RenderingContext,viewport:[innerWidth,innerHeight],zoom:map.getZoom(),pitch:map.getPitch()}}};
