"""Add a reusable independent skeleton and face/action contract to the base.

Run on muse_family.blend through execute_blender_code_for_cli, after material proof.
All armature motion is in place; route translation belongs to the application.
"""
import bpy,math,json,shutil
from pathlib import Path
from mathutils import Vector,Euler,Quaternion
HERE=Path(__file__).resolve().parent
KIT=HERE.parent
scene=bpy.context.scene
obj=scene.objects['Jolly_Base']
bpy.context.view_layer.objects.active=obj
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)

bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT');bpy.ops.object.mode_set(mode='OBJECT')
# Separate the face so its morph target payload does not repeat body/fleece data.
face_group_ids={v.index for v in obj.vertex_groups if v.name.startswith('part:') and v.name.split(':')[1] in ['face','eye_L','eye_R','mouth']}
for v in obj.data.vertices:v.select=any(g.group in face_group_ids for g in v.groups)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_mode(type='VERT');bpy.ops.mesh.separate(type='SELECTED');bpy.ops.object.mode_set(mode='OBJECT')
face=next(o for o in bpy.context.selected_objects if o!=obj)
face.name='Jolly_Face'

rig_data=bpy.data.armatures.new('Muse shared skeleton')
rig=bpy.data.objects.new('MuseRig',rig_data);scene.collection.objects.link(rig)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
bone_specs={
 'Root':((0,0,0),(0,0,.08),None),
 'Hips':((0,0,.26),(0,0,.35),'Root'),
 'Spine':((0,0,.35),(0,0,.45),'Hips'),
 'Chest':((0,0,.45),(0,0,.55),'Spine'),
 'Neck':((0,0,.55),(0,0,.65),'Chest'),
 'Head':((0,0,.65),(0,0,.84),'Neck'),
}
for side,sign in [('L',1),('R',-1)]:
 bone_specs.update({
  'UpperArm_'+side:((sign*.245,0,.53),(sign*.31,-.003,.36),'Chest'),
  'Forearm_'+side:((sign*.31,-.003,.36),(sign*.345,-.017,.21),'UpperArm_'+side),
  'Hand_'+side:((sign*.345,-.017,.21),(sign*.355,-.023,.17),'Forearm_'+side),
  'UpperLeg_'+side:((sign*.115,0,.26),(sign*.115,0,.16),'Hips'),
  'LowerLeg_'+side:((sign*.115,0,.16),(sign*.115,-.015,.075),'UpperLeg_'+side),
  'Foot_'+side:((sign*.115,-.015,.075),(sign*.115,-.10,.045),'LowerLeg_'+side),
  'Toe_'+side:((sign*.115,-.10,.045),(sign*.115,-.14,.035),'Foot_'+side),
 })
for name,(head,tail,parent) in bone_specs.items():
 bone=rig_data.edit_bones.new(name);bone.head=head;bone.tail=tail
 if parent:bone.parent=rig_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front=True
for mesh in [obj,face]:
 mesh.parent=rig
 names={g.index:g.name for g in mesh.vertex_groups}
 for name in bone_specs:mesh.vertex_groups.new(name=name)
 for vertex in mesh.data.vertices:
  tag=next((names[g.group][5:] for g in vertex.groups if names.get(g.group,'').startswith('part:')),'torso')
  z=vertex.co.z
  if mesh==face:weights={'Head':1}
  elif tag.startswith('arm'):
   side=tag[-1];t=max(0,min(1,(.43-z)/.14))
   weights={'UpperArm_'+side:1-t,'Forearm_'+side:t}
   if z<.235:weights={'Forearm_'+side:max(0,(z-.17)/.065),'Hand_'+side:1-max(0,(z-.17)/.065)}
   if z>.49:
    t=max(0,min(1,(z-.49)/.06));weights={'UpperArm_'+side:1-t,'Chest':t}
  elif tag.startswith('foot'):weights={'Foot_'+tag[-1]:1}
  else:
   anchors=[(.26,'Hips'),(.40,'Spine'),(.49,'Chest'),(.57,'Neck'),(.65,'Head')]
   weights={'Hips':1} if z<=.26 else {'Head':1}
   for (a,an),(b,bn) in zip(anchors,anchors[1:]):
    if a<=z<=b:
     t=(z-a)/(b-a);t=t*t*(3-2*t);weights={an:1-t,bn:t};break
  for name,w in weights.items():
   if w>0:mesh.vertex_groups[name].add([vertex.index],w,'REPLACE')
 # Remove the authoring tags so they do not become exported deform groups.
 for g in list(mesh.vertex_groups):
  if g.name.startswith('part:'):mesh.vertex_groups.remove(g)
 mod=mesh.modifiers.new('Independent Muse skin','ARMATURE');mod.object=rig;mod.use_deform_preserve_volume=True

# The small facial motions preserve the original neutral eye spacing and face shape.
part={}
for polygon in face.data.polygons:
 mat=face.data.materials[polygon.material_index].name
 for vi in polygon.vertices:
  v=face.data.vertices[vi]
  part[vi]=('eye_L' if v.co.x>0 else 'eye_R') if mat=='Glossy eyes' else 'mouth' if mat=='Soft smile' else 'face'
face.shape_key_add(name='Basis')
presets=['Smile','Curious','Thinking','Focused','Listening','Concerned','Delight','Blink_L','Blink_R','MouthOpen']
for name in presets:
 key=face.shape_key_add(name=name);key.value=0
 for v in face.data.vertices:
  p=v.co.copy();kind=part[v.index]
  if kind.startswith('eye'):
   side=kind[-1];cx=.095 if side=='L' else -.095
   if name=='Blink_'+side:p.z=.704+(p.z-.704)*.08
   if name=='Smile':p.z=.704+(p.z-.704)*.87
   if name=='Curious':p.z=.704+(p.z-.704)*(1.15 if side=='L' else .95)
   if name=='Thinking':p.x+=.003;p.z+=.003
   if name=='Focused':p.z=.704+(p.z-.704)*.73
   if name=='Listening':p.z=.704+(p.z-.704)*1.08
   if name=='Concerned':p.z+=.002;p.x=cx+(p.x-cx)*.9
   if name=='Delight':p.z=.706+(p.z-.704)*.48
  if kind=='mouth':
   bend=.011*(p.x/.033)**2
   if name in ['Smile','Delight']:p.x*=1.16;p.z-=.002
   if name=='Concerned':p.z-=2*bend-.009
   if name=='Focused':p.z-=bend*.75;p.x*=.75
   if name=='Thinking':p.x*=.65;p.x+=.005
   if name=='Curious':p.x*=.85
   if name=='MouthOpen':p.z=.649+(p.z-.644-bend)*4.8;p.x*=.55
  if kind=='face' and name in ['Smile','Delight'] and abs(p.x)>.085 and p.z<.69:p.z+=.0015
  key.data[v.index].co=p

socket_specs={'Socket_Head':('Head',(0,0,.89)),'Socket_Hand_L':('Hand_L',(.355,-.023,.17)),'Socket_Hand_R':('Hand_R',(-.355,-.023,.17)),'Socket_Back':('Chest',(0,.17,.48)),'Socket_Chest':('Chest',(0,-.17,.47)),'SigilSocket':('Head',(0,-.154,.845))}
bpy.context.view_layer.update()
for name,(bone,pos) in socket_specs.items():
 socket=bpy.data.objects.new(name,None);scene.collection.objects.link(socket);socket.empty_display_size=.025;socket.parent=rig;socket.parent_type='BONE';socket.parent_bone=bone
 socket.matrix_world.translation=Vector(pos)

rig.animation_data_create()
rests={n:b.matrix_local.to_quaternion() for n,b in rig.data.bones.items()}
def rotate(name,angles):
 q=rests[name];rig.pose.bones[name].rotation_quaternion=q.inverted()@Euler(angles,'XYZ').to_quaternion()@q
for pb in rig.pose.bones:pb.rotation_mode='QUATERNION'
clip_specs={'idle_breathe':(96,True),'walk':(32,True),'look_around':(96,True),'think':(96,True),'listen':(72,True),'talk':(72,True),'wave':(60,False),'sit_down':(36,False),'sit_idle':(96,True),'stand_up':(36,False),'celebrate':(60,False),'offer_item':(60,False)}
for name,(duration,loop) in clip_specs.items():
 action=bpy.data.actions.new(name);action.use_fake_user=True
 slot=action.slots.new('OBJECT',rig.name);rig.animation_data.action=action;rig.animation_data.action_slot=slot
 for frame in range(1,duration+2,2):
  t=(frame-1)/duration;phase=math.tau*t
  for pb in rig.pose.bones:pb.rotation_quaternion=Quaternion();pb.location=(0,0,0);pb.scale=(1,1,1)
  if name=='idle_breathe':
   rotate('Chest',(.008*math.sin(phase),0,0));rotate('Head',(0,0,.01*math.sin(phase)));rig.pose.bones['Chest'].scale=(1+.006*math.sin(phase),1,1+.004*math.sin(phase))
  if name=='walk':
   for side,shift in [('L',0),('R',math.pi)]:
    v=math.sin(phase+shift)
    rotate('UpperLeg_'+side,(-.32*v,0,0));rotate('LowerLeg_'+side,(max(0,v)*.5,0,0));rotate('Foot_'+side,(-max(0,v)*.18,0,0));rotate('UpperArm_'+side,(.27*v,0,0))
   rotate('Hips',(0,.018*math.sin(phase),.025*math.sin(phase)));rig.pose.bones['Hips'].location.y=.002*(1-math.cos(phase*2))
  if name=='look_around':rotate('Head',(-.03,0,.33*math.sin(phase)));rotate('Neck',(0,0,.07*math.sin(phase)))
  if name=='think':rotate('UpperArm_R',(-.45,-.5,0));rotate('Forearm_R',(-1.45,0,0));rotate('Head',(.06,0,-.10+.015*math.sin(phase)))
  if name=='listen':rotate('Head',(.045*math.sin(phase*2),-.04,0));rotate('Chest',(-.025,0,0))
  if name=='talk':
   rotate('Head',(.025*math.sin(phase*3),0,.035*math.sin(phase)));rotate('UpperArm_L',(-.2-.12*math.sin(phase*2),-.2,0));rotate('Forearm_L',(-.28-.18*math.sin(phase*2),0,0));rotate('UpperArm_R',(-.10,.1,0))
  if name=='wave':
   envelope=min(1,t/.2,(1-t)/.2);rotate('UpperArm_R',(0,1.85*envelope,0));rotate('Forearm_R',(.14*math.sin(phase*4)*envelope,.22*math.sin(phase*4)*envelope,0));rotate('Hand_R',(0,.24*math.sin(phase*4)*envelope,0));rotate('Head',(0,0,.045*envelope))
  if name in ['sit_down','sit_idle','stand_up']:
   v=1 if name=='sit_idle' else t*t*(3-2*t) if name=='sit_down' else 1-t*t*(3-2*t)
   rig.pose.bones['Hips'].location.y=-.055*v
   for side in ['L','R']:rotate('UpperLeg_'+side,(-1.1*v,0,0));rotate('LowerLeg_'+side,(1.10*v,0,0));rotate('Foot_'+side,(0,0,0));rotate('UpperArm_'+side,(-.2*v,0,0))
   rotate('Chest',(.05*v,0,0))
  if name=='celebrate':
   v=math.sin(math.pi*t)**2;rotate('UpperArm_L',(0,-1.65*v,0));rotate('UpperArm_R',(0,1.65*v,0));rotate('Forearm_L',(-.18*v,0,0));rotate('Forearm_R',(-.18*v,0,0));rotate('Head',(-.06*v,0,0))
  if name=='offer_item':
   v=math.sin(math.pi*t)**2
   for side in ['L','R']:rotate('UpperArm_'+side,(-.75*v,0,0));rotate('Forearm_'+side,(-.45*v,0,0))
   rotate('Head',(.06*v,0,0))
  for pb in rig.pose.bones:
   pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)
   if pb.name in ['Hips','Chest']:pb.keyframe_insert('location',frame=frame,group=pb.name);pb.keyframe_insert('scale',frame=frame,group=pb.name)
 track=rig.animation_data.nla_tracks.new();track.name=name
 strip=track.strips.new(name,1,action);strip.action_slot=slot;strip.action_frame_start=1;strip.action_frame_end=duration+1;track.mute=True
rig.animation_data.action=None
for pb in rig.pose.bones:pb.rotation_quaternion=Quaternion();pb.location=(0,0,0);pb.scale=(1,1,1)
scene.frame_set(1);bpy.context.view_layer.update()
source=HERE/'muse_family.blend'
bpy.data.libraries.write(str(source),{scene},path_remap='RELATIVE',fake_user=True)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);obj.select_set(True);face.select_set(True)
for socket in scene.objects:
 if socket.name in socket_specs:socket.select_set(True)
bpy.context.view_layer.objects.active=rig
target=KIT/'runtime/base/lod0.glb'
bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_animations=True,export_animation_mode='ACTIONS',export_anim_slide_to_zero=True,export_skins=True,export_morph=True,export_morph_normal=False,export_tangents=True,export_materials='EXPORT',export_extras=True)
shutil.copy2(target,KIT/'portable/00-jolly/lod0.glb')
manifest={'schema':'musely.base-clips.v1','fps':24,'rootMotion':'in-place; world routes own translation/yaw','walkStrideMeters':.27,'sitAnchor':'Hips lowers 0.055m; seat alignment is owned by the world adapter','clips':[{'name':n,'seconds':f/24,'loop':loop} for n,(f,loop) in clip_specs.items()],'sockets':{name:{'bone':bone,'neutralBlenderWorld':list(pos)} for name,(bone,pos) in socket_specs.items()},'expressions':['Neutral']+presets[:7],'controls':presets[7:]}
(KIT/'runtime/animations').mkdir(exist_ok=True);(KIT/'runtime/animations/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
metrics={'bones':len(rig.data.bones),'meshes':[obj.name,face.name],'clips':list(clip_specs),'morphs':presets,'glbBytes':target.stat().st_size,'source':str(source),'gltf':str(target)}
(KIT/'validation/rig').mkdir(exist_ok=True);(KIT/'validation/rig/base.json').write_text(json.dumps(metrics,indent=2)+'\n')
result=metrics
