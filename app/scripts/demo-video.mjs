#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPlan,writeNew,collect,verifyBundle,calibrate,render} from './lib/demo-video.mjs';
const [command,...args]=process.argv.slice(2);
const help=`D05 local preparation (no publication or browser launch)
  node scripts/demo-video.mjs plan /absolute/new-plan.json
  node scripts/demo-video.mjs collect PLAN.json /absolute/new-evidence-dir
  node scripts/demo-video.mjs verify PLAN.json /absolute/evidence-dir
  node scripts/demo-video.mjs calibrate /absolute/new-output-dir /absolute/ffmpeg
  node scripts/demo-video.mjs render PLAN.json /absolute/evidence-dir /absolute/ffmpeg /absolute/local-font
Collect performs bounded public GETs only, no credentials. Preparation is not acceptance.
Capture requires a separately authorized browser slot: import captureDemoCut from demo-capture.mjs.
Frozen release, actual record links and completed human causal/privacy review are required before capture/render.
`;
try{
 if(!command||['help','--help','-h'].includes(command)){console.log(help);}
 else if(command==='plan'&&args.length===1){await writeNew(resolve(args[0]),JSON.stringify(createPlan(),null,2)+'\n');console.log('Prepared plan; final acceptance not measured.');}
 else if(command==='calibrate'&&args.length===2){console.log(JSON.stringify(await calibrate(resolve(args[1]),resolve(args[0]))));}
 else if(['collect','verify','render'].includes(command)){
  if(args.length!==(command==='render'?4:2))throw Error('bad_arguments');const p=JSON.parse(await readFile(args[0],'utf8')),dir=resolve(args[1]);
  if(command==='collect'){await collect(p,dir);console.log('Public observations saved. No release/account acceptance inferred.');}
  if(command==='verify'){const errors=await verifyBundle(p,dir);console.log(JSON.stringify({status:errors.length?'blocked':'links_validated_only',errors,finalAcceptance:'not_measured'},null,2));if(errors.length)process.exitCode=2;}
  if(command==='render')console.log(JSON.stringify(await render(p,dir,resolve(args[2]),resolve(args[3]))));
 }else throw Error('unknown_command_or_arguments');
}catch(e){console.error(e.message);process.exitCode=1;}
