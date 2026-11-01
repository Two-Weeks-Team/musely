import bpy, math, random, json, traceback, time
from pathlib import Path
from mathutils import Vector, Matrix
OUT=Path('/Users/kimsejun/museion-renders/out')
R=Vector((9,-8,0)).normalized()
B=Vector((-8,-9,0)).normalized()
U=-R
Z=Vector((0,0,1))

def rgba(h):
    c=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c)+(1,)

def material(name,color,emission=0,base_floor=.62):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=rgba(color)
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=rgba(color);p.inputs['Roughness'].default_value=.82
    p.inputs['Emission Color'].default_value=rgba(color)
    if emission:p.inputs['Emission Strength'].default_value=emission
    elif base_floor:
        lp=m.node_tree.nodes.new('ShaderNodeLightPath');mul=m.node_tree.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=base_floor
        m.node_tree.links.new(lp.outputs['Is Camera Ray'],mul.inputs[0]);m.node_tree.links.new(mul.outputs[0],p.inputs['Emission Strength'])
    return m

def link_mesh(name,vertices,faces,mat,scene=None):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);(scene or bpy.context.scene).collection.objects.link(o);o.data.materials.append(mat)
    return o

def done(o,name,mat):
    o.name=name
    if mat:o.data.materials.append(mat)
    return o

def cube(name,loc,size,mat,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Flat edge bevel','BEVEL');mod.width=bevel;mod.segments=1
    return done(o,name,mat)

def cylinder(name,loc,r,depth,mat,vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=depth,location=loc)
    return done(bpy.context.object,name,mat)

def ico(name,loc,r,mat):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=r,location=loc)
    return done(bpy.context.object,name,mat)

def line(name,points,r,mat):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=1;c.bevel_depth=r;c.bevel_resolution=1
    sp=c.splines.new('POLY');sp.points.add(len(points)-1)
    for p,co in zip(sp.points,points):p.co=(*co,1)
    o=bpy.data.objects.new(name,c);bpy.context.scene.collection.objects.link(o);o.data.materials.append(mat)
    return o

def rod(name,a,b,r,mat):
    a,b=Vector(a),Vector(b);o=cylinder(name,(a+b)/2,r,(b-a).length,mat,10);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def curves_of(action):
    if hasattr(action,'fcurves'):return list(action.fcurves)
    return [fc for layer in action.layers for strip in layer.strips if hasattr(strip,'channelbags') for cb in strip.channelbags for fc in cb.fcurves]

def interpolation(obj,value='BEZIER'):
    if obj.animation_data and obj.animation_data.action:
        for fc in curves_of(obj.animation_data.action):
            for key in fc.keyframe_points:key.interpolation=value

def clone_scene(source,name):
    assert name not in bpy.data.scenes,'Existing stage preserved: '+name
    bpy.context.window.scene=source;bpy.ops.scene.new(type='FULL_COPY');s=bpy.context.scene;s.name=name
    if s.compositing_node_group:
        s.compositing_node_group=s.compositing_node_group.copy()
        for n in s.compositing_node_group.nodes:
            if n.bl_idname=='CompositorNodeRLayers':n.scene=s
    s['Canonical source']='/Users/kimsejun/museion-renders/museion-cafe.blend :: '+source.name
    s['Method']='Blender Lab official MCP 1.0.3 / 127.0.0.1:9877'
    return s

def settings(s,samples=80,width=1920,height=1080):
    s.render.engine='CYCLES';s.cycles.device='GPU';s.cycles.samples=samples;s.cycles.use_denoising=True;s.cycles.use_adaptive_sampling=True
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='METAL'
    assert any(d.use and d.type=='METAL' for d in prefs.devices)
    s.render.resolution_x=width;s.render.resolution_y=height;s.render.resolution_percentage=100
    s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.render.image_settings.color_depth='8'

def save_checkpoint(name):
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/name),copy=True)

def queue_frames(scene_name,frames,filepath,pct=100,status='render-status.json'):
    state={'scene':scene_name,'pending':list(frames),'completed':[],'started':time.time(),'status':'queued'}
    def tick():
        try:
            s=bpy.data.scenes[scene_name];bpy.context.window.scene=s
            if not state['pending']:
                state['status']='done';state['seconds']=round(time.time()-state['started'],2)
                (OUT/status).write_text(json.dumps(state,indent=2));return None
            f=state['pending'].pop(0);s.frame_set(f);s.render.resolution_percentage=pct
            s.render.filepath=filepath.format(frame=f)
            state['status']='rendering';state['frame']=f;(OUT/status).write_text(json.dumps(state,indent=2))
            bpy.ops.render.render(write_still=True,scene=s.name)
            state['completed'].append({'frame':f,'path':s.render.filepath})
            (OUT/status).write_text(json.dumps(state,indent=2));return .05
        except Exception:
            state['status']='error';state['traceback']=traceback.format_exc();(OUT/status).write_text(json.dumps(state,indent=2));return None
    bpy.app.timers.register(tick,first_interval=2)

def enhance_flame(s):
    bpy.context.window.scene=s
    for o in list(s.objects):
        if o.name.startswith(('Fire •','Ember particle •')):bpy.data.objects.remove(o,do_unlink=True)
    colors=['#FF6826','#FF792D','#FFBE5D','#FFF0BF'];powers=[3,4.5,6,8]
    heights=[1.23,.97,.70,.40];widths=[.36,.255,.17,.085];depths=[.16,.12,.09,.055]
    all_flames=[]
    for layer in range(4):
        rng=random.Random(903+layer);verts=[];faces=[];N=11
        zs=[0,.12,.28,.45,.61,.76,.88,.96,1]
        rs=[1,.98,.84,.75,.68,.45,.30,.16,.05]
        for j,(z,r) in enumerate(zip(zs,rs)):
            offset=.13*math.sin(z*5+layer*.4)*z+.11*z*z
            for k in range(N):
                a=k*math.tau/N+j*.23;noise=1+rng.uniform(-.22,.23)
                p=U*(widths[layer]*r*math.cos(a)*noise+offset)+B*(depths[layer]*r*math.sin(a))
                verts.append(tuple(p+Z*(heights[layer]*z+rng.uniform(-.025,.025)*math.sin(math.pi*z))))
        for j in range(len(zs)-1):
            for k in range(N):faces.append((j*N+k,j*N+(k+1)%N,(j+1)*N+(k+1)%N,(j+1)*N+k))
        faces.append(tuple(range((len(zs)-1)*N,len(zs)*N)))
        mat=material('MAT-v2-flame-layer-%d'%layer,colors[layer],powers[layer])
        o=link_mesh('GEO-v2-flame-layer-%d'%layer,verts,faces,mat);o.location=(-B)*(.11*layer)+Z*.35;o['Emission']=powers[layer];all_flames.append(o)
    # Two thin, curling outer tongues break up the continuous tapered outline.
    for j,sign in enumerate((-1,1)):
        mat=all_flames[0].data.materials[0]
        pts=[U*(sign*x)+B*.01+Z*z for x,z in [(.24,.35),(.40,.53),(.43,.70),(.34,.84),(.39,.99)]]
        verts=[];faces=[]
        for k,p in enumerate(pts):
            w=[.12,.105,.077,.043,.004][k]
            verts.extend([tuple(p-U*w),tuple(p+U*w),tuple(p+B*.07)])
        for k in range(4):
            faces.extend([(3*k,3*k+1,3*k+4,3*k+3),(3*k+1,3*k+2,3*k+5,3*k+4),(3*k+2,3*k,3*k+3,3*k+5)])
        link_mesh('GEO-v2-flame-curl-%d'%j,verts,faces,mat)
    sparkmat=material('MAT-v2-ascending-embers','#FFAB54',3)
    for i in range(48):
        rng=random.Random(4100+i);h=rng.uniform(.65,2.95);a=rng.uniform(0,math.tau);r=rng.uniform(.06,.32);size=rng.uniform(.012,.05)
        o=ico('GEO-v2-rising-ember-%02d'%i,(0,0,h),size,sparkmat);o.scale=(.65,.65,rng.uniform(1.2,2.0));o['Seed']=4100+i
        for f in (1,16,32,48,64,80,96):
            dz=(f-48)*.014;z=h+dz;theta=a+z*2.5
            o.location=Vector((math.cos(theta)*r,math.sin(theta)*r,z));o.keyframe_insert('location',frame=f)
        interpolation(o,'LINEAR')
    glowmat=material('MAT-v2-coal-glow','#EE6C2C',1.2)
    cylinder('GEO-v2-coal-glow-disc',(0,0,.245),.5,.012,glowmat,32)
    s.frame_set(48);s['Flame enhancement']='4 wavy seeded layers; emission 3/4.5/6/8; 48 rising spiral embers; 0.5m glow disc'

def add_emblems(s):
    bpy.context.window.scene=s
    plate=material('MAT-v2-emblem-plate','#273044')
    ink=material('MAT-v2-emblem-amber','#FFB565',1.6)
    for i in (1,2):
        root=next(o for o in s.objects if o.type=='EMPTY' and o.name.startswith('Avatar %d • cream hood'%i))
        hood=next(o for o in root.children if o.name.startswith('Avatar %d • hood'%i) and o.type=='MESH')
        face=next(o for o in root.children if 'dark face' in o.name)
        f=Vector((face.location.x-hood.location.x,face.location.y-hood.location.y,0)).normalized()
        side=Vector((f.y,-f.x,0));normal=(f*.70+Z*.70).normalized();up=normal.cross(side).normalized()
        center=hood.location+f*.30+Z*.32
        base=cylinder('GEO-v2-Avatar%d-Emblem-plate'%i,center,.16,.013,plate,32);base.rotation_euler=normal.to_track_quat('Z','Y').to_euler();base.parent=root
        center+=normal*.009
        for ring,rad in enumerate((.062,.115)):
            o=line('GEO-v2-Avatar%d-Emblem-ring%d'%(i,ring),[center+side*(rad*math.cos(k*math.tau/48))+up*(rad*math.sin(k*math.tau/48)) for k in range(49)],.0045,ink);o.parent=root
        for j in range(6):
            a=j*math.tau/6+(i-1)*.17;v=side*math.cos(a)+up*math.sin(a)
            o=rod('GEO-v2-Avatar%d-Emblem-ray%d'%(i,j),center+v*.075,center+v*.142,.004,ink);o.parent=root
        for j in range(3):
            a=j*math.tau/3+math.pi/6+(i-1)*.17
            o=ico('GEO-v2-Avatar%d-Emblem-dot%d'%(i,j),center+side*(.135*math.cos(a))+up*(.135*math.sin(a)),.012,ink);o.parent=root
        root['Emblem']='Simplified identity motif: two rings, six rays, three dots; amber emission 1.6'

def set_rod(o,a,b):
    a,b=Vector(a),Vector(b);depth=max(v.co.z for v in o.data.vertices)-min(v.co.z for v in o.data.vertices)
    o.location=(a+b)/2;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();o.scale.z=(b-a).length/depth

def avatar_sheet(source):
    s=clone_scene(source,'05 • Avatar variants')
    root=next(o for o in s.objects if o.type=='EMPTY' and o.name.startswith('Avatar 1 • cream hood'))
    chair=next(o for o in s.objects if o.type=='EMPTY' and o.name.startswith('Chair 01'))
    parts=list(root.children);chairparts=list(chair.children);keep={root,chair,*parts,*chairparts}
    camera=s.camera;keep.add(camera)
    for o in list(s.objects):
        if o not in keep:bpy.data.objects.remove(o,do_unlink=True)
    hood=next(o for o in parts if o.type=='MESH' and o.name.startswith('Avatar 1 • hood'))
    origin=Vector((hood.location.x,hood.location.y,0));f=(-origin).normalized();side=Vector((f.y,-f.x,0))
    angle=-math.pi/2-math.atan2(f.y,f.x)
    rot=Matrix.Rotation(angle,4,'Z')
    # Copies of the canonical seated parts, rather than a separate avatar design.
    groups=[('SEATED',-2.2,root,parts+chairparts+[chair])]
    for pose,x in [('STANDING',0),('WALKING',2.2)]:
        newroot=bpy.data.objects.new('POSE-'+pose,None);s.collection.objects.link(newroot);objects=[]
        for src in parts:
            if 'phone' in src.name:continue
            o=src.copy();o.data=src.data.copy();s.collection.objects.link(o);o.parent=newroot;o.name='GEO-'+pose+'-'+src.name
            name=src.name;sign=1 if (src.location-origin).dot(side)>0 else -1
            def q(a,b,z):return origin+side*a+f*b+Z*z
            stride=(sign*.30 if pose=='WALKING' else 0)
            if 'Emblem' in name or 'hood' in name or 'dark face' in name or 'eye' in name:o.location.z+=.42
            elif 'rounded coat' in name:o.location.z+=.24;o.scale.z*=1.3
            elif 'coat hem' in name:o.location.z+=.15
            elif 'trouser' in name:set_rod(o,q(sign*.18,stride*.3,.99),q(sign*.18,stride*.65,.69))
            elif 'shin' in name:set_rod(o,q(sign*.18,stride*.65,.69),q(sign*.18,stride,.32))
            elif 'shoe' in name:o.location=q(sign*.18,.07+stride,.30)
            elif 'sleeve' in name:set_rod(o,q(sign*.32,0,1.50),q(sign*.39,-stride*.75,1.07))
            elif 'mitten' in name:o.location=q(sign*.39,-stride*.75,1.04)
            objects.append(o)
        groups.append((pose,x,newroot,objects))
    bpy.context.view_layer.update()
    for pose,x,parent,objects in groups:
        M=Matrix.Translation(Vector((x,0,0)))@rot@Matrix.Translation(-origin)
        matrices={o:o.matrix_world.copy() for o in objects}
        for o in sorted(objects,key=lambda o:int(o.parent in objects)):
            o.matrix_world=M@matrices[o]
        bpy.context.view_layer.update()
        if pose=='WALKING':
            pivot=Vector((x,0,.13));lean=Matrix.Translation(pivot)@Matrix.Rotation(math.radians(6),4,'X')@Matrix.Translation(-pivot)
            for o in objects:o.matrix_world=lean@o.matrix_world
        parent['Pose']=pose
    floor=material('MAT-variants-floor','#1B2436');cube('GEO-variants-floor',(0,0,.09),(7.5,2.8,.08),floor,.06)
    for i,(loc,energy,color) in enumerate([((-3,-4,5),95,(1,.78,.55)),((3,-2,4),110,(.78,.86,1))]):
        l=bpy.data.lights.new('LGT-variants-%d'%i,'POINT');l.energy=energy;l.color=color;l.shadow_soft_size=2.5
        o=bpy.data.objects.new(l.name,l);s.collection.objects.link(o);o.location=loc
    target=Vector((0,0,1.24));camera.location=target+Vector((4,-11,5));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=8.25
    labelmat=material('MAT-variants-label','#C7BAA1',base_floor=.8)
    for title,x,_,_ in groups:
        bpy.ops.object.text_add(location=(x,-1.12,.16));t=bpy.context.object;t.name='LABEL-'+title;t.data.body=title;t.data.size=.15;t.data.align_x='CENTER';t.data.materials.append(labelmat);t.rotation_euler=camera.rotation_euler
    settings(s);s.frame_set(48);s['Pose variants']='Seated canonical parts / standing elongated torso / 6 degree walking lean with opposed arm and leg stride'
    return s

def cafe_details(s):
    bpy.context.window.scene=s
    amber=material('MAT-v2-sign-amber','#FF9B45',2)
    dark=material('MAT-v2-sign-frame','#252E42');cream=material('MAT-v2-board-cream','#D7C9AD');green=material('MAT-v2-chair-green','#263D39')
    # The VM's (0,6.2) is behind a differently oriented camera. Use the actual
    # canonical back vector so the independent pole sign stays behind the plaza.
    p=B*3.40
    for a in (-1.38,1.38):rod('GEO-v2-sign-pole',p+U*a+Z*.15,p+U*a+Z*2.63,.035,dark)
    panel=cube('GEO-v2-sign-back',p+Z*2.37,(2.85,.08,.52),dark,.035)
    basis=Matrix((U,Z,-B)).transposed();panel.rotation_euler.z=math.atan2(U.y,U.x)
    bpy.ops.object.text_add(location=p+(-B)*.06+Z*2.23)
    t=bpy.context.object;t.name='TXT-v2-Museion-neon';t.data.body='Museion';t.data.align_x='CENTER';t.data.size=.36;t.data.extrude=.003;t.data.bevel_depth=.001;t.rotation_euler=basis.to_euler();t.data.materials.append(amber)
    for o in list(s.objects):
        if 'Cafe • MUSEION sign' in o.name:o.hide_render=True
    # A-frame menu beside the canonical side table.
    p=R*3.05-B*.65
    for sign in (-1,1):
        o=cube('GEO-v2-menu-board',p+B*(sign*.10)+Z*.54,(.49,.05,.76),cream,.018);o.rotation_euler.z=math.atan2(U.y,U.x);o.rotation_euler.rotate_axis('X',math.radians(sign*13))
    front=cube('GEO-v2-menu-dark-face',p+(-B)*.20+Z*.56,(.39,.025,.57),dark,.015);front.rotation_euler.z=math.atan2(U.y,U.x)
    bpy.ops.object.text_add(location=p+(-B)*.222+Z*.71)
    t=bpy.context.object;t.name='TXT-v2-menu';t.data.body='TODAY\n\nCOFFEE\n\n& STORIES';t.data.align_x='CENTER';t.data.size=.057;t.data.space_line=1.05;t.rotation_euler=basis.to_euler();t.data.materials.append(cream)
    potmat=material('MAT-v2-pot','#655249');leaf=material('MAT-v2-leaf','#29423C')
    for i,(a,b) in enumerate([(-3.9,1.45),(3.9,1.45),(-3.85,-1.65),(3.85,-1.65)]):
        p=R*a+B*b
        cylinder('GEO-v2-pot-%d'%i,p+Z*.25,.18,.27,potmat,12)
        ico('GEO-v2-shrub-%d'%i,p+Z*.60,.30,leaf)
        ico('GEO-v2-shrub-small-%d'%i,p+U*.14+Z*.54,.20,leaf)
    steam=bpy.data.materials.new('MAT-v2-steam');steam.use_nodes=True;n=steam.node_tree.nodes;n.clear();links=steam.node_tree.links
    out=n.new('ShaderNodeOutputMaterial');mix=n.new('ShaderNodeMixShader');transparent=n.new('ShaderNodeBsdfTransparent');em=n.new('ShaderNodeEmission');em.inputs['Color'].default_value=(1,.91,.78,1);em.inputs['Strength'].default_value=.3;mix.inputs[0].default_value=.20
    links.new(transparent.outputs[0],mix.inputs[1]);links.new(em.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],out.inputs['Surface'])
    coffee=[o for o in s.objects if o.name.startswith('Cup ') and 'coffee' in o.name]
    for i,cup in enumerate(coffee):
        for j in range(3):
            o=ico('GEO-v2-steam-%d-%d'%(i,j),cup.location+U*(.018*math.sin(j*2+i))+Z*(.09+j*.085),.028+j*.006,steam);o.scale.z=1.7
    for index in ('03','06'):
        root=next(o for o in s.objects if o.type=='EMPTY' and o.name.startswith('Chair '+index))
        for child in root.children:
            if hasattr(child.data,'materials'):child.data.materials.clear();child.data.materials.append(green)
    s['Cafe details']='Independent pole-mounted Museion neon, A-frame menu, four pots, cup steam, two muted green chairs'
    s['Sign coordinate adaptation']='Canonical scene uses back=(-8,-9,0). VM (0,6.2) replaced with canonical back*3.40 to preserve hero camera and rear placement.'

