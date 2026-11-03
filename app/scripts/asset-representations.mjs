import {brotliCompressSync,gzipSync,brotliDecompressSync,gunzipSync,constants} from 'node:zlib';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sources=['character-kit/runtime/base/lod2.glb','character-kit/runtime/base/clips.glb'];
export async function createRepresentations(read,write){
 const rows=[];
 for(const source of sources){const raw=await read(source);for(const encoding of ['br','gzip']){
  const bytes=encoding==='br'?brotliCompressSync(raw,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}):gzipSync(raw);
  const path=source+(encoding==='br'?'.br':'.gz');await write(path,bytes);
  rows.push({source,path,encoding,decodedBytes:raw.length,decodedSHA256:sha(raw)});
 }}return rows;
}
export async function verifyRepresentations(manifest,read){
 if(!Array.isArray(manifest.representations)||manifest.representations.length!==4)throw Error('Missing critical representations');
 const files=new Map(manifest.files.map(f=>[f.path,f])),seen=new Set();
 for(const row of manifest.representations){
  if(!sources.includes(row.source)||!['br','gzip'].includes(row.encoding)||row.path!==row.source+(row.encoding==='br'?'.br':'.gz')||seen.has(row.path))throw Error('Invalid representation binding');
  seen.add(row.path);const source=files.get(row.source),file=files.get(row.path);
  if(!source||!file||row.decodedBytes!==source.bytes||row.decodedSHA256!==source.sha256)throw Error('Invalid decoded binding');
  const bytes=await read(row.path);
  if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('Representation bytes changed');
  const decoded=(row.encoding==='br'?brotliDecompressSync:gunzipSync)(bytes);
  if(decoded.length!==source.bytes||sha(decoded)!==source.sha256)throw Error('Representation does not decode to source');
 }
}
