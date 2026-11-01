// Extracts named real places within 1.5 km of the commons from OpenStreetMap (Overpass) into
// assets/poi-commons.json for item discovery (direction v2, 9). Data © OpenStreetMap contributors, ODbL.
// Usage: node scripts/extract-poi.mjs [raw-overpass.json]   (without an argument it queries Overpass)
import {readFile, writeFile} from 'node:fs/promises';

const geography = JSON.parse(await readFile(new URL('../assets/geography.json', import.meta.url), 'utf8'));
const [lon, lat] = geography.commons, RADIUS = 1500;
const query = `[out:json][timeout:60];(
 nwr(around:${RADIUS},${lat},${lon})["amenity"~"^(cafe|restaurant|fast_food|food_court|library|ice_cream|bar|pub)$"]["name"];
 nwr(around:${RADIUS},${lat},${lon})["shop"~"^(convenience|supermarket|bakery|books)$"]["name"];
 nwr(around:${RADIUS},${lat},${lon})["highway"="bus_stop"]["name"];
 nwr(around:${RADIUS},${lat},${lon})["leisure"~"^(park|playground|garden)$"]["name"];
);out center tags;`;

let raw;
if (process.argv[2]) raw = JSON.parse(await readFile(process.argv[2], 'utf8'));
else {
  const res = await fetch('https://overpass-api.de/api/interpreter', {method: 'POST', headers: {'user-agent': 'musely-preview-poi/1.0 (+https://preview.musely.net)', 'content-type': 'application/x-www-form-urlencoded'}, body: 'data=' + encodeURIComponent(query)});
  if (!res.ok) throw new Error('Overpass ' + res.status);
  raw = await res.json();
}

const kindOf = t => t.highway === 'bus_stop' ? 'bus_stop'
  : t.amenity === 'food_court' ? 'fast_food'
  : t.amenity ?? (t.shop === 'books' ? 'bookshop' : t.shop) ?? t.leisure;
const R = 6371000, rad = d => d * Math.PI / 180;
const dist = (a, b) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2));

const places = raw.elements.map(e => {
  const p = e.type === 'node' ? [e.lon, e.lat] : [e.center.lon, e.center.lat];
  return {id: `osm:${e.type}/${e.id}`, name: e.tags.name, kind: kindOf(e.tags), lng: +p[0].toFixed(6), lat: +p[1].toFixed(6), distanceM: Math.round(dist([lon, lat], p))};
}).filter(p => p.distanceM <= RADIUS).sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id));

const counts = Object.fromEntries([...new Set(places.map(p => p.kind))].sort().map(k => [k, places.filter(p => p.kind === k).length]));
await writeFile(new URL('../assets/poi-commons.json', import.meta.url), JSON.stringify({
  source: 'OpenStreetMap via Overpass API', license: 'ODbL 1.0 — © OpenStreetMap contributors', osmBase: raw.osm3s?.timestamp_osm_base ?? null,
  center: [lon, lat], radiusM: RADIUS, counts, places,
}, null, 1) + '\n');
console.log(JSON.stringify({places: places.length, counts}));
