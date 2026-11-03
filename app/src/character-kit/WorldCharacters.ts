import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MaterialLibrary,loadMuseLight} from './MaterialLibrary.ts';
import {RESIDENT_VARIANTS} from './catalog.ts';

export type LegacyCharacter = {glb:string;sigils:string[];height:number};
async function loadLegacy(asset:LegacyCharacter){
 const source=(await new GLTFLoader().loadAsync(asset.glb)).scene;
 const textures=await Promise.all(asset.sigils.map(url=>new T.TextureLoader().loadAsync(url)));
 textures.forEach(texture=>{texture.colorSpace=T.SRGBColorSpace;texture.flipY=false;});
 return {source,textures};
}
/** Owns character source selection; the injectable legacy loader is the external file/image boundary. */
export async function loadWorldCharacters(asset:LegacyCharacter,library:MaterialLibrary|null,legacyLoader=loadLegacy){
 if(!Number.isFinite(asset.height)||asset.height<=0)throw Error('Invalid legacy height metadata');
 const light=library?await Promise.all(RESIDENT_VARIANTS.map(id=>loadMuseLight(id,library).catch(()=>{console.warn('Muse variant unavailable, using base:',id);return loadMuseLight('00-jolly',library);}))).catch(()=>{console.warn('Rigged kit unavailable, using rigid preview characters');return null;}):null;
 if(light)return {light,source:null,textures:[],sourceHeight:asset.height};
 const legacy=await legacyLoader(asset);
 return {light:null,source:legacy.source,textures:legacy.textures,sourceHeight:new T.Box3().setFromObject(legacy.source).getSize(new T.Vector3()).y};
}
