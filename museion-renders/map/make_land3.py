# Land/water v3 (USE THIS — make_land.py의 polygonize 방식은 만이 분리되지 않아 폐기).
# flood fill with barrier = coastline + building cells + highway cells.
import json, random, os
from collections import deque
random.seed(42)
BASE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(BASE, 'bayarea.json')))
REG = (-122.56, 37.15, -121.80, 37.92)
STEP = 0.0016
NX = int((REG[2] - REG[0]) / STEP) + 1
NY = int((REG[3] - REG[1]) / STEP) + 1
def cell(lon, lat): return (int((lon - REG[0]) / STEP), int((lat - REG[1]) / STEP))
barrier = [[False] * NX for _ in range(NY)]
def mark_pt(lon, lat, pad=0):
    cx, cy = cell(lon, lat)
    for dx in range(-pad, pad + 1):
        for dy in range(-pad, pad + 1):
            x, y = cx + dx, cy + dy
            if 0 <= x < NX and 0 <= y < NY: barrier[y][x] = True
def mark_seg(p, q):
    dist = max(abs(q[0] - p[0]), abs(q[1] - p[1]))
    n = max(2, int(dist / (STEP * 0.5)))
    for i in range(n + 1): mark_pt(p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n)
for chain in d['coastline']:
    for i in range(len(chain) - 1): mark_seg(chain[i], chain[i + 1])
for line in d['highways']:
    for i in range(len(line) - 1): mark_seg(line[i], line[i + 1])
for foot, _h in d['buildings']:
    xs = [p[0] for p in foot]; ys = [p[1] for p in foot]
    cx, cy = cell(sum(xs) / len(xs), sum(ys) / len(ys))
    if 0 <= cx < NX and 0 <= cy < NY: barrier[cy][cx] = True
print('barrier cells:', sum(sum(r) for r in barrier))
water = [[False] * NX for _ in range(NY)]
SEEDS = [(-122.35, 37.65), (-122.42, 37.88), (-122.53, 37.72), (-122.08, 37.43), (-122.02, 37.90), (-122.53, 37.30), (-122.30, 37.82), (-122.47, 37.60), (-122.20, 37.60)]
dq = deque()
for (lon, lat) in SEEDS:
    x, y = cell(lon, lat)
    if not barrier[y][x] and not water[y][x]:
        water[y][x] = True; dq.append((x, y))
while dq:
    x, y = dq.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx_, ny_ = x + dx, y + dy
        if 0 <= nx_ < NX and 0 <= ny_ < NY and not barrier[ny_][nx_] and not water[ny_][nx_] and not barrier[ny_][nx_]:
            water[ny_][nx_] = True; dq.append((nx_, ny_))
water_cells = [[round(REG[0] + (x + 0.5) * STEP, 6), round(REG[1] + (y + 0.5) * STEP, 6)] for y in range(NY) for x in range(NX) if water[y][x]]
CORES = [(-122.419, 37.775, 0.030), (-122.150, 37.483, 0.012), (-122.143, 37.444, 0.012), (-122.084, 37.389, 0.012), (-121.889, 37.334, 0.016), (-122.271, 37.804, 0.014)]
fab = []
for y in range(NY):
    for x in range(NX):
        if water[y][x] or barrier[y][x]: continue
        if random.random() > 0.30: continue
        lon = REG[0] + (x + 0.5) * STEP + random.uniform(-0.0006, 0.0006)
        lat = REG[1] + (y + 0.5) * STEP + random.uniform(-0.0006, 0.0006)
        if any((lon - cx) ** 2 + (lat - cy) ** 2 < r * r for cx, cy, r in CORES): continue
        fab.append([round(lon, 6), round(lat, 6), round(random.uniform(0.5, 1.0), 2)])
print('fabric points:', len(fab))
lakes = [wp for wp in d['waters'] if len(wp) >= 1 and len(wp[0]) >= 4]
land_cells = [[round(REG[0] + (x + 0.5) * STEP, 6), round(REG[1] + (y + 0.5) * STEP, 6)] for y in range(NY) for x in range(NX) if not water[y][x]]
print('land cells:', len(land_cells))
json.dump({'water_cells': water_cells, 'land_cells': land_cells, 'cell_step': STEP, 'fabric': fab, 'lakes': lakes}, open(os.path.join(BASE, 'land.json'), 'w'))
print('WROTE land.json')
