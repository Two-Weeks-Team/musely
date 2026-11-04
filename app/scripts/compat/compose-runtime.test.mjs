import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../compose-resident-runtime.mjs',import.meta.url));
const wants='  /** Feature OFF; server-only policy, no WorldDO installation. */\n  residentWants?:ResidentWantsCallerPolicy;\n';
const life='  /** Default absent/off. Trusted server-only policy; no browser-controlled flags. */\n  residentLife?: {enabled:boolean;initialState:LifeState;allowedPlaceIds:readonly string[];\n    ownershipKind:(id:string)=>ResidentOwnershipKind;promiseLeadMs?:number;promiseGraceMs?:number};\n';
function run(t,left,base,right){const dir=mkdtempSync(join(tmpdir(),'compose-runtime-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const paths=['left','base','right','out'].map(x=>join(dir,x));[left,base,right].forEach((s,i)=>writeFileSync(paths[i],s));const r=spawnSync(process.execPath,[script,...paths],{encoding:'utf8'});return {...r,output:r.status===0?readFileSync(paths[3],'utf8'):null};}
test('reviewed adjacent OFF policies are both preserved',t=>{const wrap=s=>'export type RuntimeOptions = {\n'+s+'  worldId: string;\n}\n';const r=run(t,wrap(wants),wrap(''),wrap(life));assert.equal(r.status,0,r.stderr);assert.equal(r.output,wrap(wants+life));});
test('unreviewed conflicts fail closed',t=>{const r=run(t,'left\n','base\n','right\n');assert.notEqual(r.status,0);assert.match(r.stderr,/unreviewed runtime conflict/);});
test('already compatible edits merge without policy rewriting',t=>{const r=run(t,'same\n','same\n','same\n');assert.equal(r.status,0);assert.equal(r.output,'same\n');});
