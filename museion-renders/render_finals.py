import bpy,json,time,traceback
from pathlib import Path
OUT=Path('/Users/kimsejun/museion-renders')
def render_all():
    results=[]
    try:
        for name in ('01 • Campfire','02 • Ember split','03 • Cold open'):
            s=bpy.data.scenes[name]
            bpy.context.window.scene=s
            (OUT/'render-status.json').write_text(json.dumps({'state':'rendering','scene':name,'completed':results},indent=2))
            start=time.time()
            bpy.ops.render.render(write_still=True,scene=name)
            results.append({'scene':name,'path':s.render.filepath,'seconds':round(time.time()-start,2)})
        bpy.context.window.scene=bpy.data.scenes['01 • Campfire']
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'museion-cafe.blend'))
        (OUT/'render-status.json').write_text(json.dumps({'state':'done','completed':results},indent=2))
    except Exception:
        (OUT/'render-status.json').write_text(json.dumps({'state':'error','traceback':traceback.format_exc(),'completed':results},indent=2))
    return None
bpy.app.timers.register(render_all,first_interval=2)
print('Queued: three 1920x1080 Cycles / Metal PNG renders')
