import bpy
from pathlib import Path
import traceback
def render_preview():
    try:
        bpy.ops.render.render(write_still=True)
        Path('/Users/you/museion-renders/preview-status.txt').write_text('DONE')
    except Exception:
        Path('/Users/you/museion-renders/preview-status.txt').write_text(traceback.format_exc())
    return None
bpy.app.timers.register(render_preview,first_interval=2)
print('Preview queued at 960x540')
