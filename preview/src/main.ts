import {Map as LibreMap,MercatorCoordinate,Marker,setWorkerUrl,setWorkerCount,type CustomLayerInterface,type StyleSpecification} from 'maplibre-gl';
import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {makeWorld,PEOPLE} from './scene';
import {makeClock,advance,activityAt,positionAt,ROUNDS,FIXTURE_LABEL} from './activity';
import {surfaceHeightAt} from './surfaces';
import {tourCameraAt} from './camera';
import {makeBubbles} from './bubbles';
import {DURATION,LINES,conversationAt,chapterAt,stateAt} from './story';
import assetData from '../assets/embedded.json';
import {MaterialLibrary,clipsUrl} from './character-kit/MaterialLibrary';
import {lodUrl} from './character-kit/catalog';
import {sparkStatus,statusLabel,type SparkStatus} from './live';
import style from '../assets/map-style.json';
import geography from '../assets/geography.json';
import arrivalMap from '../assets/arrival-map.json';
declare global {interface Window {__world:any}}
// Official worker code compiled to an embedded classic bundle; .cjs selects its supported worker mode.
// File origins use a data URL so the factory can load the code before creating its classic Blob worker.
setWorkerUrl(location.protocol==='file:'?'data:text/javascript;charset=utf-8,'+encodeURIComponent(assetData.worker)+'#maplibre-worker.cjs':URL.createObjectURL(new Blob([assetData.worker],{type:'text/javascript'}))+'#maplibre-worker.cjs');setWorkerCount(2);
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const anchor=geography.commons as [number,number],origin=MercatorCoordinate.fromLngLat(anchor,0),unit=origin.meterInMercatorCoordinateUnits();
// The authored commons is turned to the surrounding mapped road grid (local +x runs along the grid's 30° streets).
const gridYaw=geography.gridBearingDeg*Math.PI/180,gridCos=Math.cos(gridYaw),gridSin=Math.sin(gridYaw),BEARING=geography.cameraBearingDeg;
const toGeo=(x:number,z:number)=>new MercatorCoordinate(origin.x+(x*gridCos-z*gridSin)*unit,origin.y+(x*gridSin+z*gridCos)*unit,0).toLngLat();
const autoplay=new URLSearchParams(location.search).get('autoplay')!=='0';
// The rigged ten-character kit is the default; ?characters=legacy shows the earlier rigid preview characters.
const useKit=new URLSearchParams(location.search).get('characters')!=='legacy';
if(autoplay)document.body.classList.add('story-mode');
// Start the light character files (LOD2 + clips) before the map competes for bandwidth; makeWorld reuses these parses.
const kitLibrary=useKit?new MaterialLibrary('/character-kit/runtime/'):undefined;if(kitLibrary){kitLibrary.load(lodUrl(2,kitLibrary.base)).catch(()=>{});kitLibrary.load(clipsUrl(kitLibrary.base)).catch(()=>{});}
let clock=makeClock(),lifeTime=0,last=performance.now(),selected=0,follow=false,tour=false,tourCamera=false,ownerDecision='pending',ready=false,lastUI=0;
const statuses:string[]=[],errors:string[]=[];let frame=0,drawCalls=0,triangles=0,fps=0,fpsFrames=0,fpsStart=performance.now();
// The embedded overview renders first. Online tiles join once the light character files (LOD2 + clips)
// arrive, or after 4 s: on slow first visits the tile downloads would otherwise take the bandwidth the
// commons needs to appear (direction: commons, residents and story within 8 s).
const initialStyle={...style,sources:{'arrival-overview':{type:'geojson',data:arrivalMap}},layers:[style.layers[0],{id:'arrival-water',type:'fill',source:'arrival-overview',maxzoom:14,filter:['==',['get','kind'],'water'],paint:{'fill-color':'#101623'}},{id:'arrival-roads',type:'line',source:'arrival-overview',maxzoom:14,filter:['==',['get','kind'],'transportation'],paint:{'line-color':'#35415A','line-width':1.2,'line-opacity':.6}}]};
const kitLight=kitLibrary?Promise.all([kitLibrary.load(lodUrl(2,kitLibrary.base)),kitLibrary.load(clipsUrl(kitLibrary.base))]).then(()=>'kit',()=>'kit-failed'):Promise.resolve('no-kit');
let onlineMapAddedAtMs=0;
function addOnlineMap(){if(onlineMapAddedAtMs)return;onlineMapAddedAtMs=performance.now();for(const [id,source] of Object.entries(style.sources))map.addSource(id,source as any);const before=map.getLayer('musely-world')?'musely-world':undefined;for(const layer of style.layers.slice(1))map.addLayer(layer as any,before);}
let sceneReadyAtMs=0,onlineMapReadyAtMs=0,detailReadyAtMs=0;
const map=new LibreMap({container:'map',style:initialStyle as unknown as StyleSpecification,center:anchor,zoom:innerWidth<700?9.6:10.25,pitch:54,bearing:BEARING,minZoom:8,maxZoom:23.8,maxPitch:65,attributionControl:false,canvasContextAttributes:{antialias:true,preserveDrawingBuffer:true},fadeDuration:200});
map.on('styleimagemissing',e=>{if(!map.hasImage(e.id))map.addImage(e.id,{width:1,height:1,data:new Uint8Array(4)});});
map.dragRotate.disable();map.touchZoomRotate.disableRotation();
function manual(){follow=false;tourCamera=false;$('tour').classList.remove('active');$('follow').classList.remove('active');if(!tour)$('tour').textContent='Play story · 3:30';}
map.getCanvas().addEventListener('wheel',manual,{passive:true});
map.getCanvas().addEventListener('pointerdown',manual,{passive:true});
map.getCanvas().addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(e.key))manual();});
map.on('dragstart',e=>{if(e.originalEvent)manual();});map.on('zoomstart',e=>{if(e.originalEvent)manual();});map.on('pitchstart',e=>{if(e.originalEvent)manual();});
map.on('error',e=>{const text=String(e.error?.message||e.error);errors.push(text);$('network-note').hidden=false;$('network-note').textContent='Some map details could not load. Check your connection.';});
const pin=document.createElement('button');pin.className='place-pin';pin.type='button';pin.innerHTML='<span class="pin-star">✳</span><span>The commons<small>8 Muses · an imagined place at HQ</small></span>';pin.setAttribute('aria-label','Visit the commons');pin.onclick=()=>visit(21.2);
const marker=new Marker({element:pin,anchor:'bottom',offset:[0,-8]}).setLngLat(anchor).addTo(map);
function visit(zoom=21.7){manual();map.flyTo({center:anchor,zoom,pitch:54,bearing:BEARING,duration:4500,essential:true});}
$('visit').onclick=()=>visit();$('bay').onclick=()=>{manual();map.flyTo({center:anchor,zoom:10.25,pitch:42,bearing:BEARING,duration:5000,essential:true});};
$('plus').onclick=()=>{manual();map.zoomIn({duration:500});};$('minus').onclick=()=>{manual();map.zoomOut({duration:500});};
$('follow').onclick=()=>{manual();follow=true;$('follow').classList.add('active');const p=positionAt(selected,lifeTime);map.flyTo({center:toGeo(p.x,p.z),zoom:22.7,pitch:55,bearing:BEARING,duration:2300,essential:true});};
$('pause').onclick=()=>{clock.paused=!clock.paused;$('pause').textContent=clock.paused?'Resume world':'Pause world';$('pause').setAttribute('aria-pressed',String(clock.paused));if(clock.paused)map.stop();};
function startStory(){follow=false;clock=makeClock();lifeTime=0;selected=0;ownerDecision='pending';$('decision-note').textContent='Local interaction only. Nothing is sent or booked.';tour=true;tourCamera=true;document.body.classList.add('story-mode');$('tour').classList.add('active');$('tour').textContent='Story · 0:00 / 3:30';$('pause').textContent='Pause world';$('pause').setAttribute('aria-pressed','false');map.jumpTo({center:anchor,zoom:innerWidth<700?9.6:10.25,pitch:54,bearing:BEARING});last=performance.now();}
$('tour').onclick=startStory;
function seekStory(t:number){follow=false;$('follow').classList.remove('active');clock.elapsed=Math.max(0,Math.min(DURATION,t));clock.tourFinished=clock.elapsed>=DURATION;lifeTime=clock.elapsed;tour=!clock.tourFinished;tourCamera=true;bubbles?.invalidate();if(clock.tourFinished){$('tour').textContent='Replay story · 3:30';$('tour').classList.remove('active');}updateUI();}
$('story-scrubber').oninput=()=>seekStory(Number(($('story-scrubber') as HTMLInputElement).value));
$('about').onclick=()=>$('about-dialog').showPopover();$('close-about').onclick=()=>$('about-dialog').hidePopover();
$('meetup').onclick=()=>$('meetup-dialog').showPopover();$('close-meetup').onclick=()=>$('meetup-dialog').hidePopover();
$('approve').onclick=()=>{ownerDecision='approved';$('decision-note').textContent='Approved in this local preview. No invitation was sent.';updateUI();};
$('decline').onclick=()=>{ownerDecision='declined';$('decision-note').textContent='Declined in this local preview. No invitation was sent.';updateUI();};
$('fixture-label').textContent=FIXTURE_LABEL;
const roundList=$('rounds');ROUNDS.forEach((r,i)=>{const el=document.createElement('li');el.innerHTML=`<div><b>PROPOSE R${i+1} · ${r.time} · ${r.place}</b><small> · Jimin's Muse ${r.jimin?'✓ yes':'✕ no'} · Sora's Muse ✓ yes</small></div>`;roundList.append(el);});
const portraits=$('portraits');PEOPLE.forEach((p,i)=>{const b=document.createElement('button');b.type='button';b.className='portrait';b.style.setProperty('--muse',p.color);b.innerHTML='<span class="muse-icon"><i></i></span>';b.setAttribute('aria-label','Select '+p.name);b.setAttribute('title',p.name);b.onclick=()=>select(i);portraits.append(b);});
function select(i:number){selected=i;manual();updateUI();if(map.getZoom()<20)visit(21.5);}
const WANTS=['to meet Sora again at the cafe, and keep a promise.','a hello that turns into a walk, not just a wave.','someone to listen with by the fire.','a seed to trade, so the garden can grow.','quiet company, not small talk.','to be a neighbor people can count on.','to keep a seat for a friend, and be remembered.','the long way home, and something new to bring back.'];
function updateUI(){($('story-scrubber') as HTMLInputElement).value=String(clock.elapsed);const p=PEOPLE[selected],t=Math.min(lifeTime,DURATION),chapter=chapterAt(t),turn=conversationAt(t);$('muse-name').textContent=p.name;$('muse-role').textContent=(selected===0?'YOUR MUSE':'A FAMILIAR FACE')+' · '+stateAt(selected,lifeTime);$('avatar-large').style.setProperty('--muse',p.color);$('activity-title').textContent=chapter.title;$('muse-want').innerHTML='Wants: '+WANTS[selected]+' <small>Its reasons stay private.</small>';$('activity-detail').textContent=turn?PEOPLE[turn.person].name+': '+turn.text:t<14?'Little stories are already unfolding around the Bay.':'Your Muse can connect. The next commitment is still yours.';$('meetup').hidden=selected!==0;$('muse-card').hidden=map.getZoom()<20.35;$('decision-state').textContent=ownerDecision==='approved'?'Local preview · approved':ownerDecision==='declined'?'Local preview · declined':'Your confirmation comes first';portraits.querySelectorAll('button').forEach((b,i)=>{b.classList.toggle('selected',i===selected);b.setAttribute('aria-pressed',String(i===selected));});$('welcome').hidden=document.body.classList.contains('story-mode')||map.getZoom()>20.5;$('place-line').textContent=map.getZoom()<14?'LITTLE STORIES AROUND THE BAY':map.getZoom()<20?'MENLO PARK · CALIFORNIA':'HQ · THE LITTLE COMMONS';pin.hidden=map.getZoom()>20.2||map.getZoom()<18.3;
$('story-title').textContent=chapter.title;$('story-speaker').textContent=turn?PEOPLE[turn.person].name:'Around the Bay';const candidate=$('story-candidate');candidate.hidden=turn?.round===undefined;if(turn?.round!==undefined){const r=ROUNDS[turn.round];candidate.textContent=`${r.time} · ${r.place}    Jimin ${r.jimin?'✓ yes':'✕ no'} · Sora ✓ yes`;}
}
updateUI();
let spark:SparkStatus|null=null;
void sparkStatus().then(s=>{spark=s;const l=statusLabel(s),el=$('spark-status');el.textContent=l.text;el.title=l.title;el.dataset.state=l.state;});
let bubbles:ReturnType<typeof makeBubbles>;
let world:Awaited<ReturnType<typeof makeWorld>>,renderer:T.WebGLRenderer,camera:T.Camera,projection=new T.Matrix4();
const localMatrix=new T.Matrix4().makeTranslation(origin.x,origin.y,origin.z).multiply(new T.Matrix4().makeScale(unit,-unit,unit)).multiply(new T.Matrix4().makeRotationX(Math.PI/2)).multiply(new T.Matrix4().makeRotationY(-gridYaw));
const layer:CustomLayerInterface={id:'musely-world',type:'custom',renderingMode:'3d',onAdd(_map,gl){renderer=new T.WebGLRenderer({canvas:map.getCanvas(),context:gl as WebGL2RenderingContext,antialias:true});renderer.autoClear=false;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.NoToneMapping;renderer.toneMappingExposure=1.15;camera=new T.Camera();if(world?.actors){const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();world.scene.environment=pmrem.fromScene(room,.04).texture;world.scene.environmentIntensity=.12;room.dispose();pmrem.dispose();renderer.resetState();}},render(gl,args){
 const now=performance.now(),rawDt=(now-last)/1000,dt=Math.min(rawDt,.1);last=now;if(!clock.paused){if(tour){clock=advance(clock,rawDt);lifeTime=clock.elapsed;}else lifeTime+=dt;}
 if(tourCamera){const c=tourCameraAt(clock.elapsed,selected,innerWidth<700),g=toGeo(c.x,c.z);
  const center:[number,number]=[g.lng,g.lat];
  map.jumpTo({center,zoom:c.zoom,pitch:54,bearing:BEARING});
 }else if(follow&&!map.isMoving()){const p=positionAt(selected,lifeTime);map.setCenter(toGeo(p.x,p.z));}
 if(tour&&clock.tourFinished){tour=false;tourCamera=false;$('tour').textContent='Replay story · 3:30';$('tour').classList.remove('active');}
 world.update(lifeTime,selected);
 const matrix=args.defaultProjectionData.mainMatrix;projection.fromArray(matrix as number[]).multiply(localMatrix);camera.projectionMatrix.copy(projection);camera.projectionMatrixInverse.copy(projection).invert();
 if(world.actors){const turn=conversationAt(Math.min(lifeTime,DURATION));world.setLods(world.muses.map((_,i)=>museBounds(i).height),[selected,...(turn?[turn.person,turn.listener]:[])]);}
 renderer.resetState();renderer.setViewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight);renderer.render(world.scene,camera);drawCalls=renderer.info.render.calls;triangles=renderer.info.render.triangles;renderer.resetState();frame++;fpsFrames++;
 if(now-fpsStart>=1000){fps=Math.round(fpsFrames*1000/(now-fpsStart));fpsFrames=0;fpsStart=now;}
 if(now-lastUI>200){updateUI();bubbles?.invalidate();$('time-label').textContent=clock.paused?'A quiet pause':tour?`STORY ${Math.floor(clock.elapsed/60)}:${String(Math.floor(clock.elapsed%60)).padStart(2,'0')} / 3:30`:'A LITTLE LIFE, IN MOTION';if(tour)$('tour').textContent=`Story · ${Math.floor(clock.elapsed/60)}:${String(Math.floor(clock.elapsed%60)).padStart(2,'0')} / 3:30`;lastUI=now;}
 bubbles?.update(lifeTime);
 if(!ready){ready=true;sceneReadyAtMs=performance.now();if(autoplay)startStory();$('loading').hidden=true;statuses.push('world rendered');}
 if(!detailReadyAtMs&&map.getZoom()>=20.35)detailReadyAtMs=performance.now();
 map.triggerRepaint();
}};
function projected(point:T.Vector3){const p=point.clone().applyMatrix4(projection);return {x:(p.x+1)*map.getCanvas().clientWidth/2,y:(1-p.y)*map.getCanvas().clientHeight/2};}
function museBounds(i:number){const p=world.muses[i].position,b=world.actorBounds(i)??new T.Box3().setFromObject(world.muses[i]),points=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])points.push(projected(new T.Vector3(x,y,z)));return {footY:b.min.y,center:projected(p.clone().add(new T.Vector3(0,.5,0))),width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))};}
map.on('click',e=>{if(!ready||map.getZoom()<20)return;let nearest=-1,d=Infinity;for(let i=0;i<PEOPLE.length;i++){const b=museBounds(i),dist=Math.hypot(e.point.x-b.center.x,e.point.y-b.center.y);if(dist<Math.max(25,b.height*.6)&&dist<d){d=dist;nearest=i;}}if(nearest>=0)select(nearest);});
map.on('mousemove',e=>{if(!ready)return;let hit=false;if(map.getZoom()>20)for(let i=0;i<PEOPLE.length;i++){const b=museBounds(i);if(Math.hypot(e.point.x-b.center.x,e.point.y-b.center.y)<Math.max(20,b.height*.5))hit=true;}map.getCanvas().style.cursor=hit?'pointer':'';});
bubbles=makeBubbles(map,i=>world?projected(world.muses[i].position.clone().add(new T.Vector3(0,.93,0))):{x:-100,y:-100});
map.on('render',()=>{if(!ready)bubbles.update(0);if(!onlineMapReadyAtMs&&map.getSource('openmaptiles')&&map.isSourceLoaded('openmaptiles')&&map.queryRenderedFeatures().some(f=>f.source==='openmaptiles')){onlineMapReadyAtMs=performance.now();}});
map.once('style.load',()=>{void Promise.race([kitLight,new Promise(r=>setTimeout(r,4000))]).then(addOnlineMap);});
map.once('style.load',async()=>{try{world=await makeWorld(assetData.glb,assetData.sigils,useKit?'/character-kit/runtime/':null,kitLibrary);map.addLayer(layer);statuses.push('assets parsed');void world.upgradeCharacters().then(()=>statuses.push('characters full detail'));}catch(e){console.error(e);errors.push(String(e));$('loading').textContent='The commons could not load. Please reopen this preview.';}});
setTimeout(()=>{if(!ready){$('loading').innerHTML='Your Muse is taking a little longer…<small>Please reopen this preview if the scene does not appear.</small>'; }},12000);
window.__world={getMetrics:()=>({ready,startup:{sceneReadyAtMs,onlineMapReadyAtMs,onlineMapAddedAtMs,detailReadyAtMs,overviewVisible:map.getZoom()<14},frame,zoom:map.getZoom(),center:map.getCenter().toArray(),pitch:map.getPitch(),bearing:map.getBearing(),elapsed:clock.elapsed,lifeTime,dialogue:conversationAt(Math.min(lifeTime,DURATION)),bubbles:bubbles?.getMetrics(),paused:clock.paused,tour,tourCamera,follow,selected,ownerDecision,drawCalls,triangles,fps,renderer:'WebGL2 shared map canvas',canvasCount:document.querySelectorAll('#map canvas').length,sceneId:world?.scene.uuid,museIds:world?.muses.map(m=>m.uuid),muses:ready?PEOPLE.map((p,i)=>({...p,position:world.muses[i].position.toArray(),floorY:surfaceHeightAt(world.muses[i].position.x,world.muses[i].position.z),bounds:museBounds(i)})):[],characterHeightM:world?.sourceHeight,characters:world?.actors?.map(a=>({variant:a.variant,rootId:a.root.uuid,lod:a.lod,wantedLod:a.wanted,loadedLods:[...a.loaded].sort(),attachment:a.attachmentLoaded,action:a.getMetrics().action,expression:a.getMetrics().expression,triangles:a.visibleTriangles()})),characterKit:!!world?.actors,characterUpgrade:world?{...world.upgradeTimes}:null,characterMaterials:(i:number)=>world?.actors?.[i]?.visibleMaterials(),errors,statuses,onlineMap:true,liveAgent:false,spark:spark?{connected:spark.model.connected,live:spark.model.live,model:spark.model.id}:null,dynamicLights:1}),script:LINES,map,startStory,seek:seekStory,visit,select,alignmentAt:(x:number,z:number)=>{const p=map.project(toGeo(x,z));return {geo:toGeo(x,z).toArray(),mapPixel:[p.x,p.y],modelPixel:projected(new T.Vector3(x,0,z))};},fixture:ROUNDS};
