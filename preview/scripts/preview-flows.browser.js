// Playwright CLI run-code callback (P-05, also used by P-07). Open the target preview URL first: production, or a local
// dist served with `node scripts/serve-dist.mjs 8788`. Desktop 1440x900 and 390x844 touch emulation. Checks:
//   modes: Story (scripted) and Live world are explicit; leaving the story and coming back resumes where it was
//   continuity: the selected Muse, its state and its source stay visible from the close-up out to the map and back
//   cues: a Preview flows item change plays on the commons character with its clip and prop; a Muse that is not in
//     the commons gets a stated fallback; the world pauses during the cue and resumes after
//   layout: at 390 px the header rows do not cover the time caption or the story heading, and in Live world the story
//     heading and time caption stay off the welcome card
//   review regressions (PR #76): a cue never overrides a mode change; the pause button matches a cue-held world; a new
//     cue releases the previous character; a prop that did not load is not claimed; ?entry=watch boots cleanly
//   isolation: no non-GET request to /api while doing any of this; no page errors
// Returns {ok, cases}; screenshots go to output/preview-flows-*.png.
async (page) => {
  const base = new URL(page.url()); base.search = '?autoplay=0';
  const browser = page.context().browser(), cases = [];
  const check = (vp, name, ok, detail = '') => cases.push({vp, name, ok: !!ok, detail});
  const overlap = (a, b) => a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const mobile of [false, true]) {
    const vp = mobile ? 'mobile' : 'desktop';
    const ctx = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 900}, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1});
    await ctx.addInitScript(() => { window.__geoCalls = 0; const g = navigator.geolocation; if (g) for (const k of ['getCurrentPosition', 'watchPosition']) { const orig = g[k]?.bind(g); g[k] = (...a) => { window.__geoCalls++; return orig?.(...a); }; } });
    const p = await ctx.newPage(), errors = [], writes = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(r.method() + ' ' + r.url()); });
    try {
      await p.goto(base.href, {waitUntil: 'domcontentloaded'});
      await p.waitForFunction(() => window.__world?.getMetrics().ready && window.__world.getMetrics().characterKit, null, {timeout: 60000});
      await p.waitForTimeout(1500);
      const m = () => p.evaluate(() => { const w = window.__world, g = w.getMetrics(); return {mode: w.mode, tour: g.tour, elapsed: g.elapsed, paused: g.paused, selected: g.selected, zoom: g.zoom, tourText: document.getElementById('tour').textContent}; });

      // Modes and return.
      check(vp, 'starts in Live world with ?autoplay=0', (await m()).mode === 'world');
      await p.click('#mode-story'); await p.waitForTimeout(3500);
      let s = await m(); check(vp, 'Story mode plays the scripted story', s.mode === 'story' && s.tour && s.elapsed > 2, `elapsed ${s.elapsed.toFixed(1)}`);
      const left = s.elapsed;
      await p.click('#mode-world'); await p.waitForTimeout(3000);
      s = await m(); check(vp, 'Live world stops the story and offers to resume', s.mode === 'world' && !s.tour && /Resume story · 0:0\d/.test(s.tourText) && s.zoom < 17, `${s.tourText} zoom ${s.zoom.toFixed(1)}`);
      await p.screenshot({path: `output/preview-flows-${vp}-world-mode.png`});
      if (mobile) {
        const o = await p.evaluate(() => { const box = el => { if (!el) return null; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') return null; const b = el.getBoundingClientRect(); return b.width && b.height ? {x: b.x, y: b.y, width: b.width, height: b.height} : null; }; return {heading: box(document.getElementById('story-heading')), caption: box(document.getElementById('time-label')), welcome: box(document.getElementById('welcome'))}; });
        check(vp, 'Live world at 390 px: neither the story heading nor the time caption prints over the welcome card', !overlap(o.heading, o.welcome) && !overlap(o.caption, o.welcome), JSON.stringify(o));
      }
      await p.click('#mode-story'); await p.waitForTimeout(400);
      s = await m(); check(vp, 'returning to Story resumes where it left', s.mode === 'story' && s.tour && s.elapsed >= left - 0.2 && s.elapsed < left + 3, `left ${left.toFixed(1)} resumed ${s.elapsed.toFixed(1)}`);
      if (mobile) {
        await p.waitForTimeout(600);
        const r = await p.evaluate(() => { const box = el => { const b = el?.getBoundingClientRect(); return b && b.width && b.height ? {x: b.x, y: b.y, width: b.width, height: b.height} : null; }; return {header: [...document.querySelectorAll('header > *')].map(box).filter(Boolean), caption: box(document.querySelector('#time-label')), heading: box(document.querySelector('#story-heading h1')), eyebrow: box(document.querySelector('#story-speaker'))}; });
        const hits = r.header.filter(h => overlap(h, r.caption) || overlap(h, r.heading) || overlap(h, r.eyebrow));
        check(vp, 'header rows do not cover the caption or story heading at 390 px', hits.length === 0, `${hits.length} overlaps`);
        await p.screenshot({path: `output/preview-flows-${vp}-header.png`, clip: {x: 0, y: 0, width: 390, height: 340}});
      }

      // Continuity across zoom.
      await p.click('#mode-world'); await p.evaluate(() => window.__world.select(3)); await p.waitForTimeout(5200);
      const close = await p.evaluate(() => ({name: document.getElementById('muse-name').textContent, card: !document.getElementById('muse-card').hidden, source: document.getElementById('muse-source').textContent}));
      await p.evaluate(() => window.__world.map.jumpTo({zoom: 15})); await p.waitForTimeout(700);
      const farLine = await p.evaluate(() => ({hidden: document.getElementById('selected-line').hidden, text: document.getElementById('selected-line').textContent, selected: window.__world.getMetrics().selected, card: !document.getElementById('muse-card').hidden}));
      await p.screenshot({path: `output/preview-flows-${vp}-zoomed-out.png`});
      await p.evaluate(() => window.__world.map.jumpTo({zoom: 21.5})); await p.waitForTimeout(700);
      const back = await p.evaluate(() => ({name: document.getElementById('muse-name').textContent, card: !document.getElementById('muse-card').hidden, selected: window.__world.getMetrics().selected}));
      check(vp, 'selected Muse, state and source stay from close-up to map and back', close.card && close.source.includes('SCRIPTED') && !farLine.card && !farLine.hidden && farLine.text.startsWith(close.name) && farLine.text.includes('scripted story') && farLine.selected === 3 && back.card && back.name === close.name && back.selected === 3, `${close.name} | far: ${farLine.text}`);

      // Cues from Preview flows.
      await p.evaluate(() => window.__world.worldPanel.openTab('flows'));
      await p.click('.flow-list button[data-flow="p0-delegation"]');
      await p.click('.flow-controls button[data-goto="verify"]'); await p.click('.flow-controls button[data-goto="traded"]');
      await p.click('.flow-show'); await p.waitForTimeout(1900);
      const cue = await p.evaluate(() => ({result: document.querySelector('.flow-cue-result').textContent, cues: [...document.querySelectorAll('.preview-cue')].map(c => ({visual: c.dataset.visual, text: c.textContent})), held: [0, 7].map(i => window.__world.actor(i)?.getMetrics().held), paused: window.__world.getMetrics().paused, source: document.getElementById('muse-source').textContent}));
      check(vp, 'trade cue: both characters play their clip with the item card', cue.cues.length === 2 && cue.cues.every(c => c.visual === 'complete') && cue.held[0] === 'handoff_receive' && cue.held[1] === 'handoff_give' && cue.paused && cue.source.includes('PREVIEW FLOW'), JSON.stringify(cue.held) + ' ' + cue.result);
      await p.evaluate(() => document.getElementById('world-panel').hidePopover()); await p.waitForTimeout(200);
      await p.screenshot({path: `output/preview-flows-${vp}-cue.png`});
      await p.waitForTimeout(5200);
      const after = await p.evaluate(() => ({cues: document.querySelectorAll('.preview-cue').length, paused: window.__world.getMetrics().paused, held: window.__world.actor(0)?.getMetrics().held}));
      check(vp, 'cue ends: labels removed, hold released, world resumes', after.cues === 0 && after.held === null && after.paused === false, JSON.stringify(after));
      await p.evaluate(() => window.__world.worldPanel.openTab('flows'));
      await p.click('.flow-list button[data-flow="visitor-unclaimed"]'); await p.click('.flow-controls button[data-goto="attempt"]');
      await p.click('.flow-show'); await p.waitForTimeout(600);
      const fb = await p.evaluate(() => ({result: document.querySelector('.flow-cue-result').textContent, cues: [...document.querySelectorAll('.preview-cue')].map(c => c.dataset.visual)}));
      check(vp, 'a Muse outside the commons gets a stated fallback; the one inside plays', fb.result.includes('Copper: not in the commons') && fb.result.includes('Ink: clip') && fb.cues.length === 1, fb.result);
      await p.waitForTimeout(6500);
      await p.click('.flow-list button[data-flow="comms-day"]'); await p.click('.flow-controls button[data-goto="gift"]'); await p.click('.flow-controls button[data-goto="postcard"]');
      await p.click('.flow-show'); await p.waitForTimeout(1500);
      const prop = await p.evaluate(() => ({result: document.querySelector('.flow-cue-result').textContent, held: window.__world.actor(3)?.getMetrics().held, visible: window.__world.actor(3)?.visibleMaterials().length}));
      check(vp, 'a clip with a 3D prop shows the prop (Moss writes the postcard on a notepad)', prop.held === 'write_note' && prop.result.includes('Moss: clip with its 3D notepad'), prop.result);
      await p.evaluate(() => document.getElementById('world-panel').hidePopover()); await p.waitForTimeout(300);
      await p.screenshot({path: `output/preview-flows-${vp}-cue-prop.png`});

      // P-06 EXP-LOCATION: the scripted location states (entry, GPS permission states, walk, both refusals, teleport, arrive, switch back, retry).
      const flowText = () => p.evaluate(() => document.querySelector('.world-body')?.textContent ?? '');
      const go = async to => { await p.click(`.flow-controls button[data-goto="${to}"]`); await p.waitForTimeout(120); };
      await p.evaluate(() => window.__world.worldPanel.openTab('flows'));
      await p.click('.flow-list button[data-flow="location-walk"]');
      let t = await flowText();
      check(vp, 'location: entry says the source is a labelled virtual preset (DEMO) and no GPS is read', /virtual preset/.test(t) && /DEMO/.test(t) && /No device GPS is read/.test(t));
      await go('gps'); t = await flowText();
      check(vp, 'location: GPS permission states are shown without asking the browser', /not asked/.test(t) && /allowed/.test(t) && /denied/.test(t) && /No permission prompt/.test(t) && (await p.evaluate(() => window.__geoCalls)) === 0);
      await go('entry'); await go('move'); t = await flowText();
      check(vp, 'location: the owner moves the target cell; the Muse walks with an ETA', /Noodle Bar/.test(t) && /ETA/.test(t) && /on the way/.test(t));
      await go('not-arrived'); t = await flowText();
      check(vp, 'location reject: not arrived yet means no discovery and no trade', /Not arrived yet/.test(t) && /Discovery refused/.test(t) && /inventory unchanged/.test(t));
      await go('move'); await go('no-token'); t = await flowText();
      check(vp, 'location reject: a teleport without a Taxi Token is refused', /Teleport needs a Taxi Token/.test(t) && /Taxi Token in inventory\? no/.test(t) && /refused/.test(t));
      await go('taxi'); t = await flowText();
      check(vp, 'location: a verified teleport with a Taxi Token arrives at once and uses the token', /Verified teleport/.test(t) && /Taxi Token in inventory\? yes/.test(t) && /token used/.test(t));
      await go('arrived'); t = await flowText();
      check(vp, 'location success: arrived, so discovery is allowed at the current place', /Arrived/.test(t) && /Discovery allowed/.test(t));
      await go('switch-back'); t = await flowText();
      check(vp, 'location cancel: switching back does not teleport the Muse; it walks back', /walks back/.test(t) && /ETA/.test(t));
      await go('retry'); t = await flowText();
      check(vp, 'location retry: the neighborhood is verified again and the walk continues', /verify the neighborhood again/i.test(t) && /Walk continues/.test(t));
      check(vp, 'location: the browser was never asked for a position', (await p.evaluate(() => window.__geoCalls)) === 0);
      await p.evaluate(() => document.getElementById('world-panel').hidePopover()); await p.waitForTimeout(200);

      // Review regressions on PR #76 (Codex 1-4 and the bot P1). Cues here last 2.5 s.
      await p.waitForTimeout(6200);
      const cueOn = specs => p.evaluate(specs => window.__world.previewCue(specs.map(s => ({variant: window.__world.actor(s.i).variant, clip: s.clip, item: s.item ?? null, label: 'regression'})), 2.5).shown, specs);
      const st = () => p.evaluate(() => { const g = window.__world.getMetrics(), b = document.getElementById('pause'); return {mode: window.__world.mode, tour: g.tour, tourCamera: g.tourCamera, paused: g.paused, elapsed: g.elapsed, zoom: g.zoom, pauseText: b.textContent, pressed: b.getAttribute('aria-pressed'), tourText: document.getElementById('tour').textContent, cues: document.querySelectorAll('.preview-cue').length}; });
      const note = [{i: 3, clip: 'write_note', item: 'notepad'}];
      // Codex 1 / bot P2: switching mode while a cue plays must not let the cue's saved state undo the choice.
      await p.click('#mode-story'); await p.waitForTimeout(700);
      await cueOn(note); await p.click('#mode-world'); await p.waitForTimeout(3300);
      let a = await st(); await p.waitForTimeout(900); let b = await st();
      check(vp, 'Story -> cue -> Live world: the cue ending does not restart the story or snap the camera back', a.mode === 'world' && !a.tour && !a.tourCamera && a.cues === 0 && /Resume story/.test(a.tourText) && b.elapsed === a.elapsed && !b.tourCamera && b.zoom < 17, JSON.stringify({a, b}));
      await p.click('#mode-world'); await p.waitForTimeout(600);
      await cueOn(note); await p.click('#mode-story'); await p.waitForTimeout(3300);
      a = await st(); await p.waitForTimeout(800); b = await st();
      check(vp, 'Live world -> cue -> Story: the cue ending does not stop the story', a.mode === 'story' && a.tour && a.cues === 0 && b.tour && b.elapsed > a.elapsed + 0.4, JSON.stringify({a, b}));
      // Codex 2: the pause button tells the truth while a cue holds the world, and pressing it ends the cue.
      await p.click('#mode-world'); await p.waitForTimeout(500);
      await cueOn(note); await p.waitForTimeout(400); a = await st();
      check(vp, 'during a cue the pause button reads "Paused for preview" and is pressed', a.paused && a.pauseText === 'Paused for preview' && a.pressed === 'true', JSON.stringify(a));
      await p.click('#pause'); await p.waitForTimeout(300); b = await st();
      check(vp, 'pressing it ends the cue and resumes the world', b.cues === 0 && !b.paused && b.pauseText === 'Pause world' && b.pressed === 'false', JSON.stringify(b));
      await cueOn(note); await p.waitForTimeout(3300); a = await st();
      check(vp, 'when the cue runs out the button is back to "Pause world"', a.cues === 0 && !a.paused && a.pauseText === 'Pause world' && a.pressed === 'false', JSON.stringify(a));
      await p.click('#pause'); await cueOn(note); await p.waitForTimeout(3300); a = await st();
      check(vp, 'a world you paused yourself stays paused after a cue, and the button says so', a.cues === 0 && a.paused && a.pauseText === 'Resume world' && a.pressed === 'true', JSON.stringify(a));
      await p.click('#pause'); await p.waitForTimeout(300);
      // Codex 3: replacing a cue releases the previous character.
      await cueOn([{i: 0, clip: 'handoff_receive'}]); await p.waitForTimeout(300);
      await cueOn(note); await p.waitForTimeout(200);
      const heldNow = await p.evaluate(() => [0, 3].map(i => window.__world.actor(i).getMetrics().held));
      check(vp, 'a new cue releases the previous character\'s hold', heldNow[0] === null && heldNow[1] === 'write_note', JSON.stringify(heldNow));
      await p.waitForTimeout(2800);
      // Bot P1: ?entry=watch starts the story during onboarding mount, before the mode controls would exist.
      const wp = await ctx.newPage(), werr = [];
      wp.on('pageerror', e => werr.push(e.message));
      const wurl = new URL(base.href); wurl.search = '?autoplay=0&entry=watch';
      await wp.goto(wurl.href, {waitUntil: 'domcontentloaded'});
      const wup = await wp.waitForFunction(() => window.__world?.getMetrics().ready && window.__world.getMetrics().characterKit, null, {timeout: 30000}).then(() => true, () => false);
      const w = wup ? await wp.evaluate(() => ({mode: window.__world.mode, tour: window.__world.getMetrics().tour, cue: typeof window.__world.previewCue, pressed: document.getElementById('mode-story').getAttribute('aria-pressed')})) : null;
      check(vp, '?entry=watch boots: the story plays, mode controls and cues exist, no errors', wup && w.mode === 'story' && w.tour && w.cue === 'function' && w.pressed === 'true' && werr.length === 0, JSON.stringify({w, werr}));
      await wp.close();
      // Codex 4: a prop that did not load must not be reported as shown.
      const bctx = await browser.newContext({viewport: mobile ? {width: 390, height: 844} : {width: 1440, height: 900}, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1});
      await bctx.route('**/attachments/props.glb', r => r.abort());
      const bp = await bctx.newPage(), berr = [];
      bp.on('pageerror', e => berr.push(e.message));
      await bp.goto(base.href, {waitUntil: 'domcontentloaded'});
      await bp.waitForFunction(() => window.__world?.getMetrics().ready && window.__world.getMetrics().characterKit, null, {timeout: 60000});
      await bp.waitForTimeout(2500);
      const np = await bp.evaluate(() => { const wd = window.__world, out = wd.previewCue([{variant: wd.actor(3).variant, clip: 'write_note', item: 'notepad', label: 'no props'}], 3), el = document.querySelector('.preview-cue'); return {result: out.results[0], visual: el?.dataset.visual, text: el?.textContent, propsLoaded: wd.actor(3).propsLoaded}; });
      check(vp, 'props file missing: the cue says fallback and does not claim a 3D prop', np.propsLoaded === false && np.visual === 'fallback' && !/3D prop notepad/.test(np.text) && np.result.prop === null && np.result.visual === 'fallback' && berr.length === 0, JSON.stringify(np));
      await bp.screenshot({path: `output/preview-flows-${vp}-cue-no-prop.png`});
      await bctx.close();
      check(vp, 'no /api writes', writes.length === 0, writes.join(' '));
      check(vp, 'no page errors', errors.length === 0, errors.join(' / '));
    } catch (e) { check(vp, 'run', false, String(e).slice(0, 300)); }
    await ctx.close();
  }
  return {ok: cases.every(c => c.ok), cases};
}
