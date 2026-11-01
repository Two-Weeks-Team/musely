import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorizeUrl, claimViaWorker, recheck, matchClaim, ownerDirectRecord, ThreadsError} from '../worker/core/threads.ts';

const display = 'dead ed5c 1e55 d7a3', text = `I am claiming my Muse on Musely. Fingerprint: ${display} · preview.musely.net`;
function fakeGraph({username = 'centisgood', postedText = text, deleted = false} = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const u = new URL(url), body = init?.body ? Object.fromEntries(new URLSearchParams(init.body)) : Object.fromEntries(u.searchParams);
    calls.push({path: u.pathname, body});
    const ok = data => new Response(JSON.stringify(data), {status: 200});
    if (u.pathname === '/oauth/access_token') return body.client_secret === 'secret' && body.code === 'good' ? ok({access_token: 'short', user_id: 42}) : new Response(JSON.stringify({error: {message: 'bad code'}}), {status: 400});
    if (u.pathname === '/access_token') return ok({access_token: 'long', expires_in: 5184000});
    if (u.pathname === '/v1.0/me') return ok({id: '42', username});
    if (u.pathname === '/v1.0/42/threads') return ok({id: 'container-1'});
    if (u.pathname === '/v1.0/42/threads_publish') return body.creation_id === 'container-1' ? ok({id: 'media-9'}) : new Response('{}', {status: 400});
    if (u.pathname === '/v1.0/media-9') return deleted ? new Response(JSON.stringify({error: {message: 'not found'}}), {status: 404}) : ok({id: 'media-9', text: postedText, permalink: 'https://www.threads.com/@centisgood/post/ABC123', username});
    return new Response('{}', {status: 404});
  };
  return {cfg: {appId: 'app', appSecret: 'secret', redirectUri: 'https://preview.musely.net/api/threads/callback', fetcher}, calls};
}
const expected = {agent: 'owner-muse', handle: 'centisgood', display, text};

test('authorize URL asks only for basic + publish scopes and carries state', () => {
  const u = new URL(authorizeUrl({appId: 'app', appSecret: 'x', redirectUri: 'https://preview.musely.net/api/threads/callback'}, 'st'));
  assert.equal(u.searchParams.get('scope'), 'threads_basic,threads_content_publish');
  assert.equal(u.searchParams.get('state'), 'st');
  assert.equal(u.searchParams.has('client_secret'), false, 'secret never in the URL');
});

test('worker path: code exchange, owner check, publish approved text, read back, match', async () => {
  const g = fakeGraph();
  const {record, token} = await claimViaWorker(g.cfg, 'good', expected, 1000);
  assert.equal(record.status, 'claimed');
  assert.equal(record.machineVerified, true);
  assert.equal(record.permalink, 'https://www.threads.com/@centisgood/post/ABC123');
  assert.equal(token, 'long');
  assert.equal(g.calls.find(c => c.path === '/v1.0/42/threads').body.text, text, 'publishes exactly the approved text');
});

test('worker path refuses another account and a bad code', async () => {
  await assert.rejects(claimViaWorker(fakeGraph({username: 'someone'}).cfg, 'good', expected), e => e instanceof ThreadsError && e.status === 403);
  await assert.rejects(claimViaWorker(fakeGraph().cfg, 'bad', expected), ThreadsError);
});

test('an edited post is a mismatch; a deleted post revokes the claim', async () => {
  const edited = await claimViaWorker(fakeGraph({postedText: 'I am claiming my Muse. Fingerprint: dead ed5c 0000 d7a3'}).cfg, 'good', expected);
  assert.equal(edited.record.status, 'mismatch');
  const {record} = await claimViaWorker(fakeGraph().cfg, 'good', expected);
  assert.equal((await recheck(fakeGraph({deleted: true}).cfg, 'long', record)).status, 'claim_revoked');
  assert.equal((await recheck(fakeGraph().cfg, 'long', record)).status, 'claimed');
});

test('owner-direct path only accepts the owner\'s post URL and is never machine-verified', () => {
  assert.equal(ownerDirectRecord('owner-muse', 'centisgood', display, 'https://www.threads.com/@someone/post/ABC123'), null);
  assert.equal(ownerDirectRecord('owner-muse', 'centisgood', display, 'https://evil.example/@centisgood/post/ABC123'), null);
  const r = ownerDirectRecord('owner-muse', 'centisgood', display, 'https://www.threads.net/@centisgood/post/ABC123');
  assert.equal(r.machineVerified, false);
  assert.equal(r.status, 'pending_claim');
  assert.deepEqual(matchClaim({username: 'CentisGood', text: `x ${display} y`}, {handle: 'centisgood', display}), {ok: true, handleOk: true, textOk: true});
});
