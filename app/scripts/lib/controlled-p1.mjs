// s05-only controlled evidence. No transport, command, model, credential or browser execution.
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyP1,hash} from '../proof/evidence.mjs';
import {createWorld,tick} from '../../src/engine/world.ts';
import {makeHooks} from '../../src/engine/rules.ts';
import {publicState} from '../../worker/core/run-log.ts';
import {loadRun} from '../../src/replay/player.ts';
export const DEMO_TOOL_VERSION='musely-demo-tools-2';
export const CONTROLLED_LABEL='CONTROLLED COMPARISON (SIMULATION)';
const requirePair=(ok,why)=>{if(!ok)throw Error('controlled_pair:'+why);};
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const sha=b=>createHash('sha256').update(b).digest('hex');
async function pinned(dir,d){requirePair(d&&typeof d.file==='string'&&hex(d.sha256),'file_pin_required');const file=resolve(dir,d.file),r=relative(resolve(dir),file);requirePair(r&&!isAbsolute(d.file)&&!r.startsWith('..'),'relative_artifact_required');const raw=await readFile(file);requirePair(raw.length<=8*1024*1024&&sha(raw)===d.sha256,'artifact_hash_mismatch');return{value:JSON.parse(raw),bytes:raw.length};}
export const controlledBinding=c=>c.controlledPair?{label:c.controlledPair.label,manifest:c.controlledPair.manifest,pair:c.controlledPair.pair,before:c.controlledPair.before,after:c.controlledPair.after}:null;
export async function verifyControlledPair(p,c,dir){
 requirePair(c.id==='s05','s05_only');const b=c.controlledPair;requirePair(b?.label===CONTROLLED_LABEL,'continuous_simulation_label_required');
 requirePair(p.tooling?.version===DEMO_TOOL_VERSION&&/^[a-f0-9]{40}$/.test(p.tooling?.sourceSha??''),'separate_tooling_pin_required');
 const m=(await pinned(dir,b.manifest)).value,pairFile=await pinned(dir,b.pair),pair=pairFile.value;
 requirePair(m.classification==='controlled-simulation'&&m.label?.includes(CONTROLLED_LABEL),'manifest_simulation_label_required');
 requirePair(m.sourceSha===p.release.sourceSha&&m.htmlSha256===p.release.htmlSha256,'frozen_client_source_mismatch');
 verifyP1(pair);requirePair(pair.muse==='03-ripple'&&pair.item==='transit_pass'&&m.muse===pair.muse&&m.item===pair.item,'controlled_intervention_mismatch');
 requirePair(pair.without.seed===m.seed&&hash(pair.without.inputs)===m.inputSha256,'manifest_input_or_seed_mismatch');
 const views=c.views;requirePair(Array.isArray(views)&&views.length===2&&views[0].id==='before'&&views[1].id==='after'&&views.every(v=>v.duration===10),'two_views_required');
 requirePair(views[0].runId!==views[1].runId,'different_run_records_required');requirePair(Array.isArray(c.refs)&&c.refs.length===2&&c.refs.every(r=>r.role==='controlled-p1'&&r.requestId==null&&r.signedVerdict==null),'dedicated_controlled_refs_required');
 const pairPin=m.files?.['controlled-pair.json'];requirePair(pairPin?.sha256===b.pair.sha256&&pairFile.bytes===pairPin.bytes,'pair_manifest_binding');
 const results=[];
 for(const[side,variant]of[['before','without'],['after','with']]){
  const loaded=await pinned(dir,b[side]),r=loaded.value,trial=pair[variant],view=views.find(v=>v.id===side),filePin=m.files?.[variant+'.run.json'];
  requirePair(filePin?.sha256===b[side].sha256&&filePin.bytes===loaded.bytes,'record_manifest_binding');
  requirePair(r.runId===view.runId&&r.runId===m.runIds?.[variant]&&r.worldId===m.worldId&&r.worldId===trial.initial.worldId,'record_identity_mismatch');
  for(const key of['schemaVersion','engineVersion','harnessVersion','catalogVersion'])requirePair(r[key]===m.versions?.[key],'record_version_mismatch');
  const player=loadRun(r);requirePair(r.seed===trial.seed&&r.startedAt===trial.initial.lastTickAt,'record_seed_or_clock_mismatch');
  requirePair(hash(pair.without.initial)===hash(createWorld(r.worldId,r.startedAt)),'baseline_initial_state_mismatch');
  requirePair(hash(JSON.parse(r.initialSnapshot.body))===hash(publicState(trial.initial)),'initial_checkpoint_mismatch');
  requirePair(r.inputs.length===trial.inputs.length&&hash(r.events)===hash(trial.events),'ordered_input_or_event_mismatch');
  let state=structuredClone(trial.initial);
  for(let i=0;i<trial.inputs.length;i++){
   const input=trial.inputs[i],row=r.inputs[i],next=tick(state,structuredClone(input),makeHooks());
   requirePair(row.at===input.now&&row.kind==='external'&&row.label==='CONTROLLED_SIMULATION '+variant+' input-sha256='+hash(input),'raw_input_hash_or_clock_mismatch');
   requirePair(row.input?.action==='controlled_p1_tick'&&hash(row.input.fields)===hash({})&&hash(row.input.omitted)===hash(Object.keys(input).sort()),'recorded_input_binding_mismatch');
   requirePair(hash(JSON.parse(row.afterSnapshot.body))===hash(publicState(next.state)),'engine_checkpoint_mismatch');
   const events=r.events.filter(e=>e.inputSeq===row.seq);requirePair(events.length===next.events.length,'engine_event_count_mismatch');
   for(let k=0;k<events.length;k++){const actual=events[k],expected=next.events[k];for(const key of['kind','source','muse','other','place','line','at'])requirePair(hash(actual[key]??null)===hash(expected[key]??null),'engine_event_mismatch');for(const[key,value]of Object.entries(expected.data??{}))requirePair(hash(actual.data?.[key])===hash(value),'engine_event_data_mismatch');}
   state=next.state;
  }
  requirePair(hash(state)===hash(trial.final),'engine_final_state_mismatch');
  const scaled=view.seekSec*10;requirePair(Number.isFinite(scaled)&&Math.abs(scaled-Math.round(scaled))<1e-8&&view.seekSec>=0&&view.seekSec+view.duration<=player.getState().durationSec,'recorded_seek_range_or_step');
  player.seek(view.seekSec);const frame=player.getFrame();requirePair(frame.snapshotHash===view.snapshotHash,'view_checkpoint_mismatch');
  const refs=c.refs.filter(x=>x.runId===r.runId);requirePair(refs.length===1,'one_causal_ref_per_view_required');const ref=refs[0],event=r.events.find(e=>e.id===ref.eventId);
  requirePair(event&&event.muse===pair.muse&&event.source==='replay'&&event.inputSeq===ref.inputSeq&&ref.originalSource===event.source&&frame.events.some(e=>e.id===event.id),'visible_causal_event_required');
  requirePair(variant==='without'?event.kind==='decision_rejected'&&event.data?.reason?.includes('Transit Pass'):event.kind==='depart'&&event.data?.speed==='bus','actual_ability_difference_required');
  const saved=(await pinned(dir,ref)).value,row=r.inputs.find(i=>i.seq===event.inputSeq);
  requirePair(saved.runIdStored===true&&saved.runId===r.runId&&hash(saved.event)===hash(event)&&hash(saved.input)===hash(row),'reference_record_binding_mismatch');
  for(const key of['runId','worldId','seed','startedAt','schemaVersion','engineVersion','harnessVersion','catalogVersion'])requirePair(saved.run?.[key]===r[key],'reference_header_mismatch');
  requirePair(saved.run.initialSnapshot?.hash===r.initialSnapshot.hash&&!event.data?.evidence?.requestId&&!event.data?.envelope,'no_provider_or_signature_invention');
  results.push({view:side,runId:r.runId,snapshotHash:frame.snapshotHash,eventId:event.id});
 }
 return{classification:'controlled-simulation',label:CONTROLLED_LABEL,views:results};
}
