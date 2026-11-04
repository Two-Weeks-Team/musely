# Museion café diorama — procedural Blender scene (Blender 5.0, headless)
# Mac copy: OUT points to ~/museion-renders/out (ComBba VM original: ~/workspace/museion-blender/)
# Usage: blender --background --factory-startup --python build_scene.py -- [hero|ember]
import bpy, math, random, sys
from mathutils import Vector

random.seed(7)
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VARIANT = argv[0] if argv else "hero"
import os
OUT = os.path.expanduser("~/museion-renders/out")

def mat(name, color, rough=0.85, emit=None, emit_strength=0.0, metallic=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return m

def link(obj, material=None):
    if material: obj.data.materials.append(material)
    return obj

def box(name, loc, dims, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return link(o, material)

def cyl(name, loc, r, h, material, rot=(0, 0, 0), verts=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name
    return link(o, material)

def sph(name, loc, r, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=24, ring_count=16)
    o = bpy.context.object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return link(o, material)

def cone(name, loc, r, h, material, rot=(0, 0, 0), verts=18):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=0.0, depth=h, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name
    return link(o, material)

def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

GROUND = mat("ground", (0.043, 0.066, 0.122))
PLAZA = mat("plaza", (0.075, 0.102, 0.180))
BUILD = mat("building", (0.055, 0.075, 0.145))
CREAM = mat("cream", (0.949, 0.914, 0.847), rough=0.8)
HOOD = mat("hood", (0.83, 0.76, 0.65), rough=0.85)
FACE = mat("face", (0.10, 0.085, 0.13), rough=0.6)
WOOD = mat("wood", (0.16, 0.105, 0.055), rough=0.9)
STONE = mat("stone", (0.13, 0.15, 0.21), rough=0.95)
TREE = mat("tree", (0.045, 0.10, 0.065), rough=0.95)
FLAME_O = mat("flame_o", (1.0, 0.42, 0.10), emit=(1.0, 0.45, 0.12), emit_strength=3.4)
FLAME_Y = mat("flame_y", (1.0, 0.75, 0.35), emit=(1.0, 0.78, 0.38), emit_strength=6.0)
EMBER = mat("ember", (1.0, 0.72, 0.35), emit=(1.0, 0.70, 0.32), emit_strength=9.0)
BULB = mat("bulb", (1.0, 0.78, 0.45), emit=(1.0, 0.70, 0.42), emit_strength=3.2)
WINDOW = mat("window", (1.0, 0.65, 0.35), emit=(1.0, 0.62, 0.33), emit_strength=2.6)
SCREEN = mat("screen", (0.30, 0.20, 0.10), emit=(1.0, 0.66, 0.38), emit_strength=2.6)
DARK = mat("dark", (0.03, 0.03, 0.045), rough=0.5)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
scene = bpy.context.scene
world = bpy.data.worlds.new("W"); scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.020, 0.032, 0.066, 1.0)
bg.inputs[1].default_value = 1.0

cyl("Ground", (0, 0, -0.06), 34, 0.12, GROUND, verts=48)
cyl("Plaza", (0, 0, 0.005), 7.2, 0.13, PLAZA, verts=48)
cyl("Deck", (0, 0, 0.03), 4.6, 0.16, mat("deck", (0.075, 0.09, 0.16)), verts=40)

bpos = [(-13, 9, 5.5, 7), (-6, 13.5, 6.5, 9), (3, 14.5, 5, 6), (11, 10.5, 6, 8),
        (-15, -2, 5, 6), (15.5, -1, 5.5, 7.5), (-16.5, -16, 6, 5), (15.5, -17.5, 6.5, 6.5)]
for i, (x, y, w, h) in enumerate(bpos):
    b = box(f"B{i}", (x, y, h / 2), (w, w * 0.8, h), BUILD, rot=(0, 0, random.uniform(-0.2, 0.2)))
    for k in range(random.randint(2, 4)):
        wx = x + random.uniform(-w / 3, w / 3); wy = y - (w * 0.4 + 0.03) * (1 if y > 0 else -1)
        wz = random.uniform(1.2, h - 0.8)
        if y < 0: wy = y + (w * 0.4 + 0.03)
        box(f"B{i}w{k}", (wx, wy, wz), (0.72, 0.05, 1.0), WINDOW)

for i, (x, y, s) in enumerate([(-8.5, 5.5, 1.1), (8.8, 6.2, 1.3), (-9.2, -5.8, 1.0), (7.6, -8.6, 1.15), (0.5, 10.8, 1.2)]):
    cyl(f"T{i}trunk", (x, y, 0.7 * s), 0.14 * s, 1.4 * s, WOOD, verts=8)
    cone(f"T{i}a", (x, y, 1.9 * s), 1.15 * s, 1.9 * s, TREE)
    cone(f"T{i}b", (x, y, 2.8 * s), 0.85 * s, 1.5 * s, TREE)

def string_lights(p0, p1, sag=0.85, n=11):
    pts = []
    for i in range(n + 1):
        t = i / n
        p = Vector(p0).lerp(Vector(p1), t); p.z -= math.sin(t * math.pi) * sag
        pts.append(p)
    cu = bpy.data.curves.new("wire", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.014
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for pt, co in zip(sp.points, pts): pt.co = (*co, 1.0)
    o = bpy.data.objects.new("Wire", cu); bpy.context.collection.objects.link(o); o.data.materials.append(DARK)
    for p in pts[1:-1]:
        sph("Bulb", (p.x, p.y, p.z - 0.10), 0.075, BULB)
        cyl("Socket", (p.x, p.y, p.z - 0.03), 0.028, 0.07, DARK, verts=8)

for (x, y) in [(-5.6, -4.2), (5.6, -4.2), (-5.6, 4.6), (5.6, 4.6)]:
    cyl("Pole", (x, y, 1.7), 0.06, 3.4, WOOD, verts=10)
string_lights(Vector((-5.6, -4.2, 3.35)), Vector((5.6, -4.2, 3.35)), sag=0.65)
string_lights(Vector((-5.6, 4.6, 3.35)), Vector((5.6, 4.6, 3.35)), sag=0.65, n=11)

for i in range(3):
    a = i * math.pi / 3
    cyl(f"Log{i}", (0, 0, 0.16), 0.10, 1.15, WOOD, rot=(math.pi / 2, 0, a), verts=10)
for i in range(9):
    a = i / 9 * math.tau; r = 0.78
    s = sph(f"Stone{i}", (math.cos(a) * r, math.sin(a) * r, 0.10), 0.15, STONE, scale=(1, 0.8, 0.65)); s.rotation_euler.z = a
flame = cone("Flame", (0, 0, 0.58), 0.34, 0.92, FLAME_O); flame.scale = (0.88, 0.88, 1)
cone("FlameL", (-0.17, 0.06, 0.44), 0.17, 0.58, FLAME_O, rot=(0.16, 0.1, 0))
cone("FlameR", (0.16, -0.08, 0.42), 0.15, 0.5, FLAME_O, rot=(-0.12, -0.14, 0))
cone("FlameIn", (0.03, 0.02, 0.50), 0.18, 0.62, FLAME_Y)
bpy.ops.object.light_add(type="POINT", location=(0, 0, 1.15))
fire_light = bpy.context.object; fire_light.name = "FireLight"
fire_light.data.energy = 135; fire_light.data.color = (1.0, 0.55, 0.24)
fire_light.data.shadow_soft_size = 0.6
for i in range(34):
    a = random.uniform(0, math.tau); rr = random.uniform(0.02, 0.30); z = random.uniform(0.9, 2.9)
    sph(f"Ember{i}", (math.cos(a) * rr * z * 0.35, math.sin(a) * rr * z * 0.35, z), random.uniform(0.016, 0.034), EMBER)
bpy.ops.object.light_add(type="SUN", location=(6, 8, 12))
rim = bpy.context.object; rim.data.energy = 0.2; rim.data.color = (0.45, 0.65, 0.85)
rim.rotation_euler = (math.radians(50), 0, math.radians(140))

def avatar(name, pos, face_target):
    px, py = pos[0], pos[1]
    th = math.atan2(face_target[1] - py, face_target[0] - px) - math.pi / 2
    def W(lx, ly, lz):
        return (px + lx * math.cos(th) - ly * math.sin(th), py + lx * math.sin(th) + ly * math.cos(th), lz)
    cyl(name + "Stool", W(0, 0, 0.22), 0.30, 0.30, WOOD, verts=14)
    sph(name + "Body", W(0, 0, 0.72), 0.46, CREAM, scale=(1.0, 0.92, 1.05))
    sph(name + "Hood", W(0, 0, 1.28), 0.355, HOOD)
    sph(name + "Face", W(0, 0.215, 1.25), 0.22, FACE)
    for side in (-1, 1):
        sph(name + "Arm", W(0.44 * side, 0.10, 0.78), 0.13, CREAM, scale=(0.75, 0.75, 1.5))
        sph(name + "Foot", W(0.17 * side, 0.40, 0.10), 0.11, HOOD, scale=(1.0, 1.35, 0.6))

avatar("MuseA", (-1.75, 1.05, 0), (0, 0))
avatar("MuseB", (1.75, -1.05, 0), (0, 0))

def chair(name, pos, ang):
    x, y = pos
    box(name + "Seat", (x, y, 0.48), (0.5, 0.5, 0.07), WOOD, rot=(0, 0, ang))
    bx = x - math.sin(ang) * 0.24; by = y - math.cos(ang) * 0.24
    box(name + "Back", (bx, by, 0.78), (0.5, 0.06, 0.62), WOOD, rot=(0, 0, ang))
    for dx, dy in [(-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)]:
        cyl(name + "Leg", (x + dx, y + dy, 0.24), 0.03, 0.48, WOOD, verts=8)

chair("C1", (-2.9, -1.7), 0.7); chair("C2", (2.9, 1.7), 0.7 + math.pi)
chair("C3", (-3.1, 1.9), -0.6); chair("C4", (3.1, -1.9), -0.6 + math.pi)
for i, (x, y) in enumerate([(-3.4, 0.1), (3.4, -0.1)]):
    cyl(f"Table{i}", (x, y, 0.74), 0.5, 0.06, WOOD, verts=22)
    cyl(f"Table{i}Leg", (x, y, 0.37), 0.05, 0.74, DARK, verts=10)
    cyl(f"Cup{i}", (x + 0.16, y + 0.1, 0.83), 0.055, 0.12, CREAM, verts=12)

if VARIANT == "ember":
    phones = {}
    cam_dir_full = Vector((13.5, -13.5, 0))
    for key, base in [("A", Vector((-1.75, 1.05, 0))), ("B", Vector((1.75, -1.05, 0)))]:
        fwd = (Vector((0, 0, 0)) - base); fwd.z = 0; fwd.normalize()
        cam_side = (cam_dir_full - base); cam_side.z = 0; cam_side.normalize()
        pc = base + fwd * 0.38 + cam_side * (0.60 if key == "B" else 0.42) + Vector((0, 0, 1.0 if key == "B" else 0.95))
        rz = math.atan2(cam_side.y, cam_side.x) - math.pi / 2
        ph = box("Phone" + key, tuple(pc), (0.20, 0.04, 0.40), DARK)
        ph.rotation_euler = (math.radians(-24), 0, rz)
        sc = box("Phone" + key + "Scr", tuple(pc + cam_side * 0.026 + Vector((0, 0, 0.014))), (0.17, 0.012, 0.35), SCREEN)
        sc.rotation_euler = ph.rotation_euler
        phones[key] = pc
    def bez(a, c, b, t):
        u = 1 - t
        return a * (u * u) + c * (2 * u * t) + b * (t * t)
    src = Vector((0, 0, 1.45))
    for key, pc in phones.items():
        t_orb = 0.45 if key == "B" else 0.58
        ctrl = src + (pc - src) * 0.5 + Vector((0, 0, 1.9 if key == "B" else 1.35))
        orb = bez(src, ctrl, pc, t_orb)
        sph("SplitOrb" + key, tuple(orb), 0.11, EMBER)
        for j in range(1, 8):
            t = t_orb - j * 0.06
            p = bez(src, ctrl, pc, t)
            sph(f"Trail{key}{j}", tuple(p), 0.082 * (1 - j * 0.11), EMBER)

bpy.ops.object.camera_add(location=(13.5, -13.5, 12.0))
cam = bpy.context.object; scene.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = 11.8
look_at(cam, (0, 0, 0.2))
scene.render.engine = "CYCLES"
CHECK = len(argv) > 1 and argv[1] == "check"
scene.cycles.samples = 40 if CHECK else 80
scene.cycles.use_denoising = True
scene.cycles.device = "CPU"
scene.view_settings.view_transform = "AgX"
scene.render.resolution_x = 1920; scene.render.resolution_y = 1080
if CHECK: scene.render.resolution_percentage = 50
scene.render.image_settings.file_format = "PNG"
import os; os.makedirs(OUT, exist_ok=True)
scene.render.filepath = f"{OUT}/diorama-{VARIANT}.png"
bpy.ops.wm.save_as_mainfile(filepath=f"{OUT}/museion-cafe.blend")
bpy.ops.render.render(write_still=True)
print("RENDER_DONE", VARIANT, scene.render.filepath)
