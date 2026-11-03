import{readFile,writeFile,mkdir,copyFile}from'node:fs/promises';import{build}from'esbuild';import{createHash}from'node:crypto';import{renderTemplate}from'./embedding.mjs';
import {prepareAssets} from './prepare-assets.mjs';
// Build both views from current sources into a separate development output.
// Production dist is neither an input nor an output of this command.
await prepareAssets();
const manifest=JSON.parse(await readFile('assets/source-manifest.json','utf8'));
for(const[name,entry]of Object.entries(manifest)){const bytes=await readFile('assets/'+name);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Changed source asset: '+name);}
const dir='dist-character-proof';await mkdir(dir+'/character-kit/runtime/base',{recursive:true});await mkdir(dir+'/world',{recursive:true});
const [proof,world]=await Promise.all([
 build({entryPoints:['src/character-kit/MaterialProof.ts'],bundle:true,write:false,format:'esm',target:'es2022',minify:true}),
 build({entryPoints:['src/main.ts'],bundle:true,write:false,format:'iife',target:'es2022',minify:true,legalComments:'inline'})
]);
const html=renderTemplate(await readFile('src/character-kit/materialProof.html','utf8'),await readFile('src/character-kit/proof.css','utf8'),proof.outputFiles[0].text).replace('<script>','<script type="module">');
const worldCss=await readFile('node_modules/maplibre-gl/dist/maplibre-gl.css','utf8')+'\n'+await readFile('src/style.css','utf8');
await writeFile(dir+'/index.html',html);
await writeFile(dir+'/world/index.html',renderTemplate(await readFile('src/index.html','utf8'),worldCss,world.outputFiles[0].text));
const kit=JSON.parse(await readFile('character-kit/manifest.json','utf8'));
for(const path of Object.keys(kit.files)){const out=dir+'/character-kit/runtime/'+path;await mkdir(out.slice(0,out.lastIndexOf('/')),{recursive:true});await copyFile('character-kit/runtime/'+path,out);}
const asset=await readFile(dir+'/character-kit/runtime/base/lod0.glb');console.log(JSON.stringify({htmlBytes:Buffer.byteLength(html),assetBytes:asset.length,assetSha256:createHash('sha256').update(asset).digest('hex')}));
