import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorizeUrl, claimViaWorker, recheck, matchClaim, ownerDirectRecord, ThreadsError, ClaimStepError} from '../worker/core/threads.ts';

const display = 'dead ed5c 1e55 d7a3', text = `I am claiming my Muse on Musely. Fingerprint: ${display} · musely.net`;
function fakeGraph({username = 'centisgood', postedText = text, deleted = false, tokenExpired = false, existing = null, readFailures = 0, publishMissing = false} = {}) {
  let reads = 0;
  const calls = [];
  const fetcher = async (url, init) => {
    const u = new URL(url), body = init?.body ? Object.fromEntries(new URLSearchParams(init.body)) : Object.fromEntries(u.searchParams);
    calls.push({path: u.pathname, body});
    const ok = data => new Response(JSON.stringify(data), {status: 200});
    if (u.pathname === '/oauth/access_token') return body.client_secret === 'secret' && body.code === 'good' ? ok({access_token: 'short', user_id: 42}) : new Response(JSON.stringify({error: {message: 'bad code'}}), {status: 400});
    if (u.pathname === '/access_token') return ok({access_token: 'long', expires_in: 5184000});
    if (u.pathname === '/v1.0/me') return ok({id: '42', username});
    if (u.pathname === '/v1.0/me/threads') return ok({data: existing ? [existing] : []});
    if (u.pathname === '/v1.0/42/threads' && publishMissing) return new Response(JSON.stringify({error: {message: 'The requested resource does not exist', type: 'OAuthException', code: 24}}), {status: 400});
    if (u.pathname === '/v1.0/42/threads') return ok({id: 'container-1'});
    if (u.pathname === '/v1.0/42/threads_publish') return body.creation_id === 'container-1' ? ok({id: 'media-9'}) : new Response('{}', {status: 400});
    if (u.pathname === '/v1.0/media-9' && reads++ < readFailures) return new Response(JSON.stringify({error: {message: 'The requested resource does not exist', type: 'GraphMethodException', code: 100, error_subcode: 33}}), {status: 400});
    if (u.pathname === '/v1.0/media-9' && tokenExpired) return new Response(JSON.stringify({error: {message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190}}), {status: 400});
    if (u.pathname === '/v1.0/media-9' && deleted === 'graph') return new Response(JSON.stringify({error: {message: 'Unsupported get request. Object does not exist', type: 'GraphMethodException', code: 100, error_subcode: 33}}), {status: 400});
    if (u.pathname === '/v1.0/media-9') return deleted ? new Response(JSON.stringify({error: {message: 'not found'}}), {status: 404}) : ok({id: 'media-9', text: postedText, permalink: 'https://www.threads.com/@centisgood/post/ABC123', username});
    return new Response('{}', {status: 404});
  };
  return {cfg: {appId: 'app', appSecret: 'secret', redirectUri: 'https://musely.net/api/threads/callback', fetcher}, calls};
}
const expected = {agent: 'owner-muse', handle: 'centisgood', display, text};

test('authorize URL asks only for basic + publish scopes and carries state', () => {
  const u = new URL(authorizeUrl({appId: 'app', appSecret: 'x', redirectUri: 'https://musely.net/api/threads/callback'}, 'st'));
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
  await assert.rejects(claimViaWorker(fakeGraph({username: 'someone'}).cfg, 'good', expected), e => e instanceof ClaimStepError && e.step === 'identity' && e.cause.status === 403);
  await assert.rejects(claimViaWorker(fakeGraph().cfg, 'bad', expected), e => e instanceof ClaimStepError && e.step === 'exchange');
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

test('an expired token keeps the last verified claim; only a missing post revokes it', async () => {
  const {record} = await claimViaWorker(fakeGraph().cfg, 'good', expected);
  const expired = await recheck(fakeGraph({tokenExpired: true}).cfg, 'long', record);
  assert.equal(expired.status, 'claimed');
  assert.equal(expired.machineVerified, true);
  assert.match(expired.note, /token expired/);
  assert.equal((await recheck(fakeGraph({deleted: 'graph'}).cfg, 'long', record)).status, 'claim_revoked', 'Graph code 100/33 means the post is gone');
  assert.equal((await recheck(fakeGraph({deleted: true}).cfg, 'long', record)).status, 'claim_revoked', '404 means the post is gone');
});

test('a read-back that is not ready yet is retried; the post id is saved before reading', async () => {
  const g = fakeGraph({readFailures: 2});
  const saved = [];
  const r = await claimViaWorker(g.cfg, 'good', expected, 1, {onPublished: id => saved.push(id), readDelayMs: 5});
  assert.equal(r.record.status, 'claimed');
  assert.deepEqual(saved, ['media-9']);
  assert.equal(g.calls.filter(c => c.path === '/v1.0/42/threads_publish').length, 1, 'published once');
});

test('an existing claim post is reused instead of posting again', async () => {
  const g = fakeGraph({existing: {id: 'media-9', text, permalink: 'https://www.threads.com/@centisgood/post/OLD1', username: 'centisgood'}});
  const r = await claimViaWorker(g.cfg, 'good', expected, 1);
  assert.equal(r.reused, true);
  assert.equal(r.record.status, 'claimed');
  assert.equal(g.calls.filter(c => c.path.endsWith('/threads_publish') || c.path === '/v1.0/42/threads').length, 0, 'no new post');
});

test('a post made for another deployment with the same fingerprint is not reused', async () => {
  const other = text.replace('· musely.net', '· preview.musely.net');
  const g = fakeGraph({existing: {id: 'media-old', text: other, permalink: 'https://www.threads.com/@centisgood/post/OLD2', username: 'centisgood'}});
  const r = await claimViaWorker(g.cfg, 'good', expected, 1, {readDelayMs: 0});
  assert.equal(r.reused, false);
  assert.equal(g.calls.filter(c => c.path.endsWith('/threads_publish')).length, 1, 'publishes this deployment\'s own text');
  assert.equal(r.record.status, 'claimed');
});

test('failures name their step', async () => {
  await assert.rejects(claimViaWorker(fakeGraph({publishMissing: true}).cfg, 'good', expected), e => e.step === 'publish' && e.cause.code === 24);
  const saved = [];
  await assert.rejects(claimViaWorker(fakeGraph({readFailures: 9}).cfg, 'good', expected, 1, {onPublished: id => saved.push(id), readDelayMs: 1}), e => e.step === 'read_back');
  assert.deepEqual(saved, ['media-9'], 'post id kept even when the read-back fails');
});
