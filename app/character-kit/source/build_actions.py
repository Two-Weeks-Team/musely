"""Author the chapter-10 action clips on the shared Muse rig (drink, plant, high_five).

Run on a copy of muse_family.blend via run_mcp_cli.py (official Blender MCP background tool):
    python3 run_mcp_cli.py <copy.blend> build_actions.py
Idempotent: removes earlier copies of these actions/NLA tracks first, then saves the opened file.

Each clip is in place (Root never moves; routes own translation), 24 fps, keyed every two frames on
every bone like the shared and signature clips. Key poses are authored as joint angles; hand and foot
goals (cup to mouth, palms to the partner, feet planted) are then met exactly by a small damped
least-squares solve on top of the authored angles, so the authored pose stays the regularizer.

The script also measures each clip on the evaluated (skinned) mesh and returns the numbers:
lowest vertex per sampled frame, Socket_Hand_R distance to the hand, cup-to-mouth distance (drink),
hand clearance from the own torso/head, and for high_five a mirrored partner 0.9 m in front:
palm (Socket_Hand_R) distance at the contact frame and hand clearance from the partner's torso/head.
"""
import bpy, math, sys, json
from pathlib import Path
import numpy as np
from mathutils import Vector, Matrix, Euler, Quaternion, kdtree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import importlib, variant_spec
importlib.reload(variant_spec)
from variant_spec import ACTION_CLIPS, PARTNER_DISTANCE_M

ONLY = globals().get('ONLY') or list(ACTION_CLIPS)
scene = bpy.data.scenes['Jolly • Base character studio']
rig = scene.objects['MuseRig']
body, face = scene.objects['Jolly_Base'], scene.objects['Jolly_Face']
BONES = [b.name for b in rig.data.bones]
REST = {b.name: b.matrix_local.copy() for b in rig.data.bones}
RESTQ = {n: m.to_quaternion() for n, m in REST.items()}
PARENT = {b.name: (b.parent.name if b.parent else None) for b in rig.data.bones}
REL = {n: (REST[p].inverted() @ REST[n] if p else REST[n]) for n, p in PARENT.items()}
SOCKET_R = REST['Hand_R'].inverted() @ Vector((-.355, -.023, .17))
SOCKET_L = REST['Hand_L'].inverted() @ Vector((.355, -.023, .17))
MOUTH = Vector((0.0005, -0.168, 0.6461))  # Soft smile centroid (rest), rides on Head
MOUTH_LOCAL = REST['Head'].inverted() @ MOUTH
PARTNER_DISTANCE = PARTNER_DISTANCE_M

# ---------------------------------------------------------------- pose model

def basis_q(name, angles):
    """Same convention as rig_base.rotate: an armature-axis Euler applied about the bone's rest frame."""
    q = RESTQ[name]
    return q.inverted() @ Euler(angles, 'XYZ').to_quaternion() @ q


class Pose:
    def __init__(self, angles=None, hips=(0, 0, 0)):
        self.angles = {n: tuple(a) for n, a in (angles or {}).items()}
        self.hips = tuple(hips)  # armature-space offset of the Hips bone

    def copy(self):
        return Pose(dict(self.angles), self.hips)


def fk(pose):
    hips_loc = RESTQ['Hips'].inverted() @ Vector(pose.hips)
    out = {}
    for n in BONES:
        basis = basis_q(n, pose.angles.get(n, (0, 0, 0))).to_matrix().to_4x4()
        if n == 'Hips':
            basis = Matrix.Translation(hips_loc) @ basis
        out[n] = (out[PARENT[n]] @ REL[n] @ basis) if PARENT[n] else (REL[n] @ basis)
    return out


def bone_point(m, name, local):
    return m[name] @ local


def head_of(m, name):
    return m[name].to_translation()


def axis_y(m, name):
    return (m[name].to_3x3() @ Vector((0, 1, 0))).normalized()


REST_M = fk(Pose())
FOOT_REST = {s: (head_of(REST_M, 'Foot_' + s), axis_y(REST_M, 'Foot_' + s)) for s in 'LR'}


def solve(hint, free, goals, reg=.35, iters=40):
    """Damped least squares over `free` [(bone, axis)] and optional ('hips', axis), starting at `hint`.

    goals: list of (kind, weight, fn(m) -> Vector, target Vector). Regularized toward the hint angles.
    """
    pose = hint.copy()

    def get(p):
        return [p.hips[a] if b == 'hips' else p.angles.get(b, (0, 0, 0))[a] for b, a in free]

    def put(p, x):
        q = p.copy(); ang = {k: list(v) for k, v in q.angles.items()}; hips = list(q.hips)
        for (b, a), v in zip(free, x):
            if b == 'hips':
                hips[a] = v
            else:
                ang.setdefault(b, [0, 0, 0])[a] = v
        return Pose(ang, hips)

    x0 = np.array(get(hint), float)
    # Hips offsets are authored and torso bends stay close to the authored lean; arms and legs move freely.
    scale = np.array([.01 if b == 'hips' else .4 if b in ('Spine', 'Chest') else 1.0 for b, _ in free])

    def residual(x):
        m = fk(put(hint, x))
        r = []
        for _, w, fn, target in goals:
            r.extend((w * (fn(m) - target))[:])
        r.extend(reg * (x - x0) / scale * .1)
        return np.array(r)

    x = x0.copy()
    lam = 1e-3
    r = residual(x); cost = r @ r
    for _ in range(iters):
        J = np.empty((len(r), len(x)))
        for i in range(len(x)):
            d = np.zeros(len(x)); d[i] = 1e-4
            J[:, i] = (residual(x + d) - r) / 1e-4
        A = J.T @ J; g = J.T @ r
        step = -np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-9), g)
        xn = x + step; rn = residual(xn); cn = rn @ rn
        if cn < cost:
            x, r, cost, lam = xn, rn, cn, max(lam / 3, 1e-7)
            if np.abs(step).max() < 1e-6:
                break
        else:
            lam *= 4
    return put(hint, x)


def foot_goals(targets):
    """Keep each foot's head and pointing direction at a target (rest by default): planted support feet."""
    goals = []
    for s, (pos, direction) in targets.items():
        goals.append(('pos', 40, lambda m, s=s: head_of(m, 'Foot_' + s), pos))
        goals.append(('dir', 3, lambda m, s=s: axis_y(m, 'Foot_' + s), direction))
    return goals


LEG_FREE = [(b + s, a) for s in ('_L', '_R') for b in ('UpperLeg', 'LowerLeg', 'Foot') for a in (0, 1, 2)]


def smooth(x):
    x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)


def lerp(a, b, u):
    return tuple(x + (y - x) * u for x, y in zip(a, b))


def blend_angles(a, b, u):
    keys = set(a) | set(b)
    return {k: lerp(a.get(k, (0, 0, 0)), b.get(k, (0, 0, 0)), u) for k in keys}


def keyed(keys, t):
    """Piecewise smoothstep between (t, value) keys; value is a dict of angles or a Vector/tuple."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            u = smooth((t - t0) / (t1 - t0))
            if isinstance(v0, dict):
                return blend_angles(v0, v1, u)
            if isinstance(v0, (int, float)):
                return v0 + (v1 - v0) * u
            return Vector(v0).lerp(Vector(v1), u)
    return keys[-1][1]

# ---------------------------------------------------------------- clips
# Blender rig space: +Z up, the Muse faces -Y, its right side is -X.

ARM_R = [('UpperArm_R', 0), ('UpperArm_R', 1), ('UpperArm_R', 2), ('Forearm_R', 0), ('Forearm_R', 1)]
ARM_L = [('UpperArm_L', 0), ('UpperArm_L', 1), ('UpperArm_L', 2), ('Forearm_L', 0), ('Forearm_L', 1)]


def drink(t):
    """Loop: hold the cup at the chest, raise it to the mouth, sip with the head tipped back, lower, hold."""
    ph = 2 * math.pi * t
    hold = {'UpperArm_R': (-.55, -.35, 0), 'Forearm_R': (-1.0, 0, 0), 'Hand_R': (0, 0, 0)}
    lift = {'UpperArm_R': (-.85, -.55, 0), 'Forearm_R': (-1.55, 0, 0), 'Hand_R': (-.25, 0, 0), 'Head': (.04, 0, 0)}
    sip = {'UpperArm_R': (-1.0, -.6, 0), 'Forearm_R': (-1.65, 0, 0), 'Hand_R': (-.55, 0, 0), 'Head': (-.16, 0, 0), 'Neck': (-.05, 0, 0), 'Chest': (-.03, 0, 0)}
    angles = keyed([(0, hold), (.12, hold), (.32, lift), (.42, sip), (.62, sip), (.74, lift), (.9, hold), (1, hold)], t)
    angles['UpperArm_L'] = (-.08 - .03 * math.sin(ph), -.06, 0)
    angles['Forearm_L'] = (-.18, 0, 0)
    c = angles.get('Chest', (0, 0, 0)); angles['Chest'] = (c[0] + .008 * math.sin(ph), c[1], c[2])
    pose = Pose(angles)
    hold_p, mouth_off = Vector((-.12, -.27, .40)), Vector((.012, -.07, -.035))
    # Cup goal: chest hold <-> just in front of and below the mouth, which itself follows the head.
    w = keyed([(0, 0.0), (.12, 0.0), (.36, 1.0), (.68, 1.0), (.9, 0.0), (1, 0.0)], t)

    def goal_point(m):
        return bone_point(m, 'Hand_R', SOCKET_R)

    m0 = fk(pose)
    mouth_now = bone_point(m0, 'Head', MOUTH_LOCAL)
    target = hold_p.lerp(mouth_now + mouth_off, w)
    return pose, ARM_R + [('Hand_R', 0)], [('pos', 30, goal_point, target)]


def plant(t):
    """Single play: kneel (right foot back, hips down), bow, reach both hands to the soil, pat twice, hold."""
    kneel = smooth(t / .32)
    reach = smooth((t - .25) / .25)
    pat = math.sin(math.pi * 2 * max(0, min(1, (t - .55) / .3))) ** 2 if .55 < t < .85 else 0
    lean = .62 * smooth(t / .45)
    angles = {
        'Spine': (lean * .55, 0, 0), 'Chest': (lean * .45, 0, 0), 'Neck': (-.12 * reach, 0, 0), 'Head': (-.10 * reach + .04 * pat, 0, 0),
        # Arms hang (counter the bow) until they reach for the soil.
        'UpperArm_R': (-lean * (1 - reach) - .9 * reach, .25 * reach, 0), 'Forearm_R': (-.35 * reach, 0, 0),
        'UpperArm_L': (-lean * (1 - reach) - .9 * reach, -.25 * reach, 0), 'Forearm_L': (-.35 * reach, 0, 0),
        'UpperLeg_L': (-.9 * kneel, 0, 0), 'LowerLeg_L': (1.2 * kneel, 0, 0),
        'UpperLeg_R': (-.4 * kneel, 0, 0), 'LowerLeg_R': (1.6 * kneel, 0, 0), 'Foot_R': (.5 * kneel, 0, 0),
    }
    pose = Pose(angles, (0, -.012 * kneel, -.085 * kneel))
    foot_r = (FOOT_REST['R'][0] + Vector((0, .07, .046)) * kneel,
              (FOOT_REST['R'][1] + (Euler((.75 * kneel, 0, 0)).to_matrix() @ FOOT_REST['R'][1] - FOOT_REST['R'][1])).normalized())
    foot_l = (FOOT_REST['L'][0] + Vector((0, -.03, 0)) * kneel, FOOT_REST['L'][1])
    goals = foot_goals({'L': foot_l, 'R': foot_r})
    soil = {'R': Vector((-.10, -.27, .045)), 'L': Vector((.10, -.27, .045))}
    if reach > 0:
        for s, sock in (('R', SOCKET_R), ('L', SOCKET_L)):
            m0 = fk(pose)
            start = bone_point(m0, 'Hand_' + s, sock)
            target = start.lerp(soil[s] + Vector((0, 0, .035 * pat)), reach)
            goals.append(('pos', 25, lambda m, s=s, sock=sock: bone_point(m, 'Hand_' + s, sock), target))
    free = LEG_FREE + [('hips', 1)] + ([('Spine', 0), ('Chest', 0)] + ARM_R + ARM_L if reach > 0 else [])
    return pose, free, goals


def bezier(a, c, b, u):
    return a * (1 - u) ** 2 + c * (2 * u * (1 - u)) + b * u * u


HIGH_FIVE_CONTACT = ACTION_CLIPS['high_five']['contact']


def high_five(t):
    """Single play: lean in and wind up, strike the right palm forward to a partner 0.9 m in front, hold the touch,
    pull the hand back and out (so the two hands separate instead of sliding through each other), settle."""
    frames = ACTION_CLIPS['high_five']['frames']
    tc = HIGH_FIVE_CONTACT / frames
    ready = smooth(t / (tc * .7)) * (1 - smooth((t - (tc + .18)) / .3))
    strike_in = smooth((t - tc * .55) / (tc * .45))
    recoil = smooth((t - tc - .04) / .16)
    reach = strike_in * (1 - smooth((t - tc - .1) / .3))          # authored arm angles
    release = smooth((t - tc - .2) / .2)                          # palm goal hands back to the authored arm
    weight = strike_in * (1 - release)
    windup = smooth(t / (tc * .55)) * (1 - smooth((t - tc * .55) / (tc * .4)))
    angles = {
        'Spine': (.16 * ready, 0, .16 * ready), 'Chest': (.10 * ready, 0, .22 * ready), 'Head': (-.10 * ready, 0, -.18 * ready),
        'UpperArm_R': (-1.7 * reach - 1.2 * windup, -.35 * reach + .45 * windup + .3 * recoil * reach, 0), 'Forearm_R': (-.25 * reach - 1.1 * windup, 0, 0),
        'Hand_R': (-.25 * reach, 0, 0),
        'UpperArm_L': (-.1 * ready, -.18 * ready, 0), 'Forearm_L': (-.3 * ready, 0, 0),
        'UpperLeg_R': (-.25 * ready, 0, 0), 'LowerLeg_R': (.2 * ready, 0, 0),
    }
    pose = Pose(angles, (0, -.045 * ready, -.01 * ready))
    goals = foot_goals({'L': FOOT_REST['L'], 'R': (FOOT_REST['R'][0] + Vector((0, -.05, 0)) * ready, FOOT_REST['R'][1])})
    free = LEG_FREE + [('hips', 1)]
    if weight > 1e-3:
        # Palm goal: the arm-end cap meets the partner's at the midpoint, facing them (-Y), with a few mm to spare.
        contact = Vector((0, -(PARTNER_DISTANCE / 2 - .019), .66))
        m0 = fk(pose)
        start = bone_point(m0, 'Hand_R', SOCKET_R)
        pre = contact + Vector((0, .11, 0))  # task 5b: arrive along the midline so the two hands never graze in passing
        if t <= tc:
            target = bezier(start, pre + Vector((-.12, .04, -.06)), pre, min(1, strike_in / .7)) if strike_in < .7 else pre.lerp(contact, (strike_in - .7) / .3)
        else:
            target = (contact + Vector((-.16, .17, -.04)) * recoil).lerp(start, release)
        goals += [('pos', 30 * weight, lambda m: bone_point(m, 'Hand_R', SOCKET_R), target),
                  ('dir', 2 * weight, lambda m: axis_y(m, 'Hand_R'), Vector((0, -1, .25)).normalized())]
        free += [('Spine', 0), ('Spine', 2), ('Chest', 0), ('Chest', 2)] + ARM_R + [('Hand_R', 0), ('Hand_R', 1)]
    return pose, free, goals



# ---------------------------------------------------------------- task 5b: interaction and greeting clips

def hand_goal(side, target, w=30):
    sock = SOCKET_R if side == 'R' else SOCKET_L
    return ('pos', w, lambda m, s=side, k=sock: bone_point(m, 'Hand_' + s, k), Vector(target))


def hand_dir(side, direction, w=2):
    return ('dir', w, lambda m, s=side: axis_y(m, 'Hand_' + s), Vector(direction).normalized())


def arm_free(side):
    return ARM_R + [('Hand_R', 0)] if side == 'R' else ARM_L + [('Hand_L', 0)]


def env(t, a, b, c, d):
    """0 before a, smooth rise to 1 at b, hold, smooth fall to 0 from c to d."""
    return smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)))


def nod(t):
    e = math.sin(math.pi * t)
    dip = .5 - .5 * math.cos(4 * math.pi * t)  # two nods
    return Pose({'Head': (.22 * e * dip, 0, 0), 'Neck': (.06 * e * dip, 0, 0), 'Chest': (.02 * e, 0, 0)}), [], []


def head_shake(t):
    e = math.sin(math.pi * t) ** .7
    sh = math.sin(6 * math.pi * t)  # three shakes
    return Pose({'Head': (.04 * e, 0, .32 * e * sh), 'Neck': (0, 0, .08 * e * sh), 'Chest': (0, 0, .02 * e * sh)}), [], []


def point_way(t):
    e = env(t, .08, .3, .78, .97)
    angles = {'UpperArm_R': (-1.3 * e, .55 * e, 0), 'Forearm_R': (-.1 * e, 0, 0), 'Head': (-.04 * e, 0, -.32 * e),
              'Neck': (0, 0, -.08 * e), 'Chest': (0, 0, -.12 * e), 'UpperArm_L': (-.05 * e, -.05 * e, 0)}
    pose = Pose(angles)
    if e < 1e-3:
        return pose, [], []
    start = bone_point(fk(pose), 'Hand_R', SOCKET_R)
    target = start.lerp(Vector((-.36, -.34, .58)), e)
    return pose, arm_free('R') + [('Hand_R', 1)], [hand_goal('R', target, 30 * e), hand_dir('R', (-.55, -.83, .1), 3 * e)]


def clap(t):
    """Loop: four claps in front of the chest, slight bounce."""
    s = abs(math.sin(4 * math.pi * t))
    gap = .036 + .1 * s
    angles = {'UpperArm_R': (-.75, -.2, 0), 'Forearm_R': (-1.1, 0, 0), 'UpperArm_L': (-.75, .2, 0), 'Forearm_L': (-1.1, 0, 0),
              'Head': (-.04, 0, .03 * math.sin(2 * math.pi * t)), 'Chest': (-.02 + .015 * (1 - s), 0, 0)}
    goals = [hand_goal('R', (-gap, -.30, .42)), hand_goal('L', (gap, -.30, .42)), hand_dir('R', (.75, -.65, .1)), hand_dir('L', (-.75, -.65, .1))]
    return Pose(angles), arm_free('R') + arm_free('L') + [('Hand_R', 1), ('Hand_L', 1)], goals


def contact_clip(t, frames, contact_frame, contact_point, contact_dir, recoil, windup_angles=None, lift=1.0):
    """Shared shape of a single-play right-hand contact with a partner: approach, touch at the contact frame, recoil, settle."""
    tc = contact_frame / frames
    ready = smooth(t / (tc * .7)) * (1 - smooth((t - (tc + .2)) / .3))
    strike_in = smooth((t - tc * .35) / (tc * .65))
    rec = smooth((t - tc - .04) / .16)
    release = smooth((t - tc - .2) / .22)
    reach = strike_in * (1 - smooth((t - tc - .1) / .3))
    angles = {
        'Spine': (.12 * ready, 0, .12 * ready), 'Chest': (.08 * ready, 0, .16 * ready), 'Head': (-.06 * ready, 0, -.14 * ready),
        'UpperArm_R': (-1.2 * reach * lift, -.3 * reach, 0), 'Forearm_R': (-.4 * reach, 0, 0),
        'UpperArm_L': (-.1 * ready, -.12 * ready, 0), 'Forearm_L': (-.3 * ready, 0, 0),
    }
    pose = Pose(angles, (0, -.03 * ready, -.008 * ready))
    goals = foot_goals({'L': FOOT_REST['L'], 'R': (FOOT_REST['R'][0] + Vector((0, -.04, 0)) * ready, FOOT_REST['R'][1])})
    free = LEG_FREE + [('hips', 1)]
    weight = strike_in * (1 - release)
    if weight > 1e-3:
        start = bone_point(fk(pose), 'Hand_R', SOCKET_R)
        cp = Vector(contact_point)
        pre = cp + Vector((0, .11, 0))  # line up on the midline first, then move straight in, so the hands never slide past each other
        back = cp + Vector(recoil) * rec
        if t <= tc:
            target = bezier(start, pre + Vector((-.12, .04, -.06)), pre, min(1, strike_in / .7)) if strike_in < .7 else pre.lerp(cp, (strike_in - .7) / .3)
        else:
            target = bezier(back, Vector((-.42, -.24, .30)), start, release)
        goals += [('pos', 30 * weight, lambda m: bone_point(m, 'Hand_R', SOCKET_R), target), hand_dir('R', contact_dir, 2 * weight)]
        free += [('Spine', 0), ('Spine', 2), ('Chest', 0), ('Chest', 2)] + ARM_R + [('Hand_R', 0), ('Hand_R', 1)]
    return pose, free, goals


def fist_bump(t):
    spec = ACTION_CLIPS['fist_bump']
    return contact_clip(t, spec['frames'], spec['contact'], (0, -(PARTNER_DISTANCE / 2 - .019), .46), (0, -1, 0), (-.16, .14, -.02))


def handoff_give(t):
    """Giver: offer the item forward at chest height, hold while the receiver takes it, withdraw the empty hand."""
    spec = ACTION_CLIPS['handoff_give']
    return contact_clip(t, spec['frames'], spec['contact'], (0, -(PARTNER_DISTANCE / 2 - .024), .44), (0, -1, -.15), (-.16, .14, -.02), lift=.8)


def handoff_receive(t):
    """Receiver: reach under the offered item, take it at the contact frame, bring it to the chest and keep it."""
    spec = ACTION_CLIPS['handoff_receive']
    tc = spec['contact'] / spec['frames']
    ready = smooth(t / (tc * .7)) * (1 - smooth((t - (tc + .25)) / .3))
    reach = smooth((t - tc * .45) / (tc * .55))
    keep = smooth((t - tc - .04) / .3)       # bring the item to the chest and hold it there
    angles = {
        'Spine': (.1 * ready, 0, .12 * ready), 'Chest': (.06 * ready, 0, .14 * ready), 'Head': (.04 * ready, 0, -.12 * ready),
        'UpperArm_R': (-1.0 * reach, -.3 * reach, 0), 'Forearm_R': (-.5 * reach - .6 * keep, 0, 0),
        'UpperArm_L': (-.4 * keep, -.15 * keep, 0), 'Forearm_L': (-.8 * keep, 0, 0),
    }
    pose = Pose(angles, (0, -.025 * ready, -.006 * ready))
    goals = foot_goals({'L': FOOT_REST['L'], 'R': (FOOT_REST['R'][0] + Vector((0, -.035, 0)) * ready, FOOT_REST['R'][1])})
    free = LEG_FREE + [('hips', 1)] + [('Spine', 0), ('Spine', 2), ('Chest', 0), ('Chest', 2)] + ARM_R + [('Hand_R', 0), ('Hand_R', 1)] + ARM_L
    m0 = fk(Pose(angles))
    start, start_l = bone_point(m0, 'Hand_R', SOCKET_R), bone_point(m0, 'Hand_L', SOCKET_L)
    contact = Vector((0, -(PARTNER_DISTANCE / 2 - .024), .42))
    pre = contact + Vector((0, .11, 0))
    chest = Vector((-.06, -.28, .42))
    if t <= tc:
        target = bezier(start, pre + Vector((-.12, .04, -.06)), pre, min(1, reach / .7)) if reach < .7 else pre.lerp(contact, (reach - .7) / .3)
    else:
        target = contact.lerp(chest, keep)
    goals += [hand_goal('R', target, 30), hand_dir('R', (0, -1, .15), 2 * (1 - keep))]
    if keep > 0:
        # Left hand comes round the outside of the belly to steady the item at the chest.
        goals.append(hand_goal('L', bezier(start_l, Vector((.40, -.34, .26)), chest + Vector((.12, -.01, -.02)), keep), 20))
    return pose, free, goals


# ---------------------------------------------------------------- task 5b: place clips

def planted(hips=(0, 0, 0)):
    """Feet stay at rest while the hips move: leg IK goals and free leg joints."""
    return foot_goals({'L': FOOT_REST['L'], 'R': FOOT_REST['R']}), LEG_FREE


def mouth_of(pose):
    return bone_point(fk(pose), 'Head', MOUTH_LOCAL)


def eat(t):
    """Loop: plate held low in the left hand; the right hand scoops and brings food to the mouth, twice."""
    u = (2 * t) % 1
    w = keyed([(0, 0.0), (.18, 0.0), (.42, 1.0), (.58, 1.0), (.85, 0.0), (1, 0.0)], u)
    angles = {'UpperArm_L': (-.55, .3, 0), 'Forearm_L': (-1.0, 0, 0), 'UpperArm_R': (-.6 - .3 * w, -.35, 0), 'Forearm_R': (-1.1 - .45 * w, 0, 0),
              'Head': (.14 * (1 - w) - .05 * w, 0, 0), 'Neck': (.04 * (1 - w), 0, 0), 'Chest': (.03, 0, 0)}
    pose = Pose(angles)
    plate = Vector((.10, -.27, .36))
    scoop = Vector((.04, -.30, .40)) + Vector((0, 0, .015 * math.sin(math.pi * min(1, u / .18))))
    target = scoop.lerp(mouth_of(pose) + Vector((.012, -.07, -.035)), w)
    return pose, arm_free('R') + arm_free('L'), [hand_goal('L', plate), hand_goal('R', target), hand_dir('L', (-.6, -.8, .1), 2)]


def board(t):
    """Single play: crouch on the support leg, lift the right foot high onto a step, reach up for the rail, settle."""
    lift = env(t, .08, .35, .55, .85)
    grab = env(t, .05, .3, .75, .97)
    angles = {'Spine': (.12 * lift, 0, 0), 'Chest': (.06 * lift, 0, -.06 * grab), 'Head': (-.08 * grab, 0, .05 * grab),
              'UpperArm_L': (-1.6 * grab, -.25 * grab, 0), 'Forearm_L': (-.5 * grab, 0, 0), 'UpperArm_R': (-.2 * lift, 0, 0)}
    pose = Pose(angles, (0, 0, -.03 * lift))
    goals = foot_goals({'L': FOOT_REST['L'], 'R': (FOOT_REST['R'][0] + Vector((0, -.10, .12)) * lift, FOOT_REST['R'][1])})
    return pose, LEG_FREE + [('hips', 2)], goals


def bus_sway(t):
    """Loop: right hand on an overhead strap while the bus rocks the body side to side."""
    ph = 2 * math.pi * t
    angles = {'Spine': (.015 * math.sin(2 * ph), .05 * math.sin(ph), 0), 'Chest': (0, .035 * math.sin(ph + .6), 0), 'Head': (0, -.05 * math.sin(ph + 1.2), .04 * math.sin(ph)),
              'UpperArm_R': (-.2, 2.3, 0), 'Forearm_R': (0, .2, 0), 'UpperArm_L': (-.05, -.06 * math.sin(ph + .8), 0), 'Forearm_L': (-.15, 0, 0)}
    pose = Pose(angles)
    strap = Vector((-.31, -.06, .81))  # beside, not inside, the hood
    return pose, arm_free('R'), [hand_goal('R', strap, 20), hand_dir('R', (0, 0, 1), 2)]


def stretch(t):
    """Single play: both arms up in a V, lean left and right, lower."""
    up = env(t, .05, .28, .78, .97)
    bend = math.sin(2 * math.pi * (t - .32) / .44) if .32 <= t <= .76 else 0
    angles = {'UpperArm_R': (-.1 * up, 2.45 * up, 0), 'Forearm_R': (0, .25 * up, 0), 'UpperArm_L': (-.1 * up, -2.45 * up, 0), 'Forearm_L': (0, -.25 * up, 0),
              'Spine': (-.04 * up, .16 * bend, 0), 'Chest': (-.05 * up, .12 * bend, 0), 'Head': (-.12 * up, -.06 * bend, 0)}
    return Pose(angles), [], []


def feed_birds(t):
    """Loop: slight bow, the left hand holds the seed pouch, the right hand takes seed and tosses it forward, twice."""
    u = (2 * t) % 1
    angles = {'Spine': (.12, 0, 0), 'Chest': (.08, 0, 0), 'Head': (.18, 0, -.05), 'UpperArm_L': (-.5, .3, 0), 'Forearm_L': (-.9, 0, 0),
              'UpperArm_R': (-.6, -.3, 0), 'Forearm_R': (-.9, 0, 0)}
    pose = Pose(angles)
    pouch = Vector((.08, -.27, .33))
    target = keyed([(0, (.02, -.30, .35)), (.3, (.02, -.30, .35)), (.5, (-.18, -.42, .30)), (.6, (-.20, -.43, .29)), (.85, (.02, -.30, .35)), (1, (.02, -.30, .35))], u)
    return pose, arm_free('R') + arm_free('L'), [hand_goal('L', pouch), hand_goal('R', target)]


def pick_up(t):
    """Single play: squat and bow, take something from the ground with the right hand, stand and hold it at the chest."""
    down = env(t, .05, .32, .55, .82)
    angles = {'Spine': (.55 * down, 0, 0), 'Chest': (.35 * down, 0, 0), 'Head': (-.1 * down, 0, 0), 'UpperArm_L': (-.4 * down, .2 * down, 0), 'Forearm_L': (-.3 * down, 0, 0),
              'UpperArm_R': (-.6, -.3, 0), 'Forearm_R': (-.6, 0, 0)}
    pose = Pose(angles, (0, 0, -.075 * down))
    goals, free = planted()
    m0 = fk(Pose({k: v for k, v in angles.items() if not k.endswith('_R')}, pose.hips))
    rest_hand = bone_point(m0, 'Hand_R', SOCKET_R)
    ground, chest = Vector((-.08, -.29, .05)), Vector((-.08, -.27, .42))
    reach = smooth((t - .1) / .25)
    # Down and up in front of the body (control points ahead of the belly), not through it.
    target = bezier(rest_hand, Vector((-.30, -.36, .16)), ground, reach) if t < .55 else bezier(ground, Vector((-.12, -.42, .25)), chest, smooth((t - .55) / .3))
    goals = goals + [hand_goal('R', target, 30)]
    return pose, free + [('hips', 2), ('Spine', 0), ('Chest', 0)] + arm_free('R'), goals


def write_note(t):
    """Loop: notepad in the left hand, the right hand writes three short lines; head down."""
    line = int(3 * t) % 3; u = (3 * t) % 1
    x = -.05 + .07 * smooth(u / .8) - .07 * smooth((u - .8) / .2)
    angles = {'Head': (.24, 0, .04 * (u - .5)), 'Neck': (.06, 0, 0), 'Chest': (.04, 0, 0),
              'UpperArm_L': (-.6, .3, 0), 'Forearm_L': (-1.0, 0, 0), 'UpperArm_R': (-.65, -.35, 0), 'Forearm_R': (-1.1, 0, 0)}
    pad = Vector((.06, -.29, .40))
    pen = Vector((x, -.315, .44 - .014 * line + .006 * math.sin(2 * math.pi * 10 * u) * (u < .8)))
    return Pose(angles), arm_free('R') + arm_free('L'), [hand_goal('L', pad), hand_goal('R', pen), hand_dir('L', (-.5, -.8, .3), 2)]


def photo(t):
    """Single play: raise the camera to the eyes with both hands, hold, click, lower."""
    up = env(t, .06, .3, .74, .95)
    click = math.sin(math.pi * min(1, max(0, (t - .52) / .05)))
    angles = {'UpperArm_R': (-1.0 * up, -.3 * up, 0), 'Forearm_R': (-1.3 * up, 0, 0), 'UpperArm_L': (-1.0 * up, .3 * up, 0), 'Forearm_L': (-1.3 * up, 0, 0),
              'Head': (.04 * up + .04 * click, 0, 0), 'Chest': (-.02 * up, 0, 0)}
    pose = Pose(angles)
    if up < 1e-3:
        return pose, [], []
    m0 = fk(Pose({}))
    # Raise along an arc in front of the belly so the hands never pass through it.
    r = bezier(bone_point(m0, 'Hand_R', SOCKET_R), Vector((-.24, -.46, .30)), Vector((-.07, -.27, .66 - .01 * click)), up)
    l = bezier(bone_point(m0, 'Hand_L', SOCKET_L), Vector((.24, -.46, .30)), Vector((.07, -.27, .66)), up)
    return pose, arm_free('R') + arm_free('L'), [hand_goal('R', r, 30 * up), hand_goal('L', l, 30 * up)]


def yawn(t):
    """Single play: arms half up and out, head tipped back, chest open; then relax."""
    a = env(t, .1, .42, .6, .92)
    angles = {'UpperArm_R': (-.35 * a, 1.35 * a, 0), 'Forearm_R': (-.5 * a, 0, 0), 'UpperArm_L': (-.35 * a, -1.35 * a, 0), 'Forearm_L': (-.5 * a, 0, 0),
              'Head': (-.3 * a, 0, .04 * a), 'Neck': (-.06 * a, 0, 0), 'Chest': (-.08 * a, 0, 0), 'Spine': (-.04 * a, 0, 0)}
    return Pose(angles), [], []


def hammer(t):
    """Loop: two strikes; the right hand lifts the hammer slowly and brings it down fast; the left hand steadies the nail."""
    u = (2 * t) % 1
    angles = {'Head': (.2, 0, -.04), 'Neck': (.05, 0, 0), 'Spine': (.06, 0, 0), 'UpperArm_L': (-.6, .25, 0), 'Forearm_L': (-.6, 0, 0),
              'UpperArm_R': (-.9, -.2, 0), 'Forearm_R': (-1.0, 0, 0)}
    target = keyed([(0, (-.11, -.32, .33)), (.15, (-.11, -.32, .33)), (.55, (-.18, -.24, .62)), (.68, (-.10, -.33, .30)), (.75, (-.11, -.32, .32)), (1, (-.11, -.32, .33))], u)
    return Pose(angles), arm_free('R') + arm_free('L'), [hand_goal('R', target), hand_goal('L', (.03, -.33, .29))]


def lantern_hold(t):
    """Loop: the left hand holds a lantern up in front; it bobs and sways gently; the head watches it."""
    ph = 2 * math.pi * t
    angles = {'UpperArm_L': (-1.1, .3, 0), 'Forearm_L': (-.4, 0, 0), 'Head': (-.04, 0, .1 + .03 * math.sin(ph)), 'Chest': (0, 0, .04),
              'UpperArm_R': (-.06, -.04, 0), 'Forearm_R': (-.15, 0, 0)}
    lantern = Vector((.13 + .015 * math.sin(ph), -.31, .55 + .012 * math.sin(2 * ph)))
    return Pose(angles), arm_free('L'), [hand_goal('L', lantern)]


def dance(t):
    """Loop: bounce on the beat (two per second), hips sway, arms take turns going up."""
    beat = abs(math.sin(math.pi * 8 * t))
    s = math.sin(2 * math.pi * 2 * t)
    up_r, up_l = max(0, s), max(0, -s)
    angles = {'Spine': (0, .09 * s, .06 * s), 'Chest': (0, .05 * s, .12 * s), 'Head': (.06 * beat, -.05 * s, .1 * s),
              'UpperArm_R': (-.3 - .6 * up_r, .2 + 1.1 * up_r, 0), 'Forearm_R': (-.6 - .3 * up_r, 0, 0),
              'UpperArm_L': (-.3 - .6 * up_l, -.2 - 1.1 * up_l, 0), 'Forearm_L': (-.6 - .3 * up_l, 0, 0)}
    pose = Pose(angles, (0, 0, -.022 * (1 - beat)))
    goals, free = planted()
    return pose, free, goals


# ---------------------------------------------------------------- task 5b: locomotion-coupled clips
# In place like `walk`: Root never moves, the route owns translation, and the world drives the phase by
# travelled distance (variant_spec stride, metres per cycle). The measured foot sweep is reported.

def walk_legs(ph, amp=.32, knee=.5, foot=.18):
    """The shared walk's leg cycle (rig_base.py), parameterised."""
    out = {}
    for side, shift in (('L', 0), ('R', math.pi)):
        v = math.sin(ph + shift)
        out['UpperLeg_' + side] = (-amp * v, 0, 0); out['LowerLeg_' + side] = (max(0, v) * knee, 0, 0); out['Foot_' + side] = (-max(0, v) * foot, 0, 0)
    return out


def carry_walk(t):
    """Loop (32 frames, same legs and stride as walk): both hands carry a box in front of the chest, slight lean back."""
    ph = 2 * math.pi * t
    angles = walk_legs(ph)
    angles.update({'Hips': (0, .018 * math.sin(ph), .02 * math.sin(ph)), 'Spine': (-.04, 0, 0), 'Chest': (-.03, 0, -.02 * math.sin(ph)), 'Head': (.03, 0, 0),
                   'UpperArm_R': (-.75, -.25, 0), 'Forearm_R': (-.75, 0, 0), 'UpperArm_L': (-.75, .25, 0), 'Forearm_L': (-.75, 0, 0)})
    bob = .006 * math.sin(2 * ph)
    pose = Pose(angles, (0, 0, .002 * (1 - math.cos(2 * ph))))
    goals = [hand_goal('R', (-.13, -.28, .38 + bob)), hand_goal('L', (.13, -.28, .38 + bob)), hand_dir('R', (.7, -.7, 0)), hand_dir('L', (-.7, -.7, 0))]
    return pose, arm_free('R') + arm_free('L'), goals


def run(t):
    """Loop (16 frames): longer leg swing with a tucked knee, pumping bent arms, forward lean, a small bounce."""
    ph = 2 * math.pi * t
    angles = walk_legs(ph, amp=.55, knee=.95, foot=.3)
    s = math.sin(ph)
    angles.update({'Hips': (0, .025 * s, .035 * s), 'Spine': (.14, 0, 0), 'Chest': (.06, 0, -.05 * s), 'Head': (-.1, 0, .03 * s),
                   'UpperArm_R': (.5 * s - .1, -.08, 0), 'Forearm_R': (-1.25, 0, 0), 'UpperArm_L': (-.5 * s - .1, .08, 0), 'Forearm_L': (-1.25, 0, 0)})
    return Pose(angles, (0, 0, .012 * abs(math.sin(2 * ph)) - .004)), [], []

AUTHORS = {'drink': drink, 'plant': plant, 'high_five': high_five, 'nod': nod, 'head_shake': head_shake, 'point_way': point_way,
           'clap': clap, 'fist_bump': fist_bump, 'handoff_give': handoff_give, 'handoff_receive': handoff_receive,
           'eat': eat, 'board': board, 'bus_sway': bus_sway, 'stretch': stretch, 'feed_birds': feed_birds, 'pick_up': pick_up,
           'write_note': write_note, 'photo': photo, 'yawn': yawn, 'hammer': hammer, 'lantern_hold': lantern_hold, 'dance': dance,
           'carry_walk': carry_walk, 'run': run}

# ---------------------------------------------------------------- bake

for name in ONLY:
    if name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[name])
    for tr in list(rig.animation_data.nla_tracks):
        if tr.name == name:
            rig.animation_data.nla_tracks.remove(tr)
for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'

solved = {}
for name in ONLY:
    frames, loop = ACTION_CLIPS[name]['frames'], ACTION_CLIPS[name]['loop']
    action = bpy.data.actions.new(name); action.use_fake_user = True
    slot = action.slots.new('OBJECT', rig.name)
    rig.animation_data.action = action; rig.animation_data.action_slot = slot
    poses = {}
    for frame in range(1, frames + 2, 2):
        t = (frame - 1) / frames
        hint, free, goals = AUTHORS[name](t)
        pose = solve(hint, free, goals) if goals else hint
        poses[frame] = pose
        hips_loc = RESTQ['Hips'].inverted() @ Vector(pose.hips)
        for pb in rig.pose.bones:
            pb.rotation_quaternion = basis_q(pb.name, pose.angles.get(pb.name, (0, 0, 0)))
            pb.location = hips_loc if pb.name == 'Hips' else Vector((0, 0, 0)); pb.scale = (1, 1, 1)
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=frame, group=pb.name)
            if pb.name in ['Hips', 'Chest']:
                pb.keyframe_insert('location', frame=frame, group=pb.name); pb.keyframe_insert('scale', frame=frame, group=pb.name)
    track = rig.animation_data.nla_tracks.new(); track.name = name
    strip = track.strips.new(name, 1, action); strip.action_slot = slot
    strip.action_frame_start = 1; strip.action_frame_end = frames + 1; track.mute = True
    solved[name] = poses

# ---------------------------------------------------------------- measure on the evaluated mesh

def groups_of(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    out = []
    for v in ob.data.vertices:
        top = max(v.groups, key=lambda g: g.weight) if v.groups else None
        out.append(names[top.group] if top else 'Head')
    return out


TORSO = {'Hips', 'Spine', 'Chest', 'Neck', 'Head'}
body_groups = groups_of(body)


_eval_cache = {}
def evaluated(name, frame):
    """Skinned body+face vertices (group, position, normal) and both hand sockets for clip `name` at `frame`."""
    key = (name, frame)
    if key in _eval_cache:
        return _eval_cache[key]
    a = bpy.data.actions[name]
    rig.animation_data.action = a; rig.animation_data.action_slot = a.slots[0]
    scene.frame_set(frame)
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for ob, groups in ((body, body_groups), (face, None)):
        ev = ob.evaluated_get(dg); me = ev.to_mesh(); mw = ev.matrix_world
        nm = mw.to_3x3()
        for i, v in enumerate(me.vertices):
            pts.append((groups[i] if groups else 'Head', mw @ v.co, (nm @ v.normal).normalized()))
        ev.to_mesh_clear()
    socks = {s: scene.objects['Socket_Hand_' + s].evaluated_get(dg).matrix_world.translation.copy() for s in 'RL'}
    feet = {s: rig.pose.bones['Foot_' + s].head.copy() for s in 'LR'}
    _eval_cache[key] = (pts, socks, feet)
    return _eval_cache[key]


def clearance(points, surface, far=None):
    """Min signed distance of points from a surface given as (pos, normal) list (nearest-vertex test).
    With `far`, a point farther than `far` from its nearest vertex counts as outside (unsigned): for small
    closed parts such as a hand, a far nearest vertex on the back side would otherwise flip the sign."""
    tree = kdtree.KDTree(len(surface))
    for i, (p, _) in enumerate(surface):
        tree.insert(p, i)
    tree.balance()
    worst = 1e9
    for p in points:
        _, i, d = tree.find(p)
        q, n = surface[i]
        worst = min(worst, d if far is not None and d > far else (p - q).dot(n))
    return worst


R180 = Matrix.Rotation(math.pi, 3, 'Z')
OFFSET = Vector((0, -PARTNER_DISTANCE, 0))
mirror = lambda p: R180 @ p + OFFSET
report = {}
for name in ONLY:
    spec = ACTION_CLIPS[name]
    frames, loop = spec['frames'], spec['loop']
    info = {'frames': frames, 'loop': loop, 'samples': []}
    sample_frames = sorted(set(list(range(1, frames + 2, 4)) + ([spec['contact'] + 1] if 'contact' in spec else [])))
    worst = {'lowest': 1e9, 'highestLow': -1e9, 'socketToHand': 0, 'ownHandClearance': 1e9}
    for frame in sample_frames:
        pts, socks, _ = evaluated(name, frame)
        sock = socks['R']
        low_g, low_p, _ = min(pts, key=lambda x: x[1].z); low = low_p.z
        hand = [p for g, p, _ in pts if g == 'Hand_R']
        centroid = sum(hand, Vector()) / len(hand)
        torso = [(p, n) for g, p, n in pts if g in TORSO]
        own_r, own_l = clearance(hand, torso), clearance([p for g, p, _ in pts if g == 'Hand_L'], torso)
        own = min(own_r, own_l)
        s = {'frame': frame - 1, 'lowest': round(low, 4), 'lowestPart': low_g, 'socketR': [round(x, 3) for x in sock],
             'socketToHandCentroid': round((sock - centroid).length, 4), 'ownHandClearance': round(own, 4), 'ownR': round(own_r, 4), 'ownL': round(own_l, 4)}
        sp = solved[name][frame]
        m = fk(sp)
        s['fkSocketError'] = round((bone_point(m, 'Hand_R', SOCKET_R) - sock).length, 5)
        if name == 'drink':
            s['socketToMouth'] = round((sock - bone_point(m, 'Head', MOUTH_LOCAL)).length, 4)
        if name == 'clap':
            s['handGap'] = round(clearance(hand, [(p, n) for g, p, n in pts if g == 'Hand_L'], far=.05), 4)
            s['socketGap'] = round((socks['R'] - socks['L']).length, 4)
        if 'partner' in spec:
            ppts, psocks, _ = evaluated(spec['partner'], frame)
            s['palmDistance'] = round((sock - mirror(psocks['R'])).length, 4)
            partner_torso = [(mirror(p), R180 @ n) for g, p, n in ppts if g in TORSO]
            arm = [p for g, p, _ in pts if g in ('Hand_R', 'Forearm_R', 'Hand_L', 'Forearm_L')]
            s['handToPartnerTorso'] = round(clearance(arm, partner_torso), 4)
            partner_hand = [(mirror(p), R180 @ n) for g, p, n in ppts if g == 'Hand_R']
            s['handToPartnerHand'] = round(clearance(hand, partner_hand, far=.05), 4)
        info['samples'].append(s)
        worst['lowest'] = min(worst['lowest'], low); worst['highestLow'] = max(worst['highestLow'], low)
        worst['socketToHand'] = max(worst['socketToHand'], s['socketToHandCentroid'])
        worst['ownHandClearance'] = min(worst['ownHandClearance'], own)
    if 'partner' in spec:
        c = next(x for x in info['samples'] if x['frame'] == spec['contact'])
        worst['palmDistanceAtContact'] = c['palmDistance']
        worst['handToPartnerTorso'] = min(x['handToPartnerTorso'] for x in info['samples'])
        worst['handToPartnerHand'] = min(x['handToPartnerHand'] for x in info['samples'])
    if 'stride' in spec:
        ys = [evaluated(name, f)[2]['L'].y for f in range(1, frames + 2)]
        worst['footSweep'] = max(ys) - min(ys)
        worst['footSweepPerCycleX2'] = 2 * (max(ys) - min(ys))
    if name == 'clap':
        worst['handGapMin'] = min(x['handGap'] for x in info['samples'])
    info['worst'] = {k: round(v, 4) for k, v in worst.items()}
    report[name] = info

rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = Quaternion(); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
scene.frame_set(1); bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)
result = {'saved': bpy.data.filepath, 'actions': sorted(a.name for a in bpy.data.actions), 'report': report}
