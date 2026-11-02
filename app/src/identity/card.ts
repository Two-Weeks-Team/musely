// A2A v1.0 Agent Card signing and verification (direction v2, 6.2).
// The signed bytes are the RFC 8785 (JCS) canonical form of the card without its `signatures` member.
// Each signature is a detached JWS: {protected: base64url(header), signature: base64url(ES256)}.
// A valid signature alone is not trust: the verifier must also trust the key (A2A 8.4). Musely trusts
// a root key through its claim (Threads fingerprint match) and the card's `jku` JWKS.
import {canonicalize, base64url, utf8} from './jcs.ts';
import {signBytes, verifyBytes, type KeyPair} from './jws.ts';
import {jwkThumbprint, type EcPublicJwk} from './fingerprint.ts';
import type {Harness} from '../engine/harness.ts';

export type AgentCardSignature = {protected: string; signature: string; header?: Record<string, unknown>};
export type AgentCard = {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: {url: string; protocolBinding: string; protocolVersion: string}[];
  provider: {organization: string; url: string};
  capabilities: {streaming: boolean; pushNotifications: boolean};
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: {id: string; name: string; description: string; tags: string[]}[];
  // Musely extension: identity and delegation facts needed by peers.
  'x-musely': {agent_id: string; root_jwk: EcPublicJwk; owner_claimed: boolean; claim_fingerprint: string | null; scopes: {allowed: string[]; approval: string[]; forbidden: string[]}; harness: string};
  signatures?: AgentCardSignature[];
};

export const cardSigningBytes = (card: AgentCard) => {
  const {signatures: _omit, ...rest} = card;
  return utf8(canonicalize(rest));
};

export async function signCard(card: AgentCard, root: KeyPair, jku: string): Promise<AgentCard> {
  const header = base64url(utf8(canonicalize({alg: 'ES256', kid: root.kid, typ: 'JOSE', jku})));
  const payload = base64url(cardSigningBytes(card));
  const signature = await signBytes(root.privateKey, utf8(header + '.' + payload));
  return {...card, signatures: [{protected: header, signature}]};
}

export type CardCheck = {ok: true; kid: string} | {ok: false; reason: 'unsigned' | 'bad_header' | 'untrusted_key' | 'bad_signature'};

/** Verifies the card signature AND that the signing key is the trusted root for this agent. */
export async function verifyCard(card: AgentCard, trustedRoot: EcPublicJwk | null): Promise<CardCheck> {
  const sig = card.signatures?.[0];
  if (!sig) return {ok: false, reason: 'unsigned'};
  let header: {alg?: string; kid?: string};
  try { header = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(sig.protected.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((sig.protected.length + 3) % 4)), c => c.charCodeAt(0)))); } catch { return {ok: false, reason: 'bad_header'}; }
  if (header.alg !== 'ES256' || !header.kid) return {ok: false, reason: 'bad_header'};
  if (!trustedRoot || (await jwkThumbprint(trustedRoot)) !== header.kid || card['x-musely'].agent_id !== header.kid) return {ok: false, reason: 'untrusted_key'};
  const input = utf8(sig.protected + '.' + base64url(cardSigningBytes(card)));
  return (await verifyBytes(trustedRoot, input, sig.signature)) ? {ok: true, kid: header.kid} : {ok: false, reason: 'bad_signature'};
}

export function buildCard(h: Harness, root: {kid: string; publicJwk: EcPublicJwk}, opts: {ownerClaimed: boolean; fingerprint: string | null; scopes: {allowed: string[]; approval: string[]; forbidden: string[]}; baseUrl: string; ownerLabel?: string}): AgentCard {
  return {
    name: `${h.name}${opts.ownerLabel ? ` · ${opts.ownerLabel}` : ''}`,
    description: `${h.role} Muse in Musely: ${h.persona.traits}. Acts within delegated scopes for its owner.`,
    version: '1.0.0',
    supportedInterfaces: [{url: `${opts.baseUrl}/a2a/${root.kid}`, protocolBinding: 'JSONRPC', protocolVersion: '1.0'}],
    provider: {organization: 'Two Weeks Team (Musely)', url: opts.baseUrl},
    capabilities: {streaming: false, pushNotifications: false},
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['application/json'],
    skills: h.skills.map(s => ({id: s.replace(/\s+/g, '_'), name: s, description: `${h.name} can help with ${s} in the shared world.`, tags: [h.role.toLowerCase(), 'musely']})),
    'x-musely': {agent_id: root.kid, root_jwk: root.publicJwk, owner_claimed: opts.ownerClaimed, claim_fingerprint: opts.fingerprint, scopes: opts.scopes, harness: h.id},
  };
}
