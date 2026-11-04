import {localPerception,diffLocalPerception,type LocalPerception,type PublicGathered,type PerceptionNotice} from '../../src/engine/local-perception.ts';
import type {PlaceKind} from '../../src/engine/places.ts';
import {PLACE_BY_ID} from '../../src/engine/places.ts';
import type {WorldState,WorldEvent} from '../../src/engine/world.ts';
import type {SocialStatus} from '../../src/engine/social-status.ts';
import type {Sql} from './ledger.ts';
import type {CommitRecord} from './run-log.ts';
export type PerceptionPolicy={enabled:boolean;publicCatalogItems?:(kind:PlaceKind)=>readonly string[];publicGatherings?:(worldId:string,now:number)=>readonly PublicGathered[]};
export type PerceptionNoticeRow=PerceptionNotice&{seq:number};
type Status=(world:WorldState,id:string,now:number)=>SocialStatus;
type Packet={current:LocalPerception;notices:PerceptionNoticeRow[]};
const trusted=new WeakMap<object,{activity:boolean}>();
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
export function bindPerceptionInput(input:Record<string,unknown>,current:LocalPerception,notices:PerceptionNoticeRow[]=[],activity=false):Record<string,unknown>{
 const packet=freeze({current:structuredClone(current),notices:structuredClone(notices)});trusted.set(packet,{activity});
 const {muses:_muses,public_availability:_global,local_perception:_untrusted,...own}=input;
 return{...own,places:Array.isArray(input.places)?input.places.filter(p=>p&&typeof p==='object'&&typeof (p as any).distanceM==='number'&&(p as any).distanceM<=400):input.places,local_perception:packet};
}
export function perceptionPacket(input:Record<string,unknown>):Packet|null{
 const p=input.local_perception;return p&&typeof p==='object'&&trusted.has(p)?p as Packet:null;
}
export function observedActorId(input:Record<string,unknown>,target:unknown):string|null {
 const p=perceptionPacket(input);if(!p||typeof target!=='string')return null;
 const value=target.trim().toLowerCase(),peers=p.current.conversation;
 const id=peers.find(m=>m.id.toLowerCase()===value);if(id)return id.id;
 const named=peers.filter(m=>m.name.toLowerCase()===value);return named.length===1?named[0].id:null;
}
export function perceptionOutputProblem(input:Record<string,unknown>,output:{freedom?:unknown;decision?:unknown;target_agent?:unknown}):string|null {
 const p=perceptionPacket(input);if(!p||!['who','offer'].includes(String(output.freedom)))return null;
 const stay=trusted.get(p)?.activity&&(output.decision==='rest'||p.current.place?.activities.some(a=>a.id===output.decision));
 return stay||observedActorId(input,output.target_agent)?null:'recipient_not_observed';
}
/** Public peer names/wants remain data even when they contain role delimiters. Never turn them into a system message. */
export function perceptionMessage(input:Record<string,unknown>):{role:'user';content:string}|null{
 const p=perceptionPacket(input);if(!p)return null;
 const text=JSON.stringify(p).replace(/[<>&]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 return{role:'user',content:`<untrusted_data source="public_local_perception">${text}</untrusted_data>`};
}
function gatherings(world:WorldState,now:number,policy:PerceptionPolicy,events:readonly WorldEvent[]=[]):PublicGathered[]{
 let old:readonly PublicGathered[]=[];try{old=policy.publicGatherings?.(world.worldId,now)??[];}catch{/* No private failure text crosses the public projection. */}
 const rows=new Map<string,PublicGathered>();for(const g of old)if(g&&g.status==='gathered')rows.set(g.id,g);
 for(const e of events){
  const ids=e.data?.muses,id=e.data?.invite_id;
  if(e.kind!=='campfire_gathering'||typeof id!=='string'||!e.place||!PLACE_BY_ID.has(e.place)||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length<3||!ids.every(id=>typeof id==='string'&&world.muses.some(m=>m.id===id)))continue;
  rows.set(id,{id,placeId:e.place,status:'gathered',count:ids.length});
 }
 return[...rows.values()];
}
export function perceptionView(world:WorldState,actorId:string,now:number,policy:PerceptionPolicy|undefined,socialStatus?:Status,events:readonly WorldEvent[]=[]):LocalPerception|null {
 if(policy?.enabled!==true)return null;
 return localPerception(world,actorId,now,{socialStatus,publicCatalogItems:policy.publicCatalogItems,gatherings:gatherings(world,now,policy,events)});
}
const numeric=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
/** Called after prepare but before insert/append, within the caller's existing transaction. No new table or read-side write. */
export function derivedPerceptionEvents(sql:Sql,c:CommitRecord,ref:{runId:string;seq:number},publishedAt:number,policy:PerceptionPolicy|undefined,socialStatus?:Status):WorldEvent[]{
 if(policy?.enabled!==true||(!c.changed&&!c.events.length)||!numeric(publishedAt))return [];
 const prior=sql.exec('SELECT i.seq,i.at FROM run_inputs i JOIN runs r ON r.run_id=i.run_id WHERE r.world_id=? ORDER BY i.seq DESC LIMIT 1',c.after.worldId).toArray()[0];
 // First installation/first commit anchors the current world; it never announces historical arrivals.
 if(!prior||!numeric(Number(prior.at))||Number(prior.seq)>=ref.seq)return [];
 const publication=sql.exec("SELECT MAX(COALESCE(json_extract(data,'$.publishedAt'),at)) AS at FROM events WHERE input_seq=?",Number(prior.seq)).toArray()[0]?.at;
 const beforeAt=Math.max(Number(prior.at),numeric(publication)?publication:0),at=Math.max(c.at,publishedAt);if(beforeAt>at)return [];
 const options={socialStatus,publicCatalogItems:policy.publicCatalogItems,gatherings:gatherings(c.after,at,policy,c.events)},out:WorldEvent[]=[];
 for(const actorId of [...new Set(c.after.muses.map(m=>m.id))].sort()){
  for(const n of diffLocalPerception(c.before,c.after,actorId,beforeAt,at,options)){
   const data:Record<string,unknown>={schema:1,kind:n.kind,actorOrigin:'system',publishedAt:at};let target:string,other:string|null=null;
   if(n.kind==='place_arrival'){data.placeId=n.placeId;target=n.placeId;}
   else if(n.kind==='area_changed'){data.fromCell=n.fromCell;data.toCell=n.toCell;target=n.toCell;}
   else{data.peerId=n.peerId;target=n.peerId;other=n.peerId;}
   out.push({id:[ref.runId,'perception',ref.seq,actorId,n.kind,target].map(x=>encodeURIComponent(String(x))).join(':'),tick:c.after.tick,at,kind:'perception_notice',source:'rule',muse:actorId,other,place:n.kind==='place_arrival'?n.placeId:null,line:null,data,tags:['perception']});
  }
 }
 return out;
}
/** Only the requested actor's allowlisted public notices. A default read gets the latest bounded window in log order. */
export function perceptionHistory(sql:Sql,worldId:string,actorId:string,sinceSeq=0,limit=20):PerceptionNoticeRow[]{
 if(!numeric(sinceSeq)||!Number.isSafeInteger(limit)||limit<1||limit>100)return [];
 const rows=sql.exec(`SELECT e.seq,e.id,e.at,e.data FROM events e JOIN runs r ON r.run_id=e.run_id WHERE r.world_id=? AND e.muse=? AND e.kind='perception_notice' AND e.seq>? ORDER BY e.seq ${sinceSeq?'ASC':'DESC'} LIMIT ?`,worldId,actorId,sinceSeq,limit).toArray();
 const out:PerceptionNoticeRow[]=[];
 for(const row of rows)try{
  const d=JSON.parse(String(row.data));if(!numeric(row.seq)||!numeric(row.at)||typeof row.id!=='string'||d.schema!==1)continue;
  const base={seq:row.seq,id:row.id,at:row.at};
  if(d.kind==='place_arrival'&&typeof d.placeId==='string'&&PLACE_BY_ID.has(d.placeId))out.push({...base,kind:d.kind,placeId:d.placeId});
  else if(d.kind==='area_changed'&&[d.fromCell,d.toCell].every(x=>typeof x==='string'&&/^-?\d+:-?\d+$/.test(x)))out.push({...base,kind:d.kind,fromCell:d.fromCell,toCell:d.toCell});
  else if(['conversation_entered','conversation_left'].includes(d.kind)&&typeof d.peerId==='string'&&d.peerId.length<=160&&!/[\s<>]/.test(d.peerId))out.push({...base,kind:d.kind,peerId:d.peerId});
 }catch{/* Corrupt/foreign notice data is never a raw public response. */}
 return out.sort((a,b)=>a.seq-b.seq);
}
