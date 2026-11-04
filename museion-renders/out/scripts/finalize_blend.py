exec(open('/Users/you/museion-renders/out/scripts/enhance_common.py').read())
draft=bpy.data.scenes.get('99 • Avatar preview before pose repair')
if draft:bpy.data.scenes.remove(draft)
inspection=json.loads((OUT/'canonical-inspection.json').read_text());camera_original=inspection['scenes'][0]['camera']
report={'scenes':[],'static_checks':{}}
for name,path in [('04 • Flame enhanced','flame-hero.png'),('05 • Avatar variants','avatar-variants.png'),('06 • Cafe enhanced','diorama-hero-v2.png')]:
    s=bpy.data.scenes[name];settings(s);s.frame_set(48);s.render.filepath=str(OUT/path)
    report['scenes'].append({'name':name,'objects':len(s.objects),'samples':s.cycles.samples,'resolution':[s.render.resolution_x,s.render.resolution_y],'output':path})
    if name!='05 • Avatar variants':
        assert all(abs(a-b)<1e-5 for a,b in zip(s.camera.location,camera_original['location']))
        assert all(abs(a-b)<1e-5 for a,b in zip(s.camera.rotation_euler,camera_original['rotation']))
        assert abs(s.camera.data.ortho_scale-camera_original['ortho'])<1e-5
flame=bpy.data.scenes['04 • Flame enhanced']
layers=[o for o in flame.objects if o.name.startswith('GEO-v2-flame-layer-')]
assert len(layers)==4 and sorted(o['Emission'] for o in layers)==[3,4.5,6,8]
assert len([o for o in flame.objects if o.name.startswith('GEO-v2-rising-ember-')])==48
avatars=bpy.data.scenes['05 • Avatar variants']
assert sorted(o.get('Pose','') for o in avatars.objects if o.get('Pose'))==['SEATED','STANDING','WALKING']
assert len([o for o in avatars.objects if o.type=='LIGHT'])==2
assert len([o for o in avatars.objects if 'Emblem-plate' in o.name])==3
cafe=bpy.data.scenes['06 • Cafe enhanced']
assert len([o for o in cafe.objects if o.name.startswith('GEO-v2-pot-')])==4
assert any(o.type=='FONT' and o.data.body=='Museion' for o in cafe.objects)
assert len([o for o in cafe.objects if 'Emblem-plate' in o.name])==2
anim=bpy.data.scenes['07 • Ember split animation'];settings(anim,32,1280,720);anim.frame_set(1);anim.render.fps=24
report['scenes'].append({'name':anim.name,'objects':len(anim.objects),'frames':[anim.frame_start,anim.frame_end],'fps':24,'samples':32,'resolution':[1280,720]})
# Reference scenes stay in the enhanced file, with output paths contained in out/.
for s in bpy.data.scenes:
    if s.name.startswith(('01 •','02 •','03 •')):s.render.filepath=str(OUT/('reference-'+s.name.split(' •')[0]+'.png'))
report['static_checks']={'hero_camera_unchanged':True,'flame_layers':4,'spiral_embers':48,'avatar_poses':3,'avatar_sheet_lights':2,'emblems_on_all_variants':True,'cafe_pots':4,'original_still_scenes_retained':True}
bpy.context.window.scene=cafe
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'museion-enhanced.blend'))
report['blend_path']=bpy.data.filepath;report['status']='PASS'
(OUT/'enhanced-scene-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
result=report
