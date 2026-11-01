import bpy,json
op=bpy.ops.extensions.package_install_files.get_rna_type()
print(json.dumps({'scene':bpy.context.scene.name,'filepath':bpy.data.filepath,'dirty':bpy.data.is_dirty,'online_access':bpy.app.online_access,'extension_repos':[{'name':r.name,'module':r.module,'directory':r.directory} for r in bpy.context.preferences.extensions.repos],'install_op':[(p.identifier,str(p.default) if hasattr(p,'default') else p.type) for p in op.properties]},ensure_ascii=False))
