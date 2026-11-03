// Owner neighborhood areas (2026-11-03 directive, superseding direction v2's point/cell wording).
// Owner condition: area id and staged verification. Muse fact: current catalog place, changed only by travel.
// The coarse cell remains a compatibility/discovery grid; it never bounds owner roaming.
// Device coordinates are mapped only in the browser. The server accepts catalog area ids, not coordinates.
import {PLACES, PLACE_BY_ID, placeById, distanceM, type Place} from './places.ts';

/** Grid size in degrees. Cells are centred on multiples of 0.01° (≈1.1 km × 0.9 km here). */
export const CELL_DEG = 0.01;
/** The owner's Muse slot (world.ts re-exports it). Neighborhood verification, and so the teleport ability, belong to this Muse only. */
export const OWNER_MUSE = '00-jolly';
export const VIRTUAL_LABEL = 'virtual (demo)';

export const PRESETS = [
  {id: 'hq', label: 'HQ commons', place: 'commons:hq'},
  {id: 'stanford', label: 'Stanford', place: 'bay:stanford'},
  {id: 'san-francisco', label: 'San Francisco', place: 'bay:sf'},
  {id: 'oakland', label: 'Oakland', place: 'bay:oakland'},
  {id: 'san-mateo', label: 'San Mateo', place: 'bay:san-mateo'},
  {id: 'mountain-view', label: 'Mountain View', place: 'bay:mountain-view'},
  {id: 'redwood-city', label: 'Redwood City', place: 'bay:redwood-city'},
  {id: 'san-jose', label: 'San Jose', place: 'bay:san-jose'},
] as const;
export type PresetId = (typeof PRESETS)[number]['id'];
export const PRESET_IDS: readonly string[] = PRESETS.map(p => p.id);
export const presetById = (id: string) => PRESETS.find(p => p.id === id) ?? null;

/** Staged neighborhood bounds, not municipal borders or an owner's precise location. */
export type NeighborhoodArea = {id: PresetId; label: string; center: {lng: number; lat: number}; radiusM: number; placeIds: readonly string[]};
export const NEIGHBORHOOD_AREAS: readonly NeighborhoodArea[] = PRESETS.map(p => {
  const center = placeById(p.place), radiusM = 1500;
  return {id: p.id, label: p.label, center: {lng: center.lng, lat: center.lat}, radiusM,
    placeIds: PLACES.filter(x => distanceM(center, x) <= radiusM).map(x => x.id)};
});
export const areaById = (id: string) => NEIGHBORHOOD_AREAS.find(a => a.id === id) ?? null;
export const areaContains = (area: NeighborhoodArea | null, place: Place | string) => !!area?.placeIds.includes(typeof place === 'string' ? place : place.id);
export const sameArea = (from: Place, to: Place) => NEIGHBORHOOD_AREAS.some(a => areaContains(a, from) && areaContains(a, to));
/** Old stored virtual locations resolve through their preset without rewriting history. */
export const ownerArea = (o: OwnerLocation | undefined) => o ? areaById(o.preset ?? o.area ?? '') ?? NEIGHBORHOOD_AREAS.find(a => a.placeIds.includes(o.target)) ?? null : null;
export const areaVerified = (o: OwnerLocation | undefined) => !!o?.verified && o.area === ownerArea(o)?.id;
export const areaView = (area: NeighborhoodArea | null) => area ? {...area, placeIds: [...area.placeIds]} : null;

export type OwnerLocation = {
  source: 'virtual' | 'gps';
  /** Local-mapped area preset id for either source; older GPS states can have null. */
  preset: PresetId | null;
  /** Neighborhood identity. Optional only for pre-area stored states. */
  area?: PresetId;
  /** Coarse cell id "<lat*100>:<lng*100>" (rounded). Never a precise coordinate. */
  cell: string;
  /** Area entry place used when following from outside, never a stop/roaming constraint. */
  target: string;
  /** Staged virtual verification, valid only with the matching explicit area stamp. */
  verified: boolean;
  setAt: number;
  /** The Muse that follows this owner (the owner slot). */
  muse: string;
};

export function cellOf(lat: number, lng: number): string {
  return `${Math.round(lat / CELL_DEG)}:${Math.round(lng / CELL_DEG)}`;
}
export const placeCell = (place: Place | string) => { const p = typeof place === 'string' ? placeById(place) : place; return cellOf(p.lat, p.lng); };
const cellCentre = (cell: string) => { const [a, b] = cell.split(':').map(Number); return {lat: a * CELL_DEG, lng: b * CELL_DEG}; };

/** The place nearest to a cell centre (used for GPS cells; phase 2). */
export function nearestPlace(cell: string): Place {
  const c = cellCentre(cell);
  let best = PLACES[0], bestD = Infinity;
  for (const p of PLACES) { const d = Math.hypot(p.lat - c.lat, (p.lng - c.lng) * Math.cos(c.lat * Math.PI / 180)); if (d < bestD) { best = p; bestD = d; } }
  return best;
}

export function defaultOwner(muse: string, now: number): OwnerLocation {
  const p = PRESETS[0];
  return {source: 'virtual', preset: p.id, area: p.id, cell: placeCell(p.place), target: p.place, verified: false, setAt: now, muse};
}

/** Public label for a cell: the preset name for virtual sources; GPS cells are not described further. */
export function ownerLabel(o: OwnerLocation) {
  return ownerArea(o)?.label ?? 'Neighborhood unknown';
}

export type LocationInput = {source: 'virtual'; preset: string; verify?: boolean} | {source: 'gps'; preset: string};
export type LocationResult = {ok: true; owner: OwnerLocation} | {ok: false; reason: string};

/** Validates a local-mapped area id. Raw coordinates and unknown fields are refused before any state commit. */
export function nextOwnerLocation(prev: OwnerLocation, input: unknown, now: number): LocationResult {
  if (!input || typeof input !== 'object') return {ok: false, reason: 'body must be an object'};
  const i = input as Record<string, unknown>;
  if (Object.keys(i).some(k => !['source', 'preset', 'verify'].includes(k))) return {ok: false, reason: 'send only a neighborhood preset id; coordinates are not accepted'};
  if (i.source === 'virtual' || i.source === 'gps') {
    const p = typeof i.preset === 'string' ? presetById(i.preset) : null;
    if (!p) return {ok: false, reason: 'preset must be one of ' + PRESET_IDS.join('|')};
    if (i.verify !== undefined && typeof i.verify !== 'boolean') return {ok: false, reason: 'verify must be a boolean'};
    if (i.source === 'gps' && i.verify !== undefined) return {ok: false, reason: 'GPS neighborhood verification is phase 2'};
    const cell = placeCell(p.place);
    // Old cell-only verification cannot silently authorize the expanded neighborhood.
    const verified = i.source === 'virtual' && (i.verify === true || (i.verify === undefined && prev.source === 'virtual' && ownerArea(prev)?.id === p.id && areaVerified(prev)));
    return {ok: true, owner: {source: i.source, preset: p.id, area: p.id, cell, target: p.place, verified, setAt: now, muse: prev.muse}};
  }
  return {ok: false, reason: "source must be 'virtual' or 'gps'"};
}

/** Adds data.location while the owner location is virtual, on events about the owner's Muse. */
export function tagLocation<E extends {muse: string | null; other?: string | null; data?: Record<string, unknown>}>(owner: OwnerLocation | undefined, e: E): E {
  if (!owner || owner.source !== 'virtual' || (e.muse !== owner.muse && e.other !== owner.muse)) return e;
  return {...e, data: {...(e.data ?? {}), location: VIRTUAL_LABEL}};
}

/**
 * Teleport rule (13, 13.1): the Muse is the owner's Muse, the destination is in the owner's cell, that cell is verified,
 * and a Taxi Token is held. Neighborhood verification belongs to an owner location, so a resident (no owner) or any Muse
 * other than the owner's is never verified.
 */
export function teleportCheck(owner: OwnerLocation | undefined, muse: {id: string; inventory: readonly string[]; place?: string}, to: Place): string | null {
  if (!owner || owner.muse !== muse.id || !areaVerified(owner) || owner.source !== 'virtual') return 'neighborhood_not_verified';
  if (!areaContains(ownerArea(owner), to)) return 'not_in_owner_cell'; // Legacy refusal code; the criterion is now the area.
  if (muse.place && sameArea(placeById(muse.place), to)) return 'within_neighborhood_walk';
  if (!muse.inventory.includes('taxi_token')) return 'no_taxi_token';
  return null;
}

/**
 * Device location → preset neighborhood (13.1 "real GPS", S1–S3: the permission flow only). The browser maps the device position to
 * the nearest preset within NEIGHBORHOOD_KM and keeps only the preset id: the coordinates are neither returned, sent nor stored.
 * Outside every preset's radius (for example the team in Korea) the answer is null and the virtual location stays in use.
 */
export const NEIGHBORHOOD_KM = 15;
export function nearestPreset(lat: number, lng: number): PresetId | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  let best: PresetId | null = null, bestKm = Infinity;
  for (const p of PRESETS) {
    const km = haversineKm(lat, lng, placeById(p.place).lat, placeById(p.place).lng);
    if (km < bestKm) { best = p.id; bestKm = km; }
  }
  return bestKm <= NEIGHBORHOOD_KM ? best : null;
}
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Resolves a move target: a catalog place id or a preset id. */
export function resolvePlace(ref: string): Place | null {
  return PLACE_BY_ID.get(ref) ?? (presetById(ref) ? placeById(presetById(ref)!.place) : null);
}

export const nearbyPlaces = (from: Place, n = 8) => PLACES.filter(p => p.id !== from.id).map(p => ({p, d: distanceM(from, p)})).sort((a, b) => a.d - b.d).slice(0, n);
