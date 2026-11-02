// Public GET only. Raw public responses remain auditable; no credentials, owner writes or provider calls.
import {createHash} from 'node:crypto';
import {recountEvidence,correlateP2,verifyRelease,hash} from './evidence.mjs';
export const READ_LIMITS={timeoutMs:10_000,maxBodyBytes:8*1024*1024,maxTotalBytes:64*1024*1024};
const paths=new Set(['/api/world/run','/api/world/events','/api/world/event','/api/world/autonomy']);
const byteHash=b=>createHash('sha256').update(b).digest('hex');
const publicOrigin=base=>{const u=new URL(base);if(u.username||u.password||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw Error('public_read_origin');return u;};
const cohort=(path,b)=>path==='/api/world/run'?{worldId:b.worldId,runId:b.runId,readThrough:b.readThrough}
 :path==='/api/world/events'?{runIds:[...new Set(b.map(e=>e.runId))],inputSeqs:[...new Set(b.map(e=>e.inputSeq))],eventIds:b.map(e=>e.id),eventSeqs:b.map(e=>e.seq)}
 :path==='/api/world/event'?{worldId:b.run?.worldId,runId:b.runId,eventId:b.event?.id,eventRunId:b.event?.runId,inputRunId:b.input?.runId,inputSeq:b.input?.seq}
 :{worldId:b.scope?.worldId,runIds:b.scope?.runIds,from:b.scope?.from,to:b.scope?.to,sample:b.sample};
export function publicReader(base,fetcher=fetch,options={}){
 const origin=publicOrigin(base),receipts=[],limits={};let totalBytes=0;
 for(const [k,max] of Object.entries(READ_LIMITS)){const n=options[k]??max;if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('invalid_read_limit:'+k);limits[k]=n;}
 const read=async path=>{
  const u=new URL(path,origin);if(u.origin!==origin.origin||u.username||u.password||u.hash||!paths.has(u.pathname))throw Error('public_read_path');
  const controller=new AbortController();let reader,timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(Error('public_get_timeout'));},limits.timeoutMs);});
  try{return await Promise.race([timeout,(async()=>{
   const r=await fetcher(u.href,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',signal:controller.signal});
   if(!r.ok||r.redirected)throw Error('public_get_failed:'+r.status+':'+u.pathname);
   if(r.url&&new URL(r.url).origin!==origin.origin)throw Error('public_response_origin');
   let bytes,rawSource='response-body-bytes';
   if(r.body?.getReader){
    reader=r.body.getReader();const chunks=[];let n=0;
    while(true){const part=await reader.read();if(part.done)break;n+=part.value.byteLength;
     if(n>limits.maxBodyBytes)throw Error('public_body_limit');if(totalBytes+n>limits.maxTotalBytes)throw Error('public_total_limit');chunks.push(Buffer.from(part.value));}
    bytes=Buffer.concat(chunks);
   }else if(fetcher!==fetch&&typeof r.json==='function'){
    // Injected historical test doubles have no wire bytes. Never label their serialization as a raw HTTP response.
    rawSource='injected-json-fixture';bytes=Buffer.from(JSON.stringify(await r.json()));
   }else throw Error('public_response_body_missing');
   if(bytes.length>limits.maxBodyBytes)throw Error('public_body_limit');if(totalBytes+bytes.length>limits.maxTotalBytes)throw Error('public_total_limit');
   if(controller.signal.aborted)throw Error('public_get_timeout');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),body=JSON.parse(text);totalBytes+=bytes.length;
   receipts.push({method:'GET',URL:u.href,requestOrigin:u.origin,status:r.status,fetchedAt:new Date().toISOString(),rawSource,rawBytes:bytes.length,rawSha256:byteHash(bytes),rawBodyBase64:bytes.toString('base64'),bodyHash:hash(body),cohort:cohort(u.pathname,body)});return body;
  })()]);}catch(e){controller.abort();void reader?.cancel().catch(()=>{});throw e;}finally{clearTimeout(timer);}
 };
 return {read,receipts,limits};
}
const ORACLE_FIELDS=['sample','sources','origins','starts','interventions','signatures','models','abilities','blocks'];
export async function collectPublicProof({base,meta,runId,from,to,scenes=[],limits},fetcher=fetch){
 verifyRelease(meta);if(meta.classification==='simulation')throw Error('deployed collection needs identified release');
 const source=publicOrigin(base),declared=publicOrigin(meta.URL);if(source.origin!==declared.origin)throw Error('C10 collection_origin_mismatch');
 if(!runId||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>=to)throw Error('explicit run/time required');
 const {read,receipts,limits:readLimits}=publicReader(base,fetcher,limits),query=new URLSearchParams({runId,snapshot:'1'}),head=await read('/api/world/run?'+query);
 if(head.runId!==runId||!head.worldId||!head.readThrough||!Number.isSafeInteger(head.readThrough.eventSeq)||head.readThrough.eventSeq<0||!Number.isSafeInteger(head.readThrough.events)||head.readThrough.events<0)throw Error('invalid run header');
 const raw=[];let since=0,complete=true,partialReason=null;
 for(let page=0;since<head.readThrough.eventSeq;page++){
  if(page>=100){complete=false;partialReason='collector page bound';break;}
  const rows=await read('/api/world/events?'+new URLSearchParams({runId,since:String(since),limit:'2000'}));
  if(!Array.isArray(rows)||!rows.length){complete=false;partialReason='event prefix incomplete';break;}
  let previous=since;for(const e of rows){if(!Number.isSafeInteger(e.seq)||e.seq<=previous)throw Error('event paging did not advance');previous=e.seq;if(e.runId!==runId)throw Error('foreign run in event page');}
  raw.push(...rows.filter(e=>e.seq<=head.readThrough.eventSeq));since=previous;
 }
 if(raw.length!==head.readThrough.events){complete=false;partialReason='frozen event count mismatch';}
 const events=raw.filter(e=>e.at>=from&&e.at<to),scope={worldId:head.worldId,runIds:[runId],from,to,day:null,complete,partialReason};
 const recount=recountEvidence(events,scope),server=await read('/api/world/autonomy?'+new URLSearchParams({runId,from:String(from),to:String(to)}));
 const serverMatch=ORACLE_FIELDS.every(k=>server[k]!==undefined&&hash(server[k])===hash(recount.oracle[k]))
  &&Array.isArray(server.scope?.runIds)&&(events.length===0?server.scope.runIds.length===0:server.scope.runIds.length===1&&server.scope.runIds[0]===runId)
  &&server.scope?.worldId===head.worldId&&server.scope?.from===from&&server.scope?.to===to&&server.scope?.day===scope.day
  &&Object.entries(recount.values).every(([k,v])=>server.values?.[k]?.value===v.value&&server.values[k].measured===v.measured);
 const correlations=[];for(const scene of scenes){
  if(scene.runId!==runId)throw Error('scene from foreign run');const record=await read('/api/world/event?'+new URLSearchParams({id:scene.eventId}));
  const original=events.find(e=>e.id===scene.eventId);if(!original||hash(original)!==hash(record.event))throw Error('scene outside frozen event cohort');
  const receipt=receipts.at(-1);correlations.push({...correlateP2(scene,record),rawReceipt:{index:receipts.length-1,rawSha256:receipt.rawSha256,requestOrigin:receipt.requestOrigin}});
 }
 return {meta,collection:'existing-public-records-only',sourceOrigin:source.origin,head,events,recount,server,serverMatch,correlations,receipts,readLimits,status:complete&&server.scope?.complete===true&&(server.partial===undefined||server.partial===false)&&!server.scope?.partialReason&&serverMatch?'raw-recount-matched':'partial-or-mismatch',limitations:['Public GET collection does not execute a live model or owner action','Origin is checked; deploy/source/config metadata still requires the operator release receipt','P0 owner-claim acceptance remains pending unless separately observed','No physical-device or four-hour acceptance follows from these records']};
}
