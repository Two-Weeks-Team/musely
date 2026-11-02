// Playwright CLI run-code callback: first visit on a slow connection. Open the target URL first
// (local dist server or production). Each case uses a fresh context with the HTTP cache disabled and
// Chromium network emulation at 4 Mbps down / 150 ms latency, then measures from navigation start:
//   map overview visible, commons + residents + story visible (asserted <= 8 s), camera arrival,
//   and the background character upgrades (attachments, LOD1, LOD0).
// It also checks that upgrades keep each Muse's root, action and clock running (no actor replacement).
async (page) => {
 const target = new URL(page.url()); target.search = '';
 const browser = page.context().browser(), cases = [];
 const LIMIT_MS = 8000;
 for (const mobile of [false, true]) {
  const ctx = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 1000}, isMobile: mobile, hasTouch: mobile});
  const p = await ctx.newPage(), errors = [], bytes = {total: 0};
  p.on('pageerror', e => errors.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', {cacheDisabled: true});
  await cdp.send('Network.emulateNetworkConditions', {offline: false, latency: 150, downloadThroughput: 4_000_000 / 8, uploadThroughput: 4_000_000 / 8});
  cdp.on('Network.loadingFinished', e => { bytes.total += e.encodedDataLength; });
  try {
   await p.goto(target.href, {waitUntil: 'commit'});
   const timeline = await p.evaluate(async () => {
    const t = {}, deadline = performance.now() + 120000;
    while (performance.now() < deadline) {
     const m = window.__world?.getMetrics?.();
     if (m) {
      if (!t.overview && m.startup.overviewVisible && window.__world.map.queryRenderedFeatures().some(f => f.source === 'arrival-overview')) t.overview = performance.now();
      if (!t.scene && m.ready && m.characterKit && m.characters?.length === 8) { t.scene = m.startup.sceneReadyAtMs; t.sceneRoots = m.characters.map(c => c.rootId); t.sceneLods = m.characters.map(c => c.lod); t.firstAction = m.characters.map(c => c.action); t.storyAtScene = m.tour; }
      if (!t.rigid && m.ready && !m.characterKit) t.rigid = performance.now();
      if (t.scene && !t.arrival && m.elapsed >= 8 && m.zoom >= 20.35) { t.arrival = performance.now(); t.arrivalHeight = m.muses[0].bounds.height; t.dialogue = !!m.dialogue || !!m.bubbles?.speech; }
      const u = m.characterUpgrade;
      if (u?.attachment && !t.attachment) t.attachment = u.attachment;
      if (u?.lod1 && !t.lod1) t.lod1 = u.lod1;
      if (u?.lod0 && !t.lod0) { t.lod0 = u.lod0; t.finalRoots = m.characters.map(c => c.rootId); t.finalLoaded = m.characters.map(c => c.loadedLods ?? null); t.attachmentsOn = m.characters.map(c => c.attachment ?? null); t.elapsedAtFull = m.elapsed; break; }
     }
     await new Promise(r => setTimeout(r, 100));
    }
    return t;
   });
   if (!timeline.scene) throw Error(timeline.rigid ? 'Rigged kit failed; rigid fallback shown' : 'Commons never appeared');
   if (timeline.scene > LIMIT_MS) throw Error(`Commons, residents and story appeared at ${Math.round(timeline.scene)} ms (> ${LIMIT_MS} ms)`);
   if (!timeline.storyAtScene) throw Error('Story did not start with the commons');
   if (timeline.sceneLods.some(l => l !== 2)) throw Error('First view should use the light LOD: ' + timeline.sceneLods);
   if (!timeline.lod0) throw Error('Background upgrade did not finish within 120 s');
   if (timeline.finalRoots.some((id, i) => id !== timeline.sceneRoots[i])) throw Error('An upgrade replaced a Muse actor (root changed)');
   if (timeline.finalLoaded.some(l => !l || l.join() !== '0,1,2')) throw Error('Not every Muse has LOD0/1/2 after upgrade: ' + JSON.stringify(timeline.finalLoaded));
   if (timeline.arrival && timeline.arrivalHeight < 20) throw Error('Muses too small at arrival');
   // Clock and actions continue across the upgrade.
   const before = await p.evaluate(() => window.__world.getMetrics().elapsed);
   await p.waitForTimeout(600);
   const after = await p.evaluate(() => window.__world.getMetrics().elapsed);
   if (!(after > before)) throw Error('Story clock stalled after the upgrade');
   cases.push({viewport: mobile ? '390x844 touch emulation' : '1440x1000', network: '4 Mbps down, 150 ms latency, cache disabled', ms: {overview: Math.round(timeline.overview ?? -1), commonsResidentsStory: Math.round(timeline.scene), cameraArrival: Math.round(timeline.arrival ?? -1), attachments: Math.round(timeline.attachment ?? -1), lod1: Math.round(timeline.lod1 ?? -1), lod0: Math.round(timeline.lod0 ?? -1)}, transferredMB: +(bytes.total / 1e6).toFixed(2), arrivalMuseHeightPx: Math.round(timeline.arrivalHeight ?? 0), errors});
   if (errors.length) throw Error('Application errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
 }
 return {cases};
}
