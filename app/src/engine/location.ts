// Owner location source and the Muse's current cell (direction v2, 13 and 13.1).
// - The owner location cell is where the owner "is" (virtual preset in the demo, GPS in phase 2). It is the
//   follow target and the base of neighborhood verification. Only a coarse cell is ever stored (PRD NFR-2).
// - The Muse's current place is MuseState.place. It changes only by trips (walk / Transit Pass bus) or a
//   verified teleport (neighborhood verified for the owner cell + a Taxi Token, which is spent).
// - Discovery, trade distance and get_world_state use the Muse's place, never the owner cell.
import {PLACES, PLACE_BY_ID, placeById, distanceM, type Place} from './places.ts';

/** Grid size in degrees. Cells are centred on multiples of 0.01° (≈1.1 km × 0.9 km here). */
export const CELL_DEG = 0.01;
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

export type OwnerLocation = {
  source: 'virtual' | 'gps';
  /** Preset id for a virtual source; null for GPS. */
  preset: PresetId | null;
  /** Coarse cell id "<lat*100>:<lng*100>" (rounded). Never a precise coordinate. */
  cell: string;
  /** Place the owner's Muse walks to when following (a preset's place, or the place nearest the GPS cell). */
  target: string;
  /** Demo neighborhood verification for this cell (staged in the demo, direction 13.1). Reset when the cell changes. */
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
  return {source: 'virtual', preset: p.id, cell: placeCell(p.place), target: p.place, verified: false, setAt: now, muse};
}

/** Public label for a cell: the preset name for virtual sources; GPS cells are not described further. */
export function ownerLabel(o: OwnerLocation) {
  if (o.source === 'virtual') return presetById(o.preset ?? 'hq')?.label ?? 'HQ commons';
  return 'GPS cell (phase 2)';
}

export type LocationInput = {source: 'virtual'; preset: string; verify?: boolean} | {source: 'gps'; lat: number; lng: number};
export type LocationResult = {ok: true; owner: OwnerLocation} | {ok: false; reason: string};

/** Validates a location request and returns the next owner location (pure). GPS coordinates are dropped after the cell is computed. */
export function nextOwnerLocation(prev: OwnerLocation, input: unknown, now: number): LocationResult {
  if (!input || typeof input !== 'object') return {ok: false, reason: 'body must be an object'};
  const i = input as Record<string, unknown>;
  if (i.source === 'virtual') {
    const p = typeof i.preset === 'string' ? presetById(i.preset) : null;
    if (!p) return {ok: false, reason: 'preset must be one of ' + PRESET_IDS.join('|')};
    if (i.verify !== undefined && typeof i.verify !== 'boolean') return {ok: false, reason: 'verify must be a boolean'};
    const cell = placeCell(p.place);
    // Verification belongs to a cell: moving to another cell clears it unless this request verifies again.
    const verified = i.verify === true || (i.verify === undefined && prev.cell === cell && prev.verified);
    return {ok: true, owner: {source: 'virtual', preset: p.id, cell, target: p.place, verified, setAt: now, muse: prev.muse}};
  }
  if (i.source === 'gps') {
    const lat = i.lat, lng = i.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return {ok: false, reason: 'lat and lng must be numbers'};
    if (i.verify !== undefined) return {ok: false, reason: 'GPS neighborhood verification is phase 2'};
    const cell = cellOf(lat, lng);
    return {ok: true, owner: {source: 'gps', preset: null, cell, target: nearestPlace(cell).id, verified: false, setAt: now, muse: prev.muse}};
  }
  return {ok: false, reason: "source must be 'virtual' or 'gps'"};
}

/** Adds data.location while the owner location is virtual, on events about the owner's Muse. */
export function tagLocation<E extends {muse: string | null; other?: string | null; data?: Record<string, unknown>}>(owner: OwnerLocation | undefined, e: E): E {
  if (!owner || owner.source !== 'virtual' || (e.muse !== owner.muse && e.other !== owner.muse)) return e;
  return {...e, data: {...(e.data ?? {}), location: VIRTUAL_LABEL}};
}

/** Teleport rule (13, 13.1): the destination is in the owner's cell, that cell is verified, and a Taxi Token is held. */
export function teleportCheck(owner: OwnerLocation | undefined, inventory: readonly string[], to: Place): string | null {
  if (!owner || !owner.verified || owner.source !== 'virtual') return 'neighborhood_not_verified';
  if (placeCell(to) !== owner.cell) return 'not_in_owner_cell';
  if (!inventory.includes('taxi_token')) return 'no_taxi_token';
  return null;
}

/** Resolves a move target: a catalog place id or a preset id. */
export function resolvePlace(ref: string): Place | null {
  return PLACE_BY_ID.get(ref) ?? (presetById(ref) ? placeById(presetById(ref)!.place) : null);
}

export const nearbyPlaces = (from: Place, n = 8) => PLACES.filter(p => p.id !== from.id).map(p => ({p, d: distanceM(from, p)})).sort((a, b) => a.d - b.d).slice(0, n);
