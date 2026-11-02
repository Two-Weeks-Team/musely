import data from '../../fixtures/replay-run.json';
import {computeAutonomy} from './autonomy.ts';
import {createPlayer, EMPTY_FILTER, formatT, matchFilter, SPEEDS, visibleEvents} from './replay-core.ts';
import type {Filter, ReplayEvent, ReplayRun, Speed} from './replay-core.ts';
export type {ReplayEvent, ReplayRun} from './replay-core.ts';

export type ReplayCtx = {
  showEvidence: (e: ReplayEvent, trigger: HTMLElement) => void;
  sourceLabel: (e: ReplayEvent) => {text: string; cls: string};
  describe: (e: ReplayEvent) => string;
  museName: (id: string | null | undefined) => string;
  placeName: (id: string | null | undefined) => string;
  at: (ms: number) => string;
};
export const RUN: ReplayRun = data as ReplayRun;
// Notifications let the evidence owner pause/resume this single clock without owning our timer.
type Action = 'play' | 'pause' | 'speed' | 'seek' | 'restart';
const listeners = new Set<(action: Action) => void>();
const core = createPlayer(RUN.durationSec);
const notify = (action: Action) => { for (const listener of listeners) listener(action); };
export const replayPlayer: ReturnType<typeof createPlayer> = {
  ...core,
  play() { core.play(); notify('play'); },
  pause() { core.pause(); notify('pause'); },
  setSpeed(s: Speed) { core.setSpeed(s); notify('speed'); },
  seek(t: number) { core.seek(t); notify('seek'); },
  restart() { core.restart(); notify('restart'); },
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text: string, cls = 'secondary') => { const node = el('button', cls, text); node.type = 'button'; return node; };

export function mountReplay(body: HTMLElement, ctx: ReplayCtx): {destroy(): void} {
  const root = el('section', 'replay-view');
  const badges = el('div', 'legend');
  badges.append(el('span', 'src src-scripted', RUN.label), el('span', 'src src-planned', 'PLANNED · real run player (I-11)'));
  root.append(badges, el('p', 'muted', RUN.note));

  const controls = el('div', 'replay-controls'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Replay controls');
  const toggle = button('Play'), restart = button('Restart');
  const speedButtons = new Map<Speed, HTMLButtonElement>();
  controls.append(toggle, restart);
  for (const speed of SPEEDS) {
    const b = button(`${speed}×`); b.onclick = () => replayPlayer.setSpeed(speed); speedButtons.set(speed, b); controls.append(b);
  }
  const range = el('input', 'replay-position'); range.type = 'range'; range.min = '0'; range.max = String(RUN.durationSec); range.step = '0.1'; range.setAttribute('aria-label', 'Replay position');
  const time = el('p', 'replay-time');
  controls.append(range, time);
  const status = el('p', 'muted replay-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(controls, status);

  let filter: Filter = {...EMPTY_FILTER};
  const filters = el('div', 'replay-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Find moments');
  const tags = el('div', 'filter');
  const tagButtons = new Map<string, HTMLButtonElement>();
  const chooseTag = (tag: string) => { filter.tag = tag; drawMoments(); };
  for (const tag of ['', ...new Set(RUN.events.flatMap(e => e.tags))]) {
    const b = button(tag ? tag.replace(/_/g, ' ') : 'all', 'tag'); b.onclick = () => chooseTag(tag); tagButtons.set(tag, b); tags.append(b);
  }
  filters.append(tags);
  const select = (title: string, choices: [string, string][], choose: (value: string) => void) => {
    const label = el('label', 'replay-select', title);
    const node = el('select');
    for (const [value, text] of [['', `All ${title.toLowerCase()}`], ...choices]) { const option = el('option', '', text); option.value = value; node.append(option); }
    node.onchange = () => { choose(node.value); drawMoments(); };
    label.append(node); filters.append(label); return node;
  };
  const muses = [...new Set(RUN.events.flatMap(e => [e.muse, e.other]).filter((id): id is string => !!id))];
  const places = [...new Set(RUN.events.map(e => e.place).filter((id): id is string => !!id))];
  const museSelect = select('Muse', muses.map(id => [id, ctx.museName(id)]), v => { filter.muse = v; });
  const placeSelect = select('Place', places.map(id => [id, ctx.placeName(id)]), v => { filter.place = v; });
  const partSelect = select('Time of day (your time)', [['night', 'Night (00–06)'], ['morning', 'Morning (06–12)'], ['afternoon', 'Afternoon (12–18)'], ['evening', 'Evening (18–24)']], v => { filter.part = v as Filter['part']; });
  const count = el('p', 'muted'); count.setAttribute('role', 'status');
  const empty = el('div'); empty.append(el('p', 'muted', 'No moment matches. Clear the filters.'));
  const clear = button('Clear filters'); clear.onclick = () => {
    filter = {...EMPTY_FILTER}; museSelect.value = ''; placeSelect.value = ''; partSelect.value = ''; drawMoments();
    // Clearing removes the empty-state control; return focus to the persistent filters.
    tagButtons.get('')!.focus({preventScroll: true});
  };
  empty.append(clear);
  const list = el('ul', 'ev-list');
  root.append(filters, count, empty, list, el('h4', '', 'Autonomy · visible fixture sample'));
  const period = el('p', 'muted');
  const wrap = el('div', 'replay-table-wrap'), table = el('table', 'data');
  const caption = el('caption', 'muted', 'Autonomy measurements for the visible scripted fixture events');
  const head = el('thead'), headRow = el('tr');
  for (const text of ['Measure', 'Value', 'Sample', 'Note']) { const th = el('th', '', text); th.scope = 'col'; headRow.append(th); }
  head.append(headRow);
  const tableBody = el('tbody'); table.append(caption, head, tableBody); wrap.append(table);
  root.append(period, wrap); body.append(root);

  const rows = new Map<string, HTMLLIElement>();
  let previousVisible = '', destroyed = false;
  let timer: ReturnType<typeof setInterval> | null = null, lastTime = performance.now();
  function drawMoments() {
    const visible = visibleEvents(RUN.events, replayPlayer.getState().cursor);
    const matches = visible.filter(e => matchFilter(e, filter)).reverse();
    for (const [tag, b] of tagButtons) { b.setAttribute('aria-pressed', String(filter.tag === tag)); b.classList.toggle('on', filter.tag === tag); }
    const focus = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
    const scroller = body.closest<HTMLElement>('.world-panel') ?? body;
    const scroll = scroller.scrollTop;
    const children = matches.map(e => {
      let li = rows.get(e.id);
      if (!li) {
        li = el('li', 'ev'); const b = button('', 'ev-btn'); b.dataset.eventId = e.id;
        const source = ctx.sourceLabel(e);
        b.append(el('span', 'ev-time', ctx.at(e.at)), el('span', 'src ' + source.cls, source.text), el('span', 'ev-text', ctx.describe(e)));
        for (const tag of e.tags) b.append(el('span', 'tag', tag.replace(/_/g, ' ')));
        b.onclick = () => ctx.showEvidence(e, b); li.append(b); rows.set(e.id, li);
      }
      return li;
    });
    list.replaceChildren(...children);
    const resultText = `${matches.length} moments`; if (count.textContent !== resultText) count.textContent = resultText;
    empty.hidden = matches.length !== 0;
    if (focus?.isConnected) focus.focus({preventScroll: true});
    scroller.scrollTop = scroll;
    const signature = visible.map(e => e.id).join(',');
    if (signature !== previousVisible || !tableBody.childNodes.length) {
      previousVisible = signature;
      const summary = computeAutonomy(visible, {label: 'Scripted fixture', day: RUN.day, worldId: RUN.worldId, runId: RUN.runId, complete: true});
      period.textContent = summary.period;
      tableBody.replaceChildren(...summary.rows.map(r => {
        const tr = el('tr'), label = el('th', '', r.label); label.scope = 'row';
        tr.append(label, el('td', r.measured ? '' : 'muted', r.value), el('td', '', r.sample), el('td', '', r.note ?? '—')); return tr;
      }));
    }
  }
  function syncControls() {
    const state = replayPlayer.getState();
    toggle.textContent = state.playing ? 'Pause' : 'Play'; toggle.setAttribute('aria-pressed', String(state.playing));
    for (const [speed, b] of speedButtons) b.setAttribute('aria-pressed', String(state.speed === speed));
    range.value = String(state.cursor); range.setAttribute('aria-valuetext', `${formatT(state.cursor)} of ${formatT(state.durationSec)}`);
    time.textContent = `${formatT(state.cursor)} / ${formatT(state.durationSec)} · ${state.speed}× · ${ctx.at(RUN.startAt + state.cursor * 1000)} your time`;
  }
  function stopTimer() { if (timer !== null) { clearInterval(timer); timer = null; } }
  function syncTimer() {
    if (destroyed || !root.isConnected || !replayPlayer.getState().playing) { stopTimer(); return; }
    if (timer !== null) return;
    lastTime = performance.now();
    timer = setInterval(() => {
      if (!root.isConnected) { stopTimer(); replayPlayer.pause(); return; }
      const now = performance.now(), wasPlaying = replayPlayer.getState().playing;
      replayPlayer.advance(document.hidden ? 0 : now - lastTime); lastTime = now;
      syncControls();
      const signature = visibleEvents(RUN.events, replayPlayer.getState().cursor).map(e => e.id).join(',');
      if (signature !== previousVisible) drawMoments();
      if (wasPlaying && replayPlayer.getState().ended) { status.textContent = 'Reached the end'; stopTimer(); }
    }, 100);
  }
  function onAction(action: Action) {
    if (destroyed) return;
    const state = replayPlayer.getState();
    status.textContent = state.ended ? 'Reached the end' : action === 'restart' ? 'Restarted and paused at 0:00' : action === 'play' || action === 'speed' && state.playing ? `Playing at ${state.speed}×` : `${state.playing ? 'Playing' : 'Paused'} at ${formatT(state.cursor)}${action === 'speed' ? ` · ${state.speed}×` : ''}`;
    syncControls();
    // Pause/speed changes leave the current event buttons in place, including an evidence trigger.
    if (action === 'seek' || action === 'restart' || action === 'play') {
      const signature = visibleEvents(RUN.events, state.cursor).map(e => e.id).join(',');
      if (signature !== previousVisible) drawMoments();
    }
    syncTimer();
  }
  const resetTime = () => { lastTime = performance.now(); };
  toggle.onclick = () => replayPlayer.getState().playing ? replayPlayer.pause() : replayPlayer.play();
  restart.onclick = () => replayPlayer.restart(); range.oninput = () => replayPlayer.seek(Number(range.value));
  listeners.add(onAction); document.addEventListener('visibilitychange', resetTime);
  syncControls(); drawMoments(); syncTimer();
  return {destroy() {
    if (destroyed) return; destroyed = true; stopTimer(); listeners.delete(onAction);
    document.removeEventListener('visibilitychange', resetTime); replayPlayer.pause();
  }};
}
