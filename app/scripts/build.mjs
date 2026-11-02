import {renderTemplate} from './embedding.mjs';import {deriveClipsGlb} from './clips-glb.mjs';import {Script} from 'node:vm';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {build} from 'esbuild';
const manifest=JSON.parse(await readFile('assets/source-manifest.json','utf8'));
for(const [name,m]of Object.entries(manifest)){const b=await readFile('assets/'+name);if(createHash('sha256').update(b).digest('hex')!==m.sha256)throw Error('Changed source asset: '+name);}
await import('./prepare-assets.mjs');
const bundle=await build({entryPoints:['src/main.ts'],bundle:true,write:false,format:'iife',target:'es2022',minify:true,legalComments:'inline'});
const css=await readFile('node_modules/maplibre-gl/dist/maplibre-gl.css','utf8')+'\n'+await readFile('src/style.css','utf8');
const html=renderTemplate(await readFile('src/index.html','utf8'),css,bundle.outputFiles[0].text);
new Script(html.split('<script>')[1].split('</script>')[0]);
await mkdir('dist',{recursive:true});await writeFile('dist/index.html',html);await writeFile('dist/_headers',await readFile('static/_headers'));
// Public policy pages and the Musely icon (served at /privacy, /terms, /icon.svg, /icon-512.png).
for(const f of['privacy.html','terms.html','icon.svg','icon-512.png','mcp-docs.html'])await copyFile('static/'+f,'dist/'+f);
console.log(JSON.stringify({bytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex'),sourceAssets:manifest},null,2));

// In-demo character viewer (ten Muses) at /characters/, loading the same runtime files as the world.
const viewer=await build({entryPoints:['src/character-kit/MaterialProof.ts'],bundle:true,write:false,format:'esm',target:'es2022',minify:true});
await mkdir('dist/characters',{recursive:true});await writeFile('dist/characters/index.html',renderTemplate(await readFile('src/character-kit/materialProof.html','utf8'),await readFile('src/character-kit/proof.css','utf8'),viewer.outputFiles[0].text).replace('<script>','<script type="module">'));
// Only manifest-allowlisted runtime files are served, after their hashes are checked; source,
// references and validation captures stay out of dist.
const kit=JSON.parse(await readFile('character-kit/manifest.json','utf8'));
for(const[path,info]of Object.entries(kit.files)){const bytes=await readFile('character-kit/runtime/'+path);if(createHash('sha256').update(bytes).digest('hex')!==info.sha256)throw Error('Changed character kit file: '+path);const out='dist/character-kit/runtime/'+path;await mkdir(out.slice(0,out.lastIndexOf('/')),{recursive:true});await copyFile('character-kit/runtime/'+path,out);}
// Light first view: rig + clips derived from the hash-checked base LOD0 (scripts/clips-glb.mjs).
const clips=deriveClipsGlb(await readFile('character-kit/runtime/base/lod0.glb'));await writeFile('dist/character-kit/runtime/base/clips.glb',clips);
console.log(JSON.stringify({clipsGlb:{bytes:clips.length,sha256:createHash('sha256').update(clips).digest('hex')}}));
