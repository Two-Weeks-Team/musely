// Live world → 3D commons projection (I-09, direction v2 8, 10, 11, 14). Pure: no DOM and no three.js, so the
// mapping, the travel interpolation and the Muse ID match are tested in Node (scripts/live-scene.test.mjs).
// live-scene.ts applies these frames to the commons actors; world-panel.ts places the map pins with the same poses.
//
// Everything here is a function of (server snapshot, server events, time). Nothing depends on how many frames
// ran before, so a reconnect, a seek or a LOD switch gives the same actor, the same place and the same action phase.
import {MercatorCoordinate} from 'maplibre-gl';
import {PLACE_BY_ID} from '../engine/places.ts';
import {BEATS} from '../engine/beats.ts';
import {itemName} from '../engine/items.ts';
import {HARNESS_IDS} from '../engine/harness.ts';
import type {ActorProfile} from '../identity/participant.ts';
import {resolveMuse, presentationIn} from './personal-profile.ts';
import {OWNER_MUSE} from '../engine/location.ts';
import {MUSE_VARIANTS, ACTION_CLIPS, PARTNER_DISTANCE, strideOf} from '../character-kit/catalog.ts';
import clipManifest from '../../character-kit/runtime/animations/manifest.json' with {type: 'json'};
import geography from '../../assets/geography.json' with {type: 'json'};

// ---------- Server shapes (GET /api/world, GET /api/world/events) ----------
export type LiveTravel = {to: string; departAt: number; arriveAt: number; speed: string; chosen?: boolean};
export type LiveBeat = {id: string; clip?: string | null; startedAt: number; endsAt: number; line?: string | null};
export type LiveMuse = {id: string; profile?: ActorProfile; place: string; travel: LiveTravel | null; beat: LiveBeat | null; inventory: string[]; reflection?: string; wants?: {goal: string; items?: string[]; source?: string}; paused?: unknown};
export type LiveWorld = {worldId: string; day: string; tick: number; version?: number; lastTickAt: number; muses: LiveMuse[]};
export type LiveEvent = {id: string; seq?: number; tick?: number; at: number; source?: string; kind: string; muse: string | null; other?: string | null; place?: string | null; line?: string | null; data?: any};

// ---------- Who owns which Muse (worker/core/owner-session.ts PRINCIPALS; a test keeps the two equal) ----------
export type OwnerKind = 'owner' | 'reviewer' | 'demo-peer' | 'resident' | 'personal' | 'unknown';
export const OWNERSHIP: Readonly<Record<string, {kind: OwnerKind; label: string}>> = {
  [OWNER_MUSE]: {kind: 'owner', label: "Kim Sejun's Muse · owner"},
  '04-ember': {kind: 'reviewer', label: 'Reviewer Muse · directory review'},
  '09-copper': {kind: 'demo-peer', label: 'Demo peer Muse · team-controlled'},
};
export const ownerOf = (id: string, muse?: LiveMuse) => {
  const owner=Object.hasOwn(OWNERSHIP,id)?OWNERSHIP[id]:undefined,p=muse?resolveMuse(muse):null;
  if(p?.kind==='personal')return {kind:owner?.kind??'personal' as OwnerKind,label:'Personal Muse'+(owner?' · '+owner.kind:'')};
  return owner??(HARNESS_IDS.includes(id)&&p?.kind!=='unknown'?{kind:'resident' as const,label:'Resident Muse'}:{kind:'unknown' as const,label:'Profile unavailable'});
};
export const museName = (id: string, world?: LiveWorld | null) => presentationIn(id,world).name;

// ---------- Inventory summary (pin title, 3D label and card show the same text) ----------
export function inventorySummary(inv: readonly string[]) {
  const counts = new Map<string, number>();
  for (const id of inv) { const k = id.startsWith('postcard:') ? 'postcard' : id; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const name = (k: string) => (k === 'postcard' ? 'Postcard' : itemName(k));
  const rows = [...counts].sort((a, b) => b[1] - a[1] || name(a[0]).localeCompare(name(b[0])));
  const top = rows.slice(0, 3).map(([k, n]) => `${name(k)}${n > 1 ? ' ×' + n : ''}`);
  const text = inv.length ? `${inv.length} item${inv.length === 1 ? '' : 's'} · ${top.join(', ')}${rows.length > 3 ? ` · +${rows.length - 3} more` : ''}` : 'No items';
  return {total: inv.length, kinds: rows.length, text};
}

// ---------- Coordinates ----------
// The commons scene is authored in local metres turned to the road grid (main.ts toGeo). Commons places are given in
// those scene coordinates; every other place is east/south metres from the anchor (places.ts toLocal).
const [ANCHOR_LNG, ANCHOR_LAT] = geography.commons as [number, number];
const ORIGIN = MercatorCoordinate.fromLngLat([ANCHOR_LNG, ANCHOR_LAT]), UNIT = ORIGIN.meterInMercatorCoordinateUnits();
const YAW = geography.gridBearingDeg * Math.PI / 180, COS = Math.cos(YAW), SIN = Math.sin(YAW);
export const eastSouthToScene = (e: number, s: number) => ({x: e * COS + s * SIN, z: -e * SIN + s * COS});
export const sceneToEastSouth = (x: number, z: number) => ({e: x * COS - z * SIN, s: x * SIN + z * COS});
export const sceneToLngLat = (x: number, z: number): [number, number] => { const {e, s} = sceneToEastSouth(x, z); const p = new MercatorCoordinate(ORIGIN.x + e * UNIT, ORIGIN.y + s * UNIT, 0).toLngLat(); return [p.lng, p.lat]; };
export function placeScene(id: string): {x: number; z: number} | null {
  const p = PLACE_BY_ID.get(id); if (!p) return null;
  if (p.zone === 'commons') return {x: p.x, z: p.z};
  const c = MercatorCoordinate.fromLngLat([p.lng, p.lat]);
  return eastSouthToScene((c.x - ORIGIN.x) / UNIT, (c.y - ORIGIN.y) / UNIT);
}

// ---------- Slots: every Muse has its own spot at every place, so two Muses never stand in each other ----------
// Ten slots per place, one per Muse (index in MUSE_VARIANTS). A Muse keeps its slot while others come and go.
// Commons slots are laid out clear of the authored furniture (scene.ts); live-scene.test.mjs checks the clearance.
type Slot = {x: number; z: number; yaw: number};
const ring = (cx: number, cz: number, r: number, n = 10, phase = 0): Slot[] => Array.from({length: n}, (_, k) => {
  const a = phase + k * 2 * Math.PI / n, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
  return {x, z, yaw: Math.atan2(cx - x, cz - z)};
});
const row = (pts: [number, number][], yaw: number): Slot[] => pts.map(([x, z]) => ({x, z, yaw}));
export const COMMONS_SLOTS: Readonly<Record<string, readonly Slot[]>> = {
  // In front of the cafe, between the door steps and the tables (row 1 faces the tables, row 2 faces the cafe).
  'commons:cafe': [...row([[-6.3, -2.85], [-5.4, -2.85], [-4.5, -2.85], [-3.6, -2.85], [-2.7, -2.85], [-1.8, -2.85], [-0.9, -2.85]], 0), ...row([[-6.3, -0.5], [-4.5, -0.5], [-2.5, -0.5]], Math.PI)],
  // Around the fire, inside the three benches.
  'commons:campfire': ring(0, 2, 1.45),
  // West of the raised beds and along their north edge, facing the beds.
  'commons:garden': [...row([[6.55, -6.0], [6.55, -5.1], [6.55, -4.2], [6.55, -3.3], [6.55, -2.4]], Math.PI / 2), ...row([[7.2, -1.45], [8.1, -1.45], [9.0, -1.45], [9.9, -1.45], [10.8, -1.45]], Math.PI)],
  // Behind and beside the south bench, facing the fire.
  'commons:benches': [...row([[-2.2, 5.1], [-1.3, 5.1], [-0.4, 5.1], [0.5, 5.1], [1.4, 5.1], [2.3, 5.1]], Math.PI), ...row([[-3.2, 4.4], [3.2, 4.4], [-0.85, 6.0], [0.85, 6.0]], Math.PI)],
  // On the book & music platform, around its bench and in front of the shelf.
  'commons:bookshelf': [...row([[-9.4, 3.75], [-8.5, 3.75], [-7.6, 3.75], [-6.7, 3.75]], 0), ...row([[-6.65, 4.65], [-6.65, 5.55]], -Math.PI / 2), ...row([[-9.4, 6.3], [-8.5, 6.3], [-7.6, 6.3], [-6.7, 6.3]], Math.PI)],
  'commons:workbench': ring(6, 6, 1.2),
  'commons:hq': ring(4, -9, 1.2),
};
export function slotAt(placeId: string, museId: string, participants: readonly LiveMuse[] = []): Slot | null {
  const c = placeScene(placeId); if (!c) return null;
  const k = MUSE_VARIANTS.findIndex(v => v.id === museId);
  const slots = COMMONS_SLOTS[placeId] ?? ring(c.x, c.z, 1.2);
  if(k>=0)return slots[k % slots.length];
  const personal=participants.filter(m=>!MUSE_VARIANTS.some(v=>v.id===m.id)&&resolveMuse(m).kind==='personal').map(m=>m.id).sort();
  const index=personal.indexOf(museId);if(index<0)return null;
  // Presentation positions only: preserve all ten authored slots and append a separate row beside them.
  return {x:Math.min(...slots.map(p=>p.x))+(index%10)*.9,z:Math.max(...slots.map(p=>p.z))+.9+Math.floor(index/10)*.9,yaw:slots[0].yaw};
}

// ---------- Clips ----------
export const CLIP_INFO: Readonly<Record<string, {seconds: number; loop: boolean}>> = Object.fromEntries((clipManifest.clips as {name: string; seconds: number; loop: boolean}[]).map(c => [c.name, {seconds: c.seconds, loop: c.loop}]));
export const hasClip = (name: string) => name in CLIP_INFO;
/** Clips that move only the upper body enough to be laid over a seated pose (Root/Hips/legs from sit_idle). */
export const UPPER_CLIPS: ReadonlySet<string> = new Set(['talk', 'listen', 'wave', 'offer_item', 'think', 'look_around', 'nod', 'head_shake', 'write_note', 'read_book', 'drink', 'eat', 'clap', 'photo', 'reassure', 'tell_story', 'observe_sky', 'inspect_map', 'inspect_gadget', 'music_bounce']);
/** Bones driven by the upper clip in a blend; everything else (Root, Hips, legs) comes from the posture clip. */
export const UPPER_BONES: ReadonlySet<string> = new Set(['Spine', 'Chest', 'Neck', 'Head', 'UpperArm_L', 'UpperArm_R', 'Forearm_L', 'Forearm_R', 'Hand_L', 'Hand_R']);
/** Items with a shared 3D prop (attachments/props.glb, shown on its socket bone); every other item is shown as a card. */
export const ITEM_PROP: Readonly<Record<string, string>> = {coffee: 'drink', tea: 'drink', pastry: 'eat', fruit: 'eat', snack_box: 'eat', clover_seed: 'plant', wildflower: 'plant', postcard: 'write_note'};
export const propFor = (item: string | null | undefined) => (item ? ITEM_PROP[item.startsWith('postcard:') ? 'postcard' : item] ?? null : null);
const SIT = new Set(['sit_down', 'sit_idle']);

/** One played step of a beat: `clip` drives the body (or the legs when `upper` is set), `upper` the upper body. */
export type Segment = {clip: string; upper: string | null; start: number; seconds: number; loop: boolean};
/**
 * The beat's clip bundle (BEATS[].clips) played in order (direction 10 ActionSpec: sequence, posture, blend).
 * sit_down starts a seated posture until stand_up; while seated an upper-body clip plays over sit_idle (blend) and any
 * other clip first stands up. One-shot clips take their own length; looping clips share the rest of the beat.
 */
export function beatSegments(beatId: string, firstClip: string | null | undefined, totalSeconds: number): Segment[] {
  const bundle = BEATS.find(b => b.id === beatId)?.clips ?? (firstClip ? [firstClip] : ['idle_breathe']);
  const steps: Omit<Segment, 'start' | 'seconds'>[] = [];
  let seated = false;
  const push = (clip: string, upper: string | null = null) => steps.push({clip, upper, loop: CLIP_INFO[upper ?? clip]?.loop ?? true});
  for (const raw of bundle) {
    const c = hasClip(raw) ? raw : 'idle_breathe';
    if (c === 'sit_down') { if (!seated) push('sit_down'); seated = true; continue; }
    if (c === 'sit_idle') { if (!seated) push('sit_down'); seated = true; push('sit_idle'); continue; }
    if (c === 'stand_up') { if (seated) push('stand_up'); seated = false; continue; }
    if (seated && UPPER_CLIPS.has(c)) { push('sit_idle', c); continue; }
    if (seated) { push('stand_up'); seated = false; }
    push(c);
  }
  const last = steps[steps.length - 1];
  if (!last || !last.loop) push(seated ? 'sit_idle' : 'idle_breathe');
  const fixed = steps.filter(s => !s.loop).reduce((t, s) => t + CLIP_INFO[s.upper ?? s.clip].seconds, 0);
  const loops = steps.filter(s => s.loop).length, share = Math.max(1, (totalSeconds - fixed) / Math.max(1, loops));
  let start = 0;
  return steps.map(s => { const seconds = s.loop ? share : CLIP_INFO[s.upper ?? s.clip].seconds; const seg = {...s, start, seconds}; start += seconds; return seg; });
}
export const segmentAt = (segs: readonly Segment[], t: number) => { let k = 0; while (k < segs.length - 1 && t >= segs[k + 1].start) k++; return segs[k]; };

// ---------- Event → clip / prop / effect (the projection table; docs/LIVE_SCENE.md lists the same rows) ----------
export type FxKind = 'teleport' | 'item' | 'stamp' | 'trade_lock';
/** One participant in a phase. `item`: which event item it holds (data.give / data.want / data.item). */
type Part = {clip: string; line?: boolean; item?: 'give' | 'want' | 'item'; effect?: FxKind};
/** A phase both participants play at the same time. `handoff`: who gives the phase's item (prop moves at the contact frame). */
type Phase = {seconds: number; muse: Part; other?: Part; face?: boolean; contact?: boolean; handoff?: 'muse' | 'other'};
export type Projection = {phases: Phase[]; visual: 'complete' | 'fallback'; note: string; when?: (e: LiveEvent) => boolean};
export const EVENT_PROJECTION: Readonly<Record<string, Projection>> = {
  encounter: {phases: [{seconds: 2, muse: {clip: 'fist_bump'}, other: {clip: 'fist_bump'}, contact: true}], visual: 'complete', note: 'both turn to each other 0.9 m apart and touch fists at the clip contact frame'},
  cards_verified: {phases: [{seconds: 1.5, muse: {clip: 'nod'}, other: {clip: 'nod'}, face: true}], visual: 'complete', note: 'both nod after the Agent Card check'},
  greet: {phases: [{seconds: 4, muse: {clip: 'talk', line: true}, other: {clip: 'listen'}, face: true}], visual: 'complete', note: 'speaker talks with the greeting in a bubble, the other listens; seated Muses talk over sit_idle (blend)'},
  encounter_reply: {phases: [{seconds: 4, muse: {clip: 'talk', line: true}, other: {clip: 'listen'}, face: true}], visual: 'complete', note: 'the answering Muse talks, the other listens'},
  trade_proposed: {phases: [{seconds: 2.5, muse: {clip: 'offer_item', item: 'give'}, other: {clip: 'think'}, face: true}], visual: 'complete', note: 'offer_item holding the offered item; the other thinks'},
  trade_rejected: {phases: [{seconds: 2, muse: {clip: 'head_shake'}, other: {clip: 'listen'}, face: true}], visual: 'complete', note: 'the declining Muse shakes its head (no reason shown)'},
  trade_completed: {phases: [
    {seconds: 3, muse: {clip: 'handoff_give', item: 'give'}, other: {clip: 'handoff_receive', item: 'give'}, contact: true, handoff: 'muse'},
    {seconds: 3, muse: {clip: 'handoff_receive', item: 'want'}, other: {clip: 'handoff_give', item: 'want'}, contact: true, handoff: 'other'},
    {seconds: 2.5, muse: {clip: 'celebrate', effect: 'trade_lock'}, other: {clip: 'celebrate', effect: 'trade_lock'}, face: true},
  ], visual: 'complete', note: 'two synchronized hand-overs (the item moves hand to hand at contact frame 32), then the trade-lock glow'},
  gift: {phases: [
    {seconds: 3, muse: {clip: 'handoff_give', item: 'item'}, other: {clip: 'handoff_receive', item: 'item'}, contact: true, handoff: 'muse'},
    {seconds: 2.5, muse: {clip: 'idle_breathe'}, other: {clip: 'celebrate', effect: 'item'}, face: true},
  ], visual: 'complete', note: 'hand-over with the gift, then the receiver celebrates with the item-appear effect'},
  discover: {phases: [{seconds: 3, muse: {clip: 'pick_up', item: 'item', effect: 'item'}}], visual: 'complete', note: 'pick_up; the found item appears (stamp effect too when a place stamp was found)'},
  craft: {phases: [{seconds: 2.5, muse: {clip: 'celebrate', item: 'item', effect: 'item'}}], visual: 'complete', note: 'celebrate with the item-appear effect'},
  arrive: {phases: [{seconds: 2, muse: {clip: 'idle_breathe', effect: 'teleport'}}], visual: 'complete', note: 'teleport arrival only (Taxi Token): teleport effect at the arrival slot', when: e => !!(e.data?.teleport || e.data?.speed === 'taxi')},
  spotlight: {phases: [{seconds: 3, muse: {clip: 'think', line: true}}], visual: 'complete', note: 'the spotlight Muse thinks with its decision line in a bubble'},
  gathering: {phases: [{seconds: 3, muse: {clip: 'clap'}}], visual: 'complete', note: 'every Muse in data.muses claps at the campfire'},
  postcard_sent: {phases: [{seconds: 3, muse: {clip: 'write_note', item: 'item', line: true}}], visual: 'fallback', note: 'the sender writes; postcard artwork is an item card, with no invented delivery'},
  postcard_delivered: {phases: [{seconds: 3, muse: {clip: 'celebrate', item: 'item', effect: 'item'}}], visual: 'fallback', note: 'the recorded recipient celebrates; the postcard is shown as an item card'},
  trade_countered: {phases: [{seconds: 2, muse: {clip: 'think'}, other: {clip: 'listen'}, face: true}, {seconds: 2, muse: {clip: 'offer_item', item: 'give'}, other: {clip: 'think'}, face: true}], visual: 'complete', note: 'a thought then the revised offer, with a card for an item without a model'},
  meetup_proposed: {phases: [{seconds: 3, muse: {clip: 'talk', line: true}, other: {clip: 'listen'}, face: true}], visual: 'complete', note: 'the public proposal only; no private candidate details enter the scene'},
  meetup_confirmed: {phases: [{seconds: 3, muse: {clip: 'celebrate', effect: 'item'}, other: {clip: 'celebrate', effect: 'item'}, face: true}], visual: 'complete', note: 'both celebrate the recorded agreement; its private time and place are never displayed'},
  campfire_invite: {phases: [{seconds: 3, muse: {clip: 'wave', line: true}}], visual: 'complete', note: 'the inviter waves; travel is still driven only by the server snapshot'},
  campfire_gathering: {phases: [{seconds: 3, muse: {clip: 'clap'}}], visual: 'complete', note: 'every recorded participant claps, including the reviewer and demo peer Muses'},
  help_requested: {phases: [{seconds: 3, muse: {clip: 'offer_item', item: 'item', line: true}, other: {clip: 'think'}, face: true}], visual: 'complete', note: 'the requested item is offered as a prop or a named card'},
  help_input_required: {phases: [{seconds: 3, muse: {clip: 'think', line: true}}], visual: 'complete', note: 'the helper waits for input; nothing is completed by the animation'},
  help_completed: {phases: [{seconds: 3, muse: {clip: 'celebrate', line: true}, other: {clip: 'celebrate', effect: 'item'}, face: true}], visual: 'fallback', note: 'both celebrate; the result stays a named inventory item, with no unsupported repair animation'},
  impostor_rejected: {phases: [{seconds: 2, muse: {clip: 'head_shake', line: true}}], visual: 'complete', note: 'head shake after the recorded identity rejection'},
  injection_blocked: {phases: [{seconds: 2, muse: {clip: 'head_shake'}}], visual: 'complete', note: 'head shake only; the injected text is never echoed'},
};
/** Cues start this long after the event, so every client polling every 10 s sees the event before its cue begins. */
export const CUE_DELAY_MS = 12_000;
export const PAIR_EASE_MS = 400;
export type Cue = {
  eventId: string; kind: string; muse: string; partner: string | null; phase: number;
  clip: string; start: number; end: number; face: boolean; contact: boolean;
  item: string | null; prop: string | null; handoff: 'give' | 'receive' | null; contactAt: number | null;
  line: string | null; effect: FxKind | null;
};
/**
 * Event list → timed cues. Cues of one tick are chained per Muse (a greeting after the fist bump), starting at the
 * tick's events + CUE_DELAY_MS. A tick's events commit together, so every client builds the same cues from them.
 */
export function scheduleCues(events: readonly LiveEvent[]): Cue[] {
  const out: Cue[] = [];
  const byTick = new Map<string, LiveEvent[]>();
  const unique = [...new Map(events.map(e => [e.id, e])).values()].sort((a, b) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0) || a.id.localeCompare(b.id));
  for (const e of unique) { const k = String(e.tick ?? e.at); if (!byTick.has(k)) byTick.set(k, []); byTick.get(k)!.push(e); }
  for (const list of byTick.values()) {
    list.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.id.localeCompare(b.id));
    const busy = new Map<string, number>();
    for (const e of list) {
      const p = EVENT_PROJECTION[e.kind];
      if (!p || !e.muse || (p.when && !p.when(e))) continue;
      const gathering = e.kind === 'gathering' || e.kind === 'campfire_gathering';
      const group = gathering ? ((e.data?.muses as string[] | undefined) ?? [e.muse]) : [e.muse];
      const other = gathering ? null : e.other ?? null;
      const people = [...group, ...(other ? [other] : [])];
      const published = e.data?.publishedAt;
      const availableAt = typeof published === 'number' && Number.isFinite(published) ? Math.max(e.at, published) : e.at;
      let t = Math.max(availableAt + CUE_DELAY_MS, ...people.map(m => busy.get(m) ?? 0));
      p.phases.forEach((ph, k) => {
        const end = t + ph.seconds * 1000;
        const add = (who: string, part: Part, partner: string | null, role: 'muse' | 'other') => {
          const item = part.item ? String(e.data?.[part.item] ?? '') || null : null;
          const hand = ph.handoff ? (ph.handoff === role ? 'give' : 'receive') : null;
          const spec = ACTION_CLIPS[part.clip];
          const effect = part.effect === 'item' && e.kind === 'discover' && e.data?.stamp ? 'stamp' : part.effect ?? null;
          out.push({eventId: e.id, kind: e.kind, muse: who, partner, phase: k, clip: part.clip, start: t, end, face: !!ph.face, contact: !!ph.contact,
            item, prop: propFor(item), handoff: hand, contactAt: ph.contact && spec?.contact !== undefined ? t + spec.contact / 24 * 1000 : null,
            line: part.line ? e.line ?? null : null, effect});
        };
        for (const m of group) add(m, ph.muse, other, 'muse');
        if (other && ph.other) add(other, ph.other, e.muse, 'other');
        t = end;
      });
      for (const m of people) busy.set(m, t);
    }
  }
  return out;
}

// ---------- Poses ----------
export type Pose = {x: number; z: number; yaw: number; moving: boolean; progress: number; travelled: number; speed: string | null};
/** Where the Muse is now: its slot at its place, or on the straight line between the two slots of its trip (server ETA). */
export function musePose(v: LiveMuse, now: number, participants: readonly LiveMuse[] = [v]): Pose | null {
  if(resolveMuse(v).kind==='unknown')return null;
  const a = slotAt(v.place, v.id, participants); if (!a) return null;
  if (!v.travel) return {...a, moving: false, progress: 0, travelled: 0, speed: null};
  const b = slotAt(v.travel.to, v.id, participants) ?? a;
  const span = Math.max(1, v.travel.arriveAt - v.travel.departAt), f = Math.min(1, Math.max(0, (now - v.travel.departAt) / span));
  const taxi = v.travel.speed === 'taxi';
  const g = taxi ? (f >= 1 ? 1 : 0) : f, dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
  const moving = !taxi && f > 0 && f < 1 && d > 1e-6;
  return {x: a.x + dx * g, z: a.z + dz * g, yaw: moving ? Math.atan2(dx, dz) : f >= 1 ? b.yaw : a.yaw, moving, progress: f, travelled: d * g, speed: v.travel.speed};
}
/** Map pin position: the same pose as the 3D actor, in map coordinates. */
export const museLngLat = (v: LiveMuse, now: number, participants: readonly LiveMuse[] = [v]) => { const p = musePose(v, now, participants); return p ? sceneToLngLat(p.x, p.z) : null; };

// ---------- Frames ----------
export type FrameFx = {kind: FxKind; progress: number};
export type ActorFrame = {
  id: string; x: number; z: number; yaw: number;
  /** Body clip (legs/posture when `upper` is set), its local time, and the optional upper-body clip and time. */
  clip: string; actionTime: number; upper: string | null; upperTime: number;
  /** Clip whose shared 3D prop the actor holds (props.glb), or null. `card`: item shown as a card (no 3D prop). */
  carry: string | null; card: string | null;
  seated: boolean; moving: boolean;
  cue: {eventId: string; kind: string; phase: number; partner: string | null} | null;
  line: string | null; effects: FrameFx[];
  visual: 'complete' | 'fallback'; fallback: string | null;
  status: string; place: string; travel: {to: string; etaMs: number; speed: string} | null; beat: string | null;
};
const placeName = (id: string) => PLACE_BY_ID.get(id)?.name ?? id;
const humanize = (s: string) => s.replace(/_/g, ' ');
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

function baseFrame(v: LiveMuse, now: number, participants: readonly LiveMuse[]): ActorFrame | null {
  const p = musePose(v, now, participants); if (!p) return null;
  const f: ActorFrame = {id: v.id, x: p.x, z: p.z, yaw: p.yaw, clip: 'idle_breathe', actionTime: now / 1000, upper: null, upperTime: 0, carry: null, card: null, seated: false, moving: p.moving,
    cue: null, line: null, effects: [], visual: 'complete', fallback: null, status: `At ${placeName(v.place)}`, place: v.place, travel: null, beat: null};
  if (v.travel) {
    const eta = Math.max(0, Math.round(v.travel.arriveAt - now));
    f.travel = {to: v.travel.to, etaMs: eta, speed: v.travel.speed};
    f.status = `${v.travel.speed === 'bus' ? 'Riding the bus' : v.travel.speed === 'taxi' ? 'Teleporting' : 'Walking'} to ${placeName(v.travel.to)} · ETA ${Math.floor(eta / 60000)}:${String(Math.floor(eta / 1000) % 60).padStart(2, '0')}`;
    if (p.moving && v.travel.speed === 'bus') { f.clip = 'bus_sway'; f.actionTime = now / 1000; f.visual = 'fallback'; f.fallback = 'no bus model: the Muse rides along the line with bus_sway'; }
    else if (p.moving) { const s = strideOf('walk')!; f.clip = 'walk'; f.actionTime = p.travelled / s.meters * s.seconds; }
    return f;
  }
  if (v.beat) {
    const total = Math.max(1, (v.beat.endsAt - v.beat.startedAt) / 1000), t = Math.max(0, (now - v.beat.startedAt) / 1000);
    const seg = segmentAt(beatSegments(v.beat.id, v.beat.clip, total), t);
    f.clip = seg.clip; f.upper = seg.upper; f.actionTime = t - seg.start; f.upperTime = t - seg.start; f.seated = SIT.has(seg.clip) || seg.upper !== null;
    f.beat = v.beat.id; f.status = `${humanize(v.beat.id)} at ${placeName(v.place)}`;
    if (seg.upper) f.carry = ACTION_CLIPS[seg.upper]?.prop ? seg.upper : null;
    if (v.beat.line && now - v.beat.startedAt < 10_000) f.line = v.beat.line;
  }
  if (v.paused) f.status += ' · paused (delegation revoked)';
  return f;
}

/** The whole live scene at `now`: one frame per Muse in the snapshot, cues applied where both participants are present. */
export function liveFrames(world: LiveWorld, cues: readonly Cue[], now: number): Map<string, ActorFrame> {
  const frames = new Map<string, ActorFrame>();
  for (const v of world.muses) { const f = baseFrame(v, now, world.muses); if (f) frames.set(v.id, f); }
  const homes = new Map([...frames].map(([id, f]) => [id, {x: f.x, z: f.z, yaw: f.yaw}]));
  const active = cues.filter(c => c.start <= now && now < c.end);
  for (const c of active) {
    const f = frames.get(c.muse); if (!f || f.travel) continue; // a travelling Muse plays no cue; the feed still shows the event
    const partner = c.partner ? frames.get(c.partner) : undefined;
    const together = !!partner && !partner.travel && partner.place === f.place;
    const local = (now - c.start) / 1000;
    f.cue = {eventId: c.eventId, kind: c.kind, phase: c.phase, partner: c.partner};
    const projected = EVENT_PROJECTION[c.kind];
    f.visual = projected?.visual ?? 'complete'; f.fallback = f.visual === 'fallback' ? projected.note : null;
    let clip = c.clip;
    let contactSpot: {x: number; z: number} | null = null, occupied = false;
    if (c.contact && together && c.partner) {
      const leader = c.muse < c.partner ? c.muse : c.partner, follower = leader === c.muse ? c.partner : c.muse;
      const a = homes.get(leader)!, b = homes.get(follower)!, tx = Math.cos(b.yaw), tz = -Math.sin(b.yaw);
      const side = (a.x - b.x) * tx + (a.z - b.z) * tz >= 0 ? 1 : -1;
      contactSpot = {x: b.x + tx * side * PARTNER_DISTANCE, z: b.z + tz * side * PARTNER_DISTANCE};
      occupied = [...homes].some(([id, p]) => id !== leader && id !== follower && Math.hypot(p.x - contactSpot!.x, p.z - contactSpot!.z) < .7);
      if (occupied) {clip = 'wave'; f.visual = 'fallback'; f.fallback = 'The contact slot is occupied by another Muse: shown as a wave.';}
    }
    if ((c.contact || c.face) && c.partner && !together) {
      if (c.contact) { clip = 'wave'; f.visual = 'fallback'; f.fallback = `${museName(c.partner, world)} is not here: ${c.clip} is shown as wave`; }
    }
    if (f.seated && UPPER_CLIPS.has(clip)) { f.clip = 'sit_idle'; f.upper = clip; f.actionTime = now / 1000; f.upperTime = local; }
    else {
      if (f.seated) { f.visual = 'fallback'; f.fallback = `stands for ${clip} (no stand_up transition while a cue interrupts a seated beat)`; }
      f.clip = clip; f.upper = null; f.actionTime = local; f.upperTime = 0; f.seated = false;
    }
    f.line = c.line ?? null;
    // Props: the giver holds the item until the clip's contact frame, the receiver after it; any other holder keeps it.
    const holds = c.handoff === 'give' ? (c.contactAt === null || now < c.contactAt) : c.handoff === 'receive' ? (c.contactAt !== null && now >= c.contactAt) : !!c.item;
    const pickUp = c.clip === 'pick_up' ? local >= CLIP_INFO.pick_up.seconds / 2 : true;
    f.carry = null; f.card = null;
    if (c.item && holds && pickUp) { if (c.prop) f.carry = c.prop; else f.card = itemName(c.item); }
    if (c.item && !c.prop && f.visual === 'complete') { f.visual = 'fallback'; f.fallback = `no 3D prop for ${itemName(c.item)}: shown as an item card`; }
    if (c.effect) f.effects.push({kind: c.effect, progress: Math.min(1, local / ((c.end - c.start) / 1000))});
    if (c.kind === 'discover' && c.effect === 'stamp') f.effects.push({kind: 'item', progress: Math.min(1, local / ((c.end - c.start) / 1000))});
    // Facing and contact distance: the partner stays on its slot, this Muse steps beside it (tangent to the partner's
    // facing, on the side it came from) at PARTNER_DISTANCE and both turn to each other. Eased in and out.
    if (together && partner && (c.face || c.contact)) {
      const me = homes.get(c.muse)!;
      if (c.contact && !occupied && contactSpot) {
        const leader = c.muse < c.partner!; // one of the two moves: the one with the smaller id steps beside the other
        if (leader) {
          const w = smooth(Math.min((now - c.start) / PAIR_EASE_MS, (c.end - now) / PAIR_EASE_MS));
          const tgt = contactSpot;
          f.x = me.x + (tgt.x - me.x) * w; f.z = me.z + (tgt.z - me.z) * w;
        }
      }
    }
  }
  // Turn the pairs to each other once every position is known (the stepping Muse may have moved).
  for (const c of active) {
    const f = frames.get(c.muse), q = c.partner ? frames.get(c.partner) : undefined;
    if (!f || !q || f.travel || q.travel || q.place !== f.place || !(c.face || c.contact) || f.cue?.eventId !== c.eventId) continue;
    f.yaw = Math.atan2(q.x - f.x, q.z - f.z);
  }
  return frames;
}

/** Projection table rows for the docs (docs/LIVE_SCENE.md) and the doc check in live-scene.test.mjs. */
export function projectionRows() {
  return Object.entries(EVENT_PROJECTION).map(([kind, p]) => {
    const clips = p.phases.map(ph => `${ph.muse.clip}${ph.other ? ' / ' + ph.other.clip : ''}`).join(' → ');
    const props = [...new Set(p.phases.flatMap(ph => [ph.muse.item, ph.other?.item]).filter(Boolean))].join(', ') || '—';
    const fx = [...new Set(p.phases.flatMap(ph => [ph.muse.effect, ph.other?.effect]).filter(Boolean))].join(', ') || '—';
    return `| ${kind} | ${clips} | ${props} | ${fx} | ${p.visual} | ${p.note} |`;
  });
}

/** A single received server snapshot owns actors, labels and map pins. Older in-flight replies cannot rewind it.
 * It only computes a projection: no command executor, reward code or transport is accepted here. */
export function acceptsSnapshot(current: LiveWorld | null, next: LiveWorld): boolean {
  if (!current || current.worldId !== next.worldId) return true;
  if (current.day !== next.day) return next.day > current.day;
  return (next.version ?? next.tick) >= (current.version ?? current.tick) && next.lastTickAt >= current.lastTickAt;
}
export class LiveProjection {
  world: LiveWorld | null = null;
  events: LiveEvent[] = [];
  private cues: Cue[] = [];
  accept(world: LiveWorld, events: readonly LiveEvent[]): boolean {
    if (!acceptsSnapshot(this.world, world)) return false;
    this.world = structuredClone(world);
    this.events = structuredClone([...new Map(events.filter(e => e.tick === undefined || e.tick <= world.tick).map(e => [e.id, e])).values()]);
    this.cues = scheduleCues(this.events);
    return true;
  }
  frames(at: number) { return this.world ? liveFrames(this.world, this.cues, at) : new Map<string, ActorFrame>(); }
}
