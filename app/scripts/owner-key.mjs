// Creates (once) the persistent ES256 root key for the owner's Muse and prints the claim text.
// The private JWK stays outside the repository (~/.config/musely/owner-root.jwk, mode 600) and
// reaches the Worker only as a secret:  node scripts/owner-key.mjs --print-private | npx wrangler secret put OWNER_ROOT_JWK
// Usage: node scripts/owner-key.mjs --handle <threads handle> [--print-private]
import {readFile, writeFile, mkdir, chmod} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {claimFingerprint, ownerHash, claimText, jwkThumbprint} from '../src/identity/fingerprint.ts';

const args = process.argv.slice(2);
const dir = join(homedir(), '.config', 'musely'), file = join(dir, 'owner-root.jwk');
let privateJwk;
let text = null;
try {
  text = await readFile(file, 'utf8');
} catch (e) {
  if (e.code !== 'ENOENT') throw e; // never replace a key we failed to read
}
if (text !== null) {
  privateJwk = JSON.parse(text); // malformed JSON stops here instead of minting a new identity
  if (privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' || !privateJwk.d) throw new Error('Root key file is not a P-256 private JWK: ' + file);
} else {
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await mkdir(dir, {recursive: true});
  await writeFile(file, JSON.stringify(privateJwk), {mode: 0o600, flag: 'wx'}); // exclusive: a concurrent run cannot overwrite
  await chmod(file, 0o600);
  console.error('Created a new root key at ' + file);
}
if (args.includes('--print-private')) {
  process.stdout.write(JSON.stringify(privateJwk));
  process.exit(0);
}
const handleAt = args.indexOf('--handle');
if (handleAt < 0 || !args[handleAt + 1]) throw new Error('Pass --handle <threads handle>');
const handle = args[handleAt + 1].replace(/^@/, '').toLowerCase();
const publicJwk = {kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y};
const owner = await ownerHash('threads', handle);
const fingerprint = await claimFingerprint(publicJwk, owner);
const record = {
  version: 'musely-claim-v1',
  agent: 'owner-muse',
  provider: 'threads',
  handle,
  owner_hash: owner,
  root_public_jwk: {...publicJwk, kid: await jwkThumbprint(publicJwk), alg: 'ES256', use: 'sig'},
  fingerprint: fingerprint.full,
  fingerprint_display: fingerprint.display,
  claim_text: claimText(fingerprint.display),
  status: 'pending_claim',
  permalink: null,
  verified_at: null,
};
await writeFile(new URL('../fixtures/owner-claim.json', import.meta.url), JSON.stringify(record, null, 2) + '\n');
console.log(record.claim_text);
