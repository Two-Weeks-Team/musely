// Playwright CLI run-code callback for the live world surface (task 6). Open the page first: production, or a
// local dist served with `node scripts/serve-dist.mjs 8788 --api https://preview.musely.net` (real data).
// Desktop and 390x844 touch emulation: pins, spotlight chip, every panel tab, evidence (P2) with a request id,
// claim card, autonomy table, location card; the panel stays inside the viewport. Saves screenshots to output/.
async (page) => {
 const base = new URL(page.url()); base.search = '?autoplay=0';
 const browser = page.context().browser(), cases = [];
 for (const mobile of [false, true]) {
  const ctx = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 1000}, isMobile: mobile, hasTouch: mobile});
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  try {
   await p.goto(base.href, {waitUntil: 'domcontentloaded'});
   await p.waitForFunction(() => document.body.dataset.worldReady === '1', null, {timeout: 30000});
   const chip = await p.locator('#spot-chip').textContent();
   if (!/^Spotlight · \w+ next · (where|who|offer|plan)/.test(chip)) throw Error('Spotlight chip: ' + chip);
   const pins = await p.locator('.muse-pin').count();
   if (pins !== 10) throw Error('Expected 10 Muse pins, got ' + pins);
   await p.locator('#world-open').click();
   await p.waitForSelector('#world-panel:popover-open');
   const box = await p.locator('#world-panel').boundingBox(), vw = mobile ? 390 : 1440;
   if (box.x < 0 || box.x + box.width > vw + 1) throw Error('Panel overflows the viewport: ' + JSON.stringify(box));
   const out = {viewport: mobile ? '390x844 touch emulation' : '1440x1000', chip, pins};
   // Feed: rows with source badges; open the evidence of a live Muse Spark decision.
   await p.waitForSelector('#world-panel .ev-btn', {timeout: 15000});
   out.feedRows = await p.locator('#world-panel .ev-btn').count();
   out.sources = await p.locator('#world-panel .ev-btn .src').evaluateAll(n => [...new Set(n.map(x => x.textContent))]);
   const liveRow = p.locator('#world-panel .ev-btn', {hasText: 'LIVE · Muse Spark'}).first();
   if (await liveRow.count()) {
    await liveRow.click();
    await p.waitForSelector('#evidence:popover-open');
    const ev = await p.locator('#evidence').textContent();
    if (!/Request id/.test(ev)) throw Error('Evidence lacks a request id: ' + ev.slice(0, 200));
    out.evidence = 'request id shown';
    await p.screenshot({path: `output/world-ui-evidence-${mobile ? 'mobile' : 'desktop'}.png`});
    await p.locator('#evidence .close').click();
   }
   await p.screenshot({path: `output/world-ui-feed-${mobile ? 'mobile' : 'desktop'}.png`});
   for (const [tab, expect] of [['highlights', /p0 trade|p0 refused|first trade|impostor rejected|injection blocked|off script/i], ['p1', /Engine, run in this browser/], ['autonomy', /Signature checks/], ['identity', /Claimed|pending_claim/], ['location', /Muse's current place/]]) {
    await p.locator(`#world-panel .tab[data-tab="${tab}"]`).click();
    await p.waitForFunction(re => new RegExp(re, 'i').test(document.querySelector('.world-body')?.textContent ?? ''), expect.source, {timeout: 30000});
    out[tab] = (await p.locator('.world-body').textContent()).replace(/\s+/g, ' ').slice(0, 140);
    // No email address may appear on any public screen (contact is Threads @combba82 only).
    const emails = await p.evaluate(() => (document.body.innerText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []));
    if (emails.length) throw Error(`Email shown on screen (${tab}): ` + emails.join(', '));
    if (tab === 'autonomy' && (await p.locator('.world-body table.data tr').count()) !== 6) throw Error('Autonomy table must have 6 rows');
    await p.screenshot({path: `output/world-ui-${tab}-${mobile ? 'mobile' : 'desktop'}.png`});
   }
   // A slow tab render must not leak into the tab selected after it (generation guard).
   await p.locator('#world-panel .tab[data-tab="highlights"]').click();
   await p.locator('#world-panel .tab[data-tab="feed"]').click();
   await p.waitForTimeout(2500);
   if (await p.locator('.world-body .filter').count()) throw Error('Highlights content leaked into Feed');
   cases.push({...out, errors});
   if (errors.length) throw Error('Page errors: ' + errors.join('; '));
  } finally { await ctx.close(); }
 }
 return {cases};
}
