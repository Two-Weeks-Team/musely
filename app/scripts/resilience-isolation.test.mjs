import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {isolationConfig} from './lib/resilience-isolation.mjs';
import stub from './fixtures/model-fault-worker.mjs';
const original=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const opts={name:'musely-d03-check',origin:'https://musely-d03-check.example.workers.dev',faultOrigin:'https://musely-d03-fault.example.workers.dev',mode:'503',app:'/frozen/app'};
test('isolated config cannot retain production routes, worker name, DO script linkage, rate namespace or model origin',()=>{
 const before=JSON.stringify(original),cfg=isolationConfig(original,opts);
 assert.equal(cfg.name,'musely-d03-check');assert.deepEqual(cfg.routes,[]);assert.equal(cfg.workers_dev,true);assert.equal(cfg.main,'/frozen/app/.wrangler/dry-run/index.js');assert.equal(cfg.no_bundle,true);
 assert.equal(cfg.vars.PUBLIC_ORIGIN,opts.origin);assert.equal(cfg.vars.MODEL_BASE,opts.faultOrigin+'/503');assert.notEqual(cfg.ratelimits[0].namespace_id,original.ratelimits[0].namespace_id);
 assert.ok(!cfg.durable_objects.bindings.some(b=>b.script_name));assert.equal(JSON.stringify(original),before);
});
test('preparation rejects production names/hosts/model providers and a zero cap rather than changing them',()=>{
 for(const changed of [{name:'musely'},{origin:'https://musely.net'},{faultOrigin:'https://api.meta.ai'},{faultOrigin:'https://musely-d03-fault.example.workers.dev/?key=x'},{mode:'whatever'},{cap:0}])assert.throws(()=>isolationConfig(original,{...opts,...changed}));
});
test('fault upstream is inert outside its explicit test modes and never reflects authorization or model input',async()=>{
 const call=path=>stub.fetch(new Request('https://test.invalid'+path,{method:'POST',body:'{"messages":["secret-marker"]}',headers:{authorization:'Bearer secret-marker'}}));
 assert.equal((await call('/429/chat/completions')).status,429);assert.equal((await call('/503/chat/completions')).status,503);
 const bad=await call('/bad-output/chat/completions');assert.equal(bad.status,200);assert.ok(!(await bad.text()).includes('secret-marker'));
 assert.equal((await call('/chat/completions')).status,404);assert.equal((await stub.fetch(new Request('https://test.invalid/429/chat/completions'))).status,405);
});
