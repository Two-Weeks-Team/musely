// s07-only offline binding of an actual stored original server result. No auth, transport or crypto-proof claim.
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {payloadHash,commandContent} from '../../worker/core/commands.ts';
import {contentHash} from '../../src/identity/envelope.ts';
import {recordedStateHash,assertCompatible} from '../../src/replay/player.ts';
import {replayDisclosure} from './controlled-label.mjs';
import {DEMO_TOOL_VERSION} from './controlled-p1.mjs';
export const STORED_MCP_LABEL='STORED ORIGINAL SERVER VERIFICATION';
export const OPERATOR_MCP='OPERATOR MCP';
const classification='production HTTPS, operator-controlled distinct principals; not a real Muse client or second human/Meta account';
const need=(ok,why)=>{if(!ok)throw Error('stored_mcp:'+why);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function pinned(dir,d){
 need(d&&typeof d.file==='string'&&/^[a-f0-9]{64}$/.test(d.sha256??''),'artifact_pin_required');const file=resolve(dir,d.file),r=relative(resolve(dir),file);need(r&&!isAbsolute(d.file)&&!r.startsWith('..'),'relative_artifact_required');
 const raw=await readFile(file);need(raw.length<=8*1024*1024&&createHash('sha256').update(raw).digest('hex')===d.sha256,'artifact_hash_mismatch');return JSON.parse(raw);
}
export const storedMcpBinding=c=>c.storedMcpVerifier?structuredClone(c.storedMcpVerifier):null;
export const storedMcpLabelFor=p=>({text:replayDisclosure(p)+' | '+STORED_MCP_LABEL+' | OPERATOR MCP | NO MODEL CALL | NOT INDEPENDENT CRYPTO VERIFICATION | original: live | VIRTUAL WORLD | build '+p.release.sourceSha.slice(0,12),sourceSha:p.release.sourceSha,variant:'s07'});
export async function verifyStoredMcp(p,c,dir){
 const d=c.storedMcpVerifier;need(c.id==='s07'&&!c.controlledPair,'s07_only');need(d?.label===STORED_MCP_LABEL&&d.provenance===OPERATOR_MCP,'provenance_required');
 need(p.tooling?.version===DEMO_TOOL_VERSION&&/^[a-f0-9]{40}$/.test(p.tooling.sourceSha??''),'separate_tooling_pin_required');
 const r=await pinned(dir,d.receipt),o=r.response,command=o?.command,envelope=o?.envelope;
 need(r.classification===classification&&r.fullResponseStored===false&&r.credentialStoredInPublicArtifact===false,'operator_public_projection_required');
 need(r.sourceSHA===p.release.sourceSha&&r.deployId===p.release.deployId&&r.workerVersion===p.release.workerVersion&&typeof r.workerVersion==='string'&&r.workerVersion.length>0,'frozen_release_mismatch');
 need(r.request?.method==='POST'&&r.request.origin==='https://musely.net'&&r.request.path==='/mcp'&&r.request.protocolVersion==='2026-07-28','actual_mcp_request_required');
 need(o?.httpStatus===200&&o.rpcError===null&&o.isError===false&&o.refused===null&&o.ok===true&&command?.duplicate===true&&envelope?.verified===true,'stored_success_verdict_required');
 need(r.tool==='answer_candidate'&&r.answer==='accept'&&r.originalPrincipal==='owner'&&typeof r.publicActorId==='string'&&r.publicActorId.length>0,'original_operator_answer_required');
 need(r.request.expected_version==='omitted'&&command.expected_version===null&&command.command_id===r.request.command_id,'exact_duplicate_command_required');
 need(Number.isFinite(r.performedAt)&&Number.isFinite(r.finishedAt)&&r.finishedAt>=r.performedAt,'receipt_time_required');
 need(Array.isArray(c.refs)&&c.refs.length===4&&c.refs.every(x=>x.requestId==null&&x.signedVerdict==null)&&c.refs.filter(x=>x.role==='stored-original-mcp').length===1&&c.refs.filter(x=>x.role==='support').length===3,'dedicated_same_task_refs_required');
 const records=[];
 for(const ref of c.refs){
  const b=await pinned(dir,ref),e=b.event,i=b.input;need(b.runIdStored===true&&e?.id===ref.eventId&&b.runId===ref.runId&&b.run?.runId===ref.runId&&e.runId===ref.runId&&i?.runId===ref.runId&&i.seq===ref.inputSeq&&e.inputSeq===ref.inputSeq&&e.source===ref.originalSource&&e.source==='live','public_reference_join_mismatch');
  assertCompatible(b.run);need(e.data?.task_id===r.task_id&&e.data.revision===o.task?.revision,'same_task_revision_required');
  const s=i.afterSnapshot;need(typeof s?.body==='string'&&recordedStateHash(s.body)===s.hash&&s.hash===i.afterHash,'public_checkpoint_hash_mismatch');const state=JSON.parse(s.body);need(state.worldId===b.run.worldId&&state.version===i.versionAfter,'checkpoint_world_version_mismatch');
  need(!e.data?.evidence?.requestId,'no_model_anchor');records.push({ref,b,e,i});
 }
 const a=records.find(x=>x.ref.role==='stored-original-mcp'),{e,i,b}=a,env=e.data.envelope,input=i.input;
 need(e.id===d.anchorEventId&&e.kind==='meetup_answer'&&e.muse==='00-jolly'&&e.other==='09-copper'&&e.data.actorOrigin==='connected'&&e.data.tool===r.tool&&e.data.answer==='accept','original_answer_event_required');
 need(i.kind==='command'&&input?.action===r.tool&&input.ok===true&&input.code===null&&input.worldVersion===i.versionAfter&&command.world_version===i.versionAfter,'successful_original_command_required');
 need(env?.agent_id===input.actorId&&input.actorId===r.publicActorId&&env.message_id===input.commandId&&input.commandId===command.command_id&&env.signer_kind==='server_custodial'&&env.scope==='answer_yes_no'&&env.owner_claimed===true,'original_actor_command_scope_mismatch');
 need(equal(Object.keys(input.fields??{}).sort(),['answer','kind','task_id'])&&input.fields.kind==='answer_candidate'&&input.fields.answer===r.answer&&input.fields.task_id===r.task_id&&equal(input.omitted,[]),'complete_original_payload_required');
 need(await payloadHash({worldId:b.run.worldId,action:input.action,payload:input.fields})===input.payloadHash,'payload_hash_mismatch');
 need(await contentHash(commandContent({worldId:b.run.worldId,expectedVersion:null,action:input.action,payload:input.fields}))===env.content_hash,'content_hash_mismatch');
 for(const k of['message_id','signer_kind','delegation_ref','content_hash'])need(typeof env[k]==='string'&&env[k].length>0&&envelope[k]===env[k]&&r.originalAnchor?.envelope?.[k]===env[k],'original_envelope_mismatch');
 need(r.originalAnchor?.eventSeq===e.seq&&r.originalAnchor.inputSeq===i.seq&&r.originalAnchor.runId===b.runId,'original_anchor_mismatch');
 need(o.task?.id===r.task_id&&o.task.kind==='meetup'&&o.task.status==='pending'&&o.task.stage==='owner_approval','original_cached_task_required');
 const support=records.filter(x=>x!==a),owners=support.filter(x=>x.e.kind==='owner_decision'),confirmed=support.find(x=>x.e.kind==='meetup_confirmed');
 need(owners.length===2&&confirmed&&confirmed.e.id===d.confirmedEventId,'bilateral_confirmation_required');
 need(new Set(records.map(x=>x.b.runId)).size===1&&new Set(records.map(x=>x.b.run.worldId)).size===1&&new Set(c.refs.map(x=>x.eventId)).size===4,'same_run_distinct_events_required');
 const refs=[];for(const x of owners){const f=x.i.input?.fields;need(x.ref.role==='support'&&x.i.kind==='external'&&x.i.input.action==='owner_approval'&&x.e.data.decision==='approve'&&f?.taskId===r.task_id&&f.revision===o.task.revision&&f.decision==='approve'&&f.museId===x.e.muse&&f.approvalRef===x.e.data.approval_ref&&typeof f.approvalRef==='string'&&x.e.seq>e.seq&&x.i.seq>i.seq&&!x.e.data.envelope,'original_owner_support_required');refs.push(f.approvalRef);}
 need(new Set(owners.map(x=>x.i.seq)).size===2&&new Set(owners.map(x=>x.e.muse)).size===2&&owners.some(x=>x.e.muse==='00-jolly')&&owners.some(x=>x.e.muse==='09-copper')&&new Set(refs).size===2,'two_distinct_owner_approvals_required');
 const f=confirmed.i.input?.fields,cd=confirmed.e.data;
 need(confirmed.ref.role==='support'&&confirmed.i.kind==='external'&&confirmed.i.input.action==='owner_approval'&&f?.taskId===r.task_id&&f.revision===o.task.revision&&f.decision==='approve'&&refs.includes(f.approvalRef)&&cd.stage==='confirm'&&cd.granted==='meetup_ember'&&!cd.envelope&&equal([...(cd.approval_refs??[])].sort(),[...refs].sort())&&cd.approvals?.['00-jolly']==='owner'&&cd.approvals?.['09-copper']==='owner'&&owners.every(x=>x.e.seq<confirmed.e.seq&&x.i.seq<=confirmed.i.seq),'confirmed_owner_support_mismatch');
 need(owners.some(x=>x.i.seq===confirmed.i.seq&&x.i.at===confirmed.i.at&&x.i.afterHash===confirmed.i.afterHash&&x.i.input.fields.museId===f.museId&&x.i.input.fields.approvalRef===f.approvalRef),'shared_final_owner_input_required');
 const views=c.views?.length?c.views:[{runId:c.refs[0]?.runId,seekSec:c.seekSec,snapshotHash:c.snapshotHash}];need(views.length===1&&views[0].runId===b.runId&&views[0].snapshotHash===confirmed.i.afterHash&&b.run.startedAt+views[0].seekSec*1000>=confirmed.e.data.publishedAt&&r.performedAt*1000>=confirmed.e.data.publishedAt,'confirmed_filmed_checkpoint_required');
 return{classification:'stored original server verification; operator MCP; not independent cryptographic verification',anchorEventId:e.id,confirmedEventId:confirmed.e.id,commandId:input.commandId};
}
