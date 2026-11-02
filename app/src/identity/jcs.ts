// RFC 8785 JSON Canonicalization Scheme (JCS).
// Keys are sorted by UTF-16 code units (the default JS string order), numbers use the
// ECMAScript Number-to-String rules that JSON.stringify already applies, and strings use
// JSON.stringify escaping, which matches the JCS escaping rules for well-formed input.
export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};

export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS: non-finite numbers are not allowed');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => canonicalize(v === undefined ? null : v)).join(',') + ']';
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalize(v)).join(',') + '}';
  }
  throw new TypeError('JCS: unsupported value type ' + typeof value);
}

export const utf8 = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? utf8(data) : data));
}

export const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
