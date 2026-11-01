import bpy,json,shutil,hashlib,time
from pathlib import Path
ROOT=Path('/Users/kimsejun/.local/share/blender-official/v1.0.3')
backup=ROOT/'backups';backup.mkdir(exist_ok=True)
scene_before={'filepath':bpy.data.filepath,'scene':bpy.context.scene.name,'objects':len(bpy.context.scene.objects),'dirty':bpy.data.is_dirty}
if bpy.data.is_dirty:
    bpy.ops.wm.save_as_mainfile(filepath=str(backup/('scene-before-official-'+time.strftime('%Y%m%d-%H%M%S')+'.blend')),copy=True)
prefpath=Path(bpy.utils.user_resource('CONFIG'))/'userpref.blend'
if prefpath.exists() and not (backup/'userpref-before-official.blend').exists():
    shutil.copy2(prefpath,backup/'userpref-before-official.blend')
repo=next(r for r in bpy.context.preferences.extensions.repos if r.module=='user_default')
module='bl_ext.user_default.mcp'
package=Path(repo.directory)/'mcp'
if not package.exists():
    installed=bpy.ops.extensions.package_install_files(filepath=str(ROOT/'mcp-1.0.3.zip'),repo=repo.module,enable_on_install=False,overwrite=False)
    assert 'FINISHED' in installed,str(installed)
    assert package.exists(),str(package)
elif (package/'blender_manifest.toml').read_text().find('version = "1.0.3"')<0:
    raise RuntimeError('Existing official extension differs; preserved')
# Official extension requires Blender online-access enabled even for loopback.
bpy.context.preferences.system.use_online_access=True
assert bpy.app.online_access
result=bpy.ops.preferences.addon_enable(module=module)
assert 'FINISHED' in result,str(result)
prefs=bpy.context.preferences.addons[module].preferences
prefs.host='127.0.0.1';prefs.port=9877;prefs.use_autostart=True
result=bpy.ops.blmcp.server_start()
assert 'FINISHED' in result,str(result)
bpy.ops.wm.save_userpref()
assert bpy.data.filepath==scene_before['filepath']
assert len(bpy.context.scene.objects)==scene_before['objects']
report={'official_addon':module,'version':'1.0.3','host':prefs.host,'port':prefs.port,'autostart':prefs.use_autostart,'online_access':bpy.app.online_access,'scene_before':scene_before,'scene_after':{'filepath':bpy.data.filepath,'scene':bpy.context.scene.name,'objects':len(bpy.context.scene.objects),'dirty':bpy.data.is_dirty}}
(ROOT/'addon-install-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False))
