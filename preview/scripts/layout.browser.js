// Playwright CLI run-code callback: layout on real phone and tablet sizes, and times in the viewer's own time zone. Open the target URL first.
// Layout (default URL, the Story plays): for 17 viewport sizes (phones, a short phone, a landscape phone, tablets, a foldable width, desktop)
// the story is moved through its whole length in steps and at every step: the page is as wide as the screen (a wider page makes mobile
// Chrome shrink everything), the selected-Muse card does not cover the header or the footer and stays on the screen, and the story heading
// does not cover the header or the card. On a screen too short for the card (under 520 px tall) the card is hidden and the selected Muse is still named
// under the portraits.
// Time zone: the Replay fixture and its evidence show times in the viewer's zone (Seoul, London, Los Angeles), labelled "your time", and
// the time-of-day filter follows the same zone. The world itself keeps Menlo Park time for its day; only what is shown is converted.
async (page) => {
 const base = new URL(page.url()); base.search = '';
 const browser = page.context().browser(), cases = [];
 const check = (vp, name, ok, detail = '') => cases.push({vp, name, ok: !!ok, detail: String(detail).slice(0, 260)});
 const hit = (a, b) => a && b && a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
 const SIZES = [[320, 568, 2], [360, 640, 3], [360, 520, 3], [390, 844, 3], [416, 579, 3], [412, 732, 2.6], [600, 900, 2], [701, 900, 2], [768, 1024, 2], [820, 1180, 2], [886, 600, 2], [1000, 680, 2], [1100, 700, 2], [1280, 800, 1], [667, 375, 3], [740, 360, 3], [1440, 900, 1]];
 for (const [w, h, dpr] of SIZES) {
  const vp = `${w}x${h}`;
  const ctx = await browser.newContext({viewport: {width: w, height: h}, isMobile: w < 1100, hasTouch: w < 1100, deviceScaleFactor: dpr});
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  try {
   await p.goto(base.href, {waitUntil: 'domcontentloaded', timeout: 90000});
   await p.waitForFunction(() => window.__world?.getMetrics().ready, null, {timeout: 90000});
   await p.waitForTimeout(2500);
   const bad = new Set(); let maxCard = 0, shownCard = 0;
   for (let t = 0; t <= 205; t += 7) {
    await p.evaluate(t => window.__world.seek(t), t); await p.waitForTimeout(150);
    const m = await p.evaluate(() => { const r = s => { const e = document.querySelector(s); if (!e || e.hidden) return null; if (getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width ? [b.x, b.y, b.width, b.height] : null; }; return {inner: innerWidth, scrollW: document.documentElement.scrollWidth, header: r('header'), card: r('#muse-card'), footer: r('footer'), story: r('#story-heading')}; });
    if (m.inner !== w || m.scrollW > w) bad.add(`width ${m.inner}/${m.scrollW}`);
    if (hit(m.card, m.header)) bad.add('card over header');
    if (hit(m.card, m.footer)) bad.add('card over footer');
    if (m.card && (m.card[1] < 0 || m.card[1] + m.card[3] > h + 1)) bad.add('card outside the screen');
    if (hit(m.story, m.header)) bad.add('story heading over header');
    if (hit(m.story, m.card)) bad.add('story heading over card');
    if (m.card) { maxCard = Math.max(maxCard, m.card[3]); shownCard++; }
   }
   check(vp, 'layout through the whole story: page as wide as the screen, card clear of header and footer, nothing outside', bad.size === 0, [...bad].join(' | ') || `card up to ${Math.round(maxCard)} px`);
   if (h < 520) {
    const line = await p.evaluate(() => { const e = document.getElementById('selected-line'); return e && getComputedStyle(e).display !== 'none' ? e.textContent : ''; });
    check(vp, 'a screen too short for the card hides it and still names the selected Muse', shownCard === 0 && /Muse/.test(line), line.slice(0, 60));
   }
   check(vp, 'no page errors', errors.length === 0, errors.join(' / '));
  } catch (e) { check(vp, 'run', false, String(e).split('\n')[0]); }
  await ctx.close();
 }

 // ---------- time in the viewer's own time zone ----------
 const fmt = (tz, at) => new Intl.DateTimeFormat('en-US', {timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(at);
 const part = (tz, at) => { const h = Number(new Intl.DateTimeFormat('en-US', {timeZone: tz, hour: 'numeric', hourCycle: 'h23'}).format(at)); return h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };
 for (const [tz, locale] of [['Asia/Seoul', 'ko-KR'], ['Europe/London', 'en-GB'], ['America/Los_Angeles', 'en-US']]) {
  const vp = tz;
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: tz, locale});
  const p = await ctx.newPage();
  try {
   await p.goto(new URL('?autoplay=0', base).href, {waitUntil: 'domcontentloaded', timeout: 90000});
   await p.waitForFunction(() => window.__world?.getMetrics().ready, null, {timeout: 90000});
   await p.click('#world-open'); await p.waitForSelector('#world-panel:popover-open');
   await p.click('#world-panel .tab[data-tab="replay"]'); await p.waitForSelector('.replay-view');
   await p.locator('[aria-label="Replay position"]').focus(); await p.keyboard.press('End'); await p.waitForTimeout(300);
   const row = p.locator('.replay-view .ev-btn').first(), rowTime = (await row.locator('.ev-time').textContent()).trim();
   await row.click(); await p.waitForSelector('#evidence:popover-open');
   const ev = await p.locator('#evidence').textContent(), at = JSON.parse(await p.locator('#evidence pre').textContent()).at;
   check(vp, 'a row and its evidence show the event\'s time in the viewer\'s zone', rowTime === fmt(tz, at) && ev.includes(`When (your time · ${tz})`) && ev.includes(fmt(tz, at)), `${rowTime} expected ${fmt(tz, at)}`);
   await p.locator('#evidence .close').click(); await p.waitForFunction(() => !document.getElementById('evidence').matches(':popover-open'));
   await p.locator('[aria-label="Replay position"]').focus(); await p.keyboard.press('Home'); await p.waitForTimeout(200);
   const line = await p.locator('.replay-time').textContent(), first = await p.evaluate(() => 0);
   check(vp, 'the replay clock says "your time", not Menlo Park', /your time$/.test(line.trim()) && !/Menlo Park/.test(line), line.trim());
   // The time-of-day filter uses the same zone: every fixture event falls in one part of the day for this viewer.
   await p.locator('[aria-label="Replay position"]').focus(); await p.keyboard.press('End'); await p.waitForTimeout(250);
   const expectPart = part(tz, at);
   await p.locator('.replay-view .replay-select', {hasText: 'Time of day'}).locator('select').selectOption(expectPart); await p.waitForTimeout(200);
   const n = await p.locator('.replay-view .ev-list li').count();
   check(vp, 'the time-of-day filter follows the viewer\'s zone', n > 0, `${expectPart}: ${n} moments`);
  } catch (e) { check(vp, 'run', false, String(e).split('\n')[0]); }
  await ctx.close();
 }
 return {ok: cases.every(c => c.ok), cases};
}
