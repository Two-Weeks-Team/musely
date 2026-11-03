// Internal-only personal authority. No HTTP, world/Trust wiring, automatic grants, entry or claim verdicts.
import {createOwnershipAdapter, PersonalRegistryError, type PersonalActor, type PersonalStorage} from './personal-owners.ts';
import {PersonalAuthStore} from './personal-session.ts';
import type {PersonalBinding} from './personal-registration.ts';
import {hashAgentKey, looksLikeAgentKey} from './agent-keys.ts';
import {SCOPES} from '../../src/engine/harness.ts';
import {importPrivateJwk, signBytes, verifyBytes} from '../../src/identity/jws.ts';
import {jwkThumbprint, type EcPublicJwk} from '../../src/identity/fingerprint.ts';
import {utf8} from '../../src/identity/jcs.ts';

/** Worker-private. Never include root/principal references in a public profile/response. */
export type PersonalAuthorityView = {actorId: string; agentId: string; rootRef: string; version: number; active: boolean; scopes: string[]};
export type PersonalKeyMetadata = {id: string; actorId: string; signerKind: 'server_custodial'; grantVersion: number; createdAt: number; revokedAt: number | null};
export type PersonalOwnKeySnapshot = {authority: PersonalAuthorityView; key: PersonalKeyMetadata};
export type PersonalKeyIssue = {status: 'issued'; key: string; row: PersonalKeyMetadata} | {status: 'already_issued'; row: PersonalKeyMetadata};
type RootSnapshot = {actorId: string; agentId: string; rootRef: string; publicJwk: string; privateJwk: string};
type Options = {now?: () => number; generateKey?: () => Promise<string>; hashKey?: (key: string) => Promise<string>};
const fail = (code: string): never => { throw new PersonalRegistryError(code); };
const safeVersion = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const reference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) && !v.startsWith('msly_');
const fields = (x: unknown, names: string) => !!x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).sort().join(',') === names;
function explicitScopes(value: unknown): string[] {
  const allowed: readonly string[] = [...SCOPES.allowed, ...SCOPES.approval, 'world_entry'];
  if (!Array.isArray(value) || !value.length || value.length > allowed.length || value.some(x => typeof x !== 'string' || !allowed.includes(x)) || new Set(value).size !== value.length) return fail('invalid_authority');
  return [...value].sort();
}
const randomKey = async () => 'msly_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const copyBinding = (b: PersonalBinding): PersonalBinding => ({sidDigest: b?.sidDigest, appId: b?.appId, proof: {...b?.proof}});
const keyMetadata = (r: Record<string, unknown>): PersonalKeyMetadata => ({id: String(r.id), actorId: String(r.actor_id), signerKind: 'server_custodial', grantVersion: Number(r.grant_version), createdAt: Number(r.created_at), revokedAt: r.revoked_at == null ? null : Number(r.revoked_at)});

export class PersonalAuthority {
  private storage: PersonalStorage;
  private auth: PersonalAuthStore;
  private now: () => number;
  private generateKey: () => Promise<string>;
  private hashKey: (key: string) => Promise<string>;
  constructor(storage: PersonalStorage, auth: PersonalAuthStore, options: Options = {}) {
    this.storage = storage; this.auth = auth; this.now = options.now ?? Date.now;
    this.generateKey = options.generateKey ?? randomKey; this.hashKey = options.hashKey ?? hashAgentKey;
  }
  init() {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_authority (actor_id TEXT PRIMARY KEY REFERENCES personal_actors(actor_id), agent_id TEXT NOT NULL, root_ref TEXT NOT NULL, version INTEGER NOT NULL CHECK(version >= 1), scopes TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)))');
      this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_authority_keys (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES personal_actors(actor_id), agent_id TEXT NOT NULL, root_ref TEXT NOT NULL, grant_version INTEGER NOT NULL, hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, revoked_at INTEGER)');
      this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_authority_key_operations (actor_id TEXT NOT NULL REFERENCES personal_actors(actor_id), operation_id TEXT NOT NULL, payload TEXT NOT NULL, key_id TEXT NOT NULL UNIQUE REFERENCES personal_authority_keys(id), PRIMARY KEY(actor_id,operation_id))');
    });
  }
  resolve(actorId: string) { return createOwnershipAdapter(this.auth.owners).resolve(actorId); }
  private ownActor(b: PersonalBinding): PersonalActor {
    if (!b || !this.auth.active(b.sidDigest, b.proof, b.appId, this.now())) return fail('personal_session_required');
    return this.auth.owners.actorForPrincipal(b.proof.principalId) ?? fail('draft_required');
  }
  private root(actor: PersonalActor): RootSnapshot {
    const r = this.storage.sql.exec('SELECT actor_id,agent_id,public_jwk,private_jwk,signer_kind FROM personal_actor_roots WHERE root_ref = ?', actor.rootRef).toArray()[0];
    if (!r || r.actor_id !== actor.actorId || r.agent_id !== actor.agentId || r.signer_kind !== 'server_custodial') return fail('authority_incomplete');
    return {actorId: actor.actorId, agentId: actor.agentId, rootRef: actor.rootRef, publicJwk: String(r.public_jwk), privateJwk: String(r.private_jwk)};
  }
  /** Imports the 3a actor root only inside this private validator; no global/root/reviewer fallback exists. */
  private async checkedRoot(actor: PersonalActor): Promise<RootSnapshot> {
    const snapshot = this.root(actor);
    try {
      const p = JSON.parse(snapshot.publicJwk) as EcPublicJwk, s = JSON.parse(snapshot.privateJwk) as JsonWebKey;
      if (!p || !s || p.kty !== 'EC' || p.crv !== 'P-256' || typeof p.x !== 'string' || typeof p.y !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(p.x) || !/^[A-Za-z0-9_-]{43}$/.test(p.y) || s.kty !== p.kty || s.crv !== p.crv || s.x !== p.x || s.y !== p.y || typeof s.d !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s.d) || await jwkThumbprint(p) !== actor.agentId) return fail('authority_incomplete');
      const key = await importPrivateJwk(s), bytes = utf8('musely-personal-root-binding-v1');
      if (key.kid !== actor.agentId || !await verifyBytes(p, bytes, await signBytes(key.privateKey, bytes))) return fail('authority_incomplete');
    } catch { return fail('authority_incomplete'); }
    return snapshot;
  }
  private sameRoot(actor: PersonalActor, expected: RootSnapshot) {
    if (JSON.stringify(this.root(actor)) !== JSON.stringify(expected)) fail('authority_changed');
  }
  private view(actor: PersonalActor): PersonalAuthorityView {
    this.root(actor);
    const r = this.storage.sql.exec('SELECT agent_id,root_ref,version,scopes,active FROM personal_authority WHERE actor_id = ?', actor.actorId).toArray()[0];
    if (!r) return {actorId: actor.actorId, agentId: actor.agentId, rootRef: actor.rootRef, version: 0, scopes: [], active: false};
    if (r.agent_id !== actor.agentId || r.root_ref !== actor.rootRef || !safeVersion(Number(r.version)) || Number(r.version) < 1 || ![0, 1].includes(Number(r.active))) return fail('authority_incomplete');
    let scopes: string[];
    try { scopes = explicitScopes(JSON.parse(String(r.scopes))); } catch { return fail('authority_incomplete'); }
    return {actorId: actor.actorId, agentId: actor.agentId, rootRef: actor.rootRef, version: Number(r.version), scopes, active: Number(r.active) === 1};
  }
  async own(binding: PersonalBinding): Promise<PersonalAuthorityView> {
    const b = copyBinding(binding), root = await this.checkedRoot(this.ownActor(b));
    const actor = this.ownActor(b); this.sameRoot(actor, root); return this.view(actor);
  }
  async grant(binding: PersonalBinding, input: unknown): Promise<PersonalAuthorityView> {
    const b = copyBinding(binding);
    if (!fields(input, 'expectedVersion,scopes')) return fail('invalid_authority');
    const x = input as {expectedVersion: number; scopes: unknown}, expected = x.expectedVersion, scopes = explicitScopes(x.scopes);
    if (!safeVersion(expected) || expected >= Number.MAX_SAFE_INTEGER) return fail('invalid_authority');
    const root = await this.checkedRoot(this.ownActor(b));
    return this.storage.transactionSync(() => {
      const actor = this.ownActor(b); this.sameRoot(actor, root); const before = this.view(actor);
      if (before.version !== expected) return fail('authority_conflict');
      this.storage.sql.exec('INSERT INTO personal_authority (actor_id,agent_id,root_ref,version,scopes,active) VALUES (?,?,?,?,?,1) ON CONFLICT(actor_id) DO UPDATE SET version=excluded.version, scopes=excluded.scopes, active=1', actor.actorId, actor.agentId, actor.rootRef, expected + 1, JSON.stringify(scopes));
      return this.view(actor);
    });
  }
  /** Explicit owner action, distinct from browser logout; older version keys can never reactivate. */
  revokeAuthority(binding: PersonalBinding, expectedVersion: number): PersonalAuthorityView {
    if (!safeVersion(expectedVersion) || expectedVersion < 1 || expectedVersion >= Number.MAX_SAFE_INTEGER) return fail('invalid_authority');
    return this.storage.transactionSync(() => {
      const actor = this.ownActor(binding), before = this.view(actor);
      if (before.version !== expectedVersion) return fail('authority_conflict');
      this.storage.sql.exec('UPDATE personal_authority SET version = ?, active = 0 WHERE actor_id = ? AND version = ?', expectedVersion + 1, actor.actorId, expectedVersion);
      return this.view(actor);
    });
  }
  private previous(actor: PersonalActor, operationId: string, payload: string): PersonalKeyMetadata | null {
    const op = this.storage.sql.exec('SELECT payload,key_id FROM personal_authority_key_operations WHERE actor_id = ? AND operation_id = ?', actor.actorId, operationId).toArray()[0];
    if (!op) return null;
    if (op.payload !== payload) return fail('operation_conflict');
    const r = this.storage.sql.exec('SELECT * FROM personal_authority_keys WHERE id = ?', op.key_id).toArray()[0];
    if (!r || r.actor_id !== actor.actorId || r.agent_id !== actor.agentId || r.root_ref !== actor.rootRef) return fail('authority_incomplete');
    return keyMetadata(r);
  }
  async issueKey(binding: PersonalBinding, input: unknown): Promise<PersonalKeyIssue> {
    const b = copyBinding(binding);
    if (!fields(input, 'expectedVersion,operationId')) return fail('invalid_authority');
    const x = input as {operationId: string; expectedVersion: number}, operationId = x.operationId, expected = x.expectedVersion;
    if (!reference(operationId) || !safeVersion(expected) || expected < 1) return fail('invalid_authority');
    const actor = this.ownActor(b), root = await this.checkedRoot(actor), payload = JSON.stringify([expected]);
    const check = () => {
      const current = this.ownActor(b); this.sameRoot(current, root);
      const previous = this.previous(current, operationId, payload);
      if (previous) return {current, previous};
      const v = this.view(current);
      if (!v.active) return fail('authority_required');
      if (v.version !== expected) return fail('authority_conflict');
      return {current, previous: null};
    };
    const existing = check().previous;
    if (existing) return {status: 'already_issued', row: existing};
    let key: string, hash: string;
    try {
      key = await this.generateKey();
      if (!looksLikeAgentKey(key)) return fail('key_generation_failed');
      hash = await this.hashKey(key);
      if (!/^[a-f0-9]{64}$/.test(hash)) return fail('key_generation_failed');
    } catch { return fail('key_generation_failed'); }
    return this.storage.transactionSync(() => {
      const {current, previous} = check(); // logout/revoke/version/root changes during any await win here.
      if (previous) return {status: 'already_issued', row: previous};
      const id = 'pak_' + crypto.randomUUID(), now = this.now();
      this.storage.sql.exec('INSERT INTO personal_authority_keys (id,actor_id,agent_id,root_ref,grant_version,hash,created_at) VALUES (?,?,?,?,?,?,?)', id, current.actorId, current.agentId, current.rootRef, expected, hash, now);
      this.storage.sql.exec('INSERT INTO personal_authority_key_operations (actor_id,operation_id,payload,key_id) VALUES (?,?,?,?)', current.actorId, operationId, payload, id);
      return {status: 'issued', key, row: {id, actorId: current.actorId, signerKind: 'server_custodial', grantVersion: expected, createdAt: now, revokedAt: null}};
    });
  }
  listKeys(binding: PersonalBinding): PersonalKeyMetadata[] {
    const actor = this.ownActor(binding); this.root(actor);
    return this.storage.sql.exec('SELECT id,actor_id,grant_version,created_at,revoked_at FROM personal_authority_keys WHERE actor_id = ? ORDER BY created_at DESC, id', actor.actorId).toArray().map(keyMetadata);
  }
  revokeKey(binding: PersonalBinding, id: string): PersonalKeyMetadata {
    return this.storage.transactionSync(() => {
      const actor = this.ownActor(binding); this.root(actor);
      const row = this.storage.sql.exec('SELECT * FROM personal_authority_keys WHERE id = ? AND actor_id = ?', id, actor.actorId).toArray()[0];
      if (!row) return fail('key_not_found');
      this.storage.sql.exec('UPDATE personal_authority_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', this.now(), id);
      return keyMetadata(this.storage.sql.exec('SELECT * FROM personal_authority_keys WHERE id = ?', id).toArray()[0]);
    });
  }
  /** Synchronous, read-only binding for a caller's SAME SQL transaction (e.g. an entry attempt).
   * Root cryptography is validated before issuance and again in the later async signer/dispatch adapter.
   * This snapshot grants neither actual entry nor a claim, and must not be cached across a commit boundary.
   */
  currentOwnKey(binding: PersonalBinding, keyId: string, scope: string): PersonalOwnKeySnapshot | null {
    const actor = this.ownActor(binding); // Invalid sessions remain an explicit authentication error.
    try {
      const r = this.storage.sql.exec('SELECT * FROM personal_authority_keys WHERE id = ? AND actor_id = ? AND revoked_at IS NULL', keyId, actor.actorId).toArray()[0];
      if (!r || r.agent_id !== actor.agentId || r.root_ref !== actor.rootRef) return null;
      const authority = this.view(actor);
      if (!authority.active || authority.version !== Number(r.grant_version) || !authority.scopes.includes(scope)) return null;
      return {authority, key: keyMetadata(r)};
    } catch { return null; }
  }
  /** Metadata-only future adapter. This does not dispatch MCP, mark presence, sign commands, or enter a world. */
  async authorizeKey(hash: string, scope: string): Promise<PersonalAuthorityView | null> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const read = () => {
      const r = this.storage.sql.exec('SELECT * FROM personal_authority_keys WHERE hash = ? AND revoked_at IS NULL', hash).toArray()[0];
      if (!r) return null;
      const actor = this.auth.owners.actor(String(r.actor_id));
      if (!actor || actor.agentId !== r.agent_id || actor.rootRef !== r.root_ref) return null;
      const v = this.view(actor);
      return v.active && v.version === Number(r.grant_version) && v.scopes.includes(scope) ? {actor, v} : null;
    };
    try {
      const initial = read(); if (!initial) return null;
      const root = await this.checkedRoot(initial.actor), final = read();
      if (!final) return null; this.sameRoot(final.actor, root); return final.v;
    } catch { return null; }
  }
}
