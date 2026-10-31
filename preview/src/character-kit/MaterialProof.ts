import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {MaterialLibrary,loadMuse} from './MaterialLibrary';
import type {MuseActor,Lod} from './MuseActor';
import {MUSE_VARIANTS,SHARED_CLIPS,EXPRESSIONS,SINGLE_PLAY,variantById,type MuseVariantId} from './catalog';
declare global {interface Window {__jolly:any}}

// In-demo viewer for the ten-character Muse family, using the same runtime files as the world.
const stage=document.querySelector('#stage') as HTMLElement;
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=T.SRGBColorSpace;
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;stage.append(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#e9e7de');
const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();scene.environment=env.texture;scene.environmentIntensity=.35;
const camera=new T.PerspectiveCamera(30,1,.01,100);camera.position.set(.8,.68,1.9);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.45,0);controls.enableDamping=true;controls.minDistance=.45;controls.maxDistance=4;controls.maxPolarAngle=Math.PI*.51;
const hemi=new T.HemisphereLight('#f5f7ff','#a5957b',.7);scene.add(hemi);
const key=new T.DirectionalLight('#fff1db',1.8);key.position.set(-1.5,2.8,2);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-1;key.shadow.camera.right=1;key.shadow.camera.top=1.4;key.shadow.camera.bottom=-1;key.shadow.normalBias=.015;scene.add(key);
const fill=new T.DirectionalLight('#bdcee7',.5);fill.position.set(2,1,1);scene.add(fill);
const rim=new T.DirectionalLight('#fff4db',1.0);rim.position.set(.5,1.4,-2);scene.add(rim);
const ground=new T.Mesh(new T.CircleGeometry(20,96),new T.ShadowMaterial({color:'#675c49',opacity:.17}));ground.rotation.x=-Math.PI/2;ground.position.y=-.003;ground.receiveShadow=true;scene.add(ground);

const library=new MaterialLibrary('/character-kit/runtime/');
const errors:string[]=[];
let actor:MuseActor|null=null,variant:MuseVariantId='00-jolly',active='idle_breathe',expression='Neutral',time=0,actionStart=0,paused=false,lighting='studio',lod:Lod=0,loading=0;
const $=<E extends HTMLElement>(s:string)=>document.querySelector(s) as E;
const actionSelect=$<HTMLSelectElement>('#action'),expressionSelect=$<HTMLSelectElement>('#expression');

function clipsFor(id:MuseVariantId){const sig=variantById(id).signature;return [...SHARED_CLIPS,...(sig?[sig]:[])];}
function setExpression(name:string){expression=name;actor?.setExpression(name);}
function setAction(name:string){if(!clipsFor(variant).includes(name as never))return;active=name;actionStart=time;actor?.setAction(name);actionSelect.value=name;}
function setLod(l:Lod){lod=l;actor?.setLod(l);($('#lod') as HTMLSelectElement).value=String(l);}
function setLighting(name:string){lighting=name;const night=name==='night',day=name==='daylight';scene.background=new T.Color(night?'#1b2436':day?'#dce5df':'#e9e7de');scene.environmentIntensity=night?.14:.35;hemi.intensity=night?.75:.7;key.color.set(night?'#ffb869':'#fff1db');key.intensity=night?1.6:day?2.5:1.8;fill.intensity=night?.65:.5;rim.intensity=night?.8:1;renderer.toneMappingExposure=night?1.3:.95;}
async function setVariant(id:MuseVariantId){
 const ticket=++loading;variant=id;const v=variantById(id);
 $('#name').textContent=v.name;$('#role').textContent=v.role.toUpperCase()+' · '+id.slice(0,2);$('#personality').textContent=v.personality;
 document.querySelectorAll<HTMLButtonElement>('.roster button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===id)));
 actionSelect.innerHTML='';for(const name of clipsFor(id)){const o=document.createElement('option');o.value=name;o.textContent=name.replaceAll('_',' ')+(name===v.signature?' ★':'');actionSelect.add(o);}
 try{
  const next=await loadMuse(id,library);if(ticket!==loading){next.dispose();return;}
  actor?.dispose();actor=next;scene.add(actor.root);actor.root.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;}});
  setLod(lod);setExpression(expression);setAction(v.signature??'idle_breathe');
  const m=actor.getMetrics();$('#status').textContent=`${(m.bounds.max.y-m.bounds.min.y).toFixed(3)} m · ${actor.visibleTriangles().toLocaleString()} triangles · ${clipsFor(id).length} actions · LOD${lod}`;
  $('#loading')?.remove();
 }catch(e){errors.push(String(e));$('#status').textContent='This Muse could not load.';console.error(e);}
}
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe(stage);resize();

const roster=$('.roster');
for(const v of MUSE_VARIANTS){const b=document.createElement('button');b.type='button';b.dataset.id=v.id;b.style.setProperty('--muse',v.body);b.style.setProperty('--accent',v.accent);b.innerHTML=`<i></i><span>${v.name}</span>`;b.title=`${v.name} · ${v.role}`;b.onclick=()=>setVariant(v.id);roster.append(b);}
for(const name of EXPRESSIONS){const o=document.createElement('option');o.value=name;o.textContent=name;expressionSelect.add(o);}
$('#lighting').addEventListener('change',e=>setLighting((e.target as HTMLSelectElement).value));
actionSelect.addEventListener('change',e=>setAction((e.target as HTMLSelectElement).value));
expressionSelect.addEventListener('change',e=>setExpression((e.target as HTMLSelectElement).value));
$('#lod').addEventListener('change',e=>setLod(Number((e.target as HTMLSelectElement).value) as Lod));
$('#orbit').addEventListener('click',e=>{controls.autoRotate=!controls.autoRotate;(e.target as HTMLElement).setAttribute('aria-pressed',String(controls.autoRotate));});
$('#pause').addEventListener('click',e=>{paused=!paused;(e.target as HTMLElement).textContent=paused?'Resume motion':'Pause motion';});
$('#face').addEventListener('click',()=>{camera.position.set(0,.72,.76);controls.target.set(0,.68,0);});
$('#whole').addEventListener('click',()=>{camera.position.set(.8,.68,1.9);controls.target.set(0,.45,0);});
($('#world-link') as HTMLAnchorElement).href=location.pathname.includes('/characters')?'../':'./world/';

let last=performance.now();
renderer.setAnimationLoop(()=>{const now=performance.now(),dt=Math.min((now-last)/1000,.1);last=now;if(!paused)time+=dt;
 if(actor)actor.update(time,{x:0,y:0,z:0,yaw:0},SINGLE_PLAY.has(active)?time-actionStart:time*variantById(variant).tempo);
 controls.update();renderer.render(scene,camera);});

window.__jolly={scene,camera,controls,setVariant,setAction,setExpression,setLighting,setLod,get root(){return actor?.root;},
 getMetrics:()=>{const mats=actor?actor.visibleMaterials():[];return {ready:!!actor&&loading>0,variant,lod,active,expression,lighting,time,paused,errors,
  height:actor?(()=>{const b=actor!.getBounds();return b.max.y-b.min.y;})():0,triangles:actor?.visibleTriangles()??0,skins:actor?actor.meshes.filter(m=>m.visible&&m.parent?.visible!==false).length:0,
  drawCalls:renderer.info.render.calls,clips:clipsFor(variant),
  materials:mats.map(m=>({name:m.material,normal:m.normal,colorMap:m.map,color:m.color})),
  morphs:actor?[...new Set(actor.meshes.flatMap(m=>Object.keys(m.morphTargetDictionary??{})))]:[]};}};
const requested=new URLSearchParams(location.search).get('muse');
setLighting('studio');
await setVariant(MUSE_VARIANTS.some(v=>v.id===requested)?requested as MuseVariantId:'00-jolly');
