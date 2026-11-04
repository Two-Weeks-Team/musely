import {uiText} from './i18n.ts';
// A visitor check is interactive UI, separate from owner/OAuth authority.
// Tokens stay in this call's memory and are passed only to the session POST.
const WAIT_MS = 120000;
type Widget = {render(host: HTMLElement, options: {sitekey: string; appearance: string; callback: (token: string) => void; 'error-callback': () => void; 'expired-callback': () => void; 'timeout-callback': () => void}): string; remove(id: string): void};

export function verifyVisitor<T>(sitekey: string, load: (signal: AbortSignal) => Promise<void>, post: (token: string, signal: AbortSignal) => Promise<T>): Promise<T> {
  if (document.visibilityState === 'hidden') return Promise.reject(new Error(uiText('화면으로 돌아와 다시 눌러 주세요. / Return to this page and try again.')));
  const card = document.createElement('section');
  card.className = 'session-verification';
  card.setAttribute('popover', 'manual');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', uiText('방문자 확인 / Visitor verification'));
  const heading = document.createElement('h2'); heading.textContent = uiText('방문자 확인 / Visitor verification');
  const why = document.createElement('p'); why.textContent = uiText('공개 체험을 위한 익명 세션을 열기 전에 확인이 필요해요. 소유자 권한이나 계정 연결을 주지 않아요. / A check is needed before opening an anonymous visitor session. It does not grant owner access or connect an account.');
  const note = document.createElement('p'); note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
  note.textContent = uiText('확인을 불러오고 있어요. 최대 2분 기다리거나 취소할 수 있어요. / Loading verification. You can wait up to 2 minutes or cancel.');
  const host = document.createElement('div'); host.className = 'session-verification-widget';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.dataset.action = 'cancel-verification'; cancel.textContent = uiText('취소 · Cancel');
  card.append(heading, why, note, host, cancel);
  const previous = document.activeElement as HTMLElement | null;
  document.body.append(card);
  return new Promise<T>((resolve, reject) => {
    let settled = false, submitted = false, widgetId: string | null = null, sdk: Widget | null = null;
    const abort = new AbortController();
    const removeWidget = () => { const id = widgetId; widgetId = null; if (id !== null) { try { sdk?.remove(id); } catch {} } };
    const finish = (error: string | null, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); abort.abort();
      document.removeEventListener('visibilitychange', hidden);
      card.removeEventListener('toggle', closed);
      cancel.onclick = null;
      removeWidget(); host.remove(); card.remove();
      if (document.visibilityState !== 'hidden' && previous?.isConnected) previous.focus({preventScroll: true});
      if (error) reject(new Error(error)); else resolve(value as T);
    };
    const stop = () => finish(uiText('확인을 취소했어요. 준비되면 원래 동작을 다시 눌러 주세요. / Verification cancelled. Use the original action when ready.'));
    const hidden = () => { if (document.visibilityState === 'hidden') stop(); };
    const closed = (event: Event) => { if ((event as ToggleEvent).newState === 'closed') stop(); };
    const live = () => !settled && document.visibilityState !== 'hidden' && card.isConnected && card.matches(':popover-open');
    const timer = setTimeout(() => finish(uiText('확인 시간이 끝났어요. 원래 동작을 눌러 다시 시도할 수 있어요. / Verification timed out. Use the original action to try again.')), WAIT_MS);
    document.addEventListener('visibilitychange', hidden);
    card.addEventListener('toggle', closed);
    cancel.onclick = stop;
    try { card.showPopover(); cancel.focus({preventScroll: true}); }
    catch { finish(uiText('확인 창을 열지 못했어요. / Could not open verification.')); return; }
    void load(abort.signal).then(() => {
      if (!live()) { stop(); return; }
      sdk = (window as unknown as {turnstile: Widget}).turnstile;
      note.textContent = uiText('필요한 확인이 보이면 직접 진행해 주세요. 최대 2분 뒤에는 종료돼요. / Complete the check if prompted. This closes after 2 minutes.');
      widgetId = sdk.render(host, {
        sitekey, appearance: 'interaction-only',
        callback(token) {
          if (!live() || submitted) { if (!live()) stop(); return; }
          submitted = true;
          // Recheck after the callback turn: close/hidden can arrive before POST.
          void Promise.resolve().then(async () => {
            if (!live()) { stop(); return; }
            const value = await post(token, abort.signal);
            if (!live()) { stop(); return; }
            finish(null, value);
          }).catch(() => finish(uiText('세션을 확인하지 못했어요. 원래 동작으로 다시 시도할 수 있어요. / Could not confirm the session. Use the original action to try again.')));
        },
        'error-callback': () => finish(uiText('방문자 확인을 불러오지 못했어요. / Visitor verification failed.')),
        'expired-callback': () => finish(uiText('방문자 확인이 만료됐어요. 원래 동작으로 다시 시도해 주세요. / Verification expired. Use the original action to try again.')),
        'timeout-callback': () => finish(uiText('방문자 확인 시간이 끝났어요. / Visitor verification timed out.')),
      });
      // render may synchronously invoke a terminal callback before returning its id.
      if (settled) removeWidget();
    }).catch(() => finish(uiText('방문자 확인을 불러오지 못했어요. 원래 동작으로 다시 시도할 수 있어요. / Could not load verification. Use the original action to try again.')));
  });
}
