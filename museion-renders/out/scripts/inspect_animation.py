import bpy,json,math
from pathlib import Path
from mathutils import Vector
s=bpy.data.scenes['07 • Ember split animation'];targets=[Vector(p) for p in json.loads(s['Phone targets'])]
branches=[next(o for o in s.objects if o.name=='GEO-anim-branch-%d'%i) for i in (1,2)]
single=s.objects.get('GEO-anim-single-ember')
report={'scene':s.name,'fps':s.render.fps,'frame_range':[s.frame_start,s.frame_end],'resolution':[s.render.resolution_x,s.render.resolution_y],'samples':s.cycles.samples,'frames':[],'maximum_step':0,'crossing':False,'final_phone_strengths':[]}
previous=None;R=Vector((9,-8,0)).normalized()
for f in range(1,73):
    s.frame_set(f);bpy.context.view_layer.update();positions=[o.matrix_world.translation.copy() for o in branches]
    if 21<=f<=58:
        assert positions[0].dot(R)<=positions[1].dot(R)+1e-5,'Branch crossing'
        if previous:
            report['maximum_step']=max([report['maximum_step']]+[(p-q).length for p,q in zip(positions,previous)])
        previous=positions
    if f in (1,19,20,21,33,45,58,67,72):
        report['frames'].append({'frame':f,'single_visible':not single.hide_render,'branches_visible':[not o.hide_render for o in branches],'branch_positions':[list(v) for v in positions]})
    if f==58:
        report['arrival_errors']=[(p-t).length for p,t in zip(positions,targets)]
s.frame_set(72)
for i in (1,2):
    glass=next(o for o in s.objects if o.name.startswith('Avatar %d • phone glass'%i))
    strength=glass.data.materials[0].node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value
    report['final_phone_strengths'].append(strength)
assert report['maximum_step']<.2
assert max(report['arrival_errors'])<1e-5
assert report['final_phone_strengths']==[5,5]
assert report['fps']==24 and report['frame_range']==[1,72]
assert len([o for o in s.objects if o.name.startswith('GEO-anim-trail-')])==8
report['status']='PASS';Path('/Users/you/museion-renders/out/ember-motion-validation.json').write_text(json.dumps(report,indent=2))
result=report
