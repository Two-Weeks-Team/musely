// Playwright CLI run-code callback for the live world surface (task 6, extended by P-06). Open the page first: production, or a
// local dist served with `node scripts/serve-dist.mjs 8788 --api https://musely.net` (real data).
// Desktop and 390x844 touch emulation. Checks:
//   surface (task 6): pins, spotlight chip, every panel tab, evidence (P2) with a request id, claim card, location card; the
//     panel stays inside the viewport; no email on screen; a slow tab render never leaks into the next tab
//   A  request health: connection line; initial HTTP error / stale after success / recovery; per-tab error cards instead of
//     defaults or zeros; event source badges unchanged by a failing connection (failures are injected in the browser only)
//   B  fixture replay: 1x/10x/60x rates, pause, seek back, end, restart; evidence from a replay row (missing evidence,
//     not applicable, recorded replay); evidence open/close/Escape returns to the same tab, row, scroll and play state;
//     zero requests to /api while replay is on screen and polling resumes after; highlight filters
//   C  autonomy: six rows with sample, period, Not measured; touch size (390 px), no horizontal overflow, keyboard, ARIA
// Returns {ok, cases}; screenshots go to output/world-ui-*.png.
async (page) => {
 const base = new URL(page.url()); base.search = '?autoplay=0';
 const browser = page.context().browser(), cases = [];
 const check = (vp, name, ok, detail = '') => cases.push({vp, name, ok: !!ok, detail});
 const sparkStatus = session => ({model: {id: 'fixture-model', connected: true, live: true}, budget: {day: '2026-11-01', capUsd: 1, spentUsd: 0, reservedUsd: 0, liveCalls: 0, remainingUsd: 1}, turnstile: {sitekey: 'x', configured: false}, session});
 const TABS = ['feed', 'highlights', 'p1', 'autonomy', 'identity', 'location', 'replay', 'flows'];
 for (const mobile of [false, true]) {
  const vp = mobile ? 'mobile' : 'desktop', shot = n => `output/world-ui-${n}-${vp}.png`;
  const size = mobile ? {width: 390, height: 844} : {width: 1440, height: 900};
  const ctx = await browser.newContext({viewport: size, isMobile: mobile, hasTouch: mobile, timezoneId: 'America/Los_Angeles'});
  const p = await ctx.newPage(), errors = [], reqs = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/.well-known/')) reqs.push({m: r.method(), p: u.pathname}); });
  try {
   await p.goto(base.href, {waitUntil: 'domcontentloaded', timeout: 90000});
   await p.waitForFunction(() => document.body.dataset.worldReady === '1', null, {timeout: 60000});
   const chip = await p.locator('#spot-chip').textContent();
   check(vp, 'spotlight chip names who is next and which freedom', /^Spotlight · \w+ next · (where|who|offer|plan)/.test(chip), chip);
   check(vp, 'ten Muse pins on the map', (await p.locator('.muse-pin').count()) === 10);
   await p.locator('#world-open').click();
   await p.waitForSelector('#world-panel:popover-open');
   const box = await p.locator('#world-panel').boundingBox();
   check(vp, 'the panel stays inside the viewport', box.x >= 0 && box.x + box.width <= size.width + 1, JSON.stringify(box));
   await p.waitForSelector('#world-panel .ev-btn', {timeout: 20000});
   // Connection line (A) and the legend carry PLANNED; events never do.
   const conn = await p.evaluate(() => ({text: document.querySelector('.conn-state')?.textContent, state: document.getElementById('conn')?.dataset.state, retryHidden: document.querySelector('.conn-retry')?.hidden, legend: [...document.querySelectorAll('.legend .src')].map(x => x.textContent), rowBadges: [...document.querySelectorAll('.ev-btn .src')].map(x => x.textContent)}));
   check(vp, 'connection line says the world answers; Retry hidden', conn.state === 'ready' && /^Connected/.test(conn.text) && conn.retryHidden === true, JSON.stringify([conn.state, conn.text]));
   check(vp, 'PLANNED is in the legend and on no event row', conn.legend.includes('PLANNED') && !conn.rowBadges.includes('PLANNED'), conn.legend.join(' | '));
   const liveRow = p.locator('#world-panel .ev-btn', {hasText: 'LIVE · Muse Spark'}).first();
   if (await liveRow.count()) {
    await liveRow.click();
    await p.waitForSelector('#evidence:popover-open');
    const ev = await p.locator('#evidence').textContent();
    check(vp, 'live model evidence shows a request id', /Request id/.test(ev), ev.slice(0, 120));
    check(vp, 'its agent-card links still go to the real API (not a fixture)', (await p.locator('#evidence a[href^="/api/agents/"]').count()) > 0);
    await p.screenshot({path: shot('evidence')});
    check(vp, 'evidence close button has a name', (await p.locator('#evidence .close').getAttribute('aria-label')) === 'Close evidence');
    await p.locator('#evidence .close').click();
   }
   await p.screenshot({path: shot('feed')});
   for (const [tab, expect] of [['highlights', /p0 trade|p0 refused|first trade|impostor rejected|injection blocked|off script|No highlights yet/i], ['p1', /Engine, run in this browser/], ['autonomy', /Signature checks/], ['identity', /Claimed|pending_claim/], ['location', /Muse's current place/]]) {
    await p.locator(`#world-panel .tab[data-tab="${tab}"]`).click();
    await p.waitForFunction(re => new RegExp(re, 'i').test(document.querySelector('.world-body')?.textContent ?? ''), expect.source, {timeout: 30000});
    const emails = await p.evaluate(() => (document.body.innerText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []));
    check(vp, `${tab}: no email address on screen`, emails.length === 0, emails.join(', '));
    await p.screenshot({path: shot(tab)});
   }
   // A slow tab render must not leak into the tab selected after it (generation guard).
   await p.locator('#world-panel .tab[data-tab="highlights"]').click();
   await p.locator('#world-panel .tab[data-tab="feed"]').click();
   await p.waitForTimeout(2500);
   check(vp, 'a slow Highlights render does not leak into Feed', (await p.locator('.world-body .filter').count()) === 0);

   // ---------- C: autonomy ----------
   await p.locator('#world-panel .tab[data-tab="autonomy"]').click();
   await p.waitForSelector('.world-body tr[data-row]', {timeout: 30000});
   const au = await p.evaluate(() => ({rows: [...document.querySelectorAll('.world-body tr[data-row]')].map(tr => ({key: tr.dataset.row, cells: [...tr.children].map(c => c.textContent), nm: tr.classList.contains('not-measured')})), head: [...document.querySelectorAll('.world-body th')].map(x => x.textContent), text: document.querySelector('.world-body')?.textContent ?? ''}));
   check(vp, 'autonomy: six rows, each with a value and a sample', au.rows.length === 6 && au.rows.every(r => r.cells[1] && r.cells[2]), au.rows.map(r => r.key).join(','));
   check(vp, 'autonomy: columns Measure · Value · Sample · Note, period names day, world and run', au.head.join('|') === 'Measure|Value|Sample|Note' && /Menlo Park world day/.test(au.text) && /worldId/.test(au.text) && /runId/.test(au.text), au.head.join('|'));
   check(vp, 'autonomy: what is not measured says so, never a 0% of 0', au.rows.filter(r => r.nm).every(r => r.cells[1] === 'Not measured') && !/of 0\b/.test(au.text), JSON.stringify(au.rows.filter(r => r.nm).map(r => r.key)));

   // ---------- B: highlights filters ----------
   await p.locator('#world-panel .tab[data-tab="highlights"]').click();
   await p.waitForSelector('.world-body [aria-label="Find moments"]', {timeout: 30000});
   const total = async () => Number(((await p.locator('.world-body p[role=status]').first().textContent()).match(/^(\d+)/) ?? [0, 0])[1]);
   const n0 = await total();
   if (n0 > 0) {
    const chips = p.locator('.world-body button.tag[data-tag]:not([data-tag=""])');
    if (await chips.count()) { await chips.first().click(); const n1 = await total(); check(vp, 'highlights: a tag chip narrows the list and is pressed', n1 > 0 && n1 <= n0 && (await chips.first().getAttribute('aria-pressed')) === 'true', `${n0} -> ${n1}`); }
    const museSel = p.locator('.world-body .fld select').first();
    const museOpts = await museSel.locator('option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
    if (museOpts.length) { await museSel.selectOption(museOpts[0]); const n2 = await total(); check(vp, 'highlights: Muse filter keeps only that Muse\'s moments (by tag or by Muse)', n2 <= n0, `${n0} -> ${n2}`); }
    await p.locator('.world-body button', {hasText: 'Clear filters'}).click();
    await p.waitForFunction(() => /^\d+ moment/.test(document.querySelector('.world-body p[role=status]')?.textContent ?? ''));
    check(vp, 'highlights: Clear filters restores the full list', (await total()) === n0, String(await total()));
   }

   // ---------- B: fixture replay ----------
   await p.locator('#world-panel .tab[data-tab="replay"]').click();
   await p.waitForSelector('.replay-view');
   await p.waitForTimeout(400);
   const i0 = reqs.length;
   const st = () => p.evaluate(() => window.__world.worldPanel.replay.getState());
   const rate = async s => { await p.evaluate(s => { const r = window.__world.worldPanel.replay; r.pause(); r.seek(0); r.setSpeed(s); r.play(); }, s); await p.waitForTimeout(300); const a = (await st()).cursor; await p.waitForTimeout(1000); return (await st()).cursor - a; };
   const [r1, r10, r60] = [await rate(1), await rate(10), await rate(60)];
   check(vp, 'replay runs at 1×, 10× and 60× of real time (±40%)', r1 > .6 && r1 < 1.4 && r10 > 6 && r10 < 14 && r60 > 36 && r60 < 84, `1×: ${r1.toFixed(2)} s · 10×: ${r10.toFixed(1)} s · 60×: ${r60.toFixed(1)} s per second`);
   await p.evaluate(() => { const r = window.__world.worldPanel.replay; r.pause(); r.seek(100); });
   await p.locator('.replay-view button', {hasText: '10×'}).click();
   const ui = await p.evaluate(() => ({pressed: [...document.querySelectorAll('.replay-view button[aria-pressed=true]')].map(b => b.textContent), time: document.querySelector('.replay-time')?.textContent, status: document.querySelector('.replay-status')?.textContent}));
   check(vp, 'the chosen speed is pressed, shown in the time line and announced', ui.pressed.includes('10×') && /10×/.test(ui.time) && /10×/.test(ui.status), JSON.stringify(ui));
   const before = (await st()).cursor; await p.waitForTimeout(600);
   check(vp, 'paused replay does not move', (await st()).cursor === before);
   const rowsAt = async t => { await p.evaluate(t => window.__world.worldPanel.replay.seek(t), t); await p.waitForTimeout(150); return p.locator('.replay-view .ev-list li').count(); };
   const [late, early] = [await rowsAt(1700), await rowsAt(120)];
   check(vp, 'seeking back removes moments that have not happened yet; no model call or reward is made', early < late && early >= 0, `${late} -> ${early} moments`);
   await p.evaluate(() => { const r = window.__world.worldPanel.replay; r.pause(); r.seek(1795); r.setSpeed(60); r.play(); }); await p.waitForTimeout(1100);
   const end = await p.evaluate(() => ({s: window.__world.worldPanel.replay.getState(), status: document.querySelector('.replay-status')?.textContent}));
   check(vp, 'the end is reached once: stops, says so', end.s.ended && !end.s.playing && /Reached the end/.test(end.status), JSON.stringify(end));
   await p.locator('.replay-view button', {hasText: 'Restart'}).click();
   const rs = await st(); check(vp, 'Restart goes back to 0:00 and waits', rs.cursor === 0 && !rs.playing && !rs.ended, JSON.stringify(rs));
   // Zero-result filter and the way back.
   await p.evaluate(() => window.__world.worldPanel.replay.seek(1800));
   await p.locator('.replay-view .replay-select select').nth(2).selectOption('night'); await p.waitForTimeout(200);
   check(vp, 'replay: a filter with no match says so and offers Clear filters', /No moment matches/.test(await p.locator('.replay-view').textContent()) && await p.locator('.replay-view button', {hasText: 'Clear filters'}).isVisible());
   await p.locator('.replay-view button', {hasText: 'Clear filters'}).click(); await p.waitForTimeout(150);
   check(vp, 'Clear filters brings the moments back and focus lands on a filter', (await p.locator('.replay-view .ev-list li').count()) > 0 && await p.evaluate(() => !!document.activeElement?.closest('.replay-filters')));
   await p.screenshot({path: shot('replay')});
   // Evidence from a replay row: the three evidence situations, no signed-card link, no request.
   const seen = {};
   for (const kind of ['REPLAY', 'RULE']) {
    const rows = p.locator('.replay-view .ev-btn', {has: p.locator('.src', {hasText: new RegExp('^' + kind + '$')})});
    for (let i = 0; i < await rows.count(); i++) {
     await rows.nth(i).click(); await p.waitForSelector('#evidence:popover-open');
     const t = await p.locator('#evidence').textContent();
     seen[kind] ??= []; seen[kind].push({missing: /Missing evidence/.test(t), na: /Not applicable/.test(t), from: /Replayed from/.test(t), fixture: /Preview fixture \(SCRIPTED\)/.test(t), card: await p.locator('#evidence a[href*="/api/"]').count()});
     await p.locator('#evidence .close').click(); await p.waitForFunction(() => !document.getElementById('evidence').matches(':popover-open'));
    }
   }
   check(vp, 'replay evidence: one replayed answer has no original request id and says "Missing evidence"', (seen.REPLAY ?? []).filter(x => x.missing).length === 1, JSON.stringify(seen.REPLAY));
   check(vp, 'replay evidence: recorded answers show "Replayed from"; rule events say "Not applicable"', (seen.REPLAY ?? []).some(x => x.from) && (seen.RULE ?? []).every(x => x.na), JSON.stringify(seen));
   check(vp, 'replay evidence is marked as a preview fixture and has no link to the API', [...(seen.REPLAY ?? []), ...(seen.RULE ?? [])].every(x => x.fixture && x.card === 0));
   // Open, close, return: Escape and the close button; same tab, same row, same scroll, play state kept.
   await p.evaluate(() => { const r = window.__world.worldPanel.replay; r.pause(); r.seek(1800); });
   await p.waitForTimeout(150);
   const trigger = p.locator('.replay-view .ev-btn').nth(3);
   const triggerId = await trigger.getAttribute('data-event-id');
   await trigger.scrollIntoViewIfNeeded();
   await p.evaluate(() => { const w = document.getElementById('world-panel'); w.scrollTop = Math.max(0, w.scrollTop - 40); });
   const scroll0 = await p.evaluate(() => document.getElementById('world-panel').scrollTop);
   await trigger.click(); await p.waitForSelector('#evidence:popover-open');
   check(vp, 'evidence opens focused on its heading', await p.evaluate(() => document.activeElement?.id === 'evidence-title'));
   await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.getElementById('evidence').matches(':popover-open')); await p.waitForTimeout(250);
   const back = await p.evaluate(() => ({tab: document.querySelector('.world-tabs .tab.active')?.dataset.tab, focus: document.activeElement?.dataset?.eventId, scroll: document.getElementById('world-panel').scrollTop}));
   check(vp, 'Escape returns to the Replay tab, the same row has focus, scroll is kept', back.tab === 'replay' && back.focus === triggerId && Math.abs(back.scroll - scroll0) < 3, JSON.stringify({back, triggerId, scroll0}));
   await p.evaluate(() => { const r = window.__world.worldPanel.replay; r.pause(); r.seek(20); r.setSpeed(1); r.play(); });
   await p.waitForTimeout(300);
   await p.locator('.replay-view .ev-btn').first().click(); await p.waitForSelector('#evidence:popover-open');
   const during = await st(); await p.locator('#evidence .close').click(); await p.waitForTimeout(300); const after = await st();
   check(vp, 'opening evidence pauses the replay and closing it resumes what was playing', !during.playing && after.playing, JSON.stringify([during.playing, after.playing]));
   await p.evaluate(() => window.__world.worldPanel.replay.pause());
   // Isolation: nothing was requested from /api while replay was on screen, in any method.
   const during2 = reqs.slice(i0);
   check(vp, 'no request to /api or /.well-known while the replay played, seeked, filtered and opened evidence', during2.length === 0, JSON.stringify(during2));
   // Clicking the active Replay tab again must not remount it (a second mount used to pause the shared clock).
   await p.evaluate(() => { const r = window.__world.worldPanel.replay; r.pause(); r.setSpeed(1); r.seek(10); r.play(); });
   await p.locator('#world-panel .tab[data-tab="replay"]').click(); await p.waitForTimeout(500);
   check(vp, 'clicking the active Replay tab again keeps the replay playing', (await st()).playing === true);
   await p.evaluate(() => window.__world.worldPanel.replay.pause());
   // A request chain that began before the replay opened (Identity check button: status, then a POST) makes no request after it.
   // The POST is answered locally in the browser so it can never reach the service even if the chain were not stopped.
   await p.locator('#world-panel .tab[data-tab="identity"]').click(); await p.waitForSelector('.id-actions button', {timeout: 20000});
   await p.route('**/api/status', async r => { await new Promise(d => setTimeout(d, 1800)); await r.continue().catch(() => {}); });
   await p.route('**/api/demo/impostor', r => r.fulfill({status: 200, contentType: 'application/json', body: '{}'}));
   await p.locator('.id-actions button', {hasText: 'Try an impostor'}).click(); await p.waitForTimeout(250);
   await p.locator('#world-panel .tab[data-tab="replay"]').click(); await p.waitForSelector('.replay-view');
   const k0 = reqs.length; await p.waitForTimeout(2800);
   check(vp, 'a request chain started before the replay opened makes no request after it, no POST either', reqs.slice(k0).length === 0, JSON.stringify(reqs.slice(k0)));
   await p.unroute('**/api/status'); await p.unroute('**/api/demo/impostor');
   // The POST was already sent when the replay opened; its answer arrives during the replay and must not touch the header.
   await p.locator('#world-panel .tab[data-tab="identity"]').click(); await p.waitForSelector('.id-actions button', {timeout: 20000});
   await p.route('**/api/status', r => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(sparkStatus({tier: 'visitor', expiresAt: Date.now() + 3600000, quota: {perHour: 10, usedThisHour: 0}}))}));
   await p.route('**/api/demo/impostor', async r => { await new Promise(d => setTimeout(d, 1800)); await r.fulfill({status: 200, contentType: 'application/json', body: '{}'}).catch(() => {}); });
   await p.locator('.id-actions button', {hasText: 'Try an impostor'}).click(); await p.waitForTimeout(350);
   await p.locator('#world-panel .tab[data-tab="replay"]').click(); await p.waitForSelector('.replay-view');
   const k1 = reqs.length; await p.waitForTimeout(2600);
   const chip1 = await p.locator('#spot-chip').textContent();
   check(vp, 'an answer that arrives while the replay is open changes nothing: no new request, header not "not updating"', reqs.slice(k1).length === 0 && !/not updating/.test(chip1), JSON.stringify([reqs.slice(k1), chip1]));
   await p.unroute('**/api/status'); await p.unroute('**/api/demo/impostor');
   // Keyboard and focus.
   await p.locator('#world-panel .tab[data-tab="replay"]').focus();
   let landed = null;
   for (let i = 0; i < 12 && !landed; i++) { await p.keyboard.press('Tab'); landed = await p.evaluate(() => { const a = document.activeElement; return a?.closest('.replay-controls') && a.tagName === 'BUTTON' ? {text: a.textContent, ring: getComputedStyle(a).outlineStyle, visible: a.matches(':focus-visible')} : null; }); }
   check(vp, 'Tab reaches the replay controls with a visible focus ring', !!landed && landed.visible && landed.ring !== 'none', JSON.stringify(landed));
   await p.locator('.replay-view button', {hasText: '60×'}).focus(); await p.keyboard.press('Enter');
   check(vp, 'Enter on a speed button selects it', (await st()).speed === 60);
   await p.locator('.replay-view button', {hasText: /^(Play|Pause)$/}).focus(); await p.keyboard.press('Space'); await p.waitForTimeout(150);
   const sp = await st(); await p.keyboard.press('Space'); await p.waitForTimeout(150);
   check(vp, 'Space toggles play and pause', sp.playing !== (await st()).playing, JSON.stringify([sp.playing, (await st()).playing]));
   await p.evaluate(() => window.__world.worldPanel.replay.pause());
   // Leaving the replay tab resumes polling; entering it paused nothing but its own clock.
   const j0 = reqs.length;
   await p.locator('#world-panel .tab[data-tab="feed"]').click();
   await p.waitForFunction(() => document.getElementById('conn').dataset.state !== 'replay');
   await p.waitForTimeout(11500);
   check(vp, 'leaving the replay tab resumes the live polling', reqs.slice(j0).some(r => r.m === 'GET' && r.p === '/api/world'), JSON.stringify(reqs.slice(j0).map(r => r.p)));
   // Writes: the whole run made none.
   // The only write is the POST the in-flight chain case sends on purpose; the browser answers it itself and it never reaches the service.
   const posts = reqs.filter(r => r.m !== 'GET');
   check(vp, 'the only non-GET request to /api in this whole run is the one mocked POST of the in-flight chain case', posts.length === 1 && posts[0].m === 'POST' && posts[0].p === '/api/demo/impostor', JSON.stringify(posts));

   // ---------- C: layout and touch targets on every tab ----------
   for (const tab of TABS) {
    await p.locator(`#world-panel .tab[data-tab="${tab}"]`).click();
    await p.waitForTimeout(tab === 'feed' ? 300 : 1800);
    const lay = await p.evaluate(mobile => {
     const panel = document.getElementById('world-panel'), small = [];
     for (const el of panel.querySelectorAll('button, select, input[type=range], summary')) {
      const b = el.getBoundingClientRect(); if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (mobile && b.height < 43.5 && !el.closest('.ritual, .ritual-card')) small.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24) + ' ' + Math.round(b.height));
     }
     const wide = [...panel.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && !['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && getComputedStyle(e).display !== 'inline' && e.clientWidth > 0 && !e.closest('.table-wrap, .replay-table-wrap, pre, .evidence')).map(e => e.className || e.tagName).slice(0, 3);
     return {overflow: panel.scrollWidth - panel.clientWidth, small, wide, pressed: [...panel.querySelectorAll('.world-tabs .tab[aria-pressed=true]')].length, cell: parseFloat(getComputedStyle(panel.querySelector('table.data td, table.data th') ?? panel).fontSize)};
    }, mobile);
    check(vp, `${tab}: panel has no horizontal overflow and exactly one tab pressed`, lay.overflow <= 1 && lay.wide.length === 0 && lay.pressed === 1, JSON.stringify(lay));
    if (mobile) check(vp, `${tab}: every button, select and slider is at least 44 px tall (390 px)`, lay.small.length === 0, lay.small.join(' · '));
    if (tab === 'autonomy' || tab === 'replay') check(vp, `${tab}: table text is at least 11 px`, lay.cell >= 11, String(lay.cell));
    if (mobile && (tab === 'replay' || tab === 'autonomy' || tab === 'location')) await p.screenshot({path: shot('a11y-' + tab)});
   }
   check(vp, 'no page errors', errors.length === 0, errors.join(' / '));
   cases.push({vp, viewport: mobile ? '390x844 touch emulation' : '1440x900', chip, errors});
  } catch (e) { check(vp, 'run', false, String(e).slice(0, 400)); }
  await ctx.close();

  // ---------- A: failures injected in the browser (nothing is sent to the service) ----------
  const fail503 = r => r.fulfill({status: 503, contentType: 'text/plain', body: 'down'});
  const open = async (c, url) => { const q = await c.newPage(); q.on('pageerror', e => errors.push(e.message)); await q.goto(url, {waitUntil: 'domcontentloaded', timeout: 90000}); await q.waitForFunction(() => window.__world?.getMetrics().ready, null, {timeout: 60000}); return q; };
  const mk = () => browser.newContext({viewport: size, isMobile: mobile, hasTouch: mobile, timezoneId: 'America/Los_Angeles'});
  try {
   // A1: the first answer is an error. Nothing is shown as if it were data.
   const c1 = await mk(); await c1.route(/\/api\/(world|owner\/location|claim\/)/, fail503);
   const q1 = await open(c1, base.href); await q1.waitForFunction(() => document.querySelector('.conn-state')?.textContent?.length > 0);
   await q1.locator('#world-open').click(); await q1.waitForSelector('#world-panel:popover-open'); await q1.waitForTimeout(800);
   const a1 = await q1.evaluate(() => ({state: document.getElementById('conn').dataset.state, text: document.querySelector('.conn-state').textContent, retry: !document.querySelector('.conn-retry').hidden, chip: document.getElementById('spot-chip').textContent, feed: document.querySelector('.world-body')?.textContent}));
   check(vp, 'A1 first request fails: connection line says unavailable with Retry, header says world offline', a1.state === 'error' && /Unavailable \(HTTP 503\)/.test(a1.text) && a1.retry && /world offline/.test(a1.chip), JSON.stringify(a1));
   check(vp, 'A1 the feed says it is unavailable instead of "Waiting for the next heartbeat"', /Feed unavailable/.test(a1.feed) && !/Waiting for the next heartbeat/.test(a1.feed), a1.feed.slice(0, 120));
   await q1.locator('#world-panel .tab[data-tab="autonomy"]').click(); await q1.waitForTimeout(1500);
   const au1 = await q1.evaluate(() => ({text: document.querySelector('.world-body')?.textContent, rows: document.querySelectorAll('.world-body tr[data-row]').length}));
   check(vp, 'A1 autonomy: a failed run log shows an error card, not six zeros', /Run log unavailable/.test(au1.text) && au1.rows === 0, au1.text.slice(0, 140));
   await q1.locator('#world-panel .tab[data-tab="location"]').click(); await q1.waitForTimeout(1200);
   const lo1 = await q1.locator('.world-body').textContent();
   check(vp, 'A5 location: failure says "Location unavailable" and does not claim the HQ commons', /Location unavailable/.test(lo1) && !/HQ commons preset/.test(lo1), lo1.slice(0, 140));
   await q1.locator('#world-panel .tab[data-tab="identity"]').click(); await q1.waitForTimeout(1200);
   const id1 = await q1.locator('.world-body').textContent();
   check(vp, 'A1 identity: an unreadable claim is "Claim status unavailable", not pending_claim', /Claim status unavailable/.test(id1) && !/pending_claim\b.*This record/.test(id1.slice(0, 80)), id1.slice(0, 160));
   await q1.screenshot({path: shot('error-state')});
   await c1.close();

   // A2/A3: success, then the world stops answering; older data stays, badges unchanged; then recovery.
   const c2 = await mk(); const q2 = await open(c2, base.href);
   await q2.waitForFunction(() => document.body.dataset.worldReady === '1', null, {timeout: 60000});
   await q2.locator('#world-open').click(); await q2.waitForSelector('#world-panel .ev-btn', {timeout: 20000});
   const badges0 = await q2.locator('#world-panel .ev-btn .src').evaluateAll(n => n.map(x => x.textContent).join('|'));
   const rows0 = await q2.locator('#world-panel .ev-btn').count();
   await c2.route(/\/api\/world/, fail503);
   await q2.locator('.conn-retry').waitFor({state: 'attached'}); await q2.evaluate(() => document.getElementById('conn')); // poll runs every 10 s: wait for the failure to show
   await q2.waitForFunction(() => document.getElementById('conn').dataset.state === 'stale', null, {timeout: 14000});
   const a2 = await q2.evaluate(() => ({text: document.querySelector('.conn-state').textContent, retry: !document.querySelector('.conn-retry').hidden, chip: document.getElementById('spot-chip').textContent, rows: document.querySelectorAll('#world-panel .ev-btn').length, badges: [...document.querySelectorAll('#world-panel .ev-btn .src')].map(x => x.textContent).join('|')}));
   check(vp, 'A2 success then failure: "Not responding", last data kept, Retry offered, header says not updating', /Not responding \(HTTP 503\).*last good answer/.test(a2.text) && a2.retry && /not updating/.test(a2.chip) && a2.rows >= Math.min(rows0, 1), JSON.stringify(a2).slice(0, 300));
   check(vp, 'A3 a failing connection does not change any event\'s source badge', a2.badges === badges0 || (a2.rows >= rows0 && a2.badges.startsWith(badges0.slice(0, 40))), `${badges0.slice(0, 60)} → ${a2.badges.slice(0, 60)}`);
   await q2.screenshot({path: shot('stale-state')});
   await c2.unroute(/\/api\/world/, fail503); await q2.locator('.conn-retry').click();
   await q2.waitForFunction(() => document.getElementById('conn').dataset.state === 'ready', null, {timeout: 15000});
   check(vp, 'A2 recovery: Retry brings back "Connected" and hides Retry', await q2.evaluate(() => /^Connected/.test(document.querySelector('.conn-state').textContent) && document.querySelector('.conn-retry').hidden));
   // A5: highlights fail on their own while the world is fine.
   await c2.route(/\/api\/world\/highlights/, fail503);
   await q2.locator('#world-panel .tab[data-tab="highlights"]').click(); await q2.waitForTimeout(1500);
   const hl = await q2.locator('.world-body').textContent();
   check(vp, 'A5 highlights fail alone: error card with Retry; the connection line still says Connected', /Highlights unavailable/.test(hl) && /^Connected/.test(await q2.locator('.conn-state').textContent()), hl.slice(0, 120));
   await c2.unroute(/\/api\/world\/highlights/, fail503); await q2.locator('.world-body button', {hasText: 'Retry'}).click(); await q2.waitForSelector('.world-body [aria-label="Find moments"], .world-body p:has-text("No highlights yet")', {timeout: 15000});
   check(vp, 'A5 Retry loads the highlights once the service answers', true);
   await c2.close();
   // A refused session call keeps the one-time judge token in the address bar.
   const c3 = await mk(); const u3 = new URL(base.href); u3.searchParams.set('judge', 'TESTTOKEN');
   await c3.route('**/api/status', async r => { await new Promise(d => setTimeout(d, 1500)); await r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(sparkStatus(null))}).catch(() => {}); });
   await c3.route('**/api/session*', r => r.fulfill({status: 500, contentType: 'application/json', body: '{}'}));
   const q3 = await open(c3, u3.href); const before3 = await q3.evaluate(() => location.search);
   await q3.locator('#world-open').click(); await q3.waitForSelector('#world-panel:popover-open');
   await q3.locator('#world-panel .tab[data-tab="identity"]').click(); await q3.waitForSelector('.id-actions button', {timeout: 20000});
   await q3.locator('.id-actions button', {hasText: 'Try an impostor'}).click(); await q3.waitForTimeout(250);
   await q3.locator('#world-panel .tab[data-tab="replay"]').click(); await q3.waitForSelector('.replay-view'); await q3.waitForTimeout(2300);
   const after3 = await q3.evaluate(() => location.search);
   check(vp, 'a session request refused by the replay keeps the judge token in the address bar', /judge=TESTTOKEN/.test(before3) && /judge=TESTTOKEN/.test(after3), JSON.stringify([before3, after3]));
   await c3.close();
  } catch (e) { check(vp, 'A failure states', false, String(e).slice(0, 400)); }
 }
 return {ok: cases.every(c => c.ok ?? true), cases};
}
