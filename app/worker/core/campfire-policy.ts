/** Server-owned, opt-in venue policy. Never accepted from tool arguments or a model.
 * Approved existing commons locations are logical venues, not proof a visual fire is installed.
 */
import {PLACES, distanceM, type Place} from '../../src/engine/places.ts';
import type {WorldState} from '../../src/engine/world.ts';
export type CampfirePolicy = {enabled:boolean;placeIds:readonly string[]};
export const LEGACY_CAMPFIRE='commons:campfire';
export const CAMPFIRE_VENUE_RANGE_M=100;
export function campfireVenue(world:WorldState,actorId:string,requested:string|undefined,policy:CampfirePolicy|undefined):
  {ok:true;place:Place;scoped:boolean}|{ok:false;reason:string} {
  const placeId=requested??LEGACY_CAMPFIRE;
  if(placeId===LEGACY_CAMPFIRE)return {ok:true,place:PLACES.find(p=>p.id===LEGACY_CAMPFIRE)!,scoped:policy?.enabled===true};
  if(policy?.enabled!==true)return {ok:false,reason:'multi_campfire_disabled'};
  const place=PLACES.find(p=>p.id===placeId);
  if(!place||place.zone!=='commons'||!policy.placeIds.includes(placeId))return {ok:false,reason:'campfire_place_not_allowed'};
  const actor=world.muses.find(m=>m.id===actorId),from=PLACES.find(p=>p.id===actor?.place);
  if(!actor||actor.travel||!from||from.zone!=='commons'||distanceM(from,place)>CAMPFIRE_VENUE_RANGE_M)return {ok:false,reason:'campfire_host_not_near'};
  return {ok:true,place,scoped:true};
}
export function campfireInviteeNear(world:WorldState,id:string,venue:Place):boolean {
  const actor=world.muses.find(m=>m.id===id),from=PLACES.find(p=>p.id===actor?.place);
  return !!actor&&!actor.travel&&!!from&&from.zone==='commons'&&distanceM(from,venue)<=CAMPFIRE_VENUE_RANGE_M;
}
