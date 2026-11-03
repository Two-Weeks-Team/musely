// Exact reviewed conflict resolution for the two additive feature-OFF option fields.
// Any other conflict remains an error. This composes test checkouts, not repository branches.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const [left,base,right,out]=process.argv.slice(2);
if(!left||!base||!right||!out)throw Error('expected left base right output');
const result=spawnSync('git',['merge-file','-p',left,base,right],{encoding:'utf8'});
if(result.error)throw result.error;
if(result.status!==0&&result.status!==1)throw Error('merge process failed: '+result.stderr);
let merged=result.stdout;
if(result.status===1){
 const pattern=/^<<<<<<< [^\n]+\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]+\n/gm;
 const conflicts=[...merged.matchAll(pattern)];
 const wants='  /** Feature OFF; server-only policy, no WorldDO installation. */\n  residentWants?:ResidentWantsCallerPolicy;\n';
 const life='  /** Default absent/off. Trusted server-only policy; no browser-controlled flags. */\n  residentLife?: {enabled:boolean;initialState:LifeState;allowedPlaceIds:readonly string[];\n    ownershipKind:(id:string)=>ResidentOwnershipKind;promiseLeadMs?:number;promiseGraceMs?:number};\n';
 if(conflicts.length!==1||conflicts[0][1]!==wants||conflicts[0][2]!==life)throw Error('unreviewed runtime conflict');
 merged=merged.replace(conflicts[0][0],wants+life);
}
if(/^<<<<<<< |^=======|^>>>>>>> /m.test(merged))throw Error('unresolved runtime conflict');
writeFileSync(out,merged);
