import {JUDGE_MUSE} from '../../src/engine/judge-muse.ts';
// Private registry behind verified personal routes; no agent credentials or world entry are issued here.
// ensurePrincipal requires an already-verified provider subject from its future trusted auth caller.
// registerDraft accepts server-provisioned agent/root references, never private key material or a claim verdict.
import type {Sql} from './ledger.ts';
import {PRINCIPALS} from './owner-session.ts';
import {HARNESS_IDS} from '../../src/engine/harness.ts';
import {normalizeAppearance,encodeAppearance,decodeAppearance,appearanceKey,type AppearanceId} from '../../src/character-kit/appearance.ts';
import type {ActorProfile} from '../../src/identity/participant.ts';

export type PersonalStorage = {sql: Sql; transactionSync<T>(fn: () => T): T};
/** Private registry row, not a browser/public response. Provider subjects are deliberately not display names. */
export type PersonalPrincipal = {id: string; provider: string; subject: string; authVersion: number; createdAt: number};
export type PersonalActor = {actorId: string; principalId: string; agentId: string; rootRef: string; controlMode: 'personal'; status: 'draft'; createdAt: number};
export type DraftRegistration = {operationId: string; displayName: string; appearanceId: AppearanceId; agentId: string; rootRef: string};
export type Ownership =
  | {kind: 'personal'; actorId: string; principalId: string; ownerId: string}
  | {kind: 'legacy'; actorId: string; principalId: string; ownerId: string}
  | {kind: 'resident'; actorId: string}
  | {kind: 'unknown'; actorId: string};
export class PersonalRegistryError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'PersonalRegistryError'; this.code = code; }
}
const fail = (code: string): never => { throw new PersonalRegistryError(code); };
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
const principalRow = (r: Record<string, unknown>): PersonalPrincipal => ({id: String(r.id), provider: String(r.provider), subject: String(r.subject), authVersion: Number(r.auth_version), createdAt: Number(r.created_at)});
const actorRow = (r: Record<string, unknown>): PersonalActor => ({actorId: String(r.actor_id), principalId: String(r.principal_id), agentId: String(r.agent_id), rootRef: String(r.root_ref), controlMode: 'personal', status: 'draft', createdAt: Number(r.created_at)});
const principalColumns = 'id, provider, subject, auth_version, created_at';
const actorColumns = 'actor_id, principal_id, agent_id, root_ref, created_at';
const validReference = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s) && !s.startsWith('msly_');

function registration(input: DraftRegistration): DraftRegistration & {appearanceId: AppearanceId} {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'agentId,appearanceId,displayName,operationId,rootRef') return fail('invalid_registration');
  const {operationId, displayName, appearanceId, agentId, rootRef} = input;
  if (!validReference(operationId) || typeof displayName !== 'string' || !validReference(agentId) || typeof rootRef !== 'string' || !/^root_ref:[A-Za-z0-9_-]{1,96}$/.test(rootRef)) return fail('invalid_registration');
  return {operationId, ...normalizePersonalProfile(displayName, appearanceId), agentId, rootRef};
}

export type DraftIntent = {operationId: string; displayName: string; appearanceId: AppearanceId};
/** Names stay literal public text; consumers must render with textContent, never HTML. */
export function normalizePersonalProfile(displayName: unknown, appearanceId: unknown): {displayName: string; appearanceId: AppearanceId} {
  if (typeof displayName !== 'string') return fail('invalid_registration');
  const name = displayName.trim();
  if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(displayName)) return fail('invalid_registration');
  let appearance:AppearanceId;try{appearance=normalizeAppearance(appearanceId);}catch{return fail('invalid_registration');}
  return {displayName:name,appearanceId:appearance};
}
export function normalizeDraftIntent(input: unknown): DraftIntent {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'appearanceId,displayName,operationId') return fail('invalid_registration');
  const x = input as DraftIntent;
  if (!validReference(x.operationId)) return fail('invalid_registration');
  return {operationId: x.operationId, ...normalizePersonalProfile(x.displayName, x.appearanceId)};
}

export class PersonalOwners {
  private storage: PersonalStorage;
  constructor(storage: PersonalStorage) { this.storage = storage; }
  /** Additive, restart-idempotent tables only. Legacy world, keys, roots, claims and run records are untouched. */
  init() {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_principals (id TEXT PRIMARY KEY, provider TEXT NOT NULL, subject TEXT NOT NULL, auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version >= 1), created_at INTEGER NOT NULL, UNIQUE(provider, subject))');
      this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_actors (actor_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL UNIQUE REFERENCES personal_principals(id), agent_id TEXT NOT NULL UNIQUE, root_ref TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)');
      this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_profiles (actor_id TEXT PRIMARY KEY REFERENCES personal_actors(actor_id), display_name TEXT NOT NULL, appearance_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1))');
      this.storage.sql.exec('CREATE TABLE IF NOT EXISTS personal_registrations (principal_id TEXT NOT NULL REFERENCES personal_principals(id), operation_id TEXT NOT NULL, payload TEXT NOT NULL, actor_id TEXT NOT NULL UNIQUE REFERENCES personal_actors(actor_id), PRIMARY KEY(principal_id, operation_id))');
    });
  }
  principal(id: string): PersonalPrincipal | null {
    const row = this.storage.sql.exec(`SELECT ${principalColumns} FROM personal_principals WHERE id = ?`, id).toArray()[0];
    return row ? principalRow(row) : null;
  }
  ensurePrincipal(identity: {provider: string; subject: string}, now = Date.now()): PersonalPrincipal {
    if (!identity || typeof identity.provider !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(identity.provider) || typeof identity.subject !== 'string' || !identity.subject || identity.subject.length > 256 || identity.subject.trim() !== identity.subject || /[\u0000-\u001f\u007f]/u.test(identity.subject) || !time(now)) return fail('invalid_identity');
    return this.storage.transactionSync(() => {
      const found = this.storage.sql.exec(`SELECT ${principalColumns} FROM personal_principals WHERE provider = ? AND subject = ?`, identity.provider, identity.subject).toArray()[0];
      if (found) return principalRow(found);
      const id = 'pp_' + crypto.randomUUID();
      this.storage.sql.exec('INSERT INTO personal_principals (id, provider, subject, created_at) VALUES (?, ?, ?, ?)', id, identity.provider, identity.subject, now);
      return this.principal(id)!;
    });
  }
  /** Version change invalidates future session proofs; it must never remove the actor's durable ownership. */
  advanceAuthVersion(principalId: string, expected: number): PersonalPrincipal {
    return this.storage.transactionSync(() => {
      const row = this.principal(principalId);
      if (!row) return fail('unknown_principal');
      if (!Number.isSafeInteger(expected) || row.authVersion !== expected) return fail('auth_version_conflict');
      if (expected >= Number.MAX_SAFE_INTEGER) return fail('auth_version_exhausted');
      this.storage.sql.exec('UPDATE personal_principals SET auth_version = ? WHERE id = ? AND auth_version = ?', expected + 1, principalId, expected);
      return this.principal(principalId)!;
    });
  }
  actor(actorId: string): PersonalActor | null {
    const row = this.storage.sql.exec(`SELECT ${actorColumns} FROM personal_actors WHERE actor_id = ?`, actorId).toArray()[0];
    return row ? actorRow(row) : null;
  }
  actorForPrincipal(principalId: string): PersonalActor | null {
    const row = this.storage.sql.exec(`SELECT ${actorColumns} FROM personal_actors WHERE principal_id = ?`, principalId).toArray()[0];
    return row ? actorRow(row) : null;
  }
  /** Explicit public projection: no spreading private principal/actor rows into a response. */
  profile(actorId: string): ActorProfile | null {
    const row = this.storage.sql.exec('SELECT actor_id, display_name, appearance_id, revision FROM personal_profiles WHERE actor_id = ?', actorId).toArray()[0];
    return row ? {actorId: String(row.actor_id), displayName: String(row.display_name), appearanceId:decodeAppearance(String(row.appearance_id)), revision: Number(row.revision)} : null;
  }
  /** API intent idempotence ignores fresh server-generated refs, but verifies the persisted result binding. */
  draftForIntent(principalId: string, input: DraftIntent): PersonalActor | null {
    const value = normalizeDraftIntent(input);
    const r = this.storage.sql.exec('SELECT payload, actor_id FROM personal_registrations WHERE principal_id = ? AND operation_id = ?', principalId, value.operationId).toArray()[0];
    if (!r) return null;
    let payload: unknown;
    try { payload = JSON.parse(String(r.payload)); } catch { return fail('registration_incomplete'); }
    if (!Array.isArray(payload) || payload.length !== 4) return fail('registration_incomplete');
    let sameAppearance=false;try{sameAppearance=appearanceKey(payload[1])===appearanceKey(value.appearanceId);}catch{return fail('registration_incomplete');}
    if (payload[0] !== value.displayName || !sameAppearance) return fail('operation_conflict');
    const actor = this.actor(String(r.actor_id));
    if (!actor || actor.principalId !== principalId || actor.agentId !== payload[2] || actor.rootRef !== payload[3]) return fail('registration_incomplete');
    return actor;
  }
  registerDraft(principalId: string, input: DraftRegistration, now = Date.now()): PersonalActor {
    const value = registration(input);
    if (!time(now)) return fail('invalid_registration');
    // Normalize only public-name whitespace; property ordering and timestamps cannot change an operation's identity.
    const payload = JSON.stringify([value.displayName, value.appearanceId, value.agentId, value.rootRef]);
    return this.storage.transactionSync(() => {
      if (!this.principal(principalId)) return fail('unknown_principal');
      const previous = this.storage.sql.exec('SELECT payload, actor_id FROM personal_registrations WHERE principal_id = ? AND operation_id = ?', principalId, value.operationId).toArray()[0];
      if (previous) {
        if (previous.payload !== payload) return fail('operation_conflict');
        return this.actor(String(previous.actor_id)) ?? fail('registration_incomplete');
      }
      if (this.actorForPrincipal(principalId)) return fail('actor_exists');
      if (this.storage.sql.exec('SELECT actor_id FROM personal_actors WHERE agent_id = ? OR root_ref = ?', value.agentId, value.rootRef).toArray().length) return fail('binding_conflict');
      const actorId = 'pm_' + crypto.randomUUID();
      this.storage.sql.exec('INSERT INTO personal_actors (actor_id, principal_id, agent_id, root_ref, created_at) VALUES (?, ?, ?, ?, ?)', actorId, principalId, value.agentId, value.rootRef, now);
      this.storage.sql.exec('INSERT INTO personal_profiles (actor_id, display_name, appearance_id, revision) VALUES (?, ?, ?, 1)', actorId,value.displayName,encodeAppearance(value.appearanceId));
      this.storage.sql.exec('INSERT INTO personal_registrations (principal_id, operation_id, payload, actor_id) VALUES (?, ?, ?, ?)', principalId, value.operationId, payload, actorId);
      return this.actor(actorId)!;
    });
  }
}

/** Pure ownership lookup, NOT session/key authentication. Known residents and unknown actors stay distinct. */
export function createOwnershipAdapter(owners: PersonalOwners) {
  const resolve = (actorId: string): Ownership => {
    const actor = owners.actor(actorId);
    if (actor) return {kind: 'personal', actorId, principalId: actor.principalId, ownerId: actor.principalId};
    if(actorId===JUDGE_MUSE.id)return {kind:'resident',actorId};
    const legacy = Object.values(PRINCIPALS).find(p => p.muses.includes(actorId));
    if (legacy) return {kind: 'legacy', actorId, principalId: legacy.id, ownerId: legacy.ownerId};
    return HARNESS_IDS.includes(actorId) ? {kind: 'resident', actorId} : {kind: 'unknown', actorId};
  };
  return {
    resolve,
    /** Unknown is an error rather than null: null means a positively known resident only. */
    ownerOf(actorId: string): string | null {
      const result = resolve(actorId);
      if (result.kind === 'unknown') return fail('unknown_actor');
      return result.kind === 'resident' ? null : result.ownerId;
    },
    owns(principalId: string, actorId: string): boolean {
      const result = resolve(actorId);
      return (result.kind === 'personal' || result.kind === 'legacy') && result.principalId === principalId;
    },
  };
}
