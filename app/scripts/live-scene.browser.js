// Read-only, deterministic I-09 renderer integration. All /api traffic is local fixture GETs; writes are aborted.
// Run with the same Playwright callback runner used by actions.browser.js, against a built local dist.
async (page) => {
  const target = new URL(page.url()); target.search = '?autoplay=0';
  const context = await page.context().browser().newContext({viewport: {width: 1440, height: 1000}});
  const p = await context.newPage(), errors = [], writes = [], results = [];
  const ids = ['00-jolly', '01-sunny', '02-moss', '03-ripple', '04-ember', '05-bloom', '06-ink', '07-tempo', '08-orbit', '09-copper'];
  const now = Date.now();
  let world = {worldId: 'musely', day: '2026-11-02', tick: 10, version: 42, lastTickAt: now,
    nextSpotlight: {muse: '00-jolly', freedom: 'where'}, muses: ids.map(id => ({id, place: 'commons:cafe', travel: null, beat: null, inventory: ['coffee'], reflection: '', wants: {goal: 'Meet a neighbor', source: 'harness'}}))};
  const events = [{seq: 1, id: 'projection-trade', tick: 10, at: now - 12_000, source: 'live', kind: 'trade_completed', muse: '00-jolly', other: '01-sunny', place: 'commons:cafe', line: 'A real recorded trade', data: {give: 'coffee', want: 'pastry'}, tags: []}];
  const check = (name, ok, detail) => {results.push({name, pass: !!ok, detail}); if (!ok) throw Error(name + ': ' + JSON.stringify(detail));};
  p.on('pageerror', e => errors.push(e.message));
  await p.route('**/api/**', route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== 'GET') {writes.push({method: req.method(), path: url.pathname}); return route.abort();}
    if (url.pathname === '/api/world') return route.fulfill({json: world});
    if (url.pathname === '/api/world/events') return route.fulfill({json: events});
    return route.fulfill({status: 503, json: {error: 'read_only_projection_fixture'}});
  });
  try {
    await p.goto(target.href, {waitUntil: 'domcontentloaded'});
    await p.waitForFunction(() => window.__world?.getMetrics().ready && window.__world.getMetrics().live?.muses.length === 10 && window.__world.getMetrics().live.muses.every(m => m.rootId), null, {timeout: 90000});
    await p.evaluate(() => {window.__world.map.jumpTo({zoom: 21.7});});
    await p.waitForFunction(() => window.__world.getMetrics().live.muses.every(m => m.loadedLods.length === 3 && m.propsLoaded), null, {timeout: 90000});
    await p.waitForTimeout(1600);
    let m = await p.evaluate(() => window.__world.getMetrics());
    check('10 stable server ID actors, independent roots and snapshot version', m.live.version === 42 && m.live.muses.every(r => r.id === r.variant && r.version === 42 && r.inventory[0] === 'coffee') && new Set(m.live.muses.map(r => r.rootId)).size === 10, m.live.muses.map(r => ({id: r.id, variant: r.variant, version: r.version})));
    check('ten-character LOD0 cap remains two', m.live.muses.filter(r => r.lod === 0).length <= 2, m.live.muses.map(r => [r.id, r.lod]));
    results.push({name: '10-character scene render cost (not the C11 eight-character acceptance)', pass: true, measurement: {drawCalls: m.drawCalls, triangles: m.triangles, fps: m.fps}});
    await p.screenshot({path: 'output/live-scene-desktop.png'});
    const roots = m.live.muses.map(r => r.rootId);
    for (const id of ids) {
      await p.evaluate(id => window.__world.selectLive(id), id);
      await p.waitForTimeout(230);
      const card = await p.locator('#muse-card').evaluate(el => ({id: el.dataset.museId, version: el.dataset.version, inventory: JSON.parse(el.dataset.inventory), text: el.textContent}));
      check('selected live card ' + id, card.id === id && card.version === '42' && card.inventory[0] === 'coffee' && !card.text.includes("Jimin's"), card);
    }
    await p.evaluate(() => {window.__world.selectLive('00-jolly');window.__world.map.stop();});
    const copperPoint = await p.evaluate(() => {const W=window.__world,f=W.liveScene.frames.get('09-copper');return W.alignmentAt(f.x,f.z).modelPixel;});
    await p.mouse.click(copperPoint.x,copperPoint.y-15);await p.waitForTimeout(300);
    check('clicking the added Copper actor selects Copper', await p.locator('#muse-card').getAttribute('data-muse-id') === '09-copper', await p.locator('#muse-card').getAttribute('data-muse-id'));
    const markers = await p.locator('.muse-pin').evaluateAll(nodes => nodes.map(n => ({id: n.dataset.museId, version: n.dataset.version, owner: n.dataset.owner, inventory: JSON.parse(n.dataset.inventory)})));
    check('pins use the same IDs, version, ownership and inventory', markers.length === 10 && markers.every(m => ids.includes(m.id) && m.version === '42' && m.inventory[0] === 'coffee') && markers.find(m => m.id === '09-copper').owner === 'demo-peer', markers);
    await p.evaluate(() => window.__world.setMode('story')); await p.waitForTimeout(200);
    const story = await p.evaluate(() => ({mode: window.__world.mode, live: window.__world.getMetrics().live, source: document.getElementById('muse-source').textContent, bubbles: !document.getElementById('world-bubbles').hidden}));
    check('scripted mode is labelled and suspends live renderer', story.mode === 'story' && !story.live.active && story.source.includes('SCRIPTED') && story.bubbles, story.source);
    await p.evaluate(() => window.__world.setMode('world')); await p.waitForTimeout(200);
    m = await p.evaluate(() => window.__world.getMetrics());
    check('return from story retains actor identity and live source', m.live.active && JSON.stringify(m.live.muses.map(r => r.rootId)) === JSON.stringify(roots) && await p.locator('#muse-source').textContent().then(t => t.includes('SHARED WORLD')), m.live.version);
    world = {...world, version: 43, muses: world.muses.map(v => v.id === '03-ripple' ? {...v, travel: {to: 'commons:garden', departAt: Date.now() - 30_000, arriveAt: Date.now() + 30_000, speed: 'walk'}} : v)};
    await p.evaluate(() => window.__world.worldPanel.refresh()); await p.waitForTimeout(300);
    const trip = await p.evaluate(() => window.__world.getMetrics().live.muses.find(m => m.id === '03-ripple'));
    check('new snapshot travel drives actor/ETA without a local decision', trip.version === 43 && trip.frame.moving && trip.frame.clip === 'walk' && trip.frame.travel.etaMs > 0 && trip.frame.travel.etaMs < 31_000, trip.frame);
    const alignment = await p.evaluate(() => {const W = window.__world, pin = document.querySelector('.muse-pin[data-muse-id=\"03-ripple\"]'), f = W.liveScene.projection.frames(Number(pin.dataset.projectedAt)).get('03-ripple'); return {pin: JSON.parse(pin.dataset.lnglat), actor: W.alignmentAt(f.x, f.z).geo};});
    check('pin and actor share the exact geographic pose at the pin timestamp', alignment.pin.every((v, i) => Math.abs(v - alignment.actor[i]) < 1e-8), alignment);
    world = {...world, version: 44, muses: world.muses.map(v => v.id === '03-ripple' ? {...v, place: 'bay:sf', travel: null} : v)};
    await p.evaluate(() => window.__world.worldPanel.refresh());
    await p.evaluate(() => window.__world.map.jumpTo({zoom: 10}));
    await p.locator('#portraits button[data-muse-id="03-ripple"]').click();
    await p.waitForTimeout(1400);
    const focus = await p.evaluate(() => {const W=window.__world,f=W.liveScene.frames.get('03-ripple');return {actual:W.map.getCenter().toArray(),target:W.alignmentAt(f.x,f.z).geo};});
    check('original portrait focuses the actual remote live actor', focus.actual.every((v,i)=>Math.abs(v-focus.target[i])<1e-6),focus);
    const latest = world; world = {...world, version: 41};
    await p.evaluate(() => window.__world.worldPanel.refresh()); await p.waitForTimeout(150);
    const staleVersions = await p.locator('.muse-pin').evaluateAll(nodes => nodes.map(n => n.dataset.version));
    check('an older reply cannot rewind pins away from the actor/card version', staleVersions.every(v => v === '44'), staleVersions); world = latest;
    await p.locator('#pause').click(); await p.waitForTimeout(150);
    const pausedAt = await p.evaluate(() => window.__world.getMetrics().live.at);
    const pausedPins = await p.locator('.muse-pin').evaluateAll(nodes=>nodes.map(n=>n.dataset.lnglat));
    await p.waitForTimeout(1300);
    check('pause also holds map pins across a one-second timer', JSON.stringify(await p.locator('.muse-pin').evaluateAll(nodes=>nodes.map(n=>n.dataset.lnglat))) === JSON.stringify(pausedPins), pausedPins);
    check('pause freezes this view without writing to the shared world', await p.evaluate(at => window.__world.getMetrics().live.at === at, pausedAt), pausedAt);
    await p.locator('#pause').click();
    await p.evaluate(() => {window.__world.map.stop();window.__world.map.jumpTo({zoom: 21.7});});
    for (const viewport of [{width: 390, height: 844}, {width: 360, height: 640}, {width: 1280, height: 800}]) {
      await p.setViewportSize(viewport); await p.waitForTimeout(250);
      const layout = await p.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth, portraits: [...document.querySelectorAll('#portraits button')].map(b => {const r = b.getBoundingClientRect(); return {x: r.x, right: r.right, width: r.width};})}));
      await p.screenshot({path: 'output/live-scene-' + viewport.width + 'x' + viewport.height + '.png'});
      check('10-Muse footer fits ' + viewport.width, !layout.overflow && layout.portraits.every(r => r.x >= 0 && r.right <= viewport.width), layout);
    }
    check('live projection performs no writes', writes.length === 0, writes);
    check('no application exceptions', errors.length === 0, errors);
    return {fixture: 'I-09 deterministic read-only renderer, not a production acceptance', results, errors, writes};
  } finally {await context.close();}
}
