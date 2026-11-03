import {createRepresentations} from './asset-representations.mjs';
import {renderExternalTemplate} from './embedding.mjs';import {deriveClipsGlb} from './clips-glb.mjs';import {Script} from 'node:vm';
import {readFile,writeFile,mkdir,copyFile,rm,lstat} from 'node:fs/promises';import {build} from 'esbuild';
import {prepareAssets} from './prepare-assets.mjs';import {writeHashed,assetSHA,distFiles,verifyAssetManifest} from './asset-files.mjs';
const sourceAssets=JSON.parse(await readFile('assets/source-manifest.json','utf8'));
for(const[name,m]of Object.entries(sourceAssets)){const bytes=await readFile('assets/'+name);if(assetSHA(bytes)!==m.sha256)throw Error('Changed source asset: '+name);}
if((await lstat('dist').catch(()=>null))?.isSymbolicLink())throw Error('dist must not be a symlink');
await rm('dist',{recursive:true,force:true});await mkdir('dist');
const {paths}=await prepareAssets('dist');
const bundle=await build({entryPoints:['src/main.ts'],bundle:true,write:false,format:'iife',target:'es2022',minify:true,legalComments:'inline'});
new Script(bundle.outputFiles[0].text);
const css=await readFile('node_modules/maplibre-gl/dist/maplibre-gl.css','utf8')+'\n'+await readFile('src/style.css','utf8');
const app=await writeHashed('dist','app','js',bundle.outputFiles[0].text),style=await writeHashed('dist','world','css',css);
const template=(await readFile('src/index.html','utf8')).replace('Application code, character assets and a geographic overview are embedded in this file.','Application code and character files are served as hash-pinned resources. The geographic overview loads on demand when viewing the Bay.');
const html=renderExternalTemplate(template,'/'+style,'/'+app);await writeFile('dist/index.html',html);
await copyFile('static/_headers','dist/_headers');
for(const f of['privacy.html','terms.html','icon.svg','icon-512.png','mcp-docs.html'])await copyFile('static/'+f,'dist/'+f);
const viewer=await build({entryPoints:['src/character-kit/MaterialProof.ts'],bundle:true,write:false,format:'esm',target:'es2022',minify:true});
const viewerApp=await writeHashed('dist','character-viewer','js',viewer.outputFiles[0].text),viewerCSS=await writeHashed('dist','character-viewer','css',await readFile('src/character-kit/proof.css'));
await mkdir('dist/characters');await writeFile('dist/characters/index.html',renderExternalTemplate(await readFile('src/character-kit/materialProof.html','utf8'),'/'+viewerCSS,'/'+viewerApp,true));
const kit=JSON.parse(await readFile('character-kit/manifest.json','utf8'));
for(const[path,info]of Object.entries(kit.files)){const bytes=await readFile('character-kit/runtime/'+path);if(assetSHA(bytes)!==info.sha256)throw Error('Changed character kit file: '+path);const out='dist/character-kit/runtime/'+path;await mkdir(out.slice(0,out.lastIndexOf('/')),{recursive:true});await writeFile(out,bytes);}
const clips=deriveClipsGlb(await readFile('character-kit/runtime/base/lod0.glb'));await writeFile('dist/character-kit/runtime/base/clips.glb',clips);
const representations=await createRepresentations(p=>readFile('dist/'+p),(p,b)=>writeFile('dist/'+p,b));
const runtimePaths=[...Object.keys(kit.files),'base/clips.glb'].map(p=>'character-kit/runtime/'+p);
const critical=['index.html',app,style,paths.worker,'character-kit/runtime/base/lod2.glb','character-kit/runtime/base/clips.glb'];
const roles=new Map([[app,'app'],[style,'style'],[paths.worker,'map-worker'],[paths.overview,'arrival-overview'],[paths.glb,'legacy-model'],...paths.sigils.map(p=>[p,'legacy-sigil']),[viewerApp,'character-viewer'],[viewerCSS,'character-viewer-style']]);
const files=[];for(const path of await distFiles('dist')){if(path==='_headers')continue;const bytes=await readFile('dist/'+path);files.push({path,bytes:bytes.length,sha256:assetSHA(bytes),role:roles.get(path)??(path.startsWith('character-kit/')?(/\.glb\.(br|gz)$/.test(path)?'character-runtime-encoding':'character-runtime'):path.endsWith('.html')?'document':'public-icon'),phase:critical.includes(path)?'critical':'deferred'});}
const mapStyle=JSON.parse(await readFile('assets/map-style.json','utf8')),remote=new Set();
function urls(value){if(typeof value==='string'&&value.startsWith('https://'))remote.add(value);else if(value&&typeof value==='object')for(const child of Object.values(value))urls(child);}urls(mapStyle);
const manifest={schemaVersion:'musely-assets-1',files,representations,critical:{paths:critical,bytes:files.filter(f=>critical.includes(f.path)).reduce((n,f)=>n+f.bytes,0),logicalDeadlineMs:12000,maxBytes:16*1024*1024},dynamicReferences:[paths.worker,paths.overview,paths.glb,...paths.sigils,...runtimePaths],externalReferences:[...[...remote].sort().map(url=>({url,role:'public-map-template',bytes:null,sha256:null,meaning:'Uncontrolled dynamic remote data; not a pinned local asset'})),{url:'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',role:'optional-human-session-script',bytes:null,sha256:null,meaning:'Existing authentication flow only; not invoked or pinned by this build; requires separate actual-source audit if used'}],sourceAssets,scope:'All controlled served files; self manifest and deployment _headers separately pinned; external dynamic services explicitly unmeasured',deployment:{path:'_headers',bytes:(await readFile('dist/_headers')).length,sha256:assetSHA(await readFile('dist/_headers'))}};
await verifyAssetManifest(manifest,path=>readFile('dist/'+path),{requiredRuntimePaths:runtimePaths});
await writeFile('dist/asset-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({bytes:Buffer.byteLength(html),sha256:assetSHA(html),criticalBytes:manifest.critical.bytes,servedFiles:files.length,manifestSHA256:assetSHA(await readFile('dist/asset-manifest.json')),sourceAssets},null,2));
