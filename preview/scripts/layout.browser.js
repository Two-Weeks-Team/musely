// Playwright CLI run-code callback: layout on real phone and tablet sizes, and times in the viewer's own time zone. Open the target URL first.
// Layout: for 25 viewport sizes (phones, a short phone, landscape phones, tablets, a foldable width, desktop) the page is checked twice:
//  - the default URL (the Story plays): the story is moved through its whole length in steps and at every step the page is measured;
//  - world mode (?autoplay=0, a Muse picked so the card shows), where the header is at its tallest on a phone.
// At every measurement: the page is as wide as the screen (a wider page makes mobile Chrome shrink everything); header and footer exist; the
// selected-Muse card, the story heading, the map buttons and the scene caption do not cover each other, the header or the footer; the card
// keeps 8 px from both and stays on the screen; and Follow and the meet-up plan can be pressed (the point at their centre is the button itself,
// not something drawn over it). On a screen under 520 px tall, or a phone at most 360 px wide and 600 px tall, the card is a compact strip, not hidden.
// Time zone: the Replay fixture and its evidence show times in the viewer's zone (Seoul, London, Los Angeles), labelled "your time", the
// evidence names the day too, and the time-of-day filter follows the same zone. The world keeps Menlo Park time for its day; only what is shown is converted.
async (page) => {
 const base = new URL(page.url()); base.search = '';
 const browser = page.context().browser(), cases = [];
 const check = (vp, name, ok, detail = '') => cases.push({vp, name, ok: !!ok, detail: String(detail).slice(0, 260)});
 const hit = (a, b) => !!a && !!b && a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
 const SIZES = [[320, 568, 2], [360, 640, 3], [360, 520, 3], [375, 667, 2], [390, 844, 3], [416, 579, 3], [412, 732, 2.6], [600, 900, 2], [701, 900, 2], [768, 1024, 2], [820, 1180, 2], [886, 600, 2], [1000, 680, 2], [1024, 768, 2], [1080, 810, 2], [1100, 700, 2], [1181, 700, 2], [1194, 834, 2], [1280, 800, 1], [1366, 1024, 1], [667, 375, 3], [740, 360, 3], [844, 390, 3], [932, 430, 3], [1440, 900, 1]];
 // Everything one measurement needs, read in the page. Rectangles are [x, y, width, height]; null when the element is absent or not shown.
 const measure = () => {
  const r = s => { const e = document.querySelector(s); if (!e || e.hidden || getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width ? [b.x, b.y, b.width, b.height] : null; };
  const press = id => { const e = document.getElementById(id); if (!e) return false; if (e.hidden) return null; /* not offered for this Muse */ const b = e.getBoundingClientRect(); if (!b.width) return false; const x = b.x + b.width / 2, y = b.y + b.height / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false; const top = document.elementFromPoint(x, y); return !!top && (top === e || e.contains(top)); };
  const card = r('#muse-card');
  const body = document.querySelector('#muse-card .card-body');
  const candWanted = !document.getElementById('story-candidate').hidden, inCard = !!r('#card-candidate');
  return {inner: innerWidth, scrollW: document.documentElement.scrollWidth, bodyShown: !!body && getComputedStyle(body).display !== 'none', bodyHeight: body ? body.getBoundingClientRect().height : 0, candWanted, cand: r('#card-candidate') || r('#story-candidate'), candInCard: inCard, header: r('header'), footer: r('footer'), card, story: r('#story-heading'), tools: r('.map-tools'), caption: r('.world-caption'), follow: card ? press('follow') : null, meetup: card ? press('meetup') : null};
 };
 const strip = (w, h) => h <= 520 || (w <= 360 && h <= 600); // the sizes where the card is a compact strip (style.css)
 const judge = (m, w, h, story) => {
  const bad = [];
  if (!m.header || !m.footer) bad.push('header or footer missing');
  if (m.inner !== w || m.scrollW > w) bad.push(`width ${m.inner}/${m.scrollW}`);
  for (const [a, b] of [['card', 'header'], ['card', 'footer'], ['card', 'tools'], ['tools', 'header'], ['tools', 'footer'], ['story', 'header'], ['story', 'footer'], ['story', 'card'], ['story', 'tools'], ['caption', 'story'], ['caption', 'card']]) if (hit(m[a], m[b])) bad.push(`${a} over ${b}`);
  const c = m.card;
  if (story && m.candWanted) { // the meet-up line (time, place, who said yes) has to be on screen, and inside the card when it is shown there
   const k = m.cand;
   if (!k) bad.push('the meet-up line is not on screen');
   else {
    if (k[0] < 0 || k[0] + k[2] > w + 1 || k[1] < 0 || k[1] + k[3] > h + 1) bad.push('the meet-up line is outside the screen');
    if (m.candInCard && c && (k[1] < c[1] - 1 || k[1] + k[3] > c[1] + c[3] + 1)) bad.push('the meet-up line is cut off by the card');
    if (!m.candInCard) for (const o of ['header', 'footer', 'tools', 'card']) if (hit(k, m[o])) bad.push(`the meet-up line over ${o}`);
   }
  }
  if (c) {
   if (c[0] < 0 || c[0] + c[2] > w + 1 || c[1] < 0 || c[1] + c[3] > h + 1) bad.push('card outside the screen');
   if (m.header && c[1] < m.header[1] + m.header[3] + 8) bad.push('card within 8 px of the header');
   if (m.footer && c[1] + c[3] > m.footer[1] - 8) bad.push('card within 8 px of the footer');
   if (strip(w, h) && m.bodyShown) bad.push('the full card shows where only the compact strip fits');
   if (!strip(w, h) && (!m.bodyShown || m.bodyHeight < 24)) bad.push(`the card text is squeezed to ${Math.round(m.bodyHeight)} px`);
   if (m.follow === false) bad.push('Follow cannot be pressed');
   if (m.meetup === false) bad.push('the meet-up plan cannot be pressed');
  }
  return bad;
 };
 for (const [w, h, dpr] of SIZES) {
  const vp = `${w}x${h}`;
  const ctx = await browser.newContext({viewport: {width: w, height: h}, isMobile: w < 1100, hasTouch: w < 1100, deviceScaleFactor: dpr});
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  try {
   // ---------- the Story, through its whole length ----------
   await p.goto(base.href, {waitUntil: 'domcontentloaded', timeout: 90000});
   await p.waitForFunction(() => window.__world?.getMetrics().ready, null, {timeout: 90000});
   await p.waitForTimeout(2500);
   const bad = new Set(); let maxCard = 0, shownCard = 0, steps = 0, meetupSteps = 0, candSteps = 0;
   for (let t = 0; t <= 205; t += 7) {
    await p.evaluate(t => window.__world.seek(t), t); await p.waitForTimeout(150);
    const m = await p.evaluate(measure);
    steps++; for (const b of judge(m, w, h, true)) bad.add(b);
    if (m.card) { maxCard = Math.max(maxCard, m.card[3]); shownCard++; }
    if (m.meetup === true) meetupSteps++;
    if (m.candWanted) candSteps++;
   }
   // A card that never shows would pass every pair check above, so it has to show for a real part of the story.
   if (shownCard < 10) bad.add(`the card showed in only ${shownCard} of ${steps} steps`);
   // Pressable checks that skip hidden buttons, or a meet-up line that never appears, would pass without testing anything.
   if (meetupSteps < 2) bad.add(`the meet-up plan was offered in only ${meetupSteps} steps`);
   if (candSteps < 2) bad.add(`the meet-up line appeared in only ${candSteps} steps`);
   check(vp, 'story: page as wide as the screen; card, heading, map buttons clear of each other, the header and the footer; Follow and the meet-up plan pressable', bad.size === 0, [...bad].join(' | ') || `card up to ${Math.round(maxCard)} px, shown in ${shownCard} of ${steps} steps, meet-up plan in ${meetupSteps}, meet-up line in ${candSteps}`);
   if (strip(w, h)) check(vp, 'story: a screen too small for the full card shows it as a compact strip, not hidden', shownCard >= 10, `card up to ${Math.round(maxCard)} px, shown in ${shownCard} steps`);

   // ---------- world mode, a Muse picked ----------
   await p.close(); // one WebGL page at a time
   const q = await ctx.newPage(); q.on('pageerror', e => errors.push(e.message));
   await q.goto(new URL('?autoplay=0', base).href, {waitUntil: 'domcontentloaded', timeout: 90000});
   await q.waitForFunction(() => window.__world?.getMetrics().ready, null, {timeout: 90000});
   await q.waitForTimeout(1500);
   await q.locator('#portraits button').first().click(); // the first Muse is the one that offers the meet-up plan
   const shown = await q.waitForFunction(() => { const e = document.getElementById('muse-card'); return !!e && !e.hidden; }, null, {timeout: 15000}).then(() => true, () => false);
   await q.waitForTimeout(600);
   const mw = await q.evaluate(measure), badW = new Set(judge(mw, w, h, false));
   if (mw.meetup !== true) badW.add('the first Muse does not offer the meet-up plan');
   if (!shown || !mw.card) badW.add('the card did not show after picking a Muse');
   check(vp, 'world mode: same layout checks with a Muse picked', badW.size === 0, [...badW].join(' | ') || `card ${Math.round(mw.card[3])} px tall`);
   check(vp, 'no page errors', errors.length === 0, errors.join(' / '));
  } catch (e) { check(vp, 'run', false, String(e).split('\n')[0]); }
  await ctx.close();
 }

 // ---------- time in the viewer's own time zone ----------
 const START = 1793552400000; // fixtures/replay-run.json startAt (2026-11-01T17:00:00Z); replay.test.mjs pins the fixture to this day and hour
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
   const day = new Intl.DateTimeFormat(locale, {timeZone: tz, month: 'short', day: 'numeric'}).format(at);
   check(vp, 'a row and its evidence show the event\'s time, and its day, in the viewer\'s zone', rowTime === fmt(tz, at) && ev.includes(`When (your time · ${tz})`) && ev.includes(`${day}, ${fmt(tz, at)}`), `${rowTime} expected ${fmt(tz, at)}, day ${day}`);
   await p.locator('#evidence .close').click(); await p.waitForFunction(() => !document.getElementById('evidence').matches(':popover-open'));
   await p.locator('[aria-label="Replay position"]').focus(); await p.keyboard.press('Home'); await p.waitForTimeout(200);
   const line = (await p.locator('.replay-time').textContent()).trim();
   check(vp, 'the replay clock shows the run\'s start in the viewer\'s zone and says "your time", not Menlo Park', line.endsWith(`${fmt(tz, START)} your time`) && !/Menlo Park/.test(line), line);
   // The time-of-day filter uses the same zone: every fixture event falls in one part of the day for this viewer.
   await p.locator('[aria-label="Replay position"]').focus(); await p.keyboard.press('End'); await p.waitForTimeout(250);
   const expectPart = part(tz, at), others = ['night', 'morning', 'afternoon', 'evening'].filter(x => x !== expectPart);
   const sel = p.locator('.replay-view .replay-select', {hasText: 'Time of day (your time)'}).locator('select');
   await sel.selectOption(expectPart); await p.waitForTimeout(200);
   const n = await p.locator('.replay-view .ev-list li').count();
   const counts = [];
   for (const o of others) { await sel.selectOption(o); await p.waitForTimeout(200); counts.push(await p.locator('.replay-view .ev-list li').count()); }
   check(vp, 'the time-of-day filter follows the viewer\'s zone (this part has moments, the other three have none)', n > 0 && counts.every(x => x === 0), `${expectPart}: ${n} moments; ${others.map((o, i) => `${o}: ${counts[i]}`).join(', ')}`);
   // ---------- Feed and Highlights with events either side of the viewer's midnight (served from a stub, so the day is the same on every run) ----------
   const T0 = Date.UTC(2026, 10, 1, 14, 50); // 23:50 on Nov 1 in Seoul, 14:50 in London, 07:50 in Los Angeles
   const stub = (n, min) => ({seq: n, id: `2026-11-01:${n}:0`, tick: n, at: T0 + min * 60000, source: 'scripted', kind: 'spotlight', muse: '00-jolly', other: null, place: 'commons:benches', line: `Line ${n}`, data: {}, tags: ['first_trade']});
   const evs = [stub(1, 0), stub(2, 20), stub(3, 30)];
   const dayOf = ms => new Intl.DateTimeFormat(locale, {timeZone: tz, month: 'short', day: 'numeric'}).format(ms);
   const days = [...new Set(evs.map(e => dayOf(e.at)))];
   const f = await ctx.newPage();
   await f.route('**/api/world/events*', r => r.fulfill({json: evs}));
   await f.route('**/api/world/highlights*', r => r.fulfill({json: evs}));
   await f.goto(new URL('?autoplay=0', base).href, {waitUntil: 'domcontentloaded', timeout: 90000});
   await f.waitForFunction(() => window.__world?.getMetrics().ready, null, {timeout: 90000});
   await f.click('#world-open'); await f.waitForSelector('#world-panel:popover-open'); await f.waitForSelector('.ev-list .ev-btn');
   const heads = (await f.locator('.ev-list .ev-day').allTextContents()).map(x => x.trim()), expectHeads = days.length > 1 ? [...days].reverse() : [];
   check(vp, 'Feed: events either side of the viewer\'s midnight get a day heading each (newest day first), none when they share a day', JSON.stringify(heads) === JSON.stringify(expectHeads), `${heads.join(' | ') || 'no headings'}; expected ${expectHeads.join(' | ') || 'none'}`);
   await f.click('#world-panel .tab[data-tab="highlights"]'); await f.waitForSelector('label.fld');
   const psel = f.locator('label.fld', {hasText: 'Time of day (your time)'}).locator('select'), got = {}, want = {};
   for (const pt of ['night', 'morning', 'afternoon', 'evening']) { want[pt] = evs.filter(e => part(tz, e.at) === pt).length; await psel.selectOption(pt); await f.waitForTimeout(150); got[pt] = await f.locator('.ev-list .ev-btn').count(); }
   check(vp, 'Highlights: the time-of-day filter counts moments in the viewer\'s zone', JSON.stringify(got) === JSON.stringify(want) && Object.values(want).some(x => x > 0), `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}`);
  } catch (e) { check(vp, 'run', false, String(e).split('\n')[0]); }
  await ctx.close();
 }
 return {ok: cases.every(c => c.ok), cases};
}
