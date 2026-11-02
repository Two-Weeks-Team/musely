// No default execution, network, listening socket, browser, device or mutable backend.
// Root may bind respond(Request) to its own exact loopback port after review.
import {createHash} from 'node:crypto';
import {externalCodePaths,validateFreeze} from '../device-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const CONFIG_PATH='/.well-known/d04-local-pair.json',DATASET_PATH='/.well-known/d04-public-get-dataset.json';
const paths=['/api/status','/api/world','/api/world/events','/api/owner/location'];
const need=(ok,why)=>{if(!ok)throw Error('local pair '+why);};
function datasetRoutes(dataset){
 need(dataset?.schema==='musely-public-get-dataset-1'&&dataset.classification==='recorded public GET fixture; no live backend or model','invalid dataset classification');
 need(Array.isArray(dataset.routes)&&dataset.routes.length===paths.length&&new Set(dataset.routes.map(r=>r.path)).size===paths.length&&dataset.routes.every(r=>paths.includes(r.path)),'invalid public route manifest');
 for(const r of dataset.routes){need(r.path==='/api/owner/location'?[401,403].includes(r.status):r.status===200,'invalid route status');need(r.body&&typeof r.body==='object','invalid route body');}
 const status=dataset.routes.find(r=>r.path==='/api/status').body;
 need(status.session===null&&status.owner==null,'dataset must not grant an owner or session');
 const events=dataset.routes.find(r=>r.path==='/api/world/events').body;need(Array.isArray(events),'events must be an array');let seq=0;for(const e of events){need(Number.isSafeInteger(e.seq)&&e.seq>seq,'events must retain positive commit order');seq=e.seq;}
 const raw=JSON.stringify(dataset);need(Buffer.byteLength(raw)<=8*1024*1024&&!/msly_[A-Za-z0-9_-]{43}|"(?:access_token|private_keys|authorization|cookie)"\s*:/i.test(raw),'private or oversized dataset');
 return dataset.routes;
}
export function pairSharedIdentity(pin){return {origin:pin.origin,datasetSHA256:pin.localPair?.datasetSHA256,files:(pin.files??[]).filter(f=>f.path.startsWith('character-kit/runtime/')).sort((a,b)=>a.path.localeCompare(b.path))};}
export function localDocumentBound(report){
 const p=report.pin,rows=report.browserSource?.rows??[],expected=[{url:p.origin+'/?autoplay=0&perf=1&dpr=1.5',sha256:p.htmlSHA256,bytes:p.files.find(f=>f.path==='index.html')?.bytes},...(p.externalCodeFiles??[])];
 return expected.every(f=>{const m=rows.filter(r=>r.url===f.url);return m.length===1&&m[0].status===200&&m[0].sha256===f.sha256&&m[0].bytes===f.bytes&&!m[0].error;})&&rows.filter(r=>r.type==='Document').length===1;
}
export function validateLocalBaseline(b,pin,deviceSerialSHA256){
 const errors=[];if(b?.pin?.environment!=='local-read-only-pair'||b.pin.role!=='baseline-capture'||b.baselineCaptured!==true||b.complete!==true||b.memory?.complete!==true)errors.push('complete_local_baseline_required');
 if(validateFreeze(b?.pin??{},{kind:'mobile-210',endpoint:'http://127.0.0.1:1',targetId:b?.pin?.targetId}).length)errors.push('baseline_freeze_invalid');
 if(!same(pairSharedIdentity(b?.pin??{}),pairSharedIdentity(pin)))errors.push('local_pair_dataset_or_assets_mismatch');
 if(!/^[a-f0-9]{64}$/.test(deviceSerialSHA256??'')||b?.deviceSerialSHA256!==deviceSerialSHA256)errors.push('same_physical_device_required');
 for(const side of['sourceBefore','sourceAfter'])if(b?.[side]?.localPair?.serverConfigSHA256!==b?.pin?.localPair?.serverConfigSHA256||b?.[side]?.localPair?.datasetSHA256!==pin.localPair.datasetSHA256)errors.push('local_baseline_source_receipts_required');
 if(!b?.pin?.files||!localDocumentBound(b))errors.push('local_baseline_document_required');
 return errors;
}
export async function prepareLocalPair({origin,clientSHA,targetId,role,files,dataset,externalCodeFiles=[]}){
 const resources=new Map();for(const f of files){need(!resources.has('/'+f.path),'duplicate resource');resources.set('/'+f.path,Buffer.from(f.body));}
 const entries=files.map(f=>({path:f.path,sha256:sha(resources.get('/'+f.path)),bytes:resources.get('/'+f.path).length})).sort((a,b)=>a.path.localeCompare(b.path));
 const routes=datasetRoutes(dataset),datasetBody=Buffer.from(JSON.stringify(dataset));
 const config={schema:'musely-local-pair-server-1',environment:'local-read-only-pair',origin,clientSHA,datasetSHA256:sha(datasetBody),files:entries,externalCodeFiles};
 const configBody=Buffer.from(JSON.stringify(config)),pin={environment:'local-read-only-pair',role,status:'frozen',releaseSHA:clientSHA,origin,targetId,referenceDevice:'SM-S918N',dpr:1.5,durationMs:210000,htmlSHA256:entries.find(f=>f.path==='index.html')?.sha256,files:entries,externalCodeFiles,localPair:{port:Number(new URL(origin).port),serverConfigSHA256:sha(configBody),datasetSHA256:sha(datasetBody)}};
 need(!validateFreeze(pin,{kind:'mobile-210',endpoint:'http://127.0.0.1:1',targetId}).length,'invalid pin');
 for(const path of externalCodePaths(resources.get('/index.html').toString(),origin,externalCodeFiles))need(resources.has('/'+path),'code missing from served manifest');
 resources.set('/',resources.get('/index.html'));resources.set(CONFIG_PATH,configBody);resources.set(DATASET_PATH,datasetBody);
 const fixed=routes.map(r=>({...r,body:Buffer.from(JSON.stringify(r.body))}));
 const respond=async request=>{
  const u=new URL(request.url);if(u.origin!==origin||u.username||u.password||u.hash)return new Response('wrong origin',{status:403});
  if(!['GET','HEAD'].includes(request.method))return new Response('read only',{status:405});
  let body=resources.get(u.pathname),status=200,type=u.pathname==='/'||u.pathname.endsWith('.html')?'text/html; charset=utf-8':u.pathname.endsWith('.css')?'text/css':/\.m?js$/.test(u.pathname)?'text/javascript':u.pathname.endsWith('.json')?'application/json':'application/octet-stream';
  if(body){const allowed=u.pathname==='/'&&[...u.searchParams].every(([k,v])=>({autoplay:'0',perf:'1',dpr:'1.5'})[k]===v);if(u.search&&!allowed)return new Response('query refused',{status:400});}
  else{const route=fixed.find(r=>r.path===u.pathname);if(!route)return new Response('not found',{status:404});body=route.body;status=route.status;type='application/json';
   if(u.pathname==='/api/world/events'){
    if([...u.searchParams.keys()].some(k=>!['since','limit','tail','runId','day'].includes(k)))return new Response('query refused',{status:400});
    const n=k=>u.searchParams.has(k)?Number(u.searchParams.get(k)):null,since=n('since'),limit=n('limit'),tail=n('tail');if([since,limit,tail].some(v=>v!==null&&(!Number.isSafeInteger(v)||v<0)))return new Response('query refused',{status:400});
    let rows=JSON.parse(body).filter(e=>e.seq>(since??0)&&(!u.searchParams.has('runId')||e.runId===u.searchParams.get('runId'))&&(!u.searchParams.has('day')||e.day===u.searchParams.get('day')));if(tail)rows=rows.slice(-Math.min(tail,2000));body=Buffer.from(JSON.stringify(rows.slice(0,Math.min(limit??200,2000))));
   }else if(u.search)return new Response('query refused',{status:400});
  }
  return new Response(request.method==='HEAD'?null:Buffer.from(body),{status,headers:{'content-type':type,'content-length':String(body.length),'cache-control':'no-store'}});
 };
 return{pin:structuredClone(pin),configBody:Buffer.from(configBody),datasetBody:Buffer.from(datasetBody),respond};
}
export async function auditLocalPair(pin,probe){
 const get=async path=>{const r=await probe(pin.origin+path,{redirect:'error',credentials:'omit'});need(r.ok&&!r.redirected,'identity GET failed');const raw=Buffer.from(await r.arrayBuffer());need(raw.length<=8*1024*1024,'oversized identity');return raw;};
 const configBody=await get(CONFIG_PATH),datasetBody=await get(DATASET_PATH);need(sha(configBody)===pin.localPair.serverConfigSHA256&&sha(datasetBody)===pin.localPair.datasetSHA256,'server or dataset hash mismatch');
 const config=JSON.parse(configBody),dataset=JSON.parse(datasetBody);need(config.schema==='musely-local-pair-server-1'&&config.environment===pin.environment&&config.origin===pin.origin&&config.clientSHA===pin.releaseSHA&&config.datasetSHA256===pin.localPair.datasetSHA256&&same(config.files,pin.files)&&same(config.externalCodeFiles,pin.externalCodeFiles??[]),'server config mismatch');
 const receipts=[];for(const route of datasetRoutes(dataset)){const r=await probe(pin.origin+route.path,{redirect:'error',credentials:'omit'}),raw=Buffer.from(await r.arrayBuffer()),body=route.path==='/api/world/events'?route.body.slice(0,200):route.body;need(r.status===route.status&&sha(raw)===sha(Buffer.from(JSON.stringify(body))),'public route body mismatch');receipts.push({path:route.path,status:r.status,sha256:sha(raw),bytes:raw.length});}
 return{serverConfigSHA256:sha(configBody),datasetSHA256:sha(datasetBody),classification:'local recorded public GET dataset; not production backend',routes:receipts};
}
