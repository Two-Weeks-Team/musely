# Extract Bay Area geometry from norcal.osm.pbf for the Museion Blender map.
import osmium, json, sys, math
import os
BASE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(BASE, 'norcal.osm.pbf')
OUT = os.path.join(BASE, 'bayarea.json')
REG = (-122.56, 37.15, -121.80, 37.92)
SF = (-122.525, 37.695, -122.355, 37.845)
CENTERS = {'PA': (-122.143, 37.444, 1.3), 'MV': (-122.084, 37.389, 1.3), 'SJ': (-121.889, 37.334, 1.6), 'HQ': (-122.150, 37.483, 1.2), 'OK': (-122.271, 37.804, 1.5)}
def in_bbox(lon, lat, b): return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]
def near_center(lon, lat):
    for (cx, cy, r) in CENTERS.values():
        d = math.hypot((lon - cx) * 85.0, (lat - cy) * 111.0)
        if d <= r: return True
    return False
class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.buildings, self.highways, self.coast = [], [], []
        self.nb = self.nh = 0
    def way(self, w):
        tags = w.tags
        try: pts = [(n.lon, n.lat) for n in w.nodes]
        except Exception: return
        if len(pts) < 2: return
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        if 'building' in tags:
            if not (in_bbox(cx, cy, REG)): return
            if in_bbox(cx, cy, SF) or near_center(cx, cy):
                h = 8.0
                if 'height' in tags:
                    try: h = float(str(tags['height']).replace('m', '').strip())
                    except Exception: pass
                elif 'building:levels' in tags:
                    try: h = float(tags['building:levels']) * 3.2
                    except Exception: pass
                self.buildings.append([[[round(x, 6), round(y, 6)] for x, y in pts], round(min(h, 160.0), 1)])
                self.nb += 1
            return
        hw = tags.get('highway')
        if hw in ('motorway', 'trunk', 'motorway_link', 'trunk_link'):
            if any(in_bbox(x, y, REG) for x, y in pts):
                self.highways.append([[round(x, 6), round(y, 6)] for x, y in pts]); self.nh += 1
            return
        if tags.get('natural') == 'coastline':
            if any(in_bbox(x, y, REG) for x, y in pts):
                self.coast.append([[round(x, 6), round(y, 6)] for x, y in pts])
h = H()
h.apply_file(PBF, locations=True)
print('buildings', h.nb, 'highways', h.nh, 'coast ways', len(h.coast))
waters = []
try:
    from osmium.geom import GeoJSONFactory
    fac = GeoJSONFactory()
    class A(osmium.SimpleHandler):
        def area(self, a):
            tags = a.tags
            if tags.get('natural') in ('water', 'bay') or 'water' in tags or tags.get('type') == 'waterway':
                try: g = json.loads(fac.create_multipolygon(a))
                except Exception: return
                polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
                for poly in polys:
                    cx = poly[0][0][0]; cy = poly[0][0][1]
                    if in_bbox(cx, cy, REG):
                        waters.append([[[round(x, 6), round(y, 6)] for x, y in ring] for ring in poly])
    a = A()
    a.apply_file(PBF, locations=True)
    print('water polys', len(waters))
except Exception as e:
    print('area pass failed:', e)
json.dump({'buildings': h.buildings, 'highways': h.highways, 'waters': waters, 'coastline': h.coast}, open(OUT, 'w'))
print('WROTE', OUT)
