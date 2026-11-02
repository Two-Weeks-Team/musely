import {type Mesh,type Material,type Texture,MeshStandardMaterial} from 'three';
export function mapMeshMaterials(mesh:Mesh,convert:(material:Material)=>Material){mesh.material=Array.isArray(mesh.material)?mesh.material.map(convert):convert(mesh.material);}
export function paintMuseMaterial(m:Material,color:string,texture:Texture|null){const n=(m as MeshStandardMaterial).clone();n.roughness=.96;n.metalness=0;
 if(/body_cloth|hood_cloth/.test(n.name)){n.color.set(color);n.emissive.copy(n.color).multiplyScalar(.15);n.emissiveIntensity=1;}
 else if(/face_cream/.test(n.name)){n.color.set('#fff0cf');n.emissive.copy(n.color).multiplyScalar(.15);n.emissiveIntensity=1;}
 else if(/sigil/.test(n.name)){n.map=texture;n.emissiveMap=texture;n.emissive.set('#ffffff');n.emissiveIntensity=.2;}
 return n;}
