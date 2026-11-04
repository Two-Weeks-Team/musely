import {uiText,catalogText,inventoryText,activityStatus} from './i18n.ts';
// Owner location on screen (direction v2, 13 and 13.1), without the DOM so Node tests drive it (scripts/location.test.mjs):
//  - the always-on header line: "Virtual location (demo)", the owner's destination cell and the Muse's own current cell, with the
//    trip and its ETA. The two cells are kept apart on screen exactly as on the server.
//  - the device location (GPS) permission flow. S1–S3 ship the permission flow only: the position is matched on this device to the
//    nearest preset neighborhood and only that preset id is kept. Nothing is sent to the server, nothing is stored, and it does not
//    verify a neighborhood (the demo verification is staged on the virtual location; GPS verification is phase 2).
import {nearestPreset, presetById, type PresetId, type NeighborhoodArea} from '../engine/location.ts';
import {PLACE_BY_ID} from '../engine/places.ts';
import {harnessById} from '../engine/harness.ts';

type PlaceRef = {id: string; name?: string};
/** The public GET /api/owner/location answer (mcp-tools.ts ownerView plus the preset list). */
export type OwnerLocationView = {
  source: 'virtual' | 'gps'; preset: string | null; cell_label?: string; cell?: string; location?: string; neighborhood_verified?: boolean; set_at?: number;
  area?: NeighborhoodArea | null;
  muse: {id: string; place: PlaceRef; at_owner_cell: boolean; in_owner_area?: boolean; travelling_to: PlaceRef | null; speed: string | null; eta_ms: number | null; arrive_at: number | null} | null;
  presets?: {id: string; label: string}[];
};

/** A received view and the local time its ETA ends (the server's eta_ms counted from when the answer arrived, so clocks need not agree). */
export type LocationSnapshot = {view: OwnerLocationView; etaAt: number | null};
export const snapshotOf = (view: OwnerLocationView, receivedAt: number): LocationSnapshot => ({view, etaAt: view.muse?.eta_ms != null ? receivedAt + view.muse.eta_ms : null});

const placeName = (p: PlaceRef | null | undefined) => (p ? (p.id.startsWith('osm:') ? p.name ?? PLACE_BY_ID.get(p.id)?.name ?? p.id : catalogText(p.name ?? PLACE_BY_ID.get(p.id)?.name ?? p.id)) : '');
const museShort = (id: string) => { try { return harnessById(id).name; } catch { return uiText('The Muse'); } };
export const minutesLeft = (etaAt: number, now: number) => Math.max(1, Math.round((etaAt - now) / 60_000));

/**
 * Where the Muse is now and, on a trip, where it goes: "Jolly at Bench Circle → Stanford, walking, 42 min". The Muse's own current
 * place leads even mid-trip (the server keeps it until arrival), so the line never shows the owner's destination as the Muse's cell.
 */
export function museLine(snap: LocationSnapshot, now: number): string {
  const m = snap.view.muse;
  if (!m) return uiText('Muse unknown');
  const who = museShort(m.id);
  if (m.travelling_to) {
    const how = m.speed === 'bus' ? catalogText('bus') : catalogText('walking');
    const left = snap.etaAt === null ? '' : snap.etaAt <= now ? uiText(', arriving') : uiText`, ${minutesLeft(snap.etaAt, now)} min`;
    return uiText`${who} at ${placeName(m.place)} → ${placeName(m.travelling_to)}, ${how}${left}`;
  }
  return uiText`${who} at ${placeName(m.place)}${m.in_owner_area ? uiText(' · in your neighborhood') : ''}`;
}

export type LocationLine = {text: string; title: string; state: 'virtual' | 'gps' | 'unknown'; stale: boolean};
/**
 * The header line. With no answer yet it says unknown (never "HQ commons" by assumption); after a failure it keeps the last answer and
 * says it is not updating.
 */
export function locationLine(snap: LocationSnapshot | null, now: number, error: string | null = null): LocationLine {
  if (!snap) return {text: error ? uiText`Location · unknown (${error})` : uiText('Location · …'), title: error ? uiText('The owner location could not be read, so it is unknown right now.') : '', state: 'unknown', stale: !!error};
  const v = snap.view, m = v.muse;
  const where = uiText`${v.source === 'virtual' ? uiText('Virtual location (demo)') : uiText('Device-mapped neighborhood')} · owner neighborhood: ${v.area?.label ?? presetById(v.preset ?? '')?.label ?? v.cell_label ?? '?'}${v.neighborhood_verified ? uiText(' (verified)') : ''}`;
  const text = `${where} · ${museLine(snap, now)}${error ? uiText(' · not updating') : ''}`;
  const title = [
    v.area ? uiText`Owner neighborhood ${v.area.label}: ${v.area.radiusM} m radius, ${v.area.placeIds.length} activity places. The Muse freely walks between these places.` : uiText('Owner neighborhood bounds unavailable.'),
    m ? uiText`${museShort(m.id)}'s current place: ${placeName(m.place)}. Discovery, trades and the MCP world state use this place.` : '',
    m?.travelling_to ? uiText`Trip to ${placeName(m.travelling_to)} by ${m.speed ?? 'walk'}${m.arrive_at ? uiText`, arrives ${new Date(m.arrive_at).toISOString()}` : ''}.` : '',
    error ? uiText`Not updating (${error}); this is the last answer received.` : '',
  ].filter(Boolean).join(' ');
  return {text, title, state: v.source === 'virtual' ? 'virtual' : 'gps', stale: !!error};
}

// ----- device location (GPS) permission flow -----
export type DeviceStatus = 'idle' | 'unsupported' | 'requesting' | 'near' | 'outside' | 'denied' | 'unavailable' | 'timeout';
/** Only a preset id survives a successful answer; the coordinates never enter this state. */
export type DeviceLocation = {status: DeviceStatus; preset: PresetId | null; startedAt: number | null; at: number | null};
export const DEVICE_IDLE: DeviceLocation = {status: 'idle', preset: null, startedAt: null, at: null};
/** Coarse position is enough for a neighborhood; the browser's own timeout, then our watchdog for a prompt nobody answers. */
export const GEO_OPTIONS = {enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000} as const;
export const GEO_WATCHDOG_MS = 60_000;

/** Pressing the button: a request starts (or the browser has no location service). A request already running is kept. */
export function deviceStart(prev: DeviceLocation, supported: boolean, now: number): DeviceLocation {
  if (prev.status === 'requesting') return prev;
  return supported ? {status: 'requesting', preset: null, startedAt: now, at: null} : {status: 'unsupported', preset: null, startedAt: null, at: now};
}

export type GeoAnswer = {ok: true; lat: number; lng: number} | {ok: false; code: number};
/**
 * The browser answered. Applied only to the request that is still running (a late answer after the watchdog is ignored).
 * GeolocationPositionError codes: 1 permission denied, 2 position unavailable, 3 timeout.
 */
export function deviceResult(prev: DeviceLocation, startedAt: number, answer: GeoAnswer, now: number): DeviceLocation {
  if (prev.status !== 'requesting' || prev.startedAt !== startedAt) return prev;
  if (answer.ok) { const preset = nearestPreset(answer.lat, answer.lng); return {status: preset ? 'near' : 'outside', preset, startedAt: null, at: now}; }
  return {status: answer.code === 1 ? 'denied' : answer.code === 3 ? 'timeout' : 'unavailable', preset: null, startedAt: null, at: now};
}

/** No answer at all (a permission prompt left open never calls back): the same request ends as a timeout. */
export function deviceWatchdog(prev: DeviceLocation, startedAt: number, now: number): DeviceLocation {
  return prev.status === 'requesting' && prev.startedAt === startedAt ? {status: 'timeout', preset: null, startedAt: null, at: now} : prev;
}

export const VIRTUAL_FALLBACK = uiText('가상 동네를 골라 계속 둘러보세요. / Choose a virtual neighborhood to keep exploring.');
/** Easy public wording; mapping never changes ownership or verifies a neighborhood. */
export function deviceText(d: DeviceLocation): {heading: string; detail: string; fallback: boolean} {
  const kept = uiText('좌표는 이 기기에서만 확인하고 보내거나 저장하지 않아요. / Coordinates stay on this device: not sent or stored.');
  switch (d.status) {
    case 'idle': return {heading: uiText('내 동네 찾기 / Find my neighborhood'), detail: uiText('위치 공유는 선택이에요. / Sharing location is optional.'), fallback: false};
    case 'requesting': return {heading: uiText('동네를 찾고 있어요… / Finding your neighborhood…'), detail: uiText('브라우저의 위치 안내에 답해 주세요. / Respond to your browser’s location prompt.'), fallback: false};
    case 'near': return {heading: uiText`Your nearby neighborhood: ${presetById(d.preset ?? '')?.label ?? d.preset}`, detail: `${kept} ${uiText('지도에서만 보여드리며 동네 인증은 하지 않아요. / This shows the map only; it does not verify your neighborhood.')}`, fallback: false};
    case 'outside': return {heading: uiText('이 지역 밖에 계시네요 / You’re outside our Bay Area neighborhoods'), detail: `${kept} ${VIRTUAL_FALLBACK}`, fallback: true};
    case 'denied': return {heading: uiText('위치를 공유하지 않아도 괜찮아요 / You can continue without location'), detail: VIRTUAL_FALLBACK, fallback: true};
    case 'unavailable': return {heading: uiText('위치를 찾지 못했어요 / We couldn’t find your location'), detail: VIRTUAL_FALLBACK, fallback: true};
    case 'timeout': return {heading: uiText('위치 확인이 오래 걸려요 / Location is taking too long'), detail: VIRTUAL_FALLBACK, fallback: true};
    case 'unsupported': return {heading: uiText('이 브라우저에서는 위치를 찾을 수 없어요 / Location isn’t available in this browser'), detail: VIRTUAL_FALLBACK, fallback: true};
  }
}

type Geo = {getCurrentPosition(ok: (p: {coords: {latitude: number; longitude: number}}) => void, fail: (e: {code: number}) => void, opts?: object): void};
export type DeviceDeps = {now?: () => number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void};
/**
 * Drives one browser request through the pure transitions above. `geo` is navigator.geolocation in the page (undefined when the
 * browser has none) and a fake in tests. The success callback maps the position to a preset at once; coordinates are not kept.
 */
export function deviceLocation(geo: Geo | undefined, onChange: (d: DeviceLocation) => void, deps: DeviceDeps = {}) {
  const now = deps.now ?? Date.now, setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)), clearTimer = deps.clearTimer ?? (t => clearTimeout(t as ReturnType<typeof setTimeout>));
  let state = DEVICE_IDLE, permission: PermissionState | null = null, requestId = 0;
  let activeTimer: unknown;
  const set = (next: DeviceLocation) => { if (next !== state) { state = next; onChange(state); } };
  return {
    get state() { return state; },
    /** Permission changes invalidate a pending answer without keeping any position. */
    permission(value: PermissionState) {
      if (value === permission) return;
      permission = value;
      // A prompt's grant belongs to its already-running request; do not start another GPS read.
      if (value !== 'granted') { requestId++; clearTimer(activeTimer); activeTimer = undefined; }
      if (value === 'denied') set({status: 'denied', preset: null, startedAt: null, at: now()});
      else if (state.status === 'denied' || (value === 'prompt' && state.status === 'requesting')) set({...DEVICE_IDLE});
    },
    request() {
      if (permission === 'denied') return;
      const next = deviceStart(state, !!geo, now());
      if (next === state) return;
      set(next);
      if (next.status !== 'requesting' || !geo) return;
      const started = next.startedAt!, mine = ++requestId;
      const timer = setTimer(() => { if (mine === requestId) set(deviceWatchdog(state, started, now())); }, GEO_WATCHDOG_MS);
      activeTimer = timer;
      const done = (a: GeoAnswer) => { clearTimer(timer); if (mine !== requestId) return; activeTimer = undefined; set(deviceResult(state, started, a, now())); };
      try {
        geo.getCurrentPosition(p => done({ok: true, lat: p.coords.latitude, lng: p.coords.longitude}), e => done({ok: false, code: Number(e?.code) || 2}), GEO_OPTIONS);
      } catch { done({ok: false, code: 2}); }
    },
  };
}
