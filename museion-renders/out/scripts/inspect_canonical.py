import bpy,json
from pathlib import Path
report={'filepath':bpy.data.filepath,'dirty':bpy.data.is_dirty,'scenes':[]}
for s in bpy.data.scenes:
    objects=[]
    for o in s.objects:
        if any(w in o.name for w in ['Avatar','Fire •','Ember','Campfire','Cup','Table','Chair','Building','Camera']):
            objects.append({'name':o.name,'type':o.type,'location':list(o.location),'scale':list(o.scale),'parent':o.parent.name if o.parent else None,'materials':[m.name for m in o.data.materials] if hasattr(o.data,'materials') else []})
    report['scenes'].append({'name':s.name,'objects':len(s.objects),'camera':{'name':s.camera.name,'location':list(s.camera.location),'rotation':list(s.camera.rotation_euler),'ortho':s.camera.data.ortho_scale},'properties':{k:s[k] for k in s.keys() if not k.startswith('_')},'selected_objects':objects})
Path('/Users/you/museion-renders/out/canonical-inspection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
result={'filepath':report['filepath'],'dirty':report['dirty'],'scenes':[(s['name'],s['objects']) for s in report['scenes']]}
