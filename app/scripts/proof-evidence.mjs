// Default: local simulation. --collect requires explicit same-release metadata and only reads public GET endpoints.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildControlledProof} from './proof/simulation.mjs';
import {verifyP0,verifyP1,correlateP2,recountEvidence,verifyRelease} from './proof/evidence.mjs';
import {collectPublicProof} from './proof/collect.mjs';
import {currentVersions} from '../src/replay/versions.ts';
const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined;};
const out=value('--out');if(!out)throw Error('Provide --out artifact.json (default mode is local simulation)');
let report;
if(args.includes('--collect')){
 if(!value('--meta')||!value('--run')||!value('--base')||!value('--from')||!value('--to'))throw Error('--collect requires --meta --base --run --from --to');
 const meta=JSON.parse(await readFile(value('--meta'),'utf8')),scenes=value('--scenes')?JSON.parse(await readFile(value('--scenes'),'utf8')):[];
 report=await collectPublicProof({base:value('--base'),meta,runId:value('--run'),from:Number(value('--from')),to:Number(value('--to')),scenes});
}else{
 const raw=await buildControlledProof(),ats=raw.events.map(e=>e.at),scope={worldId:'d02-local-simulation',runIds:[raw.p2.record.runId],from:Math.min(...ats),to:Math.max(...ats)+1,day:null,complete:true};
 report={meta:{classification:'simulation',issueId:62,owner:'Codex',PR:null,commitSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment:'local Node24 SQLite and ephemeral test roots',deployId:null,URL:null,configVersion:currentVersions(),testedAt:new Date().toISOString(),result:'local-only; no deployed acceptance',command:'node scripts/proof-evidence.mjs --out '+out,artifact:out,limitations:raw.limitations},p0:verifyP0(raw.p0),p1:verifyP1(raw.p1),p2:correlateP2(raw.p2.scene,raw.p2.record),recount:recountEvidence(raw.events,scope),raw};
}
verifyRelease(report.meta);
await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({artifact:out,classification:report.meta.classification,status:report.status??'local-only',p0:report.p0?.status,p1:report.p1?.status,p2:report.p2?.evidence.kind,events:report.recount?.oracle.sample.events}));
