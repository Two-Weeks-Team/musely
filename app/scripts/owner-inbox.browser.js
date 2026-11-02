// Playwright run-code callback: actual built app and native DOM, with all API traffic locally fulfilled.
// The fake owner token/approvals never leave the browser route; this is UI integration, not account/server acceptance.
async (page) => {
 const base = new URL(page.url()); base.search = '?autoplay=0';
 const cases = [], browser = page.context().browser();
 const check = (vp, name, ok, detail = '') => cases.push({vp, name, ok: !!ok, detail: String(detail).slice(0, 400)});
 for (const [width, height] of [[1280, 800], [390, 844]]) {
  const vp = `${width}x${height}`, ctx = await browser.newContext({viewport: {width, height}}), p = await ctx.newPage();
  const now = Date.now(), owner = {principal: 'owner', ownerId: 'owner-test', label: 'Fixture owner', demo: false, note: 'UI fixture only', muses: ['00-jolly'], expiresAt: now + 3600000};
  const task = id => ({task_id: id, kind: 'meetup', muse: '00-jolly', other: '09-copper', other_side: 'Demo peer', status: 'input-required', stage: 'owner_approval', revision: 1, content_hash: 'a'.repeat(64), deadline: now + 1800000, deadline_iso: new Date(now + 1800000).toISOString(), candidates: [{id: 'c1', time: '17:00', place: 'Commons Cafe', place_id: 'commons:cafe', public_basis: 'public'}, {id: 'c2', time: '18:00', place: 'The Garden', place_id: 'commons:garden', public_basis: 'public'}], yours: null, theirs: null, confirmed: null});
  let signedIn = false, approvals = [task('task_1')]; const requests = [], consoleErrors = [];
  p.on('pageerror', e => consoleErrors.push(e.message));
  await p.route('**/api/**', async route => {
   const r = route.request(), path = new URL(r.url()).pathname, method = r.method(), post = r.postDataJSON();
   requests.push({path, method, body: post});
   const answer = (status, body) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
   if (path === '/api/status') return answer(200, {model: {id: 'fixture', connected: false, live: false}, budget: {capUsd: 0, remainingUsd: 0}, turnstile: {configured: false}, session: null});
   if (path === '/api/world') return answer(200, {worldId: 'ui-fixture', day: '2026-11-02', tick: 1, lastTickAt: now, nextSpotlight: {muse: '00-jolly', freedom: 'goal'}, muses: []});
   if (path === '/api/world/events' || path === '/api/world/highlights') return answer(200, []);
   if (path === '/api/claim/owner-muse') return answer(200, {record: null});
   if (path === '/api/owner/session') {
    if (method === 'POST') signedIn = true;
    if (method === 'DELETE') signedIn = false;
    return answer(200, method === 'GET' ? {owner: signedIn ? owner : null, delegation: []} : {ok: true});
   }
   if (path === '/api/owner/inbox') return signedIn ? answer(200, {owner, demo_limits: null, approvals, recent: [], notifications: [], approval_window_min: 30}) : answer(401, {error: 'owner_session_required'});
   if (path === '/api/owner/approvals' && method === 'POST') {
    const t = approvals.find(t => t.task_id === post.taskId);
    if (!signedIn || !t) return answer(403, {error: 'owner_session_required'});
    t.yours = {decision: post.decision, candidate: post.candidate ?? null, source: 'owner', at: Date.now(), approval_ref: 'ap_fixture'};
    return answer(200, {ok: true, confirmed: false});
   }
   return answer(404, {error: 'ui_fixture_not_implemented'});
  });
  try {
   await p.goto(base.href, {waitUntil: 'domcontentloaded'});
   await p.waitForFunction(() => !!window.__world?.worldPanel, null, {timeout: 40000});
   await p.evaluate(() => window.__world.worldPanel.openTab('identity'));
   await p.locator('.owner-inbox').getByText('Start the owner session', {exact: false}).waitFor();
   check(vp, 'signed-out inbox clearly needs its own owner session', true);
   await p.getByLabel('Owner control token', {exact: true}).fill('ui-fixture-token');
   await p.getByRole('button', {name: 'Start owner session', exact: true}).click();
   await p.locator('.owner-inbox .owner-approval').waitFor();
   check(vp, 'session start refreshes the previous401 inbox without reopening the tab', await p.locator('.owner-inbox .owner-approval').count() === 1);
   const editor = p.getByLabel('Times you cannot make', {exact: true});
   await editor.fill('17:00-17:30');
   await p.getByRole('button', {name: 'Check candidates on this device', exact: true}).click();
   await p.waitForFunction(() => document.querySelector('.owner-approval input[type=radio]:checked')?.value === 'c2');
   check(vp, 'explicit private-condition check recomputes a fitting candidate', true);
   await editor.fill('17:00-18:00 PRIVATE-DRAFT');
   const first = p.locator('.owner-approval').first();
   await first.locator('input[type=radio][value=c2]').check();
   await editor.focus();
   await p.evaluate(() => { window.__ownerEditor = document.querySelector('.owner-private input[type=text]'); window.__ownerFirst = document.querySelector('.owner-approval'); });
   approvals.push(task('task_2'));
   await p.evaluate(() => window.__world.worldPanel.refresh());
   await p.waitForFunction(() => document.querySelectorAll('.owner-approval').length === 2);
   const retained = await p.evaluate(() => ({editor: window.__ownerEditor === document.querySelector('.owner-private input[type=text]'), card: window.__ownerFirst === document.querySelector('.owner-approval'), draft: window.__ownerEditor.value, focus: document.activeElement === window.__ownerEditor, selected: document.querySelector('.owner-approval input[value=c2]').checked}));
   check(vp, 'poll discovers new approval while preserving private draft, selected candidate and native focus', retained.editor && retained.card && retained.focus && retained.selected && retained.draft === '17:00-18:00 PRIVATE-DRAFT', JSON.stringify(retained));
   await first.locator('input[value=c2]').focus();
   await p.evaluate(() => { window.__ownerPicker = document.querySelector('.owner-approval input[value=c2]'); });
   approvals[0].theirs = {decision: 'approve', candidate: 'c2', source: 'owner', at: now, approval_ref: 'ap_other'};
   await p.evaluate(() => window.__world.worldPanel.refresh());
   await p.waitForFunction(() => document.querySelector('.owner-approval')?.textContent.includes('Their decisionapproved c2'));
   const peerUpdate = await p.evaluate(() => ({same: window.__ownerPicker === document.querySelector('.owner-approval input[value=c2]'), focus: document.activeElement === window.__ownerPicker, checked: window.__ownerPicker.checked}));
   check(vp, 'other-side approval updates its fact without replacing the active candidate picker', peerUpdate.same && peerUpdate.focus && peerUpdate.checked, JSON.stringify(peerUpdate));
   await p.getByRole('button', {name: 'Refresh owner inbox', exact: true}).click();
   await first.getByRole('button', {name: 'Approve the chosen candidate', exact: true}).click();
   await p.waitForFunction(() => document.querySelector('.owner-approval')?.textContent.includes('Your decisionapproved c2'));
   check(vp, 'own approved candidate is displayed and cannot be approved or declined again', await first.locator('button, input[type=radio]').count() === 0 && (await first.textContent()).includes('Waiting for the other side'));
   check(vp, 'the private editor value never enters any API request', !JSON.stringify(requests).includes('PRIVATE-DRAFT'));
   const posts = requests.filter(r => r.path === '/api/owner/approvals');
   check(vp, 'one approval sends only task/revision/hash/decision/candidate', posts.length === 1 && posts[0].body.candidate === 'c2' && Object.keys(posts[0].body).sort().join(',') === 'candidate,contentHash,decision,revision,taskId', JSON.stringify(posts));
   await p.screenshot({path: `output/owner-inbox-${vp}.png`});
   await p.getByRole('button', {name: 'End owner session', exact: true}).click();
   await p.locator('.owner-inbox').getByText('Start the owner session', {exact: false}).waitFor();
   check(vp, 'ending the owner session removes the old owner approvals', await p.locator('.owner-inbox .owner-approval').count() === 0);
   await p.evaluate(() => window.__world.worldPanel.openTab('replay'));
   await p.locator('.replay-view').waitFor(); await p.waitForTimeout(200);
   const before = requests.length;
   await p.evaluate(() => Promise.all([window.__world.worldPanel.refresh(), window.__world.worldPanel.refresh()]));
   await p.waitForTimeout(10500);
   check(vp, 'replay manual refresh and scheduled poll make zero API requests', requests.length === before, `before=${before}, after=${requests.length}`);
   check(vp, 'no page exception', consoleErrors.length === 0, consoleErrors.join('; '));
  } catch (e) { check(vp, 'owner inbox browser scenario completed', false, e.stack ?? e); }
  finally { await ctx.close(); }
 }
 return {cases};
}
