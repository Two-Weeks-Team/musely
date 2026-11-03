import type {Object3D, Scene} from 'three';
export type CampfireWorld = {worldId:string;version?:number;tick:number;lastTickAt:number;muses:readonly {id:string;place:string;travel:unknown}[]};
export interface CampfireScenePort {
 enable(options:{distanceM:()=>number}):Promise<boolean>;
 disable():void;
 /** Observation clock from a successful transport read, or the explicit recorded frame. */
 setWorld(world:CampfireWorld|null,observedAt?:number):void;
 update(at:number):void;
 dispose():void;
 getMetrics():unknown;
}
export function createCampfireScenePort(scene:Scene,legacyFire:Object3D,options?:{loadAsset?:()=>Promise<Object3D>}):CampfireScenePort;
