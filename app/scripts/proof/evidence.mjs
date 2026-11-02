// D-02: validates evidence; it never executes a product command or creates authentication.
import {createHash} from 'node:crypto';
import {computeAutonomy} from '../../src/ui/autonomy.ts';
import {recountAutonomy, values} from '../../worker/core/autonomy-oracle.ts';
const canonical = v => JSON.stringify(v, (_k,x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])) : x);
export const hash = v => createHash('sha256').update(canonical(v)).digest('hex');
const requireProof=(ok,why)=>{if(!ok)throw Error('invalid_evidence: '+why);};
export function verifyP0(p) {
 const {verified,revoked,refused}=p;
 requireProof(verified.kind==='a2a_verified' && revoked.kind==='delegation_revoked' && refused.kind==='a2a_refused','P0 ordered verification/revoke/refusal');
 requireProof(typeof verified.muse==='string' && verified.muse && typeof verified.runId==='string' && verified.runId && [p.trade,revoked,refused].every(e=>e?.muse===verified.muse&&e?.runId===verified.runId),'P0 actor or run mismatch');
 requireProof(verified.seq < revoked.seq && revoked.seq < refused.seq,'P0 log order');
 requireProof(refused.data.reason==='delegation_revoked' && refused.data.step==='delegation','P0 revocation must be the refusal cause');
 requireProof(hash(verified.data.content)===hash(refused.data.content),'P0 business content changed');
 for(const k of ['delegation_ref','scope','scope_hash','agent_id'])requireProof(verified.data.envelope?.[k] && verified.data.envelope[k]===refused.data.envelope?.[k],'P0 delegation/business identity changed: '+k);
 for(const k of ['message_id','nonce'])requireProof(verified.data.envelope?.[k] && refused.data.envelope?.[k] && verified.data.envelope[k]!==refused.data.envelope[k],'P0 fresh '+k);
 requireProof(typeof p.fullStateBeforeHash==='string'&&p.fullStateBeforeHash===p.fullStateAfterHash&&p.refusalResult?.stateUnchanged===true,'P0 full state changed after refusal');
 requireProof(hash(p.beforeRefusal)===hash(p.afterRefusal),'P0 state changed after refusal');
 requireProof(p.trade?.kind==='trade_completed' && p.trade.seq>verified.seq && p.trade.seq<revoked.seq && p.trade.data.envelope.message_id===verified.data.envelope.message_id,'P0 first trade actually committed');
 return {status:'verified',cause:'delegation_revoked',freshMessage:true,freshNonce:true,stateUnchanged:true,eventIds:[verified.id,p.trade.id,revoked.id,refused.id]};
}
export function verifyP1(p) {
 requireProof(p.classification==='controlled-simulation','P1 controlled run must be labelled');
 requireProof(p.without.seed===p.without.initial.seed && p.with.seed===p.with.initial.seed,'P1 declared seed differs from snapshot seed');
 requireProof(p.without.seed===p.with.seed && hash(p.without.inputs)===hash(p.with.inputs),'P1 seed/clock/inputs differ');
 const a=structuredClone(p.without.initial), b=structuredClone(p.with.initial), m=b.muses.find(m=>m.id===p.muse);
 requireProof(m && m.inventory.filter(x=>x===p.item).length===1,'P1 one item delta');
 m.inventory.splice(m.inventory.indexOf(p.item),1);
 requireProof(hash(a)===hash(b),'P1 initial state differs beyond the item');
 requireProof(p.without.events.some(e=>e.muse===p.muse && e.kind==='decision_rejected') && p.with.events.some(e=>e.muse===p.muse && e.kind==='depart' && e.data.speed==='bus'),'P1 observed ability difference absent');
 return {status:'verified',classification:p.classification,item:p.item,muse:p.muse,initialWithout:hash(a),initialWith:hash(p.with.initial),inputs:hash(p.with.inputs),modelCalls:0};
}
export function correlateP2(scene, record) {
 const {event,input,run,runId}=record;
 requireProof(scene.eventId===event.id && scene.runId===runId && runId===run?.runId && event.runId===runId,'P2 scene/event/run mismatch');
 requireProof(scene.worldId===run.worldId && input?.runId===runId && scene.version===input?.versionAfter && event.inputSeq===input?.seq,'P2 world/version/commit mismatch');
 requireProof(input.beforeHash && input.afterHash && scene.snapshotHash===input.afterHash,'P2 snapshot/commit hash mismatch');
 requireProof(['live','replay','simulation'].includes(scene.classification),'P2 scene classification');
 requireProof(!(scene.classification==='live'&&event.source==='replay'),'P2 replay source cannot have live scene classification');
 const ev=event.data?.evidence;
 const requestId=event.source==='replay' ? (typeof ev?.replayOf==='string'?ev.replayOf:ev?.replayOf?.requestId) : ev?.requestId;
 let evidence;
 if(requestId) evidence={kind:'model-reference',requestId,model:ev?.model??ev?.replayOf?.model??null,source:event.source};
 else if(event.kind==='a2a_verified' && event.data?.steps?.includes('signature') && event.data?.envelope?.message_id) evidence={kind:'signature-verdict',passed:true,messageId:event.data.envelope.message_id,steps:event.data.steps};
 else if(['a2a_refused','command_refused'].includes(event.kind) && event.data?.reason && event.data?.step) evidence={kind:'authorization-verdict',passed:false,reason:event.data.reason,step:event.data.step};
 else throw Error('invalid_evidence: P2 missing model reference or verification verdict');
 return {classification:scene.classification,source:event.source,eventId:event.id,runId,inputSeq:input.seq,worldId:scene.worldId,version:scene.version,snapshotHash:input.afterHash,evidence};
}
export function recountEvidence(events,scope) {
 requireProof(scope.worldId && Number.isSafeInteger(scope.from) && Number.isSafeInteger(scope.to) && scope.from<scope.to,'C09 explicit world/time scope');
 requireProof(events.every(e=>e.at>=scope.from && e.at<scope.to && scope.runIds.includes(e.runId)),'C09 raw events outside declared scope');
 const identities=new Map();for(const e of events){requireProof(!identities.has(e.id)||identities.get(e.id)===e.runId,'C09 conflicting event/run identity');identities.set(e.id,e.runId);}
 const one=(sample,runIds)=>{
  const oracle=recountAutonomy(sample,{...scope,runIds}), expected=values(oracle);
  const ui=computeAutonomy(sample,{...scope,day:scope.day??'explicit interval',label:'D-02 raw record',runId:runIds.join(',' )});
  requireProof(ui.rows.every(r=>r.value===expected[r.key].value && r.measured===expected[r.key].measured) && ui.eventCount===oracle.sample.events && ui.duplicates===oracle.sample.duplicateIds && hash(ui.sources)===hash(oracle.sources) && hash(ui.origins)===hash(oracle.origins),'C09 panel/oracle mismatch');
  return {oracle,values:expected,ui,classification:'raw-record-recount'};
 };
 return {...one(events,scope.runIds),byRun:scope.runIds.map(runId=>({runId,...one(events.filter(e=>e.runId===runId),[runId])}))};
}
export function verifyRelease(meta) {
 requireProof(['simulation','live','replay','physical'].includes(meta.classification),'C10 classification');
 for(const k of ['issueId','owner','commitSha','environment','configVersion','testedAt','command','result','artifact','limitations'])requireProof(meta[k]!==undefined && meta[k]!==null && (typeof meta[k]!=='string'||meta[k].trim().length>0),'C10 missing '+k);
 if(meta.classification!=='simulation')for(const k of ['deployId','URL'])requireProof(typeof meta[k]==='string' && meta[k].length>0,'C10 missing '+k);
 return {...meta,status:meta.classification==='simulation'?'local-only':'evidence-present'};
}
