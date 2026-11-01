exec(open('/Users/kimsejun/museion-renders/out/scripts/enhance_common.py').read())
source=bpy.data.scenes['04 • Flame enhanced']
add_emblems(source)
s=avatar_sheet(source);save_checkpoint('stage-02-avatars.blend')
queue_frames(s.name,[48],str(OUT/'avatar-check.png'),pct=50,status='stage02-check-status.json')
result={'scene':s.name,'poses':['SEATED','STANDING','WALKING'],'point_lights':len([o for o in s.objects if o.type=='LIGHT'])}
