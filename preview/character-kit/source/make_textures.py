"""Deterministic, original short-fleece PBR maps; no reference pixels are copied."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

out = Path(__file__).resolve().parent / 'textures'
out.mkdir(exist_ok=True)
rng = np.random.default_rng(240731)
n = 1024
height = Image.fromarray(np.uint8(rng.uniform(80, 100, (n, n))))
draw = ImageDraw.Draw(height)
for _ in range(42000):
    x, y = rng.uniform(0, n, 2)
    length = rng.uniform(3, 12)
    dx = rng.normal(0, 2.0)
    draw.line([(x, y), (x + dx * .35, y + length * .4), (x + dx, y + length)], fill=int(rng.uniform(130, 240)), width=1)
h = np.asarray(height.filter(ImageFilter.GaussianBlur(.48)), dtype=float) / 255
dy, dx = np.gradient(h)
normal = np.dstack((-dx * 2.5, -dy * 2.5, np.ones_like(h)))
normal /= np.linalg.norm(normal, axis=2, keepdims=True)
Image.fromarray(np.uint8(np.clip(normal * .5 + .5, 0, 1) * 255)).save(out / 'fleece-normal.png', optimize=True)
slow = np.asarray(Image.fromarray(np.uint8(rng.uniform(65, 190, (64, 64)))).resize((n, n), Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(12)), dtype=float) / 255
color = np.array([222, 205, 178])[None, None, :] * (0.97 + (h - .5)[..., None] * .10 + (slow - .5)[..., None] * .035)
Image.fromarray(np.uint8(np.clip(color, 0, 255))).save(out / 'fleece-color.png', optimize=True)
rough = np.clip(.84 + (h - .5) * .15, .73, .94)
Image.fromarray(np.uint8(np.dstack((np.ones_like(h), rough, np.zeros_like(h))) * 255)).save(out / 'fleece-orm.png', optimize=True)
y, x = np.mgrid[-1:1:512j, -1:1:512j]
face = np.zeros((512, 512, 3)) + np.array([239, 212, 174])
blush = sum(np.exp(-((x - side * .65) ** 2 / .037 + (y - .22) ** 2 / .047)) for side in [-1, 1])
face = face * (1 - blush[..., None] * .8) + np.array([229, 162, 139]) * blush[..., None] * .8
face += rng.normal(0, .55, face.shape)
Image.fromarray(np.uint8(np.clip(face, 0, 255))).save(out / 'face-color.png', optimize=True)
(out / 'recipe.json').write_text(json.dumps({'seed':240731,'fleeceMapSize':n,'fiberStrokes':42000,'normalConvention':'+Y tangent space','ormChannels':{'R':'occlusion=1','G':'roughness','B':'metallic=0'},'faceMapSize':512,'origin':'Original deterministic fiber strokes and color/noise fields; no copied reference texture.'}, indent=2)+'\n')
print(json.dumps({p.name:p.stat().st_size for p in out.glob('*.png')}))
