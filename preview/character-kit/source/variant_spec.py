"""Single source of truth for the ten-character Muse family (base + nine).

Shared by the Blender authoring/export scripts and mirrored into
character-kit/manifest.json for the runtime. Colors are sRGB authoring targets.
"""

VARIANTS = [
    {'id': '00-jolly', 'name': 'Jolly', 'role': 'Base', 'personality': 'Warm, attentive companion; the reference standard',
     'body': '#E8DDC7', 'accent': '#D9A38D', 'signature': None, 'tempo': 1.0},
    {'id': '01-sunny', 'name': 'Sunny', 'role': 'Host', 'personality': 'Outgoing, welcomes neighbors',
     'body': '#E7B75B', 'accent': '#D9886C', 'signature': 'welcome_neighbors', 'tempo': 1.12},
    {'id': '02-moss', 'name': 'Moss', 'role': 'Gardener', 'personality': 'Patient, notices and cares for small things',
     'body': '#9CAD82', 'accent': '#BA8068', 'signature': 'water_plants', 'tempo': 0.9},
    {'id': '03-ripple', 'name': 'Ripple', 'role': 'Explorer', 'personality': 'Curious, observant, enjoys the long way home',
     'body': '#83B8AE', 'accent': '#DBC5A1', 'signature': 'inspect_map', 'tempo': 1.0},
    {'id': '04-ember', 'name': 'Ember', 'role': 'Storykeeper', 'personality': 'Calm, invites others to stay and listen',
     'body': '#CC8F73', 'accent': '#E6BE77', 'signature': 'tell_story', 'tempo': 0.85},
    {'id': '05-bloom', 'name': 'Bloom', 'role': 'Listener', 'personality': 'Empathetic, gives people space',
     'body': '#D5A0B1', 'accent': '#9AAE91', 'signature': 'reassure', 'tempo': 0.9},
    {'id': '06-ink', 'name': 'Ink', 'role': 'Reader', 'personality': 'Thoughtful, focused, quietly playful',
     'body': '#91ABC8', 'accent': '#826D9B', 'signature': 'read_book', 'tempo': 0.95},
    {'id': '07-tempo', 'name': 'Tempo', 'role': 'Music Friend', 'personality': 'Playful rhythm and shared company',
     'body': '#AE9CCB', 'accent': '#E5CF90', 'signature': 'music_bounce', 'tempo': 1.1},
    {'id': '08-orbit', 'name': 'Orbit', 'role': 'Stargazer', 'personality': 'Dreamy, reflective, attentive to the sky',
     'body': '#8D96B8', 'accent': '#DCC589', 'signature': 'observe_sky', 'tempo': 0.85},
    {'id': '09-copper', 'name': 'Copper', 'role': 'Maker', 'personality': 'Practical, inventive, enjoys fixing things',
     'body': '#AD8E79', 'accent': '#7EA6A2', 'signature': 'inspect_gadget', 'tempo': 1.0},
]

# Signature body clips: frames at 24 fps and loop flag.
SIGNATURE_CLIPS = {
    'welcome_neighbors': (60, False),
    'water_plants': (96, True),
    'inspect_map': (96, True),
    'tell_story': (96, True),
    'reassure': (72, True),
    'read_book': (96, True),
    'music_bounce': (48, True),
    'observe_sky': (96, True),
    'inspect_gadget': (96, True),
}

# Chapter-10 action body clips on the shared rig (in place, 24 fps; Root never moves).
#   frames, loop  clip length and loop flag (single-play clips hold their last frame)
#   contact, partner  two-actor clips: contact frame and the clip the partner plays, authored for an
#                     identical partner 0.9 m in front, facing back (PARTNER_DISTANCE_M)
#   stride        locomotion clips: metres travelled per cycle; the world drives their phase by distance
#   prop          shared prop shown on its socket while the clip plays (attachments/props.glb)
PARTNER_DISTANCE_M = 0.9
ACTION_CLIPS = {
    'drink': {'frames': 96, 'loop': True, 'prop': 'cup'},
    'plant': {'frames': 96, 'loop': False, 'prop': 'seedling'},
    'high_five': {'frames': 60, 'loop': False, 'contact': 24, 'partner': 'high_five'},
    'nod': {'frames': 36, 'loop': False},
    'head_shake': {'frames': 48, 'loop': False},
    'point_way': {'frames': 60, 'loop': False},
    'clap': {'frames': 48, 'loop': True},
    'fist_bump': {'frames': 48, 'loop': False, 'contact': 20, 'partner': 'fist_bump'},
    'handoff_give': {'frames': 72, 'loop': False, 'contact': 32, 'partner': 'handoff_receive'},
    'handoff_receive': {'frames': 72, 'loop': False, 'contact': 32, 'partner': 'handoff_give'},
    'eat': {'frames': 96, 'loop': True, 'prop': 'plate'},
    'board': {'frames': 48, 'loop': False},
    'bus_sway': {'frames': 96, 'loop': True},
    'stretch': {'frames': 96, 'loop': False},
    'feed_birds': {'frames': 72, 'loop': True},
    'pick_up': {'frames': 72, 'loop': False},
    'write_note': {'frames': 96, 'loop': True, 'prop': 'notepad'},
    'photo': {'frames': 72, 'loop': False, 'prop': 'camera'},
    'yawn': {'frames': 72, 'loop': False},
    'hammer': {'frames': 48, 'loop': True, 'prop': 'hammer'},
    'lantern_hold': {'frames': 96, 'loop': True},
    'dance': {'frames': 96, 'loop': True},
    'carry_walk': {'frames': 32, 'loop': True, 'stride': 0.27},  # walk's legs and stride contract
    'run': {'frames': 16, 'loop': True, 'stride': 0.222},         # measured foot sweep x2, no slip (walk slips ~49%)
}

# Accessory materials: texture family, tint (sRGB or 'accent'/'body'), roughness/metal hints.
# Tint multiplies the near-neutral procedural albedo.
MATERIALS = {
    'knit': {'tex': 'knit'},
    'linen': {'tex': 'linen'},
    'twill': {'tex': 'twill'},
    'canvas': {'tex': 'canvas'},
    'wood': {'tex': 'wood'},
    'cork': {'tex': 'cork'},
    'brass': {'tex': 'brushed-metal', 'fixed': '#D6B26A'},
    'steel': {'tex': 'brushed-metal', 'fixed': '#C9CDD2'},
    'shell': {'tex': 'matte-shell'},
    'rubber': {'tex': 'matte-shell', 'fixed': '#5B5552'},
    'paper': {'tex': 'paper'},
}


def hex_to_linear(h):
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


# Mean sRGB color of fleece-color.png (measured); fleece tint = palette / mean.
FLEECE_MEAN_SRGB = '#D6C6AB'


def fleece_factor(body_hex, clamp=True):
    p = hex_to_linear(body_hex)
    m = hex_to_linear(FLEECE_MEAN_SRGB)
    f = [pc / mc for pc, mc in zip(p, m)]
    return [min(1.0, x) for x in f] if clamp else f
