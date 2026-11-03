// An explicit current public name for the existing legacy owner actor. No principal adoption or authority writes.
import type {ActorProfile} from '../../src/identity/participant.ts';
import {normalizePersonalProfile, type PersonalStorage} from './personal-owners.ts';
import {PRINCIPALS, type OwnerSession} from './owner-session.ts';
import type {WorldRuntime} from './world-runtime.ts';

export type LegacyOwnerProof = Pick<OwnerSession, 'principal' | 'ownerId' | 'exp'>;
export class LegacyProfileError extends Error {
  readonly code: 'owner_session_required' | 'not_your_muse' | 'invalid_profile' | 'profile_conflict' | 'profile_unavailable';
  constructor(code: LegacyProfileError['code']) { super(code); this.code=code; this.name = 'LegacyProfileError'; }
}
const fail = (code: ConstructorParameters<typeof LegacyProfileError>[0]): never => { throw new LegacyProfileError(code); };
const ACTOR = '00-jolly';
export class LegacyProfile {
  private storage:PersonalStorage; private runtime:WorldRuntime; private now:()=>number;
  constructor(storage:PersonalStorage,runtime:WorldRuntime,now=Date.now){this.storage=storage;this.runtime=runtime;this.now=now;}
  init() { this.storage.sql.exec("CREATE TABLE IF NOT EXISTS legacy_public_profiles (actor_id TEXT PRIMARY KEY CHECK(actor_id='00-jolly'), display_name TEXT NOT NULL, appearance_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1))"); }
  private guard(owner: LegacyOwnerProof) {
    if (!owner || typeof owner.exp !== 'number' || !Number.isFinite(owner.exp) || owner.exp <= this.now()) return fail('owner_session_required');
    if (owner.principal !== 'owner' || owner.ownerId !== PRINCIPALS.owner.ownerId) return fail('not_your_muse');
  }
  private current(): ActorProfile {
    const r = this.storage.sql.exec('SELECT display_name,appearance_id,revision FROM legacy_public_profiles WHERE actor_id=?', ACTOR).toArray()[0];
    if (!r) return {actorId: ACTOR, displayName: 'Jolly', appearanceId: '00-jolly', revision: 0};
    if (!Number.isSafeInteger(r.revision) || Number(r.revision) < 1) return fail('profile_unavailable');
    try { return {actorId: ACTOR, ...normalizePersonalProfile(r.display_name, r.appearance_id), revision: Number(r.revision)}; } catch { return fail('profile_unavailable'); }
  }
  get(owner: LegacyOwnerProof): ActorProfile { this.guard(owner); return this.current(); }
  patch(owner: LegacyOwnerProof, input: unknown): ActorProfile {
    this.guard(owner);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'appearanceId,displayName,expectedRevision') return fail('invalid_profile');
    const x = input as {expectedRevision: number; displayName: unknown; appearanceId: unknown};
    if (!Number.isSafeInteger(x.expectedRevision) || x.expectedRevision < 0 || x.expectedRevision >= Number.MAX_SAFE_INTEGER) return fail('invalid_profile');
    let values: ReturnType<typeof normalizePersonalProfile>;
    try { values = normalizePersonalProfile(x.displayName, x.appearanceId); } catch { return fail('invalid_profile'); }
    return this.storage.transactionSync(() => {
      this.guard(owner);
      const before = this.current();
      if (before.revision !== x.expectedRevision) return fail('profile_conflict');
      const profile: ActorProfile = {actorId: ACTOR, ...values, revision: before.revision + 1};
      this.storage.sql.exec('INSERT INTO legacy_public_profiles (actor_id,display_name,appearance_id,revision) VALUES (?,?,?,?) ON CONFLICT(actor_id) DO UPDATE SET display_name=excluded.display_name,appearance_id=excluded.appearance_id,revision=excluded.revision', ACTOR, profile.displayName, profile.appearanceId, profile.revision);
      const at = this.now();
      this.runtime.commitExternal(at, 'legacy-profile-' + profile.revision, (s, emit) => {
        const muse = s.muses.find(m => m.id === ACTOR);
        if (!muse) return fail('profile_unavailable');
        muse.profile = profile;
        emit({at, source: 'live', kind: 'legacy_profile_updated', muse: ACTOR, data: {actor: 'owner', profile}, tags: []});
      });
      return profile;
    });
  }
}
