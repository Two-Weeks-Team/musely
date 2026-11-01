"""Read back the saved .blend and PNG bytes; no scene mutations or render."""
import bpy, json, struct, hashlib
from pathlib import Path
OUT=Path('/Users/kimsejun/museion-renders')
checks=[]
for name in ('01 • Campfire','02 • Ember split','03 • Cold open'):
    s=bpy.data.scenes[name]
    objects=list(s.objects)
    lights=[o for o in objects if o.type=='LIGHT']
    chairs=[o for o in objects if o.type=='EMPTY' and o.name.startswith('Chair ')]
    avatars=[o for o in objects if o.type=='EMPTY' and o.name.startswith('Avatar ')]
    tables=[o for o in objects if o.name.startswith('Table ') and 'round top' in o.name]
    logs=[o for o in objects if o.name.startswith('Campfire • log ')]
    particles=[o for o in objects if o.name.startswith('Ember particle • ')]
    assert len(lights)==1 and lights[0].data.type=='POINT',(name,'lights')
    assert len(chairs)==6,(name,'chairs',len(chairs))
    assert len(avatars)==2,(name,'avatars')
    assert len(tables)==2,(name,'tables')
    assert len(logs)==3,(name,'logs')
    assert len(particles)==34,(name,'particles')
    assert s.camera.data.type=='ORTHO',(name,'camera')
    assert (s.render.resolution_x,s.render.resolution_y,s.render.resolution_percentage)==(1920,1080,100)
    for n in s.compositing_node_group.nodes:
        if n.bl_idname=='CompositorNodeRLayers':assert n.scene==s,(name,'compositor scene')
    assert any(n.bl_idname=='ShaderNodeLightPath' for n in s.world.node_tree.nodes)
    assert any(n.bl_idname=='ShaderNodeBackground' and n.inputs['Strength'].default_value==0 for n in s.world.node_tree.nodes)
    output=Path(s.render.filepath)
    raw=output.read_bytes()
    assert raw[:8]==b'\x89PNG\r\n\x1a\n'
    width,height=struct.unpack('>II',raw[16:24]);assert (width,height)==(1920,1080)
    # Decode the actual output with Blender, rather than trusting only its header.
    im=bpy.data.images.load(str(output),check_existing=False)
    assert tuple(im.size)==(1920,1080)
    pixels=list(im.pixels[::4])
    assert max(pixels)-min(pixels)>.1,(name,'blank output')
    bpy.data.images.remove(im)
    checks.append({'scene':name,'objects':len(objects),'chairs':len(chairs),'avatars':len(avatars),'tables':len(tables),'logs':len(logs),'ascending_ember_particles':len(particles),'light_objects':len(lights),'world_illumination':0,'camera':'ORTHO','png':output.name,'size':[width,height],'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
report={'saved_blend':bpy.data.filepath,'blender':bpy.app.version_string,'scenes':checks,'checks':'PASS: saved scene counts, single point light, no world illumination, variant compositor linkage, decoded PNGs, dimensions, nonblank pixels. Visual review recorded separately in render-notes.json.'}
(OUT/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
