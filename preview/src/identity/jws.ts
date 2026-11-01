// ES256 (ECDSA P-256 / SHA-256) JWS helpers over WebCrypto, shared by the browser and the Worker.
// WebCrypto's ECDSA signature is the IEEE P1363 r||s form that JWS ES256 uses (RFC 7518 3.4).
import {base64url, fromBase64url, utf8, canonicalize} from './jcs.ts';
import {jwkThumbprint, type EcPublicJwk} from './fingerprint.ts';

export type KeyPair = {privateKey: CryptoKey; publicKey: CryptoKey; publicJwk: EcPublicJwk; kid: string};
const ALG = {name: 'ECDSA', namedCurve: 'P-256'} as const;
const SIGN = {name: 'ECDSA', hash: 'SHA-256'} as const;

export async function generateKeyPair(extractable = false): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']) as CryptoKeyPair;
  const {kty, crv, x, y} = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const publicJwk = {kty, crv, x, y} as EcPublicJwk;
  // Re-import the private key as non-extractable unless the caller must persist it.
  const privateKey = extractable ? pair.privateKey : await crypto.subtle.importKey('jwk', await crypto.subtle.exportKey('jwk', pair.privateKey), ALG, false, ['sign']);
  return {privateKey, publicKey: pair.publicKey, publicJwk, kid: await jwkThumbprint(publicJwk)};
}

export async function importPrivateJwk(jwk: JsonWebKey): Promise<KeyPair> {
  const privateKey = await crypto.subtle.importKey('jwk', jwk, ALG, false, ['sign']);
  const publicJwk = {kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y!} as EcPublicJwk;
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, ALG, true, ['verify']);
  return {privateKey, publicKey, publicJwk, kid: await jwkThumbprint(publicJwk)};
}

export const importPublicJwk = (jwk: EcPublicJwk) => crypto.subtle.importKey('jwk', {kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y}, ALG, true, ['verify']);

export async function signBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>) {
  return base64url(await crypto.subtle.sign(SIGN, key, data));
}
export async function verifyBytes(jwk: EcPublicJwk, data: Uint8Array<ArrayBuffer>, signature: string) {
  try {
    return await crypto.subtle.verify(SIGN, await importPublicJwk(jwk), fromBase64url(signature), data);
  } catch {
    return false;
  }
}

/** Compact JWS with a JCS-canonical JSON payload. */
export async function signCompact(key: KeyPair, payload: unknown, header: Record<string, unknown> = {}) {
  const protectedHeader = base64url(utf8(canonicalize({alg: 'ES256', kid: key.kid, typ: 'JOSE', ...header})));
  const body = base64url(utf8(canonicalize(payload)));
  return `${protectedHeader}.${body}.${await signBytes(key.privateKey, utf8(protectedHeader + '.' + body))}`;
}

export function decodeCompact<T = unknown>(token: string): {header: Record<string, unknown>; payload: T; signingInput: string; signature: string} | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const dec = (s: string) => JSON.parse(new TextDecoder().decode(fromBase64url(s)));
    return {header: dec(parts[0]), payload: dec(parts[1]) as T, signingInput: parts[0] + '.' + parts[1], signature: parts[2]};
  } catch {
    return null;
  }
}

export async function verifyCompact<T = unknown>(token: string, jwk: EcPublicJwk): Promise<{header: Record<string, unknown>; payload: T} | null> {
  const d = decodeCompact<T>(token);
  if (!d || d.header.alg !== 'ES256') return null;
  return (await verifyBytes(jwk, utf8(d.signingInput), d.signature)) ? {header: d.header, payload: d.payload} : null;
}
