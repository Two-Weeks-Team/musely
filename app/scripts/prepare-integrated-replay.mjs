// Explicit reviewed predecessor tuples only; never infer compatibility from a prefix or engine number.
import {readFileSync,writeFileSync} from 'node:fs';
const file=process.argv[2];if(!file)throw Error('player source path required');let source=readFileSync(file,'utf8');const anchor='const HISTORICAL_VERSIONS: readonly RunVersions[] = [\n';if(source.split(anchor).length!==2)throw Error('unexpected replay source');
const versions=[{schemaVersion:'run-log-2',engineVersion:'engine-6',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-c7068bfa0238'},{schemaVersion:'run-log-2',engineVersion:'engine-6-resident-v1',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-ffb109917767'}];
for(const v of versions){if(new RegExp(`[\\"' ]*engineVersion[\\"']?\\s*:\\s*[\\"']${v.engineVersion}[\\"']`).test(source))throw Error('predecessor already present: review rather than duplicate');}
source=source.replace(anchor,anchor+versions.map(v=>'  '+JSON.stringify(v)+',\n').join(''));writeFileSync(file,source);
