// Trust registry and executor keys inside the world Durable Object (direction v2, 6 and 12.1).
// Private keys never leave this object: system resident roots and every executor key live in SQLite;
// the owner's root comes from the OWNER_ROOT_JWK secret. Methods used by verifyEnvelope are synchronous
// so a nonce check-and-set cannot interleave with another request.
import type {Sql} from './ledger.ts';
import type {TrustRegistry} from '../../src/identity/envelope.ts';
import {generateKeyPair, importPrivateJwk, type KeyPair} from '../../src/identity/jws.ts';
import {issueDelegation, delegationRef, peekDelegation, type Delegation, type SignerKind} from '../../src/identity/delegation.ts';
import {buildCard, signCard, type AgentCard} from '../../src/identity/card.ts';
import type {EcPublicJwk} from '../../src/identity/fingerprint.ts';
import {HARNESSES, harnessById, SCOPES} from '../../src/engine/harness.ts';

export const OWNER_SLOT = '00-jolly';
const SCOPE_SUMMARY = {allowed: [...SCOPES.allowed], approval: [...SCOPES.approval], forbidden: [...SCOPES.forbidden]};
export type AgentRow = {agentId: string; museId: string; rootJwk: EcPublicJwk; kind: 'owner' | 'resident'; label: string};
export type Executor = {key: KeyPair; delegation: string; d: Delegation};

export class DelegationRevoked extends Error {
  constructor(museId: string) { super(`Delegation for ${museId} is revoked; the owner must delegate again`); }
}

export class Trust implements TrustRegistry {
  private sql: Sql;
  constructor(sql: Sql) { this.sql = sql; }

  init() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS agents (agent_id TEXT PRIMARY KEY, muse_id TEXT UNIQUE NOT NULL, root_jwk TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS private_keys (kid TEXT PRIMARY KEY, jwk TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS delegation_versions (agent_id TEXT PRIMARY KEY, version INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS executors (agent_id TEXT NOT NULL, signer_kind TEXT NOT NULL, kid TEXT NOT NULL, delegation TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY (agent_id, signer_kind))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS revoked (ref TEXT PRIMARY KEY, at INTEGER NOT NULL)');
    // The version the owner last delegated. Below the current version = revoked and not yet re-delegated.
    // Kept per agent, independent of executor rows, so a revocation holds even before any executor exists.
    this.sql.exec('CREATE TABLE IF NOT EXISTS delegated (agent_id TEXT PRIMARY KEY, version INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS nonces (key TEXT PRIMARY KEY, exp INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS approvals (ref TEXT PRIMARY KEY, content_hash TEXT NOT NULL, agent_id TEXT NOT NULL, at INTEGER NOT NULL)');
  }

  /** Creates resident roots once and registers the owner root from the secret. Idempotent. */
  async ensureAgents(ownerRootJwk: JsonWebKey | null) {
    for (const h of HARNESSES) {
      if (h.id === OWNER_SLOT && ownerRootJwk) continue;
      if (this.agentByMuse(h.id)) continue;
      const root = await generateKeyPair(true);
      this.sql.exec('INSERT OR REPLACE INTO private_keys (kid, jwk) VALUES (?, ?)', root.kid, JSON.stringify(await crypto.subtle.exportKey('jwk', root.privateKey) as JsonWebKey));
      this.sql.exec('INSERT INTO agents (agent_id, muse_id, root_jwk, kind, label) VALUES (?, ?, ?, ?, ?)', root.kid, h.id, JSON.stringify(root.publicJwk), 'resident', `${h.name} (Musely resident)`);
    }
    if (ownerRootJwk) {
      const owner = await importPrivateJwk(ownerRootJwk);
      const existing = this.agentByMuse(OWNER_SLOT);
      if (!existing || existing.agentId !== owner.kid) {
        // A new owner root (new kid) takes over the Muse's delegation state: a revoked Muse stays revoked across the swap.
        const carried = existing ? {version: this.delegationVersion(existing.agentId), delegated: this.delegatedVersion(existing.agentId)} : null;
        this.sql.exec('DELETE FROM agents WHERE muse_id = ?', OWNER_SLOT);
        this.sql.exec('INSERT INTO agents (agent_id, muse_id, root_jwk, kind, label) VALUES (?, ?, ?, ?, ?)', owner.kid, OWNER_SLOT, JSON.stringify(owner.publicJwk), 'owner', "Kim Sejun's Muse");
        if (carried) {
          this.sql.exec('INSERT INTO delegation_versions (agent_id, version) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET version = MAX(delegation_versions.version, excluded.version)', owner.kid, carried.version);
          this.sql.exec('INSERT INTO delegated (agent_id, version) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET version = MIN(delegated.version, excluded.version)', owner.kid, carried.delegated);
        }
      }
    }
  }

  agentByMuse(museId: string): AgentRow | null {
    const r = this.sql.exec('SELECT agent_id, muse_id, root_jwk, kind, label FROM agents WHERE muse_id = ?', museId).toArray()[0];
    return r ? {agentId: String(r.agent_id), museId: String(r.muse_id), rootJwk: JSON.parse(String(r.root_jwk)), kind: r.kind as AgentRow['kind'], label: String(r.label)} : null;
  }
  agentById(agentId: string): AgentRow | null {
    const r = this.sql.exec('SELECT muse_id FROM agents WHERE agent_id = ?', agentId).toArray()[0];
    return r ? this.agentByMuse(String(r.muse_id)) : null;
  }

  // TrustRegistry (synchronous)
  rootKey(agentId: string) { return this.agentById(agentId)?.rootJwk ?? null; }
  delegationVersion(agentId: string) { return Number(this.sql.exec('SELECT version FROM delegation_versions WHERE agent_id = ?', agentId).toArray()[0]?.version ?? 1); }
  isRevoked(ref: string) { return this.sql.exec('SELECT 1 FROM revoked WHERE ref = ?', ref).toArray().length > 0; }
  claimNonce(agentId: string, nonce: string, messageId: string, expiresAt: number) {
    this.sql.exec('DELETE FROM nonces WHERE exp < ?', Date.now() - 60_000);
    const a = `${agentId}:n:${nonce}`, b = `${agentId}:m:${messageId}`;
    if (this.sql.exec('SELECT 1 FROM nonces WHERE key IN (?, ?)', a, b).toArray().length) return false;
    this.sql.exec('INSERT INTO nonces (key, exp) VALUES (?, ?), (?, ?)', a, expiresAt, b, expiresAt);
    return true;
  }
  nonceSeen(agentId: string, nonce: string, messageId: string) {
    return this.sql.exec('SELECT 1 FROM nonces WHERE key IN (?, ?) AND exp >= ?', `${agentId}:n:${nonce}`, `${agentId}:m:${messageId}`, Date.now() - 60_000).toArray().length > 0;
  }
  approval(ref: string) {
    const r = this.sql.exec('SELECT content_hash, agent_id FROM approvals WHERE ref = ?', ref).toArray()[0];
    return r ? {content_hash: String(r.content_hash), agent_id: String(r.agent_id)} : null;
  }
  recordApproval(ref: string, contentHash: string, agentId: string) {
    this.sql.exec('INSERT OR REPLACE INTO approvals (ref, content_hash, agent_id, at) VALUES (?, ?, ?, ?)', ref, contentHash, agentId, Date.now());
  }

  /** The version the owner last delegated (defaults to the current version: never revoked). */
  delegatedVersion(agentId: string) { const r = this.sql.exec('SELECT version FROM delegated WHERE agent_id = ?', agentId).toArray()[0]; return r ? Number(r.version) : this.delegationVersion(agentId); }

  /**
   * The executor for an agent and signer kind; (re)issued when missing or expired. While the agent is
   * revoked and the owner has not delegated again, no new delegation is issued (throws DelegationRevoked).
   */
  async executor(museId: string, signerKind: SignerKind, ownerRootJwk: JsonWebKey | null): Promise<Executor> {
    const agent = this.agentByMuse(museId);
    if (!agent) throw new Error('Unknown Muse ' + museId);
    if (this.suspended(museId)) throw new DelegationRevoked(museId);
    const version = this.delegationVersion(agent.agentId);
    const row = this.sql.exec('SELECT kid, delegation, version FROM executors WHERE agent_id = ? AND signer_kind = ?', agent.agentId, signerKind).toArray()[0];
    // Reuse the stored executor while its delegation is current; an expired one (24 h TTL) is re-issued at the same version.
    if (row && Number(row.version) === version && (peekDelegation(String(row.delegation))?.exp ?? 0) > Date.now() + 60_000) {
      const key = await importPrivateJwk(JSON.parse(String(this.sql.exec('SELECT jwk FROM private_keys WHERE kid = ?', String(row.kid)).toArray()[0].jwk)));
      return {key, delegation: String(row.delegation), d: peekDelegation(String(row.delegation))!};
    }
    const root = await this.rootPair(agent, ownerRootJwk);
    const exec = await generateKeyPair(true);
    const execJwk = await crypto.subtle.exportKey('jwk', exec.privateKey) as JsonWebKey;
    this.sql.exec('INSERT OR REPLACE INTO private_keys (kid, jwk) VALUES (?, ?)', exec.kid, JSON.stringify(execJwk));
    const delegation = await issueDelegation(root, exec, {signerKind, version, ttlMs: 24 * 3_600_000});
    this.sql.exec('INSERT OR REPLACE INTO executors (agent_id, signer_kind, kid, delegation, version) VALUES (?, ?, ?, ?, ?)', agent.agentId, signerKind, exec.kid, delegation, version);
    return {key: exec, delegation, d: peekDelegation(delegation)!};
  }

  /** The stored executor as issued, even if its delegation was revoked since (to replay a stale request). */
  async storedExecutor(museId: string, signerKind: SignerKind): Promise<Executor | null> {
    const agent = this.agentByMuse(museId);
    const row = agent && this.sql.exec('SELECT kid, delegation FROM executors WHERE agent_id = ? AND signer_kind = ?', agent.agentId, signerKind).toArray()[0];
    if (!row) return null;
    const key = await importPrivateJwk(JSON.parse(String(this.sql.exec('SELECT jwk FROM private_keys WHERE kid = ?', String(row.kid)).toArray()[0].jwk)));
    return {key, delegation: String(row.delegation), d: peekDelegation(String(row.delegation))!};
  }
  /**
   * Executor for writes made on behalf of a connected Muse (MCP). While revoked it never issues a new
   * delegation: it returns the stored (revoked) executor so the envelope fails verification at the
   * delegation step, or null when none was ever issued (the caller refuses without signing).
   */
  async custodialExecutor(museId: string, ownerRootJwk: JsonWebKey | null): Promise<Executor | null> {
    if (this.suspended(museId)) return this.storedExecutor(museId, 'server_custodial');
    return this.executor(museId, 'server_custodial', ownerRootJwk);
  }

  /** While suspended (revoked, before the owner delegates again) the Muse takes no live decisions and gets no new delegation. */
  suspended(museId: string) { const a = this.agentByMuse(museId); return !!a && this.delegatedVersion(a.agentId) < this.delegationVersion(a.agentId); }

  /** The owner's explicit re-delegation after a revocation: new executors may be issued at the current version. */
  redelegate(museId: string) {
    const agent = this.agentByMuse(museId);
    if (!agent) throw new Error('Unknown Muse ' + museId);
    const version = this.delegationVersion(agent.agentId);
    this.sql.exec('INSERT INTO delegated (agent_id, version) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET version = excluded.version', agent.agentId, version);
    return version;
  }

  /** Owner revocation (7, "철회"): bump the version and revoke every issued delegation at once. */
  async revoke(museId: string) {
    const agent = this.agentByMuse(museId);
    if (!agent) throw new Error('Unknown Muse ' + museId);
    for (const r of this.sql.exec('SELECT delegation FROM executors WHERE agent_id = ?', agent.agentId).toArray()) this.sql.exec('INSERT OR IGNORE INTO revoked (ref, at) VALUES (?, ?)', await delegationRef(String(r.delegation)), Date.now());
    // Remember the last delegated version first, so the revocation holds with or without executor rows.
    this.sql.exec('INSERT INTO delegated (agent_id, version) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET version = MIN(delegated.version, excluded.version)', agent.agentId, this.delegatedVersion(agent.agentId));
    const next = this.delegationVersion(agent.agentId) + 1;
    this.sql.exec('INSERT INTO delegation_versions (agent_id, version) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET version = excluded.version', agent.agentId, next);
    return next;
  }

  async card(museId: string, ownerRootJwk: JsonWebKey | null, claim: {claimed: boolean; fingerprint: string | null}, baseUrl: string): Promise<AgentCard> {
    const agent = this.agentByMuse(museId)!;
    const root = await this.rootPair(agent, ownerRootJwk);
    const owned = agent.kind === 'owner';
    const card = buildCard(harnessById(museId), {kid: agent.agentId, publicJwk: agent.rootJwk}, {ownerClaimed: owned ? claim.claimed : true, fingerprint: owned ? claim.fingerprint : null, scopes: SCOPE_SUMMARY, baseUrl, ownerLabel: owned ? 'Kim Sejun' : 'Musely resident'});
    return signCard(card, root, `${baseUrl}/.well-known/jwks/${agent.agentId}.json`);
  }

  private async rootPair(agent: AgentRow, ownerRootJwk: JsonWebKey | null): Promise<KeyPair> {
    if (agent.kind === 'owner') { if (!ownerRootJwk) throw new Error('Owner root key not configured'); return importPrivateJwk(ownerRootJwk); }
    const r = this.sql.exec('SELECT jwk FROM private_keys WHERE kid = ?', agent.agentId).toArray()[0];
    return importPrivateJwk(JSON.parse(String(r.jwk)));
  }
}
