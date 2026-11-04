import bpy,json,traceback,time
from pathlib import Path
from mathutils import Vector
OUT=Path('/Users/you/museion-renders')
s=bpy.data.scenes['03 • Cold open']
delta=Vector((9,-8,0)).normalized()*12.6
s.camera.location+=delta
for o in s.objects:
    if o.name.startswith('Cold open • grain contour '):o.location+=delta
def rerender_cold():
    try:
        bpy.context.window.scene=s
        start=time.time();bpy.ops.render.render(write_still=True,scene=s.name)
        bpy.context.window.scene=bpy.data.scenes['01 • Campfire']
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'museion-cafe.blend'))
        report=json.loads((OUT/'render-status.json').read_text())
        report['cold_open_revision']={'reason':'Corrected camera-right sign after visual inspection. Title space and grain now on left; diorama on right.','seconds':round(time.time()-start,2)}
        (OUT/'render-status.json').write_text(json.dumps(report,indent=2))
        (OUT/'cold-revision-status.txt').write_text('DONE')
    except Exception:
        (OUT/'cold-revision-status.txt').write_text(traceback.format_exc())
    return None
bpy.app.timers.register(rerender_cold,first_interval=2)
print('Cold-open framing correction queued')
