// Explicitly invoked 4h wall-clock GET observer. Never invokes an action, fault, login, deploy or configuration write.
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Continuity,validatePin,FOUR_HOURS_MS} from './lib/resilience-monitor.mjs';
import {observeGet,currentDeployment,sha256,gitSourceState} from './lib/resilience-io.mjs';
const exec=promisify(execFile),app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
if(!args.includes('--run') || !args.includes('--pin') || !args.includes('--out')) {
  console.log('Prepared only. To start after the release is frozen: node scripts/resilience-monitor.mjs --run --pin /absolute/release-pin.json --out /new/external/evidence-directory');
  process.exit(args.includes('--help')||!args.length?0:2);
}
const pin=JSON.parse(await readFile(resolve(arg('--pin')),'utf8'));validatePin(pin);
if(!pin.configPath || !pin.sourcePath)throw Error('configPath and sourcePath must identify the attested local release checkout');
const out=resolve(arg('--out')),source=resolve(pin.sourcePath),config=resolve(pin.configPath);
if(out===source || out.startsWith(source+'/'))throw Error('Evidence must be outside the release checkout');
await mkdir(out,{recursive:false});
await writeFile(join(out,'pin.json'),JSON.stringify(pin,null,2)+'\n',{flag:'wx'});
const tracker=new Continuity(pin),start=performance.now();let interrupted=false;
process.on('SIGINT',()=>{interrupted=true;});process.on('SIGTERM',()=>{interrupted=true;});
async function identity() {
  // Read-only existing-auth CLI, never a login flow. Neither stdout nor stderr is logged verbatim.
  try {const {stdout}=await exec(process.execPath,[join(app,'node_modules/wrangler/bin/wrangler.js'),'deployments','list','--json','--name',pin.workerName,'--config',config],{cwd:source,timeout:20000,maxBuffer:1024*1024,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false',BROWSER:'none'}});return currentDeployment(JSON.parse(stdout));}
  catch {throw Error('deployment_observation_failed');}
}
async function round() {
  const at=Date.now(),monoMs=performance.now()-start,index=tracker.samples,raw={at,monoMs,requests:[]};let s={at,monoMs};
  try {
    const results=await Promise.allSettled([
      identity(),gitSourceState(source),readFile(config),
      Promise.all(['/', '/api/status','/api/world','/api/world/run','/api/world/events?tail=100'].map(async path=>{const url=new URL(path,pin.baseUrl).href,startedAt=Date.now();try{const r=await observeGet(url,{maxBytes:path==='/'?16*1024*1024:2*1024*1024});raw.requests.push(r);return r;}catch(e){const r={url,method:'GET',startedAt,endedAt:Date.now(),error:e.message};raw.requests.push(r);return r;}})),
    ]);
    const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    const [deployment,sourceState,cfg,requests]=results.map(r=>r.value);
    raw.identity=deployment;
    if(requests.some(r=>r.error))throw Error(requests.find(r=>r.error).error);
    if(requests.some(r=>r.status!==200))throw Error('http_failure');
    const [,status,world,run,events]=requests;
    s={...s,identity:deployment,...sourceState,configSha256:sha256(cfg),htmlSha256:requests[0].sha256,status:JSON.parse(status.body),world:JSON.parse(world.body),run:JSON.parse(run.body),events:JSON.parse(events.body)};
  } catch(e) {s.error=['request_timeout','response_too_large','deployment_observation_failed','http_failure'].includes(e.message)?e.message:'observation_failed';}
  const verdict=tracker.observe(s);
  await writeFile(join(out,`raw-${String(index).padStart(5,'0')}.json`),JSON.stringify(raw)+'\n',{flag:'wx'});
  const row={...s,verdict,raw:`raw-${String(index).padStart(5,'0')}.json`};
  await appendFile(join(out,'samples.jsonl'),JSON.stringify(row)+'\n');
  await writeFile(join(out,'summary.json'),JSON.stringify({...tracker.summary(),pin,endedAt:new Date().toISOString(),interrupted},null,2)+'\n');
  console.log(JSON.stringify({sample:index,at:new Date(at).toISOString(),issues:verdict.issues,recovered:verdict.recovered}));
}
await round();
while(!interrupted && tracker.needsObservation()) {
  await new Promise(r=>{const t=setTimeout(r,Math.min(60000,Math.max(1,tracker.first+FOUR_HOURS_MS-(performance.now()-start))));const stop=()=>{clearTimeout(t);r();};process.once('SIGINT',stop);process.once('SIGTERM',stop);setTimeout(()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);},61000).unref();});
  if(!interrupted)await round();
}
const result=tracker.summary();
if(interrupted && result.result!=='failed')result.result='incomplete';
await writeFile(join(out,'summary.json'),JSON.stringify({...result,pin,endedAt:new Date().toISOString(),interrupted},null,2)+'\n');
process.exitCode=result.result==='observed_continuous'?0:1;
