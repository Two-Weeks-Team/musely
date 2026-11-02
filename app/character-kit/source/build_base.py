"""Author a new isolated Jolly scene. Run via the official Blender MCP.

The existing Blender scenes and canonical assets are never reset or saved over.
The companion rig_base.py adds the shared rig after the material proof gate.
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
scene = bpy.data.scenes.new('Jolly • Base character studio')
bpy.context.window.scene = scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 800
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
scene.render.film_transparent = False
world = bpy.data.worlds.new('Jolly studio world')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.34, .38, .43, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .35

def material(name, rgb, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    def linear(v): return v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4
    p.inputs['Base Color'].default_value = tuple(linear(c/255) for c in rgb)+(1,)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = 0
    p.inputs['Emission Strength'].default_value = 0
    return m

def image_node(mat, filename, noncolor=False):
    image = bpy.data.images.load(str(HERE/'textures'/filename), check_existing=True)
    image.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
    image.pack()
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    node.interpolation = 'Linear'
    return node

fleece = material('Fleece', (222,205,178), .84)
p = fleece.node_tree.nodes.get('Principled BSDF')
p.inputs['Sheen Weight'].default_value = .18
p.inputs['Sheen Roughness'].default_value = .7
base = image_node(fleece, 'fleece-color.png')
fleece.node_tree.links.new(base.outputs['Color'],p.inputs['Base Color'])
normal = image_node(fleece, 'fleece-normal.png', True)
nmap = fleece.node_tree.nodes.new('ShaderNodeNormalMap')
nmap.inputs['Strength'].default_value = .45
fleece.node_tree.links.new(normal.outputs['Color'], nmap.inputs['Color'])
fleece.node_tree.links.new(nmap.outputs['Normal'], p.inputs['Normal'])
orm = image_node(fleece, 'fleece-orm.png', True)
sep = fleece.node_tree.nodes.new('ShaderNodeSeparateColor')
fleece.node_tree.links.new(orm.outputs['Color'], sep.inputs['Color'])
fleece.node_tree.links.new(sep.outputs['Green'], p.inputs['Roughness'])
fleece.node_tree.links.new(sep.outputs['Blue'], p.inputs['Metallic'])
face_mat = material('Warm face', (244,220,185), .76)
face_tex = image_node(face_mat,'face-color.png')
face_mat.node_tree.links.new(face_tex.outputs['Color'],face_mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
eye_mat = material('Glossy eyes', (23,21,20), .12)
mouth_mat = material('Soft smile', (55,41,32), .69)
MATS = [fleece,face_mat,eye_mat,mouth_mat]
vertices, faces, uvcoords, slots, parts = [], [], [], [], []

def mesh_part(vs, fs, uvs, slot, tag):
    offset=len(vertices)
    vertices.extend(vs)
    faces.extend([tuple(offset+i for i in f) for f in fs])
    uvcoords.extend(uvs)
    slots.extend([slot]*len(fs))
    parts.extend([tag]*len(vs))

def signed(x,e): return math.copysign(abs(x)**e,x)

def ellipsoid(center, radii, slot, tag, segments=32, rings=18, exponent=1, lean=0, face_uv=False, smile=False):
    vs=[]; uvs=[]; fs=[]
    for j in range(rings+1):
        lat=-math.pi/2+math.pi*j/rings
        for k in range(segments+1):
            a=math.tau*k/segments
            px=radii[0]*signed(math.cos(lat),exponent)*signed(math.cos(a),exponent)
            py=radii[1]*signed(math.cos(lat),exponent)*signed(math.sin(a),exponent)
            pz=radii[2]*signed(math.sin(lat),exponent)
            x=px+center[0]+lean*pz
            y=py+center[1]
            z=pz+center[2]+(.011*(px/.033)**2 if smile else 0)
            vs.append((x,y,z));uvs.append((px/(2*radii[0])+.5,pz/(2*radii[2])+.5) if face_uv else (k/segments,j/rings))
    for j in range(rings):
        for k in range(segments):
            i=j*(segments+1)+k
            fs.append((i,i+1,i+segments+2,i+segments+1))
    mesh_part(vs,fs,uvs,slot,tag)

profile=[(.105,.025,.04),(.12,.15,.105),(.16,.22,.145),(.23,.266,.173),(.31,.288,.185),(.39,.286,.184),(.47,.268,.172),(.55,.247,.158),(.63,.244,.154),(.70,.244,.155),(.76,.231,.149),(.81,.205,.134),(.85,.158,.109),(.88,.092,.071),(.895,0.001,0.001)]
def profile_at(z):
    for i in range(len(profile)-1):
        a,b=profile[i:i+2]
        if a[0]<=z<=b[0]:
            t=(z-a[0])/(b[0]-a[0]);v=[]
            for d in [1,2]:
                left=profile[max(0,i-1)];right=profile[min(len(profile)-1,i+2)]
                ma=(b[d]-left[d])/(b[0]-left[0]);mb=(right[d]-a[d])/(right[0]-a[0]);span=b[0]-a[0]
                v.append(max(.001,(2*t**3-3*t*t+1)*a[d]+(t**3-2*t*t+t)*ma*span+(-2*t**3+3*t*t)*b[d]+(t**3-t*t)*mb*span))
            return v
    return profile[0][1:] if z<profile[0][0] else profile[-1][1:]

vs=[];uvs=[];fs=[]
segments=64;rings=54
for j in range(rings+1):
    z=.105+(.895-.105)*math.sin(j/rings*math.pi/2);rx,ry=profile_at(z)
    for k in range(segments+1):
        a=math.tau*k/segments
        x=rx*math.sin(a);y=-ry*math.cos(a)
        radial=(abs(x/.202)**2.667+abs((z-.689)/.142)**2.667)**(1/2.667)
        if math.cos(a)>0 and radial<1.65:
            blend=math.exp(-((radial/1.4)**8))
            target=-.100-.076*math.exp(-((radial-1.075)/.24)**2)
            y=y*(1-blend)+target*blend
        vs.append((x,y,z))
        uvs.append((k/segments,j/rings))
for j in range(rings):
    for k in range(segments):
        i=j*(segments+1)+k;fs.append((i,i+1,i+segments+2,i+segments+1))
fs += [(0,k+1,k) for k in range(1,segments)]+[(rings*(segments+1),rings*(segments+1)+k,rings*(segments+1)+k+1) for k in range(1,segments)]
mesh_part(vs,fs,uvs,0,'torso')
for side in [-1,1]:
    ellipsoid((side*.304,-.003,.355),(.066,.083,.194),0,'arm_'+('L' if side>0 else 'R'),28,20,.84,side*-.31)
    ellipsoid((side*.115,-.027,.083),(.093,.12,.083),0,'foot_'+('L' if side>0 else 'R'),32,16,.68)

# The face sits behind a sculpted opening in the continuous fleece surface.
ellipsoid((0,-.122,.689),(.205,.045,.138),1,'face',48,24,.75,face_uv=True)
for side in [-1,1]:
    ellipsoid((side*.095,-.168,.704),(.018,.011,.019),2,'eye_'+('L' if side>0 else 'R'),24,12)
ellipsoid((0,-.168,.644),(.030,.003,.0032),3,'mouth',32,10,smile=True)

# Sparse opaque short tufts supplement the portable fiber normal map.
# They use the same fleece material and never require an alpha/hair shader.
random.seed(240731)
tuft_normals={}
surface=[];weights=[]
for f,slot in zip(faces,slots):
    if slot!=0 or len(f)!=4:continue
    a,b,c=[Vector(vertices[i]) for i in f[:3]];cross=(b-a).cross(c-a)
    if cross.length<1e-10:continue
    surface.append((f,cross.normalized()));weights.append(cross.length)
for f,normal in random.choices(surface,weights=weights,k=2700):
    a,b,c=[Vector(vertices[i]) for i in f[:3]]
    u=random.random();v=random.random()
    if u+v>1:u,v=1-u,1-v
    root=a*(1-u-v)+b*u+c*v;tag=parts[f[0]]
    if root.z<.015:continue
    if tag=='torso' and root.y<-.02 and abs(root.x)<.184 and .567<root.z<.817:continue
    uv=tuple(uvcoords[f[0]][d]*(1-u-v)+uvcoords[f[1]][d]*u+uvcoords[f[2]][d]*v for d in [0,1])
    tangent=normal.cross(Vector((0,0,1)))
    if tangent.length<.1:tangent=Vector((1,0,0))
    tangent.normalize();direction=(normal*.85+Vector((0,0,-.15))).normalized()
    length=random.uniform(.003,.0075);width=random.uniform(.00035,.00075)
    tip=root+direction*length
    for vi in range(len(vertices),len(vertices)+4):tuft_normals[vi]=tuple(normal)
    mesh_part([tuple(root-tangent*width),tuple(root+tangent*width),tuple(tip),tuple(root+normal*length*.22)],[(0,1,2),(1,3,2),(3,0,2)],[(uv[0]-.0005,uv[1]),(uv[0]+.0005,uv[1]),(uv[0],uv[1]-.003),(uv[0]+.0002,uv[1]-.001)],0,tag)

mesh=bpy.data.meshes.new('Jolly authored surface')
mesh.from_pydata(vertices,[],faces);mesh.update()
obj=bpy.data.objects.new('Jolly_Base',mesh);scene.collection.objects.link(obj)
for m in MATS:mesh.materials.append(m)
uv=mesh.uv_layers.new(name='UVMap')
for poly,slot in zip(mesh.polygons,slots):
    poly.material_index=slot;poly.use_smooth=True
    for li in poly.loop_indices:uv.data[li].uv=uvcoords[mesh.loops[li].vertex_index]
mesh.update()
mesh.normals_split_custom_set_from_vertices([tuft_normals.get(v.index,tuple(v.normal)) for v in mesh.vertices])
for tag in set(parts):
    vg=obj.vertex_groups.new(name='part:'+tag);vg.add([i for i,t in enumerate(parts) if t==tag],1,'REPLACE')
obj['character_basis']='Community-authored Muse/Jolly interpretation from supplied frontal reference; side/back authored.'
obj['scale_height_m']=.9;obj['reference_id']='ref-jolly-front-card-20261031'

def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
def area(name,location,power,size,color):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=location;aim(o,(0,0,.48));return o
area('Studio softbox • key',(-1.6,-2.4,2.8),140,2.3,(1,.89,.75))
area('Studio softbox • fill',(1.8,-1.1,1.6),65,2.0,(.80,.88,1))
area('Studio softbox • rim',(.5,1.3,2.2),190,1.6,(1,.95,.85))
ground_mat=material('Studio backdrop',(229,225,216),.9)
gm=bpy.data.meshes.new('Studio ground');profile_ground=[(-6,-.003),(2,-.003)]+[(2+2*math.sin(a),2-2*math.cos(a)-.003) for a in [i*math.pi/32 for i in range(1,17)]]+[(4,10)];gv=[(x,y,z) for y,z in profile_ground for x in [-30,30]];gf=[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(profile_ground)-1)];gm.from_pydata(gv,[],gf);gm.materials.append(ground_mat)
[setattr(poly,'use_smooth',True) for poly in gm.polygons];floor=bpy.data.objects.new('Studio ground',gm);scene.collection.objects.link(floor)
camera_data=bpy.data.cameras.new('Character review camera');camera=bpy.data.objects.new('Character review camera',camera_data);scene.collection.objects.link(camera);scene.camera=camera
camera_data.type='ORTHO';camera_data.ortho_scale=1.11;camera.location=(0,-3,.48);aim(camera,(0,0,.45))
scene.render.fps=24;scene.frame_start=1;scene.frame_end=96
bpy.context.view_layer.objects.active=obj;obj.select_set(True)
bpy.context.view_layer.update()
source=HERE/'muse_family.blend'
bpy.data.libraries.write(str(source),{scene},path_remap='RELATIVE',fake_user=True)
bpy.data.libraries.write(str(HERE/'muse_material.blend'),{scene},path_remap='RELATIVE',fake_user=True)
(KIT/'runtime/base').mkdir(parents=True,exist_ok=True)
(KIT/'portable/00-jolly').mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
target=KIT/'runtime/base/lod0.glb'
bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_yup=True,export_apply=False,export_animations=False,export_skins=False,export_morph=False,export_tangents=True,export_materials='EXPORT',export_extras=True)
review=KIT/'validation/visual';review.mkdir(parents=True,exist_ok=True)
views={'front':(0,-3,.46),'three-quarter':(1.4,-2.8,1.15),'side':(3,0,.46),'back':(0,3,.46)}
for name,loc in views.items():
    camera.location=loc;floor.rotation_euler.z=math.atan2(loc[0],-loc[1]);aim(camera,(0,0,.45));scene.render.filepath=str(review/(name+'.png'));bpy.ops.render.render(write_still=True)
camera.location=(0,-3,.48);aim(camera,(0,0,.45))
metrics={'stage':'shape and portable materials','vertices':len(vertices),'triangles':sum(len(p.vertices)-2 for p in mesh.polygons),'bounds':{'min':[min(v[k] for v in vertices) for k in range(3)],'max':[max(v[k] for v in vertices) for k in range(3)]},'source':str(source),'glb':str(target),'views':list(views),'oldFileNotSaved':True}
(KIT/'validation/base-shape.json').write_text(json.dumps(metrics,indent=2)+'\n')
result=metrics
