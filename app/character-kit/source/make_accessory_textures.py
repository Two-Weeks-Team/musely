"""Deterministic, original tileable PBR maps for variant accessories.

Each material gets base color (near-neutral, tinted by the glTF baseColorFactor),
a +Y tangent-space normal map, and ORM (R=occlusion, G=roughness, B=metallic).
No reference pixels are copied. Run with plain Python (numpy + Pillow).
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parent / 'textures' / 'accessories'
OUT.mkdir(parents=True, exist_ok=True)
SEED = 20261101


def tile_noise(rng, n, cells, blur):
    """Tileable value noise: upsample a periodic grid with wraparound."""
    g = rng.uniform(0, 1, (cells, cells))
    g = np.tile(g, (3, 3))
    img = Image.fromarray(np.uint8(g * 255)).resize((n * 3, n * 3), Image.Resampling.BICUBIC)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img, dtype=float)[n:2 * n, n:2 * n] / 255
    return a


def normal_from_height(h, strength):
    # Periodic gradient keeps tiling seamless.
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .5
    nrm = np.dstack((-dx * strength, dy * strength, np.ones_like(h)))  # +Y (OpenGL) convention
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    return np.uint8(np.clip(nrm * .5 + .5, 0, 1) * 255)


def save(name, color, h, strength, rough, metal, occl=None):
    n = h.shape[0]
    Image.fromarray(np.uint8(np.clip(color, 0, 255))).save(OUT / f'{name}-color.png', optimize=True)
    Image.fromarray(normal_from_height(h, strength)).save(OUT / f'{name}-normal.png', optimize=True)
    occ = np.ones((n, n)) if occl is None else occl
    orm = np.dstack((occ, np.clip(rough, 0, 1), np.full((n, n), metal)))
    Image.fromarray(np.uint8(orm * 255)).save(OUT / f'{name}-orm.png', optimize=True)


def weave(n, threads, rng, twill=False):
    y, x = np.mgrid[0:n, 0:n] / n * threads * 2 * np.pi
    warp = .5 + .5 * np.cos(x)
    weft = .5 + .5 * np.cos(y)
    if twill:
        phase = np.sin((x + y) * .5) > 0
    else:
        phase = (np.floor(x / np.pi) + np.floor(y / np.pi)) % 2 == 0
    h = np.where(phase, warp * .7 + .3 * weft, weft * .7 + .3 * warp)
    h += (tile_noise(rng, n, 32, 1.5) - .5) * .25  # slub irregularity
    return h


rng = np.random.default_rng(SEED)
recipes = {}

# Linen: visible plain weave with slubs; matte. Fabrics tile 2.5-3x on garments, so 256 px keeps
# thread/stitch detail while keeping each variant attachment small for the world payload.
n = 256
h = weave(n, 24, rng)
slow = tile_noise(rng, n, 8, 6)
col = np.array([228, 222, 208])[None, None] * (0.92 + h[..., None] * .10 + (slow[..., None] - .5) * .05)
save('linen', col, h, 6, .86 + (h - .5) * .06, 0)
recipes['linen'] = {'size': n, 'threads': 24, 'weave': 'plain', 'roughness': '0.83-0.89'}

# Cotton twill: diagonal twill lines, slightly smoother than linen.
h = weave(n, 32, rng, twill=True)
col = np.array([224, 222, 216])[None, None] * (0.93 + h[..., None] * .08)
save('twill', col, h, 4.5, .80 + (h - .5) * .05, 0)
recipes['twill'] = {'size': n, 'threads': 32, 'weave': 'twill', 'roughness': '0.78-0.83'}

# Knit: stacked V-shaped stitches with yarn fuzz.
y, x = np.mgrid[0:n, 0:n] / n
cols, rows = 16, 20
u = (x * cols) % 1
v = (y * rows) % 1
stitch = np.exp(-((np.abs(u - .5) * 2 - (1 - v) * .55) ** 2) / .03)
h = stitch * .8 + (tile_noise(rng, n, 64, 1) - .5) * .3
col = np.array([232, 228, 220])[None, None] * (0.86 + h[..., None] * .16)
save('knit', col, h, 7, .90 + (h - .5) * .04, 0)
recipes['knit'] = {'size': n, 'stitches': [cols, rows], 'roughness': '0.88-0.92'}

# Waxed canvas: tight weave plus waxy mottling (lower roughness patches).
h = weave(n, 36, rng) * .7
mott = tile_noise(rng, n, 12, 5)
col = np.array([214, 206, 188])[None, None] * (0.90 + h[..., None] * .08 - (mott[..., None] - .5) * .10)
save('canvas', col, h, 4, .62 + (mott - .5) * .18, 0)
recipes['canvas'] = {'size': n, 'threads': 36, 'wax': 'mottled roughness 0.53-0.71'}

# Wood: long grain along V with growth-ring bands.
n = 256
y, x = np.mgrid[0:n, 0:n] / n
warp = tile_noise(rng, n, 6, 4) * 1.4
rings = .5 + .5 * np.sin((x * 14 + warp) * 2 * np.pi)
fibers = tile_noise(rng, n, 96, .6)
h = rings * .6 + fibers * .25
col = np.array([182, 134, 92])[None, None] * (0.78 + rings[..., None] * .22 + (fibers[..., None] - .5) * .08)
save('wood', col, h, 3, .68 + (rings - .5) * .1, 0)
recipes['wood'] = {'size': n, 'rings': 14, 'roughness': '0.63-0.73'}

# Cork: dense irregular pores.
pores = tile_noise(rng, n, 48, .4)
h = 1 - np.clip((pores - .62) * 4, 0, 1)
col = np.array([190, 152, 108])[None, None] * (0.8 + h[..., None] * .2)
save('cork', col, h, 2.5, .88 + (h - .5) * .05, 0, occl=.85 + h * .15)
recipes['cork'] = {'size': n, 'roughness': '0.86-0.90'}

# Brushed metal: fine directional scratches, metallic. Neutral grey, tinted to brass/steel.
streak = np.asarray(Image.fromarray(np.uint8(rng.uniform(0, 255, (n, 8)))).resize((n, n), Image.Resampling.BILINEAR), dtype=float) / 255
streak = np.roll(streak, 0, 0)
h = streak * .5 + tile_noise(rng, n, 64, .5) * .1
col = np.full((n, n, 3), 205.0) * (0.94 + streak[..., None] * .08)
save('brushed-metal', col, h, 1.4, .42 + (streak - .5) * .14, 1)
recipes['brushed-metal'] = {'size': n, 'direction': 'U', 'roughness': '0.35-0.49', 'metallic': 1}

# Matte shell / rubber: fine micro-grain, no weave.
grain = tile_noise(rng, n, 128, .6)
col = np.full((n, n, 3), 228.0) * (0.97 + grain[..., None] * .03)
save('matte-shell', col, grain * .4, 1.2, .58 + (grain - .5) * .06, 0)
recipes['matte-shell'] = {'size': n, 'roughness': '0.55-0.61'}

# Paper: soft fibers, very matte.
fib = tile_noise(rng, n, 80, .8)
col = np.array([238, 232, 216])[None, None] * (0.96 + fib[..., None] * .04)
save('paper', col, fib * .5, 1.5, .92 + (fib - .5) * .03, 0)
recipes['paper'] = {'size': n, 'roughness': '0.90-0.94'}

(OUT / 'recipe.json').write_text(json.dumps({
    'seed': SEED, 'normalConvention': '+Y tangent space',
    'ormChannels': {'R': 'occlusion', 'G': 'roughness', 'B': 'metallic'},
    'colorUse': 'near-neutral albedo tinted by glTF baseColorFactor per variant',
    'origin': 'Original deterministic procedural patterns; no copied reference texture.',
    'materials': recipes}, indent=2) + '\n')
print(json.dumps({p.name: p.stat().st_size for p in sorted(OUT.glob('*.png'))}))
