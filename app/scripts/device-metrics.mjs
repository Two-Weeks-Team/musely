// D-04 offline calculation and execution gate. Importing this module never touches a device or browser.
export const DURATION_MS=210000, DPR_CAP=1.5;
export const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:null;
export function summarizeFrames(samples,durationMs=DURATION_MS){
 const rows=samples.filter(f=>Number.isFinite(f.at)&&Number.isFinite(f.dt)&&f.dt>0&&f.at>=0);
 const fpsBuckets=Array(Math.ceil(durationMs/1000)).fill(0);
 for(const f of rows){const index=Math.floor(f.at/1000);if(index<fpsBuckets.length)fpsBuckets[index]++;}
 const observed=rows.at(-1)?.at??0;
 return {durationMs:observed,complete:observed>=durationMs,frames:rows.length,fpsBuckets,zeroFrameSeconds:fpsBuckets.filter(n=>n===0).length,medianFps:percentile(fpsBuckets,.5),p95FrameMs:percentile(rows.map(f=>f.dt),.95),maxFrameMs:rows.length?Math.max(...rows.map(f=>f.dt)):null};
}
export function comparePss(baseline,candidate){
 const good=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
 const one=(base,next)=>{if(!good(base)||!good(next))return null;const allowedDeltaKiB=Math.max(base*.20,64*1024),deltaKiB=next-base;return {baselineKiB:base,candidateKiB:next,deltaKiB,relativeDelta:deltaKiB/base,allowedDeltaKiB,pass:deltaKiB<=allowedDeltaKiB};};
 const peak=one(baseline?.peakKiB,candidate?.peakKiB),end=one(baseline?.endKiB,candidate?.endKiB);
 return {peak,end,numericPass:peak&&end?peak.pass&&end.pass:null,sustainedGrowth:'requires_raw_trend_review',note:'Numeric limits alone do not establish no sustained growth or equivalent measurement context.'};
}
export function compareContext(a,b){
 return ['model','android','chrome','viewport','dpr','route','cachePolicy'].filter(k=>a?.[k]==null||b?.[k]==null||JSON.stringify(a[k])!==JSON.stringify(b[k]));
}
export function validateFreeze(pin,opts){
 const errors=[],hex=(s,n)=>new RegExp('^[a-f0-9]{'+n+'}$').test(s??'');
 if(pin.status!=='frozen')errors.push('release_not_frozen');
 if(!hex(pin.releaseSHA,40))errors.push('release_sha_required');
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(pin.workerVersion??''))errors.push('worker_version_required');
 if(!hex(pin.configSHA256,64))errors.push('config_sha_required');if(!hex(pin.htmlSHA256,64))errors.push('html_sha_required');
 try{const u=new URL(pin.origin);if(u.protocol!=='https:'||u.origin!==pin.origin)throw Error();}catch{errors.push('https_origin_required');}
 try{const u=new URL(opts.endpoint);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error();}catch{errors.push('nonlocal_cdp');}
 if(!pin.targetId||opts.targetId!==pin.targetId)errors.push('wrong_target');
 if(!['MacBookPro18,2','SM-S918N'].includes(pin.referenceDevice))errors.push('approved_reference_required');
 if(opts.kind==='desktop-210'&&pin.referenceDevice!=='MacBookPro18,2'||opts.kind==='mobile-210'&&pin.referenceDevice!=='SM-S918N')errors.push('reference_kind_mismatch');
 if(pin.dpr!==DPR_CAP)errors.push('dpr_not_1_5');if(pin.durationMs!==DURATION_MS)errors.push('duration_not_210s');
 if(!['mobile-210','desktop-210','first-load','eight-budget','live-observation'].includes(opts.kind))errors.push('unknown_measurement_kind');
 const files=pin.files,seen=new Set();
 if(!Array.isArray(files)||!files.length)errors.push('served_manifest_required');
 else{
  for(const file of files){if(!file||typeof file.path!=='string'||!file.path||file.path.split('/').some(s=>!s||s==='.'||s==='..')||!/^[A-Za-z0-9_./-]+$/.test(file.path))errors.push('invalid_manifest_path');
   if(seen.has(file?.path))errors.push('duplicate_manifest_path');seen.add(file?.path);
   if(!hex(file?.sha256,64)||!Number.isSafeInteger(file?.bytes)||file.bytes<=0)errors.push('invalid_manifest_file');}
  if(['index.html',...EIGHT_KIT_PATHS].some(path=>!seen.has(path)))errors.push('required_served_file_missing');
  if(files.find(f=>f?.path==='index.html')?.sha256!==pin.htmlSHA256)errors.push('html_manifest_binding');
 }
 return errors;
}
export const EIGHT_KIT_PATHS=['base/lod0.glb','base/lod1.glb','base/lod2.glb','base/clips.glb','attachments/props.glb',...['01-sunny','02-moss','03-ripple','05-bloom','06-ink','07-tempo','08-orbit'].map(id=>'attachments/'+id+'.glb')].map(p=>'character-kit/runtime/'+p);
export function eightPayload(files){const byPath=new Map(files.map(x=>[x.path,x])),missing=EIGHT_KIT_PATHS.filter(p=>!Number.isFinite(byPath.get(p)?.bytes));const bytes=missing.length?null:EIGHT_KIT_PATHS.reduce((n,p)=>n+byPath.get(p).bytes,0);return {scope:'shared eight-character runtime GLBs including props/clips; nine-variant extras excluded',bytes,missing,limitBytes:15*1024*1024,pass:bytes===null?null:bytes<=15*1024*1024};}

const CONTEXT_KEYS=['model','android','chrome','viewport','dpr','route','cachePolicy'];
/** Recorded values stay separate from operator declarations; missing historical evidence is not inferred. */
export function compareBaselineContext(b,declared){
 const recorded={...b.context},conflicts=[];
 for(const [k,v] of Object.entries({model:b.model??b.device?.model,android:b.android,chrome:b.chrome,viewport:b.device?.viewport,dpr:typeof b.device?.dpr==='number'?b.device.dpr:b.device?.dpr?.applied,route:b.route??b.conditions?.route,cachePolicy:b.cachePolicy})){if(recorded[k]!=null&&v!=null&&JSON.stringify(recorded[k])!==JSON.stringify(v))conflicts.push(k);if(recorded[k]==null&&v!=null)recorded[k]=v;}
 const missing=CONTEXT_KEYS.filter(k=>recorded[k]==null),mismatches=CONTEXT_KEYS.filter(k=>conflicts.includes(k)||recorded[k]!=null&&(declared?.[k]==null||JSON.stringify(recorded[k])!==JSON.stringify(declared[k])));
 return {recorded,declared,missing,mismatches,conflicts,complete:!missing.length&&!mismatches.length,limitations:missing.map(k=>'Baseline artifact did not record '+k+'; declaration is not measurement evidence')};
}
/** Static HTML script/style references must be included in the same-origin served manifest. */
export function externalCodePaths(html,origin){
 const paths=new Set();
 const tags=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,m=>m.slice(0,m.indexOf('>')+1)).match(/<(?:script|link)\b[^>]*>/gi)??[];
 for(const tag of tags){const attrs=Object.fromEntries([...tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m=>[m[1].toLowerCase(),m[2]??m[3]??m[4]]));
  const script=/^<script\b/i.test(tag),rel=attrs.rel??'',codeLink=/\b(?:stylesheet|modulepreload)\b/i.test(rel)||/\bpreload\b/i.test(rel)&&['script','style'].includes(attrs.as);
  const href=script?attrs.src:(codeLink?attrs.href:null);if(!href)continue;const u=new URL(href,origin+'/');if(u.origin!==origin||u.username||u.password||u.search)throw Error('external_code_origin_or_query_not_pinned');paths.add(decodeURIComponent(u.pathname).replace(/^\//,''));}
 return [...paths];
}
