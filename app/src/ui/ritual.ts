// Welcome ritual UI (direction v2, 6.4). The server picks three actions; the browser shows a mirrored preview
// (like a mirror) but sends raw, non-mirrored frames, and says so in the judging prompt. Frames go to the
// Muse Spark judge through the Worker and are not stored by Musely; only per-step verdicts are logged.
import {ensureSession, sparkStatus} from '../live';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
type Verdict = {step: string; passed: boolean; confidence: number; observation?: string};

function cameraFailure(error: unknown): string | null {
  const name = error instanceof Error ? error.name : null;
  if (name === 'NotAllowedError') return 'Chrome 사이트 정보 → 사이트 설정 → 카메라와 macOS 시스템 설정 → 개인정보 보호 및 보안 → 카메라에서 허용해 주세요. 둘 다 허용했다면 페이지를 새로 여세요. · Allow Chrome Site information → Site settings → Camera and macOS Privacy & Security → Camera. If both are allowed, reopen this page; its camera policy may be blocking access.';
  if (name === 'NotFoundError') return '카메라를 연결하면 다시 할 수 있어요. 지금은 동네를 관전하거나 방문할 수 있어요. · No camera was found. Connect or enable a camera to retry; you can watch or visit now.';
  if (name === 'NotReadableError') return '카메라를 쓰는 다른 앱을 닫고 장치 연결을 확인해 주세요. · Another app may be using it, or the device may be unavailable. Close other camera apps and check the device.';
  return null;
}

const poses: Record<string, string> = {
  raise_left_hand: '왼손을 들어 주세요 · Raise your left hand',
  raise_right_hand: '오른손을 들어 주세요 · Raise your right hand',
  turn_head_left: '고개를 자신의 왼쪽으로 돌려 주세요 · Turn your head to your left',
  turn_head_right: '고개를 자신의 오른쪽으로 돌려 주세요 · Turn your head to your right',
  show_date_paper: '오늘 날짜를 쓴 종이를 보여 주세요 · Show a paper with today’s date',
  thumbs_up: '엄지손가락을 들어 주세요 · Show a thumbs-up',
  touch_nose: '손가락으로 코를 만져 주세요 · Touch your nose with one finger',
  show_open_palm: '손바닥을 펼쳐 보여 주세요 · Show an open palm',
};

/** Recorded result card (default) plus the "try it yourself" flow. Returns the container to insert. */
export function ritualCard(onDone: () => void) {
  const box = el('div', 'id-card ritual');
  box.append(el('span', 'eyebrow', '본인 확인 · Welcome'), el('h4', '', '세 동작으로 시작해요 · Start with three moves'));
  const history = el('details', 'ritual-recorded'); history.append(el('summary', '', '진행 예시 보기 · See an example'));
  const recorded = el('div'); history.append(recorded);
  box.append(el('p', 'muted', '실제 사람이 있는지 확인해요. 사진 3장은 서버를 거쳐 Meta로 전송되며 Musely는 보관하지 않아요. 결과만 보관하며 Meta의 보관 정책이 적용돼요. · Three photos check that a person is present. They go through our server to Meta; Musely keeps only results. Meta’s retention policy applies.'), history);
  const start = el('button', 'primary', '카메라로 시작 · Try the ritual'); start.type = 'button';
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
    start.disabled = true; start.hidden = true; stage.hidden = false; stage.tabIndex = -1;
    stage.setAttribute('role', 'region'); stage.setAttribute('aria-label', 'Camera ritual');
    const cancel = el('button', 'secondary ritual-cancel', '취소 · Cancel'); cancel.type = 'button';
    const prompt = el('p', 'ritual-prompt', '카메라를 허용하면 미리보기가 나와요. 아직 촬영하지 않아요. · Allow the camera to see your preview. No photo yet.');
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
      const button = el('button', 'primary ritual-ready', label); button.type = 'button';
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
      prompt.textContent = '미리보기 안에 얼굴과 손이 보이나요? 오늘 날짜를 쓴 종이도 준비해 주세요. 준비 버튼을 누르기 전에는 촬영하지 않아요. · Check your face and hands in the preview and prepare paper with today’s date. Each move waits until you are ready.';
      focusStage();
      await ready('준비됐어요 · Ready', false);
      await countdown();
      // Start the three-minute server challenge only after the person has had time to prepare.
      prompt.textContent = '세 동작을 준비하고 있어요 · Preparing your three moves…';
      const st = await wait(sparkStatus()); if (st) await wait(ensureSession(st));
      guard();
      const requestedAt = performance.now();
      const ch = await wait(fetch('/api/ritual/start', {method: 'POST', signal: abort.signal}));
      if (!ch.ok) throw new Error(ch.status === 401 ? 'a session is required' : 'could not start (' + ch.status + ')');
      const {id, steps, expiresAt} = await wait(ch.json()) as {id: string; steps: {id: string; text: string}[]; expiresAt: number};
      if (steps.length !== 3 || !Number.isFinite(expiresAt)) throw new Error('could not read the three moves');
      // HTTP Date and expiresAt share the server clock. Subtract the full request elapsed time
      // conservatively and then use a monotonic clock, so an incorrect device clock cannot cancel
      // a fresh challenge. Without Date, the server's three-minute TTL is still an upper bound.
      const serverDate = Date.parse(ch.headers.get('date') ?? '');
      const remaining = Math.max(0, Math.min(180000, Number.isFinite(serverDate) ? expiresAt - serverDate - 1000 : 180000) - (performance.now() - requestedAt));
      const deadline = performance.now() + remaining;
      expiry = setTimeout(() => cancelRun(new Error('The three-minute ritual expired. No frames were sent')), remaining);
      for (let i = 0; i < steps.length; i++) {
        count.textContent = '';
        prompt.textContent = `${i + 1}/3 · ${poses[steps[i].id] ?? steps[i].text}. 미리보기를 보며 준비한 뒤 눌러 주세요. 3분 안에 마쳐 주세요. · Prepare in the preview, then press Ready. Finish within three minutes.`;
        await ready('동작 준비됐어요 · Ready for this move');
        await countdown();
        guard(); count.textContent = '●'; frames.push(capture(video));
      }
      guard();
      if (performance.now() >= deadline) throw new Error('The three-minute ritual expired. No frames were sent');
      clearTimeout(expiry); expiry = undefined;
      stopCamera(); prompt.textContent = '결과를 확인하고 있어요 · Checking your moves…'; count.textContent = ''; controls.replaceChildren(cancel);
      sent = true;
      const r = await wait(fetch('/api/muse', {method: 'POST', headers: {'content-type': 'application/json'}, signal: abort.signal, body: JSON.stringify({action: 'challenge', input: {challengeId: id, frames}})}));
      frames.length = 0;
      const j = await wait(r.json());
      stage.replaceChildren();
      if (!r.ok) throw new Error(j.error ?? String(r.status));
      const live = j.source === 'live';
      stage.append(el('span', 'src ' + (live ? 'src-live' : 'src-replay'), live ? 'LIVE · Muse Spark vision' : '아직 확인하지 못했어요. 잠시 후 다시 해 주세요. · Not checked yet. Please retry shortly.'));
      const res = (j.output?.results ?? []) as Verdict[];
      if (res.length) { stage.append(el('p', '', res.every(x => x.passed) ? '확인됐어요 · All three moves passed.' : '얼굴과 손이 미리보기에 잘 보이도록 맞추고 다시 해 주세요. · Not passed. Keep your face and hands visible, then retry.'), results(res.map((x, k) => ({...x, step: poses[steps[k]?.id] ?? steps[k]?.text ?? x.step})))); }
      if (j.evidence?.requestId) stage.append(el('p', 'muted', `Request ${j.evidence.requestId} · ${j.evidence.latencyMs} ms`));
      onDone();
    } catch (err) {
      if (err instanceof Dismissed) { stage.replaceChildren(el('p', 'muted', sent ? 'Ritual closed. Judging may already have received the three frames.' : 'Ritual cancelled: nothing was sent.')); return; }
      stage.replaceChildren(el('p', 'muted', cameraFailure(err) ?? '연결과 조명을 확인하고 다시 해 주세요. 시간이 지났다면 처음부터 시작해 주세요. · Check your connection and lighting, then retry. If the time expired, start again.'));
      if (err instanceof Error && err.name === 'NotFoundError') {
        const visit = el('button', 'primary', '동네 둘러보기 · Watch the neighborhood'); visit.type = 'button';
        visit.onclick = () => { box.closest<HTMLElement>(':popover-open')?.hidePopover(); };
        stage.append(visit);
      }
    } finally {
      observer.disconnect(); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('toggle', visibility, true);
      clearTimeout(expiry); for (const timer of timers) clearTimeout(timer);
      frames.length = 0; stopCamera(); start.disabled = false; start.hidden = false; start.textContent = '다시 하기 · Retry';
      start.className = stage.querySelector?.('button.primary') ? 'secondary' : 'primary';
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
