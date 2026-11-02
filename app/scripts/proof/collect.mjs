// Public GET collection only. No credentials, owner mutation, provider request or command transport exists here.
import {recountEvidence,correlateP2,verifyRelease,hash} from './evidence.mjs';
export function publicReader(base,fetcher=fetch){
 const origin=new URL(base);if(origin.username||origin.password||!(origin.protocol==='https:'||(origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname))))throw Error('public_read_origin');
 const receipts=[];
 const read=async path=>{const u=new URL(path,origin);if(u.origin!==origin.origin||!['/api/world/run','/api/world/events','/api/world/event','/api/world/autonomy'].includes(u.pathname))throw Error('public_read_path');
  const r=await fetcher(u.href,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit'});if(!r.ok)throw Error('public_get_failed:'+r.status+':'+u.pathname);const body=await r.json();receipts.push({method:'GET',URL:u.href,status:r.status,fetchedAt:new Date().toISOString(),bodyHash:hash(body)});return body;};
 return {read,receipts};
}
export async function collectPublicProof({base,meta,runId,from,to,scenes=[]},fetcher=fetch){
 verifyRelease(meta);if(meta.classification==='simulation')throw Error('deployed collection needs identified release');
 if(!runId||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>=to)throw Error('explicit run/time required');
 const {read,receipts}=publicReader(base,fetcher),query=new URLSearchParams({runId,snapshot:'1'}),head=await read('/api/world/run?'+query);
 if(head.runId!==runId||!head.worldId||!head.readThrough)throw Error('invalid run header');
 const raw=[];let since=0,complete=true,partialReason=null;
 for(let page=0;since<head.readThrough.eventSeq;page++){
  if(page>=100){complete=false;partialReason='collector page bound';break;}
  const rows=await read('/api/world/events?'+new URLSearchParams({runId,since:String(since),limit:'2000'}));
  if(!Array.isArray(rows)||!rows.length){complete=false;partialReason='event prefix incomplete';break;}
  const next=rows.at(-1).seq;if(!Number.isSafeInteger(next)||next<=since)throw Error('event paging did not advance');
  if(rows.some(e=>e.runId!==runId))throw Error('foreign run in event page');
  raw.push(...rows.filter(e=>e.seq<=head.readThrough.eventSeq));since=next;
 }
 if(raw.length!==head.readThrough.events){complete=false;partialReason='frozen event count mismatch';}
 const events=raw.filter(e=>e.at>=from&&e.at<to),scope={worldId:head.worldId,runIds:[runId],from,to,day:null,complete,partialReason};
 const recount=recountEvidence(events,scope),server=await read('/api/world/autonomy?'+new URLSearchParams({runId,from:String(from),to:String(to)}));
 const serverMatch=server.sample?.events===recount.oracle.sample.events&&Array.isArray(server.scope?.runIds)&&(events.length===0?server.scope.runIds.length===0:server.scope.runIds.length===1&&server.scope.runIds[0]===runId)&&server.scope?.worldId===head.worldId&&server.scope?.from===from&&server.scope?.to===to&&Object.entries(recount.values).every(([k,v])=>server.values?.[k]?.value===v.value&&server.values[k].measured===v.measured);
 const correlations=[];for(const scene of scenes){if(scene.runId!==runId)throw Error('scene from foreign run');const record=await read('/api/world/event?'+new URLSearchParams({id:scene.eventId}));correlations.push(correlateP2(scene,record));}
 return {meta,collection:'existing-public-records-only',head,events,recount,server,serverMatch,correlations,receipts,status:complete&&server.scope?.complete&&serverMatch?'raw-recount-matched':'partial-or-mismatch',limitations:['Public GET collection does not execute a live model or owner action','Release/deploy metadata is supplied by the operator; these APIs do not themselves prove deployId','P0 owner-claim acceptance remains pending unless separately observed','No physical-device or four-hour acceptance follows from these records']};
}
