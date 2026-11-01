import bpy
s=bpy.data.scenes['05 • Avatar variants']
result={'pose_parts':[{'name':o.name,'location':list(o.location),'world':list(o.matrix_world.translation),'scale':list(o.scale)} for o in s.objects if any(c in o.name for c in ['STANDING','WALKING']) and any(c in o.name for c in ['hood','shoe','sleeve','rounded coat'])]}
