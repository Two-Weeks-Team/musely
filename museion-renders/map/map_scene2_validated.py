# Museion map v2 — REAL Bay Area geography from OSM (Geofabrik norcal extract).
# Land/water from coastline polygonize; SF + city-pocket buildings as merged prism mesh;
# motorways as ribbons; fire pins at true coordinates. Night palette matches the diorama.
# Usage: blender --background --factory-startup --python map_scene2.py -- [full|check]
import bpy, math, random, sys, json
from mathutils import Vector
import mathutils.geometry as mgeo

random.seed(5)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
CHECK = len(argv) > 0 and argv[0] == "check"
import os
BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('MUSEION_OUT', os.path.join(BASE, 'renders'))
DATA = json.load(open(os.path.join(BASE, 'bayarea.json')))
LAND = json.load(open(os.path.join(BASE, 'land.json')))

LON0, LAT0 = -122.255, 37.535
ROT = math.radians(28.0)
def proj(lon, lat):
    x = (lon - LON0) * 85.0 * 0.62
    y = (lat - LAT0) * 111.0 * 0.62
    return (x * math.cos(ROT) - y * math.sin(ROT), x * math.sin(ROT) + y * math.cos(ROT))

def mat(name, color, rough=0.9, emit=None, emit_strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if m.node_tree is None: m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return m

bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
scene = bpy.context.scene
world = bpy.data.worlds.new("W"); scene.world = world; world.use_nodes = True
world.node_tree.nodes.get("Background").inputs[0].default_value = (0.008, 0.013, 0.032, 1.0)

LAND_M = mat("land", (0.036, 0.054, 0.104), emit=(0.05, 0.075, 0.15), emit_strength=0.16)
WATER_M = mat("water", (0.016, 0.034, 0.082), emit=(0.03, 0.07, 0.17), emit_strength=0.38)
FAB_M = mat("fabric", (0.052, 0.070, 0.132), emit=(0.055, 0.08, 0.155), emit_strength=0.75)
FAB2_M = mat("fabric2", (0.070, 0.092, 0.168), emit=(0.075, 0.105, 0.195), emit_strength=0.42)
BLD_M = mat("building", (0.062, 0.082, 0.152), emit=(0.05, 0.07, 0.13), emit_strength=0.55)
BLD2_M = mat("building2", (0.085, 0.108, 0.19), emit=(0.06, 0.08, 0.15), emit_strength=0.25)
ROAD_M = mat("road", (0.09, 0.12, 0.21), emit=(0.32, 0.42, 0.62), emit_strength=0.16)
GLOW_M = mat("glow", (1.0, 0.60, 0.28), emit=(1.0, 0.58, 0.26), emit_strength=1.7)
FLAME_M = mat("flame", (1.0, 0.50, 0.16), emit=(1.0, 0.48, 0.14), emit_strength=5.0)
BEAM_M = mat("beam", (1.0, 0.62, 0.30), emit=(1.0, 0.60, 0.28), emit_strength=1.1)
DOT_M = mat("dot", (1.0, 0.72, 0.42), emit=(1.0, 0.70, 0.40), emit_strength=1.0)

def mesh_obj(name, verts, faces, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    if material: me.materials.append(material)
    return o

def flat_mesh(name, polys, z, material):
    """polys: list of polygons, each = list of rings (outer first). One mesh, tessellated."""
    verts, faces = [], []
    for poly in polys:
        rings = []
        base = len(verts)
        for ring in poly:
            pts = [proj(x, y) for (x, y) in ring]
            if len(pts) >= 2 and pts[0] == pts[-1]: pts = pts[:-1]
            if len(pts) < 3: rings = None; break
            rings.append([Vector((px, py, z)) for (px, py) in pts])
            verts.extend((px, py, z) for (px, py) in pts)
        if not rings: continue
        try:
            tris = mgeo.tessellate_polygon(rings)
        except Exception:
            continue
        for tri in tris:
            faces.append(tuple(base + i for i in tri))
    if faces: mesh_obj(name, verts, faces, material)
    return len(faces)

# land = full-frame plane; water = flood-fill raster quads + OSM lake polygons on top
def box(name, loc, dims, material):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o = bpy.context.object; o.name = name; o.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material); return o
verts, faces = [], []
STEP = LAND.get('cell_step', 0.0016)
for (lon, lat) in LAND.get('land_cells', []):
    cs = [proj(lon - STEP / 2, lat - STEP / 2), proj(lon + STEP / 2, lat - STEP / 2),
          proj(lon + STEP / 2, lat + STEP / 2), proj(lon - STEP / 2, lat + STEP / 2)]
    b = len(verts)
    verts.extend([(x, y, 0.0) for (x, y) in cs])
    faces.append((b, b + 1, b + 2, b + 3))
mesh_obj('LandCells', verts, faces, LAND_M)
print('land cells:', len(faces))
verts, faces = [], []
STEP = LAND.get('cell_step', 0.0016)
for (lon, lat) in LAND['water_cells']:
    cs = [proj(lon - STEP / 2, lat - STEP / 2), proj(lon + STEP / 2, lat - STEP / 2),
          proj(lon + STEP / 2, lat + STEP / 2), proj(lon - STEP / 2, lat + STEP / 2)]
    b = len(verts)
    verts.extend([(x, y, 0.03) for (x, y) in cs])
    faces.append((b, b + 1, b + 2, b + 3))
mesh_obj('Water', verts, faces, WATER_M)
print('water cells:', len(faces))
print('lake tris:', flat_mesh('Lakes', LAND.get('lakes', []), 0.045, WATER_M))

# ---------- fabric (merged boxes) ----------
verts, faces = [], []
def add_box(cx, cy, z0, w, h, z1):
    b = len(verts)
    verts.extend([(cx-w/2, cy-h/2, z0), (cx+w/2, cy-h/2, z0), (cx+w/2, cy+h/2, z0), (cx-w/2, cy+h/2, z0),
                  (cx-w/2, cy-h/2, z1), (cx+w/2, cy-h/2, z1), (cx+w/2, cy+h/2, z1), (cx-w/2, cy+h/2, z1)])
    faces.extend([(b, b+1, b+2, b+3), (b+4, b+7, b+6, b+5), (b, b+4, b+5, b+1), (b+1, b+5, b+6, b+2),
                  (b+2, b+6, b+7, b+3), (b+3, b+7, b+4, b)])
for (lon, lat, s) in LAND['fabric']:
    x, y = proj(lon, lat)
    w = random.uniform(0.16, 0.26) * s + 0.08
    add_box(x, y, 0.02, w, w * random.uniform(0.7, 1.0), 0.02 + random.uniform(0.03, 0.09))
mesh_obj('Fabric', verts, faces, FAB_M)
print('fabric boxes:', len(faces) // 6)

# ---------- buildings (merged prisms) ----------
verts, faces = [], []
n_skip = 0
for foot, hm in DATA['buildings']:
    pts = [proj(x, y) for (x, y) in foot]
    if len(pts) >= 2 and pts[0] == pts[-1]: pts = pts[:-1]
    if len(pts) < 3: n_skip += 1; continue
    h = min(0.05 + hm * 0.006, 1.7)
    b = len(verts)
    n = len(pts)
    verts.extend([(x, y, 0.02) for (x, y) in pts] + [(x, y, 0.02 + h) for (x, y) in pts])
    for i in range(n):
        j = (i + 1) % n
        faces.append((b + i, b + j, b + n + j, b + n + i))
    rings = [[Vector((x, y, 0.02 + h)) for (x, y) in pts]]
    try:
        for tri in mgeo.tessellate_polygon(rings):
            faces.append(tuple(b + n + i for i in tri))
    except Exception:
        n_skip += 1
mesh_obj('Buildings', verts, faces, BLD_M)
print('buildings drawn:', len(DATA['buildings']) - n_skip, 'skipped:', n_skip)

# ---------- highways (merged ribbons) ----------
verts, faces = [], []
for line in DATA['highways']:
    pts = [proj(x, y) for (x, y) in line]
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-6: continue
        nx, ny = -dy / L * 0.045, dx / L * 0.045
        b = len(verts)
        verts.extend([(x0-nx, y0-ny, 0.05), (x0+nx, y0+ny, 0.05), (x1+nx, y1+ny, 0.05), (x1-nx, y1-ny, 0.05)])
        faces.append((b, b+1, b+2, b+3))
mesh_obj('Highways', verts, faces, ROAD_M)
print('highway segs:', len(faces))

# ---------- fire pins at true coordinates ----------
def cyl(name, loc, r, h, material, verts=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc)
    o = bpy.context.object; o.name = name; o.data.materials.append(material); return o
def cone(name, loc, r, h, material, verts=14):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=0.0, depth=h, location=loc)
    o = bpy.context.object; o.name = name; o.data.materials.append(material); return o
def sph(name, loc, r, material):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=10, ring_count=8)
    o = bpy.context.object; o.name = name; o.data.materials.append(material); return o

PINS = {'SF': (-122.4194, 37.7749, 1.15), 'HQ': (-122.15008, 37.48336, 1.6), 'PA': (-122.1430, 37.4419, 1.0),
        'MV': (-122.0840, 37.3860, 1.0), 'SV': (-122.0360, 37.3710, 0.9), 'CU': (-122.0320, 37.3230, 0.9),
        'SJ': (-121.8860, 37.3380, 1.1), 'OK': (-122.2710, 37.8040, 0.9)}
pin_xy = {}
for name, (lon, lat, ps) in PINS.items():
    x, y = proj(lon, lat); pin_xy[name] = (x, y)
    cyl(f'Pin{name}', (x, y, 0.06), 0.30 * ps, 0.05, GLOW_M, verts=28)
    cone(f'PinF{name}', (x, y, 0.06 + 0.20 * ps), 0.075 * ps, 0.34 * ps, FLAME_M)
    cyl(f'Beam{name}', (x, y, 0.06 + 0.62 * ps), 0.026 * ps, 1.25 * ps, BEAM_M, verts=10)
    for k in range(3):
        sph(f'PinE{name}{k}', (x + random.uniform(-0.07, 0.07), y + random.uniform(-0.07, 0.07),
                               0.10 + (0.38 + k * 0.17) * ps), 0.026 * ps, DOT_M)
    if name == 'HQ':
        bpy.ops.object.light_add(type='POINT', location=(x, y, 1.2))
        li = bpy.context.object; li.data.energy = 26; li.data.color = (1.0, 0.58, 0.26)

# ---------- camera: auto-frame from projected pin bounds ----------
REGc = [proj(-122.56, 37.15), proj(-121.80, 37.15), proj(-121.80, 37.92), proj(-122.56, 37.92)]
xs = [p[0] for p in REGc]; ys = [p[1] for p in REGc]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
span_x, span_y = max(xs) - min(xs), max(ys) - min(ys)
bpy.ops.object.camera_add(location=(cx, cy - 26.0, 34.0))
cam = bpy.context.object; scene.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = max(span_x * 1.03, span_y * 1.42)
d = Vector((cx, cy, 0)) - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.light_add(type='SUN', location=(5, 6, 14))
rim = bpy.context.object; rim.data.energy = 0.3; rim.data.color = (0.5, 0.65, 0.9)
rim.rotation_euler = (math.radians(55), 0, math.radians(150))
print('PIN_XY', json.dumps(pin_xy))
print('CAM', cx, cy, cam.data.ortho_scale)

scene.render.engine = 'CYCLES'
scene.cycles.samples = 24 if CHECK else 72
scene.cycles.use_denoising = True
scene.cycles.device = 'CPU'
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_x = 1920; scene.render.resolution_y = 1080
if CHECK: scene.render.resolution_percentage = 50
scene.render.image_settings.file_format = 'PNG'
import os; os.makedirs(OUT, exist_ok=True)
scene.render.filepath = f'{OUT}/map-museion2.png'
bpy.ops.wm.save_as_mainfile(filepath=f'{OUT}/museion-map2.blend')
bpy.ops.render.render(write_still=True)
print('MAP2_DONE', scene.render.filepath)
