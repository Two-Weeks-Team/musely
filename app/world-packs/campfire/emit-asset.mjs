import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import asset from './asset.json' with {type:'json'};
/** Uses existing hash-pinned build emitter; never deploys or fetches. */
export async function emitCampfireAsset(dist,writeHashed){
 const bytes=await readFile(new URL('./campfire-prototype.glb',import.meta.url));
 const sha=createHash('sha256').update(bytes).digest('hex');
 if(sha!==asset.sha256 || bytes.length!==asset.bytes)throw Error('Campfire source integrity mismatch');
 const path=await writeHashed(dist,'campfire','glb',bytes);
 if('/'+path!==asset.url)throw Error('Campfire asset URL mismatch');
 return path;
}
