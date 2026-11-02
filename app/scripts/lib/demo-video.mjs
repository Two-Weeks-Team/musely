// D05 preparation only: no credentials, writes, provider calls, browser launch or publishing.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyControlledPair,controlledBinding,DEMO_TOOL_VERSION} from './controlled-p1.mjs';
import {controlledLabelFor} from './controlled-label.mjs';
import {verifyStoredMcp,storedMcpBinding,storedMcpLabelFor} from './stored-mcp.mjs';
export const run=promisify(execFile), sha=b=>createHash('sha256').update(b).digest('hex');
export const SHOTS=[
 ['s01',12,'A living place','World overview: people delegate; Muses meet and act.'],
 ['s02',14,'Identity before action','Open original Agent Card and delegation evidence.'],
 ['s03',20,'P0 valid delegation','Same job: valid signature and actual completed trade.'],
 ['s04',18,'P0 revocation','Same job after revocation: refusal and unchanged inventory.'],
 ['s05',20,'P1 reward changes a plan','Controlled before/after item comparison, identical other inputs.'],
 ['s06',18,'Abilities in the world','Actual discovery, item change and resulting travel or cooperation.'],
 ['s07',20,'Owners decide a promise','Public meetup flow: two approvals, one confirmation, private reasons stay private.'],
 ['s08',14,'Muses help each other','Actual gift, postcard or completed help highlight.'],
 ['s09',14,'Open the evidence','Selected event to run/commit/model request or signed verdict.'],
 ['s10',14,'Replay without re-execution','Recorded 1/10/60x; samples, notes and original sources visible.'],
 ['s11',10,'Failure stays honest','Originally observed fallback; label original source and playback.'],
 ['s12',6,'Musely','Build, Meta attribution, virtual location and material limits.']
];
export function createPlan(){return {schema:'musely-demo-plan-1',status:'preparation_only',origin:'https://musely.net',release:{frozen:false,sourceSha:null,deployId:null,configVersion:null,htmlSha256:null,modelIds:[],attestation:null},review:{p0SameJob:false,p1ControlledPair:false,labelsAndAttribution:false,noPrivateContent:false,releaseAndAccountReceipts:false},cuts:SHOTS.map(([id,duration,title,intent])=>({id,duration,title,intent,label:'REPLAY',virtual:true,refs:[],seekSec:null,snapshotHash:null,views:[],media:null})),limitations:['Pending real account claim/P0 success: never fill with fixture','Root final release freeze, D02/D03/D04 receipts and actual final capture required','No final video acceptance, publication or upload authorized by preparation']};}
const apiPaths=new Set(['/api/status','/api/world','/api/world/highlights','/api/world/event','/api/world/run','/api/world/run/inputs','/api/world/events','/api/world/autonomy']);
export function publicReadAllowed(url,origin,method='GET'){
 try{const u=new URL(url),o=new URL(origin);if(method!=='GET'||u.origin!==o.origin||u.username||u.password||u.hash||!['https:','http:'].includes(u.protocol))return false;
 if(u.protocol==='http:'&&!['127.0.0.1','localhost'].includes(u.hostname))return false;
 if(u.pathname!=='/'&&!apiPaths.has(u.pathname))return false;
 const allowed=new Set(['id','runId','snapshot','since','limit','tail','before','from','to','day']);return [...u.searchParams.keys()].every(k=>allowed.has(k));
 }catch{return false;}
}
// This classifies denials; neither exception is permission to transmit the request.
export function captureRequestPolicy(url,method,origin,phase){
 let u;try{u=new URL(url);}catch{return 'fatal-denied';}
 const same=u.origin===new URL(origin).origin&&!u.username&&!u.password,exact=!u.search&&!u.hash;
 if(same&&exact&&method==='POST'&&u.pathname==='/cdn-cgi/rum')return 'denied-telemetry';
 if(u.pathname==='/cdn-cgi/rum')return 'fatal-denied';
 if(phase==='bootstrap'&&same&&exact&&method==='GET'&&u.pathname==='/api/owner/location')return 'bootstrap-denied-read';
 const api=u.pathname.startsWith('/api/')||u.pathname==='/mcp';
 return method==='GET'&&!u.username&&!u.password&&(!api||same&&publicReadAllowed(url,origin))?'public-read':'fatal-denied';
}
function validDeniedRows(rows,kind,origin){return Array.isArray(rows)&&rows.every(r=>r&&r.action==='aborted'&&r.sameOrigin===true&&['bootstrap','recording'].includes(r.phase)&&captureRequestPolicy(new URL(r.path,origin).href,r.method,origin,r.phase)===kind);}
// A view is a required filming side. Its ID is stable across retakes; takeId identifies one recording.
export function cutViews(c){return c.views?.length?c.views:[{id:'main',runId:c.refs?.[0]?.runId,duration:c.duration,seekSec:c.seekSec,snapshotHash:c.snapshotHash}];}
const canonical=x=>JSON.stringify(x===undefined?null:Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const refKeys=refs=>refs.map(r=>canonical({eventId:r.eventId,runId:r.runId,inputSeq:r.inputSeq,originalSource:r.originalSource,requestId:r.requestId??null,signedVerdict:r.signedVerdict??null,role:r.role??'anchor'})).sort();
const sources=refs=>[...new Set(refs.map(r=>r.originalSource))].sort();
export function validatePlan(p){
 const e=[];if(p.schema!=='musely-demo-plan-1')e.push('bad_schema');
 if(!p.release?.frozen)e.push('release_not_frozen');
 for(const k of ['sourceSha','deployId','configVersion','htmlSha256','attestation'])if(!p.release?.[k])e.push('missing_release_'+k);
 if(!/^[a-f0-9]{40}$/.test(p.release?.sourceSha??''))e.push('bad_source_sha');
 if(!/^[a-f0-9]{64}$/.test(p.release?.htmlSha256??''))e.push('bad_html_sha');
 if(!p.release?.modelIds?.length)e.push('missing_model_ids');
 if(!Array.isArray(p.cuts)||p.cuts.length!==12||p.cuts.reduce((s,c)=>s+c.duration,0)!==180)e.push('duration_must_be_180');
 for(const [i,c] of (p.cuts??[]).entries()){
 if(c.id!==SHOTS[i]?.[0]||!Number.isFinite(c.duration)||c.duration<=0)e.push('bad_cut_order_or_duration');
 if(c.label!=='REPLAY')e.push(c.id+':replay_label_required');if(c.virtual!==true)e.push(c.id+':virtual_label_required');
 if(!Array.isArray(c.refs)||!c.refs.length)e.push(c.id+':missing_refs');
 const views=cutViews(c);
 if(new Set(views.map(v=>v.id)).size!==views.length||views.reduce((n,v)=>n+v.duration,0)!==c.duration)e.push(c.id+':bad_view_set');
 if(c.id==='s05'&&(new Set(views.map(v=>canonical([v.runId,v.seekSec,v.snapshotHash]))).size!==2||views.length!==2||!['before','after'].every((id,i)=>views[i]?.id===id&&views[i]?.duration===10)))e.push('s05:before_after_views_required');
 for(const v of views){
 if(!/^[A-Za-z0-9_-]+$/.test(v.id??'')||typeof v.runId!=='string'||!v.runId||!Number.isFinite(v.duration)||v.duration<=0)e.push(c.id+':bad_view_identity_or_duration');
 if(!Number.isFinite(v.seekSec)||v.seekSec<0||Math.abs(v.seekSec*10-Math.round(v.seekSec*10))>1e-8)e.push(c.id+':missing_recorded_seek');if(!/^[a-f0-9]{64}$/.test(v.snapshotHash??''))e.push(c.id+':missing_snapshot_hash');
 if(!c.refs?.some(r=>r.runId===v.runId))e.push(c.id+':view_missing_refs');
 }
 if(c.refs?.some(r=>!views.some(v=>v.runId===r.runId)))e.push(c.id+':unfilmed_reference_run');
 }
 for(const key of ['p0SameJob','p1ControlledPair','labelsAndAttribution','noPrivateContent','releaseAndAccountReceipts'])if(p.review?.[key]!==true)e.push('coordinator_review_required:'+key);
 return e;
}
export function signedVerdict(e){
 const d=e?.data??{};
 if(e?.kind==='a2a_verified'&&Array.isArray(d.steps)&&['signature','delegation','scope','replay'].every(s=>d.steps.includes(s))&&d.envelope?.message_id)return 'verified';
 if(['a2a_refused','command_refused'].includes(e?.kind)&&typeof d.reason==='string'&&d.envelope?.message_id)return 'refused:'+d.reason;
 return null;
}
function referenceJoin(r,b){
 const e=[],v=b?.event;if(!v||v.id!==r.eventId)e.push('event_mismatch');
 if(!b?.runIdStored||b.runId!==r.runId||b.run?.runId!==r.runId||v?.runId!==r.runId)e.push('run_mismatch');
 if(b?.run?.schemaVersion!=='run-log-2')e.push('run_log_2_required');
 if(b?.input?.seq!==r.inputSeq||b?.input?.runId!==r.runId||v?.inputSeq!==r.inputSeq)e.push('commit_mismatch');
 if(!['live','rule','scripted','replay'].includes(r.originalSource)||v?.source!==r.originalSource)e.push('source_mismatch');
 return e;
}
export function validateReference(r,b){
 const e=referenceJoin(r,b),v=b?.event;
 if(r.requestId){if(v?.data?.evidence?.requestId!==r.requestId)e.push('request_mismatch');}
 else if(r.role!=='support'&&(!r.signedVerdict||signedVerdict(v)!==r.signedVerdict))e.push('model_request_or_signed_verdict_required');
 if(r.requestId&&r.signedVerdict&&signedVerdict(v)!==r.signedVerdict)e.push('verdict_mismatch');
 return e;
}
export function inside(root,path){const p=resolve(root,path),rel=relative(resolve(root),p);if(!path||isAbsolute(path)||rel.startsWith('..')||!rel)throw Error('unsafe_relative_path');return p;}
export async function writeNew(path,data){await mkdir(dirname(path),{recursive:true});await writeFile(path,data,{flag:'wx'});}
export async function publicGet(url,origin,fetcher=fetch){
 if(!publicReadAllowed(url,origin))throw Error('public_get_only');
 const response=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10_000),headers:{accept:'application/json,text/html'}});
 if(!response.ok||response.redirected)throw Error('public_read_http_'+response.status);
 const chunks=[];let n=0;for await(const chunk of response.body){n+=chunk.length;if(n>8*1024*1024)throw Error('public_body_too_large');chunks.push(chunk);}
 const body=Buffer.concat(chunks);if(/msly_[A-Za-z0-9_-]{43}|\"(?:access_token|private_keys)\"\s*:/i.test(body.toString()))throw Error('unexpected_sensitive_public_body');return body;
}
export async function collect(p,dir,fetcher=fetch){
 await mkdir(dir,{recursive:true});const copy=structuredClone(p),receipts=[];let n=0;
 const get=async path=>{const url=new URL(path,p.origin).href,body=await publicGet(url,p.origin,fetcher),file=`raw/${String(++n).padStart(3,'0')}.json`,receipt={url,method:'GET',at:new Date().toISOString(),file,sha256:sha(body),bytes:body.length};await writeNew(inside(dir,file),body);receipts.push(receipt);return receipt;};
 for(const path of ['/','/api/status','/api/world/run','/api/world/highlights?limit=100'])await get(path);
 if(copy.cuts.reduce((n,c)=>n+c.refs.length,0)>48)throw Error('too_many_cut_refs');
 for(const c of copy.cuts)for(const r of c.refs){const x=await get('/api/world/event?id='+encodeURIComponent(r.eventId));Object.assign(r,{file:x.file,sha256:x.sha256});}
 // Observations never attest deployment/config/source or turn a release freeze on.
 copy.observations=receipts;await writeNew(resolve(dir,'collected-plan.json'),JSON.stringify(copy,null,2)+'\n');return copy;
}
export async function verifyBundle(p,dir){
 const errors=validatePlan(p);
 for(const c of p.cuts??[]){
  let controlled=false;if(c.controlledPair){try{await verifyControlledPair(p,c,dir);controlled=true;}catch(e){errors.push(c.id+':'+e.message);}}
  let stored=false;if(c.storedMcpVerifier){try{await verifyStoredMcp(p,c,dir);stored=true;}catch(e){errors.push(c.id+':'+e.message);}}
  if(!controlled&&!stored&&!(c.refs??[]).some(r=>r.requestId||r.signedVerdict))errors.push(c.id+':missing_evidence_anchor');
  for(const r of c.refs??[]){try{const raw=await readFile(inside(dir,r.file));if(sha(raw)!==r.sha256)throw Error('raw_hash_mismatch');for(const x of(controlled||stored&&r.role==='stored-original-mcp'?referenceJoin:validateReference)(r,JSON.parse(raw)))errors.push(c.id+':'+x);}catch(e){errors.push(c.id+':'+e.message);}}
 }
 return errors;
}
export async function checkHtml(p,fetcher=fetch){if(sha(await publicGet(new URL('/',p.origin).href,p.origin,fetcher))!==p.release.htmlSha256)throw Error('release_html_changed');}
export async function calibrate(ffmpeg,dir){
 const path=resolve(dir,'CALIBRATION-NOT-ACCEPTANCE.mp4');await mkdir(dir,{recursive:true});
 await run(ffmpeg,['-hide_banner','-loglevel','error','-n','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-vf',"drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='LOCAL CALIBRATION - NOT ACCEPTANCE':fontsize=22:fontcolor=white:box=1:boxcolor=black:x=20:y=20",'-t','2','-an','-c:v','libx264','-pix_fmt','yuv420p','-metadata','title=LOCAL CALIBRATION ONLY - NOT MUSELY FOOTAGE',path]);
 await run(ffmpeg,['-v','error','-i',path,'-f','null','-']);
 const receipt={kind:'local_synthetic_calibration_not_acceptance',path,sha256:sha(await readFile(path)),durationExpectedSeconds:2,decoded:true,audio:'none',finalAcceptance:'not_measured'};
 await writeNew(resolve(dir,'calibration.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
// Preflight the complete assembly before any encoder is called. A media row and its capture receipt
// must bind the same bytes, filming side, exact evidence and frozen release.
export async function verifyMedia(p,dir){
 const rows=[],takeIds=new Set();
 for(const c of p.cuts){
  const views=cutViews(c),segments=Array.isArray(c.media)?c.media:[c.media];
  if(segments.length!==views.length||new Set(segments.map(s=>s?.viewId)).size!==views.length||views.some((v,i)=>segments[i]?.viewId!==v.id))throw Error(c.id+':view_set_mismatch');
  for(const segment of segments){
   const view=views.find(v=>v.id===segment.viewId),refs=c.refs.filter(r=>r.runId===view.runId);
   if(!refs.length||segment.runId!==view.runId||segment.duration!==view.duration||!segment.takeId||takeIds.has(segment.takeId))throw Error(c.id+':view_identity_or_duration_mismatch');
   takeIds.add(segment.takeId);
   const clip=inside(dir,segment.file),raw=await readFile(clip);if(sha(raw)!==segment.sha256)throw Error(c.id+':media_hash_mismatch');
   const receipt=JSON.parse(await readFile(inside(dir,segment.receipt),'utf8'));
   if(receipt.media?.file!==segment.file||receipt.media?.sha256!==segment.sha256||receipt.media?.bytes!==raw.length)throw Error(c.id+':media_binding_mismatch');
   if(receipt.schema!=='musely-demo-capture-2'||receipt.kind!=='recorded_public_capture'||receipt.cutId!==c.id||receipt.viewId!==view.id||receipt.takeId!==segment.takeId||receipt.runId!==view.runId||receipt.durationSeconds!==view.duration||canonical(receipt.release)!==canonical(p.release)||!Number.isFinite(receipt.startOffsetSec)||receipt.startOffsetSec<0||receipt.blockedRequests!==0||receipt.label!=='REPLAY'||receipt.virtual!==true||canonical(receipt.originalSources)!==canonical(sources(refs))||receipt.observed?.runId!==view.runId||receipt.observed?.label!==true||receipt.observed?.hash!==view.snapshotHash||receipt.seekSec!==view.seekSec)throw Error(c.id+':capture_receipt_mismatch');
   if(p.tooling&&(receipt.tooling?.version!==DEMO_TOOL_VERSION||canonical(receipt.tooling)!==canonical(p.tooling)))throw Error(c.id+':tooling_capture_binding_mismatch');
   if(c.controlledPair){const label=controlledLabelFor(p,view),observed=receipt.controlledLabel;if(receipt.tooling?.version!==DEMO_TOOL_VERSION||canonical(receipt.tooling)!==canonical(p.tooling)||canonical(receipt.controlledPair)!==canonical(controlledBinding(c))||observed?.valid!==true||observed.visible!==true||observed.text!==label.text||observed.sourceSha!==label.sourceSha||observed.variant!==label.variant)throw Error(c.id+':controlled_capture_binding_mismatch');}
   if(c.storedMcpVerifier){const label=storedMcpLabelFor(p),observed=receipt.storedMcpLabel;if(receipt.tooling?.version!==DEMO_TOOL_VERSION||canonical(receipt.tooling)!==canonical(p.tooling)||canonical(receipt.storedMcpVerifier)!==canonical(storedMcpBinding(c))||observed?.valid!==true||observed.visible!==true||observed.text!==label.text||observed.sourceSha!==label.sourceSha||observed.variant!==label.variant)throw Error(c.id+':stored_mcp_capture_binding_mismatch');}
   const bootstrap=receipt.bootstrapDeniedReads??[],telemetry=receipt.deniedTelemetry??[];
   if(!validDeniedRows(bootstrap,'bootstrap-denied-read',p.origin)||!validDeniedRows(telemetry,'denied-telemetry',p.origin)||(bootstrap.length||telemetry.length)&&(receipt.denialsAreAccessReceipts!==false||receipt.continuedWriteRequests!==0)||(receipt.continuedWriteRequests??0)!==0)throw Error(c.id+':denied_request_audit_mismatch');
   if(!Array.isArray(receipt.refs)||!Array.isArray(segment.refs)||canonical(refKeys(receipt.refs))!==canonical(refKeys(refs))||canonical(refKeys(segment.refs))!==canonical(refKeys(refs)))throw Error(c.id+':captured_refs_mismatch');
   rows.push({cut:c,view,segment,receipt,clip});
  }
 }
 return rows;
}
export function captionFor(p,c,receipt){
 if(c.storedMcpVerifier)return `${c.title} | REPLAY | original: ${receipt.originalSources.join(', ')} | VIRTUAL WORLD\nSTORED ORIGINAL SERVER VERIFICATION | OPERATOR MCP\nNO MODEL CALL | NOT INDEPENDENT CRYPTO VERIFICATION | build ${p.release.sourceSha.slice(0,12)}`;
 return `REPLAY${c.id==='s05'?' | CONTROLLED COMPARISON (SIMULATION)':''} | original: ${receipt.originalSources.join(', ')} | VIRTUAL LOCATION (DEMO)\n${c.title} | ${c.controlledPair?'controlled input, no model call':'Meta Muse Spark'} | build ${p.release.sourceSha.slice(0,12)}`;
}
export async function render(p,dir,ffmpeg,font){
 const errors=await verifyBundle(p,dir);if(errors.length)throw Error(errors.join('\n'));
 const rows=await verifyMedia(p,dir),parts=[];await mkdir(resolve(dir,'render'),{recursive:true});
 for(const [index,{cut:c,segment,receipt,clip}] of rows.entries()){
 const target=resolve(dir,'render',c.id+'-'+index+'.mp4'),text=resolve(dir,'render',c.id+'-'+index+'.txt');
 await writeNew(text,captionFor(p,c,receipt));
 const esc=s=>s.replaceAll('\\','\\\\').replaceAll(':','\\:').replaceAll("'","'\\''");
 const vf=`scale=1920:960:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:0:color=black,drawtext=fontfile='${esc(resolve(font))}':textfile='${esc(text)}':fontcolor=white:fontsize=28:x=24:y=978:line_spacing=8`;
 await run(ffmpeg,['-hide_banner','-loglevel','error','-n','-ss',String(receipt.startOffsetSec),'-i',clip,'-t',String(segment.duration),'-an','-vf',vf,'-r','30','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',target]);parts.push(target);
 }
 const list=resolve(dir,'render','concat.txt');await writeNew(list,parts.map(p=>"file '"+p.replaceAll("'","'\\''")+"'").join('\n')+'\n');
 const video=resolve(dir,'musely-180s-review.mp4');await run(ffmpeg,['-hide_banner','-loglevel','error','-n','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',video]);
 const decoded=await run(ffmpeg,['-v','error','-i',video,'-progress','pipe:1','-f','null','-']);const times=[...decoded.stdout.matchAll(/out_time_us=(\d+)/g)].map(x=>Number(x[1])/1e6);const seconds=Math.max(...times);
 if(Math.abs(seconds-180)>.1)throw Error('decoded_duration_not_180:'+seconds);
 const receipt={kind:'rendered_needs_playback_review',durationSeconds:seconds,sha256:sha(await readFile(video)),release:p.release,tooling:p.tooling??{version:DEMO_TOOL_VERSION},finalAcceptance:'not_measured',audio:'none',takes:rows.map(({cut,view,segment})=>({cutId:cut.id,viewId:view.id,takeId:segment.takeId,runId:view.runId,duration:segment.duration,file:segment.file,sha256:segment.sha256,receipt:segment.receipt}))};await writeNew(resolve(dir,'render-receipt.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
