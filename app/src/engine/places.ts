// World places (direction v2, 11): the HQ commons spots (near 3D), real POIs within 1.5 km
// (OpenStreetMap, ODbL) where items are discovered, and Bay activity places on the far map.
import poi from '../../assets/poi-commons.json' with {type: 'json'};
import geography from '../../assets/geography.json' with {type: 'json'};

export type PlaceKind = 'cafe' | 'campfire' | 'garden' | 'benches' | 'bookshelf' | 'workbench' | 'music_corner' | 'restaurant' | 'fast_food' | 'convenience' | 'bus_stop' | 'park' | 'library' | 'playground' | 'ice_cream' | 'landmark' | 'region';
export type Place = {
  id: string; name: string; kind: PlaceKind; zone: 'commons' | 'neighborhood' | 'bay';
  lng: number; lat: number;
  /** Local metres from the commons anchor (+x east, +z south) for walking distances. */
  x: number; z: number;
  region?: string; activity?: string; relic?: string;
};

const [ANCHOR_LNG, ANCHOR_LAT] = geography.commons as [number, number];
const M_PER_DEG_LAT = 111_320, M_PER_DEG_LNG = 111_320 * Math.cos(ANCHOR_LAT * Math.PI / 180);
export const toLocal = (lng: number, lat: number) => ({x: (lng - ANCHOR_LNG) * M_PER_DEG_LNG, z: -(lat - ANCHOR_LAT) * M_PER_DEG_LAT});
const fromLocal = (x: number, z: number) => ({lng: ANCHOR_LNG + x / M_PER_DEG_LNG, lat: ANCHOR_LAT - z / M_PER_DEG_LAT});

// Commons spots match the authored scene (scene.ts local coordinates, rotated to the road grid there).
const COMMONS: [string, string, PlaceKind, number, number][] = [
  ['commons:cafe', 'Commons Cafe', 'cafe', -3.8, -3.6],
  ['commons:campfire', 'The Campfire', 'campfire', 0, 2],
  ['commons:garden', 'The Garden', 'garden', 9, -4],
  ['commons:benches', 'Bench Circle', 'benches', 0, 4.2],
  ['commons:bookshelf', 'Book & Music Corner', 'bookshelf', -8.5, 5],
  ['commons:workbench', 'Workbench', 'workbench', 6, 6],
  ['commons:hq', 'HQ Landmark Park', 'landmark', 4, -9],
];

const REGIONS: [string, string, number, number, string, string][] = [
  ['bay:sf', 'San Francisco', -122.4194, 37.7749, 'bookshop exploring', 'sf_bookmark'],
  ['bay:oakland', 'Oakland', -122.2712, 37.8044, 'music', 'oakland_vinyl'],
  ['bay:san-mateo', 'San Mateo', -122.3255, 37.5630, 'walks and coffee', 'san_mateo_bean'],
  ['bay:mountain-view', 'Mountain View', -122.0839, 37.3861, 'music together', 'mountain_view_circuit_leaf'],
  ['bay:redwood-city', 'Redwood City', -122.2364, 37.4852, 'story circles', 'redwood_pinecone'],
  ['bay:stanford', 'Stanford', -122.1697, 37.4275, 'reading', 'stanford_tassel'],
  ['bay:san-jose', 'San Jose', -121.8863, 37.3382, 'new trails', 'san_jose_trail_badge'],
];

export const PLACES: Place[] = [
  ...COMMONS.map(([id, name, kind, x, z]) => ({id, name, kind, zone: 'commons' as const, ...fromLocal(x, z), x, z, ...(id === 'commons:hq' ? {relic: 'commons_ember'} : {})})),
  ...(poi.places as {id: string; name: string; kind: string; lng: number; lat: number}[]).map(p => ({id: p.id, name: p.name, kind: p.kind as PlaceKind, zone: 'neighborhood' as const, lng: p.lng, lat: p.lat, ...toLocal(p.lng, p.lat)})),
  ...REGIONS.map(([id, name, lng, lat, activity, relic]) => ({id, name, kind: 'region' as const, zone: 'bay' as const, lng, lat, ...toLocal(lng, lat), region: name, activity, relic})),
];
export const PLACE_BY_ID = new Map(PLACES.map(p => [p.id, p]));
export const placeById = (id: string) => { const p = PLACE_BY_ID.get(id); if (!p) throw new Error('Unknown place ' + id); return p; };
export const distanceM = (a: Place, b: Place) => Math.hypot(a.x - b.x, a.z - b.z);
export const POI_LICENSE = poi.license;

export const WALK_MPS = 1.3;
