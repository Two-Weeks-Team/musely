import type {Mesh} from 'three';

// These are the authored eye-height ratios of the named expression targets.
// Blink is also a relative target: multiplying its weight by the current eye
// ratio closes that expression instead of adding two independent squash deltas.
const eyeScale:Record<string,[number,number]>={Neutral:[1,1],Smile:[.87,.87],Curious:[1.15,.95],Thinking:[1,1],Focused:[.73,.73],Listening:[1.08,1.08],Concerned:[1,1],Delight:[.48,.48]};
export function applyFaceControls(meshes:readonly Mesh[],expression:string,blinkLeft:number,blinkRight:number,mouth:number){
 const [left,right]=eyeScale[expression]??eyeScale.Neutral;
 for(const mesh of meshes){
  const dict=mesh.morphTargetDictionary,weights=mesh.morphTargetInfluences;if(!dict||!weights)continue;
  weights.fill(0);if(dict[expression]!==undefined)weights[dict[expression]]=1;
  if(dict.Blink_L!==undefined)weights[dict.Blink_L]=Math.max(0,Math.min(1,blinkLeft))*left;
  if(dict.Blink_R!==undefined)weights[dict.Blink_R]=Math.max(0,Math.min(1,blinkRight))*right;
  if(dict.MouthOpen!==undefined)weights[dict.MouthOpen]=Math.max(0,Math.min(1,mouth));
 }
}
