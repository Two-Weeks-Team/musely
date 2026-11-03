// Playwright CLI run-code callback (local or production): closing the ritual mid-countdown stops the camera and
// uploads nothing. Server calls are mocked here, so it runs on a static dist server too.
async (page) => {
 const target = new URL(page.url()); target.search = '?autoplay=0';
 const ctx = await page.context().browser().newContext({viewport: {width: 1280, height: 900}});
 const p = await ctx.newPage();
 let posts = 0;
 await p.route('**/api/ritual/start', r => r.fulfill({json: {id: 'mock', steps: [{id: 'thumbs_up', text: 'show a thumbs-up'}, {id: 'touch_nose', text: 'touch your nose'}, {id: 'show_open_palm', text: 'show an open palm'}], expiresAt: Date.now() + 180000}}));
 await p.route('**/api/muse', r => { posts++; return r.fulfill({json: {source: 'live', output: {results: []}}}); });
 await p.route('**/api/status', r => r.fulfill({json: {model: {connected: true, live: true, id: 'm'}, budget: {}, turnstile: {sitekey: 'x', configured: true}, session: {tier: 'judge', expiresAt: Date.now() + 1e6, quota: {perHour: 1, usedThisHour: 0}}, aiGateway: false}}));
 await p.addInitScript(() => {
  window.__trackStopped = 0;
  const c = document.createElement('canvas'); c.width = 64; c.height = 48; const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#' + (Date.now() % 4096).toString(16).padStart(3, '0'); g.fillRect(0, 0, 64, 48); }, 100);
  navigator.mediaDevices.getUserMedia = async () => { const s = c.captureStream(5); s.getTracks().forEach(t => { const stop = t.stop.bind(t); t.stop = () => { window.__trackStopped++; stop(); }; }); return s; };
 });
 try {
  await p.goto(target.href, {waitUntil: 'domcontentloaded'});
  await p.waitForFunction(() => document.body.dataset.worldReady === '1', null, {timeout: 30000});
  await p.locator('#world-open').click();
  await p.locator('#world-panel .tab[data-tab="identity"]').click();
  await p.locator('.ritual button', {hasText: 'Try the ritual'}).click();
  await p.getByRole('button', {name: '준비됐어요 · Ready', exact: true}).click();
  await p.getByRole('button', {name: '동작 준비됐어요 · Ready for this move', exact: true}).click();
  await p.waitForTimeout(1200);
  await p.locator('#world-panel .tab[data-tab="feed"]').click();   // dismiss mid-countdown
  await p.waitForTimeout(5000);
  const stopped = await p.evaluate(() => window.__trackStopped);
  if (posts !== 0) throw Error('Frames were uploaded after the ritual was dismissed: ' + posts);
  if (stopped < 1) throw Error('Camera track was not stopped');
  return {posts, stopped};
 } finally { await ctx.close(); }
}
