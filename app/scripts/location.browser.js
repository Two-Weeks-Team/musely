// Playwright CLI run-code callback (I-08 #55): the owner location chip, the map-error note and the device location button. Open the
// target URL first (a local build or production). Screenshots go to output/location-<w>x<h>.png.
//  - At 390×844, 360×640 and 1280×800 the location chip is in the header and on the screen. With the map-error note (#network-note)
//    forced visible, the note covers neither the chip, any other header item, the story heading nor the time caption, stays on the
//    screen, and the page is as wide as the screen.
//  - Device location: until the button is pressed the page calls navigator.geolocation 0 times; one press calls it exactly once. Without
//    a granted permission the browser refuses, and the card shows the virtual-location guidance (data-fallback="1").
async (page) => {
 const base = new URL(page.url()); base.search = '';
 const browser = page.context().browser(), cases = [];
 const check = (vp, name, ok, detail = '') => cases.push({vp, name, ok: !!ok, detail: String(detail).slice(0, 260)});
 const hit = (a, b) => !!a && !!b && a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
 for (const [w, h] of [[390, 844], [360, 640], [1280, 800]]) {
  const vp = `${w}x${h}`, mobile = w < 700;
  const ctx = await browser.newContext({viewport: {width: w, height: h}, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2});
  // Count every geolocation call the page makes (the page keeps navigator.geolocation; this wraps its method in place).
  await ctx.addInitScript(() => { window.__geoCalls = 0; const g = navigator.geolocation; if (g) { const real = g.getCurrentPosition.bind(g); g.getCurrentPosition = (...a) => { window.__geoCalls++; return real(...a); }; } });
  const p = await ctx.newPage();
  try {
   await p.goto(base.href, {waitUntil: 'domcontentloaded'});
   await p.waitForSelector('#loc-chip', {timeout: 30000});
   await p.evaluate(() => { const n = document.getElementById('network-note'); n.hidden = false; n.textContent = 'Some map details could not load. Check your connection.'; });
   await p.waitForTimeout(400);
   const m = await p.evaluate(() => {
    const box = e => { if (!e || e.hidden || getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width > 1 ? [b.x, b.y, b.width, b.height] : null; };
    return {chip: box(document.getElementById('loc-chip')), note: box(document.getElementById('network-note')), header: box(document.querySelector('header')),
     items: [...document.querySelectorAll('header > *')].map(e => ({id: e.id || e.className || e.tagName, r: box(e)})).filter(x => x.r),
     heading: box(document.querySelector('#story-heading h1')), eyebrow: box(document.querySelector('#story-speaker')), caption: box(document.querySelector('.world-caption')),
     text: document.getElementById('loc-chip').textContent, inner: innerWidth, innerH: innerHeight, scrollW: document.documentElement.scrollWidth};
   });
   check(vp, 'location chip shown inside the header', m.chip && m.header && m.chip[1] >= m.header[1] - 1 && m.chip[1] + m.chip[3] <= m.header[1] + m.header[3] + 1 && m.chip[0] >= 0 && m.chip[0] + m.chip[2] <= m.inner + 1, JSON.stringify({chip: m.chip, header: m.header, text: m.text}));
   const over = m.items.filter(x => hit(x.r, m.note)).map(x => x.id);
   check(vp, 'the map-error note covers no header item (chip included)', m.note && over.length === 0, over.join(', ') || JSON.stringify(m.note));
   const under = ['heading', 'eyebrow', 'caption'].filter(k => hit(m[k], m.note));
   check(vp, 'the map-error note covers neither the story heading nor the time caption', under.length === 0, under.map(k => k + JSON.stringify(m[k])).join(' ') + ' note ' + JSON.stringify(m.note));
   check(vp, 'the map-error note stays on the screen', m.note && m.note[0] >= 0 && m.note[0] + m.note[2] <= m.inner + 1 && m.note[1] + m.note[3] <= m.innerH, JSON.stringify(m.note));
   check(vp, 'page as wide as the screen', m.scrollW <= m.inner, `${m.scrollW} > ${m.inner}`);
   await p.screenshot({path: `output/location-${vp}.png`});
   // Device location: nothing before the press, exactly one call after it.
   await p.evaluate(() => document.getElementById('world-open').click());
   await p.locator('.world-tabs .tab', {hasText: 'Location'}).first().click();
   await p.waitForSelector('#device-location-request', {timeout: 15000});
   const before = await p.evaluate(() => window.__geoCalls);
   check(vp, 'no geolocation call before the button is pressed', before === 0, before);
   await p.click('#device-location-request');
   await p.waitForFunction(() => !['idle', 'requesting'].includes(document.getElementById('device-location').dataset.status), null, {timeout: 70000});
   const after = await p.evaluate(() => ({calls: window.__geoCalls, status: document.getElementById('device-location').dataset.status, fallback: document.getElementById('device-location').dataset.fallback, text: document.getElementById('device-location').textContent}));
   check(vp, 'one press: exactly one geolocation call', after.calls === 1, JSON.stringify(after));
   check(vp, 'refused without permission: the virtual-location guidance shows', ['denied', 'unavailable', 'timeout'].includes(after.status) && after.fallback === '1' && /virtual location \(demo\)/.test(after.text), JSON.stringify(after));
   await p.screenshot({path: `output/location-${vp}-device.png`});
  } catch (e) { check(vp, 'run', false, e.message); }
  await ctx.close();
 }
 return {pass: cases.every(c => c.ok), failed: cases.filter(c => !c.ok), cases: cases.length};
}
