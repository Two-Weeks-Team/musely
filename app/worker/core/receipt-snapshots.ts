// Receipt-only public evidence, separate from the bounded general replay archive. No retention/deletion here.
// Each body is bounded to MAX_REPLAY_SNAPSHOT_BYTES; there is no claimed aggregate receipt storage bound.
import type {Sql} from './ledger.ts';
import type {WorldState} from '../../src/engine/world.ts';
import {MAX_REPLAY_SNAPSHOT_BYTES} from '../../src/replay/versions.ts';
import {snapshotBody,bodyHash} from './run-log.ts';
import {normalizePersonalProfile} from './personal-owners.ts';
export type ReceiptSnapshotBinding={kind:'personal_entry'|'legacy_adoption';actorId:string;worldId:string;runId:string;inputSeq:number;eventId:string;afterHash:string};
type Code='receipt_snapshot_invalid'|'receipt_snapshot_conflict'|'receipt_snapshot_unavailable';
export class ReceiptSnapshotError extends Error{readonly code:Code;constructor(code:Code){super(code);this.code=code;this.name='ReceiptSnapshotError';}}
const fail=(code:Code):never=>{throw new ReceiptSnapshotError(code);};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ref=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max&&/^[A-Za-z0-9_.:/-]+$/.test(v);
const valid=(b:ReceiptSnapshotBinding)=>object(b)&&Object.keys(b).sort().join(',')==='actorId,afterHash,eventId,inputSeq,kind,runId,worldId'&&['personal_entry','legacy_adoption'].includes(b.kind)&&ref(b.actorId,128)&&ref(b.worldId,128)&&ref(b.runId,128)&&ref(b.eventId,512)&&typeof b.inputSeq==='number'&&Number.isSafeInteger(b.inputSeq)&&b.inputSeq>0&&typeof b.afterHash==='string'&&/^[a-f0-9]{64}$/.test(b.afterHash);
const columns='kind,actor_id,world_id,run_id,input_seq,event_id,after_hash,body';
export class ReceiptSnapshots{
 private sql:Sql;
 constructor(sql:Sql){this.sql=sql;}
 init(){try{this.sql.exec('CREATE TABLE IF NOT EXISTS receipt_snapshots (event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, actor_id TEXT NOT NULL, world_id TEXT NOT NULL, run_id TEXT NOT NULL, input_seq INTEGER NOT NULL, after_hash TEXT NOT NULL, body TEXT NOT NULL)');}catch{return fail('receipt_snapshot_unavailable');}}
 private matches(row:Record<string,unknown>,b:ReceiptSnapshotBinding){return row.kind===b.kind&&row.actor_id===b.actorId&&row.world_id===b.worldId&&row.run_id===b.runId&&row.input_seq===b.inputSeq&&row.event_id===b.eventId&&row.after_hash===b.afterHash;}
 private checked(body:unknown,b:ReceiptSnapshotBinding):body is string{
  try{
   if(typeof body!=='string'||new TextEncoder().encode(body).byteLength>MAX_REPLAY_SNAPSHOT_BYTES||bodyHash(body)!==b.afterHash)return false;
   const s=JSON.parse(body);if(!object(s)||s.worldId!==b.worldId||!Array.isArray(s.muses))return false;
   const members=s.muses.filter(m=>object(m)&&m.id===b.actorId);if(members.length!==1||!object(members[0].profile))return false;
   const p=members[0].profile;if(Object.keys(p).sort().join(',')!=='actorId,appearanceId,displayName,revision'||p.actorId!==b.actorId||typeof p.revision!=='number'||!Number.isSafeInteger(p.revision)||p.revision<1)return false;
   const n=normalizePersonalProfile(p.displayName,p.appearanceId);return n.displayName===p.displayName;
  }catch{return false;}
 }
 /** Caller holds the authenticated world commit transaction; this method never starts or commits another. */
 put(binding:ReceiptSnapshotBinding,state:WorldState):string{
  if(!valid(binding))return fail('receipt_snapshot_invalid');
  let body:string;try{body=snapshotBody(state);}catch{return fail('receipt_snapshot_invalid');}
  if(!this.checked(body,binding))return fail('receipt_snapshot_invalid');
  try{
   const row=this.sql.exec(`SELECT ${columns} FROM receipt_snapshots WHERE event_id=?`,binding.eventId).toArray()[0];
   if(row){if(!this.matches(row,binding)||row.body!==body)return fail('receipt_snapshot_conflict');return body;}
   this.sql.exec('INSERT INTO receipt_snapshots (kind,actor_id,world_id,run_id,input_seq,event_id,after_hash,body) VALUES (?,?,?,?,?,?,?,?)',binding.kind,binding.actorId,binding.worldId,binding.runId,binding.inputSeq,binding.eventId,binding.afterHash,body);
   return body;
  }catch(e){if(e instanceof ReceiptSnapshotError)throw e;return fail('receipt_snapshot_unavailable');}
 }
 read(binding:ReceiptSnapshotBinding):string|null{
  if(!valid(binding))return null;
  try{const row=this.sql.exec(`SELECT ${columns} FROM receipt_snapshots WHERE event_id=?`,binding.eventId).toArray()[0];return row&&this.matches(row,binding)&&this.checked(row.body,binding)?row.body:null;}catch{return null;}
 }
}
