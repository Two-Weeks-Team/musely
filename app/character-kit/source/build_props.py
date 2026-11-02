"""Author the shared action props on the rigged base (cup, plate, seedling, notepad, camera, hammer).

Run via run_mcp_cli.py on a .blend that already holds the action clips (build_actions.py). Idempotent:
removes the earlier 'Shared props' collection and 'Prop ' materials first, then saves the opened file.

Each prop is a small rigid mesh parented to the hand bone of the socket it uses. It is shaped and placed
in the pose of a representative frame of its clip (cup at the sip, camera at the eyes, ...), and that
placement is carried back to the rest pose, so it sits right while the clip plays. Custom properties
(exported as glTF extras): musely_kind='prop', musely_clip, musely_socket, musely_bone. The runtime shows
a prop only while its clip plays. Materials are plain PBR factors (no textures) to keep the file small.
"""
import bpy, bmesh, math, sys
from pathlib import Path
from mathutils import Vector, Matrix, Euler

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import importlib, variant_spec
importlib.reload(variant_spec)
from variant_spec import ACTION_CLIPS, hex_to_linear

scene = bpy.data.scenes['Jolly • Base character studio']
rig = scene.objects['MuseRig']

old = bpy.data.collections.get('Shared props')
if old:
    for o in list(old.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(old)
for m in [m for m in bpy.data.materials if m.name.startswith('Prop ')]:
    bpy.data.materials.remove(m)
coll = bpy.data.collections.new('Shared props'); scene.collection.children.link(coll)
coll['musely_variant'] = 'props'


def material(name, hexcol, rough=.5, metal=0.0):
    m = bpy.data.materials.new('Prop ' + name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hex_to_linear(hexcol), 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    b.inputs['Emission Strength'].default_value = 0.0
    return m


MAT = {
    'ceramic': material('ceramic', '#F1EBDD', .35), 'coffee': material('coffee', '#5A3A26', .25),
    'plate': material('plate', '#EDE7DA', .4), 'rice': material('rice', '#F7F3EA', .7), 'tomato': material('tomato', '#D9553F', .45),
    'soil': material('soil', '#5B4332', .9), 'leaf': material('leaf', '#6FA35A', .6),
    'paper': material('paper', '#F4EEDC', .85), 'cover': material('cover', '#7E6AA0', .7),
    'shell': material('camera body', '#3E4348', .45), 'lens': material('lens', '#1E2328', .15, .3), 'trim': material('trim', '#C9CDD2', .3, 1.0),
    'wood': material('wood', '#B98552', .65), 'steel': material('steel', '#AEB4BA', .3, 1.0),
}


def mesh_from(bm, name, mat, mw):
    bm.normal_update()
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        ax = max(range(3), key=lambda i: abs(f.normal[i]))
        for l in f.loops:
            co = l.vert.co; l[uv].uv = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob)
    ob.matrix_world = mw
    return ob


def cyl(r1, r2, depth, segs=16):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth); return bm


def box(sx, sy, sz):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts); return bm


def ball(r, sx=1, sy=1, sz=1, segs=10, rings=6):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts); return bm


def torus(R, r, seg=12, ring=6, arc=math.pi):
    bm = bmesh.new(); rows = []
    for i in range(seg + 1):
        a = -arc / 2 + arc * i / seg; c = Vector((R * math.cos(a), 0, R * math.sin(a))); d = Vector((math.cos(a), 0, math.sin(a)))
        rows.append([bm.verts.new(c + d * (r * math.cos(2 * math.pi * k / ring)) + Vector((0, r * math.sin(2 * math.pi * k / ring), 0))) for k in range(ring)])
    for a, b in zip(rows, rows[1:]):
        for k in range(ring):
            bm.faces.new((a[k], b[k], b[(k + 1) % ring], a[(k + 1) % ring]))
    return bm


def join(objs, name):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name; objs[0].data.name = name
    return objs[0]


def pose_frame(clip, frame):
    """Hand-bone pose matrices and socket positions at `frame` of `clip` (rig at the origin, armature space)."""
    a = bpy.data.actions[clip]
    rig.animation_data.action = a; rig.animation_data.action_slot = a.slots[0]
    scene.frame_set(frame + 1); bpy.context.view_layer.update()
    out = {s: (rig.pose.bones['Hand_' + s].matrix.copy(), scene.objects['Socket_Hand_' + s].matrix_world.translation.copy()) for s in 'RL'}
    rig.animation_data.action = None
    for b in rig.pose.bones:
        b.rotation_quaternion = (1, 0, 0, 0); b.location = (0, 0, 0); b.scale = (1, 1, 1)
    scene.frame_set(1); bpy.context.view_layer.update()
    return out


def finish(ob, clip, side, posed_hand):
    """Carry the posed placement back to the rest pose and parent the prop to the hand bone."""
    bone = 'Hand_' + side
    rest = rig.data.bones[bone].matrix_local
    ob.matrix_world = rest @ posed_hand.inverted() @ ob.matrix_world
    bpy.context.view_layer.update()
    mw = ob.matrix_world.copy()
    ob.parent = rig; ob.parent_type = 'BONE'; ob.parent_bone = bone
    bpy.context.view_layer.update(); ob.matrix_world = mw
    ob['musely_kind'] = 'prop'; ob['musely_clip'] = clip; ob['musely_socket'] = 'Socket_Hand_' + side; ob['musely_bone'] = bone
    return ob


T = lambda v: Matrix.Translation(Vector(v))
R = lambda x=0, y=0, z=0: Euler((x, y, z)).to_matrix().to_4x4()
made = {}

# Cup (drink): in front of the palm at the sip, top tipped toward the mouth.
p = pose_frame('drink', 48); m, s = p['R']
base = T(s + Vector((.004, -.036, .012))) @ R(x=-.45)
cup = join([mesh_from(cyl(.026, .023, .066), 'prop__cup_body', MAT['ceramic'], base),
            mesh_from(cyl(.022, .022, .004), 'prop__cup_coffee', MAT['coffee'], base @ T((0, 0, .03))),
            mesh_from(torus(.016, .0045), 'prop__cup_handle', MAT['ceramic'], base @ T((-.026, 0, .002)) @ R(z=math.pi))], 'prop__cup')
made['cup'] = finish(cup, 'drink', 'R', m)

# Plate with food (eat): level on the left palm.
p = pose_frame('eat', 10); m, s = p['L']
base = T(s + Vector((-.01, -.045, .028)))
plate = join([mesh_from(cyl(.068, .056, .012, 20), 'prop__plate_dish', MAT['plate'], base),
              mesh_from(ball(.026, 1, 1, .8), 'prop__plate_rice', MAT['rice'], base @ T((.012, .006, .022))),
              mesh_from(ball(.014), 'prop__plate_tomato', MAT['tomato'], base @ T((-.03, -.015, .016)))], 'prop__plate')
made['plate'] = finish(plate, 'eat', 'L', m)

# Seedling (plant): root ball in the right hand as it reaches the soil, stem and two leaves up.
p = pose_frame('plant', 54); m, s = p['R']
base = T(s + Vector((0, -.03, -.012)))
seed = join([mesh_from(cyl(.02, .016, .03, 12), 'prop__seedling_soil', MAT['soil'], base),
             mesh_from(cyl(.003, .003, .05, 6), 'prop__seedling_stem', MAT['leaf'], base @ T((0, 0, .04))),
             mesh_from(ball(.018, 1, .45, .18), 'prop__seedling_leaf_a', MAT['leaf'], base @ T((.016, 0, .066)) @ R(y=-.5)),
             mesh_from(ball(.016, 1, .45, .18), 'prop__seedling_leaf_b', MAT['leaf'], base @ T((-.015, 0, .06)) @ R(y=.5))], 'prop__seedling')
made['seedling'] = finish(seed, 'plant', 'R', m)

# Notepad (write_note): on the left palm, page tilted up toward the face, under the writing hand.
p = pose_frame('write_note', 24); m, s = p['L']
base = T(s + Vector((-.03, -.04, .02))) @ R(x=.55, z=.25)
pad = join([mesh_from(box(.075, .095, .006), 'prop__notepad_cover', MAT['cover'], base),
            mesh_from(box(.07, .09, .006), 'prop__notepad_paper', MAT['paper'], base @ T((0, 0, .005)))], 'prop__notepad')
made['notepad'] = finish(pad, 'write_note', 'L', m)

# Camera (photo): held between both hands in front of the eyes, lens forward.
p = pose_frame('photo', 36); m, s = p['R']; sl = p['L'][1]
base = T((s + sl) / 2 + Vector((0, -.035, 0)))
cam = join([mesh_from(box(.10, .036, .06), 'prop__camera_body', MAT['shell'], base),
            mesh_from(cyl(.019, .017, .03, 16), 'prop__camera_lens', MAT['lens'], base @ T((.012, -.03, -.002)) @ R(x=math.pi / 2)),
            mesh_from(box(.026, .012, .012), 'prop__camera_button', MAT['trim'], base @ T((-.032, 0, .034)))], 'prop__camera')
made['camera'] = finish(cam, 'photo', 'R', m)

# Hammer (hammer): handle forward out of the right fist at the strike, head at the far end, face down.
p = pose_frame('hammer', 16); m, s = p['R']
base = T(s + Vector((0, -.012, 0)))
ham = join([mesh_from(cyl(.008, .009, .15, 10), 'prop__hammer_handle', MAT['wood'], base @ T((0, -.06, .004)) @ R(x=math.pi / 2)),
            mesh_from(box(.026, .026, .07), 'prop__hammer_head', MAT['steel'], base @ T((0, -.132, .004)))], 'prop__hammer')
made['hammer'] = finish(ham, 'hammer', 'R', m)

bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)
result = {'saved': bpy.data.filepath, 'props': {k: {'object': o.name, 'clip': o['musely_clip'], 'bone': o['musely_bone'],
                                                    'tris': sum(len(f.vertices) - 2 for f in o.data.polygons)} for k, o in made.items()}}
