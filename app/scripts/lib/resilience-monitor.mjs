// D-03 observation only. A green GET run is never proof that fault/security scenarios passed.
export const FOUR_HOURS_MS = 4 * 3600000;
const hex = (x,n) => typeof x === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(x);
export function validatePin(p) {
  let u;try{u=new URL(p.baseUrl);}catch{throw Error('Invalid evidence origin');}
  const fields=new Set(['issueId','environment','releaseSha','deployId','versionIds','configVersion','configSha256','htmlSha256','workerName','baseUrl','operatorAttested','sourcePath','configPath']);
  if(Object.keys(p).some(k=>!fields.has(k)))throw Error('Unknown pin field; credentials do not belong in evidence');
  if(!['production-read-only','isolated-read-only'].includes(p.environment) || p.operatorAttested!==true || p.issueId!==63 || !hex(p.releaseSha,40) || !hex(p.configSha256,64) || !hex(p.htmlSha256,64) || !p.deployId || !p.configVersion || !/^[a-z0-9-]+$/.test(p.workerName) || !Array.isArray(p.versionIds) || p.versionIds.length!==1 || !p.versionIds[0] || u.protocol!=='https:' || u.username || u.password || u.search || u.hash || u.pathname!=='/') throw Error('A fixed, attested release/deployment/config and a credential-free HTTPS origin are required');
  return true;
}
export class Continuity {
  constructor(pin) {validatePin(pin);this.pin=structuredClone(pin);this.samples=0;this.failures=[];this.recoveries=0;this.down=false;this.first=null;this.last=null;this.lastWorld=null;}
  observe(s) {
    const issues=[];const p=this.pin;
    if(!Number.isFinite(s.monoMs)||!Number.isFinite(s.at))throw Error('Finite monotonic and UTC timestamps required');
    if(this.first===null)this.first=s.monoMs;
    if(this.last && (s.monoMs-this.last.monoMs>90000 || s.monoMs<this.last.monoMs))issues.push('observation_gap');
    if(this.last && Math.abs((s.at-this.last.at)-(s.monoMs-this.last.monoMs))>30000)issues.push('clock_jump');
    if(s.error)issues.push(s.error);
    else {
      if(s.identity?.deployId!==p.deployId || JSON.stringify([...(s.identity?.versionIds??[])].sort())!==JSON.stringify([...p.versionIds].sort()) || s.sourceSha!==p.releaseSha || !s.sourceClean || s.configSha256!==p.configSha256 || s.htmlSha256!==p.htmlSha256)issues.push('identity_changed');
      const w=s.world;
      const budget=s.status?.budget,model=s.status?.model;
      const run=s.run,nonnegativeInt=n=>Number.isSafeInteger(n)&&n>=0;
      const validRun=run && run.worldId===w?.worldId && ['runId','schemaVersion','engineVersion','harnessVersion','catalogVersion','seed'].every(k=>typeof run[k]==='string'&&run[k].length>0) && Number.isFinite(run.startedAt) && run.startedAt<=s.at+30000 && hex(run.initialSnapshot?.hash,64) && nonnegativeInt(run.initialSnapshot?.bytes) && hex(run.stateHash,64) && nonnegativeInt(run.events) && nonnegativeInt(run.inputs?.count) && nonnegativeInt(run.inputs?.lastSeq) && (run.inputs.count===0 ? run.inputs.lastSeq===0&&run.inputs.lastAt===null : run.inputs.lastSeq>=run.inputs.count&&Number.isFinite(run.inputs.lastAt)&&run.inputs.lastAt>=run.startedAt&&run.inputs.lastAt<=s.at+30000);
      if(!w?.worldId || !/^\d{4}-\d{2}-\d{2}$/.test(w.day??'') || ![w.tick,w.version,w.lastTickAt].every(Number.isFinite) || !budget || ![budget.capUsd,budget.spentUsd,budget.reservedUsd,budget.remainingUsd,budget.liveCalls].every(n=>Number.isFinite(n)&&n>=0) || typeof model?.connected!=='boolean' || typeof model?.live!=='boolean' || !Array.isArray(s.events) || !validRun)issues.push('invalid_response');
      else {
        if(s.at-w.lastTickAt>180000 || w.lastTickAt>s.at+30000)issues.push('world_stalled');
        const old=this.lastWorld;
        if(old && (old.worldId!==w.worldId || w.day<old.day || (old.day===w.day && (w.tick<old.tick || w.version<old.version || w.lastTickAt<old.lastTickAt))))issues.push('world_rewound');
        const ids=s.events.map(e=>e.id);if(ids.some(id=>typeof id!=='string') || new Set(ids).size!==ids.length)issues.push('duplicate_event_id');
        if(!issues.includes('world_rewound'))this.lastWorld=structuredClone(w);
      }
    }
    const recovered=this.down && !issues.length;
    if(recovered)this.recoveries++;
    this.down=issues.length>0;
    this.failures.push(...issues.map(reason=>({at:s.at,sample:this.samples,reason})));
    this.samples++;this.last={monoMs:s.monoMs,at:s.at};
    return {issues,recovered};
  }
  needsObservation() {return this.last===null || this.last.monoMs-this.first<FOUR_HOURS_MS;}
  summary() {
    const elapsedMs=this.last ? this.last.monoMs-this.first : 0;
    return {result:this.failures.length?'failed':elapsedMs>=FOUR_HOURS_MS?'observed_continuous':'incomplete',faultAcceptance:'not_measured',elapsedMs,samples:this.samples,recoveries:this.recoveries,failures:[...this.failures]};
  }
}
