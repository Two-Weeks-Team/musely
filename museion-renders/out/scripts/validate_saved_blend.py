import bpy,json
from pathlib import Path
from mathutils import Vector
OUT=Path('/Users/kimsejun/museion-renders/out')
expected={'01 • Campfire':233,'02 • Ember split':279,'03 • Cold open':249}
assert len(bpy.data.scenes)==7,list(bpy.data.scenes.keys())
for name,count in expected.items():assert len(bpy.data.scenes[name].objects)==count
for s in bpy.data.scenes:
    assert s.camera is not None
    for n in s.compositing_node_group.nodes:
        if n.bl_idname=='CompositorNodeRLayers':assert n.scene==s,(s.name,'compositor reference')
s=bpy.data.scenes['07 • Ember split animation']
if bpy.context.window:bpy.context.window.scene=s
s.frame_set(21)
assert s.objects['GEO-anim-single-ember'].hide_render
assert all(not s.objects['GEO-anim-branch-%d'%i].hide_render for i in (1,2))
s.frame_set(58)
targets=[Vector(v) for v in json.loads(s['Phone targets'])]
errors=[(s.objects['GEO-anim-branch-%d'%i].matrix_world.translation-targets[i-1]).length for i in (1,2)]
assert max(errors)<1e-5
s.frame_set(72)
strengths=[]
for i in (1,2):
    o=next(o for o in s.objects if o.name.startswith('Avatar %d • phone glass'%i))
    strengths.append(o.data.materials[0].node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value)
assert strengths==[5,5]
report={'status':'PASS','file':bpy.data.filepath,'readback':'fresh Blender background process; no render or file mutation','scenes':list(bpy.data.scenes.keys()),'reference_scene_object_counts':expected,'all_compositor_scene_references_correct':True,'split_visibility_at_21':True,'arrival_errors':errors,'final_phone_emission':strengths}
(OUT/'saved-blend-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
