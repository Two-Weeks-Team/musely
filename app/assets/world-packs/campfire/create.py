import bpy, math, random, json, os
from mathutils import Vector
out=os.path.dirname(__file__); random.seed(7)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def mat(n,c,em=0):
 m=bpy.data.materials.new(n); m.diffuse_color=(*c,1); m.use_nodes=True; p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=.9
 if em:p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=em
 return m
stone=mat('warm_basalt',(.24,.23,.23)); wood=mat('charred_bark',(.09,.035,.018)); ember=mat('ember',(.9,.11,.015),2); orange=mat('outer_flame',(1,.18,.015),1.7);gold=mat('heart_flame',(1,.65,.09),2)
def ico(n,loc,scale,m):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=loc);o=bpy.context.object;o.name=n;o.scale=scale;o.data.materials.append(m);return o
for i in range(12):
 a=i*math.tau/12;ico('ring_stone_%02d'%i,(math.cos(a)*.64,math.sin(a)*.64,.12),(.16,.13,.12),stone)
for i,a in enumerate([.25,2.4,4.5]):
 bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=.09,depth=.95,location=(0,0,.19+i*.025));o=bpy.context.object;o.name='charred_log_%d'%i;o.rotation_euler=(math.pi/2,0,a);o.data.materials.append(wood)
for i in range(12):
 a=random.random()*math.tau;r=random.random()*.36;ico('coal_%02d'%i,(r*math.cos(a),r*math.sin(a),.14),(.055,.045,.04),ember)
def flame(n,x,y,h,w,m,phase):
 verts=[]; rings=[(0,w,0),(.32*h,w*.8,.03),(.7*h,w*.44,-.04)]
 for z,r,dx in rings:
  for j in range(7):
   a=j*math.tau/7;verts.append((x+dx+r*math.cos(a),y+r*math.sin(a),.23+z))
 verts.append((x+.10,y-.035,.23+h));faces=[]
 for k in range(2):
  for j in range(7):faces.append((k*7+j,k*7+(j+1)%7,(k+1)*7+(j+1)%7,(k+1)*7+j))
 for j in range(7):faces.append((14+j,14+(j+1)%7,21))
 faces.append(tuple(range(6,-1,-1)))
 mesh=bpy.data.meshes.new(n);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(n,mesh);bpy.context.collection.objects.link(o);o.data.materials.append(m)
 for f in [1,9,17,25,33,41,49]:
  o.scale=(1+.06*math.sin(f*.3+phase),1,1+.13*math.sin(f*.21+phase));o.keyframe_insert(data_path='scale',frame=f)
 return o
for i,(x,y,h,w) in enumerate([(-.16,0,.68,.14),(.15,.05,.83,.14),(0,-.15,.57,.13),(0,.04,.96,.13)]):flame('flame_%d'%i,x,y,h,w,orange,i)
flame('bright_core',0,-.20,.52,.12,gold,2)
for i in range(8):
 x=random.uniform(-.25,.25);y=random.uniform(-.2,.2);o=ico('spark_%d'%i,(x,y,random.uniform(.55,1.3)),(.012,.012,.025),gold)
asset=list(bpy.context.scene.objects)
bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=49;bpy.context.scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
for o in asset:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=out+'/campfire-prototype.glb',export_format='GLB',use_selection=True,export_animations=True)
tri=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in asset if o.type=='MESH')
json.dump({'asset':'campfire-prototype','unit':'meter','blender_up':'Z','gltf_up':'Y','origin':'ground center','triangles':tri,'objects':len(asset),'materials':len(bpy.data.materials),'integration':'not integrated','mobile_performance':'not measured','creative_source':'original procedural geometry; no third-party textures','animation':'flame scale keyframes only; sparks static'},open(out+'/metrics.json','w'),indent=2)
# Preview only: ground, lighting and camera are not exported.
ground=mat('preview_ground',(.055,.075,.065));bpy.ops.mesh.primitive_plane_add(size=200);bpy.context.object.data.materials.append(ground)
bpy.ops.object.light_add(type='AREA',location=(3,-4,5));bpy.context.object.data.energy=600;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=5
bpy.ops.object.light_add(type='POINT',location=(0,0,.6));bpy.context.object.data.energy=25;bpy.context.object.data.color=(1,.23,.03)
bpy.ops.object.camera_add(location=(2.4,-3.3,2.25));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.45))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.35;bpy.context.scene.camera=cam
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=24;s.cycles.use_denoising=False;s.render.resolution_x=800;s.render.resolution_y=800;s.render.resolution_percentage=100;s.world.color=(.13,.13,.13);s.render.filepath=out+'/preview.png'
bpy.ops.wm.save_as_mainfile(filepath=out+'/campfire-prototype.blend');bpy.ops.render.render(write_still=True)
