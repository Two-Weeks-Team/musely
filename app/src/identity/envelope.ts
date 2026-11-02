// Musely A2A extension profile: the signed message envelope (direction v2, 12.1).
// Verification order: signature → recipient → delegation valid/unrevoked/in scope → expiry → replay (nonce,
// message_id) → approval_ref/content_hash → process. The first failure is returned and logged; a
// refusal never includes private reasons.
import {canonicalize, sha256, base64url, utf8} from './jcs.ts';
import {signBytes, verifyBytes, type KeyPair} from './jws.ts';
import {verifyDelegation, delegationRef, scopeHash, type Delegation, type SignerKind} from './delegation.ts';
import type {EcPublicJwk} from './fingerprint.ts';
import {scopeLevel, type ScopeId} from '../engine/harness.ts';

export type Envelope = {
  v: 'musely-a2a-v1';
  agent_id: string;
  owner_claimed: boolean;
  scope_hash: string;
  content_hash: string;
  approval_ref: string | null;
  timestamp: number;
  message_id: string;
  recipient: string;
  task_id: string | null;
  expires_at: number;
  nonce: string;
  delegation_ref: string;
  signer_kind: SignerKind;
  action: string;
  scope: ScopeId | string;
  executor_kid: string;
  signature?: string;
};
export type Signed = {envelope: Envelope; content: unknown; delegation: string};

export const contentHash = async (content: unknown) => base64url(await sha256(canonicalize(content))).slice(0, 43);
const random = () => base64url(crypto.getRandomValues(new Uint8Array(16)));
const signingBytes = (e: Envelope) => { const {signature: _s, ...rest} = e; return utf8(canonicalize(rest)); };

export async function signEnvelope(executor: KeyPair, delegationToken: string, d: Delegation, m: {recipient: string; action: string; scope: ScopeId | string; content: unknown; taskId?: string | null; approvalRef?: string | null; ownerClaimed: boolean; ttlMs?: number; now?: number; messageId?: string}): Promise<Signed> {
  const now = m.now ?? Date.now();
  const envelope: Envelope = {
    v: 'musely-a2a-v1', agent_id: d.agent_id, owner_claimed: m.ownerClaimed, scope_hash: await scopeHash(d.scopes), content_hash: await contentHash(m.content),
    approval_ref: m.approvalRef ?? null, timestamp: now, message_id: m.messageId ?? random(), recipient: m.recipient, task_id: m.taskId ?? null,
    expires_at: now + (m.ttlMs ?? 120_000), nonce: random(), delegation_ref: await delegationRef(delegationToken), signer_kind: d.signer_kind,
    action: m.action, scope: m.scope, executor_kid: executor.kid,
  };
  envelope.signature = await signBytes(executor.privateKey, signingBytes(envelope));
  return {envelope, content: m.content, delegation: delegationToken};
}

/** State the verifier consults; in the demo it lives in the world Durable Object. */
export interface TrustRegistry {
  rootKey(agentId: string): EcPublicJwk | null;
  delegationVersion(agentId: string): number;
  isRevoked(delegationRef: string): boolean;
  /** Records the nonce/message id; returns false if either was already used. */
  claimNonce(agentId: string, nonce: string, messageId: string, expiresAt: number): boolean;
  /** Whether the nonce or message id was already used (no write). */
  nonceSeen(agentId: string, nonce: string, messageId: string): boolean;
  approval(ref: string): {content_hash: string; agent_id: string} | null;
}

export type Refusal =
  | 'malformed' | 'unknown_agent' | 'bad_delegation_signature' | 'bad_signature' | 'delegation_mismatch'
  | 'delegation_revoked' | 'delegation_expired' | 'scope_forbidden' | 'scope_not_delegated'
  | 'expired' | 'replay' | 'content_mismatch' | 'approval_required' | 'approval_mismatch' | 'wrong_recipient';
export type Verdict = {ok: true; delegation: Delegation; step: 'process'} | {ok: false; reason: Refusal; step: string};
/**
 * What the verifier expects independently of the envelope: the agent this message must be addressed to.
 * `claim: false` checks the nonce without spending it; the caller then claims it inside its commit.
 */
export type Expect = {recipient: string; claim?: boolean};

/** Step 1 only (no registry writes): who signed it, under which delegation. Safe to run before a result lookup. */
export async function verifySignature(s: Signed, reg: TrustRegistry): Promise<{ok: true; delegation: Delegation} | {ok: false; reason: Refusal; step: string}> {
  const e = s?.envelope;
  if (!e || e.v !== 'musely-a2a-v1' || typeof e.signature !== 'string' || typeof s.delegation !== 'string') return {ok: false, reason: 'malformed', step: 'parse'};
  // 1. Signature: the root key signed the delegation; the delegated executor key signed the envelope.
  const root = reg.rootKey(e.agent_id);
  if (!root) return {ok: false, reason: 'unknown_agent', step: 'signature'};
  const d = await verifyDelegation(s.delegation, root);
  if (!d || d.agent_id !== e.agent_id) return {ok: false, reason: 'bad_delegation_signature', step: 'signature'};
  if (d.executor_kid !== e.executor_kid || (await delegationRef(s.delegation)) !== e.delegation_ref || d.signer_kind !== e.signer_kind) return {ok: false, reason: 'delegation_mismatch', step: 'signature'};
  if (!(await verifyBytes(d.executor_jwk, signingBytes(e), e.signature))) return {ok: false, reason: 'bad_signature', step: 'signature'};
  return {ok: true, delegation: d};
}

export async function verifyEnvelope(s: Signed, reg: TrustRegistry, now: number, expect: Expect): Promise<Verdict> {
  const sig = await verifySignature(s, reg);
  if (!sig.ok) return sig;
  const e = s.envelope, d = sig.delegation;
  // A validly signed message for someone else must not act here (and must not burn its nonce here).
  if (typeof expect?.recipient !== 'string' || e.recipient !== expect.recipient) return {ok: false, reason: 'wrong_recipient', step: 'recipient'};
  // 2. Delegation valid, unrevoked, current version, and in scope.
  if (reg.isRevoked(e.delegation_ref) || d.version !== reg.delegationVersion(e.agent_id)) return {ok: false, reason: 'delegation_revoked', step: 'delegation'};
  if (d.exp <= now) return {ok: false, reason: 'delegation_expired', step: 'delegation'};
  const level = scopeLevel(e.scope);
  if (level === 'forbidden' || level === null) return {ok: false, reason: 'scope_forbidden', step: 'delegation'};
  if (!d.scopes.includes(e.scope as ScopeId) || e.scope_hash !== (await scopeHash(d.scopes))) return {ok: false, reason: 'scope_not_delegated', step: 'delegation'};
  // 3. Expiry.
  if (e.expires_at <= now || e.timestamp > now + 60_000) return {ok: false, reason: 'expired', step: 'expiry'};
  // 5 (content) is checked before consuming the nonce so a tampered body cannot burn a valid nonce.
  if ((await contentHash(s.content)) !== e.content_hash) return {ok: false, reason: 'content_mismatch', step: 'approval'};
  if (level === 'approval') {
    const a = e.approval_ref ? reg.approval(e.approval_ref) : null;
    if (!a) return {ok: false, reason: 'approval_required', step: 'approval'};
    if (a.content_hash !== e.content_hash || a.agent_id !== e.agent_id) return {ok: false, reason: 'approval_mismatch', step: 'approval'};
  }
  // 4. Replay protection.
  const fresh = expect.claim === false ? !reg.nonceSeen(e.agent_id, e.nonce, e.message_id) : reg.claimNonce(e.agent_id, e.nonce, e.message_id, e.expires_at);
  if (!fresh) return {ok: false, reason: 'replay', step: 'replay'};
  return {ok: true, delegation: d, step: 'process'};
}

/** In-memory registry (browser-side peer checks and tests); the Durable Object keeps its own in SQLite. */
export class MemoryRegistry implements TrustRegistry {
  roots = new Map<string, EcPublicJwk>();
  versions = new Map<string, number>();
  revoked = new Set<string>();
  nonces = new Map<string, number>();
  approvals = new Map<string, {content_hash: string; agent_id: string}>();
  rootKey(id: string) { return this.roots.get(id) ?? null; }
  delegationVersion(id: string) { return this.versions.get(id) ?? 1; }
  isRevoked(ref: string) { return this.revoked.has(ref); }
  claimNonce(agentId: string, nonce: string, messageId: string, expiresAt: number) {
    const now = Date.now();
    for (const [k, exp] of this.nonces) if (exp < now) this.nonces.delete(k);
    const a = agentId + ':n:' + nonce, b = agentId + ':m:' + messageId;
    if (this.nonces.has(a) || this.nonces.has(b)) return false;
    this.nonces.set(a, expiresAt); this.nonces.set(b, expiresAt);
    return true;
  }
  nonceSeen(agentId: string, nonce: string, messageId: string) { return this.nonces.has(agentId + ':n:' + nonce) || this.nonces.has(agentId + ':m:' + messageId); }
  approval(ref: string) { return this.approvals.get(ref) ?? null; }
  revokeAll(agentId: string) { this.versions.set(agentId, this.delegationVersion(agentId) + 1); }
}
