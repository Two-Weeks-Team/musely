exec(open('/Users/kimsejun/museion-renders/out/scripts/enhance_common.py').read())
s=bpy.data.scenes['06 • Cafe enhanced'];settings(s);save_checkpoint('stage-03-cafe.blend')
queue_frames(s.name,[48],str(OUT/'diorama-hero-v2.png'),status='stage03-final-status.json')
result={'queued':'out/diorama-hero-v2.png'}
