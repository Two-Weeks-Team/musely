// Welcome ritual UI (direction v2, 6.4). The server picks three actions; the browser shows a mirrored preview
// (like a mirror) but sends raw, non-mirrored frames, and says so in the judging prompt. Frames go to the
// Muse Spark judge through the Worker and are not stored by Musely; only per-step verdicts are logged.
import {ensureSession, sparkStatus} from '../live';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
type Verdict = {step: string; passed: boolean; confidence: number; observation?: string};

/** Recorded result card (default) plus the "try it yourself" flow. Returns the container to insert. */
export function ritualCard(onDone: () => void) {
  const box = el('div', 'id-card ritual');
  box.append(el('span', 'eyebrow', 'WELCOME RITUAL · A PERSON IS PRESENT'), el('h4', '', 'Three quick moves, judged by Muse Spark vision'));
  const recorded = el('div', 'ritual-recorded');
  box.append(recorded, el('p', 'muted', 'Your camera frames go through our server to the Muse Spark judge and are not stored by Musely. Only pass/fail per step, confidence and the request id are kept. Meta’s own retention applies to the request. The aim is to make it costlier for a bot than for a person, not impossible.'));
  const start = el('button', 'secondary', 'Try the ritual with your camera'); start.type = 'button';
  const stage = el('div', 'ritual-stage'); stage.hidden = true;
  box.append(start, stage);

  void fetch('/api/ritual/record', {cache: 'no-store'}).then(r => r.ok ? r.json() : null).then((j: any) => {
    const rec = j?.record;
    recorded.replaceChildren(el('span', 'src src-replay', 'REPLAY · recorded'), el('p', 'muted', rec ? `Kim Sejun's recorded ritual, ${new Date(rec.at).toISOString().slice(0, 16).replace('T', ' ')} UTC: ${rec.passed ? 'passed' : 'not passed'} (request ${rec.requestId ?? '—'}). This record proves nothing about a new visitor.` : 'The owner’s recorded ritual has not been made yet.'));
    if (rec) recorded.append(results(rec.results));
  }).catch(() => {});

  // The ritual lives only while its card is on screen: a tab change removes the card and closing the panel hides
  // it; either way capture stops, the camera is released and nothing more is uploaded.
  const onScreen = () => box.isConnected && !!box.closest(':popover-open');
  class Dismissed extends Error {}
  start.onclick = async () => {
    start.disabled = true; stage.hidden = false; stage.replaceChildren(el('p', 'muted', 'Preparing a session…'));
    let stream: MediaStream | null = null;
    const guard = () => { if (!onScreen()) { stream?.getTracks().forEach(t => t.stop()); stream = null; throw new Dismissed(); } };
    try {
      const st = await sparkStatus(); if (st) await ensureSession(st);
      const ch = await fetch('/api/ritual/start', {method: 'POST'});
      if (!ch.ok) throw new Error(ch.status === 401 ? 'a session is required' : 'could not start (' + ch.status + ')');
      const {id, steps} = await ch.json() as {id: string; steps: {id: string; text: string}[]};
      stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}}, audio: false});
      guard();
      const video = el('video', 'ritual-video'); video.muted = true; video.playsInline = true; video.srcObject = stream; await video.play();
      const prompt = el('p', 'ritual-prompt'), count = el('p', 'ritual-count');
      stage.replaceChildren(video, prompt, count);
      const frames: string[] = [];
      for (let i = 0; i < steps.length; i++) {
        prompt.textContent = `${i + 1}/3 · Please ${steps[i].text}.`;
        for (let n = 3; n > 0; n--) { guard(); count.textContent = String(n); await new Promise(r => setTimeout(r, 1000)); }
        guard();
        count.textContent = '●';
        frames.push(capture(video));
        await new Promise(r => setTimeout(r, 300));
      }
      guard();
      stream?.getTracks().forEach(t => t.stop()); stream = null;
      prompt.textContent = 'Judging…'; count.textContent = '';
      const r = await fetch('/api/muse', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'challenge', input: {challengeId: id, frames}})});
      const j = await r.json();
      stage.replaceChildren();
      if (!r.ok) throw new Error(j.error ?? String(r.status));
      const live = j.source === 'live';
      stage.append(el('span', 'src ' + (live ? 'src-live' : 'src-replay'), live ? 'LIVE · Muse Spark vision' : `NOT JUDGED · ${j.reason}`));
      const res = (j.output?.results ?? []) as Verdict[];
      if (res.length) { stage.append(el('p', '', res.every(x => x.passed) ? 'Passed: a person did all three moves.' : 'Not passed. You can try again.'), results(res.map((x, k) => ({...x, step: steps[k]?.text ?? x.step})))); }
      if (j.evidence?.requestId) stage.append(el('p', 'muted', `Request ${j.evidence.requestId} · ${j.evidence.latencyMs} ms`));
      onDone();
    } catch (err) {
      if (err instanceof Dismissed) { stage.replaceChildren(el('p', 'muted', 'Ritual cancelled: nothing was sent.')); return; }
      stage.replaceChildren(el('p', 'muted', 'The ritual could not run: ' + (err as Error).message + '. The recorded ritual above still shows how it works.'));
    } finally {
      stream?.getTracks().forEach(t => t.stop());
      start.disabled = false;
    }
  };
  return box;
}

/** Raw (non-mirrored) JPEG frame, 512 px wide, as a data URL under the proxy's 300 KB limit. */
function capture(video: HTMLVideoElement) {
  const w = 512, h = Math.round(w * (video.videoHeight || 480) / (video.videoWidth || 640));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(video, 0, 0, w, h);
  let q = .72, url = c.toDataURL('image/jpeg', q);
  while (url.length > 380_000 && q > .3) { q -= .12; url = c.toDataURL('image/jpeg', q); }
  return url;
}

function results(list: Verdict[]) {
  const t = el('table', 'data');
  for (const r of list) { const tr = el('tr', r.passed ? 'after' : ''); tr.append(el('td', '', r.step.replace(/_/g, ' ')), el('td', '', r.passed ? 'passed' : 'not passed'), el('td', '', `confidence ${Math.round(r.confidence * 100)}%`)); t.append(tr); }
  return t;
}
