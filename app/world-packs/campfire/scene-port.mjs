import {createCampfireView} from './renderer.mjs';
import asset from './asset.json' with {type:'json'};
const ports = new WeakMap();
const PLACE = 'commons:campfire';
const disposeSource = scene => {
 const resources=new Set();scene.traverse(o=>{if(o.isMesh){resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])resources.add(m);}});
 resources.forEach(r=>r.dispose());
};
async function loadBundledAsset(){
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
 const response=await fetch(asset.url,{credentials:'same-origin',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Campfire asset unavailable');
 const bytes=await response.arrayBuffer();
 if(bytes.byteLength!==asset.bytes)throw Error('Campfire asset size mismatch');
 const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 const sha=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
 if(sha!==asset.sha256)throw Error('Campfire asset integrity mismatch');
 return (await new GLTFLoader().parseAsync(bytes,'')).scene;
}
/** Read-only port for makeWorld's existing Fire group. No map transform or world writes.
 * Only flame/spark meshes are retained: existing batched ring/logs/benches stay intact.
 * loadAsset returns an exclusively owned, untextured source scene, disposed after cloning.
 */
export function createCampfireScenePort(scene, legacyFire, {loadAsset=loadBundledAsset}={}) {
 if(ports.has(scene))throw new Error('Campfire port already attached');
 if(legacyFire?.parent!==scene || legacyFire.name!=='Fire')throw new Error('Expected existing direct Fire group');
 let view=null,pending=null,epoch=0,disposed=false,distance=()=>Infinity,snapshot;
 const legacyVisible=legacyFire.visible;
 function disable(){
  if(disposed)return;
  epoch++;pending=null;const previous=view;view=null;snapshot=undefined;
  try{previous?.dispose();}finally{legacyFire.visible=legacyVisible;}
 }

 function setWorld(world, observedAt=world?.lastTickAt){
  snapshot=undefined;
  if(!world || !Array.isArray(world.muses) || !Number.isFinite(world.lastTickAt) || !Number.isFinite(observedAt))return;
  snapshot={placeId:PLACE,observedAt,receiptId:`projection:${world.worldId}:${world.version??world.tick}`,
   arrivedMuseIds:world.muses.filter(m=>m && typeof m.id==='string' && m.place===PLACE && m.travel===null).map(m=>m.id)};
 }
 function update(at){
  if(!view || disposed)return;
  let d=Infinity;try{d=distance();}catch{} // Missing camera data never shows a full-detail prop.
  view.update(d,at,snapshot);
 }
 function enable(options){
  if(disposed)return Promise.reject(new Error('Campfire port disposed'));
  if(typeof options?.distanceM!=='function')return Promise.reject(new Error('distanceM provider required'));
  distance=options.distanceM;
  if(view)return Promise.resolve(true);
  if(pending)return pending;
  const token=++epoch;
  const attempt=(async()=>{
   let source;
   try{
    source=await loadAsset();
    if(disposed || token!==epoch)return false;
    const next=createCampfireView(source,PLACE);
    // This is a flame replacement, not a second complete campfire/seat arrangement.
    next.group.traverse(o=>{if(o.isMesh && !o.name.startsWith('flame_') && o.name!=='bright_core' && !o.name.startsWith('spark_'))o.visible=false;});
    // The unnamed cone is the far-LOD marker; keep its ownership/visibility controlled by renderer.
    next.group.position.set(legacyFire.position.x,0,legacyFire.position.z);
    scene.add(next.group);view=next;legacyFire.visible=false;return true;
   }finally{
    if(source)disposeSource(source);
   }
  })();
  pending=attempt;
  const clear=()=>{if(token===epoch && pending===attempt)pending=null;};
  void attempt.then(clear,clear); // also runs after a synchronous custom loader failure
  return attempt;
 }
 const port={enable,disable,setWorld,update,dispose(){if(disposed)return;try{disable();}finally{disposed=true;ports.delete(scene);}},
  getMetrics(){return {enabled:!!view,pending:!!pending,disposed,placeId:PLACE,frame:view?.frame??null,mode:'flame-only-existing-seats',productionAcceptance:false};}};
 ports.set(scene,port);return port;
}
