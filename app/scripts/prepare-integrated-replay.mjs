// Exact reviewed predecessors only; no prefix-based or numeric compatibility inference.
import {readFileSync,writeFileSync} from 'node:fs';
const file=process.argv[2];if(!file)throw Error('player source path required');let source=readFileSync(file,'utf8');const anchor='const HISTORICAL_VERSIONS: readonly RunVersions[] = [\n';if(source.split(anchor).length!==2)throw Error('unexpected replay source');
const tuple=(engineVersion,catalogVersion)=>({schemaVersion:'run-log-2',engineVersion,harnessVersion:'harness-c0c69e98b5e8',catalogVersion});
const legacy=tuple('engine-6-resident-v1','catalog-ffb109917767');
const objects=[...source.matchAll(/\{[^{}]*engineVersion[^{}]*\}/g)].map(m=>m[0]);
const key=(obj,name)=>obj.match(new RegExp(`["']?${name}["']?\\s*:\\s*["']([^"']+)["']`))?.[1];
const found=objects.filter(o=>key(o,'engineVersion')===legacy.engineVersion);
if(found.length!==1||Object.entries(legacy).some(([k,v])=>key(found[0],k)!==v))throw Error('missing or changed exact resident-v1 predecessor');
const versions=[tuple('engine-6','catalog-c7068bfa0238'),tuple('engine-6-resident-v2','catalog-ffb109917767'),tuple('engine-7','catalog-ffb109917767')];
for(const v of versions){if(objects.some(o=>key(o,'engineVersion')===v.engineVersion))throw Error('predecessor already present: review rather than duplicate');}
source=source.replace(anchor,anchor+versions.map(v=>'  '+JSON.stringify(v)+',\n').join(''));writeFileSync(file,source);
