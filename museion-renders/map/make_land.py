# Build land/water polygons from coastline chains + sample fabric points on land.
import json, random
from shapely.geometry import LineString, Polygon, box, Point
from shapely.ops import polygonize, linemerge, unary_union
random.seed(42)
import os
BASE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(BASE, 'bayarea.json')))
REG = (-122.56, 37.15, -121.95, 37.92)
frame = box(*REG)
lines = []
for chain in d['coastline']:
    if len(chain) >= 2: lines.append(LineString(chain))
merged = linemerge(unary_union(lines)) if lines else None
geoms = list(merged.geoms) if merged and merged.geom_type == 'MultiLineString' else ([merged] if merged else [])
print('coast chains after merge:', len(geoms), [len(g.coords) for g in geoms][:10])
all_lines = geoms + [frame.boundary]
polys = list(polygonize(all_lines))
print('polygonized:', len(polys))
LAND_SAMPLES = [(-122.42, 37.77), (-122.15, 37.48), (-121.89, 37.34), (-122.27, 37.80), (-122.03, 37.32), (-122.30, 37.55), (-122.45, 37.70)]
land = []
for p in polys:
    if any(p.contains(Point(s)) for s in LAND_SAMPLES): land.append(p)
land_u = unary_union(land) if land else Polygon()
if land_u.is_empty:
    print('FALLBACK: no land from coastline; using frame - waters')
    w = unary_union([Polygon(wp[0], wp[1:]) for wp in d['waters'] if len(wp) >= 1 and len(wp[0]) >= 4]) if d['waters'] else Polygon()
    land_u = frame.difference(w)
water_u = frame.difference(land_u)
print('land area deg2:', round(land_u.area, 3), 'water area deg2:', round(water_u.area, 3))
def polys_of(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    if g.geom_type == 'MultiPolygon': return list(g.geoms)
    return [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']
def dump(g):
    return [[[[round(x, 6), round(y, 6)] for x, y in ring.coords] for ring in [p.exterior] + list(p.interior)] for p in polys_of(g)]
CORES = [(-122.419, 37.775, 0.030), (-122.150, 37.483, 0.012), (-122.143, 37.444, 0.012), (-122.084, 37.389, 0.012), (-121.889, 37.334, 0.016), (-122.271, 37.804, 0.014)]
fab = []
gx = REG[0]
while gx < REG[2]:
    gy = REG[1]
    while gy < REG[3]:
        x, y = gx + random.uniform(-0.0018, 0.0018), gy + random.uniform(-0.0018, 0.0018)
        pt = Point(x, y)
        if land_u.contains(pt) and random.random() < 0.8:
            if not any((x - cx) ** 2 + (y - cy) ** 2 < r * r for cx, cy, r in CORES):
                fab.append([round(x, 6), round(y, 6), round(random.uniform(0.5, 1.0), 2)])
        gy += 0.0042
    gx += 0.0042
print('fabric points:', len(fab))
out = {'land': dump(land_u), 'water': dump(water_u), 'fabric': fab}
json.dump(out, open(os.path.join(BASE, 'land.json'), 'w'))
print('WROTE land.json')
