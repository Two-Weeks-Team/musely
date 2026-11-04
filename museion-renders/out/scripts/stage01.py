exec(open('/Users/you/museion-renders/out/scripts/enhance_common.py').read())
assert bpy.data.filepath=='/Users/you/museion-renders/museion-cafe.blend'
s=clone_scene(bpy.data.scenes['01 • Campfire'],'04 • Flame enhanced')
enhance_flame(s);settings(s);save_checkpoint('stage-01-flame.blend')
queue_frames(s.name,[48],str(OUT/'flame-check.png'),pct=50,status='stage01-check-status.json')
result={'scene':s.name,'flame_layers':4,'rising_embers':48,'preview':'out/flame-check.png'}
