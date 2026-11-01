import bpy, json
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
except Exception as e:
    print('GPU probe:', str(e))
print(json.dumps({'version': bpy.app.version_string, 'devices': [(d.name,d.type) for d in prefs.devices], 'scenes': list(bpy.data.scenes.keys()), 'objects':list(bpy.data.objects.keys())}))
