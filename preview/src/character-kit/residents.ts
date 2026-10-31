import {RESIDENT_VARIANTS,variantById,SINGLE_PLAY} from './catalog.ts';
import type {Lod} from './MuseActor.ts';

type Turn={id:number;start:number;person:number;listener:number}|null;
export type Behavior={action:string;expression:string;timed:boolean};
const STRIDE_M=.27,WALK_SECONDS=32/24;

/** Everyday behavior for resident i: route-owned walking, dialogue roles, then the variant's own activity. */
export function residentBehavior(i:number,t:number,moving:boolean,turn:Turn):Behavior{
 const v=variantById(RESIDENT_VARIANTS[i]);
 if(moving)return {action:'walk',expression:'Neutral',timed:false};
 if(turn?.person===i){
  if(i===0&&turn.id===0&&t-turn.start<2.5)return {action:'wave',expression:'Smile',timed:true};
  if(v.signature==='welcome_neighbors'&&t-turn.start<2.5&&turn.listener===0)return {action:'welcome_neighbors',expression:'Delight',timed:true};
  return {action:'talk',expression:'Smile',timed:false};
 }
 if(turn?.listener===i)return {action:'listen',expression:'Listening',timed:false};
 if(i===0)return {action:t<14?'look_around':'think',expression:t<14?'Curious':'Thinking',timed:false};
 const sig=v.signature;
 // Alternate the signature with a calmer shared clip so idle life does not loop one motion forever.
 const window=Math.floor((t+i*3.7)/9)%3;
 if(sig==='welcome_neighbors')return {action:window===2?'look_around':'idle_breathe',expression:'Neutral',timed:false};
 if(sig==='inspect_map'&&window===2)return {action:'look_around',expression:'Curious',timed:false};
 if(sig==='reassure'&&window!==1)return {action:'listen',expression:'Listening',timed:false};
 const face:Record<string,string>={water_plants:'Focused',inspect_map:'Curious',read_book:'Focused',music_bounce:'Delight',observe_sky:'Curious',reassure:'Smile',tell_story:'Smile',inspect_gadget:'Focused'};
 return sig?{action:sig,expression:face[sig]??'Neutral',timed:SINGLE_PLAY.has(sig)}:{action:'idle_breathe',expression:'Neutral',timed:false};
}

/** Per-resident action clock: walking phase follows traveled distance, single-play clips start when chosen. */
export class ResidentClock{
 private distance=0;private last:{x:number;z:number;t:number}|null=null;private action='';private started=0;
 time(b:Behavior,t:number,x:number,z:number,tempo=1){
  const seek=!!this.last&&(t<this.last.t||t-this.last.t>.25);
  if(seek)this.distance=0;
  else if(b.action==='walk'&&this.last)this.distance+=Math.hypot(x-this.last.x,z-this.last.z);
  this.last={x,z,t};
  if(seek||b.action!==this.action){this.action=b.action;this.started=t;}
  if(b.action==='walk')return this.distance/STRIDE_M*WALK_SECONDS;
  return b.timed?t-this.started:t*tempo;
 }
}

/**
 * Single world LOD selector: at most two LOD0 actors (selected Muse first, then the current speakers),
 * with promotion/demotion hysteresis on projected bounding-box height in CSS px. The design's 180/160
 * start was tuned on the actual commons camera: the follow view (zoom 22.7) frames a Muse at ~160 px.
 */
export const LOD0_PROMOTE_PX=150,LOD0_DEMOTE_PX=130,LOD1_PROMOTE_PX=52,LOD1_DEMOTE_PX=44;
export function chooseLods(heights:readonly number[],current:readonly Lod[],priority:readonly number[]):Lod[]{
 const next:Lod[]=heights.map((h,i)=>h>=(current[i]<=1?LOD1_DEMOTE_PX:LOD1_PROMOTE_PX)?1:2);
 const order=[...new Set([...priority,...heights.map((_,i)=>i).sort((a,b)=>heights[b]-heights[a])])];
 let near=0;
 for(const i of order){if(i<0||i>=heights.length)continue;const need=current[i]===0?LOD0_DEMOTE_PX:LOD0_PROMOTE_PX;if(near<2&&heights[i]>=need){next[i]=0;near++;}}
 return next;
}
