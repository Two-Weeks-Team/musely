import bpy,math,os,sys
from mathutils import Vector
lod=1 if '--lod1' in sys.argv else 0
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=root+f'/region-lod{lod}.glb')
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=False
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.7,.85,1,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.6
bpy.ops.object.light_add(type='SUN',location=(500,-500,1500));bpy.context.object.rotation_euler=(.35,-.4,-.5);bpy.context.object.data.energy=3
bpy.ops.object.camera_add(location=(2300,-2600,2600));cam=bpy.context.object;direction=Vector((0,0,0))-cam.location;cam.rotation_euler=direction.to_track_quat('-Z','Y').to_euler();cam.data.clip_end=15000;cam.data.type='ORTHO';cam.data.ortho_scale=4500;scene.camera=cam
if '--near' in sys.argv:
 cam.location=(180,-260,220);cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=550
if '--entry' in sys.argv:
 cam.location=(math.sin(math.radians(12))*70,-math.cos(math.radians(12))*70,55);cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=70
scene.render.resolution_x=1200;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.render.filepath=root+('/preview-entry.png' if '--entry' in sys.argv else '/preview-near.png' if '--near' in sys.argv else '/preview-lod1.png' if lod else '/preview.png');scene.render.image_settings.file_format='PNG';bpy.ops.render.render(write_still=True)
