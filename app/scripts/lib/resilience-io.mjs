import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const exec=promisify(execFile);
const ERROR_NAMES=new Set(['Error','TypeError','RangeError','SyntaxError','AbortError','TimeoutError']);
const CAUSE_CODES=new Set(['UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','ABORT_ERR','ERR_STREAM_PREMATURE_CLOSE']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
/** GET only, no cookies/credentials, no redirects; bound both headers and streamed body by one deadline. */
export async function observeGet(url, {fetcher=fetch, timeoutMs=12000, maxBytes=2*1024*1024}={}) {
  const startedAt=Date.now(), ctl=new AbortController();let timer,reader,stage='fetch',reason='observation_failed';
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reason='request_timeout';ctl.abort();reject(Error('request_timeout'));},timeoutMs);});
  try {
    const res=await Promise.race([fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',headers:{Connection:'close'},signal:ctl.signal}),deadline]);
    stage='body';reader=res.body?.getReader();const chunks=[];let bytes=0;
    if(reader)while(true){const r=await Promise.race([reader.read(),deadline]);if(r.done)break;bytes+=r.value.byteLength;if(bytes>maxBytes){reason='response_too_large';throw Error('response_too_large');}chunks.push(Buffer.from(r.value));}
    const body=Buffer.concat(chunks).toString('utf8');
    const headers=Object.fromEntries(['date','content-type','cf-ray','cf-cache-status','x-request-id','etag'].map(k=>[k,res.headers.get(k)]).filter(([,v])=>v!==null));
    return {url,method:'GET',startedAt,endedAt:Date.now(),status:res.status,headers,body,sha256:sha256(body)};
  } catch(error) {
    // Never retain the original message, stack, headers, URL or arbitrary cause object.
    const failure=new Error(reason);
    let errorName=null,causeCode=null;
    try {errorName=error?.name;} catch {}
    try {causeCode=error?.cause?.code;} catch {}
    failure.failure={errorName:ERROR_NAMES.has(errorName)?errorName:null,causeCode:CAUSE_CODES.has(causeCode)?causeCode:null,stage};
    throw failure;
  } finally {clearTimeout(timer);ctl.abort();if(reader)void reader.cancel().catch(()=>{});}
}
export function currentDeployment(rows) {
  if(!Array.isArray(rows)||!rows.length)throw Error('deployment_observation_missing');
  const row=[...rows].sort((a,b)=>String(a.created_on).localeCompare(String(b.created_on))).at(-1);
  if(!row?.id || !Array.isArray(row.versions) || row.versions.length!==1 || row.versions[0].percentage!==100 || !row.versions[0].version_id)throw Error('mixed_or_unknown_deployment');
  return {deployId:row.id,versionIds:row.versions.map(v=>v.version_id),createdAt:row.created_on};
}

/** Read the pinned HEAD and repository-root app/ dirty state from any Git cwd; never emit raw Git filenames. */
export async function gitSourceState(sourcePath) {
  const options={cwd:sourcePath,timeout:10000,maxBuffer:1024*1024};
  const [head,dirty]=await Promise.all([
    exec('git',['rev-parse','HEAD'],options),
    exec('git',['status','--porcelain','--untracked-files=all','--',':(top)app/'],options),
  ]);
  return {sourceSha:head.stdout.trim(),sourceClean:!dirty.stdout.trim()};
}
