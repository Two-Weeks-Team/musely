// Live world surface (direction v2, task 6): shows what the shared world is really doing and lets anyone
// open the evidence behind it. Everything is built with textContent; nothing from the server is parsed as HTML.
//  - Header: "Live world" button and the spotlight chip (who holds the turn, which freedom, live/replay)
//  - Map: the ten Muses at their real places, moving along trips in real time
//  - Panel tabs: Feed (source badges) · Highlights · P1 before/after · Autonomy (2.2) · Identity (claim, P0,
//    impostor/injection checks) · Location (virtual location, 13.1)
//  - Evidence view (P2): request id, model, envelope, verification steps, raw JSON
import {Marker, type Map as LibreMap} from 'maplibre-gl';
import {HARNESSES, harnessById} from '../engine/harness';
import {PLACES, PLACE_BY_ID} from '../engine/places';
import {itemName} from '../engine/items';
import {MUSE_VARIANTS} from '../character-kit/catalog';
import {createWorld, tick, TICK_MS, localClock} from '../engine/world';
import {makeHooks} from '../engine/rules';
import {ensureSession, sparkStatus} from '../live';
import {ritualCard} from './ritual';
import {renderFlows, flowState, selectFlow} from './preview-flows';
import {fetchJson, newHealth, track, resState, stateText, loadLog, BLOCKED, type Health} from './resource-state';
import {isolation, enforceIsolation} from './isolation';
import {mountReplay, replayPlayer, type ReplayEvent} from './replay';
import {computeAutonomy} from './autonomy';
import {EMPTY_FILTER, matchFilter, type Filter} from './replay-core';

type Ev = {seq: number; id: string; tick: number; at: number; source: 'live' | 'rule' | 'scripted' | 'replay'; kind: string; muse: string | null; other?: string | null; place?: string | null; line?: string | null; data: any; tags: string[]};
type MuseView = {id: string; place: string; travel: {to: string; departAt: number; arriveAt: number; speed: string} | null; beat: {id: string; line: string | null} | null; inventory: string[]; reflection: string; wants?: {goal: string; items: string[]; source: string}};
type WorldView = {worldId: string; day: string; tick: number; lastTickAt: number; nextSpotlight: {muse: string; freedom: string}; muses: MuseView[]};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const museName = (id: string | null | undefined) => (id ? (id === '00-jolly' ? "Jolly · Kim Sejun's Muse" : harnessById(id).name) : 'World');
const shortName = (id: string | null | undefined) => (id ? harnessById(id).name : 'World');
const placeName = (id: string | null | undefined) => (id ? PLACE_BY_ID.get(id)?.name ?? id : '');
const color = (id: string) => MUSE_VARIANTS.find(v => v.id === id)?.body ?? '#E8DDC7';
// Every time on screen is the viewer's own time (their device's time zone). The world itself keeps Menlo Park time for its day and its
// beats; only what is shown is converted.
// The formatters are made per call: a formatter keeps the zone it was built in, and a device can change zone during a session.
const at = (ms: number) => new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(ms));
const viewerDay = (ms: number) => new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(new Date(ms));
const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';

export function sourceLabel(e: Pick<Ev, 'source' | 'data'>): {text: string; cls: string} {
  if (e.source === 'live' && e.data?.actor === 'your Muse') return {text: 'LIVE · your Muse', cls: 'src-live'};
  if (e.source === 'live' && e.data?.evidence?.requestId) return {text: 'LIVE · Muse Spark', cls: 'src-live'};
  if (e.source === 'live') return {text: 'LIVE · verified', cls: 'src-live'};
  if (e.source === 'replay') return {text: 'REPLAY', cls: 'src-replay'};
  if (e.source === 'rule') return {text: 'RULE', cls: 'src-rule'};
  return {text: 'SCRIPTED', cls: 'src-scripted'};
}

export function describe(e: Ev): string {
  const a = shortName(e.muse), b = shortName(e.other);
  const d = e.data ?? {};
  switch (e.kind) {
    case 'spotlight': return d.live === false ? `${a} holds the spotlight (${d.freedom}); the scenario decides` : `${a} decides (${d.freedom}): ${d.decision ?? ''}${d.target ? ' → ' + placeName(d.target) : ''}`;
    case 'spotlight_fallback': return `${a}'s turn fell back (${d.reason})`;
    case 'decision_rejected': return `${a}'s decision was refused: ${d.reason}`;
    case 'decision_discarded': return `${a}'s late answer was discarded: ${d.reason}`;
    case 'depart': return `${a} heads to ${placeName(d.to)} (${d.speed}, ${Math.round((d.distanceM ?? 0))} m)`;
    case 'arrive': return `${a} arrives at ${placeName(e.place)}${d.speed === 'taxi' ? ' by teleport' : ''}`;
    case 'beat': return `${a} at ${placeName(e.place)}: ${(d.beat ?? '').replace(/_/g, ' ')}`;
    case 'encounter': return `${a} meets ${b} at ${placeName(e.place)}`;
    case 'cards_verified': return `${a} and ${b} verified each other's Agent Card`;
    case 'greet': return `${a} greets ${b}`;
    case 'discover': return `${a} found ${itemName(d.item)} at ${placeName(e.place)}`;
    case 'craft': return `${a} crafted ${itemName(d.item)}`;
    case 'trade_proposed': return `${a} offers ${itemName(d.give)} for ${b}'s ${itemName(d.want)}`;
    case 'trade_completed': return `${a} ↔ ${b}: ${itemName(d.give)} for ${itemName(d.want)}`;
    case 'trade_rejected': return `${a} declined (no reason shared)`;
    case 'gathering': return `${d.count} Muses gathered at the campfire`;
    case 'a2a_verified': return `${a}'s signed request passed every check`;
    case 'a2a_refused': return `${a}'s request was refused at ${d.step}: ${String(d.reason).replace(/_/g, ' ')}`;
    case 'delegation_revoked': return `Owner revoked ${a}'s delegation`;
    case 'delegation_issued': return `Owner delegated ${a} again`;
    case 'impostor_rejected': return `A look-alike ${a} was refused before greeting`;
    case 'injection_blocked': return `An instruction from ${b} to ${a} was blocked`;
    case 'welcome_gift': return `${a} received a welcome gift`;
    case 'new_day': return `A new day begins (${d.day})`;
    case 'ritual_judged': return `Welcome ritual ${d.passed ? 'passed' : 'not passed'} (${d.who})`;
    default: return e.line ?? e.kind.replace(/_/g, ' ');
  }
}

/** Request health per resource (P-06): the connection line and each tab read it, so a failed request is shown as stale or
 *  error instead of looking like an empty or default answer. */
const health = new Map<string, Health>();
async function load<T>(key: string, path: string) {
  const r = await fetchJson<T>(path);
  let h = health.get(key); if (!h) { h = newHealth(); health.set(key, h); }
  track(h, r);
  return r;
}

/** One world day of the append-only run log, paged (2,000 per call), cached for a minute. A page that fails ends the load:
 *  the rows read so far stay as a partial sample and the reason is returned, never silently turned into zeros. */
type DayLog = {events: Ev[]; error: string | null; stale: boolean; at: number};
const dayCache = new Map<string, {at: number; events: Ev[]}>();
async function dayEvents(day: string): Promise<DayLog> {
  const hit = dayCache.get(day);
  if (hit && Date.now() - hit.at < 60_000) return {events: hit.events, error: null, stale: false, at: hit.at};
  const got = await loadLog<Ev>(since => load<Ev[]>('log', `/api/world/events?day=${day}&since=${since}&limit=2000`));
  // Reaching the page limit with a full last page means there may be more log: a partial sample, never a complete one.
  const error = got.error ?? (got.capped ? 'the 80,000-event read limit was reached' : null), out = got.rows;
  if (!error) { const at = Date.now(); dayCache.set(day, {at, events: out}); return {events: out, error: null, stale: false, at}; }
  if (!out.length && hit) return {events: hit.events, error, stale: true, at: hit.at};
  return {events: out, error, stale: false, at: Date.now()};
}

// Autonomy (direction 2.2): the six numbers come from autonomy.ts (contract C09), over the live log or the replay fixture.

// ---------- P1 (direction 2.1): before/after an ability item ----------
const ABILITY_ITEMS = ['transit_pass', 'taxi_token', 'garden_pass', 'invite_token', 'night_pass', 'event_pass'];
export function liveP1(evs: Ev[], windowMs = 2 * 3_600_000) {
  const gains: {muse: string; item: string; at: number; via: string}[] = [];
  for (const e of evs) {
    const items = e.kind === 'trade_completed' ? [[e.muse, e.data.want], [e.other, e.data.give]] : e.kind === 'discover' || e.kind === 'craft' ? [[e.muse, e.data.item]] : [];
    for (const [m, it] of items) if (m && ABILITY_ITEMS.includes(it) && !gains.some(g => g.muse === m && g.item === it)) gains.push({muse: m, item: it, at: e.at, via: e.kind});
  }
  return gains.map(g => {
    const mine = (from: number, to: number) => evs.filter(e => e.muse === g.muse && e.at >= from && e.at < to);
    const stats = (list: Ev[]) => {
      const trips = list.filter(e => e.kind === 'depart');
      return {trips: trips.length, farthestM: Math.max(0, ...trips.map(t => t.data.distanceM ?? 0)), bus: trips.filter(t => t.data.speed === 'bus').length, taxi: trips.filter(t => t.data.speed === 'taxi').length, trades: list.filter(e => e.kind === 'trade_completed' || e.kind === 'trade_proposed').length, places: new Set(list.filter(e => e.kind === 'arrive').map(e => e.place)).size};
    };
    return {...g, before: stats(mine(g.at - windowMs, g.at)), after: stats(mine(g.at, g.at + windowMs))};
  });
}

/** The same start and seed, run twice in the browser with the real engine: once without and once with the item. */
export function engineP1(day: string, muse = '03-ripple', item = 'transit_pass', ticks = 360) {
  const start = Date.parse(day + 'T16:00:00Z');
  const run = (give: boolean) => {
    const hooks = makeHooks();
    let s = createWorld('p1-' + day, start);
    if (give) s.muses.find(m => m.id === muse)!.inventory.push(item);
    const log: any[] = [];
    for (let i = 0; i < ticks; i++) { const r = tick(s, {now: start + i * TICK_MS}, hooks); s = r.state; log.push(...r.events); }
    const trips = log.filter(e => e.kind === 'depart' && e.muse === muse);
    return {trips: trips.length, bus: trips.filter(t => t.data.speed === 'bus').length, farthestM: Math.max(0, ...trips.map(t => t.data.distanceM)), firstDestinations: trips.slice(0, 4).map(t => placeName(t.data.to))};
  };
  return {muse, item, ticks, without: run(false), with: run(true)};
}

// ---------- Map markers ----------
function museMarkers(map: LibreMap) {
  const markers = new Map<string, {m: Marker; label: HTMLElement}>();
  for (const h of HARNESSES) {
    const node = el('div', 'muse-pin');
    node.style.setProperty('--muse', color(h.id));
    const dot = el('span', 'muse-pin-dot'); const label = el('span', 'muse-pin-label', h.name);
    node.append(dot, label);
    node.title = museName(h.id);
    markers.set(h.id, {m: new Marker({element: node, anchor: 'center'}).setLngLat(PLACES[0] ? [PLACES[0].lng, PLACES[0].lat] : [0, 0]), label});
  }
  let added = false;
  return {
    update(w: WorldView | null) {
      if (!w) return;
      if (!added) { for (const {m} of markers.values()) m.addTo(map); added = true; }
      const now = Date.now(), zoom = map.getZoom();
      for (const v of w.muses) {
        const k = markers.get(v.id); if (!k) continue;
        const from = PLACE_BY_ID.get(v.place), to = v.travel ? PLACE_BY_ID.get(v.travel.to) : null;
        if (!from) continue;
        let lng = from.lng, lat = from.lat;
        if (v.travel && to) { const f = Math.min(1, Math.max(0, (now - v.travel.departAt) / Math.max(1, v.travel.arriveAt - v.travel.departAt))); lng = from.lng + (to.lng - from.lng) * f; lat = from.lat + (to.lat - from.lat) * f; }
        k.m.setLngLat([lng, lat]);
        // In the 3D commons the authored story plays; markers would cover it, so they show only farther out.
        k.m.getElement().style.display = zoom > 18.6 ? 'none' : '';
        k.label.textContent = harnessById(v.id).name + (v.travel ? ` → ${placeName(v.travel.to)}` : '');
      }
    },
  };
}

// ---------- Panel ----------
type EvidenceEv = Ev & {fixture?: boolean};
/** What to say about the model call behind an event that carries no request id: not applicable, or evidence that is missing. */
function modelNote(e: EvidenceEv): string {
  if (e.kind === 'spotlight' && (e.source === 'live' || e.source === 'replay')) return e.source === 'replay' ? 'Missing evidence — this replayed answer has no original request id recorded' : 'Missing evidence — no request id was recorded for this model answer';
  if (e.source === 'scripted') return 'Not applicable — scripted, no model call';
  if (e.source === 'rule') return 'Not applicable — rule, no model call';
  return 'Not applicable — verification only, no model call';
}
const PARTS: [Filter['part'], string][] = [['', 'Any time'], ['night', 'Night 0–6'], ['morning', 'Morning 6–12'], ['afternoon', 'Afternoon 12–18'], ['evening', 'Evening 18–24']];

export function mountWorldPanel(map: LibreMap) {
  enforceIsolation();
  const header = document.querySelector('header')!;
  const open = el('button', 'quiet world-open'); open.type = 'button'; open.id = 'world-open';
  const openDot = el('span', 'live-pulse'); open.append(openDot, el('span', '', 'Live world'));
  const spot = el('span', 'spot-chip'); spot.id = 'spot-chip'; spot.textContent = 'Spotlight · …';
  header.insertBefore(spot, header.querySelector('#about'));
  header.insertBefore(open, header.querySelector('#about'));

  const note = el('div', 'commons-note', 'Commons scene: scripted 3:30 story · the live world runs on the map and in Live world');
  note.id = 'commons-note';
  document.body.append(note);

  const panel = el('section', 'world-panel'); panel.id = 'world-panel'; panel.setAttribute('popover', 'manual'); panel.setAttribute('aria-label', 'Live world');
  const close = el('button', 'close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close live world'); close.onclick = () => panel.hidePopover();
  const title = el('h2', '', 'Live world'); const sub = el('p', 'world-sub', 'One shared world for every visitor. Each event shows where it came from; the Connection line shows whether the world answers right now.');
  const legend = el('div', 'legend');
  for (const [t, c] of [['LIVE · Muse Spark', 'src-live'], ['LIVE · verified', 'src-live'], ['RULE', 'src-rule'], ['SCRIPTED', 'src-scripted'], ['REPLAY', 'src-replay'], ['PLANNED', 'src-planned']]) legend.append(el('span', 'src ' + c, t));
  // Connection line (P-06): the badges are where an event came from (its history); this is whether the world answers now.
  const conn = el('div', 'conn'); conn.id = 'conn';
  const connState = el('span', 'conn-state'); connState.setAttribute('role', 'status');
  const connTime = el('span', 'conn-time');
  const connRetry = el('button', 'secondary conn-retry', 'Retry'); connRetry.type = 'button'; connRetry.hidden = true; connRetry.onclick = () => void refresh();
  conn.append(el('span', 'conn-label', 'Connection'), connState, connTime, connRetry);
  const tabs = el('nav', 'world-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Live world sections'); const body = el('div', 'world-body');
  panel.append(close, el('span', 'eyebrow', 'MUSELY · SHARED WORLD'), title, sub, legend, conn, tabs, body);
  document.body.append(panel);

  const evidence = el('section', 'evidence'); evidence.id = 'evidence'; evidence.setAttribute('popover', 'auto'); evidence.setAttribute('role', 'dialog'); evidence.setAttribute('aria-labelledby', 'evidence-title');
  document.body.append(evidence);

  let world: WorldView | null = null, events: Ev[] = [], tab = 'feed', hf: Filter = {...EMPTY_FILTER};
  let lastHighlights: {at: number; events: Ev[]} | null = null;
  const pins = museMarkers(map);

  const stateCard = (heading: string, detail: string, retry: () => void) => {
    const c = el('div', 'state-card'); c.setAttribute('role', 'status'); c.append(el('strong', '', heading), el('p', 'muted', detail));
    const b = el('button', 'secondary', 'Retry'); b.type = 'button'; b.onclick = retry; c.append(b); return c;
  };
  const staleNote = (text: string, retry: () => void) => {
    const c = el('div', 'state-note'); c.setAttribute('role', 'status'); c.append(el('span', '', text));
    const b = el('button', 'secondary', 'Retry'); b.type = 'button'; b.onclick = retry; c.append(b); return c;
  };

  let connKey = '';
  function paintConn() {
    const h = health.get('world'), s = resState(h, !!world);
    // While the fixture replay is open nothing is requested, so the line says that instead of implying a live check.
    const text = isolation.replay ? 'Replay is open · no requests are made to the world while it plays' : stateText(s, h, at);
    if (text !== connKey) { connKey = text; connState.textContent = text; } // the live region changes only when the state changes
    connTime.textContent = h?.lastOkAt && !isolation.replay ? `updated ${at(h.lastOkAt)}` : '';
    conn.dataset.state = isolation.replay ? 'replay' : s;
    connRetry.hidden = isolation.replay || !(s === 'stale' || s === 'error');
  }

  // Evidence opens over the panel and closes back to where the visitor was: same tab, filters, scroll, and the triggering row.
  type Ret = {tab: string; scrollTop: number; triggerId: string; resume: boolean};
  let ret: Ret | null = null;
  function showEvidence(e: EvidenceEv) {
    evidence.replaceChildren();
    const c = el('button', 'close', '×'); c.type = 'button'; c.setAttribute('aria-label', 'Close evidence'); c.onclick = () => evidence.hidePopover();
    const s = sourceLabel(e);
    const h3 = el('h3', '', describe(e)); h3.id = 'evidence-title'; h3.tabIndex = -1;
    evidence.append(c, el('span', 'eyebrow', 'EVIDENCE'), h3, el('span', 'src ' + s.cls, s.text));
    const dl = el('dl', 'facts');
    const fact = (k: string, v: unknown) => { if (v === undefined || v === null || v === '') return; dl.append(el('dt', '', k), el('dd', '', typeof v === 'string' ? v : JSON.stringify(v))); };
    if (e.fixture) fact('Record', 'Preview fixture (SCRIPTED) — not a live record');
    fact(`When (your time · ${viewerZone()})`, `${viewerDay(e.at)}, ${at(e.at)}` + ` · tick ${e.tick} · event ${e.id}`);
    fact('Muse', museName(e.muse)); fact('Other', e.other ? museName(e.other) : null); fact('Place', placeName(e.place));
    const ev = e.data?.evidence;
    const orig = typeof ev?.replayOf === 'string' ? ev.replayOf : ev?.replayOf?.requestId, rec = typeof ev?.replayOf === 'object' ? ev.replayOf : null;
    if (ev) { fact('Model', ev.model ?? rec?.model); fact('Request id', ev.requestId); fact('Response id', ev.responseId); fact('Latency', ev.latencyMs ? ev.latencyMs + ' ms' : null); fact('Reservation', ev.reservationId); if (orig) fact('Replayed from', `request ${orig}${rec?.responseId ? ' · response ' + rec.responseId : ''}${rec?.recordedAt ? ' · recorded ' + new Date(rec.recordedAt).toISOString() : ''}`); }
    if (!ev?.requestId && !orig) fact('Model call', modelNote(e)); // never invent an id: either it does not apply or the evidence is missing
    const env = e.data?.envelope;
    if (env) { fact('Message id', env.message_id); fact('Signer', env.signer_kind); fact('Delegation ref', env.delegation_ref); fact('Scope', env.scope + ' · ' + env.scope_hash); fact('Content hash', env.content_hash); fact('Owner claimed', String(env.owner_claimed)); }
    if (e.data?.steps) fact('Verified steps', (e.data.steps as string[]).join(' → '));
    if (e.kind === 'a2a_refused') fact('Refused at', `${e.data.step}: ${e.data.reason}`);
    if (e.data?.aVerifiesB) fact('Card checks', `${shortName(e.muse)} → ${shortName(e.other)}: ${e.data.aVerifiesB.ok ? 'ok' : e.data.aVerifiesB.reason} · reverse: ${e.data.bVerifiesA.ok ? 'ok' : e.data.bVerifiesA.reason}`);
    if (e.data?.verdict) fact('Verdict', e.data.verdict.ok ? 'ok' : e.data.verdict.reason);
    if (e.data?.kinds) fact('Detected', (e.data.kinds as string[]).join(', ') + ' · ' + (e.data.limit ?? ''));
    if (e.data?.reason && !e.data?.step) fact('Reason', e.data.reason);
    if (e.data?.trigger) fact('Trigger', e.data.trigger === 'demo_button' ? 'demo button (real check)' : e.data.trigger);
    evidence.append(dl);
    const links = el('p', 'evidence-links');
    // A fixture event is not a real Muse call: no signed-card link, so the replay never leaves for the API.
    if (!e.fixture) for (const m of [e.muse, e.other]) if (m) { const a = el('a', '', `${shortName(m)}'s signed Agent Card ↗`); a.href = `/api/agents/${m}/card`; a.target = '_blank'; a.rel = 'noopener'; links.append(a); }
    if (links.childNodes.length) evidence.append(links);
    const raw = el('details'); raw.append(el('summary', '', 'Raw event (JSON)'), el('pre', '', JSON.stringify(e, null, 2)));
    evidence.append(raw);
    evidence.showPopover();
    h3.focus({preventScroll: true});
  }
  function openEvidence(e: EvidenceEv, trigger?: HTMLElement) {
    if (!ret) ret = {tab, scrollTop: panel.scrollTop, triggerId: trigger?.dataset.eventId ?? e.id, resume: replayPlayer.getState().playing};
    replayPlayer.pause();
    showEvidence(e);
  }
  async function returnFromEvidence() {
    const r = ret; ret = null; if (!r) return;
    if (tab !== r.tab) { tab = r.tab; await render(); }
    panel.scrollTop = r.scrollTop;
    const back = [...body.querySelectorAll<HTMLElement>('[data-event-id]')].find(b => b.dataset.eventId === r.triggerId);
    (back ?? tabs.querySelector<HTMLElement>('.tab.active'))?.focus({preventScroll: true});
    if (r.resume && tab === 'replay') replayPlayer.play();
  }
  evidence.addEventListener('toggle', ev => { if ((ev as ToggleEvent).newState === 'closed') void returnFromEvidence(); });

  // A list that crosses the viewer's midnight gets a day heading per group, so 00:12 above 23:58 reads as the next day, not as a jump back.
  function addRows(ul: HTMLElement, evs: Ev[]) {
    const days = evs.map(e => viewerDay(e.at)), several = new Set(days).size > 1;
    let shown = '';
    evs.forEach((e, i) => { if (several && days[i] !== shown) { ul.append(el('li', 'ev-day', days[i])); shown = days[i]; } ul.append(row(e)); });
  }
  function row(e: Ev) {
    const li = el('li', 'ev'); const s = sourceLabel(e);
    const b = el('button', 'ev-btn'); b.type = 'button'; b.dataset.eventId = e.id; b.onclick = () => openEvidence(e, b);
    b.append(el('span', 'ev-time', at(e.at)), el('span', 'src ' + s.cls, s.text), el('span', 'ev-text', describe(e)));
    for (const t of e.tags) b.append(el('span', 'tag', t.replace(/_/g, ' ')));
    li.append(b);
    return li;
  }

  const TABS: [string, string][] = [['feed', 'Feed'], ['highlights', 'Highlights'], ['p1', 'P1 · items change plans'], ['autonomy', 'Autonomy'], ['identity', 'Identity'], ['location', 'Location'], ['replay', 'Replay'], ['flows', 'Preview flows']];
  for (const [id, label] of TABS) { const t = el('button', 'tab', label); t.type = 'button'; t.dataset.tab = id; t.setAttribute('aria-pressed', 'false'); t.onclick = () => { tab = id; void render(); }; tabs.append(t); }

  // Fixture replay (P-06): mounted only on its tab; while it is on screen every background poll to /api waits.
  let replayView: {destroy(): void} | null = null;
  function leaveReplay() { if (replayView) { replayView.destroy(); replayView = null; } if (isolation.replay) { isolation.replay = false; paintConn(); } }
  const replayCtx = {
    showEvidence: (e: ReplayEvent, trigger: HTMLElement) => openEvidence(e as unknown as EvidenceEv, trigger),
    sourceLabel: (e: ReplayEvent) => sourceLabel(e as unknown as Ev), describe: (e: ReplayEvent) => describe(e as unknown as Ev), museName, placeName, at,
  };
  panel.addEventListener('toggle', ev => { if ((ev as ToggleEvent).newState === 'closed') leaveReplay(); });

  /** Highlights: find a moment by tag, Muse, place or time of day; the list and the count update without a new request. */
  function highlightsView(hl: Ev[]): HTMLElement[] {
    const bar = el('div', 'filter'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Find moments');
    const status = el('p', 'muted'); status.setAttribute('role', 'status');
    const ul = el('ul', 'ev-list');
    const chips: HTMLButtonElement[] = [];
    const draw = () => {
      ul.replaceChildren();
      const shown = hl.filter(e => matchFilter(e, hf));
      addRows(ul, shown);
      status.textContent = shown.length ? `${shown.length} moment${shown.length === 1 ? '' : 's'}` : 'No moment matches. Clear the filters.';
      for (const c of chips) c.setAttribute('aria-pressed', String((c.dataset.tag ?? '') === hf.tag));
    };
    const chip = (tag: string, label: string) => { const b = el('button', 'tag', label); b.type = 'button'; b.dataset.tag = tag; b.onclick = () => { hf = {...hf, tag}; draw(); }; chips.push(b); bar.append(b); };
    chip('', 'all');
    for (const t of [...new Set(hl.flatMap(e => e.tags))].sort()) chip(t, t.replace(/_/g, ' '));
    const field = (label: string, options: [string, string][], key: 'muse' | 'place' | 'part') => {
      const wrap = el('label', 'fld'); wrap.append(el('span', '', label));
      const sel = el('select'); for (const [v, t] of options) { const o = el('option', '', t); o.value = v; if (hf[key] === v) o.selected = true; sel.append(o); }
      sel.onchange = () => { hf = {...hf, [key]: sel.value} as Filter; draw(); };
      wrap.append(sel); return wrap;
    };
    const muses = [...new Set(hl.flatMap(e => [e.muse, e.other ?? null]).filter((m): m is string => !!m))].sort();
    const places = [...new Set(hl.map(e => e.place).filter((p): p is string => !!p))].sort();
    const fields = el('div', 'fields');
    fields.append(field('Muse', [['', 'Any Muse'], ...muses.map(m => [m, shortName(m)] as [string, string])], 'muse'), field('Place', [['', 'Any place'], ...places.map(p => [p, placeName(p)] as [string, string])], 'place'), field('Time of day (your time)', PARTS, 'part'));
    const clear = el('button', 'secondary', 'Clear filters'); clear.type = 'button'; clear.onclick = () => { hf = {...EMPTY_FILTER}; void render(); };
    draw();
    return [bar, fields, clear, status, ul];
  }

  let generation = 0;
  async function render() {
    // Each render owns a generation; a slower render for a previous tab never writes into the current one.
    const mine = ++generation, stale = () => mine !== generation;
    const day = world?.day ?? localClock(Date.now()).date; // the world's own (Menlo Park) day
    tabs.querySelectorAll('button').forEach(b => { const on = (b as HTMLElement).dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    if (tab !== 'replay') leaveReplay();
    else if (replayView && body.querySelector('.replay-view')) return; // already on screen: keep playing
    body.replaceChildren();
    if (tab === 'feed') {
      const evH = health.get('events'), s = resState(evH, events.length > 0);
      if (s === 'error') { body.append(stateCard('Feed unavailable', `${evH?.error} · there are no events to show yet.`, () => void refresh())); return; }
      if (s === 'stale') body.append(staleNote(`The feed could not be refreshed (${evH?.error}). Showing events up to ${events.length ? at(events[events.length - 1].at) : '—'}.`, () => void refresh()));
      const ul = el('ul', 'ev-list'); addRows(ul, events.slice(-80).reverse());
      body.append(ul.childNodes.length ? ul : el('p', 'muted', 'Waiting for the next heartbeat…'));
    } else if (tab === 'highlights') {
      const r = await load<Ev[]>('highlights', '/api/world/highlights?limit=200');
      if (stale()) return;
      if (r.ok) lastHighlights = {at: r.at, events: r.data};
      if (!lastHighlights) { body.append(stateCard('Highlights unavailable', `${health.get('highlights')?.error} · there is nothing to show yet.`, () => void render())); return; }
      if (!r.ok) body.append(staleNote(`Highlights could not be refreshed (${r.error}). Showing the list from ${at(lastHighlights.at)}.`, () => void render()));
      body.append(el('p', 'muted', 'Moments tagged by rule: first trade, refusals, impostors, blocked instructions, off-script choices, teleports, relics, gatherings, P0. Open one to see its evidence.'), ...(lastHighlights.events.length ? highlightsView(lastHighlights.events) : [el('p', 'muted', 'No highlights yet. They appear as the world runs.')]));
    } else if (tab === 'p1') {
      const p = el('p', 'muted', 'Does a reward change what a Muse does next? Two views: the same Muse before and after it gained an ability item in the live log, and the real engine run twice in your browser from the same seed and start, once with the item.');
      const d = await dayEvents(day);
      if (stale()) return;
      const logDown = !!d.error && !d.events.length;
      const live = logDown ? [] : liveP1(d.events);
      const t1 = el('table', 'data');
      t1.append(trow(['Muse · item', 'how', 'trips', 'farthest', 'bus/taxi', 'trades', 'places'], 'th'));
      for (const r of live) { t1.append(trow([`${shortName(r.muse)} · ${itemName(r.item)} (before)`, '', r.before.trips, r.before.farthestM + ' m', `${r.before.bus}/${r.before.taxi}`, r.before.trades, r.before.places])); t1.append(trow([`${shortName(r.muse)} · ${itemName(r.item)} (after)`, r.via.replace(/_/g, ' '), r.after.trips, r.after.farthestM + ' m', `${r.after.bus}/${r.after.taxi}`, r.after.trades, r.after.places], 'td', 'after')); }
      const sim = engineP1(day);
      const t2 = el('table', 'data');
      t2.append(trow(['Ripple, same seed and start', 'trips', 'bus rides', 'farthest', 'first destinations'], 'th'));
      t2.append(trow(['without Transit Pass', sim.without.trips, sim.without.bus, sim.without.farthestM + ' m', sim.without.firstDestinations.join(' → ')]));
      t2.append(trow(['with Transit Pass', sim.with.trips, sim.with.bus, sim.with.farthestM + ' m', sim.with.firstDestinations.join(' → ')], 'td', 'after'));
      const liveBlock = logDown ? stateCard('Run log unavailable', `${d.error} · the live comparison cannot be shown, the browser engine below still runs.`, () => void render()) : live.length ? tableWrap(t1) : el('p', 'muted', 'No Muse has gained an ability item in the live log yet. This table fills in as the world runs.');
      body.append(p, el('h4', '', 'Live log (production)'), ...(d.error && !logDown ? [staleNote(`The run log stopped at ${d.error}; this is a partial sample.`, () => void render())] : []), liveBlock, el('h4', '', `Engine, run in this browser (${sim.ticks} minutes, rule source)`), tableWrap(t2));
    } else if (tab === 'autonomy') {
      const d = await dayEvents(day);
      if (stale()) return;
      if (d.error && !d.events.length) { body.append(stateCard('Run log unavailable', `${d.error} · the six numbers are not shown, because a failed request is not a measurement of zero.`, () => void render())); return; }
      if (d.error) body.append(staleNote(d.stale ? `The run log could not be refreshed (${d.error}). Showing the log loaded at ${at(d.at)}.` : `The run log stopped at ${d.error}: partial sample.`, () => void render()));
      const res = computeAutonomy(d.events, {label: 'Live log (production)', day, worldId: world?.worldId ?? null, runId: null, complete: !d.error, partialReason: d.error ? `log stopped at ${d.error}` : null});
      body.append(el('p', 'muted', `${res.period}. We call it autonomy only with this table beside it.`), autonomyTable(res));
    } else if (tab === 'identity') {
      await renderIdentity(stale);
    } else if (tab === 'location') {
      await renderLocation(stale);
    } else if (tab === 'replay') {
      isolation.replay = true; paintConn();
      replayView = mountReplay(body, replayCtx);
    } else if (tab === 'flows') {
      // Scripted state previews (P-03): fixture only, no requests.
      renderFlows(body);
    }
  }
  function trow(cells: (string | number)[], tag: 'td' | 'th' = 'td', cls = '') { const tr = el('tr', cls); for (const c of cells) tr.append(el(tag, '', String(c))); return tr; }
  function tableWrap(t: HTMLElement) { const w = el('div', 'table-wrap'); w.append(t); return w; }
  function autonomyTable(res: ReturnType<typeof computeAutonomy>) {
    const t = el('table', 'data'); t.append(trow(['Measure', 'Value', 'Sample', 'Note'], 'th'));
    for (const r of res.rows) {
      const tr = el('tr', r.measured ? '' : 'not-measured'); tr.dataset.row = r.key;
      for (const c of [r.label, r.value, r.sample, r.note ?? '']) tr.append(el('td', '', c));
      t.append(tr);
    }
    return tableWrap(t);
  }

  async function renderIdentity(stale: () => boolean) {
    const r = await load<any>('claim', '/api/claim/owner-muse');
    if (stale()) return;
    const claim = r.ok ? r.data : null;
    const card = el('div', 'id-card');
    const status = claim?.record?.status ?? 'pending_claim';
    card.append(el('span', 'eyebrow', "KIM SEJUN'S MUSE · OWNER CLAIM"), el('h4', '', !r.ok ? 'Claim status unavailable' : status === 'claimed' ? 'Claimed' : status === 'claim_revoked' ? 'Claim revoked' : 'pending_claim'));
    if (!r.ok) card.append(el('p', 'muted', `The claim record could not be read (${r.error}), so its status is unknown. This is not the same as pending_claim.`));
    const dl = el('dl', 'facts');
    const f = (k: string, v: unknown) => { if (v) dl.append(el('dt', '', k), el('dd', '', String(v))); };
    if (r.ok) { f('Threads account', '@' + (claim?.handle ?? 'combba82')); f('Fingerprint', claim?.fingerprint); f('Check', claim?.record?.machineVerified ? 'Machine-verified: the Worker re-read the post and matched the fingerprint' : claim?.record?.path === 'owner_direct' ? 'Visual check only (not machine-verified)' : 'Not verified yet');
      f('Verified at', claim?.record?.verifiedAt ? new Date(claim.record.verifiedAt).toISOString() : null); f('Note', claim?.record?.note); }
    card.append(dl);
    if (claim?.record?.permalink) { const a = el('a', '', 'Open the claim post on Threads ↗'); a.href = claim.record.permalink; a.target = '_blank'; a.rel = 'noopener'; card.append(a); }
    card.append(el('p', 'muted', 'This record proves Kim Sejun\'s Muse only. A new visitor\'s session is not claimed by it. While the Threads app is in development mode, only accounts added as testers can connect: message @combba82 on Threads with your Threads handle to be added. Not a tester? You can still try the owner-direct path: post the claim text from your own Threads account and share the link (a visual check, not machine-verified).'));
    if (!r.ok) { const b = el('button', 'secondary', 'Retry'); b.type = 'button'; b.onclick = () => void render(); card.append(b); }
    const actions = el('div', 'id-actions');
    const result = el('p', 'muted'); result.setAttribute('role', 'status');
    const run = (label: string, path: string) => { const b = el('button', 'secondary', label); b.type = 'button'; b.onclick = async () => {
      b.disabled = true; result.textContent = 'Running a real check…';
      try { const st = await sparkStatus(); if (st) await ensureSession(st); const r = await fetch(path, {method: 'POST'}); const j = await r.json(); result.textContent = r.ok ? 'Done. The result is in the Feed and Highlights.' : `Not allowed: ${j.error ?? r.status}`; await refresh(); }
      catch (err) { result.textContent = 'Could not run: ' + (err as Error).message; }
      b.disabled = false; }; return b; };
    actions.append(run('Try an impostor', '/api/demo/impostor'), run('Try an instruction injection', '/api/demo/injection'), run('Run P0 (judge link)', '/api/p0/run'));
    body.append(card, ritualCard(() => void refresh()), el('h4', '', 'Real checks you can trigger'), el('p', 'muted', 'These run the same verification code as the world. The event records that a button triggered it.'), actions, result);
  }

  async function renderLocation(stale: () => boolean) {
    const r = await load<any>('location', '/api/owner/location');
    if (stale()) return;
    const box = el('div', 'id-card');
    box.append(el('span', 'eyebrow', 'OWNER LOCATION · 13.1'));
    if (!r.ok) { box.append(el('h4', '', 'Location unavailable'), el('p', 'muted', `The owner location could not be read (${r.error}), so it is unknown right now. It is not assumed to be the HQ commons.`)); const b = el('button', 'secondary', 'Retry'); b.type = 'button'; b.onclick = () => void render(); box.append(b); body.append(box); return; }
    const loc = r.data;
    const presetLabel = ((loc.presets ?? []) as {id: string; label: string}[]).find(p => p.id === loc.preset)?.label ?? loc.cell_label ?? loc.preset ?? '';
    box.append(el('h4', '', `${loc.source === 'gps' ? 'GPS (phase 2)' : 'Virtual location (demo)'} · ${presetLabel}`));
    const dl = el('dl', 'facts');
    const f = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') dl.append(el('dt', '', k), el('dd', '', String(v))); };
    const m = loc.muse ?? {};
    f('Owner cell', `${loc.cell_label ?? ''} (${loc.cell ?? '?'})${loc.neighborhood_verified ? ' · neighborhood verified' : ''}`);
    f("Muse's current place", m.place?.name ?? m.place?.id);
    f('Muse is', m.travelling_to ? `walking to ${m.travelling_to.name ?? m.travelling_to.id} (${m.speed ?? 'walk'}), about ${Math.max(1, Math.round((m.eta_ms ?? 0) / 60000))} min` : m.at_owner_cell ? 'with the owner' : 'away from the owner cell');
    box.append(dl, el('p', 'muted', 'The owner cell is where the Muse walks to and what neighborhood verification checks. Discovery, trades and the MCP world state use the Muse\'s own current place, which changes only by travelling or a verified teleport. No device GPS spoofing or VPN.'));
    const presets = (loc.presets ?? []) as {id: string; label: string}[];
    if (presets.length) {
      const lab = el('label', 'fld'); lab.append(el('span', '', 'Virtual location preset'));
      const sel = el('select'); sel.setAttribute('aria-label', 'Virtual location preset'); lab.append(sel);
      for (const p of presets) { const o = el('option', '', p.label); o.value = p.id; if (p.id === loc.preset) o.selected = true; sel.append(o); }
      const go = el('button', 'secondary', 'Move owner here (judge link)'); go.type = 'button';
      const msg = el('p', 'muted'); msg.setAttribute('role', 'status');
      go.onclick = async () => {
        const res = await fetchJson('/api/owner/location', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({source: 'virtual', preset: sel.value})});
        msg.textContent = res.ok ? 'Moved. Watch the Muse walk on the map.' : /HTTP 40[13]/.test(res.error) ? 'Only the judge link can move the owner in this preview.' : `Could not move the owner (${res.error}). Nothing changed.`;
        await refresh();
      };
      box.append(lab, go, msg);
    }
    const see = el('button', 'secondary', 'See the preview location states (scripted)'); see.type = 'button'; see.onclick = () => { selectFlow('location-walk'); tab = 'flows'; void render(); };
    box.append(see);
    body.append(box);
  }

  let lastSeq = 0;
  async function refresh() {
    // Replay makes no requests: nothing refreshes while it is on screen, whoever asked (a poll, a Retry, or a button chain that
    // began before it opened). The next refresh after the replay asks again.
    if (isolation.replay) return;
    // First load takes the newest events (the live tail); later polls fetch only what is new since then.
    const [wr, er] = await Promise.all([load<WorldView>('world', '/api/world'), load<Ev[]>('events', lastSeq ? `/api/world/events?since=${lastSeq}&limit=500` : '/api/world/events?tail=200')]);
    if (isolation.replay || (!wr.ok && wr.error === BLOCKED) || (!er.ok && er.error === BLOCKED)) return; // asked before the replay opened: not applied; the next refresh fetches it again
    if (wr.ok) world = wr.data;
    if (er.ok && er.data.length) { events.push(...er.data); events = events.slice(-1500); lastSeq = er.data[er.data.length - 1].seq; }
    pins.update(world);
    const last = [...events].reverse().find(e => e.kind === 'spotlight' || e.kind === 'spotlight_fallback');
    if (world) {
      const live = last && last.source === 'live', stalled = !wr.ok;
      spot.textContent = `Spotlight · ${shortName(world.nextSpotlight.muse)} next · ${world.nextSpotlight.freedom}${last ? ' · last: ' + (live ? 'LIVE' : last.source.toUpperCase()) : ''}${stalled ? ' · not updating' : ''}`;
      spot.dataset.state = stalled ? 'stale' : live ? 'live' : 'other';
      spot.title = stalled ? `The world did not answer (${wr.error}); this is the last data we received.` : last ? describe(last) : '';
      document.body.dataset.worldReady = '1';
    } else spot.textContent = 'Spotlight · world offline';
    paintConn();
    if (panel.matches(':popover-open') && tab === 'feed' && !ret) { const st = panel.scrollTop; await render(); panel.scrollTop = st; }
  }
  open.onclick = () => { if (panel.matches(':popover-open')) panel.hidePopover(); else { panel.showPopover(); void render(); } };
  paintConn();
  void refresh();
  setInterval(refresh, 10_000);
  setInterval(() => pins.update(world), 1000);
  return {refresh, get events() { return events; }, get world() { return world; }, showEvidence: openEvidence, flows: flowState, replay: replayPlayer, health, openTab(id: string) { tab = id; if (!panel.matches(':popover-open')) panel.showPopover(); void render(); }};
}
