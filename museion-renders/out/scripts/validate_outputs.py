from pathlib import Path
import hashlib,json
from PIL import Image,ImageStat
root=Path('/Users/kimsejun/museion-renders');out=root/'out';report={'originals_preserved':True,'stills':[]}
hashes=json.loads((out/'original-hashes.json').read_text())
for name,sha in hashes.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==sha,('Original changed',name)
for name in ['flame-hero.png','avatar-variants.png','diorama-hero-v2.png']:
    p=out/name
    with Image.open(p) as im:
        im.load();assert im.size==(1920,1080)
        assert max(ImageStat.Stat(im.convert('RGB')).stddev)>10,('Blank render',name)
    report['stills'].append({'path':str(p),'size':[1920,1080],'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
video=json.loads((out/'ember-video-validation.json').read_text());assert video['decoded_frames']==72 and video['fps']==24 and video['duration']==3
motion=json.loads((out/'ember-motion-validation.json').read_text());assert motion['status']=='PASS'
scene=json.loads((out/'enhanced-scene-validation.json').read_text());assert scene['status']=='PASS'
saved=json.loads((out/'saved-blend-validation.json').read_text());assert saved['status']=='PASS'
report['saved_blend_readback']={'path':saved['file'],'status':saved['status'],'scenes':saved['scenes'],'arrival_errors':saved['arrival_errors'],'final_phone_emission':saved['final_phone_emission']}
report['video']=video;report['motion_checks']={k:motion[k] for k in ['maximum_step','arrival_errors','final_phone_strengths','status']};report['scene_checks']=scene['static_checks'];report['map_motion']='HELD: ComBba map still completion not recorded in INDEX at step 04; no canonical map .blend supplied.'
report['method']='Blender Lab official MCP 1.0.3 / Metal Cycles. Stills 80 samples; animation 32 samples. Original three stills not regenerated.'
report['status']='PASS for 01/02/03/05; 04 held per prerequisite'
(out/'validation-enhanced.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
