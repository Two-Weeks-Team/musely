// Run from preview/: node character-kit/source/validate_gltf.mjs. Uses the locally installed Khronos gltf-validator
// (output/jolly-base/validator, ignored by git); writes character-kit/validation/export/gltf-validator.json.
import validator from '../../output/jolly-base/validator/node_modules/gltf-validator/index.js';
import{readFileSync,writeFileSync}from'node:fs';
const m=JSON.parse(readFileSync('character-kit/manifest.json','utf8'));const out={validator:validator.version(),files:{}};
for(const p of Object.keys(m.files)){const r=await validator.validateBytes(new Uint8Array(readFileSync('character-kit/runtime/'+p)),{maxIssues:50});out.files[p]={errors:r.issues.numErrors,warnings:r.issues.numWarnings,infos:r.issues.numInfos,codes:[...new Set(r.issues.messages.filter(x=>x.severity<=1).map(x=>x.code))]};}
writeFileSync('character-kit/validation/export/gltf-validator.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
