import {uiText,catalogText,inventoryText,activityStatus,activityLabel} from './i18n.ts';
import {observeWorld, type WorldObservation} from './world-observation.ts';
import {presentationIn, resolveMuse, withSnapshotProfiles} from './personal-profile.ts';
import {recordedSceneFrame} from './recorded-scene.ts';
import {speechRecipient} from './speech-recipient.ts';
import type {RecordedFrame, RecordedEvidence, RecordedEvent} from '../replay/player.ts';
// Live world surface (direction v2, task 6): shows what the shared world is really doing and lets anyone
// open the evidence behind it. Everything is built with textContent; nothing from the server is parsed as HTML.
//  - Header: "Live world" button and the spotlight chip (who holds the turn, which freedom, live/replay)
//  - Map: the ten Muses at their real places, moving along trips in real time
//  - Panel tabs: Feed (source badges) · Highlights · P1 before/after · Autonomy (2.2) · Identity (claim, owner inbox, P0,
//    impostor/injection checks) · Location (virtual location, 13.1)
//  - Evidence view (P2): request id, model, envelope, verification steps, raw JSON, and the run log behind the event
//    (run id, the commit that wrote it, state hashes) from /api/world/event
//  - Highlights are read from the server a page at a time (cursor) over a chosen period, so older moments stay reachable
import {Marker, type Map as LibreMap} from 'maplibre-gl';
import {areaById} from '../engine/location.ts';
import {HARNESSES} from '../engine/harness';
import {PLACES, PLACE_BY_ID} from '../engine/places';
import {itemName as rawItemName, ITEMS, effectRule} from '../engine/items';
import {MUSE_VARIANTS} from '../character-kit/catalog';
import {createWorld, tick, TICK_MS, localClock} from '../engine/world';
import {makeHooks} from '../engine/rules';
import {ensureSession, sparkStatus} from '../live';
import {ritualCard} from './ritual';
import {ownerControlCard, p0Text} from './identity';
import {mountSocialStatus} from './social-status.ts';
import {ownerInboxCard} from './owner-inbox';
import {renderFlows, flowState, selectFlow} from './preview-flows';
import {fetchJson, newHealth, track, resState, stateText, loadLog, BLOCKED, type Health} from './resource-state';
import {isolation, enforceIsolation} from './isolation';
import {mountReplay, replayPlayer, getReplayClock, type ReplayEvent} from './replay';
import {computeAutonomy} from './autonomy';
import {EMPTY_FILTER, matchFilter, dayBound, type Filter} from './replay-core';
import {sourceLabel, modelNote} from './source-label';
import {taskCancelledText, envelopeFacts} from './evidence-text';
import {mountLocationChip, deviceLocationCard} from './location-bar';
import {museLine, snapshotOf, type OwnerLocationView} from './location-state';
import {mountOwnerArea} from './area-map';
import {liveFrames, scheduleCues, sceneToLngLat, inventorySummary, ownerOf, type LiveWorld, type LiveEvent} from './live-scene-core';
export {sourceLabel};

type Ev = {seq: number; id: string; tick: number; at: number; source: 'live' | 'rule' | 'scripted' | 'replay'; kind: string; muse: string | null; other?: string | null; place?: string | null; line?: string | null; data: any; tags: string[]; runId?: string | null; inputSeq?: number | null};
/** /api/world/event: one event with the run-log commit that wrote it (worker/core/world-runtime.ts eventRecord). */
type EventRecord = {runId: string | null; runIdStored: boolean; input: {seq: number; kind: string; label: string; beforeHash: string; afterHash: string; itemsHead: string | null; input: any} | null; run: {runId: string; origin: string; engineVersion: string; harnessVersion: string; catalogVersion: string; schemaVersion: string; startedAt: number} | null};
/** /api/world/autonomy (worker/core/autonomy-oracle.ts): the server's recount, in the table's words. */
type ServerAutonomy = {values: Record<string, {value: string; measured: boolean}>; scope: {runIds: string[]; complete: boolean; partialReason?: string | null}; sample: {events: number}};
/** Highlights per server page (the API allows 300). */
const itemName=(id:string)=>catalogText(rawItemName(id));
const HL_PAGE = 300;
type MuseView = {id: string; profile?: import('../identity/participant.ts').ActorProfile; place: string; travel: {to: string; departAt: number; arriveAt: number; speed: string} | null; beat: {id: string; line: string | null} | null; inventory: string[]; reflection: string; wants?: {goal: string; items: string[]; source: string}};
type WorldView = LiveWorld & {nextSpotlight: {muse: string; freedom: string; priority?: boolean}};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const publicMuseName = (id: string | null | undefined, w?: LiveWorld | null) => {if(!id)return uiText('World');const p=presentationIn(id,w);return p.kind==='legacy'&&id==='00-jolly'?uiText("Jolly · Kim Sejun's Muse"):p.name;};
const publicShortName = (id: string | null | undefined,w?: LiveWorld | null) => id?presentationIn(id,w).name:uiText('World');
const placeName = (id: string | null | undefined) => (id ? (id.startsWith('osm:') ? PLACE_BY_ID.get(id)?.name ?? id : catalogText(PLACE_BY_ID.get(id)?.name ?? id)) : '');
const color = (id: string,w?: LiveWorld | null) => presentationIn(id,w).color;
// Every time on screen is the viewer's own time (their device's time zone). The world itself keeps Menlo Park time for its day and its
// beats; only what is shown is converted.
// The formatters are made per call: a formatter keeps the zone it was built in, and a device can change zone during a session.
const at = (ms: number) => new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(ms));
const viewerDay = (ms: number) => new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(new Date(ms));
const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || uiText('your time zone');


export function describe(e: Ev,w?: LiveWorld | null): string {
  const recipient=speechRecipient(e,w),text=describeBody(e,w);
  return recipient?`${text} · → ${recipient.name}`:text;
}
function describeBody(e: Ev,w?: LiveWorld | null): string {
  const a = publicShortName(e.muse,w), b = publicShortName(e.other,w);
  const d = e.data ?? {};
  switch (e.kind) {
    case 'spotlight': return d.live === false ? uiText`${a} holds the spotlight (${d.freedom}); the scenario decides` : uiText`${a} decides (${d.freedom}): ${d.decision ?? ''}${d.target ? ' → ' + placeName(d.target) : ''}`;
    case 'spotlight_fallback': return uiText`${a}'s turn fell back (${d.reason})`;
    case 'decision_rejected': return uiText`${a}'s decision was refused: ${d.reason}`;
    case 'decision_discarded': return uiText`${a}'s late answer was discarded: ${d.reason}`;
    case 'depart': return uiText`${a} heads to ${placeName(d.to)} (${d.speed}, ${Math.round((d.distanceM ?? 0))} m)`;
    case 'arrive': return uiText`${a} arrives at ${placeName(e.place)}${d.speed === 'taxi' ? uiText(' by teleport') : ''}`;
    case 'beat': return uiText`${a} at ${placeName(e.place)}: ${activityLabel(String(d.beat ?? ''))}`;
    case 'encounter': return uiText`${a} meets ${b} at ${placeName(e.place)}`;
    case 'encounter_reply': return e.source === 'rule' ? uiText`${a} answers ${b} by rule (${String(d.reason ?? uiText('no model answer')).replace(/_/g, ' ')})` : uiText`${a} answers ${b}: ${e.line ?? d.intent ?? ''}`;
    case 'encounter_reply_discarded': return uiText`${a}'s late answer to ${b} was discarded: ${d.reason}`;
    case 'spotlight_cancelled': if(d.reason==='unknown_muse')return uiText`${a}: This Muse is no longer available. Watch current activity in the Feed.`; return uiText`${a}: This Muse chooses for itself. Watch its activity in the Feed.`;
    case 'spotlight_requested': return uiText`${a} asked for the next spotlight turn (${d.origin === 'connected' ? uiText('your Muse') : uiText('visitor')}, #${d.position} in line)`;
    case 'cards_verified': return uiText`${a} and ${b} verified each other's Agent Card`;
    case 'greet': return e.other&&e.other!==e.muse?uiText`${a} greets ${b}`:uiText`${a} speaks`;
    case 'discover': return uiText`${a} found ${itemName(d.item)} at ${placeName(e.place)}`;
    case 'craft': return uiText`${a} crafted ${itemName(d.item)}`;
    case 'trade_proposed': return uiText`${a} offers ${itemName(d.give)} for ${b}'s ${itemName(d.want)}`;
    case 'trade_completed': return uiText`${a} ↔ ${b}: ${itemName(d.give)} for ${itemName(d.want)}${d.accepted_via === 'rule' ? uiText` (${b} accepted by rule)` : ''}`;
    case 'trade_rejected': return uiText`${a} declined (no reason shared)`;
    case 'gathering': return uiText`${d.count} Muses gathered at the campfire`;
    case 'a2a_verified': return uiText`${a}'s signed request passed every check`;
    case 'a2a_refused': return uiText`${a}'s request was refused at ${d.step}: ${String(d.reason).replace(/_/g, ' ')}`;
    case 'delegation_revoked': return uiText`Owner revoked ${a}'s delegation`;
    case 'delegation_issued': return uiText`Owner delegated ${a} again`;
    case 'muse_paused': return uiText`${a} is paused until the owner delegates again`;
    case 'muse_resumed': return uiText`${a} resumed: the owner's delegation is current again`;
    case 'task_cancelled': return taskCancelledText(d, a, b);
    case 'impostor_rejected': return uiText`A look-alike ${a} was refused before greeting`;
    case 'injection_blocked': return uiText`An instruction from ${b} to ${a} was blocked`;
    case 'welcome_gift': return uiText`${a} received a welcome gift`;
    case 'new_day': return uiText`A new day begins (${d.day})`;
    case 'ritual_judged': return uiText`Welcome ritual ${d.passed ? uiText('passed') : uiText('not passed')} (${d.who})`;
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
  const error = got.error ?? (got.capped ? uiText('the 80,000-event read limit was reached') : null), out = got.rows;
  if (!error) { const at = Date.now(); dayCache.set(day, {at, events: out}); return {events: out, error: null, stale: false, at}; }
  if (!out.length && hit) return {events: hit.events, error, stale: true, at: hit.at};
  return {events: out, error, stale: false, at: Date.now()};
}

// Autonomy (direction 2.2): the six numbers come from autonomy.ts (contract C09), over the live log or the replay fixture.

// ---------- P1 (direction 2.1): before/after an ability item ----------
// Passes and tokens with an implemented effect rule (I-06 ITEM_EFFECTS), so the P1 view follows the effect table.
const ABILITY_ITEMS = ITEMS.filter(i => (i.category === 'pass' || i.category === 'token') && effectRule(i.id)).map(i => i.id);
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
export function museMarkers(map: LibreMap, onSelect: (id: string) => void, isLive: () => boolean, marker: (node:HTMLElement)=>Marker = node=>new Marker({element:node,anchor:'center'})) {
  const markers = new Map<string, {m: Marker; label: HTMLElement}>();
  let added = false;
  function add(id: string) {
    const p=presentationIn(id),node=el('div','muse-pin'),label=el('span','muse-pin-label',p.name);
    node.style.setProperty('--muse',p.color);node.append(el('span','muse-pin-dot'),label);
    node.dataset.museId=id;node.setAttribute('role','button');node.tabIndex=0;
    const select=()=>onSelect(id);node.onclick=select;node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};
    const m=marker(node).setLngLat([PLACES[0].lng,PLACES[0].lat]);
    markers.set(id,{m,label});if(added)m.addTo(map);
  }
  for(const h of HARNESSES)add(h.id);
  return {
    update(w: LiveWorld | null, events: readonly LiveEvent[] = [], atMs = Date.now(), replay = false) {
      if (!w) return;
      if (!added) { for (const {m} of markers.values()) m.addTo(map); added = true; }
      const now = atMs, zoom = map.getZoom();
      const frames = liveFrames(w, scheduleCues(events.filter(e => e.tick === undefined || e.tick <= w.tick)), now);
      const ids=new Set(w.muses.map(m=>m.id));
      for(const[id,k]of markers)if(!ids.has(id)){k.m.remove();markers.delete(id);}
      for (const v of w.muses) {
        if(!markers.has(v.id))add(v.id);const k=markers.get(v.id)!;const p=resolveMuse(v);
        const f = frames.get(v.id), pos = f ? sceneToLngLat(f.x, f.z) : null; if (!pos) {k.m.getElement().style.display = 'none'; continue;}
        k.m.setLngLat(pos);
        const node = k.m.getElement(); node.style.display = (!isLive() && !replay) || zoom > 20.2 ? 'none' : '';
        node.dataset.replay = String(replay); node.dataset.projectedAt = String(now); node.dataset.lnglat = JSON.stringify(pos); node.dataset.version = String(w.version ?? w.tick); node.dataset.owner = ownerOf(v.id,v).kind;node.style.setProperty('--muse',p.color);node.setAttribute('aria-label',uiText`Select ${p.name} · ${v.id}`);
        node.dataset.inventory = JSON.stringify(v.inventory);
        node.title = `${replay ? uiText('REPLAY · ') : ''}${publicMuseName(v.id,w)} · ${catalogText(ownerOf(v.id,v).label)} · ${inventoryText(v.inventory)}`;
        k.label.textContent = p.name + (v.travel ? ` → ${placeName(v.travel.to)}` : '');
      }
    },
  };
}

// ---------- Panel ----------
const describeEvent = describe;
type EvidenceEv = Ev & {fixture?: boolean; recorded?: RecordedEvidence};
const PARTS: [Filter['part'], string][] = [['', uiText('Any time')], ['night', uiText('Night 0–6')], ['morning', uiText('Morning 6–12')], ['afternoon', uiText('Afternoon 12–18')], ['evening', uiText('Evening 18–24')]];

export function mountWorldPanel(map: LibreMap, live: {onWorld?: (world: LiveWorld, events: readonly LiveEvent[], observedAt: number) => void; onSelect?: (id: string) => void; isLive?: () => boolean; paused?: () => boolean; onReturnLive?: () => void} = {}) {
  enforceIsolation();
  const displayWorld=()=>currentRecorded?withSnapshotProfiles(recordedSceneFrame(currentRecorded).world,currentRecorded.publicState):world;
  const museName=(id:string|null|undefined)=>publicMuseName(id,displayWorld());
  const shortName=(id:string|null|undefined)=>publicShortName(id,displayWorld());
  const describe=(e:Ev)=>describeEvent(e,(e as EvidenceEv).fixture?null:displayWorld());
  const header = document.querySelector('header')!;
  const open = el('button', 'quiet world-open'); open.type = 'button'; open.id = 'world-open';
  const openDot = el('span', 'live-pulse'); open.append(openDot, el('span', '', uiText('Live world')));
  const spot = el('span', 'spot-chip'); spot.id = 'spot-chip'; spot.textContent = uiText('Spotlight · …');
  header.insertBefore(spot, header.querySelector('#about'));
  header.insertBefore(open, header.querySelector('#about'));
  // Owner location (13.1): always on screen while the virtual location is used, in story and world mode alike.
  const locChip = mountLocationChip(header, spot);
  const ownerAreaMap = mountOwnerArea(map);
  const paintOwnerArea = () => ownerAreaMap.update(locChip.snapshot?.view ?? null, !isolation.replay && (live.isLive?.() ?? true));

  const note = el('div', 'commons-note', uiText('Commons scene: scripted 3:30 story · the live world runs on the map and in Live world'));
  note.id = 'commons-note';
  document.body.append(note);

  const panel = el('section', 'world-panel'); panel.id = 'world-panel'; panel.setAttribute('popover', 'manual'); panel.setAttribute('aria-label', uiText('Live world'));
  const close = el('button', 'close', '×'); close.type = 'button'; close.setAttribute('aria-label', uiText('Close live world')); close.onclick = () => panel.hidePopover();
  const title = el('h2', '', uiText('Live world')); const sub = el('p', 'world-sub', uiText('One shared world for every visitor. Each event shows where it came from; the Connection line shows whether the world answers right now.'));
  const legend = el('div', 'legend');
  for (const [t, c] of [[uiText('LIVE · Muse Spark'), 'src-live'], [uiText('LIVE · verified'), 'src-live'], ['RULE', 'src-rule'], ['SCRIPTED', 'src-scripted'], ['REPLAY', 'src-replay'], [uiText('PLANNED'), 'src-planned']]) legend.append(el('span', 'src ' + c, t));
  // Connection line (P-06): the badges are where an event came from (its history); this is whether the world answers now.
  const conn = el('div', 'conn'); conn.id = 'conn';
  const connState = el('span', 'conn-state'); connState.setAttribute('role', 'status');
  const connTime = el('span', 'conn-time');
  const connRetry = el('button', 'secondary conn-retry', uiText('Retry')); connRetry.type = 'button'; connRetry.hidden = true; connRetry.onclick = () => void refresh();
  conn.append(el('span', 'conn-label', uiText('Connection')), connState, connTime, connRetry);
  const tabs = el('nav', 'world-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', uiText('Live world sections')); const body = el('div', 'world-body');
  panel.append(close, el('span', 'eyebrow', uiText('MUSELY · SHARED WORLD')), title, sub, legend, conn, tabs, body);
  document.body.append(panel);

  const evidence = el('section', 'evidence'); evidence.id = 'evidence'; evidence.setAttribute('popover', 'auto'); evidence.setAttribute('role', 'dialog'); evidence.setAttribute('aria-labelledby', 'evidence-title');
  document.body.append(evidence);

  let observation: WorldObservation<WorldView> | null = null;
  let world: WorldView | null = null, events: Ev[] = [], tab = 'feed', hf: Filter = {...EMPTY_FILTER};
  let ownerInboxView: ReturnType<typeof ownerInboxCard> | null = null;
  let ownerSocialView:ReturnType<typeof mountSocialStatus>|null=null;
  const pins = museMarkers(map, live.onSelect ?? (() => {}), live.isLive ?? (() => true));

  const stateCard = (heading: string, detail: string, retry: () => void) => {
    const c = el('div', 'state-card'); c.setAttribute('role', 'status'); c.append(el('strong', '', heading), el('p', 'muted', detail));
    const b = el('button', 'secondary', uiText('Retry')); b.type = 'button'; b.onclick = retry; c.append(b); return c;
  };
  const staleNote = (text: string, retry: () => void) => {
    const c = el('div', 'state-note'); c.setAttribute('role', 'status'); c.append(el('span', '', text));
    const b = el('button', 'secondary', uiText('Retry')); b.type = 'button'; b.onclick = retry; c.append(b); return c;
  };

  let connKey = '';
  function paintConn() {
    const h = health.get('world'), s = resState(h, !!world);
    // While the fixture replay is open nothing is requested, so the line says that instead of implying a live check.
    const text = isolation.replay ? uiText('Replay is open · no requests are made to the world while it plays') : stateText(s, h, at);
    if (text !== connKey) { connKey = text; connState.textContent = text; } // the live region changes only when the state changes
    connTime.textContent = h?.lastOkAt && !isolation.replay ? uiText`updated ${at(h.lastOkAt)}` : '';
    conn.dataset.state = isolation.replay ? 'replay' : s;
    connRetry.hidden = isolation.replay || !(s === 'stale' || s === 'error');
  }

  // Evidence opens over the panel and closes back to where the visitor was: same tab, filters, scroll, and the triggering row.
  type Ret = {tab: string; scrollTop: number; triggerId: string; resume: boolean; clock: ReturnType<typeof getReplayClock>};
  let ret: Ret | null = null;
  function showEvidence(e: EvidenceEv) {
    evidence.replaceChildren();
    const c = el('button', 'close', '×'); c.type = 'button'; c.setAttribute('aria-label', uiText('Close evidence')); c.onclick = () => evidence.hidePopover();
    const s = e.recorded ? {text: uiText('REPLAY · recorded ') + e.source.toUpperCase(), cls: 'src-replay'} : sourceLabel(e);
    const h3 = el('h3', '', describe(e)); h3.id = 'evidence-title'; h3.tabIndex = -1;
    const recipient=speechRecipient(e,displayWorld());
    if(recipient)h3.setAttribute('aria-label',`${describe(e)} · ${uiText`To ${recipient.name}`}`);
    evidence.dataset.eventId = e.id;
    evidence.append(c, el('span', 'eyebrow', 'EVIDENCE'), h3, el('span', 'src ' + s.cls, s.text));
    const dl = el('dl', 'facts');
    const fact = (k: string, v: unknown) => { if (v === undefined || v === null || v === '') return; dl.append(el('dt', '', k), el('dd', '', typeof v === 'string' ? v : JSON.stringify(v))); };
    if (e.fixture) fact(uiText('Record'), uiText('Preview fixture (SCRIPTED) — not a live record'));
    fact(uiText`When (your time · ${viewerZone()})`, `${viewerDay(e.at)}, ${at(e.at)}` + uiText` · tick ${e.tick} · event ${e.id}`);
    fact(uiText('Muse'), museName(e.muse)); fact(uiText('Other'), e.other ? museName(e.other) : null); fact(uiText('Place'), placeName(e.place));
    const ev = e.data?.evidence;
    const orig = typeof ev?.replayOf === 'string' ? ev.replayOf : ev?.replayOf?.requestId, rec = typeof ev?.replayOf === 'object' ? ev.replayOf : null;
    if (ev) { fact(uiText('Model'), ev.model ?? rec?.model); fact(uiText('Request id'), ev.requestId); fact(uiText('Response id'), ev.responseId); fact(uiText('Latency'), ev.latencyMs ? ev.latencyMs + uiText(' ms') : null); fact(uiText('Reservation'), ev.reservationId); if (orig) fact(uiText('Replayed from'), uiText`request ${orig}${rec?.responseId ? uiText(' · response ') + rec.responseId : ''}${rec?.recordedAt ? uiText(' · recorded ') + new Date(rec.recordedAt).toISOString() : ''}`); }
    if (!ev?.requestId && !orig) fact(uiText('Model call'), modelNote(e)); // never invent an id: either it does not apply or the evidence is missing
    const env = e.data?.envelope;
    for (const [k, v] of envelopeFacts(env)) fact(k, v);
    if (e.data?.steps) fact(uiText('Verified steps'), (e.data.steps as string[]).join(' → '));
    if (e.kind === 'a2a_refused') fact(uiText('Refused at'), `${e.data.step}: ${e.data.reason}`);
    if (e.data?.aVerifiesB) fact(uiText('Card checks'), uiText`${shortName(e.muse)} → ${shortName(e.other)}: ${e.data.aVerifiesB.ok ? 'ok' : e.data.aVerifiesB.reason} · reverse: ${e.data.bVerifiesA.ok ? 'ok' : e.data.bVerifiesA.reason}`);
    if (e.data?.verdict) fact(uiText('Verdict'), e.data.verdict.ok ? 'ok' : e.data.verdict.reason);
    if (e.data?.kinds) fact(uiText('Detected'), (e.data.kinds as string[]).join(', ') + ' · ' + (e.data.limit ?? ''));
    if (e.data?.reason && !e.data?.step) fact(uiText('Reason'), e.data.reason);
    if (e.data?.trigger) fact(uiText('Trigger'), e.data.trigger === 'demo_button' ? uiText('demo button (real check)') : e.data.trigger);
    evidence.append(dl);
    const links = el('p', 'evidence-links');
    // A fixture event is not a real Muse call: no signed-card link, so the replay never leaves for the API.
    if (!e.fixture && !e.recorded) for (const m of [e.muse, e.other]) if (m) { const a = el('a', '', uiText`${shortName(m)}'s signed Agent Card ↗`); a.href = `/api/agents/${m}/card`; a.target = '_blank'; a.rel = 'noopener'; links.append(a); }
    if (links.childNodes.length) evidence.append(links);
    const raw = el('details'); raw.append(el('summary', '', uiText('Raw event (JSON)')), el('pre', '', JSON.stringify(e, null, 2)));
    evidence.append(raw);
    evidence.showPopover();
    h3.focus({preventScroll: true});
    // The run log behind a live event (C08, P2): its run id and the commit that wrote it. A fixture makes no request.
    if (e.recorded) {
      const r = e.recorded, i = r.input;
      dl.append(el('dt', '', uiText('Recorded run')), el('dd', '', `${r.runId} · ${r.versions.engineVersion} · ${r.versions.catalogVersion}`), el('dt', '', uiText('Recorded commit')), el('dd', '', uiText`#${i.seq} ${i.kind} (${i.label}) · state ${i.beforeHash.slice(0, 12)} → ${i.afterHash.slice(0, 12)}`));
    } else if (!e.fixture) void runFacts(e, dl, links);
  }
  async function runFacts(e: EvidenceEv, dl: HTMLElement, links: HTMLElement) {
    const link = el('a', '', uiText('Run record for this event (run id · event id) ↗')); link.href = `/api/world/event?id=${encodeURIComponent(e.id)}`; link.target = '_blank'; link.rel = 'noopener';
    links.append(link); if (!links.isConnected) evidence.insertBefore(links, evidence.querySelector('details'));
    const r = await fetchJson<EventRecord>(link.href);
    if (!evidence.matches(':popover-open') || evidence.dataset.eventId !== e.id) return; // closed, or now showing another event
    const add = (k: string, v: string) => dl.append(el('dt', '', k), el('dd', '', v));
    if (!r.ok) { add(uiText('Run'), uiText`${e.runId ?? uiText('not stored on this row')} · the run record could not be read (${r.error})`); return; }
    const rec = r.data;
    add(uiText('Run'), rec.runId ? `${rec.runId}${rec.runIdStored ? '' : uiText(' (written before the run log; counted in its pre-run-log run)')}${rec.run ? ` · ${rec.run.origin} · ${rec.run.engineVersion} · ${rec.run.harnessVersion} · ${rec.run.catalogVersion}` : ''}` : uiText('No run record'));
    if (rec.input) add(uiText('Commit'), uiText`#${rec.input.seq} ${rec.input.kind} (${rec.input.label}) · state ${rec.input.beforeHash.slice(0, 12)} → ${rec.input.afterHash.slice(0, 12)}${rec.input.itemsHead ? uiText` · item history head ${rec.input.itemsHead.slice(0, 12)}` : ''}`);
    else add(uiText('Commit'), uiText('Not recorded (this event was written before the run log)'));
  }
  function openEvidence(e: EvidenceEv, trigger?: HTMLElement) {
    if (!ret) ret = {tab, scrollTop: panel.scrollTop, triggerId: trigger?.dataset.eventId ?? e.id, resume: getReplayClock().getState().playing, clock: getReplayClock()};
    getReplayClock().pause();
    showEvidence(e);
  }
  async function returnFromEvidence() {
    const r = ret; ret = null; if (!r) return;
    if (tab !== r.tab) { tab = r.tab; await render(); }
    panel.scrollTop = r.scrollTop;
    const back = [...body.querySelectorAll<HTMLElement>('[data-event-id]')].find(b => b.dataset.eventId === r.triggerId);
    (back ?? tabs.querySelector<HTMLElement>('.tab.active'))?.focus({preventScroll: true});
    if (r.resume && tab === 'replay') r.clock.play();
  }
  evidence.addEventListener('toggle', ev => { if ((ev as ToggleEvent).newState === 'closed') void returnFromEvidence(); });

  // A list that crosses the viewer's midnight gets a day heading per group, so 00:12 above 23:58 reads as the next day, not as a jump back.
  function addRows(ul: HTMLElement, evs: Ev[]) {
    const days = evs.map(e => viewerDay(e.at)), several = new Set(days).size > 1;
    let shown = '';
    evs.forEach((e, i) => { if (several && days[i] !== shown) { const hd = el('li', 'ev-day', days[i]); hd.setAttribute('role', 'heading'); hd.setAttribute('aria-level', '3'); ul.append(hd); shown = days[i]; } ul.append(row(e)); });
  }
  function row(e: Ev) {
    const li = el('li', 'ev'); const s = sourceLabel(e);
    const b = el('button', 'ev-btn'); b.type = 'button'; b.dataset.eventId = e.id; b.onclick = () => openEvidence(e, b);
    const recipient=speechRecipient(e,displayWorld());
    if(recipient)b.setAttribute('aria-label',`${at(e.at)} · ${s.text} · ${describe(e)} · ${uiText`To ${recipient.name}`}`);
    b.append(el('span', 'ev-time', at(e.at)), el('span', 'src ' + s.cls, s.text), el('span', 'ev-text', describe(e)));
    for (const t of e.tags) b.append(el('span', 'tag', catalogText(t.replace(/_/g, ' '))));
    li.append(b);
    return li;
  }

  const TABS: [string, string][] = [['feed', uiText('Feed')], ['highlights', uiText('Highlights')], ['p1', uiText('P1 · items change plans')], ['autonomy', uiText('Autonomy')], ['identity', uiText('Identity')], ['location', uiText('Location')], ['replay', uiText('Replay')], ['flows', uiText('Preview flows')]];
  for (const [id, label] of TABS) { const t = el('button', 'tab', label); t.type = 'button'; t.dataset.tab = id; t.setAttribute('aria-pressed', 'false'); t.onclick = () => { tab = id; void render(); }; tabs.append(t); }

  // Fixture replay (P-06): mounted only on its tab; while it is on screen every background poll to /api waits.
  let replayView: {destroy(): void} | null = null;
  function leaveReplay() { if (replayView) { replayView.destroy(); replayView = null; } if (isolation.replay) { isolation.replay = false; paintConn(); } }
  let currentRecorded: RecordedFrame | null = null;
  const replayFrames = new Set<(frame: RecordedFrame | null) => void>();
  const replayCtx = {
    onFrame: (frame: RecordedFrame | null) => { currentRecorded = frame; ownerAreaMap.update(null, false); if (frame) {const view = recordedSceneFrame(frame); pins.update(withSnapshotProfiles(view.world,frame.publicState), view.events, frame.recordedAt, true);} else {pins.update(world, events); paintOwnerArea();} for (const listener of replayFrames) listener(frame); },
    returnLive: () => { live.onReturnLive?.(); tab = 'feed'; void render().then(() => refresh()); },
    showEvidence: (e: ReplayEvent | RecordedEvent, trigger: HTMLElement) => openEvidence(e, trigger),
    sourceLabel: (e: ReplayEvent | RecordedEvent) => sourceLabel(e), describe: (e: ReplayEvent | RecordedEvent) => describe(e), museName, placeName, at,
  };
  panel.addEventListener('toggle', ev => { if ((ev as ToggleEvent).newState === 'closed') {ownerSocialView?.setVisible(false);leaveReplay();} });

  /** Highlights: find a moment by period, tag, Muse, place or time of day. Tag, Muse, place and time of day narrow the loaded
   *  list without a request; the period asks the server again, and "Load older moments" reads the next page. */
  function highlightsView(hl: Ev[], more: boolean): HTMLElement[] {
    const bar = el('div', 'filter'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', uiText('Find moments'));
    const status = el('p', 'muted'); status.setAttribute('role', 'status');
    const ul = el('ul', 'ev-list');
    const chips: HTMLButtonElement[] = [];
    const draw = () => {
      ul.replaceChildren();
      const shown = hl.filter(e => matchFilter(e, hf));
      addRows(ul, shown);
      status.textContent = (shown.length ? uiText`${shown.length} moment${shown.length === 1 ? '' : 's'}` : uiText('No moment matches. Clear the filters.')) + (more ? uiText` · ${hl.length} loaded, older moments in this period are on the server` : '');
      for (const c of chips) c.setAttribute('aria-pressed', String((c.dataset.tag ?? '') === hf.tag));
    };
    const chip = (tag: string, label: string) => { const b = el('button', 'tag', label); b.type = 'button'; b.dataset.tag = tag; b.onclick = () => { hf = {...hf, tag}; draw(); }; chips.push(b); bar.append(b); };
    chip('', 'all');
    for (const t of [...new Set(hl.flatMap(e => e.tags))].sort()) chip(t, catalogText(t.replace(/_/g, ' ')));
    const field = (label: string, options: [string, string][], key: 'muse' | 'place' | 'part') => {
      const wrap = el('label', 'fld'); wrap.append(el('span', '', label));
      const sel = el('select'); for (const [v, t] of options) { const o = el('option', '', t); o.value = v; if (hf[key] === v) o.selected = true; sel.append(o); }
      sel.onchange = () => { hf = {...hf, [key]: sel.value} as Filter; draw(); };
      wrap.append(sel); return wrap;
    };
    const muses = [...new Set(hl.flatMap(e => [e.muse, e.other ?? null]).filter((m): m is string => !!m))].sort();
    const places = [...new Set(hl.map(e => e.place).filter((p): p is string => !!p))].sort();
    // The period (your dates, both ends included) is a server query: a new period loads its own pages.
    const dateField = (label: string, key: 'from' | 'to') => {
      const wrap = el('label', 'fld'); wrap.append(el('span', '', label));
      const inp = el('input'); inp.type = 'date'; inp.value = hlPeriod[key];
      inp.onchange = () => { hlPeriod = {...hlPeriod, [key]: inp.value}; void render(); };
      wrap.append(inp); return wrap;
    };
    const fields = el('div', 'fields');
    fields.append(dateField(uiText('From (your date)'), 'from'), dateField(uiText('To (your date)'), 'to'));
    fields.append(field(uiText('Muse'), [['', uiText('Any Muse')], ...muses.map(m => [m, shortName(m)] as [string, string])], 'muse'), field(uiText('Place'), [['', uiText('Any place')], ...places.map(p => [p, placeName(p)] as [string, string])], 'place'), field(uiText('Time of day (your time)'), PARTS, 'part'));
    const clear = el('button', 'secondary', uiText('Clear filters')); clear.type = 'button'; clear.onclick = () => { hf = {...EMPTY_FILTER}; hlPeriod = {from: '', to: ''}; void render(); };
    const older = el('button', 'secondary', uiText('Load older moments')); older.type = 'button'; older.hidden = !more;
    older.onclick = async () => { older.disabled = true; const r = await loadHighlights(true); if (!r.ok) { status.textContent = uiText`Older moments could not be loaded (${r.error}). Try again.`; older.disabled = false; return; } void render(); };
    draw();
    return [bar, fields, clear, status, ul, older];
  }
  /** Loaded highlight pages for one period. `cursor` is the seq of the oldest row read; `more` while the last page came back full. */
  let hlPeriod = {from: '', to: ''};
  let hlPages: {key: string; at: number; events: Ev[]; cursor: number | null; more: boolean} | null = null;
  async function loadHighlights(older = false): Promise<{ok: true} | {ok: false; error: string}> {
    const from = dayBound(hlPeriod.from), to = dayBound(hlPeriod.to, true), key = `${from ?? ''}:${to ?? ''}`;
    hf = {...hf, from, to};
    const keep = hlPages?.key === key ? hlPages : null;
    const q = new URLSearchParams({limit: String(HL_PAGE)});
    if (from !== null) q.set('from', String(from)); if (to !== null) q.set('to', String(to));
    if (older && keep?.cursor != null) q.set('before', String(keep.cursor));
    const r = await load<Ev[]>('highlights', '/api/world/highlights?' + q);
    if (!r.ok) return {ok: false, error: r.error};
    // The newest page replaces the newest rows; pages already read further back stay (each id once).
    const seen = new Set<string>(), merged = (older ? [...(keep?.events ?? []), ...r.data] : [...r.data, ...(keep?.events ?? []).filter(e => !r.data.length || e.seq < r.data[r.data.length - 1].seq)]).filter(e => !seen.has(e.id) && !!seen.add(e.id));
    const full = r.data.length >= HL_PAGE;
    hlPages = {key, at: r.at, events: merged, cursor: merged.length ? Math.min(...merged.map(e => e.seq)) : null, more: older ? full : (keep && keep.events.length > r.data.length ? keep.more : full)};
    return {ok: true};
  }

  let generation = 0;
  async function render() {
    // Each render owns a generation; a slower render for a previous tab never writes into the current one.
    const mine = ++generation, stale = () => mine !== generation;
    const day = world?.day ?? localClock(Date.now()).date; // the world's own (Menlo Park) day
    tabs.querySelectorAll('button').forEach(b => { const on = (b as HTMLElement).dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    if (tab !== 'replay') leaveReplay();
    else if (replayView && body.querySelector('.replay-view')) return; // already on screen: keep playing
    ownerInboxView?.dispose(); ownerInboxView = null;ownerSocialView?.dispose();ownerSocialView=null;
    body.replaceChildren();
    if (tab === 'feed') {
      const evH = health.get('events'), s = resState(evH, events.length > 0);
      if (s === 'error') { body.append(stateCard(uiText('Feed unavailable'), uiText`${evH?.error} · there are no events to show yet.`, () => void refresh())); return; }
      if (s === 'stale') body.append(staleNote(uiText`The feed could not be refreshed (${evH?.error}). Showing events up to ${events.length ? at(events[events.length - 1].at) : '—'}.`, () => void refresh()));
      const ul = el('ul', 'ev-list'); addRows(ul, events.slice(-80).reverse());
      body.append(ul.childNodes.length ? ul : el('p', 'muted', uiText('Waiting for the next heartbeat…')));
    } else if (tab === 'highlights') {
      const r = await loadHighlights();
      if (stale()) return;
      const shown = hlPages && hlPages.key === `${dayBound(hlPeriod.from) ?? ''}:${dayBound(hlPeriod.to, true) ?? ''}` ? hlPages : null;
      if (!shown) { body.append(stateCard(uiText('Highlights unavailable'), uiText`${health.get('highlights')?.error} · there is nothing to show yet.`, () => void render())); return; }
      if (!r.ok) body.append(staleNote(uiText`Highlights could not be refreshed (${r.error}). Showing the list from ${at(shown.at)}.`, () => void render()));
      const period = hlPeriod.from || hlPeriod.to;
      body.append(el('p', 'muted', uiText('Moments tagged by rule: first trade, refusals, impostors, blocked instructions, off-script choices, teleports, relics, gatherings, P0. Open one to see its evidence and its run record.')), ...(shown.events.length || period ? highlightsView(shown.events, shown.more) : [el('p', 'muted', uiText('No highlights yet. They appear as the world runs.'))]));
    } else if (tab === 'p1') {
      const p = el('p', 'muted', uiText('Does a reward change what a Muse does next? Two views: the same Muse before and after it gained an ability item in the live log, and the real engine run twice in your browser from the same seed and start, once with the item.'));
      const d = await dayEvents(day);
      if (stale()) return;
      const logDown = !!d.error && !d.events.length;
      const live = logDown ? [] : liveP1(d.events);
      const t1 = el('table', 'data');
      t1.append(trow([uiText('Muse · item'), uiText('how'), uiText('trips'), uiText('farthest'), uiText('bus/taxi'), uiText('trades'), uiText('places')], 'th'));
      for (const r of live) { t1.append(trow([uiText`${shortName(r.muse)} · ${itemName(r.item)} (before)`, '', r.before.trips, r.before.farthestM + uiText(' m'), `${r.before.bus}/${r.before.taxi}`, r.before.trades, r.before.places])); t1.append(trow([uiText`${shortName(r.muse)} · ${itemName(r.item)} (after)`, r.via.replace(/_/g, ' '), r.after.trips, r.after.farthestM + uiText(' m'), `${r.after.bus}/${r.after.taxi}`, r.after.trades, r.after.places], 'td', 'after')); }
      const sim = engineP1(day);
      const t2 = el('table', 'data');
      t2.append(trow([uiText('Ripple, same seed and start'), uiText('trips'), uiText('bus rides'), uiText('farthest'), uiText('first destinations')], 'th'));
      t2.append(trow([uiText('without Transit Pass'), sim.without.trips, sim.without.bus, sim.without.farthestM + uiText(' m'), sim.without.firstDestinations.join(' → ')]));
      t2.append(trow([uiText('with Transit Pass'), sim.with.trips, sim.with.bus, sim.with.farthestM + uiText(' m'), sim.with.firstDestinations.join(' → ')], 'td', 'after'));
      const liveBlock = logDown ? stateCard(uiText('Run log unavailable'), uiText`${d.error} · the live comparison cannot be shown, the browser engine below still runs.`, () => void render()) : live.length ? tableWrap(t1) : el('p', 'muted', uiText('No Muse has gained an ability item in the live log yet. This table fills in as the world runs.'));
      body.append(p, el('h4', '', uiText('Live log (production)')), ...(d.error && !logDown ? [staleNote(uiText`The run log stopped at ${d.error}; this is a partial sample.`, () => void render())] : []), liveBlock, el('h4', '', uiText`Engine, run in this browser (${sim.ticks} minutes, rule source)`), tableWrap(t2));
    } else if (tab === 'autonomy') {
      const d = await dayEvents(day);
      if (stale()) return;
      if (d.error && !d.events.length) { body.append(stateCard(uiText('Run log unavailable'), uiText`${d.error} · the six numbers are not shown, because a failed request is not a measurement of zero.`, () => void render())); return; }
      if (d.error) body.append(staleNote(d.stale ? uiText`The run log could not be refreshed (${d.error}). Showing the log loaded at ${at(d.at)}.` : uiText`The run log stopped at ${d.error}: partial sample.`, () => void render()));
      // The server recounts the same world day from the run log (C09 oracle), up to the last event this table read.
      const lastAt = d.events.length ? Math.max(...d.events.map(e => e.at)) + 1 : null;
      const srv = await load<ServerAutonomy>('autonomy', `/api/world/autonomy?day=${day}${lastAt ? '&to=' + lastAt : ''}`);
      if (stale()) return;
      const runIds = srv.ok ? srv.data.scope.runIds : [...new Set(d.events.map(e => e.runId).filter((x): x is string => !!x))];
      const res = computeAutonomy(d.events, {label: uiText('Live log (production)'), day, worldId: world?.worldId ?? null, runId: runIds.length ? runIds.join(' + ') : null, complete: !d.error, partialReason: d.error ? uiText`log stopped at ${d.error}` : null});
      const differ = srv.ok ? res.rows.filter(r => srv.data.values[r.key]?.value !== r.comparisonValue) : [];
      const check = !srv.ok ? uiText`Server recount unavailable (${srv.error}); the table above is the browser's count only.`
        : differ.length ? uiText`Server recount from the run log differs on ${differ.map(r => uiText`${r.label} (server: ${srv.data.values[r.key]?.value})`).join(', ')}${srv.data.scope.complete ? '' : uiText(' · the server sample is partial')}.`
        : uiText`Server recount from the run log (${srv.data.sample.events} events${runIds.length > 1 ? uiText`, ${runIds.length} runs` : ''}): all six values match.`;
      const p = el('p', 'muted', check); p.dataset.recount = !srv.ok ? 'unavailable' : differ.length ? 'differs' : 'match';
      body.append(el('p', 'muted', uiText`${res.period}. We call it autonomy only with this table beside it.`), autonomyTable(res), p);
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
    const t = el('table', 'data'); t.append(trow([uiText('Measure'), uiText('Value'), uiText('Sample'), uiText('Note')], 'th'));
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
    card.append(el('span', 'eyebrow', uiText("KIM SEJUN'S MUSE · OWNER CLAIM")), el('h4', '', !r.ok ? uiText('Claim status unavailable') : status === 'claimed' ? uiText('Claimed') : status === 'claim_revoked' ? uiText('Claim revoked') : 'pending_claim'));
    if (!r.ok) card.append(el('p', 'muted', uiText`The claim record could not be read (${r.error}), so its status is unknown. This is not the same as pending_claim.`));
    const dl = el('dl', 'facts');
    const f = (k: string, v: unknown) => { if (v) dl.append(el('dt', '', k), el('dd', '', String(v))); };
    if (r.ok) { f(uiText('Threads account'), '@' + (claim?.handle ?? 'combba82')); f(uiText('Fingerprint'), claim?.fingerprint); f(uiText('Check'), claim?.record?.machineVerified ? uiText('Machine-verified: the Worker re-read the post and matched the fingerprint') : claim?.record?.path === 'owner_direct' ? uiText('Visual check only (not machine-verified)') : uiText('Not verified yet'));
      f(uiText('Verified at'), claim?.record?.verifiedAt ? new Date(claim.record.verifiedAt).toISOString() : null); f(uiText('Note'), claim?.record?.note); }
    card.append(dl);
    if (claim?.record?.permalink) { const a = el('a', '', uiText('Open the claim post on Threads ↗')); a.href = claim.record.permalink; a.target = '_blank'; a.rel = 'noopener'; card.append(a); }
    card.append(el('p', 'muted', uiText('This record proves Kim Sejun\'s Muse only. A new visitor\'s session is not claimed by it. While the Threads app is in development mode, only accounts added as testers can connect: message @combba82 on Threads with your Threads handle to be added. Not a tester? You can still try the owner-direct path: post the claim text from your own Threads account and share the link (a visual check, not machine-verified).')));
    if (!r.ok) { const b = el('button', 'secondary', uiText('Retry')); b.type = 'button'; b.onclick = () => void render(); card.append(b); }
    const actions = el('div', 'id-actions');
    const result = el('p', 'muted'); result.setAttribute('role', 'status');
    const run = (label: string, path: string, text?: (j: any) => string) => { const b = el('button', 'secondary', label); b.type = 'button'; b.onclick = async () => {
      b.disabled = true; result.textContent = uiText('Running a real check…');
      try { const st = await sparkStatus(); if (st) await ensureSession(st); const r = await fetch(path, {method: 'POST'}); const j = await r.json(); result.textContent = r.ok ? (text ? text(j) : uiText('Done. The result is in the Feed and Highlights.')) : uiText`Not allowed: ${j.error ?? r.status}`; await refresh(); }
      catch (err) { result.textContent = uiText('Could not run: ') + (err as Error).message; }
      b.disabled = false; }; return b; };
    actions.append(run(uiText('Try an impostor'), '/api/demo/impostor'), run(uiText('Try an instruction injection'), '/api/demo/injection'), run(uiText('Run P0 step (judge link or owner)'), '/api/p0/run', p0Text));
    const inbox = ownerInboxCard(() => void refresh(), (u, i) => fetch(u, i), () => !stale() && !isolation.replay && panel.matches(':popover-open'), shortName);
    ownerInboxView = inbox;
    const socialDetails=el('details'),socialHost=el('div');socialDetails.id='owner-social-status';socialDetails.hidden=true;socialDetails.append(el('summary','',uiText('내 Muse 상태 / My Muse status')),socialHost);
    const social=mountSocialStatus(socialHost,{onSessionLost:()=>{inbox.setOwnerSession(null);socialDetails.hidden=true;}});ownerSocialView=social;social.setVisible(false);
    socialDetails.addEventListener('toggle',()=>social.setVisible(socialDetails.open&&!stale()&&!isolation.replay&&panel.matches(':popover-open')));
    const control=ownerControlCard(()=>void refresh(),shortName,owner=>{inbox.setOwnerSession(owner);if(stale())return;socialDetails.hidden=!owner;social.setVisible(!!owner&&socialDetails.open&&!isolation.replay&&panel.matches(':popover-open'));void social.syncOwner({authenticated:!!owner,muse:owner?.muses[0]??null});});
    body.append(card, control, socialDetails, inbox, ritualCard(() => void refresh()), el('h4', '', uiText('Real checks you can trigger')), el('p', 'muted', uiText('These run the same verification code as the world. The event records that a button triggered it. P0 is two runs: the first commits a signed trade, then the owner revokes (owner control above), then the second run re-sends the same job and is refused. P0 itself never revokes or delegates again.')), actions, result);
  }

  // The Location tab is drawn again after a move and on every poll while it is open: an unsent preset/verify choice and the last
  // move result survive that redraw.
  let locDraft: {preset: string; verify: boolean} | null = null, locMsg = '';
  let locationDeviceCard: HTMLElement | null = null;
  async function renderLocation(stale: () => boolean) {
    const frame = el('div', 'id-card'), box = el('details', 'location-owner-details');
    const summary = el('summary', '', uiText('내 Muse의 동네 관리 / Manage my Muse’s neighborhood'));
    locationDeviceCard ??= deviceLocationCard(id => { if (tab !== 'location' || !panel.matches(':popover-open') || isolation.replay) return; const area = areaById(id); if (area) { map.easeTo({center: [area.center.lng, area.center.lat], zoom: 16.5, duration: 600}); if (panel.matches(':popover-open')) panel.hidePopover(); } });
    frame.append(locationDeviceCard, box); // Device choice is independent from the owner/network controls.
    body.append(frame);
    box.append(summary, el('p', 'muted', uiText('동네 정보를 불러오고 있어요… / Loading neighborhood details…')));
    const r = await load<any>('location', '/api/owner/location');
    if (stale()) return;
    box.replaceChildren(summary);
    if (!r.ok) { box.append(el('h4', '', uiText('동네 정보를 불러오지 못했어요 / Neighborhood details are unavailable')), el('p', 'muted', uiText('위에서 가상 동네를 골라 계속 둘러볼 수 있어요. / Choose a virtual neighborhood above to keep exploring.'))); const b = el('button', 'secondary', uiText('다시 불러오기 / Reload details')); b.type = 'button'; b.onclick = () => void render(); box.append(b); return; }
    const loc = r.data;
    const presetLabel = ((loc.presets ?? []) as {id: string; label: string}[]).find(p => p.id === loc.preset)?.label ?? loc.cell_label ?? loc.preset ?? '';
    box.append(el('h4', '', `${loc.source === 'gps' ? uiText('기기에서 찾은 동네 / Nearby neighborhood') : uiText('가상 동네 / Virtual neighborhood')} · ${presetLabel}`));
    const dl = el('dl', 'facts');
    const f = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') dl.append(el('dt', '', k), el('dd', '', String(v))); };
    const m = loc.muse ?? {};
    const held = world?.muses.find(x => x.id === m.id)?.inventory.filter(i => i === 'taxi_token').length ?? null;
    f(uiText('내 동네 / My neighborhood'), uiText`${loc.area?.label ?? presetLabel} · ${loc.area?.radiusM ?? '?'} m radius · ${loc.area?.placeIds?.length ?? '?'} places · ${loc.neighborhood_verified ? uiText('가상 세계 인증됨 / virtual-world verified') : uiText('미인증 / not verified')}`);
    f(uiText('Muse가 있는 곳 / Muse’s place'), m.place ? `${m.place.name ?? m.place.id}${m.in_owner_area ? uiText(' · in your neighborhood') : ''}` : null);
    f(uiText('Muse의 이동 / Muse’s trip'), museLine(snapshotOf(loc, r.at), Date.now()));
    f(uiText('순간이동 / Teleport'), `${uiText('가상 동네 인증과 Taxi Token 1개가 필요해요. / Requires virtual-world verification and one Taxi Token')}${held === null ? '' : uiText` (${held} available)`}.`);
    box.append(dl, el('p', 'muted', uiText('Muse는 자기 동네 안을 자유롭게 걸어요. 다른 동네로 갈 때는 버스나 조건에 맞는 택시를 이용해요. / Your Muse walks freely within its neighborhood and uses the bus or an eligible taxi for other neighborhoods.')));
    const presets = (loc.presets ?? []) as {id: string; label: string}[];
    if (presets.length) {
      const lab = el('label', 'fld'); lab.append(el('span', '', uiText('가상 동네 / Virtual neighborhood')));
      const sel = el('select'); sel.setAttribute('aria-label', uiText('가상 동네 / Virtual neighborhood')); lab.append(sel);
      for (const p of presets) { const o = el('option', '', catalogText(p.label)); o.value = p.id; if (p.id === (locDraft?.preset ?? loc.preset)) o.selected = true; sel.append(o); }
      // Demo neighborhood verification (13.1): staged on the virtual cell, cleared when the owner moves to another cell.
      const vlab = el('label', 'fld check'); const verify = el('input'); verify.type = 'checkbox'; verify.id = 'loc-verify'; verify.checked = locDraft?.verify ?? !!loc.neighborhood_verified;
      vlab.append(verify, el('span', '', uiText('가상 세계에서 이 동네 인증 / Verify this virtual-world neighborhood')));
      const go = el('button', 'secondary', uiText('이 동네 적용 / Apply this neighborhood')); go.type = 'button';
      const msg = el('p', 'muted', locMsg); msg.setAttribute('role', 'status');
      sel.onchange = verify.onchange = () => { locDraft = {preset: sel.value, verify: verify.checked}; };
      go.onclick = async () => {
        const res = await fetchJson<{follow?: {mode?: string; etaMs?: number} | null}>('/api/owner/location', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({source: 'virtual', preset: sel.value, verify: verify.checked})});
        const mode = res.ok ? res.data.follow?.mode : null, mins = res.ok && res.data.follow?.etaMs ? uiText`, about ${Math.max(1, Math.round(res.data.follow.etaMs / 60_000))} min` : '';
        msg.textContent = locMsg = res.ok ? (mode === 'paused' ? uiText('동네를 바꿨어요. 활동이 일시정지된 Muse는 다시 허용할 때까지 머물러요. / Neighborhood updated. Your paused Muse stays put until you allow activity again.') : mode === 'teleport' ? uiText('동네로 순간이동했어요. Taxi Token 1개를 썼어요. / Teleported using one Taxi Token.') : mode === 'roaming' ? uiText('동네를 바꿨어요. Muse는 이 안을 자유롭게 걸을 수 있어요. / Neighborhood updated. Your Muse can roam here.') : mode === 'bus' ? uiText`Your Muse is taking the bus${mins}.` : uiText`Your Muse is walking${mins}. Watch the map.`) : /HTTP 40[13]/.test(res.error) ? uiText('동네 설정을 바꾸려면 Identity에서 주인으로 로그인하세요. / Sign in as the owner in Identity to change this setting.') : uiText('동네를 바꾸지 못했어요. 가상 동네 둘러보기는 계속할 수 있어요. / Could not update the neighborhood. You can still explore a virtual neighborhood.');
        if (res.ok) locDraft = null;
        await refresh();
      };
      box.append(lab, vlab, go, msg);
    }
  }

  let lastSeq = 0;
  async function refresh() {
    // Replay makes no requests: nothing refreshes while it is on screen, whoever asked (a poll, a Retry, or a button chain that
    // began before it opened). The next refresh after the replay asks again.
    if (isolation.replay) return;
    if (panel.matches(':popover-open') && tab === 'identity' && !ret) void ownerInboxView?.refresh();
    // The location chip has its own answer: the rest of the refresh does not wait for it. An answer that arrives while the replay
    // is open is not applied (the chip also ignores a request the replay refused).
    void load<OwnerLocationView>('location', '/api/owner/location').then(lr => { if (!isolation.replay) {locChip.update(lr); paintOwnerArea();} });
    // First load takes the newest events (the live tail); later polls fetch only what is new since then.
    const [wr, er] = await Promise.all([load<WorldView>('world', '/api/world'), load<Ev[]>('events', lastSeq ? `/api/world/events?since=${lastSeq}&limit=500` : '/api/world/events?tail=200')]);
    if (isolation.replay || (!wr.ok && wr.error === BLOCKED) || (!er.ok && er.error === BLOCKED)) return; // asked before the replay opened: not applied; the next refresh fetches it again
    observation = observeWorld(observation, wr);
    if(observation)world=observation.world;
    if (er.ok && er.data.length) { events.push(...er.data); events = events.slice(-1500); lastSeq = er.data[er.data.length - 1].seq; }
    if (!live.paused?.()) {pins.update(world, events); if (world) live.onWorld?.(world, events, observation!.observedAt);}
    const last = [...events].reverse().find(e => e.kind === 'spotlight' || e.kind === 'spotlight_fallback');
    if (world) {
      const stalled = !wr.ok;
      const recipient=last?speechRecipient(last,displayWorld()):null;
      spot.textContent = uiText`Spotlight · ${shortName(world.nextSpotlight.muse)} next${world.nextSpotlight.priority ? uiText(' (priority)') : ''} · ${world.nextSpotlight.freedom}${stalled ? uiText(' · not updating') : ''}`;
      if(last){const note=document.createElement('small');note.className='spot-last-action';note.textContent=`${navigator.language.startsWith('ko')?uiText('지난 차례'):uiText('Last turn')} · ${shortName(last.muse)}${recipient?' → '+recipient.name:''} · ${last.source.toUpperCase()}`;spot.append(note);}
      spot.dataset.state = stalled ? 'stale' : 'other';
      spot.title = stalled ? uiText`The world did not answer (${wr.error}); this is the last data we received.` : last ? describe(last) : '';
      document.body.dataset.worldReady = '1';
    } else spot.textContent = uiText('Spotlight · world offline');
    paintConn();
    if (panel.matches(':popover-open') && tab === 'feed' && !ret) { const st = panel.scrollTop; await render(); panel.scrollTop = st; }
    // The Location tab follows the trip too, unless a control in it is in use (a redraw would close an open preset list).
    else if (panel.matches(':popover-open') && tab === 'location' && !ret) {
      const f = document.activeElement, inUse = f instanceof HTMLElement && body.contains(f) && f.matches('select, input');
      if (!inUse) { const st = panel.scrollTop; await render(); panel.scrollTop = st; }
    }
  }
  open.onclick = () => { if (panel.matches(':popover-open')) panel.hidePopover(); else { panel.showPopover(); void render(); } };
  paintConn();
  void refresh();
  setInterval(refresh, 10_000);
  map.on('zoom', () => {if (currentRecorded) {const view = recordedSceneFrame(currentRecorded); pins.update(withSnapshotProfiles(view.world,currentRecorded.publicState), view.events, currentRecorded.recordedAt, true);}});
  setInterval(() => {if (!isolation.replay && !live.paused?.()) pins.update(world, events);}, 1000);
  setInterval(paintOwnerArea, 1000);
  return {refresh, onReplayFrame(listener: (frame: RecordedFrame | null) => void) { replayFrames.add(listener); return () => replayFrames.delete(listener); }, get events() { return events; }, get world() { return world; }, showEvidence: openEvidence, flows: flowState, replay: replayPlayer, health, openTab(id: string) { tab = id; if (!panel.matches(':popover-open')) panel.showPopover(); void render(); }};
}
