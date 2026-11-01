import bpy,json
g=bpy.context.scene.compositing_node_group
node=next(n for n in g.nodes if n.bl_idname=='CompositorNodeGlare')
print(json.dumps({'properties':[p.identifier for p in node.bl_rna.properties], 'inputs':[(s.name,str(s.default_value) if hasattr(s,'default_value') else '') for s in node.inputs], 'outputs':[s.name for s in node.outputs]}))
