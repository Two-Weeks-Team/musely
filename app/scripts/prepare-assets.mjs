import {readFile,writeFile} from 'node:fs/promises';import {transform} from 'esbuild';
const embedded={glb:'data:model/gltf-binary;base64,'+(await readFile('assets/muse_base.glb')).toString('base64'),sigils:await Promise.all(['a','b'].map(async v=>'data:image/png;base64,'+(await readFile(`assets/variant_${v}.png`)).toString('base64'))),worker:(await transform(await readFile('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs','utf8'),{format:'iife',target:'es2022',minify:true,legalComments:'inline'})).code};
await writeFile('assets/embedded.json',JSON.stringify(embedded));
