import {renderTemplate} from './embedding.mjs';import {Script} from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import {build} from 'esbuild';
const manifest=JSON.parse(await readFile('assets/source-manifest.json','utf8'));
for(const [name,m]of Object.entries(manifest)){const b=await readFile('assets/'+name);if(createHash('sha256').update(b).digest('hex')!==m.sha256)throw Error('Changed source asset: '+name);}
await import('./prepare-assets.mjs');
const bundle=await build({entryPoints:['src/main.ts'],bundle:true,write:false,format:'iife',target:'es2022',minify:true,legalComments:'inline'});
const css=await readFile('node_modules/maplibre-gl/dist/maplibre-gl.css','utf8')+'\n'+await readFile('src/style.css','utf8');
const html=renderTemplate(await readFile('src/index.html','utf8'),css,bundle.outputFiles[0].text);
new Script(html.split('<script>')[1].split('</script>')[0]);
await mkdir('dist',{recursive:true});await writeFile('dist/index.html',html);await writeFile('dist/_headers',await readFile('static/_headers'));
console.log(JSON.stringify({bytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex'),sourceAssets:manifest},null,2));
