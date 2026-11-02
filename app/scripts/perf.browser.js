// Playwright CLI run-code callback: ?perf overlay and ?dpr caps on a DPR-3 phone emulation.
async (page) => {
 const base = new URL(page.url()), out = [];
 for (const dpr of ['1', '2', 'max']) {
  const ctx = await page.context().browser().newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true});
  const p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message));
  try {
   base.search = `?autoplay=0&perf=1&dpr=${dpr}`;
   await p.goto(base.href, {waitUntil: 'domcontentloaded'});
   await p.waitForFunction(() => window.__world?.getMetrics().ready, null, {timeout: 30000});
   await p.waitForFunction(() => /fps \d+/.test(document.querySelector('#perf pre')?.textContent ?? ''), null, {timeout: 10000});
   const m = await p.evaluate(() => ({ratio: window.__world.pixelRatio, w: window.__world.map.getCanvas().width, cw: window.__world.map.getCanvas().clientWidth, text: document.querySelector('#perf pre').textContent}));
   const expect = dpr === 'max' ? 3 : Number(dpr);
   if (Math.abs(m.w / m.cw - expect) > .05) throw Error(`dpr=${dpr}: buffer ratio ${m.w / m.cw}`);
   out.push({dpr, applied: m.ratio.applied, buffer: m.w, css: m.cw, overlay: m.text.split('\n')[0]});
   if (errors.length) throw Error(errors.join('; '));
  } finally { await ctx.close(); }
 }
 return out;
}
