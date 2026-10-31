import * as T from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {BaseMuseActor} from './BaseMuseActor.ts';
import {fleeceFactor,variantById,type MuseVariantId} from './catalog.ts';
import type {MaterialLibrary} from './MaterialLibrary.ts';

export type Lod=0|1|2;
type Tagged=T.Object3D&{userData:{museLod?:Lod}};

/**
 * One world/viewer Muse: shared rig/clips from the base LOD0, swappable LOD1/LOD2 body meshes
 * bound to the same skeleton, and a variant's garments (rebound by bone name) and props (parented
 * to the matching bone). The root, skeleton, mixer, action phase and expression survive LOD changes.
 */
export class MuseActor extends BaseMuseActor{
 readonly variant:MuseVariantId;
 lod:Lod=0;
 readonly skeleton:T.Skeleton;
 private tagged:Tagged[]=[];
 private bones=new Map<string,T.Bone>();
 private propMixer:T.AnimationMixer|null=null;
 private propActions=new Map<string,T.AnimationAction>();
 constructor(lods:readonly [GLTF,GLTF?,GLTF?],attachment:GLTF|null,variant:MuseVariantId,library?:MaterialLibrary){
  super(lods[0]);
  this.variant=variant;this.root.name=`Muse_${variant}`;
  this.skeleton=this.meshes[0].skeleton;
  for(const b of this.skeleton.bones)this.bones.set(b.name,b);
  const bodyParent=this.meshes[0].parent!;
  for(const m of this.meshes)this.tag(m,0);
  lods.forEach((g,lod)=>{if(!g||lod===0)return;g.scene.traverse(o=>{if(o instanceof T.SkinnedMesh){const m=this.rebind(o);bodyParent.add(m);this.meshes.push(m);this.tag(m,lod as Lod);}});});
  if(attachment){
   const nodes:T.Object3D[]=[];attachment.scene.traverse(o=>{if(o.userData.musely_kind)nodes.push(o);});
   for(const node of nodes){
    const lod=(node.userData.musely_lod??0) as Lod;
    if(node.userData.musely_kind==='prop'){
     const bone=this.bones.get(node.parent?.name??'');if(!bone)throw Error(`Prop ${node.name} has no matching bone ${node.parent?.name}`);
     const c=node.clone(true);c.traverse(o=>{if(o instanceof T.Mesh)o.frustumCulled=false;});bone.add(c);this.tag(c,lod);
    }else{
     const group=new T.Group();group.name=node.name;
     node.traverse(o=>{if(o instanceof T.SkinnedMesh){const m=this.rebind(o);group.add(m);this.meshes.push(m);}});
     bodyParent.add(group);this.tag(group,lod);
    }
   }
  }
  if(attachment?.animations.length){this.propMixer=new T.AnimationMixer(this.root);for(const clip of attachment.animations)this.propActions.set(clip.name,this.propMixer.clipAction(clip));}
  if(library&&variant!=='00-jolly')for(const m of this.meshes){const mat=m.material as T.MeshStandardMaterial;if(mat.name.startsWith('Fleece'))m.material=library.fleece(variant,mat);}
  this.setLod(0);
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
 /** Swap rendered meshes only; root, skeleton, action time and expression continue. */
 setLod(lod:Lod){this.lod=lod;for(const o of this.tagged)o.visible=o.userData.museLod===lod;}
 update(time:number,pose:import('./BaseMuseActor.ts').RoutePose,actionTime=time){
  super.update(time,pose,actionTime);
  if(this.propMixer){const a=this.propActions.get(this.current);if(a){a.reset().play();this.propMixer.setTime(Math.max(0,actionTime)%a.getClip().duration);}else this.propMixer.stopAllAction();this.root.updateMatrixWorld(true);}
 }
 dispose(){this.propMixer?.stopAllAction();this.propMixer?.uncacheRoot(this.root);super.dispose();}
 /** Materials of currently rendered meshes (diagnostics for material/tint checks). */
 visibleMaterials(){const out:{mesh:string;material:string;color:string;map:boolean;normal:boolean}[]=[];this.root.traverseVisible(o=>{if(o instanceof T.Mesh)for(const m of [o.material].flat() as T.MeshStandardMaterial[])out.push({mesh:o.name,material:m.name,color:'#'+m.color.getHexString(T.LinearSRGBColorSpace),map:!!m.map,normal:!!m.normalMap});});return out;}
 visibleTriangles(){let n=0;this.root.traverseVisible(o=>{if(o instanceof T.Mesh){const g=o.geometry;n+=(g.index?g.index.count:g.attributes.position.count)/3;}});return n;}
 getMetrics(){return {...super.getMetrics(),variant:this.variant,lod:this.lod,triangles:this.visibleTriangles(),tint:variantById(this.variant).body,fleeceFactor:fleeceFactor(variantById(this.variant).body)};}
}
