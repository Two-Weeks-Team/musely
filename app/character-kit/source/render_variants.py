"""Render per-variant review views (neutral front, three-quarter, signature pose, back).

Run on muse_family.blend via run_mcp_cli.py. Does not save the .blend.
Optional: set ONLY = ['02-moss'] before running to limit variants.
Outputs character-kit/validation/visual/variants/<id>-<view>.png
"""
import bpy, math, sys
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import importlib, variant_spec
importlib.reload(variant_spec)
from variant_spec import VARIANTS, SIGNATURE_CLIPS

ONLY = globals().get('ONLY')
OUT = HERE.parent / 'validation' / 'visual' / 'variants'
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes['Jolly • Base character studio']
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
except Exception:
    pass
scene.cycles.samples = 32
scene.render.resolution_x, scene.render.resolution_y = 600, 700
rig = scene.objects['MuseRig']
rig.animation_data.action = None
for t in rig.animation_data.nla_tracks:
    t.mute = True
body, face = scene.objects['Jolly_Base'], scene.objects['Jolly_Face']
camera, floor = scene.camera, scene.objects['Studio ground']
fleece = bpy.data.materials['Fleece']
variant_colls = {c['musely_variant']: c for c in bpy.data.collections if c.get('musely_variant')}


def set_fleece(m):
    for ob in (body, face):
        for slot in ob.material_slots:
            if slot.material and (slot.material == fleece or slot.material.name.startswith('Review fleece')):
                slot.material = m


def rest():
    rig.animation_data.action = None
    for b in rig.pose.bones:
        b.rotation_quaternion = (1, 0, 0, 0); b.location = (0, 0, 0); b.scale = (1, 1, 1)
    scene.frame_set(1)


def pose(action_name, frac):
    a = bpy.data.actions[action_name]
    rig.animation_data.action = a
    rig.animation_data.action_slot = a.slots[0]
    f0, f1 = a.frame_range
    scene.frame_set(int(f0 + (f1 - f0) * frac))


def shot(path, loc, target_z=.45):
    camera.location = loc
    camera.rotation_euler = (Vector((0, 0, target_z)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    floor.rotation_euler.z = math.atan2(loc[0], -loc[1])
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


done = []
for v in VARIANTS:
    vid = v['id']
    if ONLY and vid not in ONLY:
        continue
    for k, c in variant_colls.items():
        c.hide_render = (k != vid)
    rf = bpy.data.materials.get(f'Review fleece {vid}', fleece)
    set_fleece(rf)
    rest()
    shot(OUT / f'{vid}-front.png', (0, -3, .46))
    shot(OUT / f'{vid}-three-quarter.png', (1.4, -2.8, 1.15))
    shot(OUT / f'{vid}-back.png', (0, 3, .46))
    if v['signature']:
        pose(v['signature'], .5 if SIGNATURE_CLIPS[v['signature']][1] else .4)
        shot(OUT / f'{vid}-signature.png', (1.1, -2.9, .8))
    rest()
    done.append(vid)
for c in variant_colls.values():
    c.hide_render = False
set_fleece(fleece)
result = {'rendered': done, 'out': str(OUT)}
