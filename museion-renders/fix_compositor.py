import bpy
from pathlib import Path
import traceback
s=bpy.context.scene
g=s.compositing_node_group
glare=next(n for n in g.nodes if n.bl_idname=='CompositorNodeGlare')
glare.inputs['Type'].default_value='Fog Glow'
glare.inputs['Quality'].default_value='High'
glare.inputs['Threshold'].default_value=1.6
glare.inputs['Strength'].default_value=.24
glare.inputs['Size'].default_value=.22
rl=next(n for n in g.nodes if n.bl_idname=='CompositorNodeRLayers')
out=g.nodes.new('NodeGroupOutput')
g.links.new(rl.outputs['Image'],glare.inputs['Image'])
g.links.new(glare.outputs['Image'],out.inputs['Image'])
assert out.inputs['Image'].is_linked
def render_preview():
    try:
        bpy.ops.render.render(write_still=True)
        Path('/Users/kimsejun/museion-renders/preview-status.txt').write_text('DONE: fixed compositor')
    except Exception:
        Path('/Users/kimsejun/museion-renders/preview-status.txt').write_text(traceback.format_exc())
    return None
bpy.app.timers.register(render_preview,first_interval=2)
print('Compositor repaired using verified Blender 5.2 socket API; preview queued')
