"""Render review frames of the chapter-10 action clips on the base Muse (does not save the .blend).

Run via run_mcp_cli.py on the .blend that holds the actions. Optional globals: ONLY = ['drink'], OUT = path.
high_five is rendered with a temporary mirrored partner 0.9 m in front (same clip), removed afterwards.
Outputs <OUT>/<clip>-f<frame>-<view>.png (default: preview/output/actions-review/, ignored by git).
"""
import bpy, math, sys
from pathlib import Path
from mathutils import Vector, Matrix

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import importlib, variant_spec
importlib.reload(variant_spec)
from variant_spec import ACTION_CLIPS

ONLY = globals().get('ONLY') or list(ACTION_CLIPS)
OUT = Path(globals().get('OUT') or HERE.parent.parent / 'output' / 'actions-review')
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes['Jolly • Base character studio']
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
except Exception:
    pass
scene.cycles.samples = 24
scene.render.resolution_x, scene.render.resolution_y = 520, 600
rig = scene.objects['MuseRig']
body, face = scene.objects['Jolly_Base'], scene.objects['Jolly_Face']
camera, floor = scene.camera, scene.objects['Studio ground']
for c in bpy.data.collections:
    if c.get('musely_variant'):
        c.hide_render = c['musely_variant'] != 'props'  # shared action props stay visible
props = {o.get('musely_clip'): o for o in bpy.data.objects if o.get('musely_kind') == 'prop' and o.get('musely_clip')}

FRAMES = {'drink': [0, 30, 48], 'plant': [0, 36, 66, 96], 'high_five': [0, 12, 24, 40]}
for _n, _s in ACTION_CLIPS.items():
    FRAMES.setdefault(_n, [_s['contact']] if 'contact' in _s else [_s['frames'] // 4, _s['frames'] // 2, 3 * _s['frames'] // 4])
if globals().get('MID_ONLY'):
    FRAMES = {n: [f[len(f) // 2]] for n, f in FRAMES.items()}
VIEWS = {'drink': {'side': (2.6, -1.2, .7), 'front': (.9, -2.8, .7)},
         'plant': {'side': (2.8, -.9, .6), 'front': (.9, -2.8, .7)},
         'high_five': {'side': (5.2, -.45, .8), 'above': (3.4, 2.2, 2.6)}}
TWO = {n for n, s in ACTION_CLIPS.items() if 'partner' in s}
for _n in TWO:
    VIEWS.setdefault(_n, VIEWS['high_five'])
for _n in ACTION_CLIPS:
    VIEWS.setdefault(_n, {'front': (1.2, -2.8, .75)})
TARGET = {n: Vector((0, -.45, .45)) for n in TWO}


def shot(path, loc, target):
    camera.location = loc
    camera.rotation_euler = (target - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    floor.rotation_euler.z = math.atan2(loc[0] - target.x, -(loc[1] - target.y))
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def partner():
    r2 = rig.copy(); r2.data = rig.data; scene.collection.objects.link(r2)
    r2.matrix_world = Matrix.Translation((0, -.9, 0)) @ Matrix.Rotation(math.pi, 4, 'Z')
    made = [r2]
    for ob in (body, face):
        o2 = ob.copy(); scene.collection.objects.link(o2); o2.parent = r2
        o2.matrix_parent_inverse = ob.matrix_parent_inverse.copy()
        for m in o2.modifiers:
            if m.type == 'ARMATURE':
                m.object = r2
        made.append(o2)
    return made


done = []
for name in ONLY:
    a = bpy.data.actions[name]
    extra = partner() if name in TWO else []
    rig.animation_data.action = a; rig.animation_data.action_slot = a.slots[0]
    for ob in [o for o in extra if o.type == 'ARMATURE']:
        pa = bpy.data.actions[ACTION_CLIPS[name]['partner']]
        ob.animation_data.action = pa; ob.animation_data.action_slot = pa.slots[0]
    for clip, o in props.items():
        o.hide_render = clip != name  # a prop shows only during its own clip, as at runtime
    for f in FRAMES[name]:
        scene.frame_set(f + 1)
        for view, loc in VIEWS[name].items():
            p = OUT / f'{name}-f{f:02d}-{view}.png'
            shot(p, loc, TARGET.get(name, Vector((0, 0, .45))))
            done.append(p.name)
    for ob in extra:
        bpy.data.objects.remove(ob, do_unlink=True)
rig.animation_data.action = None
for b in rig.pose.bones:
    b.rotation_quaternion = (1, 0, 0, 0); b.location = (0, 0, 0); b.scale = (1, 1, 1)
for c in bpy.data.collections:
    if c.get('musely_variant'):
        c.hide_render = False
result = {'rendered': done, 'out': str(OUT)}
