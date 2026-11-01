// Real-device measurement (direction 20.4, 17 "DPR cap"): `?perf=1` shows frame rate and render cost on
// the device itself; `?dpr=1|1.5|2|max` overrides the pixel-ratio cap for that visit so one phone can
// compare caps. The default cap is decided from these measurements and recorded in the docs.

/** Default DPR cap until real-device results say otherwise (null = no cap, the device ratio is used). */
export const DEFAULT_DPR_CAP: number | null = null;

export function pixelRatioFor(search = location.search, device = window.devicePixelRatio || 1) {
  const q = new URLSearchParams(search).get('dpr');
  const cap = q === 'max' ? null : q && Number(q) > 0 ? Math.min(4, Math.max(.5, Number(q))) : DEFAULT_DPR_CAP;
  return {device, cap, applied: cap === null ? device : Math.min(device, cap), source: q ? 'url' : 'default'};
}

type Sample = {fps: number; worstMs: number; drawCalls: number; triangles: number};
export function mountPerf(getSample: () => {drawCalls: number; triangles: number; canvas: HTMLCanvasElement}, ratio: ReturnType<typeof pixelRatioFor>) {
  if (!new URLSearchParams(location.search).has('perf')) return null;
  const box = document.createElement('div');
  box.id = 'perf';
  const text = document.createElement('pre');
  const copy = document.createElement('button');
  copy.type = 'button'; copy.textContent = 'Copy measurement';
  box.append(text, copy);
  document.body.append(box);
  let frames = 0, worst = 0, last = performance.now(), windowStart = last;
  const history: Sample[] = [];
  const nav = navigator as Navigator & {deviceMemory?: number; hardwareConcurrency?: number};
  const loop = (now: number) => {
    const dt = now - last; last = now; frames++; worst = Math.max(worst, dt);
    if (now - windowStart >= 1000) {
      const s = getSample();
      history.push({fps: Math.round(frames * 1000 / (now - windowStart)), worstMs: Math.round(worst), drawCalls: s.drawCalls, triangles: s.triangles});
      if (history.length > 60) history.shift();
      const recent = history.slice(-10), avg = Math.round(recent.reduce((a, b) => a + b.fps, 0) / recent.length);
      text.textContent = [
        `fps ${history.at(-1)!.fps} (10 s avg ${avg}) · worst frame ${history.at(-1)!.worstMs} ms`,
        `DPR device ${ratio.device} · applied ${ratio.applied} (${ratio.cap === null ? 'no cap' : 'cap ' + ratio.cap}, ${ratio.source})`,
        `buffer ${s.canvas.width}×${s.canvas.height} · css ${s.canvas.clientWidth}×${s.canvas.clientHeight}`,
        `draw calls ${s.drawCalls} · triangles ${s.triangles}`,
        `cores ${nav.hardwareConcurrency ?? '?'} · memory ${nav.deviceMemory ?? '?'} GB`,
      ].join('\n');
      frames = 0; worst = 0; windowStart = now;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const report = () => {
    const recent = history.slice(-30);
    return {
      at: new Date().toISOString(), ua: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: ratio,
      fpsAvg30s: recent.length ? Math.round(recent.reduce((a, b) => a + b.fps, 0) / recent.length) : null,
      fpsMin30s: recent.length ? Math.min(...recent.map(r => r.fps)) : null,
      worstFrameMs30s: recent.length ? Math.max(...recent.map(r => r.worstMs)) : null,
      buffer: (() => { const s = getSample(); return [s.canvas.width, s.canvas.height]; })(),
      cores: nav.hardwareConcurrency ?? null, memoryGb: nav.deviceMemory ?? null,
    };
  };
  copy.onclick = async () => {
    const r = JSON.stringify(report());
    try { await navigator.clipboard.writeText(r); copy.textContent = 'Copied'; } catch { text.textContent += '\n' + r; copy.textContent = 'Shown above'; }
    setTimeout(() => (copy.textContent = 'Copy measurement'), 2000);
  };
  return {report};
}
