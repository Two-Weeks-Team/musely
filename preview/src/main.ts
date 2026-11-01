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
import {lodUrl,ACTION_CLIPS} from './character-kit/catalog';
import {sparkStatus,statusLabel,type SparkStatus} from './live';
import {mountWorldPanel} from './ui/world-panel';
import {mountOnboarding} from './ui/onboarding';
import {setFlowCue} from './ui/preview-flows';
import {pixelRatioFor,mountPerf} from './ui/perf';
import {harnessById} from './engine/harness';
import {RESIDENT_VARIANTS} from './character-kit/catalog';
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
// Preview cues (P-05) live with the other playback state so any control can end one before it changes the world.
let cues:Cue[]=[],cueRestore:{paused:boolean;tour:boolean;tourCamera:boolean}|null=null;
const statuses:string[]=[],errors:string[]=[];let frame=0,drawCalls=0,triangles=0,fps=0,fpsFrames=0,fpsStart=performance.now();
// The embedded overview renders first. Online tiles join once the light character files (LOD2 + clips)
// arrive, or after 4 s: on slow first visits the tile downloads would otherwise take the bandwidth the
// commons needs to appear (direction: commons, residents and story within 8 s).
const initialStyle={...style,sources:{'arrival-overview':{type:'geojson',data:arrivalMap}},layers:[style.layers[0],{id:'arrival-water',type:'fill',source:'arrival-overview',maxzoom:14,filter:['==',['get','kind'],'water'],paint:{'fill-color':'#101623'}},{id:'arrival-roads',type:'line',source:'arrival-overview',maxzoom:14,filter:['==',['get','kind'],'transportation'],paint:{'line-color':'#35415A','line-width':1.2,'line-opacity':.6}}]};
const kitLight=kitLibrary?Promise.all([kitLibrary.load(lodUrl(2,kitLibrary.base)),kitLibrary.load(clipsUrl(kitLibrary.base))]).then(()=>'kit',()=>'kit-failed'):Promise.resolve('no-kit');
let onlineMapAddedAtMs=0;
function addOnlineMap(){if(onlineMapAddedAtMs)return;onlineMapAddedAtMs=performance.now();for(const [id,source] of Object.entries(style.sources))map.addSource(id,source as any);const before=map.getLayer('musely-world')?'musely-world':undefined;for(const layer of style.layers.slice(1))map.addLayer(layer as any,before);}
let sceneReadyAtMs=0,onlineMapReadyAtMs=0,detailReadyAtMs=0;
const ratio=pixelRatioFor();
const map=new LibreMap({container:'map',pixelRatio:ratio.applied,style:initialStyle as unknown as StyleSpecification,center:anchor,zoom:innerWidth<700?9.6:10.25,pitch:54,bearing:BEARING,minZoom:8,maxZoom:23.8,maxPitch:65,attributionControl:false,canvasContextAttributes:{antialias:true,preserveDrawingBuffer:true},fadeDuration:200});
map.on('styleimagemissing',e=>{if(!map.hasImage(e.id))map.addImage(e.id,{width:1,height:1,data:new Uint8Array(4)});});
map.dragRotate.disable();map.touchZoomRotate.disableRotation();
function manual(){follow=false;tourCamera=false;if(cueRestore)cueRestore.tourCamera=false;$('tour').classList.remove('active');$('follow').classList.remove('active');if(!tour)$('tour').textContent='Play story · 3:30';}
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
// The button always matches what the world is doing: a preview cue holds the world ("Paused for preview"), and pressing the
// button then ends the cue and resumes; otherwise it toggles the user's own pause.
function syncPause(){const held=cues.length>0;$('pause').textContent=held?'Paused for preview':clock.paused?'Resume world':'Pause world';$('pause').setAttribute('aria-pressed',String(held||clock.paused));}
$('pause').onclick=()=>{if(cues.length){endCues();clock.paused=false;last=performance.now();syncPause();updateUI();return;}clock.paused=!clock.paused;if(clock.paused)map.stop();syncPause();};
function startStory(){endCues();markMode('story');follow=false;clock=makeClock();lifeTime=0;selected=0;ownerDecision='pending';$('decision-note').textContent='Local interaction only. Nothing is sent or booked.';tour=true;tourCamera=true;document.body.classList.add('story-mode');$('tour').classList.add('active');$('tour').textContent='Story · 0:00 / 3:30';syncPause();map.jumpTo({center:anchor,zoom:innerWidth<700?9.6:10.25,pitch:54,bearing:BEARING});last=performance.now();}
$('tour').onclick=startStory;
function seekStory(t:number){endCues();follow=false;$('follow').classList.remove('active');clock.elapsed=Math.max(0,Math.min(DURATION,t));clock.tourFinished=clock.elapsed>=DURATION;lifeTime=clock.elapsed;tour=!clock.tourFinished;tourCamera=true;bubbles?.invalidate();if(clock.tourFinished){$('tour').textContent='Replay story · 3:30';$('tour').classList.remove('active');}updateUI();}
$('story-scrubber').oninput=()=>seekStory(Number(($('story-scrubber') as HTMLInputElement).value));
$('about').onclick=()=>$('about-dialog').showPopover();$('close-about').onclick=()=>$('about-dialog').hidePopover();
$('meetup').onclick=()=>$('meetup-dialog').showPopover();$('close-meetup').onclick=()=>$('meetup-dialog').hidePopover();
$('approve').onclick=()=>{ownerDecision='approved';$('decision-note').textContent='Approved in this local preview. No invitation was sent.';updateUI();};
$('decline').onclick=()=>{ownerDecision='declined';$('decision-note').textContent='Declined in this local preview. No invitation was sent.';updateUI();};
$('fixture-label').textContent=FIXTURE_LABEL;
const roundList=$('rounds');ROUNDS.forEach((r,i)=>{const el=document.createElement('li');el.innerHTML=`<div><b>PROPOSE R${i+1} · ${r.time} · ${r.place}</b><small> · Jimin's Muse ${r.jimin?'✓ yes':'✕ no'} · Sora's Muse ✓ yes</small></div>`;roundList.append(el);});
const portraits=$('portraits');PEOPLE.forEach((p,i)=>{const b=document.createElement('button');b.type='button';b.className='portrait';b.style.setProperty('--muse',p.color);b.innerHTML='<span class="muse-icon"><i></i></span>';b.setAttribute('aria-label','Select '+p.name);b.setAttribute('title',p.name);b.onclick=()=>select(i);portraits.append(b);});
function select(i:number){selected=i;manual();updateUI();if(map.getZoom()<20)visit(21.5);}
// Wants come from the character harness (direction 7, 9.1): the live world's value when available
// (Spark or the connected Muse may update it), otherwise the harness default. Rendered as text only.
let liveWants:Record<string,{goal:string;source:string}>={};
const wantsLine=(i:number)=>{const id=RESIDENT_VARIANTS[i]??'00-jolly',g=(liveWants[id]?.goal||harnessById(id).wants.goal).trim();return 'Wants: '+g.charAt(0).toLowerCase()+g.slice(1)+(/[.!?]$/.test(g)?'':'.');};
async function refreshWants(){try{const r=await fetch('/api/world',{cache:'no-store'});if(!r.ok)return;const w=await r.json();liveWants=Object.fromEntries((w.muses??[]).filter((m:any)=>m?.wants?.goal).map((m:any)=>[m.id,{goal:String(m.wants.goal),source:String(m.wants.source)}]));}catch{}}
void refreshWants();setInterval(refreshWants,60_000);
function updateUI(){($('story-scrubber') as HTMLInputElement).value=String(clock.elapsed);const p=PEOPLE[selected],t=Math.min(lifeTime,DURATION),chapter=chapterAt(t),turn=conversationAt(t);$('muse-name').textContent=p.name;$('muse-role').textContent=(selected===0?'YOUR MUSE':'A FAMILIAR FACE')+' · '+stateAt(selected,lifeTime);$('avatar-large').style.setProperty('--muse',p.color);$('activity-title').textContent=chapter.title;$('muse-want-text').textContent=wantsLine(selected);$('activity-detail').textContent=turn?PEOPLE[turn.person].name+': '+turn.text:t<14?'Little stories are already unfolding around the Bay.':'Your Muse can connect. The next commitment is still yours.';$('meetup').hidden=selected!==0;$('muse-card').hidden=map.getZoom()<20.35;$('decision-state').textContent=ownerDecision==='approved'?'Local preview · approved':ownerDecision==='declined'?'Local preview · declined':'Your confirmation comes first';portraits.querySelectorAll('button').forEach((b,i)=>{b.classList.toggle('selected',i===selected);b.setAttribute('aria-pressed',String(i===selected));});$('welcome').hidden=document.body.classList.contains('story-mode')||map.getZoom()>20.5;$('place-line').textContent=map.getZoom()<14?'LITTLE STORIES AROUND THE BAY':map.getZoom()<20?'MENLO PARK · CALIFORNIA':'HQ · THE LITTLE COMMONS';pin.hidden=map.getZoom()>20.2||map.getZoom()<18.3;
$('story-title').textContent=chapter.title;$('story-speaker').textContent=turn?PEOPLE[turn.person].name:'Around the Bay';const candidate=$('story-candidate');candidate.hidden=turn?.round===undefined;if(turn?.round!==undefined){const r=ROUNDS[turn.round];candidate.textContent=`${r.time} · ${r.place}    Jimin ${r.jimin?'✓ yes':'✕ no'} · Sora ✓ yes`;}
updateContinuity();
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
 bubbles?.update(lifeTime);updateCues(now);
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
// ?perf=1: on-device frame rate and render cost; ?dpr= compares pixel-ratio caps on one phone.
const perf=mountPerf(()=>({drawCalls,triangles,canvas:map.getCanvas()}),ratio);
// Live world surface (task 6): map pins, spotlight chip, feed, highlights, evidence, P1, autonomy, identity, location.
const worldPanel=mountWorldPanel(map);
// P-05: one continuous scene. Story (scripted) and live world are explicit modes you can switch between and back;
// the selected Muse, its state and its source stay visible at every zoom; preview-flow item changes play on the
// commons character with its clip and prop, or say plainly that a fallback is shown.
let mode:'story'|'world'=autoplay?'story':'world',storyResume=0;
const fmtTime=(t:number)=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const modeBar=document.createElement('div');modeBar.className='mode-switch';modeBar.setAttribute('role','group');modeBar.setAttribute('aria-label','What you are watching');
const modeButton=(id:string,label:string,m:'story'|'world')=>{const b=document.createElement('button');b.type='button';b.id=id;b.textContent=label;b.onclick=()=>setMode(m);modeBar.append(b);return b;};
const storyModeButton=modeButton('mode-story','Story · scripted','story'),worldModeButton=modeButton('mode-world','Live world','world');
document.querySelector('.playback')!.prepend(modeBar);
function markMode(m:'story'|'world'){mode=m;document.body.dataset.mode=m;storyModeButton.setAttribute('aria-pressed',String(m==='story'));worldModeButton.setAttribute('aria-pressed',String(m==='world'));const note=document.getElementById('commons-note');if(note)note.textContent=m==='story'?'Story mode: the commons plays a scripted 3:30 story · switch to Live world for the shared world':'Live world: map pins are live Muses · the commons scene itself stays scripted';}
function setMode(m:'story'|'world'){
 endCues(); // a cue's saved playback state must never override the mode the user just chose
 if(m==='world'){if(tour||clock.elapsed>0)storyResume=clock.tourFinished?0:clock.elapsed;tour=false;tourCamera=false;follow=false;document.body.classList.remove('story-mode');$('tour').classList.remove('active');$('tour').textContent=storyResume>0?`Resume story · ${fmtTime(storyResume)}`:'Play story · 3:30';markMode('world');map.flyTo({center:anchor,zoom:15.2,pitch:50,bearing:BEARING,duration:2600,essential:true});}
 else{const at=storyResume;startStory();if(at>0)seekStory(at);storyResume=0;}
 updateUI();
}
$('tour').onclick=()=>setMode('story');
// Selected Muse line under the neighbors: same Muse, state and source when the close-up card is hidden.
const selectedLine=document.createElement('p');selectedLine.id='selected-line';selectedLine.className='selected-line';document.querySelector('.neighbors')!.append(selectedLine);
const museSource=document.createElement('span');museSource.id='muse-source';museSource.className='src src-scripted';document.querySelector('#muse-card .muse-heading > div:nth-child(2)')!.prepend(museSource);
function updateContinuity(){
 // updateUI first runs before this block is evaluated; the continuity UI joins from the next refresh.
 if(!museSource||!selectedLine||!cues)return;
 const name=PEOPLE[selected].name,state=stateAt(selected,lifeTime),cue=cues.find(c=>c.index===selected);
 const source=cue?'PREVIEW FLOW · SCRIPTED':'SCRIPTED · STORY CHARACTER';
 museSource.textContent=source;
 selectedLine.textContent=`${name} · ${state} · ${cue?'preview flow':'scripted story'}`;
 selectedLine.hidden=map.getZoom()>=20.35;
}
// Preview cues from Preview flows (P-03 scenes): played by the commons character of the same harness variant.
type Cue={index:number;clip:string|null;item:string|null;line:string|null;label:string;visual:'complete'|'fallback';prop:string|null;reason?:'no_clip'|'prop_unavailable';el:HTMLElement;until:number};
const itemLabel=(id:string)=>id.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
function previewCue(entries:{variant:string;clip?:string|null;item?:string|null;line?:string|null;label:string}[],seconds=6){
 if(!world?.actors)return {shown:false,reason:'characters_loading',results:[]};
 endCues();
 const results=entries.map(e=>{const index=(RESIDENT_VARIANTS as readonly string[]).indexOf(e.variant);return {...e,index};});
 const present=results.filter(r=>r.index>=0);
 if(!present.length)return {shown:false,reason:'not_in_commons',results:results.map(r=>({variant:r.variant,shown:false,visual:'fallback'}))};
 cueRestore={paused:clock.paused,tour,tourCamera};clock.paused=true;tour=false;tourCamera=false;follow=false;
 const until=performance.now()+seconds*1000;
 cues=present.map(r=>{
  const actor=world.actors![r.index],spec=r.clip?ACTION_CLIPS[r.clip]:undefined;
  const played=!!r.clip&&actor.hold(r.clip,seconds);
  // A clip that needs a 3D prop counts as complete only when that prop is bound and rendered; otherwise the item is a card.
  const propMissing=played&&!!spec?.prop&&!actor.propShown();
  const ok=played&&!propMissing,reason:Cue['reason']=!played?'no_clip':propMissing?'prop_unavailable':undefined;
  const el=document.createElement('div');el.className='preview-cue';el.dataset.visual=ok?'complete':'fallback';
  const tag=document.createElement('span');tag.className='eyebrow';tag.textContent=`PREVIEW FLOW · ${r.label}`;el.append(tag);
  if(r.item){const card=document.createElement('b');card.className='cue-item';card.textContent='+ '+itemLabel(r.item);el.append(card);}
  if(r.line){const line=document.createElement('p');line.textContent=r.line;el.append(line);}
  const how=document.createElement('small');how.textContent=ok?`clip ${r.clip}${spec?.prop?` · 3D prop ${spec.prop}`:' · item shown as a card'}`:propMissing?`fallback: clip ${r.clip} plays, but the 3D ${spec!.prop} is not available here · item shown as a card`:`fallback: ${r.clip?`no ${r.clip} clip on this character`:'no clip for this change'}, shown as an item card`;el.append(how);
  document.body.append(el);
  return {index:r.index,clip:played?r.clip!:null,item:r.item??null,line:r.line??null,label:r.label,visual:ok?'complete':'fallback',prop:ok?spec?.prop??null:null,reason,el,until} as Cue;
 });
 selected=cues[0].index;const p=world.muses[selected].position;map.flyTo({center:toGeo(p.x,p.z),zoom:22.3,pitch:55,bearing:BEARING,duration:1600,essential:true});syncPause();updateUI();
 return {shown:true,results:results.map(r=>{const c=cues.find(c=>c.index===r.index);return {variant:r.variant,shown:!!c,visual:c?.visual??'fallback',prop:c?.prop??null,reason:c?c.reason:'not_in_commons'};})};
}
// Ends every cue: labels go, each character's hold is released (a replaced cue must not leave the previous character mid-clip),
// and the playback state saved when the cue began is restored. Callers that change the mode or story call this first.
function endCues(){for(const c of cues){c.el.remove();world.actors?.[c.index]?.release();}cues=[];if(cueRestore){clock.paused=cueRestore.paused;tour=cueRestore.tour;tourCamera=cueRestore.tourCamera;cueRestore=null;last=performance.now();}syncPause();}
function updateCues(now:number){
 if(!cues.length)return;
 if(now>cues[0].until){endCues();updateUI();return;}
 for(const c of cues){const h=projected(world.muses[c.index].position.clone().add(new T.Vector3(0,1.15,0)));c.el.style.transform=`translate(${Math.round(h.x)}px,${Math.round(h.y)}px) translate(-50%,-100%)`;}
}
setFlowCue(previewCue);
// Header height drives the caption and story heading offsets so wrapped header rows never cover them (390 px).
const headerEl=document.querySelector('header')!;new ResizeObserver(()=>document.documentElement.style.setProperty('--header-h',headerEl.getBoundingClientRect().bottom+'px')).observe(headerEl);
markMode(mode);
// Entry paths (P-02): watch, a local harness trial, or the staged connection walkthrough. Preview state only.
// Mounted last: ?entry=watch calls onWatch (startStory) while mounting, which needs the mode controls and cue state above.
const onboarding=mountOnboarding({onWatch:()=>{if(!tour)startStory();},initial:new URLSearchParams(location.search)});
window.__world={getMetrics:()=>({ready,startup:{sceneReadyAtMs,onlineMapReadyAtMs,onlineMapAddedAtMs,detailReadyAtMs,overviewVisible:map.getZoom()<14},frame,zoom:map.getZoom(),center:map.getCenter().toArray(),pitch:map.getPitch(),bearing:map.getBearing(),elapsed:clock.elapsed,lifeTime,dialogue:conversationAt(Math.min(lifeTime,DURATION)),bubbles:bubbles?.getMetrics(),paused:clock.paused,tour,tourCamera,follow,selected,ownerDecision,drawCalls,triangles,fps,renderer:'WebGL2 shared map canvas',canvasCount:document.querySelectorAll('#map canvas').length,sceneId:world?.scene.uuid,museIds:world?.muses.map(m=>m.uuid),muses:ready?PEOPLE.map((p,i)=>({...p,position:world.muses[i].position.toArray(),floorY:surfaceHeightAt(world.muses[i].position.x,world.muses[i].position.z),bounds:museBounds(i)})):[],characterHeightM:world?.sourceHeight,characters:world?.actors?.map(a=>({variant:a.variant,rootId:a.root.uuid,lod:a.lod,wantedLod:a.wanted,loadedLods:[...a.loaded].sort(),attachment:a.attachmentLoaded,action:a.getMetrics().action,expression:a.getMetrics().expression,triangles:a.visibleTriangles()})),characterKit:!!world?.actors,characterUpgrade:world?{...world.upgradeTimes}:null,characterMaterials:(i:number)=>world?.actors?.[i]?.visibleMaterials(),errors,statuses,onlineMap:true,liveAgent:false,spark:spark?{connected:spark.model.connected,live:spark.model.live,model:spark.model.id}:null,dynamicLights:1}),script:LINES,map,startStory,seek:seekStory,visit,select,worldPanel,setMode,previewCue,get mode(){return mode;},onboarding,perf,pixelRatio:ratio,actor:(i:number)=>world?.actors?.[i]??null,actionClips:ACTION_CLIPS,alignmentAt:(x:number,z:number)=>{const p=map.project(toGeo(x,z));return {geo:toGeo(x,z).toArray(),mapPixel:[p.x,p.y],modelPixel:projected(new T.Vector3(x,0,z))};},fixture:ROUNDS};
