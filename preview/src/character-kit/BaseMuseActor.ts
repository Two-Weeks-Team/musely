import * as T from 'three';
import {GLTFLoader,type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {applyFaceControls} from './FaceControls.ts';
import {SINGLE_PLAY as singlePlay} from './catalog.ts';
export type RoutePose={x:number;y:number;z:number;yaw:number};
/** Shared source resources, independent pose/expression state, no root motion. */
export class BaseMuseActor{
 readonly root:T.Group;
 readonly mixer:T.AnimationMixer;
 readonly meshes:T.SkinnedMesh[]=[];
 private actions=new Map<string,T.AnimationAction>();
 protected current='idle_breathe';
 private expression='Neutral';
 /** `clips` defaults to the source's own animations; the light first view passes clips from base/clips.glb. */
 constructor(source:GLTF,clips:readonly T.AnimationClip[]=source.animations){
  this.root=clone(source.scene) as T.Group;this.root.name='Jolly_actor';this.mixer=new T.AnimationMixer(this.root);
  this.root.traverse(o=>{if(o instanceof T.SkinnedMesh){o.frustumCulled=false;this.meshes.push(o);}});
  for(const clip of clips){const a=this.mixer.clipAction(clip);if(singlePlay.has(clip.name)){a.setLoop(T.LoopOnce,1);a.clampWhenFinished=true;}this.actions.set(clip.name,a);}
  this.setAction('idle_breathe');
 }
 setAction(name:string){if(!this.actions.has(name))throw Error('Missing Muse action: '+name);if(name!==this.current){this.mixer.stopAllAction();this.current=name;}this.actions.get(name)!.play();}
 setExpression(name:string){if(!['Neutral','Smile','Curious','Thinking','Focused','Listening','Concerned','Delight'].includes(name))throw Error('Unknown Muse expression: '+name);this.expression=name;}
 update(time:number,pose:RoutePose,actionTime=time){
  const a=this.actions.get(this.current)!,duration=a.getClip().duration;
  a.reset().play();this.mixer.setTime(singlePlay.has(this.current)?Math.min(Math.max(0,actionTime),duration-.00001):Math.max(0,actionTime)%duration);
  const blink=Math.max(0,1-Math.abs((time%4.6)-4.35)/.11);
  applyFaceControls(this.meshes,this.expression,blink,blink,this.current==='talk'?Math.max(0,Math.sin(time*13))*.65:0);
  this.root.position.set(pose.x,pose.y,pose.z);this.root.rotation.y=pose.yaw;this.root.updateMatrixWorld(true);for(const m of this.meshes)m.skeleton.update();
 }
 getBounds(){for(const mesh of this.meshes)mesh.computeBoundingBox();return new T.Box3().setFromObject(this.root);}
 getMetrics(){return {action:this.current,expression:this.expression,skins:this.meshes.length,rootId:this.root.uuid,position:this.root.position.toArray(),bounds:this.getBounds()};}
 dispose(){this.mixer.stopAllAction();this.mixer.uncacheRoot(this.root);for(const s of new Set(this.meshes.map(m=>m.skeleton)))s.dispose();this.root.removeFromParent();}
}
const sources=new Map<string,Promise<GLTF>>();
export async function loadMuseBase(url:string){if(!sources.has(url))sources.set(url,new GLTFLoader().loadAsync(url).catch(e=>{sources.delete(url);throw e;}));return new BaseMuseActor(await sources.get(url)!);}
