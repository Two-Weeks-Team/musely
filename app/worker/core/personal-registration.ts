// Draft/profile persistence only. No live Trust agent, bearer, delegation, claim, world entry or signing route.
import {generateKeyPair, type KeyPair} from '../../src/identity/jws.ts';
import {jwkThumbprint} from '../../src/identity/fingerprint.ts';
import {encodeAppearance,type AppearanceId} from '../../src/character-kit/appearance.ts';
import type {ActorProfile} from '../../src/identity/participant.ts';
import {PersonalRegistryError, normalizeDraftIntent, normalizePersonalProfile, type PersonalActor, type PersonalStorage} from './personal-owners.ts';
import {PersonalAuthStore, type PersonalSessionRow} from './personal-session.ts';
export type PersonalBinding = {sidDigest: string; proof: PersonalSessionRow; appId: string};
export type ProfilePatch = {expectedRevision: number; displayName: string; appearanceId?: AppearanceId};
const fail = (code: string): never => { throw new PersonalRegistryError(code); };
export class PersonalRegistration {
  private storage: PersonalStorage;
  private auth: PersonalAuthStore;
  private generateRoot: () => Promise<KeyPair>;
  private now: () => number;
  private reservedPrincipal:(principalId:string)=>boolean;
  constructor(storage: PersonalStorage, auth: PersonalAuthStore, options: {generateRoot?: () => Promise<KeyPair>; now?: () => number; reservedPrincipal?:(principalId:string)=>boolean} = {}) {
    this.storage = storage; this.auth = auth; this.generateRoot = options.generateRoot ?? (() => generateKeyPair(true)); this.now = options.now ?? Date.now;this.reservedPrincipal=options.reservedPrincipal??(()=>false);
  }
  init() {
    // Deliberately separate from Trust.private_keys/agents; draft roots grant no existing MCP entitlement.
    this.storage.sql.exec("CREATE TABLE IF NOT EXISTS personal_actor_roots (root_ref TEXT PRIMARY KEY, actor_id TEXT NOT NULL UNIQUE REFERENCES personal_actors(actor_id), agent_id TEXT NOT NULL UNIQUE, public_jwk TEXT NOT NULL, private_jwk TEXT NOT NULL, signer_kind TEXT NOT NULL CHECK(signer_kind='server_custodial'), created_at INTEGER NOT NULL)");
  }
  private guard(b: PersonalBinding) {
    if (!b || !this.auth.active(b.sidDigest, b.proof, b.appId, this.now())) fail('personal_session_required');
  }
  private publicProfile(actor: PersonalActor): ActorProfile {
    const root = this.storage.sql.exec('SELECT actor_id, agent_id FROM personal_actor_roots WHERE root_ref = ?', actor.rootRef).toArray()[0];
    const p = this.auth.owners.profile(actor.actorId);
    if (!root || root.actor_id !== actor.actorId || root.agent_id !== actor.agentId || !p) return fail('registration_incomplete');
    return p;
  }
  profile(b: PersonalBinding): ActorProfile | null {
    this.guard(b);
    const actor = this.auth.owners.actorForPrincipal(b.proof.principalId);
    return actor ? this.publicProfile(actor) : null;
  }
  async register(binding: PersonalBinding, input: unknown): Promise<ActorProfile> {
    const b = {...binding, proof: {...binding.proof}};
    this.guard(b);
    if(this.reservedPrincipal(b.proof.principalId))return fail('actor_exists');
    const intent = normalizeDraftIntent(input), existing = this.auth.owners.draftForIntent(b.proof.principalId, intent);
    if (existing) return this.publicProfile(existing);
    if (this.auth.owners.actorForPrincipal(b.proof.principalId)) return fail('actor_exists');
    // Async WebCrypto stays outside SQL. Losing/failed attempts persist no key material or reference.
    const key = await this.generateRoot();
    const privateJwk = await crypto.subtle.exportKey('jwk', key.privateKey) as JsonWebKey;
    const {kty, crv, x, y} = key.publicJwk;
    const publicJwk = {kty, crv, x, y};
    if (key.kid !== await jwkThumbprint(publicJwk) || privateJwk.x !== x || privateJwk.y !== y || !privateJwk.d) return fail('registration_incomplete');
    const rootRef = 'root_ref:' + crypto.randomUUID();
    return this.storage.transactionSync(() => {
      this.guard(b); // logout/authVersion/expiry during keygen must win before any persistent draft/root.
      if(this.reservedPrincipal(b.proof.principalId))return fail('actor_exists');
      const concurrent = this.auth.owners.draftForIntent(b.proof.principalId, intent);
      if (concurrent) return this.publicProfile(concurrent);
      const actor = this.auth.owners.registerDraft(b.proof.principalId, {...intent, agentId: key.kid, rootRef}, this.now());
      this.storage.sql.exec('INSERT INTO personal_actor_roots (root_ref,actor_id,agent_id,public_jwk,private_jwk,signer_kind,created_at) VALUES (?,?,?,?,?,?,?)', rootRef, actor.actorId, key.kid, JSON.stringify(publicJwk), JSON.stringify(privateJwk), 'server_custodial', this.now());
      return this.publicProfile(actor);
    });
  }
  patch(b: PersonalBinding, input: unknown): ActorProfile {
    this.guard(b);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('invalid_registration');
    const fields = Object.keys(input).sort().join(',');
    if (!['displayName,expectedRevision', 'appearanceId,displayName,expectedRevision'].includes(fields)) return fail('invalid_registration');
    const value = input as ProfilePatch;
    if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) return fail('invalid_registration');
    return this.storage.transactionSync(() => {
      this.guard(b);
      const actor = this.auth.owners.actorForPrincipal(b.proof.principalId);
      if (!actor) return fail('draft_required');
      const current = this.publicProfile(actor);
      const profile = normalizePersonalProfile(value.displayName, Object.hasOwn(value, 'appearanceId') ? value.appearanceId : current.appearanceId);
      if (current.revision !== value.expectedRevision || current.revision >= Number.MAX_SAFE_INTEGER) return fail('revision_conflict');
      this.storage.sql.exec('UPDATE personal_profiles SET display_name = ?, appearance_id = ?, revision = ? WHERE actor_id = ? AND revision = ?', profile.displayName,encodeAppearance(profile.appearanceId),current.revision + 1, actor.actorId, current.revision);
      return this.publicProfile(actor);
    });
  }
}
