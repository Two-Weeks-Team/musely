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
import {createWorld, tick, TICK_MS} from '../engine/world';
import {makeHooks} from '../engine/rules';
import {ensureSession, sparkStatus} from '../live';

type Ev = {seq: number; id: string; tick: number; at: number; source: 'live' | 'rule' | 'scripted' | 'replay'; kind: string; muse: string | null; other?: string | null; place?: string | null; line?: string | null; data: any; tags: string[]};
type MuseView = {id: string; place: string; travel: {to: string; departAt: number; arriveAt: number; speed: string} | null; beat: {id: string; line: string | null} | null; inventory: string[]; reflection: string; wants?: {goal: string; items: string[]; source: string}};
type WorldView = {worldId: string; day: string; tick: number; lastTickAt: number; nextSpotlight: {muse: string; freedom: string}; muses: MuseView[]};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const museName = (id: string | null | undefined) => (id ? (id === '00-jolly' ? "Jolly · Kim Sejun's Muse" : harnessById(id).name) : 'World');
const shortName = (id: string | null | undefined) => (id ? harnessById(id).name : 'World');
const placeName = (id: string | null | undefined) => (id ? PLACE_BY_ID.get(id)?.name ?? id : '');
const color = (id: string) => MUSE_VARIANTS.find(v => v.id === id)?.body ?? '#E8DDC7';
const clockFmt = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false});
const at = (ms: number) => clockFmt.format(new Date(ms));

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
    default: return e.line ?? e.kind.replace(/_/g, ' ');
  }
}

async function getJson<T>(path: string): Promise<T | null> {
  try { const r = await fetch(path, {cache: 'no-store'}); return r.ok ? (await r.json()) as T : null; } catch { return null; }
}

/** One world day of the append-only run log, paged (2,000 per call), cached for a minute. */
const dayCache = new Map<string, {at: number; events: Ev[]}>();
async function dayEvents(day: string): Promise<Ev[]> {
  const hit = dayCache.get(day);
  if (hit && Date.now() - hit.at < 60_000) return hit.events;
  const out: Ev[] = [];
  let since = 0;
  for (let page = 0; page < 40; page++) {
    const rows = await getJson<Ev[]>(`/api/world/events?day=${day}&since=${since}&limit=2000`);
    if (!rows?.length) break;
    out.push(...rows); since = rows[rows.length - 1].seq;
    if (rows.length < 2000) break;
  }
  dayCache.set(day, {at: Date.now(), events: out});
  return out;
}

// ---------- Autonomy (direction 2.2) ----------
export function autonomy(evs: Ev[]) {
  const enc = evs.filter(e => e.kind === 'encounter');
  const self = enc.filter(e => e.data?.initiatedByIntent).length;
  const spot = evs.filter(e => e.kind === 'spotlight' || e.kind === 'spotlight_fallback');
  return [
    ['Autonomous starts', `${enc.length ? Math.round(enc.filter(e => e.muse).length / enc.length * 100) : 0}% of ${enc.length} meetings were started by a Muse, none by a person · ${self} followed a Muse's own live choice`],
    ['Owner interventions', `${evs.filter(e => e.kind === 'meetup_candidate' || e.kind === 'approval_requested').length} approval requests · daily greetings and trades need none`],
    ['Signature checks', `${evs.filter(e => e.kind === 'cards_verified' && e.data?.aVerifiesB?.ok && e.data?.bVerifiesA?.ok).length + evs.filter(e => e.kind === 'a2a_verified').length} passed · ${evs.filter(e => e.kind === 'a2a_refused' || e.kind === 'impostor_rejected').length} refused (incl. impostors)`],
    ['Muse Spark calls', `${spot.filter(e => e.source === 'live').length} live · ${spot.filter(e => e.source === 'replay').length} replay · ${spot.filter(e => e.source === 'scripted').length} scenario`],
    ['Ability changes', `${evs.filter(e => e.tags.includes('ability_change')).length} (trades, crafts, passes)`],
    ['Blocks', `${evs.filter(e => e.kind === 'injection_blocked').length} instructions blocked · ${evs.filter(e => e.kind === 'decision_rejected').length} out-of-scope decisions refused`],
  ] as [string, string][];
}

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
export function mountWorldPanel(map: LibreMap) {
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
  const title = el('h2', '', 'Live world'); const sub = el('p', 'world-sub', 'One shared world for every visitor. Each event shows where it came from.');
  const legend = el('div', 'legend');
  for (const [t, c] of [['LIVE · Muse Spark', 'src-live'], ['LIVE · verified', 'src-live'], ['RULE', 'src-rule'], ['SCRIPTED', 'src-scripted'], ['REPLAY', 'src-replay']]) legend.append(el('span', 'src ' + c, t));
  const tabs = el('nav', 'world-tabs'); const body = el('div', 'world-body');
  panel.append(close, el('span', 'eyebrow', 'MUSELY · SHARED WORLD'), title, sub, legend, tabs, body);
  document.body.append(panel);

  const evidence = el('section', 'evidence'); evidence.id = 'evidence'; evidence.setAttribute('popover', 'auto'); evidence.setAttribute('aria-label', 'Evidence');
  document.body.append(evidence);

  let world: WorldView | null = null, events: Ev[] = [], tab = 'feed', filter = '';
  const pins = museMarkers(map);

  function showEvidence(e: Ev) {
    evidence.replaceChildren();
    const c = el('button', 'close', '×'); c.type = 'button'; c.onclick = () => evidence.hidePopover();
    const s = sourceLabel(e);
    evidence.append(c, el('span', 'eyebrow', 'EVIDENCE'), el('h3', '', describe(e)), el('span', 'src ' + s.cls, s.text));
    const dl = el('dl', 'facts');
    const fact = (k: string, v: unknown) => { if (v === undefined || v === null || v === '') return; dl.append(el('dt', '', k), el('dd', '', typeof v === 'string' ? v : JSON.stringify(v))); };
    fact('When (Menlo Park)', at(e.at) + ` · tick ${e.tick} · event ${e.id}`);
    fact('Muse', museName(e.muse)); fact('Other', e.other ? museName(e.other) : null); fact('Place', placeName(e.place));
    const ev = e.data?.evidence;
    if (ev) { fact('Model', ev.model); fact('Request id', ev.requestId); fact('Response id', ev.responseId); fact('Latency', ev.latencyMs ? ev.latencyMs + ' ms' : null); fact('Reservation', ev.reservationId); if (ev.replayOf) fact('Replayed from', ev.replayOf); }
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
    for (const m of [e.muse, e.other]) if (m) { const a = el('a', '', `${shortName(m)}'s signed Agent Card ↗`); a.href = `/api/agents/${m}/card`; a.target = '_blank'; a.rel = 'noopener'; links.append(a); }
    if (links.childNodes.length) evidence.append(links);
    const raw = el('details'); raw.append(el('summary', '', 'Raw event (JSON)'), el('pre', '', JSON.stringify(e, null, 2)));
    evidence.append(raw);
    evidence.showPopover();
  }

  function row(e: Ev) {
    const li = el('li', 'ev'); const s = sourceLabel(e);
    const b = el('button', 'ev-btn'); b.type = 'button'; b.onclick = () => showEvidence(e);
    b.append(el('span', 'ev-time', at(e.at)), el('span', 'src ' + s.cls, s.text), el('span', 'ev-text', describe(e)));
    for (const t of e.tags) b.append(el('span', 'tag', t.replace(/_/g, ' ')));
    li.append(b);
    return li;
  }

  const TABS: [string, string][] = [['feed', 'Feed'], ['highlights', 'Highlights'], ['p1', 'P1 · items change plans'], ['autonomy', 'Autonomy'], ['identity', 'Identity'], ['location', 'Location']];
  for (const [id, label] of TABS) { const t = el('button', 'tab', label); t.type = 'button'; t.dataset.tab = id; t.onclick = () => { tab = id; render(); }; tabs.append(t); }

  let generation = 0;
  async function render() {
    // Each render owns a generation; a slower render for a previous tab never writes into the current one.
    const mine = ++generation, stale = () => mine !== generation;
    const day = world?.day ?? new Date().toISOString().slice(0, 10);
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab));
    body.replaceChildren();
    if (tab === 'feed') {
      const ul = el('ul', 'ev-list'); for (const e of events.slice(-80).reverse()) ul.append(row(e));
      body.append(ul.childNodes.length ? ul : el('p', 'muted', 'Waiting for the next heartbeat…'));
    } else if (tab === 'highlights') {
      const hl = await getJson<Ev[]>('/api/world/highlights?limit=200') ?? [];
      if (stale()) return;
      const tags = [...new Set(hl.flatMap(e => e.tags))].sort();
      const bar = el('div', 'filter'); const all = el('button', 'tag' + (filter ? '' : ' on'), 'all'); all.onclick = () => { filter = ''; render(); }; bar.append(all);
      for (const t of tags) { const b = el('button', 'tag' + (filter === t ? ' on' : ''), t.replace(/_/g, ' ')); b.onclick = () => { filter = t; render(); }; bar.append(b); }
      const ul = el('ul', 'ev-list'); for (const e of hl.filter(e => !filter || e.tags.includes(filter))) ul.append(row(e));
      body.append(el('p', 'muted', 'Moments tagged by rule: first trade, refusals, impostors, blocked instructions, off-script choices, teleports, relics, gatherings, P0. Open one to see its evidence.'), bar, ul);
    } else if (tab === 'p1') {
      const p = el('p', 'muted', 'Does a reward change what a Muse does next? Two views: the same Muse before and after it gained an ability item in the live log, and the real engine run twice in your browser from the same seed and start, once with the item.');
      const live = liveP1(await dayEvents(day));
      if (stale()) return;
      const t1 = el('table', 'data');
      t1.append(trow(['Muse · item', 'how', 'trips', 'farthest', 'bus/taxi', 'trades', 'places'], 'th'));
      for (const r of live) { t1.append(trow([`${shortName(r.muse)} · ${itemName(r.item)} (before)`, '', r.before.trips, r.before.farthestM + ' m', `${r.before.bus}/${r.before.taxi}`, r.before.trades, r.before.places])); t1.append(trow([`${shortName(r.muse)} · ${itemName(r.item)} (after)`, r.via.replace(/_/g, ' '), r.after.trips, r.after.farthestM + ' m', `${r.after.bus}/${r.after.taxi}`, r.after.trades, r.after.places], 'td', 'after')); }
      const sim = engineP1(day);
      const t2 = el('table', 'data');
      t2.append(trow(['Ripple, same seed and start', 'trips', 'bus rides', 'farthest', 'first destinations'], 'th'));
      t2.append(trow(['without Transit Pass', sim.without.trips, sim.without.bus, sim.without.farthestM + ' m', sim.without.firstDestinations.join(' → ')]));
      t2.append(trow(['with Transit Pass', sim.with.trips, sim.with.bus, sim.with.farthestM + ' m', sim.with.firstDestinations.join(' → ')], 'td', 'after'));
      body.append(p, el('h4', '', 'Live log (production)'), live.length ? t1 : el('p', 'muted', 'No Muse has gained an ability item in the live log yet. This table fills in as the world runs.'), el('h4', '', `Engine, run in this browser (${sim.ticks} minutes, rule source)`), t2);
    } else if (tab === 'autonomy') {
      const evs = await dayEvents(day);
      if (stale()) return;
      const t = el('table', 'data'); for (const [k, v] of autonomy(evs)) t.append(trow([k, v]));
      body.append(el('p', 'muted', `From ${evs.length} events in the run log for ${day} (Menlo Park day). We call it autonomy only with this table beside it.`), t);
    } else if (tab === 'identity') {
      await renderIdentity(stale);
    } else if (tab === 'location') {
      await renderLocation(stale);
    }
  }
  function trow(cells: (string | number)[], tag: 'td' | 'th' = 'td', cls = '') { const tr = el('tr', cls); for (const c of cells) tr.append(el(tag, '', String(c))); return tr; }

  async function renderIdentity(stale: () => boolean) {
    const claim = await getJson<any>('/api/claim/owner-muse');
    if (stale()) return;
    const card = el('div', 'id-card');
    const status = claim?.record?.status ?? 'pending_claim';
    card.append(el('span', 'eyebrow', "KIM SEJUN'S MUSE · OWNER CLAIM"), el('h4', '', status === 'claimed' ? 'Claimed' : status === 'claim_revoked' ? 'Claim revoked' : 'pending_claim'));
    const dl = el('dl', 'facts');
    const f = (k: string, v: unknown) => { if (v) dl.append(el('dt', '', k), el('dd', '', String(v))); };
    f('Threads account', '@' + (claim?.handle ?? 'combba82')); f('Fingerprint', claim?.fingerprint); f('Check', claim?.record?.machineVerified ? 'Machine-verified: the Worker re-read the post and matched the fingerprint' : claim?.record?.path === 'owner_direct' ? 'Visual check only (not machine-verified)' : 'Not verified yet');
    f('Verified at', claim?.record?.verifiedAt ? new Date(claim.record.verifiedAt).toISOString() : null); f('Note', claim?.record?.note);
    card.append(dl);
    if (claim?.record?.permalink) { const a = el('a', '', 'Open the claim post on Threads ↗'); a.href = claim.record.permalink; a.target = '_blank'; a.rel = 'noopener'; card.append(a); }
    card.append(el('p', 'muted', 'This record proves Kim Sejun\'s Muse only. A new visitor\'s session is not claimed by it. While the Threads app is in development mode, only accounts added as testers can connect: message @combba82 on Threads with your Threads handle to be added. Not a tester? You can still try the owner-direct path: post the claim text from your own Threads account and share the link (a visual check, not machine-verified).'));
    const actions = el('div', 'id-actions');
    const result = el('p', 'muted');
    const run = (label: string, path: string) => { const b = el('button', 'secondary', label); b.type = 'button'; b.onclick = async () => {
      b.disabled = true; result.textContent = 'Running a real check…';
      try { const st = await sparkStatus(); if (st) await ensureSession(st); const r = await fetch(path, {method: 'POST'}); const j = await r.json(); result.textContent = r.ok ? 'Done. The result is in the Feed and Highlights.' : `Not allowed: ${j.error ?? r.status}`; await refresh(); }
      catch (err) { result.textContent = 'Could not run: ' + (err as Error).message; }
      b.disabled = false; }; return b; };
    actions.append(run('Try an impostor', '/api/demo/impostor'), run('Try an instruction injection', '/api/demo/injection'), run('Run P0 (judge link)', '/api/p0/run'));
    body.append(card, el('h4', '', 'Real checks you can trigger'), el('p', 'muted', 'These run the same verification code as the world. The event records that a button triggered it.'), actions, result);
  }

  async function renderLocation(stale: () => boolean) {
    const loc = await getJson<any>('/api/owner/location');
    if (stale()) return;
    const box = el('div', 'id-card');
    box.append(el('span', 'eyebrow', 'OWNER LOCATION · 13.1'));
    if (!loc) { box.append(el('h4', '', 'Virtual location (demo) · HQ commons'), el('p', 'muted', 'Location switching is being connected (MCP server PR). Until then the owner location is the HQ commons preset.')); body.append(box); return; }
    box.append(el('h4', '', `${loc.source === 'gps' ? 'GPS (phase 2)' : 'Virtual location (demo)'} · ${loc.presetLabel ?? loc.preset ?? ''}`));
    const dl = el('dl', 'facts');
    const f = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') dl.append(el('dt', '', k), el('dd', '', String(v))); };
    f('Owner cell', loc.cellLabel ?? loc.cell); f("Muse's current place", placeName(loc.musePlace) || loc.musePlace); f('ETA', loc.etaMs ? Math.round(loc.etaMs / 60000) + ' min' : loc.eta);
    box.append(dl, el('p', 'muted', 'The owner cell is where the Muse walks to and what neighborhood verification checks. Discovery, trades and the MCP world state use the Muse\'s own current place, which changes only by travelling or a verified teleport. No device GPS spoofing or VPN.'));
    const presets = (loc.presets ?? []) as {id: string; label: string}[];
    if (presets.length) {
      const sel = el('select'); sel.setAttribute('aria-label', 'Virtual location preset');
      for (const p of presets) { const o = el('option', '', p.label); o.value = p.id; if (p.id === loc.preset) o.selected = true; sel.append(o); }
      const go = el('button', 'secondary', 'Move owner here (judge link)'); go.type = 'button';
      const msg = el('p', 'muted');
      go.onclick = async () => { const r = await fetch('/api/owner/location', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({source: 'virtual', preset: sel.value})}); msg.textContent = r.ok ? 'Moved. Watch the Muse walk on the map.' : 'Only the judge link can move the owner in this preview.'; await refresh(); };
      box.append(sel, go, msg);
    }
    body.append(box);
  }

  let lastSeq = 0;
  async function refresh() {
    // First load takes the newest events (the live tail); later polls fetch only what is new since then.
    const [w, fresh] = await Promise.all([getJson<WorldView>('/api/world'), getJson<Ev[]>(lastSeq ? `/api/world/events?since=${lastSeq}&limit=500` : '/api/world/events?tail=200')]);
    if (w) world = w;
    if (fresh?.length) { events.push(...fresh); events = events.slice(-1500); lastSeq = fresh[fresh.length - 1].seq; }
    pins.update(world);
    const last = [...events].reverse().find(e => e.kind === 'spotlight' || e.kind === 'spotlight_fallback');
    if (world) {
      const live = last && last.source === 'live';
      spot.textContent = `Spotlight · ${shortName(world.nextSpotlight.muse)} next · ${world.nextSpotlight.freedom}${last ? ' · last: ' + (live ? 'LIVE' : last.source.toUpperCase()) : ''}`;
      spot.dataset.state = live ? 'live' : 'other';
      spot.title = last ? describe(last) : '';
      document.body.dataset.worldReady = '1';
    } else spot.textContent = 'Spotlight · world offline';
    if (panel.matches(':popover-open') && (tab === 'feed')) render();
  }
  open.onclick = () => { if (panel.matches(':popover-open')) panel.hidePopover(); else { panel.showPopover(); render(); } };
  void refresh();
  setInterval(refresh, 10_000);
  setInterval(() => pins.update(world), 1000);
  return {refresh, get events() { return events; }, get world() { return world; }, showEvidence};
}
