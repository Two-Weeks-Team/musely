import * as T from 'three';
// Logical Muse nodes remain stable for following, picking and bounds. Their primitives
// share GPU batches; per-instance colors preserve each original palette.
export function instanceMovingMeshes(scene:T.Scene,roots:T.Object3D[]){
 const groups=new Map<string,{material:T.Material;geometry:T.BufferGeometry;items:T.Mesh[]}>();
 for(const root of roots)root.traverse(o=>{if(!(o instanceof T.Mesh))return;if(Array.isArray(o.material))throw Error('Expected individual glTF primitives');const g=o.geometry as T.BufferGeometry&{parameters?:unknown};const m=o.material as T.MeshStandardMaterial;const key=JSON.stringify([g.type,g.parameters||g.uuid,m.type,m.map?.uuid,m.opacity,m.name]);if(!groups.has(key))groups.set(key,{geometry:g,material:m,items:[]});groups.get(key)!.items.push(o);o.visible=false;});
 const batches:{mesh:T.InstancedMesh;items:T.Mesh[]}[]=[];
 for(const {material,geometry,items} of groups.values()){
  const m=material.clone() as T.MeshStandardMaterial;m.color.set('#ffffff');
  if(m.emissive){const src=material as T.MeshStandardMaterial;const ratio=src.emissive.r/Math.max(.001,src.color.r);m.emissive.setRGB(ratio,ratio,ratio);m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif');};}
  const mesh=new T.InstancedMesh(geometry,m,items.length);mesh.name='MuseBatch_'+batches.length;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);items.forEach((item,i)=>mesh.setColorAt(i,(item.material as T.MeshStandardMaterial).color));scene.add(mesh);batches.push({mesh,items});
 }
 return ()=>{roots.forEach(root=>root.updateMatrixWorld(true));for(const {mesh,items}of batches){items.forEach((item,i)=>mesh.setMatrixAt(i,item.matrixWorld));mesh.instanceMatrix.needsUpdate=true;}};
}
