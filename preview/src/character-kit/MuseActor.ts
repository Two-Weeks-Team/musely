import * as T from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {BaseMuseActor} from './BaseMuseActor.ts';
import {fleeceFactor,variantById,type MuseVariantId} from './catalog.ts';
import type {MaterialLibrary} from './MaterialLibrary.ts';

export type Lod=0|1|2;
type Tagged=T.Object3D&{userData:{museLod?:Lod}};

/**
 * One world/viewer Muse: a shared rig and clips, body meshes for each loaded LOD bound to the same
 * skeleton, and a variant's garments (rebound by bone name) and props (parented to the matching bone).
 *
 * The actor can start from any LOD (the world's light first view starts from LOD2 with clips from
 * base/clips.glb) and gain LODs and its attachment later. The root, skeleton, mixer, action phase and
 * expression are never replaced, so upgrades and LOD switches do not interrupt motion.
 */
export class MuseActor extends BaseMuseActor{
 readonly variant:MuseVariantId;
 /** LOD currently rendered (the closest loaded LOD to the requested one). */
 lod:Lod;
 /** LOD the selector asked for; rendered as soon as it is loaded. */
 wanted:Lod;
 readonly loaded=new Set<Lod>();
 attachmentLoaded=false;
 readonly skeleton:T.Skeleton;
 private tagged:Tagged[]=[];
 private bones=new Map<string,T.Bone>();
 private bodyParent:T.Object3D;
 private library?:MaterialLibrary;
 private propMixer:T.AnimationMixer|null=null;
 private propActions=new Map<string,T.AnimationAction>();

 /**
  * Compatible form: `new MuseActor([lod0, lod1?, lod2?], attachment, variant, library)` (clips from LOD0).
  * Progressive form: pass `{gltf, lod, clips}` as the first argument with any single starting LOD.
  */
 constructor(base:readonly [GLTF,GLTF?,GLTF?]|{gltf:GLTF;lod:Lod;clips:readonly T.AnimationClip[]},attachment:GLTF|null,variant:MuseVariantId,library?:MaterialLibrary){
  const start=Array.isArray(base)?{gltf:base[0],lod:0 as Lod,clips:base[0].animations}:base as {gltf:GLTF;lod:Lod;clips:readonly T.AnimationClip[]};
  super(start.gltf,start.clips);
  this.variant=variant;this.root.name=`Muse_${variant}`;this.library=library;
  this.skeleton=this.meshes[0].skeleton;
  for(const b of this.skeleton.bones)this.bones.set(b.name,b);
  this.bodyParent=this.meshes[0].parent!;
  for(const m of this.meshes)this.tag(m,start.lod);
  this.loaded.add(start.lod);this.lod=this.wanted=start.lod;
  this.tint(this.meshes);
  if(Array.isArray(base))(base as readonly (GLTF|undefined)[]).forEach((g,lod)=>{if(g&&lod!==0)this.addLod(g,lod as Lod);});
  if(attachment)this.addAttachment(attachment);
  this.setLod(start.lod);
 }

 /** Bind another file's body LOD to this actor's skeleton. Safe to call while the actor is animating. */
 addLod(gltf:GLTF,lod:Lod){
  if(this.loaded.has(lod))return;
  const added:T.SkinnedMesh[]=[];
  gltf.scene.traverse(o=>{if(o instanceof T.SkinnedMesh){const m=this.rebind(o);this.bodyParent.add(m);this.meshes.push(m);added.push(m);this.tag(m,lod);}});
  this.tint(added);this.loaded.add(lod);this.setLod(this.wanted);
 }

 /** Add the variant's garments and props (all LODs in the file); visibility follows the rendered LOD. */
 addAttachment(attachment:GLTF){
  if(this.attachmentLoaded)return;
  const nodes:T.Object3D[]=[];attachment.scene.traverse(o=>{if(o.userData.musely_kind)nodes.push(o);});
  for(const node of nodes){
   const lod=(node.userData.musely_lod??0) as Lod;
   if(node.userData.musely_kind==='prop'){
    const bone=this.bones.get(node.parent?.name??'');if(!bone)throw Error(`Prop ${node.name} has no matching bone ${node.parent?.name}`);
    const c=node.clone(true);c.traverse(o=>{if(o instanceof T.Mesh)o.frustumCulled=false;});bone.add(c);this.tag(c,lod);
   }else{
    const group=new T.Group();group.name=node.name;
    node.traverse(o=>{if(o instanceof T.SkinnedMesh){const m=this.rebind(o);group.add(m);this.meshes.push(m);this.tint([m]);}});
    this.bodyParent.add(group);this.tag(group,lod);
   }
  }
  if(attachment.animations.length){this.propMixer=new T.AnimationMixer(this.root);for(const clip of attachment.animations)this.propActions.set(clip.name,this.propMixer.clipAction(clip));}
  this.attachmentLoaded=true;this.setLod(this.wanted);
 }

 private tint(meshes:readonly T.SkinnedMesh[]){
  if(!this.library||this.variant==='00-jolly')return;
  for(const m of meshes){const mat=m.material as T.MeshStandardMaterial;if(mat.name.startsWith('Fleece'))m.material=this.library.fleece(this.variant,mat);}
 }
 /** Bind another file's skinned geometry to this actor's skeleton, remapping joints by bone name. */
 private rebind(src:T.SkinnedMesh){
  const names=src.skeleton.bones.map(b=>b.name),own=this.skeleton.bones.map(b=>b.name);
  let geometry=src.geometry;
  if(names.join()!==own.join()){
   const map=names.map(n=>{const k=own.indexOf(n);if(k<0)throw Error(`Bone ${n} is not in the shared Muse rig`);return k;});
   geometry=src.geometry.clone();const idx=geometry.attributes.skinIndex as T.BufferAttribute;
   for(let i=0;i<idx.count;i++)for(let c=0;c<4;c++)idx.setComponent(i,c,map[idx.getComponent(i,c)]);idx.needsUpdate=true;
  }
  const m=new T.SkinnedMesh(geometry,src.material);m.name=src.name;m.morphTargetInfluences=src.morphTargetInfluences?.slice();m.morphTargetDictionary=src.morphTargetDictionary;
  m.frustumCulled=false;m.bind(this.skeleton,src.bindMatrix.clone());return m;
 }
 private tag(o:T.Object3D,lod:Lod){(o as Tagged).userData.museLod=lod;this.tagged.push(o as Tagged);}
 /** Closest loaded LOD to `want`; ties prefer more detail. */
 private nearest(want:Lod):Lod{
  let best=[...this.loaded][0];
  for(const l of this.loaded)if(Math.abs(l-want)<Math.abs(best-want)||(Math.abs(l-want)===Math.abs(best-want)&&l<best))best=l;
  return best;
 }
 /** Swap rendered meshes only; root, skeleton, action time and expression continue. */
 setLod(lod:Lod){
  this.wanted=lod;this.lod=this.nearest(lod);
  // Garments/props for a LOD whose file has not arrived fall back to the closest attachment LOD (0..2 all ship together).
  for(const o of this.tagged)o.visible=o.userData.museLod===this.lod;
 }
 update(time:number,pose:import('./BaseMuseActor.ts').RoutePose,actionTime=time){
  super.update(time,pose,actionTime);
  if(this.propMixer){const a=this.propActions.get(this.current);if(a){a.reset().play();this.propMixer.setTime(Math.max(0,actionTime)%a.getClip().duration);}else this.propMixer.stopAllAction();this.root.updateMatrixWorld(true);}
 }
 dispose(){this.propMixer?.stopAllAction();this.propMixer?.uncacheRoot(this.root);super.dispose();}
 /** Materials of currently rendered meshes (diagnostics for material/tint checks). */
 visibleMaterials(){const out:{mesh:string;material:string;color:string;map:boolean;normal:boolean}[]=[];this.root.traverseVisible(o=>{if(o instanceof T.Mesh)for(const m of [o.material].flat() as T.MeshStandardMaterial[])out.push({mesh:o.name,material:m.name,color:'#'+m.color.getHexString(T.LinearSRGBColorSpace),map:!!m.map,normal:!!m.normalMap});});return out;}
 visibleTriangles(){let n=0;this.root.traverseVisible(o=>{if(o instanceof T.Mesh){const g=o.geometry;n+=(g.index?g.index.count:g.attributes.position.count)/3;}});return n;}
 getMetrics(){return {...super.getMetrics(),variant:this.variant,lod:this.lod,wantedLod:this.wanted,loadedLods:[...this.loaded].sort(),attachment:this.attachmentLoaded,triangles:this.visibleTriangles(),tint:variantById(this.variant).body,fleeceFactor:fleeceFactor(variantById(this.variant).body)};}
}
