/** Trusted, fixed-catalog world enrollment. No personal entry, keys, timers or provider calls. */
import {RESIDENT_INSTANCES,RESIDENT_ROSTER_MODE} from '../../src/engine/resident-catalog.ts';
import {harnessById} from '../../src/engine/harness.ts';
import {placeById} from '../../src/engine/places.ts';
import type {WorldState,MuseState} from '../../src/engine/world.ts';
import {restoreLife,saveLife,type LifeState} from '../../src/engine/resident-life.ts';
import {knownResident,type ResidentOwnershipKind} from './resident-life-adapter.ts';

export function enrollResidentRoster(world:WorldState,life:LifeState,now:number,
  policy:{roster:string;ownershipKind:(id:string)=>ResidentOwnershipKind;allowedPlaceIds:readonly string[]}):{world:WorldState;life:LifeState;joined:string[];changed:boolean} {
  if(policy.roster!==RESIDENT_ROSTER_MODE)throw Error('unsupported resident roster');
  if(!Number.isSafeInteger(now)||now<0||new Set(world.muses.map(m=>m.id)).size!==world.muses.length)throw Error('invalid resident enrollment state');
  for(const entry of RESIDENT_INSTANCES){
    if(!knownResident(entry.id,policy.ownershipKind))throw Error('resident roster ownership conflict');
    const existing=world.muses.find(m=>m.id===entry.id);
    if(existing&&(existing.controlMode==='personal'||existing.profile||existing.residentRole!==entry.roleId))throw Error('resident roster identity collision');
    if(placeById(entry.home).zone!=='commons')throw Error('resident roster place conflict');
  }
  const destinations=policy.allowedPlaceIds.filter(id=>{try{return placeById(id).zone==='commons';}catch{return false;}});
  if(!destinations.length)throw Error('resident roster requires public routine places');
  const next=structuredClone(world),nextLife=restoreLife(saveLife(life)),joined:string[]=[];
  for(const entry of RESIDENT_INSTANCES){
    const h=harnessById(entry.id);
    if(!next.muses.some(m=>m.id===entry.id)){
      // Only a non-transferable role prop is seeded. No currency, passes, gifts or craft receipts are invented.
      const actor:MuseState={id:entry.id,residentRole:entry.roleId,place:entry.home,travel:null,beat:null,inventory:h.roleItem?[h.roleItem]:[],memory:[],reflection:'',lastMet:{},intent:null,
        wants:{goal:h.wants.goal,items:[...h.wants.items],source:'harness',updatedAt:now}};
      next.muses.push(actor);joined.push(entry.id);
    }
    if(!nextLife.residents.some(r=>r.id===entry.id))nextLife.residents.push({id:entry.id,roleId:entry.roleId,goal:h.wants.goal,
      routine:[{hour:0,place:destinations.includes(entry.home)?entry.home:destinations[RESIDENT_INSTANCES.indexOf(entry)%destinations.length]}],memories:[],promises:[],lastServedAt:0,served:0});
  }
  if(next.muses.length>64)throw Error('resident world capacity');
  const validated=restoreLife(saveLife(nextLife));
  return {world:next,life:validated,joined,changed:joined.length>0||saveLife(life)!==saveLife(validated)};
}
