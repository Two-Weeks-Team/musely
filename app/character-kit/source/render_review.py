"""Render unobstructed front/quarter/side/back checks from the rigged source."""
import bpy,math,json
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
scene=bpy.context.scene;rig=scene.objects['MuseRig'];rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:track.mute=True
for bone in rig.pose.bones:bone.rotation_quaternion=(1,0,0,0);bone.location=(0,0,0);bone.scale=(1,1,1)
for obj in scene.objects:
 if obj.type=='MESH' and obj.data.shape_keys:
  for key in obj.data.shape_keys.key_blocks:key.value=0
camera=scene.camera;floor=scene.objects['Studio ground'];out=HERE.parent/'validation/visual'
views={'front':(0,-3,.46),'three-quarter':(1.4,-2.8,1.15),'side':(3,0,.46),'back':(0,3,.46)}
for name,loc in views.items():
 camera.location=loc;camera.rotation_euler=(Vector((0,0,.45))-camera.location).to_track_quat('-Z','Y').to_euler()
 # The cove must stay behind the character for every review direction.
 floor.rotation_euler.z=math.atan2(loc[0],-loc[1]);scene.render.filepath=str(out/(name+'.png'))
 bpy.ops.render.render(write_still=True)
result={'riggedViews':list(views),'backdropBehindCharacter':True}
