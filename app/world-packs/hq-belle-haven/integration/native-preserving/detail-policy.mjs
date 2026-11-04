// Existing regional primitives are not admitted as non-overlapping props.
export const DETAILS_ENABLED=false;
const nativeDuplicates=new Set(['warm-stone-walls','asphalt-roads','park-grass','terracotta-roofs','sage-roofs','sand-roofs','bay-water','warm-ground','window-glass','path-gravel']);
export function classifyRegionalPrimitives(gltf){
 return gltf.meshes.flatMap((mesh,meshIndex)=>mesh.primitives.map((p,primitiveIndex)=>{const name=gltf.materials[p.material]?.name;return{meshIndex,primitiveIndex,material:name,admitted:false,reason:nativeDuplicates.has(name)?'duplicates-native-geometry-or-building-dependent':'batched-props-lack-individual-current-scene-clearance'};}));
}
export function propAdmission({bounds,circleCenter={x:0,z:2},radius=500,clearance={}}){
 const reasons=[];if(!bounds||!Array.isArray(bounds.corners)||bounds.corners.length!==8||bounds.corners.some(p=>p.length!==3||p.some(x=>!Number.isFinite(x))))reasons.push('invalid-prop-bounds');else if(bounds.corners.some(([x,,z])=>Math.hypot(x-circleCenter.x,z-circleCenter.z)>radius-2))reasons.push('outside-circle-reserve');
 for(const k of ['nativeBuildings','roadsAndWater','commonsAuthoredObjects','walkingAndInteractionSpace','currentSourceVersion'])if(clearance[k]!=='verified')reasons.push('unverified-'+k);
 return {geometryCandidate:reasons.length===0,runtimeVisible:false,enabled:false,reasons:[...reasons,'actual-GPU-coexistence-unverified']};
}
