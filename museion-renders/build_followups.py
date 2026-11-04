"""Create editable Ember Split and Cold Open variants from the approved hero.
Run through mcp_client.py after visual inspection of the hero preview.
"""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector
OUT=Path.home()/'museion-renders'
hero=bpy.context.scene
hero.render.resolution_percentage=100
hero.render.filepath=str(OUT/'diorama-hero.png')
hero.cycles.samples=160
hero['Review']='Hero preview inspected for full framing, three-color palette and specified object counts.'

def clone(source,name):
    bpy.context.window.scene=source
    bpy.ops.scene.new(type='FULL_COPY')
    s=bpy.context.scene;s.name=name
    if s.compositing_node_group:
        # RLayers must point at this variant, not the source hero.
        s.compositing_node_group=s.compositing_node_group.copy()
        for n in s.compositing_node_group.nodes:
            if n.bl_idname=='CompositorNodeRLayers':n.scene=s
    return s

def material(name,color,strength):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Emission Color'].default_value=(*color,1)
    p.inputs['Emission Strength'].default_value=strength
    return m

def line(scene,name,points,radius,material):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=1
    s=c.splines.new('POLY');s.points.add(len(points)-1)
    for p,co in zip(s.points,points):p.co=(*co,1)
    c.bevel_depth=radius;c.bevel_resolution=1
    o=bpy.data.objects.new(name,c);scene.collection.objects.link(o);o.data.materials.append(material)
    return o

split=clone(hero,'02 • Ember split')
split.render.filepath=str(OUT/'ember-split.png')
trailmat=material('Ember split • warm trails',(1,.39,.075),1.6)
heartmat=material('Ember split • hearts',(1,.70,.28),1.7)
targets=[Vector(p) for p in json.loads(split['Phone targets'])]
R=Vector((9,-8,0)).normalized();B=Vector((-8,-9,0)).normalized()
start=Vector((0,0,1.63))
random.seed(18)
for side,end in enumerate(targets,1):
    sign=-1 if side==1 else 1
    c1=start+R*(sign*.35)+Vector((0,0,.63))
    c2=end+R*(-sign*.16)+Vector((0,0,.83))
    def path(t):return (1-t)**3*start+3*(1-t)**2*t*c1+3*(1-t)*t*t*c2+t**3*end
    for j in range(12):
        a=j/12;b=min(a+.042,.99)
        line(split,'Ember %d • broken flight trail %02d'%(side,j),[path(a+(b-a)*k/5) for k in range(6)],.009,trailmat)
    for j in range(9):
        t=.10+j*.095;pos=path(t)+(-B)*random.uniform(-.04,.04)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=random.uniform(.014,.028),location=pos)
        o=bpy.context.object;o.name='Ember %d • wake particle %02d'%(side,j);o.data.materials.append(trailmat)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.077,location=path(.97))
    orb=bpy.context.object;orb.name='Ember %d • arriving at phone'%side;orb.data.materials.append(heartmat)
    orb.location=path(.72);orb.keyframe_insert('location',frame=1)
    orb.location=path(.97);orb.keyframe_insert('location',frame=48)
    orb.location=end;orb.keyframe_insert('location',frame=96)
    # A small ember mark on the screen; it emits no extra light into the scene.
    markmat=material('Phone %d • ember mark'%side,(1,.45,.12),0)
    p=markmat.node_tree.nodes.get('Principled BSDF');lp=markmat.node_tree.nodes.new('ShaderNodeLightPath')
    markmat.node_tree.links.new(lp.outputs['Is Camera Ray'],p.inputs['Emission Strength'])
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.036,location=end)
    mark=bpy.context.object;mark.name='Phone %d • received ember'%side;mark.scale.z=.18;mark.data.materials.append(markmat)
split.frame_set(48)
split['Moment']='A single ember separates into two warm trails and reaches both unlit phones.'

cold=clone(hero,'03 • Cold open')
cold.render.filepath=str(OUT/'cold-open.png')
cold.camera.data.ortho_scale=25.2
target=Vector((0,0,1.15))+R*6.3
cold.camera.location=target+Vector((8,9,8))
cold.camera.rotation_euler=(target-cold.camera.location).to_track_quat('-Z','Y').to_euler()
rot=cold.camera.rotation_euler.to_matrix();right=rot@Vector((1,0,0));up=rot@Vector((0,1,0));forward=rot@Vector((0,0,-1))
origin=target+forward*20
# Restrained woodgrain / meeting-ring motif in the dark title-safe area.
pattern=bpy.data.materials.new('Cold open • camera-only grain #182235');pattern.use_nodes=True
n=pattern.node_tree.nodes;n.clear();links=pattern.node_tree.links
out=n.new('ShaderNodeOutputMaterial');mix=n.new('ShaderNodeMixShader');lp=n.new('ShaderNodeLightPath');trans=n.new('ShaderNodeBsdfTransparent');em=n.new('ShaderNodeEmission')
em.inputs['Color'].default_value=(.0091,.016,.033,1);em.inputs['Strength'].default_value=1
links.new(lp.outputs['Is Camera Ray'],mix.inputs[0]);links.new(trans.outputs[0],mix.inputs[1]);links.new(em.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],out.inputs[0])
for j in range(16):
    points=[]
    radius=.65+j*.29
    for k in range(145):
        a=k*math.tau/144
        rr=radius*(1+.037*math.sin(3*a+j*.11)+.018*math.cos(7*a+j*.19))
        x=-5.0+rr*math.cos(a)*.86;y=-.15+rr*math.sin(a)*1.24
        points.append(origin+right*x+up*y)
    o=line(cold,'Cold open • grain contour %02d'%j,points,.008,pattern)
    o.visible_shadow=False
cold['Title safe area']='Left 55% reserved for title / grain motif; diorama anchored at right.'
cold['Pattern']='Procedural concentric irregular woodgrain contours. Camera-only graphic; zero scene illumination.'

for s in (hero,split,cold):
    s.render.resolution_x=1920;s.render.resolution_y=1080;s.render.resolution_percentage=100
    s.render.image_settings.file_format='PNG'
    s.render.image_settings.color_mode='RGBA'
    s['Output']=s.render.filepath
bpy.context.window.scene=hero
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'museion-cafe.blend'))
print(json.dumps({'scenes':[s.name for s in (hero,split,cold)],'outputs':[s.render.filepath for s in (hero,split,cold)]}))
