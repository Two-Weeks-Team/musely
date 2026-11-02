// Actual RunRecord UI and route spy. Run npm run build, then node scripts/build-replay-fixture.mjs before serving dist.
// The fixture is written through WorldRuntime/RunLog in local SQLite, not a live model/account acceptance receipt.
async (page) => {
 const base = new URL(page.url()); base.search = '?autoplay=0';
 const fixtureResponse = await fetch(new URL('replay-test.json', base).href);
 if (!fixtureResponse.ok) throw new Error('Run node scripts/build-replay-fixture.mjs before this browser test');
 const template = await fixtureResponse.json(), cases = [], browser = page.context().browser();
 const check = (vp, name, ok, detail = '') => cases.push({vp, name, ok: !!ok, detail: String(detail).slice(0, 400)});
 for (const [width, height] of [[1280, 800], [390, 844]]) {
  const vp = `${width}x${height}`, context = await browser.newContext({viewport: {width, height}}), p = await context.newPage();
  const requests = [], allRequests = [], errors = []; p.on('request', r => allRequests.push({method: r.method(), url: r.url()})); p.on('pageerror', e => errors.push(e.message));
  const ids = ['normal', 'old-v1', 'bad-hash', 'missing', 'empty', 'failed'];
  const record = id => {
   const r = structuredClone(template); r.runId = id;
   r.inputs.forEach(i => i.runId = id); r.events.forEach(e => e.runId = id);
   if (id === 'old-v1') r.schemaVersion = 'run-log-1';
   if (id === 'bad-hash') r.inputs[0].afterSnapshot.body += ' ';
   if (id === 'missing') { r.inputs[0].afterSnapshot = null; r.inputs[0].afterSnapshotError = 'replay_storage_limit'; }
   if (id === 'empty') { r.inputs = []; r.events = []; r.readThrough = {inputSeq: 0, eventSeq: 0, inputs: 0, events: 0}; }
   return r;
  };
  await p.route('**/*', async route => {
   const req = route.request(), u = new URL(req.url()), path = u.pathname, id = u.searchParams.get('runId') ?? 'normal'; if (!path.startsWith('/api/') && path !== '/mcp') return route.continue(); requests.push({path, method: req.method(), search: u.search});
   const send = (status, body) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
   if (req.method() !== 'GET') return send(405, {error: 'browser_fixture_write_forbidden'});
   if (path === '/api/world/run') {
    if (!u.searchParams.has('runId')) return send(200, {runId: 'normal', runs: ids.map(runId => ({runId, startedAt: template.startedAt, schemaVersion: runId === 'old-v1' ? 'run-log-1' : template.schemaVersion, engineVersion: template.engineVersion}))});
    if (id === 'failed') return send(503, {error: 'temporary_failure'});
    const {inputs, events, ...head} = record(id); return send(200, head);
   }
   if (path === '/api/world/run/inputs') return send(200, record(id).inputs.filter(i => i.seq > Number(u.searchParams.get('since') ?? 0)));
   if (path === '/api/world/events') return send(200, u.searchParams.has('runId') ? record(id).events.filter(i => i.seq > Number(u.searchParams.get('since') ?? 0)) : []);
   if (path === '/api/world') return send(200, {worldId: 'live-browser-fixture', day: '2026-11-02', tick: 1, lastTickAt: Date.now(), nextSpotlight: {muse: '00-jolly', freedom: 'goal'}, muses: []});
   if (path === '/api/status') return send(200, {model: {id: 'fixture', connected: false, live: false}, budget: {remainingUsd: 0}, turnstile: {configured: false}, session: null});
   return send(404, {error: 'read_fixture_not_implemented'});
  });
  try {
   await p.goto(base.href, {waitUntil: 'domcontentloaded'}); await p.waitForFunction(() => !!window.__world?.worldPanel, null, {timeout: 40000});
   await p.evaluate(() => { window.__replayFrames = []; window.__world.worldPanel.onReplayFrame(f => window.__replayFrames.push(f ? {hash: f.snapshotHash, replay: f.replay, runId: f.runId} : null)); window.__world.worldPanel.openTab('replay'); });
   await p.locator('.replay-view').waitFor(); await p.waitForTimeout(200);
   const root = p.locator('.recorded-replay'), beforeFixture = requests.length;
   await p.evaluate(() => window.__world.worldPanel.refresh()); await p.waitForTimeout(200);
   check(vp, 'scripted fixture still makes no record or live requests', requests.length === beforeFixture);
   await root.getByRole('button', {name: 'Find recorded runs', exact: true}).click();
   await root.locator('select[aria-label="Recorded run"] option[value=normal]').waitFor({state: 'attached'});
   await root.getByRole('button', {name: 'Load recorded run', exact: true}).click(); await p.waitForFunction(() => document.querySelector('.recorded-replay').dataset.status === 'ready');
   check(vp, 'actual recorded run is explicitly replay and the fixture is hidden', (await root.textContent()).includes('REPLAY · RECORDED WORLD') && await p.locator('.fixture-replay').evaluate(e => e.hidden));
   const afterLoad = requests.length, expected = template.inputs.at(-1).afterHash;
   for (const speed of [1, 10, 60]) {
    await root.getByRole('button', {name: 'Restart recorded run', exact: true}).click();
    await root.locator(`[data-recorded-speed="${speed}"]`).click(); await root.getByRole('button', {name: 'Play recorded run', exact: true}).click();
    await p.waitForFunction(() => document.querySelector('.recorded-replay [role=status]')?.textContent.includes('Reached the recorded end') || document.querySelector('.recorded-replay').textContent.includes('Reached the recorded end'), null, {timeout: 10000});
    check(vp, `${speed}x reaches the exact stored public end hash without new rewards`, await root.getAttribute('data-snapshot-hash') === expected);
   }
   const position = root.getByLabel('Recorded replay position');
   await position.fill('0'); await position.dispatchEvent('input'); check(vp, 'backward seek restores the initial public hash', await root.getAttribute('data-snapshot-hash') === template.initialSnapshot.hash);
   await position.fill('1'); await position.dispatchEvent('input'); check(vp, 'seek restores the first committed public hash', await root.getAttribute('data-snapshot-hash') === template.inputs[0].afterHash);
   await root.locator('[data-recorded-speed="1"]').click(); await root.getByRole('button', {name: 'Play recorded run', exact: true}).click();
   await root.locator('[data-event-id]').first().click(); await p.locator('#evidence').waitFor();
   const evidence = await p.locator('#evidence').textContent();
   check(vp, 'evidence uses cached run/commit/model references without fetching or authenticating', evidence.includes('fixture-request-id') && evidence.includes('Recorded run') && evidence.includes('Recorded commit') && evidence.includes('REPLAY') && requests.length === afterLoad, evidence.slice(-300));
   await p.getByRole('button', {name: 'Close evidence', exact: true}).click();
   await p.waitForTimeout(150); check(vp, 'evidence close returns to and resumes the recorded clock', await root.getByRole('button', {name: 'Pause recorded run', exact: true}).count() === 1);
   await root.getByRole('button', {name: 'Pause recorded run', exact: true}).click();
   await p.evaluate(() => window.__world.worldPanel.refresh()); await p.waitForTimeout(10500);
   check(vp, 'loaded replay controls, evidence and scheduled/manual polling use zero additional API requests', requests.length === afterLoad, `${afterLoad} -> ${requests.length}`);
   await p.evaluate(() => Promise.all([fetch('/api/muse', {method: 'POST'}).catch(() => null), fetch('/mcp', {method: 'POST'}).catch(() => null)]));
   check(vp, 'replay barrier refuses explicit model and MCP writes before they reach the network', requests.length === afterLoad);
   check(vp, 'frame callback carries read-only recorded projections', await p.evaluate(() => window.__replayFrames.some(f => f?.replay && f.runId === 'normal')));
   await p.screenshot({path: `output/run-replay-${vp}.png`});
   for (const [id, error] of [['old-v1', 'incompatible_record'], ['bad-hash', 'invalid_record'], ['missing', 'incomplete_record'], ['failed', 'load_failed']]) {
    await root.getByLabel('Recorded run', {exact: true}).selectOption(id); await root.getByRole('button', {name: 'Load recorded run', exact: true}).click();
    await p.waitForFunction(() => document.querySelector('.recorded-replay').dataset.status === 'error');
    check(vp, `${id} is an explicit ${error}, never an empty successful run`, await root.getAttribute('data-error') === error);
   }
   await root.getByLabel('Recorded run', {exact: true}).selectOption('empty'); await root.getByRole('button', {name: 'Load recorded run', exact: true}).click();
   await p.waitForFunction(() => document.querySelector('.recorded-replay').dataset.status === 'empty');
   check(vp, 'a genuinely empty record keeps its initial public scene and says snapshot-only', await root.locator('.recorded-state tbody tr').count() === 10 && (await root.textContent()).includes('initial public snapshot'));
   const beforeLive = requests.length; await root.getByRole('button', {name: 'Return to live world', exact: true}).click();
   await p.waitForFunction(() => !!document.querySelector('.world-tabs [data-tab=feed].active')); await p.waitForTimeout(200);
   check(vp, 'return to live clears recorded projection and starts fresh live GETs', requests.length > beforeLive && await p.evaluate(() => window.__replayFrames.at(-1) === null));
   check(vp, 'all recorded loading/playing/evidence operations made zero writes, model or MCP calls', requests.every(r => r.method === 'GET' && !['/api/muse', '/mcp', '/api/owner/approvals', '/api/session'].includes(r.path)) && allRequests.every(r => r.method === 'GET' && !/api\.meta\.ai|\/mcp(?:\?|$)/.test(r.url)));
   check(vp, 'no page exception', errors.length === 0, errors.join('; '));
  } catch (e) { check(vp, 'recorded replay browser scenario completed', false, e.stack ?? e); }
  finally { await context.close(); }
 }
 return {cases};
}
