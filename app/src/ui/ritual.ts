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

  // A permission prompt can outlive the card. Cancel immediately; stop any stream that arrives later.
  const onScreen = () => box.isConnected && !!box.closest(':popover-open') && document.visibilityState !== 'hidden';
  class Dismissed extends Error {}
  start.onclick = async () => {
    if (start.disabled) return;
    start.disabled = true; stage.hidden = false; stage.tabIndex = -1;
    stage.setAttribute('role', 'region'); stage.setAttribute('aria-label', 'Camera ritual');
    const cancel = el('button', 'secondary ritual-cancel', '취소 · Cancel'); cancel.type = 'button';
    const prompt = el('p', 'ritual-prompt', 'Allow the camera to see your preview. Nothing is photographed yet.');
    const count = el('p', 'ritual-count'); count.setAttribute('aria-live', 'polite'); count.setAttribute('aria-atomic', 'true');
    const controls = el('div', 'ritual-controls'); controls.append(cancel);
    stage.replaceChildren(prompt, count, controls);
    const focusStage = () => { stage.scrollIntoView({block: 'nearest', behavior: 'instant'}); stage.focus({preventScroll: true}); };
    focusStage();
    let stream: MediaStream | null = null, video: HTMLVideoElement | null = null;
    let cancelled: Error | null = null, sent = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>(), frames: string[] = [];
    const abort = new AbortController();
    let rejectCancellation!: (err: Error) => void;
    const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
    void cancellation.catch(() => {}); // Also handled when dismissal precedes the first asynchronous wait.
    const stopCamera = () => { const current = stream; stream = null; current?.getTracks().forEach(t => t.stop()); if (video) video.srcObject = null; };
    const cancelRun = (reason: Error = new Dismissed()) => {
      if (cancelled) return;
      cancelled = reason; stopCamera(); frames.length = 0; abort.abort(); rejectCancellation(reason);
    };
    const guard = () => { if (!onScreen()) cancelRun(); if (cancelled) throw cancelled; };
    const wait = async <T,>(promise: Promise<T>): Promise<T> => { const value = await Promise.race([promise, cancellation]); guard(); return value; };
    const pause = (ms: number) => wait(new Promise<void>(resolve => { const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms); timers.add(timer); }));
    const countdown = async () => { for (let n = 3; n > 0; n--) { guard(); count.textContent = String(n); await pause(1000); } count.textContent = ''; };
    const ready = async (label: string, focus = true) => {
      guard();
      const button = el('button', 'secondary ritual-ready', label); button.type = 'button';
      controls.replaceChildren(button, cancel);
      if (focus) { button.scrollIntoView({block: 'nearest', behavior: 'instant'}); button.focus({preventScroll: true}); }
      await wait(new Promise<void>(resolve => { button.onclick = () => { if (button.disabled) return; button.disabled = true; resolve(); }; }));
      controls.replaceChildren(cancel);
    };
    const visibility = () => { if (!onScreen()) cancelRun(); };
    const observer = new MutationObserver(visibility);
    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class']});
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('toggle', visibility, true);
    cancel.onclick = () => cancelRun();
    try {
      guard();
      const pendingStream = navigator.mediaDevices.getUserMedia({video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}}, audio: false}).then(s => {
        if (cancelled || !onScreen()) { s.getTracks().forEach(t => t.stop()); throw new Dismissed(); }
        stream = s; return s;
      });
      await wait(pendingStream);
      video = el('video', 'ritual-video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
      stage.replaceChildren(video, prompt, count, controls); await wait(video.play());
      prompt.textContent = 'Ready? · 준비됐나요? Check your preview and prepare anything you need, including dated paper. Each move waits for you. No photo has been taken.';
      focusStage();
      await ready('준비됐어요 · Ready', false);
      await countdown();
      // Start the three-minute server challenge only after the person has had time to prepare.
      prompt.textContent = 'Preparing your three moves…';
      const st = await wait(sparkStatus()); if (st) await wait(ensureSession(st));
      guard();
      const ch = await wait(fetch('/api/ritual/start', {method: 'POST', signal: abort.signal}));
      if (!ch.ok) throw new Error(ch.status === 401 ? 'a session is required' : 'could not start (' + ch.status + ')');
      const {id, steps, expiresAt} = await wait(ch.json()) as {id: string; steps: {id: string; text: string}[]; expiresAt: number};
      if (steps.length !== 3 || !Number.isFinite(expiresAt)) throw new Error('could not read the three moves');
      expiry = setTimeout(() => cancelRun(new Error('The three-minute ritual expired. No frames were sent')), Math.max(0, expiresAt - Date.now()));
      for (let i = 0; i < steps.length; i++) {
        count.textContent = '';
        prompt.textContent = `${i + 1}/3 · Please ${steps[i].text}. Prepare at your own pace, then press the button. Complete all three moves within three minutes.`;
        await ready('이 동작 준비됐어요');
        await countdown();
        guard(); count.textContent = '●'; frames.push(capture(video));
      }
      guard();
      if (Date.now() >= expiresAt) throw new Error('The three-minute ritual expired. No frames were sent');
      clearTimeout(expiry); expiry = undefined;
      stopCamera(); prompt.textContent = 'Judging…'; count.textContent = ''; controls.replaceChildren(cancel);
      sent = true;
      const r = await wait(fetch('/api/muse', {method: 'POST', headers: {'content-type': 'application/json'}, signal: abort.signal, body: JSON.stringify({action: 'challenge', input: {challengeId: id, frames}})}));
      frames.length = 0;
      const j = await wait(r.json());
      stage.replaceChildren();
      if (!r.ok) throw new Error(j.error ?? String(r.status));
      const live = j.source === 'live';
      stage.append(el('span', 'src ' + (live ? 'src-live' : 'src-replay'), live ? 'LIVE · Muse Spark vision' : `NOT JUDGED · ${j.reason}`));
      const res = (j.output?.results ?? []) as Verdict[];
      if (res.length) { stage.append(el('p', '', res.every(x => x.passed) ? 'Passed: a person did all three moves.' : 'Not passed. You can try again.'), results(res.map((x, k) => ({...x, step: steps[k]?.text ?? x.step})))); }
      if (j.evidence?.requestId) stage.append(el('p', 'muted', `Request ${j.evidence.requestId} · ${j.evidence.latencyMs} ms`));
      onDone();
    } catch (err) {
      if (err instanceof Dismissed) { stage.replaceChildren(el('p', 'muted', sent ? 'Ritual closed. Judging may already have received the three frames.' : 'Ritual cancelled: nothing was sent.')); return; }
      stage.replaceChildren(el('p', 'muted', 'The ritual could not run: ' + (err as Error).message + '. The recorded ritual above still shows how it works.'));
    } finally {
      observer.disconnect(); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('toggle', visibility, true);
      clearTimeout(expiry); for (const timer of timers) clearTimeout(timer);
      frames.length = 0; stopCamera(); start.disabled = false;
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
