// Private, best-effort diagnostics only. No storage, authorization, commands or public response changes.
import {OWNER_MUSE} from '../../src/engine/world.ts';
import {TOOLS} from './mcp-tools.ts';
import type {AgentKeyRow} from './agent-keys.ts';
export const MCP_FRESHNESS_PREFIX='musely_mcp_freshness';
const TTL_MS=15*60_000,CAPACITY=32;
const WRITES=new Set(TOOLS.filter(t=>t.write).map(t=>t.name));
type Stamp={at:number;version:number;seenAt:number};
type Reads={world:Stamp|null;heartbeat:Stamp|null};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const publicStamp=(s:Stamp|null)=>s?{at:s.at,version:s.version}:null;
export class McpFreshness {
 private readonly reads=new Map<string,Reads>();
 private readonly logger:(prefix:string,json:string)=>void;
 private readonly instanceId:string;
 constructor(options:{logger?:(prefix:string,json:string)=>void}={}){
  this.logger=options.logger??((prefix,json)=>console.info(prefix,json));
  try{this.instanceId=crypto.randomUUID();}catch{this.instanceId='diagnostic-id-unavailable';}
 }
 private prune(at:number){
  for(const [id,r]of this.reads){for(const k of['world','heartbeat'] as const){const s=r[k];if(s&&(at<s.seenAt||at-s.seenAt>=TTL_MS))r[k]=null;}if(!r.world&&!r.heartbeat)this.reads.delete(id);}
 }
 /** Only server-created result metadata is read. Raw args, bodies, keys and error text never enter this class. */
 observe(key:Pick<AgentKeyRow,'id'|'muse'>,method:string,tool:string,result:unknown,at:number):void {
  try{
   if(key.muse!==OWNER_MUSE||!/^ak_[A-Za-z0-9_-]{1,80}$/.test(key.id)||method!=='tools/call'||!number(at)||!object(result)||!object(result.structuredContent))return;
   if(tool!=='get_world_state'&&tool!=='heartbeat_check'&&!WRITES.has(tool))return;
   this.prune(at);const content=result.structuredContent;
   if(tool==='get_world_state'||tool==='heartbeat_check'){
    const version=content.world_version,observed=content.observed_at;if(!number(version)||!number(observed))return;
    const r=this.reads.get(key.id)??{world:null,heartbeat:null};r[tool==='get_world_state'?'world':'heartbeat']={at:observed,version,seenAt:at};
    this.reads.delete(key.id);this.reads.set(key.id,r);while(this.reads.size>CAPACITY)this.reads.delete(this.reads.keys().next().value!);return;
   }
   // A signed result has its command receipt. Validation/dispatch errors without one produce no diagnostic.
   const command=content.command;if(!object(command))return;const version=command.world_version;if(!number(version))return;
   const expected=command.expected_version,refused=content.refused,r=this.reads.get(key.id)??{world:null,heartbeat:null};
   const line={schema:'musely-mcp-freshness-v1',instance_id:this.instanceId,at,tool,key_id:key.id,muse:OWNER_MUSE,expected_version:number(expected)?expected:null,result_version:version,refusal:refused==='stale_world'?'stale_world':typeof refused==='string'?'other_refusal':null,last_world_read:publicStamp(r.world),last_heartbeat:publicStamp(r.heartbeat),
    // Age of the last get_world_state's server-returned observed_at, not client/cache receipt time.
    read_age_ms:r.world&&at>=r.world.at?at-r.world.at:null};
   this.logger(MCP_FRESHNESS_PREFIX,JSON.stringify(line));
  }catch{/* Diagnostic failures must never change a product result or trigger another action. */}
 }
}
