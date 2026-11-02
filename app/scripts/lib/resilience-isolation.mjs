import {sha256} from './resilience-io.mjs';
export const FAULT_MODES=['429','503','timeout','bad-output','healthy'];
const isolatedOrigin=value=>{const u=new URL(value);if(u.protocol!=='https:' || !u.hostname.endsWith('.workers.dev') || !u.hostname.startsWith('musely-d03-') || u.username || u.password || u.search || u.hash || u.pathname!=='/')throw Error('Use a dedicated musely-d03-*.workers.dev origin');return u.origin;};
/** Same product source/assets; every configuration delta is explicit and isolated. No secret values are accepted. */
export function isolationConfig(original,{name,origin,faultOrigin,mode,app,cap=0.05,accountSubdomain}) {
  if(!/^musely-d03-[a-z0-9-]+$/.test(name??'') || !FAULT_MODES.includes(mode) || !(cap>0 && cap<=1) || !app?.startsWith('/'))throw Error('Invalid isolated test identity/mode/cap/app');
  origin=isolatedOrigin(origin);faultOrigin=isolatedOrigin(faultOrigin);
  const productHost=new URL(origin).hostname,stubHost=new URL(faultOrigin).hostname;
  if(!/^[a-z0-9-]+$/.test(accountSubdomain??'') || productHost!==`${name}.${accountSubdomain}.workers.dev` || !stubHost.endsWith(`.${accountSubdomain}.workers.dev`) || stubHost.split('.').length!==4)throw Error('Both origins must use the attested account subdomain');
  if(productHost.split('.')[0]===stubHost.split('.')[0])throw Error('Product and stub must have distinct Worker names');
  const c=structuredClone(original);
  if(c.durable_objects.bindings.some(b=>b.script_name))throw Error('Cross-script DO bindings are not allowed');
  const namespace=String(parseInt(sha256(name).slice(0,8),16));
  if(c.ratelimits.some(r=>r.namespace_id===namespace))throw Error('Rate namespace collision');
  return {$schema:app+'/node_modules/wrangler/config-schema.json',name,account_id:c.account_id,compatibility_date:c.compatibility_date,main:app+'/.wrangler/dry-run/index.js',no_bundle:true,workers_dev:true,preview_urls:false,routes:[],assets:{...c.assets,directory:app+'/dist'},durable_objects:c.durable_objects,migrations:c.migrations,ratelimits:c.ratelimits.map(r=>({...r,namespace_id:namespace})),vars:{MODEL_ID:c.vars.MODEL_ID,MODEL_BASE:faultOrigin+'/'+mode,DAILY_BUDGET_USD:String(cap),TURNSTILE_SITEKEY:'',ALLOWED_HOSTS:new URL(origin).hostname,PUBLIC_ORIGIN:origin},observability:{enabled:false}};
}
