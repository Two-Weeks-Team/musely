import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {transform} from 'esbuild';
import {HARNESSES} from '../src/engine/harness.ts';
import {PLACES} from '../src/engine/places.ts';
import * as live from '../src/ui/live-scene-core.ts';
const text=await fs.readFile(new URL('../src/ui/world-panel.ts', import.meta.url),'utf8');
const part=text.slice(text.indexOf('function museMarkers('),text.indexOf('// ---------- Panel',text.indexOf('function museMarkers(')));
const functionText=part.slice(0,part.lastIndexOf('\n}'))+'\n}';
const js=(await transform(functionText,{loader:'ts'})).code;
const nodes=new Map();
class Marker {constructor({element}){this.element=element;nodes.set(element.dataset.museId,this);}setLngLat(pos){this.pos=pos;return this;}addTo(){return this;}getElement(){return this.element;}remove(){}}
const el=(_tag,_cls,text='')=>({textContent:text,style:{setProperty(){}},dataset:{},setAttribute(){},append(){}});
const make=Function('HARNESSES','Marker','el','color','museName','PLACES','liveFrames','scheduleCues','sceneToLngLat','ownerOf','inventorySummary','harnessById','placeName',js+';return museMarkers;')
 (HARNESSES,Marker,el,()=>'',live.museName,PLACES,live.liveFrames,live.scheduleCues,live.sceneToLngLat,live.ownerOf,live.inventorySummary,id=>HARNESSES.find(x=>x.id===id),id=>id);
const timerLine=text.split('\n').find(x=>x.includes('setInterval(() =>') && x.includes('pins.update('));
assert.ok(timerLine,'exercise the actual panel timer');
const NOW=1800000000000;
const muse=(id,extra={})=>({id,place:'commons:cafe',travel:null,beat:null,inventory:[],...extra});
const world=muses=>({worldId:'w',day:'2026-11-02',tick:1,version:1,lastTickAt:NOW,muses});
function timerFor(pins,world,events=[],paused=false,replay=false){let callback;Function('pins','world','events','live','isolation','setInterval',timerLine)(pins,world,events,{paused:()=>paused},{replay},fn=>callback=fn);return callback;}

test('review the panel one-second timer preserves the actor contact cue pose',()=>{
 const now=NOW+live.CUE_DELAY_MS+1500,original=Date.now;Date.now=()=>now;
 try {const w=world([muse('00-jolly',{place:'commons:workbench'}),muse('01-sunny',{place:'commons:workbench'})]),e={id:'e1',tick:1,seq:1,at:NOW,source:'live',kind:'trade_completed',muse:'00-jolly',other:'01-sunny',data:{give:'coffee',want:'pastry'}};
 const pins=make({getZoom:()=>19},()=>{},()=>true);pins.update(w,[e]);const actor=live.liveFrames(w,live.scheduleCues([e]),now).get('00-jolly'),expected=live.sceneToLngLat(actor.x,actor.z);assert.deepEqual(nodes.get('00-jolly').pos,expected);
 timerFor(pins,w,[e])();console.log(JSON.stringify({expectedActor:expected,afterTimerPin:nodes.get('00-jolly').pos}));assert.deepEqual(nodes.get('00-jolly').pos,expected,'timer must keep active event cues shared with actors');}finally{Date.now=original;}
});

test('review the panel one-second timer keeps map pins paused with the live view',()=>{
 const original=Date.now;let at=NOW+30000;Date.now=()=>at;
 try{const w=world([muse('00-jolly',{travel:{to:'bay:sf',departAt:NOW,arriveAt:NOW+60000,speed:'walk'}})]),pins=make({getZoom:()=>15},()=>{},()=>true);pins.update(w,[]);const paused=[...nodes.get('00-jolly').pos];at+=10000;timerFor(pins,w,[],true)();console.log(JSON.stringify({pausedActor:paused,afterTimerPin:nodes.get('00-jolly').pos}));assert.deepEqual(nodes.get('00-jolly').pos,paused,'pause freezes actor and pin together');}finally{Date.now=original;}
});

test('replay isolation also stops the real panel pin timer',()=>{let calls=0;timerFor({update(){calls++;}},world([]),[],false,true)();assert.equal(calls,0);});
