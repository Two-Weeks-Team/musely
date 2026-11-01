// Root key → executor delegation (direction v2, 6.2). The claim root key never signs messages itself.
// Each executor (a browser session, the server heartbeat, or the Worker acting for a connected Muse)
// has its own key pair; the root signs a delegation naming that executor's public key, scopes,
// version and expiry. Revoking a delegation (or bumping the version) stops the executor at once.
import {canonicalize, sha256, base64url, utf8} from './jcs.ts';
import {signCompact, verifyCompact, decodeCompact, type KeyPair} from './jws.ts';
import type {EcPublicJwk} from './fingerprint.ts';
import {SCOPES, type ScopeId} from '../engine/harness.ts';

export type SignerKind = 'browser' | 'server_custodial' | 'server_heartbeat';
export type Delegation = {
  v: 'musely-delegation-v1';
  agent_id: string;          // the Muse (root key thumbprint)
  executor_kid: string;      // thumbprint of the executor key
  executor_jwk: EcPublicJwk;
  signer_kind: SignerKind;
  scopes: ScopeId[];         // allowed + owner-approval scopes this executor may exercise
  version: number;           // must equal the registry's current version for the agent
  iat: number;
  exp: number;
};

export const DEFAULT_SCOPES: ScopeId[] = [...SCOPES.allowed, ...SCOPES.approval];

export async function issueDelegation(root: KeyPair, executor: {publicJwk: EcPublicJwk; kid: string}, opts: {signerKind: SignerKind; version: number; ttlMs: number; scopes?: ScopeId[]; now?: number}) {
  const now = opts.now ?? Date.now();
  const scopes = (opts.scopes ?? DEFAULT_SCOPES).filter(s => !(SCOPES.forbidden as readonly string[]).includes(s));
  const d: Delegation = {v: 'musely-delegation-v1', agent_id: root.kid, executor_kid: executor.kid, executor_jwk: executor.publicJwk, signer_kind: opts.signerKind, scopes, version: opts.version, iat: now, exp: now + opts.ttlMs};
  return signCompact(root, d, {typ: 'musely-delegation+jws'});
}

export const delegationRef = async (token: string) => base64url(await sha256(utf8(token))).slice(0, 32);

export async function verifyDelegation(token: string, rootJwk: EcPublicJwk): Promise<Delegation | null> {
  const v = await verifyCompact<Delegation>(token, rootJwk);
  if (!v || v.payload.v !== 'musely-delegation-v1') return null;
  return v.payload;
}

export const peekDelegation = (token: string) => decodeCompact<Delegation>(token)?.payload ?? null;
export const scopeHash = async (scopes: readonly string[]) => base64url(await sha256(canonicalize([...scopes].sort()))).slice(0, 32);
