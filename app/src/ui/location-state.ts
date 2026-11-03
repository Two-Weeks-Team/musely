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

const placeName = (p: PlaceRef | null | undefined) => (p ? p.name ?? PLACE_BY_ID.get(p.id)?.name ?? p.id : '');
const museShort = (id: string) => { try { return harnessById(id).name; } catch { return 'The Muse'; } };
export const minutesLeft = (etaAt: number, now: number) => Math.max(1, Math.round((etaAt - now) / 60_000));

/**
 * Where the Muse is now and, on a trip, where it goes: "Jolly at Bench Circle → Stanford, walking, 42 min". The Muse's own current
 * place leads even mid-trip (the server keeps it until arrival), so the line never shows the owner's destination as the Muse's cell.
 */
export function museLine(snap: LocationSnapshot, now: number): string {
  const m = snap.view.muse;
  if (!m) return 'Muse unknown';
  const who = museShort(m.id);
  if (m.travelling_to) {
    const how = m.speed === 'bus' ? 'bus' : 'walking';
    const left = snap.etaAt === null ? '' : snap.etaAt <= now ? ', arriving' : `, ${minutesLeft(snap.etaAt, now)} min`;
    return `${who} at ${placeName(m.place)} → ${placeName(m.travelling_to)}, ${how}${left}`;
  }
  return `${who} at ${placeName(m.place)}${m.in_owner_area ? ' · in your neighborhood' : ''}`;
}

export type LocationLine = {text: string; title: string; state: 'virtual' | 'gps' | 'unknown'; stale: boolean};
/**
 * The header line. With no answer yet it says unknown (never "HQ commons" by assumption); after a failure it keeps the last answer and
 * says it is not updating.
 */
export function locationLine(snap: LocationSnapshot | null, now: number, error: string | null = null): LocationLine {
  if (!snap) return {text: error ? `Location · unknown (${error})` : 'Location · …', title: error ? 'The owner location could not be read, so it is unknown right now.' : '', state: 'unknown', stale: !!error};
  const v = snap.view, m = v.muse;
  const where = `${v.source === 'virtual' ? 'Virtual location (demo)' : 'Device-mapped neighborhood'} · owner neighborhood: ${v.area?.label ?? presetById(v.preset ?? '')?.label ?? v.cell_label ?? '?'}${v.neighborhood_verified ? ' (verified)' : ''}`;
  const text = `${where} · ${museLine(snap, now)}${error ? ' · not updating' : ''}`;
  const title = [
    v.area ? `Owner neighborhood ${v.area.label}: ${v.area.radiusM} m radius, ${v.area.placeIds.length} activity places. The Muse freely walks between these places.` : 'Owner neighborhood bounds unavailable.',
    m ? `${museShort(m.id)}'s current place: ${placeName(m.place)}. Discovery, trades and the MCP world state use this place.` : '',
    m?.travelling_to ? `Trip to ${placeName(m.travelling_to)} by ${m.speed ?? 'walk'}${m.arrive_at ? `, arrives ${new Date(m.arrive_at).toISOString()}` : ''}.` : '',
    error ? `Not updating (${error}); this is the last answer received.` : '',
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

export const VIRTUAL_FALLBACK = 'You can keep using the virtual location (demo): the Muse, its trips, discovery and trades work the same.';
/** One heading and one detail per state; `fallback` marks the states that show the virtual-location guidance. */
export function deviceText(d: DeviceLocation): {heading: string; detail: string; fallback: boolean} {
  const kept = 'The coordinates were matched on this device and dropped: not sent, not stored.';
  switch (d.status) {
    case 'idle': return {heading: 'Device location (optional)', detail: 'Your browser asks for permission. The position is matched to the nearest neighborhood area on this device only; the coordinates are not sent or stored.', fallback: false};
    case 'requesting': return {heading: 'Asking your browser for the device location…', detail: 'Answer the browser prompt. Nothing changes in the world while this runs.', fallback: false};
    case 'near': return {heading: `Your device is near the ${presetById(d.preset ?? '')?.label ?? d.preset} neighborhood`, detail: `${kept} Shown on this device only: choose this neighborhood in the selector to use it. Neighborhood verification is staged for virtual locations; GPS verification is phase 2.`, fallback: false};
    case 'outside': return {heading: 'Your device is outside the Bay Area presets', detail: `${kept} ${VIRTUAL_FALLBACK}`, fallback: true};
    case 'denied': return {heading: 'Location permission was denied', detail: `${VIRTUAL_FALLBACK} You can allow it later in the browser's site settings.`, fallback: true};
    case 'unavailable': return {heading: 'The device location is unavailable', detail: VIRTUAL_FALLBACK, fallback: true};
    case 'timeout': return {heading: 'The device location did not answer in time', detail: `${VIRTUAL_FALLBACK} You can try again.`, fallback: true};
    case 'unsupported': return {heading: 'This browser has no location service', detail: VIRTUAL_FALLBACK, fallback: true};
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
  let state = DEVICE_IDLE;
  const set = (next: DeviceLocation) => { if (next !== state) { state = next; onChange(state); } };
  return {
    get state() { return state; },
    request() {
      const next = deviceStart(state, !!geo, now());
      if (next === state) return;
      set(next);
      if (next.status !== 'requesting' || !geo) return;
      const started = next.startedAt!;
      const timer = setTimer(() => set(deviceWatchdog(state, started, now())), GEO_WATCHDOG_MS);
      const done = (a: GeoAnswer) => { clearTimer(timer); set(deviceResult(state, started, a, now())); };
      try {
        geo.getCurrentPosition(p => done({ok: true, lat: p.coords.latitude, lng: p.coords.longitude}), e => done({ok: false, code: Number(e?.code) || 2}), GEO_OPTIONS);
      } catch { done({ok: false, code: 2}); }
    },
  };
}
