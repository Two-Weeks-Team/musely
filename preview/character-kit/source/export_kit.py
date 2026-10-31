"""Export the shared runtime kit from muse_family.blend (does not save the .blend).

Writes, under character-kit/runtime/:
  base/lod0.glb   rig + body + face + sockets + 21 body clips (12 shared + 9 signature)
  base/lod1.glb   same rig/sockets, decimated body/face (face morphs transferred), 512px maps, no clips
  base/lod2.glb   same, further decimated, 256px maps, no clips
  attachments/<id>.glb  garments (skinned, own export skeleton) and bone-parented props,
                        with __lod1/__lod2 reduced copies of every part
Also writes validation/export/report.json with per-file triangle counts.
Run via run_mcp_cli.py. Set ONLY = ['base'] or a list of variant ids to limit.
"""
import bpy, bmesh, json, sys, math
from pathlib import Path
from mathutils import kdtree

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path.insert(0, str(HERE))
import importlib, variant_spec
importlib.reload(variant_spec)
from variant_spec import VARIANTS

ONLY = globals().get('ONLY')
scene = bpy.data.scenes['Jolly • Base character studio']
rig = scene.objects['MuseRig']
body, face = scene.objects['Jolly_Base'], scene.objects['Jolly_Face']
SOCKETS = ['Socket_Head', 'Socket_Hand_L', 'Socket_Hand_R', 'Socket_Back', 'Socket_Chest', 'SigilSocket']
(KIT / 'runtime/base').mkdir(parents=True, exist_ok=True)
(KIT / 'runtime/attachments').mkdir(parents=True, exist_ok=True)
(KIT / 'validation/export').mkdir(parents=True, exist_ok=True)


def neutral():
    rig.animation_data.action = None
    for t in rig.animation_data.nla_tracks:
        t.mute = True
    for b in rig.pose.bones:
        b.rotation_quaternion = (1, 0, 0, 0); b.location = (0, 0, 0); b.scale = (1, 1, 1)
    for ob in scene.objects:
        if ob.type == 'MESH' and ob.data.shape_keys:
            for k in ob.data.shape_keys.key_blocks:
                k.value = 0
    scene.frame_set(1)
    bpy.context.view_layer.update()


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def select_only(objs, active):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.hide_set(False); o.select_set(True)
    bpy.context.view_layer.objects.active = active


def export(path, objs, animations, prop_clip=False):
    select_only(objs, rig)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                              export_animations=animations, export_animation_mode='ACTIVE_ACTIONS' if prop_clip else 'ACTIONS',
                              export_nla_strips_merged_animation_name='read_book', export_anim_slide_to_zero=True,
                              export_skins=True, export_morph=True, export_morph_normal=False, export_tangents=True,
                              export_materials='EXPORT', export_extras=True)
    return path.stat().st_size


def duplicate(ob, name):
    new = ob.copy(); new.data = ob.data.copy(); new.name = name; new.data.name = name
    for c in ob.users_collection:
        c.objects.link(new)
    return new


def decimate(ob, ratio):
    """Collapse-decimate a mesh; shape keys are rebuilt by nearest-vertex delta transfer."""
    keys = None
    if ob.data.shape_keys:
        src = ob.data
        basis = [v.co.copy() for v in src.shape_keys.key_blocks[0].data]
        keys = [(k.name, [kb.co - basis[i] for i, kb in enumerate(k.data)]) for k in src.shape_keys.key_blocks[1:]]
        tree = kdtree.KDTree(len(basis))
        for i, co in enumerate(basis):
            tree.insert(co, i)
        tree.balance()
        select_only([ob], ob)
        bpy.ops.object.shape_key_remove(all=True)
    m = ob.modifiers.new('LOD', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = ratio; m.use_collapse_triangulate = True
    select_only([ob], ob)
    bpy.ops.object.modifier_apply(modifier=m.name)
    clean(ob)  # before shape keys are rebuilt, so topology cleanup cannot desynchronize them
    if keys:
        ob.shape_key_add(name='Basis')
        nearest = [tree.find(v.co)[1] for v in ob.data.vertices]
        for name, deltas in keys:
            k = ob.shape_key_add(name=name); k.value = 0
            for i, v in enumerate(ob.data.vertices):
                k.data[i].co = v.co + deltas[nearest[i]]
    clean(ob)
    return ob


def clean(ob):
    """Portable geometry: no degenerate faces or loose vertices (unit normals), no n-gons (tangents)."""
    me = ob.data
    keys = me.shape_keys
    bm = bmesh.new(); bm.from_mesh(me)
    if not keys:
        bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    loose = [v for v in bm.verts if not v.link_faces]
    if loose and not keys:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    ng = [f for f in bm.faces if len(f.verts) > 4]
    if ng:
        bmesh.ops.triangulate(bm, faces=ng)
    bm.to_mesh(me); bm.free(); me.update()
    return ob


_scaled = {}
def downsize_materials(objs, size):
    """Point LOD copies at downsized copies of their textures (not saved)."""
    for ob in objs:
        for slot in ob.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            key = (m.name, size)
            if key not in _scaled:
                mc = m.copy(); mc.name = f'{m.name}'  # exporter uses material name; keep readable
                for n in mc.node_tree.nodes:
                    if n.type == 'TEX_IMAGE' and n.image:
                        ik = (n.image.name, size)
                        if ik not in _scaled:
                            img = n.image.copy(); img.name = f'{n.image.name.rsplit(".", 1)[0]}-{size}'
                            if img.size[0] > size:
                                img.scale(size, size)
                            img.pack()
                            _scaled[ik] = img
                        n.image = _scaled[ik]
                _scaled[key] = mc
            slot.material = _scaled[key]


report_path = KIT / 'validation/export/report.json'
report = json.loads(report_path.read_text()) if ONLY and report_path.exists() else {'base': {}, 'attachments': {}}
neutral()
sockets = [scene.objects[s] for s in SOCKETS]

if not ONLY or 'base' in ONLY:
    report['base']['lod0'] = {'bytes': export(KIT / 'runtime/base/lod0.glb', [rig, body, face] + sockets, True),
                              'tris': tris(body) + tris(face), 'clips': len([a for a in bpy.data.actions])}
    for lod, (rb, rf, size) in {1: (.15, .55, 512), 2: (.075, .14, 256)}.items():
        b = decimate(duplicate(body, f'Jolly_Base_LOD{lod}'), rb)
        f = decimate(duplicate(face, f'Jolly_Face_LOD{lod}'), rf)
        downsize_materials([b, f], size)
        report['base'][f'lod{lod}'] = {'bytes': export(KIT / f'runtime/base/lod{lod}.glb', [rig, b, f] + sockets, False),
                                      'tris': tris(b) + tris(f), 'faceMorphs': [k.name for k in f.data.shape_keys.key_blocks[1:]]}
        bpy.data.objects.remove(b, do_unlink=True); bpy.data.objects.remove(f, do_unlink=True)

for v in VARIANTS:
    vid = v['id']
    coll = bpy.data.collections.get(f'Variant {vid}')
    if coll is None or (ONLY and vid not in ONLY):
        continue
    parts = list(coll.objects)
    for p in parts:
        clean(p)
    out = list(parts)
    info = {'lod0': sum(tris(p) for p in parts)}
    for lod, ratio, size in ((1, .3, 128), (2, .12, 64)):
        lods = []
        for p in parts:
            d = duplicate(p, f'{p.name}__lod{lod}')
            d.parent = p.parent; d.parent_type = p.parent_type; d.parent_bone = p.parent_bone
            d.matrix_parent_inverse = p.matrix_parent_inverse.copy()
            for k in p.keys():
                d[k] = p[k]
            d['musely_lod'] = lod
            decimate(d, ratio)
            lods.append(d)
        downsize_materials(lods, size)
        info[f'lod{lod}'] = sum(tris(d) for d in lods)
        out += lods
    for p in parts:
        p['musely_lod'] = 0
    # ACTIVE_ACTIONS merges only the assigned page actions, not the rig's 21 NLA clips.
    prop_clip = any(p.animation_data and p.animation_data.action for p in parts)
    info['bytes'] = export(KIT / f'runtime/attachments/{vid}.glb', [rig] + out, prop_clip, prop_clip)
    report['attachments'][vid] = info
    for d in out:
        if d not in parts:
            bpy.data.objects.remove(d, do_unlink=True)

(KIT / 'validation/export/report.json').write_text(json.dumps(report, indent=2) + '\n')
result = report
