// Decorative roof details derived only from the native vector features supplied
// by the current MapLibre map. No building replacement or ground-level props.
import * as maplibre from 'maplibre-gl';
import {centerLngLat, radiusCheck} from './region.mjs';

export const ROOF_POLICY = Object.freeze({
  source: 'openmaptiles', sourceLayer: 'building', sourceZoom: 14,
  tileTemplate: 'https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf',
  minZoom: 17, maxBuildings: 180, commonsReserveM: 40,
  tileReserveM: 2, roofGapM: 0.16, insetM: 0.4,
});
const origin = maplibre.MercatorCoordinate.fromLngLat(centerLngLat);
const unit = origin.meterInMercatorCoordinateUnits();
export function roofLocal([lng, lat]) {
  const p = maplibre.MercatorCoordinate.fromLngLat([lng, lat]);
  return [(p.x - origin.x) / unit, (p.y - origin.y) / unit];
}
export function roofGeo([x, y]) {
  const p = new maplibre.MercatorCoordinate(origin.x + x * unit, origin.y + y * unit).toLngLat();
  return [p.lng, p.lat];
}
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const area = p => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const close = p => [...p, p[0]];
const bounds = p => [Math.min(...p.map(p => p[0])), Math.min(...p.map(p => p[1])), Math.max(...p.map(p => p[0])), Math.max(...p.map(p => p[1]))];
const boxOverlap = (a, b, pad = 0) => a[0] <= b[2] + pad && b[0] <= a[2] + pad && a[1] <= b[3] + pad && b[1] <= a[3] + pad;
const ringKey = ring => {
  const keys = ring.map(p => JSON.stringify(p));
  const rotations = [keys, [...keys].reverse()].map(a => { const i = a.indexOf([...a].sort()[0]); return [...a.slice(i), ...a.slice(0,i)].join('|'); });
  return rotations.sort()[0];
};
function validCoordinate(p) { return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) < 85; }
function localRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 512 || !ring.every(validCoordinate)) return null;
  if (distance(ring[0], ring.at(-1)) > 1e-12) return null;
  return ring.slice(0, -1).map(roofLocal);
}
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function segmentDistance(p, a, b) {
  const d = distance(a, b) ** 2;
  if (!d) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / d));
  return distance(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
}
function segmentCross(a, b, c, d) {
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0 && boxOverlap(bounds([a, b]), bounds([c, d]));
}
function ringsNear(a, b, reserve = 0.15) {
  if (!boxOverlap(bounds(a), bounds(b), reserve)) return false;
  if (pointInRing(a[0], b) || pointInRing(b[0], a)) return true;
  return a.some((p, i) => b.some((q, j) => {
    const pn = a[(i + 1) % a.length], qn = b[(j + 1) % b.length];
    return segmentCross(p, pn, q, qn) || segmentDistance(p, q, qn) < reserve || segmentDistance(q, p, pn) < reserve;
  }));
}
export function insetConvex(ring, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const p = area(ring) < 0 ? [...ring].reverse() : ring;
  if (p.length < 3 || p.some((a, i) => cross(a, p[(i + 1) % p.length], p[(i + 2) % p.length]) <= 1e-6)) return null;
  const lines = p.map((a, i) => {
    const b = p[(i + 1) % p.length], len = distance(a, b);
    return { a: [a[0] - (b[1] - a[1]) / len * amount, a[1] + (b[0] - a[0]) / len * amount], d: [b[0] - a[0], b[1] - a[1]] };
  });
  const result = lines.map((l, i) => {
    const prev = lines[(i + lines.length - 1) % lines.length];
    const den = l.d[0] * prev.d[1] - l.d[1] * prev.d[0];
    const q = [prev.a[0] - l.a[0], prev.a[1] - l.a[1]];
    const t = (q[0] * prev.d[1] - q[1] * prev.d[0]) / den;
    return [l.a[0] + l.d[0] * t, l.a[1] + l.d[1] * t];
  });
  // Half-plane check also rejects collapsed/inverted offsets on narrow roofs.
  if (result.some(q => q.some(v => !Number.isFinite(v)) || p.some((a, i) => cross(a, p[(i + 1) % p.length], q) / distance(a, p[(i + 1) % p.length]) < amount - 1e-5))) return null;
  if (area(result) < 8) return null;
  return result;
}
function tileInterior(ring, tile) {
  if (!tile || tile.z !== ROOF_POLICY.sourceZoom || !Number.isInteger(tile.x) || !Number.isInteger(tile.y) || tile.x < 0 || tile.y < 0 || tile.x >= 2 ** tile.z || tile.y >= 2 ** tile.z) return false;
  const n = 2 ** tile.z, reserve = ROOF_POLICY.tileReserveM * unit;
  return ring.every(([x, y]) => {
    const mx = origin.x + x * unit, my = origin.y + y * unit;
    return mx > tile.x / n + reserve && mx < (tile.x + 1) / n - reserve && my > tile.y / n + reserve && my < (tile.y + 1) / n - reserve;
  });
}
function geometryRings(feature) {
  const g = feature?.geometry;
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.map(p => localRing(p[0])).filter(Boolean);
}
function sourceComponents(features) {
  const seen = new Map(), ambiguous = new Set();
  for (const f of features) {
    const tile = f?.tile, id = f?.id;
    if (!tile || id === undefined || id === null) continue;
    const key = `${tile.z}/${tile.x}/${tile.y}:${id}`, signature = JSON.stringify([f.geometry, f.properties]);
    if (seen.has(key) && seen.get(key).signature !== signature) ambiguous.add(key);
    else seen.set(key, {f, signature});
  }
  const components = [];
  for (const [key, {f}] of seen) {
    if (ambiguous.has(key)) continue;
    const polys = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const [index, coordinates] of polys.entries()) components.push({...f, id:`${key}:${index}`, sourceFeatureId:f.id, componentIndex:index, geometry:{type:'Polygon', coordinates}});
  }
  return {components, ambiguous:ambiguous.size};
}
export function buildRoofDetails(features, {radius = 500} = {}) {
  radiusCheck(radius);
  const rejected = {}, candidates = [], accepted = [], details = [], candidateKeys = new Set();
  const reject = reason => { rejected[reason] = (rejected[reason] || 0) + 1; };
  if (!Array.isArray(features) || features.length > 12000) return {type:'FeatureCollection', features:[], report:{buildings:0, rejected:{'invalid-or-excessive-source':1}}};
  let componentCount = 0, vertexCount = 0;
  for (const f of features) {
    const g = f?.geometry, polygons = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : null;
    if (!Array.isArray(polygons)) return {type:'FeatureCollection', features:[], report:{buildings:0,rejected:{'uninspectable-source-geometry':1}}};
    componentCount += polygons.length;
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length || polygon.some(r => !Array.isArray(r) || r.length < 4 || !r.every(validCoordinate))) return {type:'FeatureCollection',features:[],report:{buildings:0,rejected:{'uninspectable-source-geometry':1}}};
      vertexCount += polygon.reduce((n,r) => n + r.length,0);
      if (componentCount > 20000 || vertexCount > 200000) return {type:'FeatureCollection',features:[],report:{buildings:0,rejected:{'source-geometry-budget':1}}};
    }
  }
  // OpenFreeMap groups disconnected buildings of equal height in MultiPolygons.
  // A vector feature ID is NOT a physical-building ID. Keep component identity
  // within its canonical tile, and reject ambiguous same-tile feature IDs.
  const {components, ambiguous} = sourceComponents(features);
  if (ambiguous) rejected['ambiguous-source-id'] = ambiguous;
  // Preserve even unadmitted/hidden source polygons as collision obstacles.
  const circleBox = [-radius - 0.15, -radius - 0.15, radius + 0.15, radius + 0.15];
  const obstacles = features.flatMap(f => geometryRings(f).map(ring => ({ring, box:bounds(ring), sourceFeatureId:f.id, height:f.properties?.render_height, base:f.properties?.render_min_height}))).filter(o => boxOverlap(o.box,circleBox)).map(o => ({...o,signature:ringKey(o.ring)}));
  for (const f of components) {
    const g = f.geometry, h = f.properties?.render_height, base = f.properties?.render_min_height;
    if (g?.type !== 'Polygon' || g.coordinates?.length !== 1) { reject('multipart-or-courtyard'); continue; }
    const ring = localRing(g.coordinates[0]);
    if (!ring || ring.length > 16) { reject('unsupported-ring'); continue; }
    if (ring.some(p => Math.hypot(...p) > radius - 2)) { reject('outside-circle'); continue; }
    if (pointInRing([0, 0], ring) || ring.some((p,i) => segmentDistance([0,0], p, ring[(i+1)%ring.length]) < ROOF_POLICY.commonsReserveM)) { reject('commons-reserve'); continue; }
    if (!tileInterior(ring, f.tile)) { reject('tile-boundary-or-unverified-tile'); continue; }
    if (!Number.isFinite(h) || !Number.isFinite(base) || h < 3 || h > 60 || base < 0 || base >= h || Object.hasOwn(f.properties, 'hide_3d')) { reject('unsupported-height-or-hidden'); continue; }
    const roofArea = Math.abs(area(ring));
    if (roofArea < 35 || roofArea > 1800) { reject('roof-area'); continue; }
    const outer = insetConvex(ring, 0.4), inner = insetConvex(ring, 0.8), panel = insetConvex(ring, 1.05);
    if (!outer || !inner || !panel) { reject('nonconvex-or-narrow'); continue; }
    const box = bounds(ring);
    // Skip exactly the current polygon, but retain overlapping distinct polygons.
    // Identical buffered duplicates represent the same roof and produce one candidate.
    const own = ringKey(ring);
    if (obstacles.some(o => boxOverlap(box, o.box, 0.15) && !(o.signature === own && o.sourceFeatureId === f.sourceFeatureId && o.height === h && o.base === base) && ringsNear(ring, o.ring))) { reject('adjacent-or-overlapping-building'); continue; }
    if (candidateKeys.has(own)) { reject('duplicate-roof-component'); continue; }
    candidateKeys.add(own);
    candidates.push({f, outer, inner, panel, height:h, distance:Math.min(...ring.map(p => Math.hypot(...p)))});
  }
  candidates.sort((a,b) => a.distance - b.distance || String(a.f.id).localeCompare(String(b.f.id)));
  for (const c of candidates.slice(0, ROOF_POLICY.maxBuildings)) {
    const {f, outer, inner, panel, height} = c;
    const make = (kind, rings, base, top, color) => ({type:'Feature', id:`${f.id}:${kind}`, properties:{kind, nativeComponent:String(f.id), sourceFeatureId:String(f.sourceFeatureId), sourceTile:`${f.tile.z}/${f.tile.x}/${f.tile.y}`, nativeHeight:height, base, top, color, fictional:true}, geometry:{type:'Polygon', coordinates:rings.map(r => close(r).map(roofGeo))}});
    // Disjoint roof panel + parapet, both strictly inset from native walls and
    // separated vertically from the native roof. No coplanar replacement surface.
    details.push(make('parapet', [outer, [...inner].reverse()], height + ROOF_POLICY.roofGapM, height + 0.7, '#A5B1BA'));
    details.push(make('roof-panel', [panel], height + ROOF_POLICY.roofGapM, height + 0.3, '#5C7584'));
    const center = roofGeo(panel.reduce((p,v) => [p[0]+v[0]/panel.length,p[1]+v[1]/panel.length],[0,0]));
    accepted.push({nativeComponent:f.id, sourceFeatureId:f.sourceFeatureId, componentIndex:f.componentIndex, tile:f.tile, nativeHeight:height, centerLngLat:center, detailCount:2});
  }
  if (candidates.length > ROOF_POLICY.maxBuildings) rejected['budget'] = candidates.length - ROOF_POLICY.maxBuildings;
  return {type:'FeatureCollection', features:details, report:{buildings:accepted.length, features:details.length, accepted, rejected, runtimeSource:'current-loaded-native-vector-features', fictional:true}};
}
