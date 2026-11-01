# Museion map layer — stylized night map of Silicon Valley (Blender 5.0, headless)
# Mac copy: OUT points to ~/museion-renders/out
# Usage: blender --background --factory-startup --python map_scene.py -- [full|check]
import bpy, math, random, sys
from mathutils import Vector

random.seed(11)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
CHECK = len(argv) > 0 and argv[0] == "check"
OUT = "/Users/kimsejun/museion-renders/out"

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

def box(name, loc, dims, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material); return o

def cyl(name, loc, r, h, material, verts=36):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc)
    o = bpy.context.object; o.name = name; o.data.materials.append(material); return o

def cone(name, loc, r, h, material, verts=14):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=0.0, depth=h, location=loc)
    o = bpy.context.object; o.name = name; o.data.materials.append(material); return o

def sph(name, loc, r, material):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=10, ring_count=8)
    o = bpy.context.object; o.name = name; o.data.materials.append(material); return o

bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
scene = bpy.context.scene
world = bpy.data.worlds.new("W"); scene.world = world; world.use_nodes = True
world.node_tree.nodes.get("Background").inputs[0].default_value = (0.008, 0.013, 0.032, 1.0)

LAND = mat("land", (0.036, 0.054, 0.104), emit=(0.05, 0.075, 0.15), emit_strength=0.16)
WATER = mat("water", (0.016, 0.034, 0.082), emit=(0.03, 0.07, 0.17), emit_strength=0.5)
FABRIC = mat("fabric", (0.052, 0.070, 0.132), emit=(0.055, 0.08, 0.155), emit_strength=0.38)
FABRIC2 = mat("fabric2", (0.070, 0.092, 0.168), emit=(0.075, 0.105, 0.195), emit_strength=0.42)
BLOCK = mat("block", (0.062, 0.082, 0.152))
BLOCK2 = mat("block2", (0.082, 0.105, 0.185))
ROAD = mat("road", (0.09, 0.12, 0.21), emit=(0.32, 0.42, 0.62), emit_strength=0.16)
GLOW = mat("glow", (1.0, 0.60, 0.28), emit=(1.0, 0.58, 0.26), emit_strength=1.7)
FLAME = mat("flame", (1.0, 0.50, 0.16), emit=(1.0, 0.48, 0.14), emit_strength=5.0)
BEAM = mat("beam", (1.0, 0.62, 0.30), emit=(1.0, 0.60, 0.28), emit_strength=1.1)
DOT = mat("dot", (1.0, 0.72, 0.42), emit=(1.0, 0.70, 0.40), emit_strength=1.0)
COOL = mat("cool", (0.55, 0.70, 1.0), emit=(0.5, 0.66, 1.0), emit_strength=0.7)

BAY = [(13.0, 8.0, 6.4), (14.1, 1.5, 6.0), (13.1, -4.0, 5.2), (14.3, -9.0, 4.4), (16.0, -13.5, 3.8)]
def in_water(x, y):
    if x < -19: return True
    return any((x - cx) ** 2 + (y - cy) ** 2 < (r * 0.98) ** 2 for (cx, cy, r) in BAY)

box("Land", (0, 0, -0.05), (54, 38, 0.1), LAND)
for (x, y, r) in BAY:
    cyl("Bay", (x, y, 0.01), r, 0.07, WATER, verts=40)
box("Ocean", (-23.5, 4, 0.005), (8, 38, 0.07), WATER)

n = 0
gx = -18.0
while gx < 17:
    gy = -16.5
    while gy < 16:
        x, y = gx + random.uniform(-0.3, 0.3), gy + random.uniform(-0.3, 0.3)
        if not in_water(x, y) and random.random() < 0.85:
            h = random.uniform(0.04, 0.15)
            box(f"Fab{n}", (x, y, h / 2), (random.uniform(0.42, 0.66), random.uniform(0.42, 0.66), h), FABRIC if random.random() < 0.7 else FABRIC2)
            n += 1
        gy += 0.95
    gx += 0.95

CITIES = {
    "SF": (-7.5, 11.0, 1.0, 42), "HQ": (2.2, -0.6, 1.6, 24), "PA": (3.6, -3.4, 1.0, 20),
    "MV": (5.4, -7.0, 1.0, 20), "SV": (6.6, -9.8, 0.9, 16), "CU": (2.6, -10.6, 0.9, 16),
    "SJ": (11.0, -14.5, 0.85, 26),
}
for name, (cx, cy, ps, dens) in CITIES.items():
    for i in range(dens):
        a = random.uniform(0, math.tau); rr = random.uniform(0.3, 2.2)
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.8
        if in_water(x, y): continue
        w = random.uniform(0.45, 1.1); h = random.uniform(0.15, 0.62)
        box(f"Blk{name}{i}", (x, y, h / 2), (w, w * random.uniform(0.6, 1.0), h), BLOCK if i % 3 else BLOCK2, rot=(0, 0, random.choice([0, math.pi / 2, random.uniform(-0.15, 0.15)])))
        if random.random() < 0.38:
            sph(f"Win{name}{i}", (x, y, h + 0.05), 0.04, DOT if random.random() < 0.8 else COOL)
    cyl(f"Pin{name}", (cx, cy, 0.05), 0.62 * ps, 0.05, GLOW, verts=28)
    cone(f"PinF{name}", (cx, cy, 0.30 * ps), 0.13 * ps, 0.42 * ps, FLAME)
    cyl(f"Beam{name}", (cx, cy, 0.85 * ps), 0.045 * ps, 1.7 * ps, BEAM, verts=10)
    for k in range(3):
        sph(f"PinE{name}{k}", (cx + random.uniform(-0.12, 0.12), cy + random.uniform(-0.12, 0.12), (0.55 + k * 0.24) * ps), 0.045 * ps, DOT)
    if name == "HQ":
        bpy.ops.object.light_add(type="POINT", location=(cx, cy, 1.6))
        li = bpy.context.object; li.data.energy = 26; li.data.color = (1.0, 0.58, 0.26)

for x in (-3.5, 1.2, 4.6):
    box(f"RdV{x}", (x, -1, 0.02), (0.09, 31, 0.03), ROAD)
for y in (3.2, -4.6, -11.5):
    box(f"RdH{y}", (0.5, y, 0.02), (27, 0.09, 0.03), ROAD)
def seg(name, p0, p1):
    d = Vector(p1) - Vector(p0); L = d.length
    o = box(name, ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0.03), (0.13, L, 0.03), ROAD)
    o.rotation_euler = (0, 0, math.atan2(d.y, d.x) - math.pi / 2)
seg("Hwy1", (-7.5, 11.0), (2.2, -0.6)); seg("Hwy2", (2.2, -0.6), (11.0, -14.5))

for i in range(70):
    x, y = random.uniform(-17, 10), random.uniform(-15, 15)
    if in_water(x, y): continue
    sph(f"Lone{i}", (x, y, 0.07), 0.035, DOT if random.random() < 0.75 else COOL)

bpy.ops.object.camera_add(location=(0.5, -21.0, 36.5))
cam = bpy.context.object; scene.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = 34
d = Vector((-1.0, -1.5, 0)) - cam.location
cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
bpy.ops.object.light_add(type="SUN", location=(5, 6, 14))
rim = bpy.context.object; rim.data.energy = 0.16; rim.data.color = (0.5, 0.65, 0.9)
rim.rotation_euler = (math.radians(55), 0, math.radians(150))

scene.render.engine = "CYCLES"
scene.cycles.samples = 40 if CHECK else 72
scene.cycles.use_denoising = True
scene.cycles.device = "CPU"
scene.view_settings.view_transform = "AgX"
scene.render.resolution_x = 1920; scene.render.resolution_y = 1080
if CHECK: scene.render.resolution_percentage = 50
scene.render.image_settings.file_format = "PNG"
import os; os.makedirs(OUT, exist_ok=True)
scene.render.filepath = f"{OUT}/map-museion.png"
bpy.ops.wm.save_as_mainfile(filepath=f"{OUT}/museion-map.blend")
bpy.ops.render.render(write_still=True)
print("MAP_DONE", scene.render.filepath)
