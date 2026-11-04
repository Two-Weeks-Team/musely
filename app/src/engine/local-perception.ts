/** Derived public in-game perception only. No private inbox, owner location or resident interpretation is read. */
import type {MuseState,WorldState} from './world.ts';
import {localClock} from './world.ts';
import {publicActorPosition,CONVERSATION_RANGE_M} from './speech.ts';
import {PLACE_BY_ID,type Place,type PlaceKind} from './places.ts';
import {cellOf} from './location.ts';
import {actorProfile,participantName} from './participants.ts';
import {hasActorHarness} from './harness.ts';
import {BEATS,inHours} from './beats.ts';
import {itemSpec,itemName,isExpired} from './items.ts';
import {isSocialStatus,resolveSocialStatus,type SocialStatus} from './social-status.ts';
export const PERCEPTION_RANGE_M=400;
export type PublicGathered={id:string;placeId:string;status:'gathered';count:number};
export type PerceptionOptions={
 socialStatus?:(world:WorldState,actorId:string,now:number)=>unknown;
 /** Trusted host's already-public, gathered-only projection, never an Inbox. */
 gatherings?:readonly PublicGathered[];
 /** Read-only catalog pool, not a discovery, inventory grant or promise of acquisition. */
 publicCatalogItems?:(kind:PlaceKind)=>readonly string[];
};
type PublicItem={id:string;name:string};
type PlaceBrief={id:string;name:string;kind:PlaceKind;purpose:string;activities:{id:string;minutes:number}[];itemsKnown:boolean;availableItems:PublicItem[]};
type ConversationMuse={id:string;name:string;status:SocialStatus;placeId:string|null;moving:boolean;distanceM:number;wants:{goal:string;items:string[]};tradeItems:PublicItem[]};
type VisibleGroup={placeId:string|null;placeName:string;count:number;statuses:Record<SocialStatus,number>};
export type LocalPerception={schema:1;worldId:string;worldVersion:number;actorId:string;at:number;areaCell:string;place:PlaceBrief|null;conversation:ConversationMuse[];visibleGroups:VisibleGroup[];gatherings:PublicGathered[]};
const time=(now:number)=>Number.isSafeInteger(now)&&now>=0;
function known(actor:MuseState):boolean {
 try{
  if(actor.profile!==undefined){const p=actor.profile;if(!p||Object.keys(p).sort().join(',')!=='actorId,appearanceId,displayName,revision')return false;actorProfile(p,actor.id);return true;}
  return hasActorHarness(actor.id);
 }catch{return false;}
}
function namedItem(id:unknown):PublicItem|null {
 if(typeof id!=='string'||!itemSpec(id))return null;
 if(id.startsWith('postcard:')&&!PLACE_BY_ID.has(id.slice(9)))return null;
 return{id,name:itemName(id)};
}
function settledPlace(actor:MuseState,now:number):Place|null {
 return PLACE_BY_ID.get(actor.travel?(now>=actor.travel.arriveAt?actor.travel.to:''):actor.place)??null;
}
/** The existing public geography grid applied to the common in-game trip position, never owner coordinates. */
function actorCell(actor:MuseState,now:number):string|null {
 const point=publicActorPosition(actor,now),from=PLACE_BY_ID.get(actor.place);if(!point||!from)return null;
 const to=actor.travel?PLACE_BY_ID.get(actor.travel.to):from;if(!to)return null;
 const dx=to.x-from.x,dz=to.z-from.z,length2=dx*dx+dz*dz;
 const t=length2?Math.max(0,Math.min(1,((point.x-from.x)*dx+(point.z-from.z)*dz)/length2)):0;
 return cellOf(from.lat+(to.lat-from.lat)*t,from.lng+(to.lng-from.lng)*t);
}
function status(world:WorldState,actorId:string,now:number,options:PerceptionOptions):SocialStatus {
 try{const value=options.socialStatus?options.socialStatus(world,actorId,now):resolveSocialStatus(world,actorId,now);return isSocialStatus(value)?value:'do_not_disturb';}catch{return'do_not_disturb';}
}
function brief(world:WorldState,actor:MuseState,now:number,options:PerceptionOptions):PlaceBrief|null {
 const p=settledPlace(actor,now);if(!p)return null;
 let itemsKnown=false,availableItems:PublicItem[]=[];
 if(options.publicCatalogItems)try{const ids=options.publicCatalogItems(p.kind);if(Array.isArray(ids)){itemsKnown=true;availableItems=[...new Set(ids)].flatMap(id=>{const item=namedItem(id);return item?[item]:[];});}}catch{/* Missing catalog capability is not an acquisition failure. */}
 const activities=BEATS.filter(b=>b.kinds.includes(p.kind)&&inHours(b,localClock(now).hour)&&(b.needs??[]).every(id=>actor.inventory.includes(id)&&!isExpired(world.items,actor.id,id,now))).map(b=>({id:b.id,minutes:b.minutes}));
 return{id:p.id,name:p.name,kind:p.kind,purpose:p.activity??p.kind.replace(/_/g,' '),activities,itemsKnown,availableItems};
}
export function localPerception(world:WorldState,actorId:string,now:number,options:PerceptionOptions={}):LocalPerception|null {
 if(!time(now))return null;
 const counts=new Map<string,number>();for(const m of world.muses)counts.set(m.id,(counts.get(m.id)??0)+1);
 const self=world.muses.find(m=>m.id===actorId);if(!self||counts.get(actorId)!==1||!known(self))return null;
 const position=publicActorPosition(self,now),areaCell=actorCell(self,now);if(!position||areaCell===null)return null;
 const conversation:ConversationMuse[]=[],groups=new Map<string,VisibleGroup>();
 for(const peer of world.muses){
  if(peer.id===actorId||counts.get(peer.id)!==1||!known(peer))continue;
  const p=publicActorPosition(peer,now);if(!p)continue;
  const distance=Math.hypot(p.x-position.x,p.z-position.z);if(distance>PERCEPTION_RANGE_M)continue;
  const availability=status(world,peer.id,now,options),place=settledPlace(peer,now);
  if(distance<=CONVERSATION_RANGE_M){
   const tradeItems=[...new Set(peer.inventory)].flatMap(id=>{const item=namedItem(id);return item&&itemSpec(id)?.transferable&&!isExpired(world.items,peer.id,id,now)?[item]:[];});
   const wants={goal:typeof peer.wants?.goal==='string'?peer.wants.goal:'',items:[...new Set(peer.wants?.items??[])].filter(id=>namedItem(id)!==null)};
   conversation.push({id:peer.id,name:participantName(world,peer.id),status:availability,placeId:place?.id??null,moving:place===null,distanceM:distance,wants,tradeItems});
  }else{
   // Travellers are not falsely counted at their departure or destination place.
   const key=place?.id??'',g=groups.get(key)??{placeId:place?.id??null,placeName:place?.name??'In transit',count:0,statuses:{welcoming:0,busy:0,do_not_disturb:0}};
   g.count++;g.statuses[availability]++;groups.set(key,g);
  }
 }
 const place=brief(world,self,now,options),gatherings:PublicGathered[]=[];
 const ids=new Set<string>();
 for(const g of options.gatherings??[]){
  if(!g||typeof g!=='object'||g.status!=='gathered'||!place||g.placeId!==place.id||typeof g.id!=='string'||!g.id||ids.has(g.id)||!Number.isSafeInteger(g.count)||g.count<3)continue;
  ids.add(g.id);gatherings.push({id:g.id,placeId:place.id,status:'gathered',count:g.count});
 }
 return{schema:1,worldId:world.worldId,worldVersion:world.version,actorId,at:now,areaCell,place,conversation:conversation.sort((a,b)=>a.id.localeCompare(b.id)),visibleGroups:[...groups.values()].sort((a,b)=>(a.placeId??'').localeCompare(b.placeId??'')),gatherings:gatherings.sort((a,b)=>a.id.localeCompare(b.id))};
}
export type PerceptionNotice=({kind:'place_arrival';placeId:string}|{kind:'area_changed';fromCell:string;toCell:string}|{kind:'conversation_entered'|'conversation_left';peerId:string})&{id:string;at:number};
/** Same unchanged state -> no notice. Same transition -> stable IDs for host-side idempotent consumption. */
export function diffLocalPerception(before:WorldState,after:WorldState,actorId:string,beforeAt:number,afterAt:number,options:PerceptionOptions={}):PerceptionNotice[] {
 if(!time(beforeAt)||!time(afterAt)||afterAt<beforeAt||before.worldId!==after.worldId||after.version<before.version)return [];
 const a=localPerception(before,actorId,beforeAt,options),b=localPerception(after,actorId,afterAt,options);if(!a||!b)return [];
 const out:PerceptionNotice[]=[],key=(kind:string,target:string)=>[after.worldId,actorId,kind,target,before.version,after.version,beforeAt,afterAt].map(x=>encodeURIComponent(String(x))).join(':');
 if(b.place&&a.place?.id!==b.place.id)out.push({id:key('place_arrival',b.place.id),at:afterAt,kind:'place_arrival',placeId:b.place.id});
 if(a.areaCell!==b.areaCell)out.push({id:key('area_changed',b.areaCell),at:afterAt,kind:'area_changed',fromCell:a.areaCell,toCell:b.areaCell});
 const old=new Set(a.conversation.map(m=>m.id)),current=new Set(b.conversation.map(m=>m.id));
 for(const peerId of old)if(!current.has(peerId))out.push({id:key('conversation_left',peerId),at:afterAt,kind:'conversation_left',peerId});
 for(const peerId of current)if(!old.has(peerId))out.push({id:key('conversation_entered',peerId),at:afterAt,kind:'conversation_entered',peerId});
 return out;
}
