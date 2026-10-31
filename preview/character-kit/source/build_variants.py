"""Author the nine Muse variants on top of the shared rigged base.

Run on muse_family.blend via run_mcp_cli.py (official MCP background tool).
Idempotent: removes any earlier variant collections/materials/actions first.

Adds, without reshaping the shared body or rig:
  * accessory PBR materials from textures/accessories (packed)
  * per-variant collections 'Variant 0X-name' with garments (skinned to MuseRig
    using weights transferred from the body) and rigid props (bone-parented)
  * nine signature body actions on MuseRig (NLA tracks, muted like the base)
  * per-variant fleece review materials for renders (not exported to runtime)
"""
import bpy, bmesh, math, sys, json
from pathlib import Path
from mathutils import Vector, Matrix, Euler, Quaternion

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import importlib, variant_spec
importlib.reload(variant_spec)
from variant_spec import VARIANTS, SIGNATURE_CLIPS, MATERIALS, hex_to_linear, fleece_factor

scene = bpy.data.scenes['Jolly • Base character studio']
bpy.context.window.scene = scene if bpy.context.window else None
rig = scene.objects['MuseRig']
body = scene.objects['Jolly_Base']
TEX = HERE / 'textures' / 'accessories'

# ---------------------------------------------------------------- cleanup
for coll in [c for c in bpy.data.collections if c.name.startswith('Variant ')]:
    for o in list(coll.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(coll)
for m in [m for m in bpy.data.materials if m.name.startswith(('Acc ', 'Review fleece '))]:
    bpy.data.materials.remove(m)
for name in SIGNATURE_CLIPS:
    if name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[name])
    for t in list(rig.animation_data.nla_tracks):
        if t.name == name:
            rig.animation_data.nla_tracks.remove(t)
if 'read_book_page' in bpy.data.actions:
    bpy.data.actions.remove(bpy.data.actions['read_book_page'])
for img in [i for i in bpy.data.images if i.name.startswith('acc-')]:
    bpy.data.images.remove(img)

# ---------------------------------------------------------------- materials
def load_image(name, colorspace):
    img = bpy.data.images.load(str(TEX / f'{name}.png'))
    img.name = f'acc-{name}.png'
    img.colorspace_settings.name = colorspace
    img.pack()
    return img

_images = {}
def tex(family, kind):
    key = f'{family}-{kind}'
    if key not in _images:
        _images[key] = load_image(key, 'sRGB' if kind == 'color' else 'Non-Color')
    return _images[key]


def make_material(name, family, tint_hex, uv_scale=1.0, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    col = nt.nodes.new('ShaderNodeTexImage'); col.image = tex(family, 'color')
    nrm = nt.nodes.new('ShaderNodeTexImage'); nrm.image = tex(family, 'normal')
    orm = nt.nodes.new('ShaderNodeTexImage'); orm.image = tex(family, 'orm')
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    # glTF exporter reads baseColorFactor from a Mix(Multiply) with constant color.
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    lin = hex_to_linear(tint_hex)
    mix.inputs[7].default_value = (*lin, 1)
    nt.links.new(col.outputs['Color'], mix.inputs[6])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    nt.links.new(nrm.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    nt.links.new(sep.outputs['Red'], nt.nodes.new('ShaderNodeValue').outputs[0]) if False else None
    if uv_scale != 1.0:
        coord = nt.nodes.new('ShaderNodeTexCoord')
        mapping = nt.nodes.new('ShaderNodeMapping'); mapping.inputs['Scale'].default_value = (uv_scale, uv_scale, 1)
        nt.links.new(coord.outputs['UV'], mapping.inputs['Vector'])
        for t in (col, nrm, orm):
            nt.links.new(mapping.outputs['Vector'], t.inputs['Vector'])
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*hex_to_linear(emission[0]), 1)
        bsdf.inputs['Emission Strength'].default_value = emission[1]
    else:
        bsdf.inputs['Emission Strength'].default_value = 0.0
    m['musely_family'] = family
    m['musely_tint'] = tint_hex
    return m


_mats = {}
def mat(vid, kind, tint):
    """Material per (variant, kind, tint)."""
    spec = MATERIALS[kind]
    tint_hex = spec.get('fixed', tint)
    key = (vid, kind, tint_hex)
    if key not in _mats:
        scale = {'knit': 3.0, 'linen': 2.5, 'twill': 2.5, 'canvas': 2.5, 'wood': 1.0, 'cork': 1.0}.get(kind, 1.0)
        _mats[key] = make_material(f'Acc {vid} {kind}', spec['tex'], tint_hex, scale)
    return _mats[key]


def emissive_glow(vid, hexcol, strength):
    m = bpy.data.materials.new(f'Acc {vid} glow')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hex_to_linear(hexcol), 1)
    b.inputs['Emission Color'].default_value = (*hex_to_linear(hexcol), 1)
    b.inputs['Emission Strength'].default_value = strength
    b.inputs['Roughness'].default_value = .5
    return m

# ---------------------------------------------------------------- body fit
# Measured torso half-width (x) and front/back depth (y) by height z (Blender, -Y front).
PROFILE = [  # z, rx, y_front, y_back
    (.14, .206, -.145, .143), (.18, .243, -.161, .165), (.22, .262, -.178, .176), (.26, .276, -.186, .183),
    (.30, .287, -.190, .186), (.34, .293, -.191, .192), (.38, .295, -.190, .189), (.42, .285, -.181, .186),
    (.46, .274, -.174, .176), (.50, .262, -.165, .171), (.54, .255, -.177, .164), (.58, .249, -.169, .161),
    (.62, .248, -.168, .159), (.70, .250, -.169, .160), (.78, .233, -.166, .150), (.84, .189, -.175, .127),
]

def prof(z):
    for (z0, a0, f0, b0), (z1, a1, f1, b1) in zip(PROFILE, PROFILE[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return a0 + (a1 - a0) * t, f0 + (f1 - f0) * t, b0 + (b1 - b0) * t
    p = PROFILE[0] if z < PROFILE[0][0] else PROFILE[-1]
    return p[1], p[2], p[3]


def surface_point(z, theta, offset):
    """theta=0 at front (-Y), increasing toward +X (character's left)."""
    rx, yf, yb = prof(z)
    c = math.cos(theta)
    ry = -yf if c >= 0 else yb
    x = (rx + offset) * math.sin(theta)
    y = -(ry + offset) * c
    return Vector((x, y, z))


def mesh_object(name, bm, coll, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def shell(name, coll, material, z0, z1, a0, a1, offset, thick, segs=40, rings=10, z_of=None, uv_repeat=(1, 1), flare=0.0):
    """A garment surface hugging the measured body, solidified outward."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    grid = []
    for j in range(rings + 1):
        v = j / rings
        row = []
        for i in range(segs + 1):
            u = i / segs
            th = a0 + (a1 - a0) * u
            z = z0 + (z1 - z0) * v if z_of is None else z_of(u, v)
            off = offset + flare * (1 - v)
            row.append(bm.verts.new(surface_point(z, th, off)))
        grid.append(row)
    for j in range(rings):
        for i in range(segs):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for loop, (di, dj) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                loop[uv].uv = ((i + di) / segs * uv_repeat[0], (j + dj) / rings * uv_repeat[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_object(name, bm, coll, material)
    # Outward normals: the surface winds counter-clockwise seen from outside.
    mod = ob.modifiers.new('Thickness', 'SOLIDIFY'); mod.thickness = thick; mod.offset = 1.0; mod.use_even_offset = True
    return ob


def apply_modifiers(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def skin_to_rig(ob, allowed):
    """Transfer body weights by nearest surface, keep only allowed bones, normalize."""
    bpy.context.view_layer.update()
    apply_modifiers(ob)
    if ob.matrix_world != Matrix.Identity(4):
        ob.data.transform(ob.matrix_world); ob.matrix_world = Matrix.Identity(4)
    for bone in rig.data.bones:
        ob.vertex_groups.new(name=bone.name)
    dt = ob.modifiers.new('weights', 'DATA_TRANSFER')
    dt.object = body; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=dt.name)
    names = {g.index: g.name for g in ob.vertex_groups}
    for v in ob.data.vertices:
        ws = {names[g.group]: g.weight for g in v.groups if names[g.group] in allowed and g.weight > 1e-4}
        for g in list(v.groups):
            ob.vertex_groups[names[g.group]].remove([v.index])
        if not ws:
            ws = {allowed[0]: 1.0}
        top = sorted(ws.items(), key=lambda kv: -kv[1])[:4]
        s = sum(w for _, w in top)
        for n, w in top:
            ob.vertex_groups[n].add([v.index], w / s, 'REPLACE')
    for g in list(ob.vertex_groups):
        if g.name not in allowed:
            ob.vertex_groups.remove(g)
    # Skinned meshes stay at the scene root (glTF NODE_SKINNED_MESH_NON_ROOT); the armature modifier binds them.
    mod = ob.modifiers.new('Muse skin', 'ARMATURE'); mod.object = rig
    ob['musely_kind'] = 'garment'
    return ob


TORSO = ['Chest', 'Spine', 'Hips', 'Neck']

def bone_prop(ob, bone, socket=None):
    """Parent a rigid prop to a bone keeping its world placement."""
    apply_modifiers(ob)
    bpy.context.view_layer.update()
    mw = ob.matrix_world.copy()
    ob.parent = rig; ob.parent_type = 'BONE'; ob.parent_bone = bone
    bpy.context.view_layer.update()
    ob.matrix_world = mw
    ob['musely_kind'] = 'prop'
    ob['musely_bone'] = bone
    if socket:
        ob['musely_socket'] = socket
    return ob

# ---------------------------------------------------------------- primitives (bmesh)
def bm_cylinder(r1, r2, depth, segs=24, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth)
    return bm

def bm_box(sx, sy, sz):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    return bm

def bm_torus(R, r, seg=32, ring=10, arc=2 * math.pi):
    bm = bmesh.new()
    rings = []
    closed = abs(arc - 2 * math.pi) < 1e-6
    n = seg if closed else seg + 1
    for i in range(n):
        a = arc * i / seg
        c = Vector((R * math.cos(a), R * math.sin(a), 0))
        d = Vector((math.cos(a), math.sin(a), 0))
        row = []
        for k in range(ring):
            b = 2 * math.pi * k / ring
            row.append(bm.verts.new(c + d * (r * math.cos(b)) + Vector((0, 0, r * math.sin(b)))))
        rings.append(row)
    for i in range(seg if closed else seg):
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(ring):
            bm.faces.new((a[k], b[k], b[(k + 1) % ring], a[(k + 1) % ring]))
    return bm

def bm_uv_box_project(bm, scale=4.0):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            u, v = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
            l[uv].uv = (u * scale, v * scale)
    return bm

def obj_from(name, bm, coll, material, loc=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, smooth=True, uv_scale=4.0):
    bm.normal_update()
    bm_uv_box_project(bm, uv_scale)
    ob = mesh_object(name, bm, coll, material)
    ob.location = loc; ob.rotation_euler = rot
    if bevel:
        bv = ob.modifiers.new('Bevel', 'BEVEL'); bv.width = bevel; bv.segments = 2
    if not smooth:
        for p in ob.data.polygons:
            p.use_smooth = False
    return ob

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        apply_modifiers(o)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]

# Hand tip positions (Blender world, neutral pose).
HAND = {'L': Vector((.355, -.023, .17)), 'R': Vector((-.355, -.023, .17))}

# ---------------------------------------------------------------- variants
def collection(v):
    c = bpy.data.collections.new(f"Variant {v['id']}")
    scene.collection.children.link(c)
    c['musely_variant'] = v['id']
    return c


def build_sunny(v, c):
    knit = mat(v['id'], 'knit', v['accent'])
    scarf = shell('01-sunny__scarf', c, knit, .505, .575, 0, 2 * math.pi, .012, .028, segs=48, rings=6, uv_repeat=(6, 1))
    skin_to_rig(scarf, ['Neck', 'Chest'])
    # hanging scarf tail (front left)
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')
    pts = []
    for j in range(7):
        z = .53 - j * .028
        x0 = .07 + j * .004
        row = [bm.verts.new(surface_point(z, math.atan2(x0 + dx, 1) * 1.0 + .05, .028 + j * .002)) for dx in (0, .055)]
        pts.append(row)
    for j in range(6):
        f = bm.faces.new((pts[j][0], pts[j][1], pts[j + 1][1], pts[j + 1][0]))
        for l, (a, b) in zip(f.loops, ((0, j), (1, j), (1, j + 1), (0, j + 1))):
            l[uv].uv = (a, b / 2)
    tail = mesh_object('01-sunny__scarf_tail', bm, c, knit)
    tail.modifiers.new('Thickness', 'SOLIDIFY').thickness = .014
    skin_to_rig(tail, ['Chest', 'Neck', 'Spine'])
    # enamel sun badge on the chest, right of the scarf tail
    enamel = mat(v['id'], 'shell', '#F2C14E')
    rim = mat(v['id'], 'brass', None)
    p = surface_point(.43, -.42, .006)
    disc = obj_from('01-sunny__badge_face', bm_cylinder(.026, .026, .006, 24), c, enamel, loc=p, rot=(math.pi / 2, 0, -.42))
    ring = obj_from('01-sunny__badge_rim', bm_torus(.027, .0035, 24, 6), c, rim, loc=p, rot=(math.pi / 2, 0, -.42))
    rays = []
    for k in range(8):
        a = k * math.pi / 4
        ray = obj_from(f'01-sunny__ray{k}', bm_box(.006, .004, .016), c, rim,
                       loc=(0, 0, 0))
        ray.matrix_world = (Matrix.Translation(p) @ Euler((math.pi / 2, 0, -.42)).to_matrix().to_4x4() @
                            Euler((0, 0, 0)).to_matrix().to_4x4() @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0, .036, .004)))
        rays.append(ray)
    badge = join([disc, ring] + rays, '01-sunny__badge')
    bone_prop(badge, 'Chest', 'Socket_Chest')


def apron(vid, c, material, z0, z1, width, bib_top, bib_width, name):
    a = width / 2
    body_part = shell(f'{vid}__{name}', c, material, z0, z1, -a, a, .014, .006, segs=24, rings=10, uv_repeat=(3, 3), flare=.02)
    bib = shell(f'{vid}__{name}_bib', c, material, z1 - .005, bib_top, -bib_width / 2, bib_width / 2, .012, .006, segs=12, rings=4, uv_repeat=(1.5, 1))
    straps = []
    for side in (-1, 1):
        th = side * bib_width / 2 * .85
        straps.append(shell(f'{vid}__{name}_strap{side}', c, material, bib_top - .005, .565, th - .05, th + .05, .016, .004,
                            segs=3, rings=4, z_of=lambda u, v, th=th: bib_top + (.565 - bib_top) * v))
    pocket = shell(f'{vid}__{name}_pocket', c, material, z0 + .07, z0 + .14, -.35, .35, .022, .005, segs=8, rings=3, uv_repeat=(1, 1))
    g = join([body_part, bib] + straps + [pocket], f'{vid}__{name}')
    return skin_to_rig(g, ['Hips', 'Spine', 'Chest', 'Neck'])


def build_moss(v, c):
    linen = mat(v['id'], 'linen', v['accent'])
    apron(v['id'], c, linen, .17, .40, 1.9, .47, .9, 'apron')
    # watering can in right hand: metal body tinted sage-grey, wood handle
    can_m = mat(v['id'], 'steel', None)
    wood = mat(v['id'], 'wood', '#F2E2CC')
    h = HAND['R']
    base = h + Vector((-.005, -.035, -.092))
    body_c = obj_from('02-moss__can_body', bm_cylinder(.05, .045, .09, 24), c, can_m, loc=base)
    # Spout leaves the lower front of the can and rises forward; the rose sits on its tip.
    d = Vector((0, -1, .8)).normalized(); start = base + Vector((0, -.042, -.02)); L = .12
    rot = d.to_track_quat('Z', 'Y').to_euler()
    spout = obj_from('02-moss__can_spout', bm_cylinder(.012, .007, L, 12), c, can_m, loc=start + d * (L / 2), rot=rot)
    rose = obj_from('02-moss__can_rose', bm_cylinder(.012, .02, .022, 12), c, can_m, loc=start + d * (L + .009), rot=rot)
    handle = obj_from('02-moss__can_handle', bm_torus(.04, .008, 20, 8, math.pi), c, wood, loc=base + Vector((0, .0, .045)), rot=(math.pi / 2, 0, math.pi / 2))
    can = join([body_c, spout, rose, handle], '02-moss__watering_can')
    bone_prop(can, 'Hand_R', 'Socket_Hand_R')


def build_ripple(v, c):
    canvas = mat(v['id'], 'canvas', v['accent'])
    # diagonal strap: high over left shoulder, low at right hip
    strap = shell('03-ripple__strap', c, canvas, 0, 0, 0, 2 * math.pi, .016, .006, segs=48, rings=1,
                  z_of=lambda u, vv: .36 + .15 * math.sin(2 * math.pi * u) + vv * .03, uv_repeat=(12, 1))
    bag_body = obj_from('03-ripple__bag_body', bm_box(.11, .05, .085), c, canvas, loc=surface_point(.27, -1.05, .035), rot=(0, 0, -1.05), bevel=.012)
    flap = obj_from('03-ripple__bag_flap', bm_box(.114, .055, .03), c, canvas, loc=surface_point(.305, -1.05, .037), rot=(0, 0, -1.05), bevel=.01)
    bag = join([strap, bag_body, flap], '03-ripple__bag')
    skin_to_rig(bag, ['Chest', 'Spine', 'Hips'])
    # rubber soles under both feet
    rubber = mat(v['id'], 'rubber', None)
    for side, sx in (('L', .115), ('R', -.115)):
        sole = obj_from(f'03-ripple__sole_{side}', bm_cylinder(.088, .092, .016, 28), c, rubber, loc=(sx, -.03, .008), bevel=.004)
        sole.scale = (1.0, 1.08, 1.0)
        apply_modifiers(sole)
        skin_to_rig(sole, ['Foot_' + side, 'LowerLeg_' + side, 'Toe_' + side])
    # folded map in left hand
    paper = mat(v['id'], 'paper', '#F3EAD6')
    h = HAND['L']
    panels = []
    for k in range(3):
        p = obj_from(f'03-ripple__map{k}', bm_box(.07, .002, .1), c, paper, loc=h + Vector((.03 + .068 * k * math.cos(.35), -.07 - .02 * (k % 2), .02)),
                     rot=(0, 0, (.35 if k % 2 else -.35)))
        panels.append(p)
    ink_lines = mat(v['id'], 'shell', v['body'])
    route = obj_from('03-ripple__map_route', bm_box(.17, .003, .006), c, ink_lines, loc=h + Vector((.10, -.078, .03)), rot=(0, 0, 0))
    m = join(panels + [route], '03-ripple__map')
    bone_prop(m, 'Hand_L', 'Socket_Hand_L')


def build_ember(v, c):
    knit = mat(v['id'], 'knit', v['accent'])
    shawl = shell('04-ember__shawl', c, knit, .45, .575, math.radians(28), math.radians(332), .02, .03, segs=40, rings=8,
                  z_of=lambda u, vv: .575 - (.575 - .45) * vv * (0.6 + .4 * math.sin(math.pi * u)), uv_repeat=(6, 2))
    skin_to_rig(shawl, ['Chest', 'Neck', 'Spine'])
    brass = mat(v['id'], 'brass', None)
    glow = emissive_glow(v['id'], '#FFB45A', 2.2)
    h = HAND['L'] + Vector((.0, -.045, -.105))
    parts = [obj_from('04-ember__lantern_base', bm_cylinder(.035, .035, .012, 16), c, brass, loc=h),
             obj_from('04-ember__lantern_top', bm_cylinder(.036, .012, .03, 16), c, brass, loc=h + Vector((0, 0, .085))),
             obj_from('04-ember__lantern_ring', bm_torus(.018, .003, 16, 6), c, brass, loc=h + Vector((0, 0, .112)), rot=(math.pi / 2, 0, 0))]
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        parts.append(obj_from(f'04-ember__lantern_post{k}', bm_cylinder(.003, .003, .072, 6), c, brass, loc=h + Vector((.03 * math.cos(a), .03 * math.sin(a), .042))))
    flame = obj_from('04-ember__lantern_flame', bm_cylinder(.012, .004, .035, 10), c, glow, loc=h + Vector((0, 0, .035)))
    lantern = join(parts + [flame], '04-ember__lantern')
    bone_prop(lantern, 'Hand_L', 'Socket_Hand_L')


def build_bloom(v, c):
    knit = mat(v['id'], 'knit', v['accent'])
    card = shell('05-bloom__cardigan', c, knit, .19, .53, math.radians(16), math.radians(344), .011, .008, segs=44, rings=12, uv_repeat=(8, 3))
    # embroidered petal patch on the left front panel
    petal_m = mat(v['id'], 'knit', '#E9A9B8')
    centre = mat(v['id'], 'knit', '#F2D27A')
    p = surface_point(.43, .42, .022)
    petals = []
    for k in range(5):
        a = k * 2 * math.pi / 5
        pe = obj_from(f'05-bloom__petal{k}', bm_cylinder(.011, .011, .004, 12), c, petal_m)
        pe.scale = (1, 1.6, 1)
        pe.matrix_world = Matrix.Translation(p) @ Euler((math.pi / 2, 0, .42)).to_matrix().to_4x4() @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0, .014, 0)) @ Matrix.Diagonal((1, 1.6, 1, 1))
        petals.append(pe)
    dot = obj_from('05-bloom__petal_centre', bm_cylinder(.007, .007, .006, 12), c, centre, loc=p, rot=(math.pi / 2, 0, .42))
    g = join([card] + petals + [dot], '05-bloom__cardigan')
    skin_to_rig(g, ['Hips', 'Spine', 'Chest', 'Neck'])


def build_ink(v, c):
    cotton = mat(v['id'], 'twill', v['accent'])
    pouch = obj_from('06-ink__pouch', bm_box(.08, .04, .09), c, cotton, loc=surface_point(.27, 1.15, .03), rot=(0, 0, 1.15), bevel=.015)
    flap = obj_from('06-ink__pouch_flap', bm_box(.082, .044, .025), c, cotton, loc=surface_point(.31, 1.15, .032), rot=(0, 0, 1.15), bevel=.01)
    strap = shell('06-ink__pouch_strap', c, cotton, 0, 0, 0, 2 * math.pi, .015, .005, segs=48, rings=1,
                  z_of=lambda u, vv: .37 - .14 * math.sin(2 * math.pi * u) + vv * .022, uv_repeat=(12, 1))
    g = join([strap, pouch, flap], '06-ink__pouch')
    skin_to_rig(g, ['Chest', 'Spine', 'Hips'])
    frame = mat(v['id'], 'shell', '#4A3F57')
    parts = []
    for sx in (.095, -.095):
        parts.append(obj_from(f'06-ink__lens{sx}', bm_torus(.046, .0035, 28, 6), c, frame, loc=(sx, -.192, .704), rot=(math.pi / 2, 0, 0)))
    parts.append(obj_from('06-ink__bridge', bm_torus(.02, .003, 12, 6, math.pi), c, frame, loc=(0, -.194, .712), rot=(math.pi / 2, 0, 0)))
    for sx in (.141, -.141):
        parts.append(obj_from(f'06-ink__temple{sx}', bm_box(.004, .09, .004), c, frame, loc=(sx * 1.25, -.15, .708), rot=(0, 0, (.5 if sx > 0 else -.5))))
    glasses = join(parts, '06-ink__glasses')
    bone_prop(glasses, 'Head', 'Socket_Head')
    cloth = mat(v['id'], 'twill', v['accent'])
    paper = mat(v['id'], 'paper', '#F5EEDC')
    h = HAND['L'] + Vector((.0, -.06, -.01))
    cover = obj_from('06-ink__book_cover', bm_box(.075, .014, .1), c, cloth, loc=h, rot=(0, 0, -.25), bevel=.003)
    pages = obj_from('06-ink__book_pages', bm_box(.07, .012, .094), c, paper, loc=h + Vector((0, -.002, 0)), rot=(0, 0, -.25))
    book = join([cover, pages], '06-ink__book')
    bone_prop(book, 'Hand_L', 'Socket_Hand_L')
    # A separate leaf hinges at the spine; the shared hand motion cannot turn a rigid book.
    spine = h + Euler((0, 0, -.25)).to_matrix() @ Vector((-.035, -.010, 0))
    page = obj_from('06-ink__turning_page', bm_box(.07, .001, .094), c, paper, loc=spine, rot=(0, 0, -.25))
    page.data.transform(Matrix.Translation((.035, 0, 0)))
    bone_prop(page, 'Hand_L', 'Socket_Hand_L'); page['musely_page'] = True
    page.rotation_mode = 'QUATERNION'; rest = page.rotation_quaternion.copy()
    # read_book lasts four seconds; its right hand reaches the page during the final second.
    for frame, angle, size in [(1, 0, 1), (73, 0, 1), (83, math.pi / 2, 1),
                                (93, math.pi, 1), (95, math.pi, .001), (96, 0, .001), (97, 0, 1)]:
        page.rotation_quaternion = rest @ Quaternion((0, 0, 1), angle)
        page.scale = (size, size, size)
        page.keyframe_insert('rotation_quaternion', frame=frame)
        page.keyframe_insert('scale', frame=frame)
    page.animation_data.action.name = 'read_book_page'
    scene.frame_set(1)


def build_tempo(v, c):
    shell_m = mat(v['id'], 'shell', v['accent'])
    pad = mat(v['id'], 'knit', '#6E6280')
    steel = mat(v['id'], 'steel', None)
    band = obj_from('07-tempo__band', bm_torus(.268, .011, 40, 8, math.pi), c, shell_m, loc=(0, 0, .70), rot=(math.pi / 2, 0, 0))
    band.scale = (1, .86, 1)
    parts = [band]
    for sx in (1, -1):
        parts.append(obj_from(f'07-tempo__cup{sx}', bm_cylinder(.064, .06, .042, 28), c, shell_m, loc=(sx * .29, -.005, .70), rot=(0, math.pi / 2, 0), bevel=.008))
        parts.append(obj_from(f'07-tempo__pad{sx}', bm_torus(.045, .016, 24, 8), c, pad, loc=(sx * .266, -.005, .70), rot=(0, math.pi / 2, 0)))
        parts.append(obj_from(f'07-tempo__hinge{sx}', bm_box(.01, .018, .03), c, steel, loc=(sx * .285, -.005, .765), bevel=.002))
    hp = join(parts, '07-tempo__headphones')
    bone_prop(hp, 'Head', 'Socket_Head')


def build_orbit(v, c):
    linen = mat(v['id'], 'linen', '#5E6788')
    cape = shell('08-orbit__cape', c, linen, .2, .555, math.radians(105), math.radians(255), .018, .007, segs=24, rings=12, flare=.03, uv_repeat=(3, 4))
    collar = shell('08-orbit__collar', c, linen, .525, .57, 0, 2 * math.pi, .014, .01, segs=40, rings=3, uv_repeat=(8, 1))
    g = join([cape, collar], '08-orbit__cape')
    skin_to_rig(g, ['Chest', 'Spine', 'Hips', 'Neck'])
    gold = mat(v['id'], 'brass', None)
    bm = bmesh.new()
    pts = []
    for k in range(10):
        r = .036 if k % 2 == 0 else .015
        a = math.pi / 2 + k * math.pi / 5
        pts.append(bm.verts.new((r * math.cos(a), r * math.sin(a), 0)))
    face = bm.faces.new(pts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, 0, .006), verts=[e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)])
    p = surface_point(.485, 0, .012)
    star = obj_from('08-orbit__star_pin', bm, c, gold, loc=p, rot=(math.pi / 2, 0, 0), smooth=False)
    bone_prop(star, 'Chest', 'Socket_Chest')


def build_copper(v, c):
    twill = mat(v['id'], 'twill', v['accent'])
    apron(v['id'], c, twill, .15, .41, 1.7, .49, 1.0, 'work_apron')
    cork = mat(v['id'], 'cork', '#F3E6D3')
    steel = mat(v['id'], 'steel', None)
    h = HAND['L']
    grip = obj_from('09-copper__tool_grip', bm_cylinder(.012, .012, .06, 12), c, cork, loc=h + Vector((.02, -.05, -.01)), rot=(math.radians(-80), 0, 0), bevel=.003)
    shaft = obj_from('09-copper__tool_shaft', bm_cylinder(.004, .003, .07, 8), c, steel, loc=h + Vector((.02, -.11, 0)), rot=(math.radians(-80), 0, 0))
    tool = join([grip, shaft], '09-copper__tool')
    bone_prop(tool, 'Hand_L', 'Socket_Hand_L')
    shell_m = mat(v['id'], 'shell', v['accent'])
    hr = HAND['R'] + Vector((-.0, -.055, -.012))
    box = obj_from('09-copper__gadget_body', bm_box(.07, .03, .05), c, shell_m, loc=hr, bevel=.008)
    dial = obj_from('09-copper__gadget_dial', bm_cylinder(.011, .011, .008, 16), c, steel, loc=hr + Vector((-.012, -.018, .006)), rot=(math.pi / 2, 0, 0))
    led = obj_from('09-copper__gadget_light', bm_cylinder(.005, .005, .006, 10), c, emissive_glow(v['id'], '#9FE3D6', 1.5), loc=hr + Vector((.018, -.017, .012)), rot=(math.pi / 2, 0, 0))
    gadget = join([box, dial, led], '09-copper__gadget')
    bone_prop(gadget, 'Hand_R', 'Socket_Hand_R')


BUILDERS = {'01-sunny': build_sunny, '02-moss': build_moss, '03-ripple': build_ripple, '04-ember': build_ember, '05-bloom': build_bloom,
            '06-ink': build_ink, '07-tempo': build_tempo, '08-orbit': build_orbit, '09-copper': build_copper}

report = {}
for v in VARIANTS:
    if v['id'] not in BUILDERS:
        continue
    c = collection(v)
    BUILDERS[v['id']](v, c)
    objs = list(c.objects)
    report[v['id']] = {o.name: {'kind': o.get('musely_kind'), 'tris': sum(len(p.vertices) - 2 for p in o.data.polygons), 'bone': o.get('musely_bone'),
                                'mats': [m.name for m in o.data.materials]} for o in objs}
    # review fleece material (render only)
    rf = bpy.data.materials['Fleece'].copy(); rf.name = f"Review fleece {v['id']}"
    nt = rf.node_tree
    colnode = next(n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.name == 'fleece-color.png')
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
    mix.inputs[7].default_value = (*fleece_factor(v['body'], clamp=False), 1)
    nt.links.new(colnode.outputs['Color'], mix.inputs[6]); nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    rf.use_fake_user = True

# ---------------------------------------------------------------- signature actions
rests = {n: b.matrix_local.to_quaternion() for n, b in rig.data.bones.items()}
def rotate(name, angles):
    q = rests[name]
    rig.pose.bones[name].rotation_quaternion = q.inverted() @ Euler(angles, 'XYZ').to_quaternion() @ q

def smooth(x):
    x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)

for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'
for name, (duration, loop) in SIGNATURE_CLIPS.items():
    action = bpy.data.actions.new(name); action.use_fake_user = True
    slot = action.slots.new('OBJECT', rig.name)
    rig.animation_data.action = action; rig.animation_data.action_slot = slot
    for frame in range(1, duration + 2, 2):
        t = (frame - 1) / duration; ph = 2 * math.pi * t; s = math.sin(ph)
        for pb in rig.pose.bones:
            pb.rotation_quaternion = Quaternion(); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
        hips = rig.pose.bones['Hips']
        if name == 'welcome_neighbors':
            e = smooth(t / .25) * (1 - smooth((t - .7) / .3))
            bounce = math.sin(math.pi * smooth(t / .5)) * (1 - smooth((t - .5) / .2))
            rotate('UpperArm_L', (-.35 * e, -1.25 * e, 0)); rotate('UpperArm_R', (-.35 * e, 1.25 * e, 0))
            rotate('Forearm_L', (-.25 * e, 0, 0)); rotate('Forearm_R', (-.25 * e, 0, 0))
            rotate('Chest', (-.06 * e, 0, 0)); rotate('Head', (-.08 * e, 0, .05 * math.sin(ph * 2) * e))
            hips.location.y = .014 * bounce
        elif name == 'water_plants':
            pour = .5 + .5 * math.sin(ph * 2)
            rotate('Chest', (.18, 0, 0)); rotate('Spine', (.06, 0, 0)); rotate('Head', (.16, 0, .03 * s))
            rotate('UpperArm_R', (-.62, .12, 0)); rotate('Forearm_R', (-.35, 0, 0)); rotate('Hand_R', (.35 * pour, 0, 0))
            rotate('UpperArm_L', (-.5, .28, 0)); rotate('Forearm_L', (-.55, 0, 0))
            for side in 'LR':
                rotate('UpperLeg_' + side, (-.12, 0, 0)); rotate('LowerLeg_' + side, (.14, 0, 0))
            hips.location.y = -.008
        elif name == 'inspect_map':
            look = smooth((t - .55) / .1) * (1 - smooth((t - .85) / .1))
            rotate('UpperArm_L', (-.95, .42, 0)); rotate('Forearm_L', (-.7, 0, 0))
            rotate('UpperArm_R', (-.95, -.42, 0)); rotate('Forearm_R', (-.7, 0, 0))
            rotate('Head', (.2 * (1 - look) - .05 * look, 0, .35 * look * math.sin(ph * 2) + .04 * s))
            rotate('Chest', (.05, 0, 0))
        elif name == 'tell_story':
            rotate('UpperArm_L', (-.3, -.1, 0)); rotate('Forearm_L', (-.5, 0, 0))
            rotate('UpperArm_R', (-.55 - .15 * s, .45 + .25 * math.sin(ph + 1), 0)); rotate('Forearm_R', (-.6 - .2 * math.sin(ph + .5), 0, 0))
            rotate('Hand_R', (0, .25 * math.sin(ph * 2), 0))
            rotate('Head', (.04 * math.sin(ph * 2), 0, .12 * s)); rotate('Chest', (0, .03 * s, .05 * s))
        elif name == 'reassure':
            nod = math.sin(ph * 2)
            rotate('Chest', (.08, 0, 0)); rotate('Head', (.06 + .07 * max(0, nod), -.05, 0))
            rotate('UpperArm_R', (-.55, -.85, 0)); rotate('Forearm_R', (-1.1, -.5, 0)); rotate('Hand_R', (0, 0, .2))
            rotate('UpperArm_L', (-.15, -.08, 0))
        elif name == 'read_book':
            turn = math.sin(math.pi * smooth((t - .75) / .2)) if t > .75 else 0
            line = (t * 4) % 1
            rotate('UpperArm_L', (-.9, .4, 0)); rotate('Forearm_L', (-.7, 0, 0))
            rotate('UpperArm_R', (-.85 - .15 * turn, -.35 - .3 * turn, 0)); rotate('Forearm_R', (-.6, 0, 0))
            rotate('Head', (.24, 0, -.06 + .12 * line * (1 - turn)))
        elif name == 'music_bounce':
            beat = abs(math.sin(ph * 2))
            hips.location.y = .012 * beat
            rotate('Head', (.07 * math.sin(ph * 4), 0, .05 * s)); rotate('Chest', (0, .04 * s, 0))
            rotate('UpperArm_L', (-.15 - .1 * beat, -.15, 0)); rotate('UpperArm_R', (-.15 - .1 * beat, .15, 0))
            tap = max(0, math.sin(ph * 2))
            rotate('Foot_R', (-.35 * tap, 0, 0)); rotate('UpperLeg_R', (-.08 * tap, 0, 0))
        elif name == 'observe_sky':
            point = smooth((t - .3) / .2) * (1 - smooth((t - .8) / .15))
            rotate('Head', (-.38, 0, .06 * s)); rotate('Neck', (-.08, 0, 0)); rotate('Chest', (-.06, 0, 0))
            rotate('UpperArm_R', (-1.9 * point, .15 * point, 0)); rotate('Forearm_R', (-.2 * point, 0, 0))
        elif name == 'inspect_gadget':
            present = smooth((t - .6) / .15) * (1 - smooth((t - .9) / .1))
            rotate('UpperArm_L', (-.95 - .3 * present, .38, 0)); rotate('Forearm_L', (-.6, 0, 0))
            rotate('UpperArm_R', (-.95 - .3 * present, -.38, 0)); rotate('Forearm_R', (-.55, 0, 0))
            rotate('Hand_R', (0, 0, .35 * math.sin(ph * 3) * (1 - present)))
            rotate('Head', (.2 * (1 - present) - .04 * present, 0, .05 * s)); rotate('Chest', (.05 * (1 - present), 0, 0))
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=frame, group=pb.name)
            if pb.name in ['Hips', 'Chest']:
                pb.keyframe_insert('location', frame=frame, group=pb.name); pb.keyframe_insert('scale', frame=frame, group=pb.name)
    track = rig.animation_data.nla_tracks.new(); track.name = name
    strip = track.strips.new(name, 1, action); strip.action_slot = slot
    strip.action_frame_start = 1; strip.action_frame_end = duration + 1; track.mute = True

rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = Quaternion(); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
scene.frame_set(1); bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'muse_family.blend'), compress=True)
result = {'variants': report, 'actions': sorted(a.name for a in bpy.data.actions)}
