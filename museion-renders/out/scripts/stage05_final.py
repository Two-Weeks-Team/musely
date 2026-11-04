exec(open('/Users/you/museion-renders/out/scripts/enhance_common.py').read())
s=bpy.data.scenes['07 • Ember split animation'];settings(s,32,1280,720);s.render.fps=24;s.render.use_persistent_data=True
save_checkpoint('stage-05-ember-animation.blend')
(OUT/'ember-frames').mkdir(exist_ok=True)
queue_frames(s.name,range(1,73),str(OUT/'ember-frames/frame-{frame:04d}.png'),status='stage05-final-status.json')
result={'queued_frames':72,'samples':32,'resolution':[1280,720],'fps':24}
