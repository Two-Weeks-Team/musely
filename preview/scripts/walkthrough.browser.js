// Playwright CLI run-code callback: the S1 preview walkthrough (P-07, gate DEC-01). Open the target URL first.
// 8 experiences x 6 states (entry, action, success, reject, cancel, retry) x 2 viewports, every cell a visitor path through the
// screen (clicks, no internal API calls) plus an assertion on what is visible:
//   D = desktop 1440x900 (DPR 1)   M = mobile 390x844 (DPR 2, touch emulation: not a real phone)
// A cell that cannot be reached is a FAIL, never a skip. Case names are `EXP-X/state`; a suffix after the state names the branch.
// Each experience starts in a fresh page; screenshots go to output/wt-<vp>-<exp>-<state>.png.
// Fixture scenes are SCRIPTED fixtures. Cells that read the live world (EXP-WORLD success) say so in their detail.
async (page) => {
 const base = new URL(page.url()); base.search = '?autoplay=0';
 const browser = page.context().browser(), cases = [];
 const has = (t, ...res) => res.every(r => r.test(t));
 for (const mobile of [false, true]) {
  const vp = mobile ? 'M' : 'D', size = mobile ? {width: 390, height: 844} : {width: 1440, height: 900};
  const run = async (exp, steps) => {
   const ctx = await browser.newContext({viewport: size, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1});
   const p = await ctx.newPage(), errors = [], writes = [];
   p.on('pageerror', e => errors.push(e.message));
   p.on('request', r => { if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
   const note = (state, ok, detail) => cases.push({vp, name: `${exp}/${state}`, ok: !!ok, detail: String(detail ?? '').slice(0, 260)});
   try {
    await p.goto(base.href, {waitUntil: 'domcontentloaded', timeout: 90000});
    await p.waitForFunction(() => window.__world?.getMetrics().ready && window.__world.getMetrics().characterKit, null, {timeout: 90000});
    await p.waitForTimeout(1200);
    const panelOpen = () => p.evaluate(() => document.getElementById('world-panel').matches(':popover-open'));
    const tab = async t => { if (!(await panelOpen())) await p.click('#world-open'); await p.waitForSelector('#world-panel:popover-open'); await p.click(`#world-panel .tab[data-tab="${t}"]`); await p.waitForTimeout(350); };
    const flow = async id => { await tab('flows'); await p.click(`.flow-list button[data-flow="${id}"]`); await p.waitForTimeout(120); };
    const go = async (...to) => { for (const t of to) { await p.click(`.flow-controls button[data-goto="${t}"]`); await p.waitForTimeout(90); } };
    const text = () => p.evaluate(() => document.querySelector('.world-body')?.textContent ?? '');
    const show = async () => { await p.click('.flow-show'); await p.waitForTimeout(1700); return p.evaluate(() => [...document.querySelectorAll('.preview-cue')].map(c => ({visual: c.dataset.visual, text: c.textContent}))); };
    const closePanel = async () => { await p.evaluate(() => { const w = document.getElementById('world-panel'); if (w.matches(':popover-open')) w.hidePopover(); }); await p.waitForTimeout(200); };
    const replay = () => p.evaluate(() => window.__world.worldPanel.replay.getState());
    const evidence = async sel => { const out = [], rows = p.locator(sel); for (let i = 0; i < await rows.count(); i++) { await rows.nth(i).click(); await p.waitForSelector('#evidence:popover-open'); out.push(await p.locator('#evidence').textContent()); await p.locator('#evidence .close').click(); await p.waitForFunction(() => !document.getElementById('evidence').matches(':popover-open')); } return out; };
    const T = {p, tab, flow, go, text, show, closePanel, replay, evidence, size};
    for (const [state, fn] of Object.entries(steps)) {
     try { const r = await fn(T); note(state, r.ok, r.detail); }
     catch (e) { note(state, false, 'ERROR ' + String(e).split('\n')[0]); }
     await p.screenshot({path: `output/wt-${vp}-${exp}-${state.replace(/[^a-z0-9]+/gi, '_')}.png`}).catch(() => {});
    }
   } catch (e) { note('page', false, 'ERROR ' + String(e).split('\n')[0]); }
   cases.push({vp, name: `${exp}/no /api writes, no page errors`, ok: writes.length === 0 && errors.length === 0, detail: JSON.stringify({writes, errors}).slice(0, 200)});
   await ctx.close();
  };

  // ---------- EXP-ENTRY: header Enter chip, welcome "Choose how to enter", harness trial, staged connection ----------
  await run('EXP-ENTRY', {
   'entry': async ({p}) => { await p.click('#entry-open'); const s = await p.evaluate(() => ({paths: document.querySelectorAll('.entry-path').length, view: window.__world.onboarding.state.view})); return {ok: s.paths === 3 && s.view === 'choose', detail: JSON.stringify(s)}; },
   'cancel · leave without choosing': async ({p}) => { await p.click('#entry-leave'); const s = await p.evaluate(() => ({path: window.__world.onboarding.state.path, chip: document.getElementById('entry-open').textContent})); return {ok: s.path === null && /Enter/.test(s.chip), detail: JSON.stringify(s)}; },
   'action · choose a harness job': async ({p}) => { await p.click('#entry-open'); await p.click('#entry-trial'); const picks = await p.locator('.harness-pick').count(); await p.click('.harness-pick[data-harness="09-copper"]'); const t = await p.evaluate(() => document.querySelector('.entry-panel')?.textContent ?? ''); return {ok: picks === 10 && has(t, /Persona/, /Goal/, /Skills/, /not a claimed Muse/), detail: `harnesses ${picks}`}; },
   'success · harness worn': async ({p}) => { await p.click('#entry-wear'); const s = await p.evaluate(() => ({chip: document.getElementById('entry-open').textContent, steps: document.querySelectorAll('.first-steps li').length})); await p.click('#close-entry'); return {ok: /Trial · Copper · local/.test(s.chip) && s.steps === 3, detail: JSON.stringify(s)}; },
   'retry · re-entry keeps the trial': async ({p}) => { await p.click('#entry-open'); const s = await p.evaluate(() => window.__world.onboarding.state); return {ok: s.view === 'trial-card' && s.trial === '09-copper', detail: `view ${s.view} trial ${s.trial}`}; },
   'cancel · end trial': async ({p}) => { await p.click('#entry-end-trial'); const s = await p.evaluate(() => ({trial: window.__world.onboarding.state.trial, resume: document.querySelectorAll('#entry-resume').length})); return {ok: s.trial === null && s.resume === 1, detail: JSON.stringify(s)}; },
   'reject · staged connection error': async ({p}) => { await p.click('#entry-connect'); await p.click('#connect-error'); const s = await p.evaluate(() => ({state: document.getElementById('connect-state').textContent, failed: document.querySelectorAll('.connect-steps li[data-state=failed]').length})); return {ok: s.failed === 1, detail: JSON.stringify(s)}; },
   'retry · connection retry': async ({p}) => { await p.click('#connect-retry'); const c = await p.evaluate(() => window.__world.onboarding.state.connect); return {ok: c === 'connecting', detail: c}; },
   'cancel · cancel the connection': async ({p}) => { await p.click('#connect-cancel'); const s = await p.evaluate(() => ({c: window.__world.onboarding.state.connect, t: document.getElementById('connect-state').textContent})); return {ok: s.c === 'cancelled' && /^CANCELLED/.test(s.t), detail: JSON.stringify(s)}; },
   'success · staged connection': async ({p}) => { await p.click('#connect-reset'); await p.click('#connect-play'); await p.waitForFunction(() => window.__world.onboarding.state.connect === 'connected_staged', null, {timeout: 12000}); const s = await p.evaluate(() => ({done: document.querySelectorAll('.connect-steps li[data-state=done]').length, chip: document.getElementById('entry-open').textContent})); return {ok: s.done === 4 && /Connect · staged/.test(s.chip), detail: JSON.stringify(s)}; },
  });

  // ---------- EXP-WORLD: map to commons, spotlight turn, live decision, refusal, pause / leave follow, resume ----------
  await run('EXP-WORLD', {
   'entry · map to the commons': async ({p}) => { await p.click('#visit'); await p.waitForFunction(() => window.__world.map.getZoom() > 21 && !window.__world.map.isMoving(), null, {timeout: 30000}); const m = await p.evaluate(() => { const g = window.__world.getMetrics(); return {zoom: Math.round(g.zoom * 10) / 10, muses: g.muses.length, h: Math.round(g.muses[0]?.bounds?.height)}; }); return {ok: m.muses === 8 && m.h > 20, detail: JSON.stringify(m)}; },
   'action · spotlight turn': async ({p, tab}) => { const chip = await p.locator('#spot-chip').textContent(); await tab('feed'); await p.waitForSelector('#world-panel .ev-btn', {timeout: 25000}); const n = await p.locator('#world-panel .ev-btn', {hasText: /decides|holds the spotlight|turn fell back/}).count(); return {ok: /^Spotlight · \w+ next · (where|who|offer|plan)/.test(chip) && n > 0, detail: `${chip} · ${n} spotlight rows`}; },
   'success · decision shown LIVE with its model (live world)': async ({p, tab}) => { await tab('feed'); const live = p.locator('#world-panel .ev-btn', {hasText: 'LIVE · Muse Spark'}).first(); if (!(await live.count())) return {ok: false, detail: 'no LIVE · Muse Spark row in the live feed right now'}; await live.click(); await p.waitForSelector('#evidence:popover-open'); const t = await p.locator('#evidence').textContent(); await p.locator('#evidence .close').click(); return {ok: has(t, /Request id/, /Model/), detail: t.slice(0, 100)}; },
   'reject · out-of-scope decision refused': async ({p, tab}) => { await tab('replay'); await p.evaluate(() => window.__world.worldPanel.replay.seek(1800)); await p.waitForTimeout(300); const t = await p.locator('.replay-view .ev-btn', {hasText: /decision was refused/}).first().textContent().catch(() => ''); return {ok: /refused/.test(t), detail: `${t.slice(0, 90)} (scripted fixture)`}; },
   'cancel · pause, leave follow': async ({p, closePanel}) => { await closePanel(); await p.click('#pause'); const a = await p.evaluate(() => ({paused: window.__world.getMetrics().paused, label: document.getElementById('pause').textContent})); await p.click('#follow'); const f1 = await p.evaluate(() => window.__world.getMetrics().follow); await p.evaluate(() => document.querySelector('#map canvas').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerType: 'touch'}))); await p.waitForTimeout(250); /* the visitor touches the map */ const f2 = await p.evaluate(() => window.__world.getMetrics().follow); return {ok: a.paused && a.label === 'Resume world' && f1 === true && f2 === false, detail: JSON.stringify({a, f1, f2})}; },
   'retry · resume the world': async ({p}) => { await p.click('#pause'); const a = await p.evaluate(() => ({paused: window.__world.getMetrics().paused, label: document.getElementById('pause').textContent, chip: document.getElementById('spot-chip').textContent})); return {ok: !a.paused && a.label === 'Pause world' && /Spotlight/.test(a.chip), detail: JSON.stringify(a)}; },
  });

  // ---------- EXP-IDENTITY ----------
  await run('EXP-IDENTITY', {
   'entry': async ({flow, text}) => { await flow('p0-delegation'); return {ok: has(await text(), /Same start, same proposal/, /claimed/), detail: 'p0-delegation'}; },
   'action': async ({go, text}) => { await go('verify'); return {ok: has(await text(), /Ripple checks the request first/), detail: ''}; },
   'success': async ({go, text, show}) => { await go('traded'); const t = await text(); const cues = await show(); return {ok: has(t, /Trade completes/) && cues.length === 2 && cues.every(c => c.visual === 'complete'), detail: JSON.stringify(cues.map(c => c.visual))}; },
   'cancel · revoke': async ({flow, go, text}) => { await flow('p0-delegation'); await go('revoke-first'); return {ok: has(await text(), /revokes delegation v3/), detail: ''}; },
   'reject · refused after revoking': async ({go, text}) => { await go('refused'); return {ok: has(await text(), /same proposal is refused/), detail: ''}; },
   'retry · back to run 1': async ({go, text}) => { await go('standby', 'verify'); return {ok: has(await text(), /Ripple checks the request first/), detail: 'standby → run 1'}; },
   'entry · visitor': async ({flow, text}) => { await flow('visitor-unclaimed'); return {ok: has(await text(), /Visitor tries Copper locally/), detail: 'visitor-unclaimed'}; },
   'reject · visitor trade refused': async ({go, text}) => { await go('attempt'); return {ok: has(await text(), /trial Muse asks to trade/), detail: ''}; },
   'retry · recorded ritual changes nothing': async ({go, text}) => { await go('replay'); return {ok: has(await text(), /recorded ritual does not change it/i), detail: ''}; },
  });

  // ---------- EXP-REWARD ----------
  await run('EXP-REWARD', {
   'entry': async ({flow, text}) => { await flow('p1-transit'); return {ok: has(await text(), /Before: walking only/, /Trips today/), detail: 'p1-transit'}; },
   'action · stamps and craft': async ({go, text, show}) => { await go('stamps', 'craft'); const t = await text(); const cues = await show(); return {ok: has(t, /Craft a Transit Pass/) && cues.length >= 1, detail: JSON.stringify(cues.map(c => c.visual))}; },
   'success · after': async ({go, text}) => { await go('after'); return {ok: has(await text(), /After: Ripple takes the bus/, /Bus rides/), detail: ''}; },
   'reject · no ability change': async ({flow, go, text}) => { await flow('reward-trade-limits'); await go('no-change'); return {ok: has(await text(), /no ability would change/i), detail: 'reward-trade-limits'}; },
   'reject · too far': async ({flow, go, text}) => { await flow('reward-trade-limits'); await go('too-far'); return {ok: has(await text(), /too far apart/i, /100 m/), detail: ''}; },
   'reject · pair limit': async ({flow, go, text}) => { await flow('reward-trade-limits'); await go('pair-limit'); return {ok: has(await text(), /one trade per pair per day/i), detail: ''}; },
   'reject · repeat find': async ({flow, go, text}) => { await flow('reward-trade-limits'); await go('place-limit'); return {ok: has(await text(), /repeat find gives nothing|one thing per place per day/i), detail: ''}; },
   'cancel · withdrawn': async ({flow, go, text}) => { await flow('reward-trade-limits'); await go('withdrawn'); const t = await text(); return {ok: has(t, /withdraws before an answer/i, /Inventories are unchanged|inventories|Nothing was exchanged/i), detail: ''}; },
   'cancel · expired': async ({flow, go, text}) => { await flow('reward-trade-limits'); await go('expired'); return {ok: has(await text(), /No answer in 30 minutes/i), detail: ''}; },
   'retry · next day': async ({flow, go, text}) => { await flow('reward-trade-limits'); await go('no-change', 'retry', 'next-day'); return {ok: has(await text(), /daily limits reset|start again/i), detail: ''}; },
   'retry · another place': async ({flow, go, text}) => { await flow('reward-trade-limits'); await go('no-change', 'retry', 'other-place'); return {ok: has(await text(), /new find is allowed/i), detail: ''}; },
   'retry · another partner': async ({flow, go, text}) => { await flow('reward-trade-limits'); await go('no-change', 'retry', 'other-partner'); return {ok: has(await text(), /different pair/i), detail: ''}; },
  });

  // ---------- EXP-MEETUP ----------
  await run('EXP-MEETUP', {
   'entry': async ({flow, text}) => { await flow('meetup-agree'); return {ok: has(await text(), /Public candidates only/), detail: 'meetup-agree'}; },
   'action': async ({go, text}) => { await go('candidate'); return {ok: has(await text(), /Agreement candidate/), detail: ''}; },
   'success · both approve': async ({go, text}) => { await go('ember'); return {ok: has(await text(), /Meetup Ember/), detail: ''}; },
   'reject · one owner declines': async ({flow, go, text}) => { await flow('meetup-agree'); await go('candidate', 'declined'); return {ok: has(await text(), /One owner declines/), detail: ''}; },
   'reject · no shared time': async ({flow, go, text}) => { await flow('meetup-no-overlap'); await go('stop'); return {ok: has(await text(), /Stop and return to owners|No agreement/), detail: 'meetup-no-overlap'}; },
   'cancel · expires': async ({flow, go, text}) => { await flow('meetup-agree'); await go('candidate', 'expired'); return {ok: has(await text(), /approval window ends/i), detail: ''}; },
   'cancel · owner revokes': async ({flow, go, text}) => { await flow('meetup-agree'); await go('candidate', 'revoked'); return {ok: has(await text(), /revokes the delegation/i), detail: ''}; },
   'retry · back to normal life': async ({flow, go, text}) => { await flow('meetup-agree'); await go('candidate', 'declined', 'return'); return {ok: has(await text(), /Back to normal life/), detail: ''}; },
  });

  // ---------- EXP-LOCATION ----------
  await run('EXP-LOCATION', {
   'entry': async ({flow, text}) => { await flow('location-walk'); return {ok: has(await text(), /virtual preset/, /DEMO/), detail: 'location-walk'}; },
   'action · owner moves the cell, walk with ETA': async ({go, text}) => { await go('move'); return {ok: has(await text(), /Noodle Bar/, /ETA/), detail: ''}; },
   'reject · not arrived yet': async ({go, text}) => { await go('not-arrived'); return {ok: has(await text(), /Not arrived yet/, /Discovery refused/), detail: ''}; },
   'reject · no Taxi Token': async ({go, text}) => { await go('move', 'no-token'); return {ok: has(await text(), /Teleport needs a Taxi Token/), detail: ''}; },
   'action · verified teleport': async ({go, text}) => { await go('taxi'); return {ok: has(await text(), /Verified teleport/, /token used/), detail: ''}; },
   'success · arrived': async ({go, text}) => { await go('arrived'); return {ok: has(await text(), /Arrived/, /Discovery allowed/), detail: ''}; },
   'cancel · owner switches back': async ({go, text}) => { await go('switch-back'); return {ok: has(await text(), /walks back/), detail: ''}; },
   'retry · verify the neighborhood again': async ({go, text}) => { await go('retry'); return {ok: has(await text(), /verify the neighborhood again/i), detail: ''}; },
  });

  // ---------- EXP-REPLAY ----------
  await run('EXP-REPLAY', {
   'entry · open highlights': async ({tab, text}) => { await tab('highlights'); await new Promise(r => setTimeout(r, 1500)); const t = await text(); return {ok: /Find moments|No highlights yet/.test(t) || /Moments tagged by rule/.test(t), detail: t.slice(0, 70)}; },
   'action · play at 1×, 10×, 60×': async ({p, tab, replay}) => { await tab('replay'); const rates = []; for (const s of [1, 10, 60]) { await p.evaluate(s => { const r = window.__world.worldPanel.replay; r.pause(); r.seek(0); r.setSpeed(s); r.play(); }, s); await p.waitForTimeout(250); const a = (await replay()).cursor; await p.waitForTimeout(900); rates.push((await replay()).cursor - a); } await p.evaluate(() => window.__world.worldPanel.replay.pause()); return {ok: rates[0] > .5 && rates[1] > 5 && rates[2] > 30, detail: rates.map(r => r.toFixed(1)).join(' / ') + ' virtual s per real s'}; },
   'success · evidence shows signer and verified steps': async ({p, evidence}) => { await p.evaluate(() => window.__world.worldPanel.replay.seek(1800)); await p.waitForTimeout(300); const t = (await evidence('.replay-view .ev-btn:has-text("signed request passed")')).join(' '); return {ok: has(t, /Verified steps/, /Signer/), detail: t.slice(0, 90)}; },
   'reject · missing evidence shown as such': async ({evidence}) => { const t = (await evidence('.replay-view .ev-btn:has(.src:text-is("REPLAY"))')).join(' | '); return {ok: has(t, /Missing evidence/, /Replayed from/), detail: 'replay makes no /api request: see the no-writes case'}; },
   'cancel · close evidence': async ({p}) => { await p.locator('.replay-view .ev-btn').first().click(); await p.waitForSelector('#evidence:popover-open'); await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.getElementById('evidence').matches(':popover-open')); const f = await p.evaluate(() => document.activeElement?.dataset?.eventId); return {ok: !!f, detail: 'Escape, focus on ' + f}; },
   'retry · restart and reload newest events': async ({p, replay}) => { await p.evaluate(() => window.__world.worldPanel.replay.restart()); const s = await replay(); await p.click('#world-panel .tab[data-tab="feed"]'); await p.waitForTimeout(500); const feed = await p.locator('#world-panel .ev-btn').count(); return {ok: s.cursor === 0 && !s.playing && feed > 0, detail: `cursor ${s.cursor}, feed rows ${feed}`}; },
  });

  // ---------- EXP-COMMS ----------
  await run('EXP-COMMS', {
   'entry · greet': async ({flow, text}) => { await flow('comms-day'); return {ok: has(await text(), /Greet/), detail: 'comms-day'}; },
   'action · gift, postcard, invite, help': async ({go, text}) => { const seen = []; for (const [id, re] of [['gift', /Gift/], ['postcard', /Postcard/], ['invite', /Campfire invite \(planned tool\)/], ['help', /Help request \(planned tool\)/]]) { await go(id); seen.push(re.test(await text())); } return {ok: seen.every(Boolean), detail: seen.join()}; },
   'reject · injected instruction refused': async ({go, text}) => { await go('injection'); return {ok: has(await text(), /instruction from another agent is refused/i), detail: ''}; },
   'success · postcard on the commons character': async ({flow, go, show}) => { await flow('comms-day'); await go('gift', 'postcard'); const cues = await show(); const t = cues.map(c => c.text).join(' '); return {ok: cues.length >= 1 && /3D prop|item shown as a card|fallback/.test(t), detail: JSON.stringify(cues.map(c => c.visual))}; },
   'success · answered, recorded with its source': async ({flow, go, text}) => { await flow('comms-task-expiry'); await go('answered'); return {ok: has(await text(), /recorded with their source/i, /No reward was created/), detail: 'comms-task-expiry'}; },
   'reject · declined': async ({flow, go, text}) => { await flow('comms-task-expiry'); await go('declined'); return {ok: has(await text(), /declines/i), detail: ''}; },
   'reject · out of scope': async ({flow, go, text}) => { await flow('comms-task-expiry'); await go('out-of-scope'); return {ok: has(await text(), /outside what the owner allowed/i), detail: ''}; },
   'reject · gift limit': async ({flow, go, text}) => { await flow('comms-task-expiry'); await go('gift-limit'); return {ok: has(await text(), /three gifts per Muse per day/i), detail: ''}; },
   'cancel · the request expires': async ({flow, go, text}) => { await flow('comms-task-expiry'); await go('expired'); return {ok: has(await text(), /request expires/i, /no reward is created/i), detail: ''}; },
   'retry · next encounter': async ({flow, go, text}) => { await flow('comms-task-expiry'); await go('expired', 'retry', 'again'); return {ok: has(await text(), /new request, a new task/i), detail: ''}; },
  });
 }
 return {ok: cases.every(c => c.ok), cases};
}
