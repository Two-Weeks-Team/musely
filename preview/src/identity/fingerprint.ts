// Owner-claim fingerprint: a one-way hash binding a Muse root public key to its owner.
// The owner hash never contains the raw account identifier; only its SHA-256 is bound.
// Screens show the first 16 hex digits (64 bits); the Agent Card carries the full hash.
import {canonicalize, sha256, hex, base64url} from './jcs.ts';

export type EcPublicJwk = {kty: 'EC'; crv: 'P-256'; x: string; y: string};

// RFC 7638 JWK thumbprint over the required EC members in lexicographic order.
export async function jwkThumbprint(jwk: EcPublicJwk): Promise<string> {
  return base64url(await sha256(canonicalize({crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y})));
}

export async function ownerHash(provider: 'threads', handle: string): Promise<string> {
  const normalized = handle.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(normalized)) throw new Error('Invalid Threads handle');
  return hex(await sha256(`musely-owner-v1:${provider}:${normalized}`));
}

export async function claimFingerprint(rootKey: EcPublicJwk, owner: string): Promise<{full: string; short: string; display: string}> {
  const full = hex(await sha256(canonicalize({v: 'musely-claim-v1', root_kid: await jwkThumbprint(rootKey), owner_hash: owner})));
  const short = full.slice(0, 16);
  return {full, short, display: short.match(/.{4}/g)!.join(' ')};
}

// The exact text the owner approves and posts. Re-reading the post must find `display`.
export const claimText = (display: string) =>
  `I am claiming my Muse on Musely. Fingerprint: ${display} · preview.musely.net`;
