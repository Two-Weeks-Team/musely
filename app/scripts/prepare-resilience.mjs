// Writes new local configs only. Does not authenticate, deploy, set a secret or contact either service.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isolationConfig} from './lib/resilience-isolation.mjs';
import {sha256} from './lib/resilience-io.mjs';
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
if(!['--name','--origin','--fault-origin','--out'].every(k=>args.includes(k))) {
  console.log('Prepare only: node scripts/prepare-resilience.mjs --name musely-d03-CASE --origin https://musely-d03-CASE.ACCOUNT.workers.dev --fault-origin https://musely-d03-fault.ACCOUNT.workers.dev --mode 503 --out /new/external/config-directory');process.exit(args.includes('--help')?0:2);
}
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(get('--out'));
if(out===app || out.startsWith(app+'/'))throw Error('Prepare outside the product checkout');
const cfg=isolationConfig(JSON.parse(await readFile(join(app,'wrangler.jsonc'),'utf8')),{name:get('--name'),origin:get('--origin'),faultOrigin:get('--fault-origin'),mode:args.includes('--mode')?get('--mode'):'503',app,cap:args.includes('--cap')?Number(get('--cap')):0.05});
const [workerBundle,html]=await Promise.all([readFile(cfg.main),readFile(join(app,'dist/index.html'))]);
const faultName=new URL(get('--fault-origin')).hostname.split('.')[0];
const stub={$schema:cfg.$schema,name:faultName,account_id:cfg.account_id,main:join(app,'scripts/fixtures/model-fault-worker.mjs'),compatibility_date:cfg.compatibility_date,workers_dev:true,preview_urls:false,routes:[],observability:{enabled:false}};
await mkdir(out,{recursive:false});
for(const [file,data] of [['product.json',cfg],['stub.json',stub]])await writeFile(join(out,file),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim();
const checkoutClean=!execFileSync('git',['status','--porcelain','--untracked-files=all','--','.'],{cwd:app,encoding:'utf8'}).trim();
await writeFile(join(out,'preparation.json'),JSON.stringify({issueId:63,preparedAt:new Date().toISOString(),sourceSha,checkoutClean,assetBuild:'prebuilt_bytes_hashed_origin_requires_operator_attestation',workerBundleSha256:sha256(workerBundle),htmlSha256:sha256(html),productConfigSha256:sha256(JSON.stringify(cfg,null,2)+'\n'),configurationDeltas:['Worker name/storage namespace','dedicated rate namespace','no routes','workers.dev origin','test-only upstream','small isolated budget','Turnstile disabled','observability disabled'],deployment:'not_executed',fourHourRun:'not_started'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({prepared:out,sourceSha,deployment:'not_executed',fourHourRun:'not_started'}));
