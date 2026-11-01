// Playwright CLI run-code callback: the welcome ritual end to end against a deployed Worker.
// Open the page with the judge link first (…/?judge=<token>) so a session exists. The camera is replaced by a
// synthetic canvas stream (no person), so the expected verdict is "not passed" — this proves the pipeline
// (server-chosen steps, live vision judging, request id, verdict-only log) without faking a pass.
async (page) => {
 const target = new URL(page.url());
 const ctx = await page.context().browser().newContext({viewport: {width: 1280, height: 900}});
 const p = await ctx.newPage(), errors = [];
 p.on('pageerror', e => errors.push(e.message));
 await p.addInitScript(() => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d');
  setInterval(() => { g.fillStyle = '#334'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText('no person here ' + Date.now() % 1000, 40, 240); }, 100);
  navigator.mediaDevices.getUserMedia = async () => c.captureStream(10);
 });
 try {
  target.searchParams.set('autoplay', '0');
  await p.goto(target.href, {waitUntil: 'domcontentloaded'});
  await p.waitForFunction(() => document.body.dataset.worldReady === '1', null, {timeout: 30000});
  await p.locator('#world-open').click();
  await p.locator('#world-panel .tab[data-tab="identity"]').click();
  await p.waitForSelector('.ritual button');
  await p.locator('.ritual button', {hasText: 'Try the ritual'}).click();
  await p.waitForFunction(() => /LIVE · Muse Spark vision|NOT JUDGED|could not run/.test(document.querySelector('.ritual-stage')?.textContent ?? ''), null, {timeout: 60000});
  const text = (await p.locator('.ritual-stage').textContent()).replace(/\s+/g, ' ');
  await p.screenshot({path: 'output/ritual-result.png'});
  if (!/LIVE · Muse Spark vision/.test(text)) throw Error('Ritual was not judged live: ' + text.slice(0, 200));
  if (!/Request [0-9a-f-]{20,}/.test(text)) throw Error('No request id shown: ' + text.slice(0, 200));
  if (!/Not passed/.test(text)) throw Error('A synthetic stream must not pass: ' + text.slice(0, 200));
  const ev = await p.evaluate(async () => (await (await fetch('/api/world/events?tail=20')).json()).filter(e => e.kind === 'ritual_judged').at(-1));
  if (!ev || ev.data.framesStored !== false || JSON.stringify(ev).includes('data:image')) throw Error('Ritual log must hold verdicts only');
  return {text: text.slice(0, 220), logged: {kind: ev.kind, passed: ev.data.passed, requestId: ev.data.evidence?.requestId}, errors};
 } finally { await ctx.close(); }
}
