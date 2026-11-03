import {readFile,writeFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import {transform} from 'esbuild';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {Box3,Vector3} from 'three';
import {writeHashed} from './asset-files.mjs';
/** Inline descriptor is kept for the existing local proof; production copies unchanged binary assets to hash URLs. */
export async function prepareAssets(externalDir=null){
 const model=await readFile('assets/muse_base.glb'),sigils=await Promise.all(['a','b'].map(v=>readFile(`assets/variant_${v}.png`)));
 const worker=(await transform(await readFile('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs','utf8'),{format:'iife',target:'es2022',minify:true,legalComments:'inline'})).code;
 // Geometry-only parse gives the exact old sourceHeight without sending/decoding the legacy model on normal entry.
 const parsed=await new GLTFLoader().register(()=>({name:'GeometryOnlyHeight',loadTexture:async()=>null})).parseAsync(model.buffer.slice(model.byteOffset,model.byteOffset+model.byteLength),'');
 const sourceHeight=new Box3().setFromObject(parsed.scene).getSize(new Vector3()).y;
 const paths=externalDir?{glb:await writeHashed(externalDir,'legacy-muse','glb',model),sigils:await Promise.all(sigils.map((bytes,i)=>writeHashed(externalDir,'legacy-sigil-'+i,'png',bytes))),worker:await writeHashed(externalDir,'map-worker','cjs',worker)}:null;
 const embedded={glb:paths?'/'+paths.glb:'data:model/gltf-binary;base64,'+model.toString('base64'),sigils:paths?paths.sigils.map(p=>'/'+p):sigils.map(b=>'data:image/png;base64,'+b.toString('base64')),worker:paths?'':worker,workerUrl:paths?'/'+paths.worker:'',sourceHeight};
 await writeFile('assets/embedded.json',JSON.stringify(embedded));return {embedded,paths};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await prepareAssets();
