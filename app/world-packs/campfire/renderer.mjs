import * as THREE from 'three';
import {createCampfireController} from './controller.ts';
/** Clones all mutable GPU resources; cached/source scene is never disposed or mutated.
 * Does not create occupants. Seats are static architecture, not attendance claims.
 */
export function createCampfireView(sourceScene, placeId) {
  if(typeof placeId!=='string' || !placeId.trim()) throw new Error('placeId required');
  const group = new THREE.Group(); group.name = `campfire:${placeId}`;
  const model = sourceScene.clone(true); group.add(model);
  const owned = new Set(), flames=[], sparks=[], originals=new Map();
  model.traverse(o=>{
    if (!o.isMesh) return;
    o.geometry=o.geometry.clone();owned.add(o.geometry);
    const clone=m=>{const c=m.clone();owned.add(c);return c};
    o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
    originals.set(o,{position:o.position.clone(),scale:o.scale.clone()});
    if(o.name.startsWith('flame_') || o.name==='bright_core') flames.push(o);
    if(o.name.startsWith('spark_')) sparks.push(o);
  });
  const iconGeometry=new THREE.ConeGeometry(.15,.45,5);
  const iconMaterial=new THREE.MeshBasicMaterial({color:0xffaa55});
  owned.add(iconGeometry);owned.add(iconMaterial);
  const icon=new THREE.Mesh(iconGeometry,iconMaterial);icon.position.y=.35;icon.visible=false;group.add(icon);
  let frame, time=0;
  const controller=createCampfireController(placeId,{
    render(next){
      frame=next;group.visible=next.lod!=='hidden';model.visible=next.lod==='near'||next.lod==='mid';icon.visible=next.lod==='far';
      flames.forEach((o,i)=>{const s=originals.get(o).scale;const wobble=next.lod==='near'?Math.sin(time/311+i)*.055:0;o.scale.set(s.x*(1+wobble),s.y*next.flameScale,s.z);});
      sparks.forEach((o,i)=>{o.visible=next.sparksVisible;const p=originals.get(o).position;o.position.copy(p);if(o.visible){o.position.y=p.y+((time/1800+i*.17)%1)*.35;}});
      // A count is metadata only; no synthetic avatars, claims or events are emitted.
      group.userData.arrivedCount=next.attendees;group.userData.occupancyEvidenceRequired=true;
    },ownedResources:[...owned],detach(){group.removeFromParent();group.clear();}
  });
  // No known distance or authoritative snapshot at construction: fail closed.
  controller.update(Infinity, 0);
  return {group, update(distanceM,now,snapshot){time=Number.isFinite(now)?now:0;controller.update(distanceM,now,snapshot);},dispose(){controller.dispose();},get frame(){return frame;}};
}
