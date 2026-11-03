// Exact reviewed conflicts preserve BOTH feature-OFF policy, idle and tick-record paths.
// Any other conflict remains an error. This composes test checkouts, not repository branches.
import {spawnSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
const [left,base,right,out,kind='runtime']=process.argv.slice(2);
if(!['runtime','world','messages','player'].includes(kind))throw Error('unknown composition kind');
if(!left||!base||!right||!out)throw Error('expected left base right output');
const result=spawnSync('git',['merge-file','-p',left,base,right],{encoding:'utf8'});
if(result.error)throw result.error;
if(result.status===null||result.status<0||result.status>=128)throw Error('merge process failed: '+result.stderr);
let merged=result.stdout;
if(result.status>0){
 const pattern=/^<<<<<<< [^\n]+\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]+\n/gm;
 const conflicts=[...merged.matchAll(pattern)];
 const wants='  /** Feature OFF; server-only policy, no WorldDO installation. */\n  residentWants?:ResidentWantsCallerPolicy;\n';
 const life='  /** Default absent/off. Trusted server-only policy; no browser-controlled flags. */\n  residentLife?: {enabled:boolean;initialState:LifeState;allowedPlaceIds:readonly string[];\n    ownershipKind:(id:string)=>ResidentOwnershipKind;promiseLeadMs?:number;promiseGraceMs?:number};\n';
 const reviewed=JSON.parse(readFileSync(new URL('./compose-resident-conflicts.json',import.meta.url),'utf8'));
 reviewed.push({kind:'runtime',left:wants,right:life,result:wants+life});
 if(conflicts.length!==result.status)throw Error('conflict count mismatch');
 for(const c of conflicts){const rule=reviewed.find(r=>r.kind===kind&&r.left===c[1]&&r.right===c[2]);if(!rule)throw Error('unreviewed runtime conflict');merged=merged.replace(c[0],rule.result);}
}
if(/^<<<<<<< |^=======|^>>>>>>> /m.test(merged))throw Error('unresolved runtime conflict');
writeFileSync(out,merged);
