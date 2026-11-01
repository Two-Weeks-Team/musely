import argparse,json,subprocess,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
import imageio_ffmpeg

parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['check','encode']);args=parser.parse_args()
root=Path('/Users/kimsejun/museion-renders/out')
if args.mode=='encode':
    frames=sorted((root/'ember-frames').glob('frame-*.png'));assert len(frames)==72
    assert [p.name for p in frames]==['frame-%04d.png'%i for i in range(1,73)]
    for p in frames:
        with Image.open(p) as im:assert im.size==(1280,720)
    ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
    command=[ffmpeg,'-y','-framerate','24','-start_number','1','-i',str(root/'ember-frames/frame-%04d.png'),'-frames:v','72','-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-movflags','+faststart',str(root/'ember-split.mp4')]
    result=subprocess.run(command,capture_output=True,text=True,check=True)
    (root/'ember-encode.log').write_text(result.stderr)
    reader=imageio_ffmpeg.read_frames(str(root/'ember-split.mp4'),pix_fmt='rgb24')
    meta=next(reader);count=0;selected={}
    for frame in reader:
        count+=1
        if count in [1,19,21,33,45,58,72]:selected[count]=Image.frombytes('RGB',(1280,720),frame)
    assert count==72 and tuple(meta['size'])==(1280,720) and meta['fps']==24
    assert abs(meta['duration']-3)<.01
    report={'decoded_frames':count,'fps':meta['fps'],'duration':meta['duration'],'size':meta['size'],'codec':meta.get('codec'),'source':'72 PNG frames rendered through official Blender MCP / Metal Cycles 32 samples','sha256':hashlib.sha256((root/'ember-split.mp4').read_bytes()).hexdigest()}
    (root/'ember-video-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
else:
    selected={int(p.stem.split('-')[-1]):Image.open(p).convert('RGB') for p in sorted((root/'ember-check').glob('frame-*.png'))}
assert len(selected)==7
sheet=Image.new('RGB',(1280,410),'#101623');draw=ImageDraw.Draw(sheet)
for n,(frame,im) in enumerate(sorted(selected.items())):
    im=im.resize((320,180));x=(n%4)*320;y=(n//4)*205
    sheet.paste(im,(x,y));draw.text((x+8,y+183),'frame %02d / %.2fs'%(frame,(frame-1)/24),fill='#D6C6AB')
path=root/('ember-contact-sheet.png' if args.mode=='encode' else 'ember-check-contact-sheet.png');sheet.save(path);print(path)
