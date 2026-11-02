"""Re-export the neutral rigged source with portable tangent space and root skins."""
import bpy,bmesh,shutil,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
KIT=HERE.parent
scene=bpy.context.scene
for name in ['Jolly_Base','Jolly_Face']:
 obj=scene.objects[name];matrix=obj.matrix_world.copy();obj.parent=None;obj.matrix_world=matrix
 if obj.data.shape_keys:
  for key in obj.data.shape_keys.key_blocks:key.value=0
 if any(len(p.vertices)>4 for p in obj.data.polygons):
  mesh=obj.data;normals=[tuple(v.normal) for v in mesh.vertices]
  bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4]);bm.to_mesh(mesh);bm.free();mesh.update()
  assert len(normals)==len(mesh.vertices)
  mesh.normals_split_custom_set_from_vertices(normals)
 obj.data.calc_tangents(uvmap='UVMap')
rig=scene.objects['MuseRig'];rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:track.mute=True
for b in rig.pose.bones:b.rotation_quaternion=(1,0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
scene.frame_set(1);bpy.context.view_layer.update()
bpy.data.libraries.write(str(HERE/'muse_family.blend'),{scene},path_remap='RELATIVE',fake_user=True)
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
 if obj.name in ['MuseRig','Jolly_Base','Jolly_Face','Socket_Head','Socket_Hand_L','Socket_Hand_R','Socket_Back','Socket_Chest','SigilSocket']:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
target=KIT/'runtime/base/lod0.glb'
bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_animations=True,export_animation_mode='ACTIONS',export_anim_slide_to_zero=True,export_skins=True,export_morph=True,export_morph_normal=False,export_tangents=True,export_materials='EXPORT',export_extras=True)
shutil.copy2(target,KIT/'portable/00-jolly/lod0.glb')
result={'neutral':True,'tangents':True,'skinnedMeshesAtRoot':True,'bytes':target.stat().st_size}
