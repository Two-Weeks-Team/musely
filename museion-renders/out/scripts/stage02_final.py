exec(open('/Users/you/museion-renders/out/scripts/enhance_common.py').read())
s=bpy.data.scenes['05 • Avatar variants'];settings(s);save_checkpoint('stage-02-avatars.blend')
queue_frames(s.name,[48],str(OUT/'avatar-variants.png'),status='stage02-final-status.json')
result={'queued':'out/avatar-variants.png'}
