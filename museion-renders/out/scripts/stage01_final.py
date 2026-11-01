exec(open('/Users/kimsejun/museion-renders/out/scripts/enhance_common.py').read())
s=bpy.data.scenes['04 • Flame enhanced'];settings(s);save_checkpoint('stage-01-flame.blend')
queue_frames(s.name,[48],str(OUT/'flame-hero.png'),status='stage01-final-status.json')
result={'queued':'out/flame-hero.png','samples':80,'resolution':[1920,1080]}
