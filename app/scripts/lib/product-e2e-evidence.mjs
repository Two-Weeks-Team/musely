// Redacted evidence envelope only. These fields are our audit metadata, not promised platform API fields.
// A syntactically consistent envelope cannot establish that its claimed real-world event occurred.
export const requiredSteps=Object.freeze(['claim','webcam-ritual','own-muse-connection','activity','connected-muse-inbox','two-owner-approval','reward','revocation','no-agreement','one-side-refusal','changed-candidate','expired-task','reconnect']);
const pinKeys=['releaseSha','deployId','configVersion','baseUrl','htmlSha256'];
const receiptKeys=['step','provenance','release','observedAt','artifactRef','artifactSha256','actorRefs','requestId','challengeId','verdict','framesStored','approvalRefs','taskId','revision'];
const ref=x=>typeof x==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(x);
function exact(o,keys,label){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k)))throw Error('unknown '+label+' field');}
function pin(p){exact(p,pinKeys,'release');if(pinKeys.some(k=>!Object.hasOwn(p,k))||typeof p.releaseSha!=='string'||!/^[a-f0-9]{40}$/.test(p.releaseSha)||typeof p.htmlSha256!=='string'||!/^[a-f0-9]{64}$/.test(p.htmlSha256)||!ref(p.deployId)||!ref(p.configVersion))throw Error('invalid release identity');let u;try{u=new URL(p.baseUrl);}catch{throw Error('invalid baseUrl');}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.href!==u.origin+'/')throw Error('invalid baseUrl');}
export function auditProductEvidence(release,receipts){
 pin(release);if(!Array.isArray(receipts))throw Error('receipts must be an array');const seen=new Set(),metadata=[];
 for(const r of receipts){
  exact(r,receiptKeys,'receipt');if(!requiredSteps.includes(r.step))throw Error('unknown step');if(seen.has(r.step))throw Error('duplicate step');seen.add(r.step);
  if(r.provenance!=='connected-real')throw Error('connected-real evidence required');pin(r.release);if(pinKeys.some(k=>r.release[k]!==release[k]))throw Error('release mismatch');
  if(typeof r.observedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(r.observedAt)||!Number.isFinite(Date.parse(r.observedAt))||new Date(r.observedAt).toISOString().slice(0,19)!==r.observedAt.slice(0,19))throw Error('invalid observedAt');
  if(!ref(r.artifactRef)||typeof r.artifactSha256!=='string'||!/^[a-f0-9]{64}$/.test(r.artifactSha256))throw Error('invalid artifact reference/hash');
  for(const k of ['requestId','challengeId','taskId'])if(r[k]!==undefined&&!ref(r[k]))throw Error('invalid '+k);
  for(const k of ['actorRefs','approvalRefs'])if(r[k]!==undefined&&(!Array.isArray(r[k])||r[k].length<1||r[k].length>2||r[k].some(x=>!ref(x))))throw Error('invalid '+k);
  if(r.step==='webcam-ritual'&&(!ref(r.requestId)||!ref(r.challengeId)||r.verdict!=='passed'||r.framesStored!==false||r.actorRefs?.length!==1))throw Error('webcam metadata incomplete');
  if(r.step==='two-owner-approval'&&(r.actorRefs?.length!==2||new Set(r.actorRefs).size!==2||r.approvalRefs?.length!==2||new Set(r.approvalRefs).size!==2||!ref(r.taskId)||!Number.isSafeInteger(r.revision)||r.revision<1))throw Error('two-owner metadata incomplete');
  metadata.push({step:r.step,state:'consistent-unverified',artifactRef:r.artifactRef,artifactSha256:r.artifactSha256});
 }
 return {acceptedD01:false,requiresIndependentReceiptAudit:true,metadata,pending:[...requiredSteps],missingMetadata:requiredSteps.filter(s=>!seen.has(s)),meaning:'Metadata consistency only; inspect the attested artifact and operational source before accepting any real-world claim.'};
}
