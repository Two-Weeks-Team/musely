exec(open('/Users/kimsejun/museion-renders/out/scripts/enhance_common.py').read())
s=clone_scene(bpy.data.scenes['02 • Ember split'],'07 • Ember split animation')
for o in list(s.objects):
    if o.name.startswith(('Ember 1 •','Ember 2 •','Phone 1 • received','Phone 2 • received')):bpy.data.objects.remove(o,do_unlink=True)
enhance_flame(s);add_emblems(s);cafe_details(s)
settings(s,32,1280,720);s.render.fps=24;s.frame_start=1;s.frame_end=72;s.render.use_persistent_data=True
targets=[Vector(p) for p in json.loads(s['Phone targets'])]
firemat=material('MAT-animation-splitting-ember','#FFAA5A',3.5)
trailmat=material('MAT-animation-ember-trail','#FF9A43',2.5)
start=Vector((0,0,1.9))

def visible(o,frame,yes):
    o.hide_render=not yes;o.hide_viewport=not yes
    o.keyframe_insert('hide_render',frame=frame);o.keyframe_insert('hide_viewport',frame=frame)

def bezier(t,end):
    sign=1 if end.dot(R)>0 else -1
    c1=start+R*(sign*.45)+Z*.50;c2=end-R*(sign*.18)+Z*.65
    return (1-t)**3*start+3*(1-t)**2*t*c1+3*(1-t)*t*t*c2+t**3*end

src=ico('GEO-anim-single-ember',(0,0,1),.085,firemat)
src.location=(0,0,1.0);src.keyframe_insert('location',frame=1)
src.location=start;src.keyframe_insert('location',frame=20)
visible(src,1,True);visible(src,20,True);visible(src,21,False)
interpolation(src,'BEZIER')

for index,end in enumerate(targets,1):
    orb=ico('GEO-anim-branch-%d'%index,start,.075,firemat)
    visible(orb,1,False);visible(orb,20,False);visible(orb,21,True);visible(orb,61,True);visible(orb,62,False)
    for f in range(21,59):
        orb.location=bezier((f-21)/37,end);orb.keyframe_insert('location',frame=f)
    for f,scale in [(21,.6),(25,1),(58,1),(61,.15)]:orb.scale=(scale,)*3;orb.keyframe_insert('scale',frame=f)
    interpolation(orb,'LINEAR')
    for j in range(4):
        delay=2*(j+1);tail=ico('GEO-anim-trail-%d-%d'%(index,j),start,.030-j*.004,trailmat)
        visible(tail,1,False);visible(tail,20+delay,False);visible(tail,21+delay,True);visible(tail,58+delay,True);visible(tail,59+delay,False)
        for f in range(21+delay,59+delay):
            tail.location=bezier((f-delay-21)/37,end);tail.keyframe_insert('location',frame=f)
        interpolation(tail,'LINEAR')
    glass=next(o for o in s.objects if o.name.startswith('Avatar %d • phone glass'%index))
    m=glass.data.materials[0].copy();m.name='MAT-anim-phone-screen-%d'%index;glass.data.materials[0]=m
    p=m.node_tree.nodes.get('Principled BSDF')
    for link in list(m.node_tree.links):
        if link.to_socket==p.inputs['Emission Strength']:m.node_tree.links.remove(link)
    p.inputs['Base Color'].default_value=rgba('#FFB65E');p.inputs['Emission Color'].default_value=rgba('#FFB65E')
    for f,strength in [(1,0),(57,0),(58,2.6),(67,5),(72,5)]:
        p.inputs['Emission Strength'].default_value=strength;p.inputs['Emission Strength'].keyframe_insert('default_value',frame=f)
    if m.node_tree.animation_data:
        for fc in curves_of(m.node_tree.animation_data.action):
            for key in fc.keyframe_points:key.interpolation='LINEAR'

# Boolean visibility switches must stay discrete at the split/arrival frames.
for o in s.objects:
    if o.name.startswith('GEO-anim-') and o.animation_data:
        for fc in curves_of(o.animation_data.action):
            if fc.data_path in ('hide_render','hide_viewport'):
                for key in fc.keyframe_points:key.interpolation='CONSTANT'
for o in s.objects:
    if o.name.startswith('GEO-v2-flame-layer-'):
        phase=int(o.name.split('layer-')[1].split('.')[0])
        for f in range(1,73,6):
            o.scale.z=1+.035*math.sin(f*.23+phase);o.keyframe_insert('scale',frame=f)
        interpolation(o,'BEZIER')

s.frame_set(1);s['Animation timing']='24fps / 72 frames: lift 1-20, split 21, travel 21-58, phone ramp 58-67, hold through 72'
s['Trail count per branch']=4;s['Source scene']='Canonical 02 • Ember split; static trails replaced in derived scene only'
save_checkpoint('stage-05-ember-animation.blend')
(OUT/'ember-check').mkdir(exist_ok=True)
queue_frames(s.name,[1,19,21,33,45,58,72],str(OUT/'ember-check/frame-{frame:04d}.png'),pct=50,status='stage05-check-status.json')
result={'scene':s.name,'preview_frames':[1,19,21,33,45,58,72],'frame_count':72,'fps':24,'target_phones':[list(p) for p in targets]}
