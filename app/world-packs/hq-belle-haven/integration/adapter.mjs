import {Group, Matrix4} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as maplibre from 'maplibre-gl';
import {ORIGIN, toWgs84} from '../coordinates.mjs';
const {MercatorCoordinate}=maplibre;
export const WORLD_PACK_ENABLED=false;
export const ROOT_NAME='MuselyHQRegionalPack';
export function frameFor(geography){
 if(!Array.isArray(geography?.commons)||geography.commons.length!==2||geography.commons.some((v,i)=>!Number.isFinite(v)||Math.abs(v-ORIGIN[i])>1e-12))throw new Error('World-pack origin differs from application geography; rebuild required');
 if(!Number.isFinite(geography.gridBearingDeg))throw new Error('Finite application grid bearing required');
 const origin=MercatorCoordinate.fromLngLat(geography.commons,0),unit=origin.meterInMercatorCoordinateUnits(),yaw=geography.gridBearingDeg*Math.PI/180,c=Math.cos(yaw),s=Math.sin(yaw);
 return {origin,unit,yaw,toScene(lng,lat){const p=MercatorCoordinate.fromLngLat([lng,lat]);const e=(p.x-origin.x)/unit, south=(p.y-origin.y)/unit;return {x:e*c+south*s,z:-e*s+south*c};},toMercatorMatrix:new Matrix4().makeTranslation(origin.x,origin.y,origin.z).multiply(new Matrix4().makeScale(unit,-unit,unit)).multiply(new Matrix4().makeRotationX(Math.PI/2)).multiply(new Matrix4().makeRotationY(-yaw))};
}
const mounting=new WeakSet();
const CONTRACT='ENU-derived: east +X, up +Y, south +Z; geographic rotation 0';
/** Strict supported-format preflight BEFORE GLTFLoader can resolve any resource. */
export function inspectLocalGlb(bytes){
 if(!(bytes instanceof ArrayBuffer))throw new TypeError('GLB bytes must be an ArrayBuffer');
 if(bytes.byteLength<28||bytes.byteLength>32*1024*1024)throw new Error('Invalid GLB length');
 const view=new DataView(bytes);
 if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength)throw new Error('Invalid GLB header');
 const jsonLength=view.getUint32(12,true);
 if(jsonLength%4||20+jsonLength+8>bytes.byteLength||view.getUint32(16,true)!==0x4e4f534a)throw new Error('Invalid GLB JSON chunk');
 const binOffset=20+jsonLength,binLength=view.getUint32(binOffset,true);
 if(binLength%4||view.getUint32(binOffset+4,true)!==0x004e4942||binOffset+8+binLength!==bytes.byteLength)throw new Error('Exactly one embedded BIN chunk is required');
 let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes,20,jsonLength)));}catch{throw new Error('Invalid GLB JSON');}
 if(json.asset?.version!=='2.0'||json.extras?.coordinateSystem!==CONTRACT)throw new Error('Expected unrotated geographic mesh contract');
 // Offline geographic packs are intentionally a narrower format than arbitrary glTF.
 // Reject all URI-bearing objects, extensions and images, including data URIs, before parse.
 function check(value){if(!value||typeof value!=='object')return;for(const [key,v]of Object.entries(value)){if(key==='uri')throw new Error('URI resources are forbidden in offline world packs');if(key==='extensions')throw new Error('Extensions are unsupported in offline world packs');check(v);}}
 check(json);
 if(json.extensionsUsed?.length||json.extensionsRequired?.length||json.extensions||json.images?.length||json.textures?.length)throw new Error('Extensions and texture/image resources are unsupported');
 if(json.buffers?.length!==1||!Number.isInteger(json.buffers[0].byteLength)||json.buffers[0].byteLength>binLength||json.buffers[0].byteLength<binLength-3)throw new Error('Invalid embedded buffer');
 return json;
}
/** Isolated opt-in candidate. Caller supplies local bytes; never fetches resources.
 * Inverse-projects every vertex to WGS84 then into the actual Mercator scene frame.
 */
export async function mountRegionPack({parent,bytes,geography,enabled=WORLD_PACK_ENABLED}){
 if(enabled!==true)return {enabled:false,root:null,dispose(){}};
 if(!parent?.isObject3D)throw new TypeError('A Three Object3D parent is required');
 if(mounting.has(parent)||parent.getObjectByName(ROOT_NAME))throw new Error('Regional pack already mounted or mounting');
 mounting.add(parent);
 let root=null,closed=false;
 const resources=new Set(),disposed=new Set();
 function own(value){
  if(!value)return;
  if(Array.isArray(value)){value.forEach(own);return;}
  const add=r=>{if(!r||resources.has(r))return;resources.add(r);if(closed&&!disposed.has(r)){disposed.add(r);r.dispose();}};
  if(value.isMaterial||value.isBufferGeometry)add(value);
  if(value.isObject3D)value.traverse(o=>{if(o.isMesh){add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])add(m);}});
 }
 function dispose(){closed=true;root?.removeFromParent();for(const r of resources)if(!disposed.has(r)){disposed.add(r);r.dispose();}}
 try{
  const frame=frameFor(geography),json=inspectLocalGlb(bytes);
  const loader=new GLTFLoader();
  // Track resources as dependencies resolve, including partial parse failures and
  // late completions after rejection. No external resource loaders are registered.
  loader.register(parser=>{const get=parser.getDependency.bind(parser),geometries=parser.loadGeometries.bind(parser);parser.getDependency=(type,index)=>get(type,index).then(value=>{own(value);return value;});parser.loadGeometries=primitives=>geometries(primitives).then(value=>{own(value);return value;});return {name:'MUSELY_RESOURCE_LIFETIME'};});
  const gltf=await loader.parseAsync(bytes,'');own(gltf.scene);
  root=new Group();root.name=ROOT_NAME;root.userData={kind:'world-pack-integration-proof',runtimeEnabled:true,sourceProjection:'authoring-local-metres',targetProjection:'Musely Mercator scene',attribution:json.extras?.attribution};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(object=>{
   if(!object.isMesh)return;
   if(!object.matrixWorld.equals(new Matrix4()))throw new Error('Nonidentity source node transforms are unsupported');
   const geometry=object.geometry,positions=geometry.getAttribute('position');
   if(!positions)throw new Error('Mesh positions required');
   for(let i=0;i<positions.count;i++){const [lng,lat]=toWgs84(positions.getX(i),positions.getZ(i)),p=frame.toScene(lng,lat);positions.setXYZ(i,p.x,positions.getY(i),p.z);}
   positions.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  });
  root.add(gltf.scene);parent.add(root);
  return {enabled:true,root,frame,dispose};
 }catch(error){dispose();throw error;}finally{mounting.delete(parent);}
}
