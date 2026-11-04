exec(open('/Users/you/museion-renders/out/scripts/enhance_common.py').read())
old=bpy.data.scenes['05 • Avatar variants'];old.name='99 • Avatar preview before pose repair'
s=avatar_sheet(bpy.data.scenes['04 • Flame enhanced']);save_checkpoint('stage-02-avatars.blend')
queue_frames(s.name,[48],str(OUT/'avatar-check-v2.png'),pct=50,status='stage02-check-v2-status.json')
result={'scene':s.name,'repair':'Evaluate dependency graph after local pose changes before copying world matrices; move captions away from feet.'}
