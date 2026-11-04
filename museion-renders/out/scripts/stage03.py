exec(open('/Users/you/museion-renders/out/scripts/enhance_common.py').read())
s=clone_scene(bpy.data.scenes['04 • Flame enhanced'],'06 • Cafe enhanced')
cafe_details(s);settings(s);save_checkpoint('stage-03-cafe.blend')
queue_frames(s.name,[48],str(OUT/'cafe-check.png'),pct=50,status='stage03-check-status.json')
result={'scene':s.name,'preview':'out/cafe-check.png','new_sign':'Museion / independent two poles'}
