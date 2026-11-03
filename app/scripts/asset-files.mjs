import {verifyRepresentations} from './asset-representations.mjs';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';import {createHash} from 'node:crypto';
import {externalCodePaths} from './device-metrics.mjs';
export const assetSHA=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function writeHashed(dir,name,extension,bytes){
 const path=`assets/${name}.${assetSHA(bytes)}.${extension}`;
 await mkdir(join(dir,'assets'),{recursive:true});await writeFile(join(dir,path),bytes);
 return path;
}
export async function distFiles(dir,prefix=''){
 const result=[];
 for(const entry of(await readdir(join(dir,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const path=prefix+entry.name;if(entry.isSymbolicLink())throw Error('Symlink in served files');
  if(entry.isDirectory())result.push(...await distFiles(dir,path+'/'));else result.push(path);
 }return result;
}
/** Validate the generated closure against bytes, static code tags, hashed URL literals and source kit requirements. */
export async function verifyAssetManifest(manifest,read,{requiredRuntimePaths=[]}={}){
 const byPath=new Map();
 for(const file of manifest.files){if(!/^[A-Za-z0-9_./-]+$/.test(file.path)||file.path.split('/').some(x=>!x||x==='.'||x==='..')||byPath.has(file.path))throw Error('Invalid manifest path');byPath.set(file.path,file);}
 const requirePath=path=>{if(!byPath.has(path))throw Error('Unlisted runtime reference: '+path);};
 for(const path of [...requiredRuntimePaths,...manifest.dynamicReferences])requirePath(path);
 const texts=[];
 for(const file of manifest.files){
  const bytes=await read(file.path);if(bytes.length!==file.bytes||assetSHA(bytes)!==file.sha256)throw Error('Asset hash mismatch: '+file.path);
  if(file.path.startsWith('assets/')){
   const hash=/\.([a-f0-9]{64})\.[a-z0-9]+$/.exec(file.path)?.[1];
   if(!hash)throw Error('Unhashed immutable asset');
   if(hash!==file.sha256)throw Error('Immutable URL hash mismatch: '+file.path);
  }
  if(/\.(html|js|cjs|css)$/.test(file.path))texts.push({file,text:bytes.toString('utf8')});
 }
 const origin='https://musely.net',documents=new Map();
 for(const {file,text}of texts)if(file.path.endsWith('.html')){
  const base=new URL(file.path,origin);
  for(const path of externalCodePaths(text,origin)){
   requirePath(path);
   const bases=documents.get(path)??[];bases.push(base);documents.set(path,bases);
  }
 }
 for(const {file,text}of texts){
   const fileURL=new URL(file.path,origin);
   const bases=file.path.endsWith('.html')||file.role==='map-worker'?[fileURL]:documents.get(file.path)??[new URL(origin)];
   const workerReference=(raw,base)=>{
    const url=new URL(raw,base);
    if(url.origin!==new URL(origin).origin||url.username||url.password||url.search||url.hash)throw Error('Unpinned runtime URL');
    requirePath(decodeURIComponent(url.pathname).slice(1));
   };
   // Plain constructor literals use the owning document, not the external app script's directory.
   // Explicit import.meta.url uses the script URL. Computed expressions still require runtime auditing.
   for(const match of text.matchAll(/\bnew\s+(?:(?:window|self|globalThis)\s*\.\s*)?(?:SharedWorker|Worker)\s*\(\s*(["'`])([^"'`\\\r\n]+)\1/g))for(const base of bases)workerReference(match[2],base);
   for(const match of text.matchAll(/\bnew\s+(?:(?:window|self|globalThis)\s*\.\s*)?(?:SharedWorker|Worker)\s*\(\s*new\s+URL\s*\(\s*(["'`])([^"'`\\\r\n]+)\1\s*,\s*(import\.meta\.url|(?:(?:window|self)\.)?location\.href|document\.baseURI)\s*\)/g))for(const base of match[3]==='import.meta.url'?[fileURL]:bases)workerReference(match[2],base);
   // Root URL literals may introduce a new local namespace: do not silently accept only today's /assets/ prefix.
   for(const match of text.matchAll(/["'`](\/[^"'`\s\\]*)["'`]/g)){
    const raw=match[1],url=new URL(raw,'https://musely.net'),path=decodeURIComponent(url.pathname);
    if(!/\.(js|mjs|cjs|css|glb|png|jpg|jpeg|webp|svg|json|ktx2)$/i.test(path))continue;
    if(url.origin!=='https://musely.net'||url.username||url.password||/[?#]/.test(raw))throw Error('Unpinned runtime URL');
    requirePath(path.slice(1));
   }
   // Generated descriptors use these literal namespaces. Dynamic kit members are independently enumerated below.
   for(const match of text.matchAll(/\/(assets\/[A-Za-z0-9_.-]+\.[A-Za-z0-9]+|character-kit\/runtime\/[A-Za-z0-9_./-]+\.(?:glb|png|ktx2))/g))requirePath(match[1]);
 }
 await verifyRepresentations(manifest,read);
 const critical=manifest.critical;
 if(new Set(critical.paths).size!==critical.paths.length)throw Error('Duplicate critical resource');
 for(const path of critical.paths)requirePath(path);
 for(const file of manifest.files)if(['app','style','map-worker'].includes(file.role)&&!critical.paths.includes(file.path))throw Error('Critical resource omitted');
 for(const path of ['index.html','character-kit/runtime/base/lod2.glb','character-kit/runtime/base/clips.glb'])if(!critical.paths.includes(path))throw Error('Critical resource omitted');
 if(critical.bytes!==critical.paths.reduce((n,p)=>n+byPath.get(p).bytes,0)||critical.logicalDeadlineMs!==12000||critical.maxBytes!==16*1024*1024)throw Error('Invalid critical closure budget');
 return {files:byPath.size,criticalBytes:critical.bytes};
}
