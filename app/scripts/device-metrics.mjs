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
 const local=pin.environment==='local-read-only-pair';
 if(pin.status!=='frozen')errors.push('release_not_frozen');
 if(!hex(pin.releaseSHA,40))errors.push('release_sha_required');
 if(local){
  if(opts.kind!=='mobile-210'||!['baseline-capture','candidate'].includes(pin.role))errors.push('invalid_local_pair_role');
  if(pin.workerVersion!=null||pin.configSHA256!=null)errors.push('local_pair_is_not_a_worker');
  if(!hex(pin.localPair?.serverConfigSHA256,64)||!hex(pin.localPair?.datasetSHA256,64))errors.push('local_pair_identity_required');
 }else{
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(pin.workerVersion??''))errors.push('worker_version_required');
  if(!hex(pin.configSHA256,64))errors.push('config_sha_required');
 }
 if(!hex(pin.htmlSHA256,64))errors.push('html_sha_required');
 if(pin.htmlAccept!==undefined&&!['*/*','text/html'].includes(pin.htmlAccept))errors.push('unsupported_html_representation');
 if(!validExternalCodeFiles(pin.externalCodeFiles??[]))errors.push('invalid_external_code_pin');
 try{const u=new URL(pin.origin);if(local){if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||Number(u.port)!==pin.localPair?.port||u.origin!==pin.origin)throw Error();}else if(u.protocol!=='https:'||u.origin!==pin.origin)throw Error();}catch{errors.push(local?'exact_loopback_origin_required':'https_origin_required');}
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
 const recorded={},sources={},conflicts=[];
 for(const key of CONTEXT_KEYS){
  const values=[];
  for(const [name,source] of [['context',b?.context],['top',b],['device',b?.device],['conditions',b?.conditions]]){
   let value=source?.[key];if(key==='dpr'&&value!==null&&typeof value==='object')value=value.applied;
   if(value!=null)values.push({source:name,value});
  }
  sources[key]=values;
  if(values.length){recorded[key]=values[0].value;if(new Set(values.map(v=>JSON.stringify(v.value))).size>1)conflicts.push(key);}
 }
 const missing=CONTEXT_KEYS.filter(k=>recorded[k]==null),mismatches=CONTEXT_KEYS.filter(k=>conflicts.includes(k)||recorded[k]!=null&&(declared?.[k]==null||JSON.stringify(recorded[k])!==JSON.stringify(declared[k])));
 return {recorded,declared,sources,missing,mismatches,conflicts,complete:!missing.length&&!mismatches.length,limitations:[...missing.map(k=>'Baseline artifact did not record '+k+'; declaration is not measurement evidence'),...conflicts.map(k=>'Baseline artifact records conflicting '+k+' values')]};
}
// Small start-tag tokenizer: quotes may contain >; comments and raw-text bodies are not tags.
// No HTML is executed, and no dependency or DOM/browser is needed.
function htmlStartTags(html){
 const tags=[];let cursor=0;
 while(cursor<html.length){
  const start=html.indexOf('<',cursor);if(start<0)break;
  if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);cursor=end<0?html.length:end+3;continue;}
  const name=/^<([a-z][a-z0-9:-]*)\b/i.exec(html.slice(start));if(!name){cursor=start+1;continue;}
  let end=start+name[0].length,quote=null;
  for(;end<html.length;end++){const ch=html[end];if(quote){if(ch===quote)quote=null;}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='>')break;}
  if(end===html.length)throw Error('unsupported_html_tag');
  const attrs={};let at=start+name[0].length;
  while(at<end){
   while(at<end&&/[\s/]/.test(html[at]))at++;if(at>=end)break;
   const first=at;while(at<end&&!/[\s=/>]/.test(html[at]))at++;
   if(at===first)throw Error('unsupported_html_attribute');
   const key=html.slice(first,at).toLowerCase();while(at<end&&/\s/.test(html[at]))at++;let value='';
   if(html[at]==='='){at++;while(at<end&&/\s/.test(html[at]))at++;const q=html[at];
    if(q==='"'||q==="'"){const from=++at;while(at<end&&html[at]!==q)at++;value=html.slice(from,at);at++;}
    else{const from=at;while(at<end&&!/\s/.test(html[at]))at++;value=html.slice(from,at);}
   }
   if(!Object.hasOwn(attrs,key))attrs[key]=value;
  }
  const tag=name[1].toLowerCase();tags.push({name:tag,attrs});cursor=end+1;
  if(['script','style','textarea','title','xmp','iframe','noembed','noframes'].includes(tag)){
   const close=new RegExp('</'+tag+'\\b[^>]*>','ig');close.lastIndex=cursor;const match=close.exec(html);cursor=match?close.lastIndex:html.length;
  }else if(tag==='plaintext')cursor=html.length;
 }
 return tags;
}
function codeAttribute(value){
 const decoded=value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);/gi,(_,name)=>{
  if(name[0]==='#'){const n=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):parseInt(name.slice(1),10);if(n<=0||n>0x10ffff||n>=0xd800&&n<=0xdfff)throw Error('unsupported_html_code_attribute');return String.fromCodePoint(n);}
  return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[name.toLowerCase()];
 });
 if(decoded.includes('&'))throw Error('unsupported_html_code_attribute');return decoded;
}
/** Static code URLs use the first base[href], as the measured document does. */
export function validExternalCodeFiles(files){return Array.isArray(files)&&files.length<=1&&files.every(f=>f&&/^https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\/[a-z0-9]+$/.test(f.url??'')&&/^[a-f0-9]{64}$/.test(f.sha256??'')&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=1024*1024);}
export function externalCodePaths(html,origin,externalCodeFiles=[]){
 if(!validExternalCodeFiles(externalCodeFiles))throw Error('external_code_origin_or_query_not_pinned');
 const paths=new Set(),tags=htmlStartTags(html),firstBase=tags.find(t=>t.name==='base'&&Object.hasOwn(t.attrs,'href'));
 const base=new URL(firstBase?codeAttribute(firstBase.attrs.href):'/',origin+'/');
 if(base.origin!==origin||base.username||base.password)throw Error('external_code_origin_or_query_not_pinned');
 for(const {name,attrs} of tags){
  const rel=(attrs.rel??'').toLowerCase().split(/\s+/),as=(attrs.as??'').toLowerCase();
  const codeLink=rel.includes('stylesheet')||rel.includes('modulepreload')||rel.includes('preload')&&['script','style'].includes(as);
  const href=name==='script'?attrs.src:name==='link'&&codeLink?attrs.href:undefined;if(href===undefined)continue;
  const u=new URL(codeAttribute(href),base);if(u.origin!==origin){if(externalCodeFiles.some(f=>f.url===u.href))continue;throw Error('external_code_origin_or_query_not_pinned');}if(u.username||u.password||u.search)throw Error('external_code_origin_or_query_not_pinned');
  paths.add(decodeURIComponent(u.pathname).replace(/^\//,''));
 }
 return [...paths];
}
