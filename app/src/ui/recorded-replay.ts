// Actual public RunRecord UI. Fixture mode remains separately labelled and never fetches a record.
import {loadRun, ReplayRecordError, type RecordedFrame, type RecordedEvent, type RecordedPlayer} from '../replay/player.ts';
import {listRecordedRuns, loadRecordedRun} from '../replay/loader.ts';
import {currentVersions} from '../replay/versions.ts';
import {readRecordedApi} from './isolation.ts';
import {SPEEDS, EMPTY_FILTER, formatT, matchFilter, dayBound, type Filter, type ReplayState} from './replay-core.ts';
import {computeAutonomy} from './autonomy.ts';
export type ReplayClock = {getState(): ReplayState; play(): void; pause(): void};
export const recordedReplayState: {active: boolean; clock: ReplayClock | null} = {active: false, clock: null};
type Ctx = {showEvidence(e: RecordedEvent, trigger: HTMLElement): void; describe(e: RecordedEvent): string; museName(id: string | null | undefined): string; placeName(id: string | null | undefined): string; at(ms: number): string; onFrame?(frame: RecordedFrame | null): void; returnLive?(): void};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const button = (text: string) => { const b = el('button', 'secondary', text); b.type = 'button'; return b; };
const read = (path: string, init: {signal?: AbortSignal}) => readRecordedApi(path, init.signal);
export function mountRecordedReplay(host: HTMLElement, ctx: Ctx, onActive: (active: boolean) => void) {
  const root = el('section', 'recorded-replay'), toolbar = el('div', 'replay-controls'), outcome = el('div', 'recorded-output');
  const status = el('p', 'muted', 'Load a committed public run, or keep using the explicitly scripted fixture below.'); status.setAttribute('role', 'status');
  root.dataset.status = 'idle';
  root.append(el('h4', '', 'Recorded world run'), el('p', 'muted', 'Read-only public history. Private conditions and hashed text cannot be restored, and this recording gives you no claim, owner session, agent key or new reward.'));
  const runs = el('select'); runs.setAttribute('aria-label', 'Recorded run'); const current = el('option', '', 'Current run'); current.value = ''; runs.append(current);
  const browse = button('Find recorded runs'), load = button('Load recorded run'), fixture = button('Show scripted fixture'), live = button('Return to live world'), sceneView = button('View recorded scene');
  sceneView.disabled = true; sceneView.dataset.sceneToggle = ''; live.dataset.returnLive = '';
  sceneView.onclick = () => {const panel = root.closest<HTMLElement>('.world-panel'); if (!panel) return; const compact = panel.classList.toggle('recorded-scene-view'); sceneView.textContent = compact ? 'Show recording details' : 'View recorded scene'; sceneView.setAttribute('aria-pressed', String(compact)); panel.scrollTop = 0;};
  toolbar.classList.add('recorded-browser-controls'); toolbar.append(runs, browse, load, fixture, live, sceneView); root.append(toolbar, status, outcome); host.append(root);
  let player: RecordedPlayer | null = null, destroyed = false, generation = 0, abort: AbortController | null = null, timer: ReturnType<typeof setInterval> | null = null, previous = performance.now();
  let sync: () => void = () => {}, frameSignature = '', filter: Filter = {...EMPTY_FILTER}, countLimit = 80;
  const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
  const deactivate = () => { root.closest('.world-panel')?.classList.remove('recorded-scene-view'); sceneView.textContent = 'View recorded scene'; sceneView.disabled = true; sceneView.setAttribute('aria-pressed', 'false'); ++generation; abort?.abort(); abort = null; stop(); player?.pause(); player = null; recordedReplayState.active = false; recordedReplayState.clock = null; ctx.onFrame?.(null); onActive(false); load.disabled = browse.disabled = false; };
  const active = () => !destroyed && root.isConnected && recordedReplayState.active;
  function playbackTimer() {
    stop(); if (!player?.getState().playing || !active()) return;
    previous = performance.now();
    timer = setInterval(() => {
      if (!active() || !player) { stop(); return; }
      const now = performance.now(); player.advance(document.hidden ? 0 : now - previous); previous = now; sync();
      if (!player.getState().playing) stop();
    }, 100);
  }
  browse.onclick = async () => {
    recordedReplayState.clock?.pause();
    const mine = ++generation; abort?.abort(); abort = new AbortController(); browse.disabled = true;
    try {
      const result = await listRecordedRuns(read, abort.signal); if (destroyed || mine !== generation) return;
      const chosen = runs.value; runs.replaceChildren(current);
      for (const r of result.runs) { const o = el('option', '', `${r.runId} · ${new Date(r.startedAt).toLocaleString()} · ${r.schemaVersion}`); o.value = r.runId; runs.append(o); }
      runs.value = chosen; status.textContent = `${result.runs.length} recorded runs. Older incompatible formats are reported explicitly when loaded.`;
    } catch (e) { if (!destroyed && mine === generation) status.textContent = e instanceof Error ? e.message : 'load_failed'; }
    finally { if (mine === generation) browse.disabled = false; }
  };
  load.onclick = async () => {
    deactivate(); const mine = ++generation; abort = new AbortController(); recordedReplayState.active = true; onActive(true);
    load.disabled = browse.disabled = true; outcome.replaceChildren(); root.dataset.status = 'loading'; delete root.dataset.error; status.textContent = 'Loading a frozen prefix of this run…';
    try {
      const record = await loadRecordedRun(read, runs.value || undefined, abort.signal);
      if (destroyed || mine !== generation) return;
      player = loadRun(record); frameSignature = ''; filter = {...EMPTY_FILTER}; countLimit = 80;
      const p = player;
      const controls = el('div', 'replay-controls'), toggle = button('Play recorded run'), restart = button('Restart recorded run'), speedButtons = new Map<number, HTMLButtonElement>();
      const range = el('input', 'recorded-position'); range.type = 'range'; range.min = '0'; range.max = String(p.getState().durationSec); range.step = '0.1'; range.setAttribute('aria-label', 'Recorded replay position');
      controls.append(toggle, restart);
      for (const speed of SPEEDS) { const b = button(`${speed}×`); b.dataset.recordedSpeed = String(speed); b.onclick = () => { p.setSpeed(speed); sync(); }; speedButtons.set(speed, b); controls.append(b); }
      controls.append(range);
      const clock = el('p', 'recorded-time'), metadata = el('p', 'muted', `Run ${record.runId} · ${record.schemaVersion} · ${record.engineVersion} · ${record.catalogVersion} · prefix input #${record.readThrough.inputSeq} / event #${record.readThrough.eventSeq}`);
      const badge = el('span', 'src src-replay', 'REPLAY · RECORDED WORLD');
      const note = el('p', 'muted', 'State comes from recorded public snapshots; no world rule, command or model is re-executed. Text hashes and private markers stay unavailable. Recorded source labels below describe the original event, not a new live call.');
      const scene = el('table', 'data recorded-state'), stateHead = el('tr'); for (const label of ['Muse', 'Recorded place', 'Items', 'Recorded action']) stateHead.append(el('th', '', label));
      const stateBody = el('tbody'); scene.append(stateHead, stateBody);
      const filters = el('div', 'fields'), list = el('ul', 'ev-list'), count = el('p', 'muted'), more = button('Show older recorded moments'), summary = el('table', 'data recorded-autonomy');
      const select = (label: string, values: [string, string][], choose: (value: string) => void) => { const lab = el('label', 'fld', label), s = el('select'); s.setAttribute('aria-label', label); for (const [value, text] of [['', 'All'], ...values]) { const o = el('option', '', text); o.value = value; s.append(o); } s.onchange = () => { choose(s.value); frameSignature = ''; sync(); }; lab.append(s); filters.append(lab); };
      select('Recorded Muse', [...new Set(record.events.flatMap(e => [e.muse, e.other]).filter((x): x is string => !!x))].map(id => [id, ctx.museName(id)]), x => filter.muse = x);
      select('Recorded place', [...new Set(record.events.map(e => e.place).filter((x): x is string => !!x))].map(id => [id, ctx.placeName(id)]), x => filter.place = x);
      select('Recorded tag', [...new Set(record.events.flatMap(e => e.tags))].map(t => [t, t.replace(/_/g, ' ')]), x => filter.tag = x);
      for (const [label, key] of [['From (your date)', 'from'], ['To (your date)', 'to']] as const) { const lab = el('label', 'fld', label), i = el('input'); i.type = 'date'; i.onchange = () => { filter[key] = dayBound(i.value, key === 'to'); frameSignature = ''; sync(); }; lab.append(i); filters.append(lab); }
      const rows = new Map<string, HTMLElement>();
      sync = () => {
        if (!active() || player !== p) return;
        const state = p.getState(), frame = p.getFrame();
        load.disabled = browse.disabled = state.playing;
        toggle.textContent = state.playing ? 'Pause recorded run' : 'Play recorded run'; toggle.setAttribute('aria-pressed', String(state.playing)); range.value = String(state.cursor);
        for (const [speed, b] of speedButtons) b.setAttribute('aria-pressed', String(state.speed === speed));
        clock.textContent = `${formatT(state.cursor)} / ${formatT(state.durationSec)} · ${state.speed}× · playback ${new Date(frame.recordedAt).toLocaleString()} · stored commit ${new Date(frame.snapshotAt).toLocaleString()} your time`;
        status.textContent = frame.empty ? 'Empty run: the initial public snapshot exists; no committed inputs or events were recorded.' : state.ended ? 'Reached the recorded end. No new action or reward was issued.' : frame.playout ? 'Finishing recorded public event animation; the final stored public state is held. No world tick is executed.' : `${state.playing ? 'Playing' : 'Paused'} recorded history.${frame.timeOrderAdjusted ? ' Source timestamps moved backwards; commit order is retained without changing the original timestamps.' : ''}`;
        root.dataset.status = frame.empty ? 'empty' : 'ready'; root.dataset.runId = record.runId; root.dataset.snapshotHash = frame.snapshotHash; root.dataset.recordedAt = String(frame.recordedAt);
        ctx.onFrame?.(frame);
        const signature = frame.snapshotHash + ':' + frame.events.length + ':' + countLimit + ':' + JSON.stringify(filter);
        if (signature === frameSignature) return; frameSignature = signature;
        stateBody.replaceChildren();
        for (const m of frame.publicState.muses) { const tr = el('tr'); tr.dataset.museId = m.id; tr.append(el('td', '', ctx.museName(m.id)), el('td', '', ctx.placeName(m.place)), el('td', '', Array.isArray(m.inventory) ? m.inventory.join(', ') : 'Not recorded'), el('td', '', m.beat?.id ?? (m.travel ? 'travelling' : 'idle'))); stateBody.append(tr); }
        const matches = frame.events.filter(e => matchFilter(e, filter)).reverse(), shown = matches.slice(0, countLimit);
        const nodes = shown.map(e => { let row = rows.get(e.id); if (!row) { row = el('li', 'ev'); const b = button(''); b.className = 'ev-btn'; b.dataset.eventId = e.id; b.append(el('span', 'ev-time', ctx.at(e.at)), el('span', 'src src-replay', `REPLAY · originally ${e.source.toUpperCase()}`), el('span', 'ev-text', ctx.describe(e))); b.onclick = () => ctx.showEvidence(e, b); row.append(b); rows.set(e.id, row); } return row; });
        const focus = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
        list.replaceChildren(...nodes); if (focus?.isConnected) focus.focus({preventScroll: true});
        count.textContent = `${matches.length} recorded moments in the visible time; showing ${shown.length}.`; more.hidden = shown.length >= matches.length;
        const auto = computeAutonomy(frame.events, {label: 'Recorded run (read-only)', day: frame.publicState.day, worldId: record.worldId, runId: record.runId, complete: true});
        summary.replaceChildren(); for (const r of auto.rows) { const tr = el('tr'); tr.append(el('th', '', r.label), el('td', '', r.value)); summary.append(tr); }
      };
      recordedReplayState.clock = {getState: p.getState, play() { p.play(); sync(); playbackTimer(); }, pause() { p.pause(); stop(); sync(); }};
      toggle.onclick = () => p.getState().playing ? recordedReplayState.clock?.pause() : recordedReplayState.clock?.play();
      restart.onclick = () => { p.restart(); stop(); sync(); }; range.oninput = () => { p.seek(Number(range.value)); sync(); if (!p.getState().playing) stop(); };
      more.onclick = () => { countLimit += 80; sync(); };
      outcome.append(badge, metadata, note, controls, clock, scene, filters, count, list, more, el('h4', '', 'Recorded autonomy sample · no live counter increment'), summary);
      sceneView.disabled = false; sync();
    } catch (e) {
      if (destroyed || mine !== generation) return;
      player = null; stop(); ctx.onFrame?.(null); root.dataset.status = 'error'; root.dataset.error = e instanceof ReplayRecordError ? e.code : 'load_failed'; status.textContent = e instanceof Error ? e.message : 'load_failed';
    } finally { if (mine === generation) load.disabled = browse.disabled = false; }
  };
  fixture.onclick = () => { deactivate(); outcome.replaceChildren(); root.dataset.status = 'idle'; status.textContent = 'Scripted fixture selected. It is separate from any recorded world run.'; };
  live.onclick = () => { deactivate(); ctx.returnLive?.(); };
  return {destroy() { if (destroyed) return; destroyed = true; deactivate(); }};
}
