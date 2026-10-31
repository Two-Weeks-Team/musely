import * as T from 'three';
import {applyFaceControls} from './FaceControls';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import clipManifest from '../../character-kit/runtime/animations/manifest.json';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
declare global {interface Window {__jolly:any}}
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
const errors:string[]=[];let root:T.Group,mixer:T.AnimationMixer,actions:Record<string,T.AnimationAction>={},active='idle_breathe',expression='Neutral',time=0,paused=false,lighting='studio';
const meshes:T.Mesh[]=[];const expressions=['Neutral','Smile','Curious','Thinking','Focused','Listening','Concerned','Delight'];
function setExpression(name:string){expression=name;applyFaceControls(meshes,name,0,0,0);}
function setAction(name:string){const next=actions[name];if(!next)return;const old=actions[active];if(old!==next){old?.fadeOut(.25);next.reset().fadeIn(.25).play();}else next.play();active=name;}
function setLighting(name:string){lighting=name;const night=name==='night',day=name==='daylight';scene.background=new T.Color(night?'#1b2436':day?'#dce5df':'#e9e7de');scene.environmentIntensity=night?.14:.35;hemi.intensity=night?.75:.7;key.color.set(night?'#ffb869':'#fff1db');key.intensity=night?1.6:day?2.5:1.8;fill.intensity=night?.65:.5;rim.intensity=night?.8:1;renderer.toneMappingExposure=night?1.3:.95;}
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe(stage);resize();
document.querySelector('#lighting')!.addEventListener('change',e=>setLighting((e.target as HTMLSelectElement).value));
document.querySelector('#action')!.addEventListener('change',e=>setAction((e.target as HTMLSelectElement).value));
document.querySelector('#expression')!.addEventListener('change',e=>setExpression((e.target as HTMLSelectElement).value));
document.querySelector('#orbit')!.addEventListener('click',e=>{controls.autoRotate=!controls.autoRotate;(e.target as HTMLElement).setAttribute('aria-pressed',String(controls.autoRotate));});
document.querySelector('#pause')!.addEventListener('click',e=>{paused=!paused;(e.target as HTMLElement).textContent=paused?'Resume motion':'Pause motion';});
document.querySelector('#face')!.addEventListener('click',()=>{camera.position.set(0,.72,.76);controls.target.set(0,.68,0);});
document.querySelector('#whole')!.addEventListener('click',()=>{camera.position.set(.8,.68,1.9);controls.target.set(0,.45,0);});
let last=performance.now();
renderer.setAnimationLoop(()=>{const now=performance.now(),dt=Math.min((now-last)/1000,.1);last=now;if(!paused){time+=dt;mixer?.update(dt);}const blink=Math.max(0,1-Math.abs((time%4.6)-4.35)/.11);applyFaceControls(meshes,expression,blink,blink,active==='talk'?Math.max(0,Math.sin(time*13))*.65:0);controls.update();renderer.render(scene,camera);});
try{
 const gltf=await new GLTFLoader().loadAsync('./character-kit/runtime/base/lod0.glb');root=gltf.scene;scene.add(root);mixer=new T.AnimationMixer(root);
 root.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;meshes.push(o);}});
 for(const clip of gltf.animations){const a=mixer.clipAction(clip);if(clipManifest.clips.find(c=>c.name===clip.name)?.loop===false){a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;}actions[clip.name]=a;}
 setExpression('Neutral');
 if(actions.idle_breathe)actions.idle_breathe.play();
 const actionSelect=document.querySelector('#action') as HTMLSelectElement;actionSelect.innerHTML='';for(const name of Object.keys(actions)){const o=document.createElement('option');o.value=name;o.textContent=name.replaceAll('_',' ');actionSelect.add(o);}actionSelect.value='idle_breathe';
 const expressionSelect=document.querySelector('#expression') as HTMLSelectElement;for(const name of expressions){const o=document.createElement('option');o.value=name;o.textContent=name;expressionSelect.add(o);}
 const stats={height:new T.Box3().setFromObject(root).getSize(new T.Vector3()).y,triangles:meshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0),skins:meshes.filter(m=>m instanceof T.SkinnedMesh).length};
 document.querySelector('#status')!.textContent=`${stats.height.toFixed(3)} m · ${stats.triangles.toLocaleString()} triangles · ${Object.keys(actions).length} actions`;
 window.__jolly={root,scene,camera,controls,mixer,actions,setAction,setExpression,setLighting,getMetrics:()=>({ready:true,...stats,active,expression,lighting,time,paused,drawCalls:renderer.info.render.calls,errors,clips:Object.keys(actions),materials:meshes.flatMap(m=>(Array.isArray(m.material)?m.material:[m.material]).map(a=>{const s=a as T.MeshStandardMaterial;return{name:s.name,normal:!!s.normalMap,colorMap:!!s.map,roughnessMap:!!s.roughnessMap,emission:s.emissive?.toArray()};})),morphs:[...new Set(meshes.flatMap(m=>Object.keys(m.morphTargetDictionary??{})))]})};
 document.querySelector('#loading')!.remove();
}catch(e){errors.push(String(e));document.querySelector('#loading')!.textContent='The character could not load.';console.error(e);}
