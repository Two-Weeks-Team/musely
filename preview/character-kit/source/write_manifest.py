"""Write character-kit/manifest.json and runtime/animations/manifest.json from the exported files.

Plain Python (no Blender). Run after export_kit.py.
"""
from pathlib import Path
import hashlib, json, struct
from variant_spec import VARIANTS, SIGNATURE_CLIPS, ACTION_CLIPS
import fix_tangents

KIT = Path(__file__).resolve().parent.parent
RT = KIT / 'runtime'


def glb_json(p):
    b = p.read_bytes()
    n = struct.unpack('<I', b[12:16])[0]
    return json.loads(b[20:20 + n]), b


def rig_digest(j, b):
    """Joint names/order, hierarchy and inverse-bind matrices (rounded) of the first skin."""
    skin = j['skins'][0]
    names = [j['nodes'][k]['name'] for k in skin['joints']]
    parent = {c: i for i, n in enumerate(j['nodes']) for c in n.get('children', [])}
    parents = [j['nodes'][parent[k]]['name'] if k in parent else None for k in skin['joints']]
    acc = j['accessors'][skin['inverseBindMatrices']]
    view = j['bufferViews'][acc['bufferView']]
    bin_start = 20 + struct.unpack('<I', b[12:16])[0] + 8
    off = bin_start + view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    mats = struct.unpack('<%df' % (16 * acc['count']), b[off:off + 64 * acc['count']])
    payload = json.dumps({'joints': names, 'parents': parents, 'ibm': [round(x, 4) + 0.0 for x in mats]})
    return hashlib.sha256(payload.encode()).hexdigest(), names


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


for glb in sorted(RT.rglob('*.glb')):
    fix_tangents.fix(glb)  # glTF requires unit tangents; repair decimation leftovers before hashing

files = {}
digests = {}
for lod in (0, 1, 2):
    p = RT / f'base/lod{lod}.glb'
    j, b = glb_json(p)
    d, names = rig_digest(j, b)
    digests[f'base/lod{lod}'] = d
    files[f'base/lod{lod}.glb'] = {'bytes': p.stat().st_size, 'sha256': sha(p), 'rigDigest': d,
                                   'clips': [a['name'] for a in j.get('animations', [])]}
for v in VARIANTS[1:]:
    p = RT / f"attachments/{v['id']}.glb"
    j, b = glb_json(p)
    d, _ = rig_digest(j, b) if j.get('skins') else (None, None)
    parts = sorted({n['name'].split('__lod')[0] for n in j['nodes'] if n.get('extras', {}).get('musely_kind')})
    sockets = {n['name']: n['extras'].get('musely_socket') for n in j['nodes'] if n.get('extras', {}).get('musely_kind') == 'prop' and '__lod' not in n['name']}
    files[f"attachments/{v['id']}.glb"] = {'bytes': p.stat().st_size, 'sha256': sha(p), 'rigDigest': d, 'parts': parts, 'propSockets': sockets,
                                          'clips': [a['name'] for a in j.get('animations', [])]}
    digests[v['id']] = d

base_digest = digests['base/lod0']
mismatch = {k: d for k, d in digests.items() if d is not None and d != base_digest}
if mismatch:
    raise SystemExit(f'rig digest mismatch: {mismatch}')

shared = json.loads((RT / 'animations/manifest.json').read_text())
shared_clips = [c for c in shared['clips'] if c['name'] not in SIGNATURE_CLIPS and c['name'] not in ACTION_CLIPS]
shared['clips'] = shared_clips + [{'name': n, 'seconds': f / 24, 'loop': loop, 'signature': True} for n, (f, loop) in SIGNATURE_CLIPS.items()] + [
    {'name': n, 'seconds': spec[0] / 24, 'loop': spec[1], 'action': True, **({'contactSeconds': spec[2] / 24, 'partnerDistanceMeters': 0.9} if len(spec) > 2 else {})}
    for n, spec in ACTION_CLIPS.items() if n in files['base/lod0.glb']['clips']]  # only clips actually exported
shared['schema'] = 'musely.muse-clips.v3'
shared['actionSockets'] = {k: v for k, v in {'drink': 'Socket_Hand_R'}.items() if k in files['base/lod0.glb']['clips']}
(RT / 'animations/manifest.json').write_text(json.dumps(shared, indent=2) + '\n')

manifest = {
    'schema': 'musely.muse-character-kit.v1',
    'note': 'Muse and Jolly are characters of Meta. These fan-made recreations are excluded from the repository license; see NOTICE.md.',
    'rigDigest': base_digest,
    'lodBudgets': {'lod0': 28000, 'lod1': 8000, 'lod2': 3000},
    'residents': ['00-jolly', '01-sunny', '07-tempo', '02-moss', '06-ink', '08-orbit', '05-bloom', '03-ripple'],
    'variants': [{**v, 'lods': [f'base/lod{l}.glb' for l in (0, 1, 2)],
                  'attachment': None if v['id'] == '00-jolly' else f"attachments/{v['id']}.glb",
                  'actions': {'bodyClips': 12 + len([n for n in ACTION_CLIPS if n in files['base/lod0.glb']['clips']]) + (1 if v['signature'] else 0), 'signature': v['signature'],
                              'propClip': v['signature'] if v['signature'] in files.get(f"attachments/{v['id']}.glb", {}).get('clips', []) else None}} for v in VARIANTS],
    'files': files,
}
(KIT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'rigDigest': base_digest, 'files': {k: v['bytes'] for k, v in files.items()}, 'clips': len(shared['clips'])}, indent=1))
