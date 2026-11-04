import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {resolveAppearance,type AppearanceId} from './appearance.ts';
import {MuseActor,type Lod} from './MuseActor.ts';
import {attachmentUrl,fleeceFactor,lodUrl,propsUrl,variantById,type MuseVariantId} from './catalog.ts';

type KitLoader=Pick<GLTFLoader,'loadAsync'>;
// Consume the original HTTP response before parsing. FileLoader's stream wrapper can
// report ERR_ABORTED in Chrome even after its wrapped consumer received the whole GLB.
function nativeKitLoader():KitLoader{
 const parser=new GLTFLoader();
 return {async loadAsync(url:string){
  const response=await fetch(url);
  if(!response.ok)throw new Error(`Character asset request failed (${response.status})`);
  return parser.parseAsync(await response.arrayBuffer(),T.LoaderUtils.extractUrlBase(url));
 }};
}

/** Caches parsed kit files and tinted fleece so every actor shares geometry, maps and palettes. */
export class MaterialLibrary{
 private files=new Map<string,Promise<GLTF>>();
 private fleeces=new Map<string,T.MeshStandardMaterial>();
 readonly base:string;private loader:KitLoader;
 constructor(base='/character-kit/runtime/',loader:KitLoader=nativeKitLoader()){this.base=base;this.loader=loader;}
 /** Parse a kit file once; transient network failures are retried twice before giving up. */
 load(url:string){
  if(!this.files.has(url)){
   const attempt=(n:number):Promise<GLTF>=>this.loader.loadAsync(url).catch(e=>n>0?new Promise<GLTF>(r=>setTimeout(()=>r(attempt(n-1)),400*(3-n))):Promise.reject(e));
   this.files.set(url,attempt(2).catch(e=>{this.files.delete(url);throw e;}));
  }
  return this.files.get(url)!;
 }
 /** One tinted copy per color and source fleece material; maps and normal/roughness stay shared. */
 fleece(variant:MuseVariantId,source:T.MeshStandardMaterial){return this.fleeceColor(variantById(variant).body,source);}
 fleeceColor(body:string,source:T.MeshStandardMaterial){
  const key='body|'+body+'|'+source.uuid;let m=this.fleeces.get(key);
  if(!m){m=source.clone();m.name=source.name+' · '+body;const [r,g,b]=fleeceFactor(body);m.color.setRGB(r,g,b,T.LinearSRGBColorSpace);const phys=m as T.MeshPhysicalMaterial;if(phys.isMeshPhysicalMaterial&&phys.sheen>0)phys.sheenColor.set(body);this.fleeces.set(key,m);}return m;
 }
 accentColor(accent:string,source:T.MeshStandardMaterial){const key='accent|'+accent+'|'+source.uuid;let m=this.fleeces.get(key);if(!m){m=source.clone();m.name=source.name+' · '+accent;m.color.set(accent);this.fleeces.set(key,m);}return m;}

 dispose(){for(const m of this.fleeces.values())m.dispose();this.fleeces.clear();}
}

/** Resolve the shared rig, all three body LODs and the variant attachment, returning an independent actor. */
export async function loadMuse(id:MuseVariantId,library:MaterialLibrary,lods:readonly Lod[]=[0,1,2],appearance:AppearanceId=id){
 const deco=resolveAppearance(appearance).deco,att=deco==='none'?null:attachmentUrl(deco,library.base);
 const [l0,l1,l2,attachment]=await Promise.all([library.load(lodUrl(0,library.base)),lods.includes(1)?library.load(lodUrl(1,library.base)):undefined,lods.includes(2)?library.load(lodUrl(2,library.base)):undefined,att?library.load(att):null]);
 return new MuseActor([l0,l1,l2],attachment,id,library,appearance);
}

/** Rig + clips derived at build time from base/lod0.glb (scripts/clips-glb.mjs). */
export const clipsUrl=(base:string)=>`${base}base/clips.glb`;

/**
 * Light first view: an actor from LOD2 (~0.45 MB) and the shared clips (~0.27 MB) only. Returns once
 * those load; `upgrade()` then adds the attachment, LOD1 and LOD0 in that order without replacing the
 * actor. A failed attachment leaves the plain base Muse; a failed LOD keeps the closest loaded LOD.
 */
export async function loadMuseLight(id:MuseVariantId,library:MaterialLibrary,appearance:AppearanceId=id){
 const [l2,clips]=await Promise.all([library.load(lodUrl(2,library.base)),library.load(clipsUrl(library.base))]);
 const actor=new MuseActor({gltf:l2,lod:2,clips:clips.animations},null,id,library,appearance);
 const upgrade=async(steps:readonly ('attachment'|'props'|Lod)[]=['attachment',1,0,'props'])=>{
  for(const step of steps){
   try{
    if(step==='attachment'){const deco=resolveAppearance(appearance).deco,url=deco==='none'?null:attachmentUrl(deco,library.base);if(url)actor.addAttachment(await library.load(url));}
    else if(step==='props')actor.addProps(await library.load(propsUrl(library.base)));
    else actor.addLod(await library.load(lodUrl(step,library.base)),step);
   }catch(e){console.warn('Muse upgrade step unavailable, keeping current detail:',id,step,e);}
  }
 };
 return {actor,upgrade};
}
