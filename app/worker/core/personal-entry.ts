// Internal owner-side attempt store. No HTTP, key issuance, presence, world activation or receipt writer.
import {PersonalRegistryError, type PersonalActor, type PersonalStorage} from './personal-owners.ts';
import type {PersonalAuthStore} from './personal-session.ts';
import type {PersonalBinding} from './personal-registration.ts';
import type {ActorProfile} from '../../src/identity/participant.ts';
export const ENTRY_ATTEMPT_TTL_MS = 600_000;
// SHA-256('musely-personal-entry-scope-v1:world_entry'); only this explicit entry scope is requested.
export const ENTRY_SCOPE_HASH = '75a27b5c8e0369f8440ce477dec2fe2d0c0bdd6513b605e3fb57e90b8d3ee823';
type Status = 'pending' | 'activated' | 'cancelled' | 'expired';
type Validity = Status | 'profile_changed' | 'key_unavailable' | 'world_changed' | 'paused' | 'receipt_unverified';
/** Structural private Task4 contract; no runtime dependency on its not-yet-integrated module. */
export interface EntryAuthority {
  currentOwnKey(binding: PersonalBinding, keyId: string, scope: string): {authority: {actorId: string; agentId: string; rootRef: string; version: number; active: boolean; scopes: string[]}; key: {id: string; actorId: string; signerKind: 'server_custodial'; grantVersion: number; createdAt: number; revokedAt: number | null}} | null;
}
export type EntryInput = {operationId: string; keyId: string; expectedGrantVersion: number; expectedProfileRevision: number; worldId: string};
/** Owner-only safe metadata, not a public-world projection or bearer credential. */
export type EntryAttempt = {id: string; actorId: string; keyId: string; grantVersion: number; profileRevision: number; worldId: string; scopeHash: string; createdAt: number; expiresAt: number; status: Status; validity: Validity};
/** Task6 MUST verify the actual committed run/input/event/checkpoint before returning this private snapshot. */
export type CommittedEntryReceipt = {id: string; attemptId: string; actorId: string; agentId: string; rootRef: string; keyId: string; grantVersion: number; profileRevision: number; worldId: string; committedAt: number; runId: string; inputSeq: number; eventSeq: number; afterHash: string};
type Reason = 'signed_out' | 'setup_required' | 'waiting_connector' | 'expired' | 'paused' | 'unavailable' | null;
export type EntryProjection = {state: 'viewing' | 'joining' | 'joined' | 'error'; actor: {id: string; displayName: string; appearanceId: ActorProfile['appearanceId']; profileRevision: number} | null; attempt: {id: string; expiresAt: number; status: Status} | null; receipt: {id: string; actorId: string; worldId: string; committedAt: number} | null; reason: Reason};
type Options = {authority: EntryAuthority; currentWorld: (actorId: string) => {worldId: string; paused: boolean}; readReceipt?: (attemptId: string) => CommittedEntryReceipt | null; now?: () => number};
type Row = {id: string; actor_id: string; agent_id: string; root_ref: string; key_id: string; grant_version: number; profile_revision: number; world_id: string; scope_hash: string; created_at: number; expires_at: number; status: Status; operation_id: string; payload: string};
const fail = (code: string): never => {throw new PersonalRegistryError(code);};
const ref = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_:-]{1,128}$/.test(v) && !v.startsWith('msly_');
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const timestamp = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const blank = (reason: Reason, state: EntryProjection['state'] = 'viewing'): EntryProjection => ({state,actor:null,attempt:null,receipt:null,reason});
export class PersonalEntry {
  private readonly now: () => number;
  private storage: PersonalStorage;
  private auth: PersonalAuthStore;
  private options: Options;
  constructor(storage: PersonalStorage, auth: PersonalAuthStore, options: Options) {this.storage=storage;this.auth=auth;this.options=options;this.now = options.now ?? Date.now;}
  private tx<T>(run: () => T): T {
    try {return this.storage.transactionSync(run);} catch (error) {if (error instanceof PersonalRegistryError) throw error; return fail('entry_unavailable');}
  }
  init() {
    this.tx(() => {
      this.storage.sql.exec("CREATE TABLE IF NOT EXISTS personal_entry_attempts (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES personal_actors(actor_id), agent_id TEXT NOT NULL, root_ref TEXT NOT NULL, key_id TEXT NOT NULL, grant_version INTEGER NOT NULL, profile_revision INTEGER NOT NULL, world_id TEXT NOT NULL, scope_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','activated','cancelled','expired')), operation_id TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(actor_id,operation_id))");
      this.storage.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS personal_entry_pending ON personal_entry_attempts(actor_id) WHERE status='pending'");
      this.storage.sql.exec("CREATE INDEX IF NOT EXISTS personal_entry_activated ON personal_entry_attempts(actor_id,created_at DESC) WHERE status='activated'");
    });
  }
  private time() {const now = this.now(); if (!timestamp(now) || now > Number.MAX_SAFE_INTEGER - ENTRY_ATTEMPT_TTL_MS) return fail('entry_unavailable'); return now;}
  private actor(binding: PersonalBinding, now: number): PersonalActor {
    if (!binding || !this.auth.active(binding.sidDigest,binding.proof,binding.appId,now)) return fail('personal_session_required');
    return this.auth.owners.actorForPrincipal(binding.proof.principalId) ?? fail('draft_required');
  }
  private profile(actor: PersonalActor): ActorProfile {
    const p = this.auth.owners.profile(actor.actorId);
    if (!p || p.actorId !== actor.actorId || !positive(p.revision)) return fail('entry_unavailable'); return p;
  }
  private world(actor: PersonalActor) {
    const w = this.options.currentWorld(actor.actorId);
    if (!w || !ref(w.worldId) || typeof w.paused !== 'boolean') return fail('entry_unavailable'); return w;
  }
  private key(binding: PersonalBinding, actor: PersonalActor, id: string, now: number) {
    const s = this.options.authority.currentOwnKey(binding,id,'world_entry');
    if (!s || s.authority.actorId !== actor.actorId || s.authority.agentId !== actor.agentId || s.authority.rootRef !== actor.rootRef || s.authority.active !== true || !positive(s.authority.version) || !Array.isArray(s.authority.scopes) || !s.authority.scopes.includes('world_entry') || s.key.id !== id || s.key.actorId !== actor.actorId || s.key.signerKind !== 'server_custodial' || s.key.revokedAt !== null || s.key.grantVersion !== s.authority.version || !timestamp(s.key.createdAt) || s.key.createdAt > now) return null;
    return s;
  }
  private row(actor: PersonalActor, id: string): Row {
    if (!ref(id)) return fail('invalid_entry');
    const row = this.storage.sql.exec('SELECT * FROM personal_entry_attempts WHERE id = ? AND actor_id = ?',id,actor.actorId).toArray()[0];
    if (!row) return fail('entry_attempt_not_found'); return this.checkedRow(actor,row);
  }
  private checkedRow(actor: PersonalActor, row: Record<string, unknown>): Row {
    if (row.actor_id !== actor.actorId || row.agent_id !== actor.agentId || row.root_ref !== actor.rootRef || !ref(row.id) || !ref(row.key_id) || !ref(row.world_id) || !positive(row.grant_version) || !positive(row.profile_revision) || !timestamp(row.created_at) || !timestamp(row.expires_at) || row.expires_at - row.created_at !== ENTRY_ATTEMPT_TTL_MS || row.scope_hash !== ENTRY_SCOPE_HASH || !['pending','activated','cancelled','expired'].includes(String(row.status))) return fail('entry_unavailable');
    return row as Row;
  }
  private receipt(row: Row, now: number): CommittedEntryReceipt | null {
    if (row.status !== 'activated') return null;
    const r = this.options.readReceipt?.(row.id);
    if (!r || !ref(r.id) || r.attemptId !== row.id || r.actorId !== row.actor_id || r.agentId !== row.agent_id || r.rootRef !== row.root_ref || r.keyId !== row.key_id || r.grantVersion !== row.grant_version || r.profileRevision !== row.profile_revision || r.worldId !== row.world_id || !timestamp(r.committedAt) || r.committedAt < row.created_at || r.committedAt >= row.expires_at || r.committedAt > now || !ref(r.runId) || !positive(r.inputSeq) || !positive(r.eventSeq) || typeof r.afterHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.afterHash)) return null;
    return r;
  }
  private view(binding: PersonalBinding, actor: PersonalActor, row: Row, now: number): EntryAttempt {
    let status = row.status;
    if (status === 'pending' && row.expires_at <= now) status = 'expired';
    let validity: Validity = status;
    if (status === 'pending' || status === 'activated') {
      const world = this.world(actor), key = this.key(binding,actor,row.key_id,now);
      if (world.worldId !== row.world_id) validity = 'world_changed';
      else if (world.paused) validity = 'paused';
      else if (!key || key.authority.version !== row.grant_version) validity = 'key_unavailable';
      else if (status === 'pending' && this.profile(actor).revision !== row.profile_revision) validity = 'profile_changed';
      else if (status === 'activated' && !this.receipt(row,now)) validity = 'receipt_unverified';
    }
    return {id:row.id,actorId:row.actor_id,keyId:row.key_id,grantVersion:row.grant_version,profileRevision:row.profile_revision,worldId:row.world_id,scopeHash:row.scope_hash,createdAt:row.created_at,expiresAt:row.expires_at,status,validity};
  }
  create(binding: PersonalBinding, input: unknown): EntryAttempt {
    return this.tx(() => {
      const now = this.time(), actor = this.actor(binding,now), p = this.profile(actor);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'expectedGrantVersion,expectedProfileRevision,keyId,operationId,worldId') return fail('invalid_entry');
      const v = input as EntryInput;
      if (!ref(v.operationId) || !ref(v.keyId) || !ref(v.worldId) || !positive(v.expectedGrantVersion) || !positive(v.expectedProfileRevision)) return fail('invalid_entry');
      const payload = JSON.stringify([v.keyId,v.expectedGrantVersion,v.expectedProfileRevision,v.worldId,ENTRY_SCOPE_HASH]);
      const old = this.storage.sql.exec('SELECT * FROM personal_entry_attempts WHERE actor_id = ? AND operation_id = ?',actor.actorId,v.operationId).toArray()[0];
      if (old) {if (old.payload !== payload) return fail('operation_conflict'); return this.view(binding,actor,this.checkedRow(actor,old),now);}
      const key = this.key(binding,actor,v.keyId,now), world = this.world(actor);
      if (!key) return fail('entry_key_invalid');
      if (key.authority.version !== v.expectedGrantVersion) return fail('entry_version_conflict');
      if (p.revision !== v.expectedProfileRevision) return fail('entry_profile_conflict');
      if (world.worldId !== v.worldId) return fail('entry_world_conflict');
      if (world.paused) return fail('entry_paused');
      this.storage.sql.exec("UPDATE personal_entry_attempts SET status = CASE WHEN expires_at <= ? THEN 'expired' ELSE 'cancelled' END WHERE actor_id = ? AND status = 'pending'",now,actor.actorId);
      const id = 'pea_' + crypto.randomUUID();
      this.storage.sql.exec("INSERT INTO personal_entry_attempts (id,actor_id,agent_id,root_ref,key_id,grant_version,profile_revision,world_id,scope_hash,created_at,expires_at,status,operation_id,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)",id,actor.actorId,actor.agentId,actor.rootRef,v.keyId,v.expectedGrantVersion,v.expectedProfileRevision,v.worldId,ENTRY_SCOPE_HASH,now,now+ENTRY_ATTEMPT_TTL_MS,v.operationId,payload);
      return this.view(binding,actor,this.row(actor,id),now);
    });
  }
  read(binding: PersonalBinding, id: string): EntryAttempt {return this.tx(() => {const now=this.time(),actor=this.actor(binding,now);return this.view(binding,actor,this.row(actor,id),now);});}
  cancel(binding: PersonalBinding, id: string): EntryAttempt {
    return this.tx(() => {
      const now=this.time(),actor=this.actor(binding,now),row=this.row(actor,id);
      if (row.status === 'activated') return fail('entry_already_activated');
      if (row.status === 'pending') this.storage.sql.exec('UPDATE personal_entry_attempts SET status = ? WHERE id = ?',row.expires_at <= now?'expired':'cancelled',row.id);
      return this.view(binding,actor,this.row(actor,id),now);
    });
  }
  project(binding: PersonalBinding | null): EntryProjection {
    try {return this.tx(() => {
      const now=this.time();
      if (!binding || !this.auth.active(binding.sidDigest,binding.proof,binding.appId,now)) return blank('signed_out');
      const actor=this.auth.owners.actorForPrincipal(binding.proof.principalId);if(!actor)return blank('setup_required');
      const p=this.profile(actor), base: EntryProjection = {...blank('setup_required'),actor:{id:p.actorId,displayName:p.displayName,appearanceId:p.appearanceId,profileRevision:p.revision}};
      const raw=this.storage.sql.exec('SELECT * FROM personal_entry_attempts WHERE actor_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',actor.actorId).toArray()[0];
      if(!raw)return base;
      const row=this.checkedRow(actor,raw),attempt=this.view(binding,actor,row,now);
      base.attempt={id:attempt.id,expiresAt:attempt.expiresAt,status:attempt.status};
      // Historical receipt is retained for this owner even if current authority is no longer valid.
      // Current committed entry is distinct from the latest setup attempt. Only the newest activation
      // can be current: never scan backwards to resurrect an older revoked/superseded entry.
      const activatedRaw=row.status==='activated'?row:this.storage.sql.exec("SELECT * FROM personal_entry_attempts WHERE actor_id = ? AND status = 'activated' ORDER BY created_at DESC, rowid DESC LIMIT 1",actor.actorId).toArray()[0];
      const activated=activatedRaw?this.checkedRow(actor,activatedRaw):null;
      const current=activated?this.view(binding,actor,activated,now):null;
      const receipt=activated?this.receipt(activated,now):null;if(receipt)base.receipt={id:receipt.id,actorId:receipt.actorId,worldId:receipt.worldId,committedAt:receipt.committedAt};
      if(current?.validity==='activated'&&receipt){base.state='joined';base.reason=null;}
      else if(attempt.validity==='pending'){base.state='joining';base.reason='waiting_connector';}
      else if(attempt.validity==='expired')base.reason='expired';
      else if(attempt.validity==='paused')base.reason='paused';
      else if(attempt.validity!=='cancelled'){base.state='error';base.reason='unavailable';}
      return base;
    });}catch{return blank('unavailable','error');}
  }
}
