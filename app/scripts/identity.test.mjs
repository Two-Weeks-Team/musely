import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalize, base64url, fromBase64url} from '../src/identity/jcs.ts';
import {jwkThumbprint, ownerHash, claimFingerprint, claimText} from '../src/identity/fingerprint.ts';

test('JCS matches the RFC 8785 section 3.2.2 example', () => {
  const input = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}');
  assert.equal(canonicalize(input), '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
});

test('JCS sorts keys by UTF-16 code units (RFC 8785 section 3.2.3)', () => {
  const input = {'€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis'};
  // Read keys from the string itself: a parsed JS object would move the integer-like key "1" first.
  const keys = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":"/g)].map(m => JSON.parse('"' + m[1] + '"'));
  assert.deepEqual(keys, ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ']);
});

test('JCS rejects non-finite numbers and drops undefined members', () => {
  assert.throws(() => canonicalize({a: NaN}));
  assert.equal(canonicalize({b: 1, a: undefined}), '{"b":1}');
});

test('base64url round-trips without padding', () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
    const text = base64url(bytes);
    assert.ok(!/[+/=]/.test(text));
    assert.deepEqual(fromBase64url(text), bytes);
  }
});

test('claim fingerprint binds the root key and owner, shows 16 hex digits', async () => {
  const {publicKey} = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const {kty, crv, x, y} = await crypto.subtle.exportKey('jwk', publicKey);
  const jwk = {kty, crv, x, y};
  const owner = await ownerHash('threads', '@Musely.Owner');
  assert.equal(owner, await ownerHash('threads', 'musely.owner'), 'handle normalization');
  const a = await claimFingerprint(jwk, owner);
  assert.match(a.full, /^[0-9a-f]{64}$/);
  assert.equal(a.short, a.full.slice(0, 16));
  assert.match(a.display, /^([0-9a-f]{4} ){3}[0-9a-f]{4}$/);
  assert.ok(claimText(a.display).includes(a.display));
  const other = await claimFingerprint(jwk, await ownerHash('threads', 'someone_else'));
  assert.notEqual(other.full, a.full, 'a different owner gives a different fingerprint');
  assert.equal(await jwkThumbprint(jwk), await jwkThumbprint({y, x, crv, kty}), 'thumbprint ignores member order');
  await assert.rejects(ownerHash('threads', 'bad handle!'));
});
