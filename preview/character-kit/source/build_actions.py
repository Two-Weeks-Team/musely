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
from variant_spec import ACTION_CLIPS

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
PARTNER_DISTANCE = .9

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


HIGH_FIVE_CONTACT = ACTION_CLIPS['high_five'][2] if len(ACTION_CLIPS['high_five']) > 2 else 24


def high_five(t):
    """Single play: lean in and wind up, strike the right palm forward to a partner 0.9 m in front, hold the touch,
    pull the hand back and out (so the two hands separate instead of sliding through each other), settle."""
    frames = ACTION_CLIPS['high_five'][0]
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
        target = start.lerp(contact, strike_in) if t <= tc else (contact + Vector((-.16, .17, -.04)) * recoil).lerp(start, release)
        goals += [('pos', 30 * weight, lambda m: bone_point(m, 'Hand_R', SOCKET_R), target),
                  ('dir', 2 * weight, lambda m: axis_y(m, 'Hand_R'), Vector((0, -1, .25)).normalized())]
        free += [('Spine', 0), ('Spine', 2), ('Chest', 0), ('Chest', 2)] + ARM_R + [('Hand_R', 0), ('Hand_R', 1)]
    return pose, free, goals


AUTHORS = {'drink': drink, 'plant': plant, 'high_five': high_five}

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
    frames, loop = ACTION_CLIPS[name][:2]
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


def evaluated(frame):
    scene.frame_set(frame)
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for ob, groups in ((body, body_groups), (face, None)):
        ev = ob.evaluated_get(dg); me = ev.to_mesh(); mw = ev.matrix_world
        nm = mw.to_3x3()
        for i, v in enumerate(me.vertices):
            pts.append((groups[i] if groups else 'Head', mw @ v.co, (nm @ v.normal).normalized()))
        ev.to_mesh_clear()
    sock = scene.objects['Socket_Hand_R'].evaluated_get(dg).matrix_world.translation.copy()
    return pts, sock


def clearance(points, surface):
    """Min signed distance of points from a surface given as (pos, normal) list (nearest-vertex test)."""
    tree = kdtree.KDTree(len(surface))
    for i, (p, _) in enumerate(surface):
        tree.insert(p, i)
    tree.balance()
    worst = 1e9
    for p in points:
        _, i, _ = tree.find(p)
        q, n = surface[i]
        worst = min(worst, (p - q).dot(n))
    return worst


R180 = Matrix.Rotation(math.pi, 3, 'Z')
OFFSET = Vector((0, -PARTNER_DISTANCE, 0))
report = {}
for name in ONLY:
    frames, loop = ACTION_CLIPS[name][:2]
    action = bpy.data.actions[name]
    rig.animation_data.action = action; rig.animation_data.action_slot = action.slots[0]
    info = {'frames': frames, 'loop': loop, 'samples': []}
    sample_frames = sorted(set(list(range(1, frames + 2, 4)) + ([HIGH_FIVE_CONTACT + 1] if name == 'high_five' else [])))
    worst = {'lowest': 1e9, 'highestLow': -1e9, 'socketToHand': 0, 'ownHandClearance': 1e9}
    for frame in sample_frames:
        pts, sock = evaluated(frame)
        low_g, low_p, _ = min(pts, key=lambda x: x[1].z); low = low_p.z
        hand = [p for g, p, _ in pts if g == 'Hand_R']
        centroid = sum(hand, Vector()) / len(hand)
        torso = [(p, n) for g, p, n in pts if g in TORSO]
        own = clearance(hand, torso)
        s = {'frame': frame - 1, 'lowest': round(low, 4), 'lowestPart': low_g, 'socketR': [round(x, 3) for x in sock], 'socketToHandCentroid': round((sock - centroid).length, 4), 'ownHandClearance': round(own, 4)}
        sp = solved[name][frame]
        m = fk(sp)
        s['hips'] = [round(x, 3) for x in sp.hips]
        s['spineChest'] = [round(x, 2) for x in sp.angles.get('Spine', (0, 0, 0)) + sp.angles.get('Chest', (0, 0, 0))]
        s['fkSocketError'] = round((bone_point(m, 'Hand_R', SOCKET_R) - sock).length, 5)
        if name == 'drink':
            mouth = bone_point(m, 'Head', MOUTH_LOCAL)
            s['socketToMouth'] = round((sock - mouth).length, 4)
        if name == 'high_five':
            partner_sock = R180 @ sock + OFFSET
            s['palmDistance'] = round((sock - partner_sock).length, 4)
            partner_torso = [(R180 @ p + OFFSET, R180 @ n) for p, n in torso]
            arm = [p for g, p, _ in pts if g in ('Hand_R', 'Forearm_R', 'Hand_L', 'Forearm_L')]
            s['handToPartnerTorso'] = round(clearance(arm, partner_torso), 4)
            partner_hand = [(R180 @ p + OFFSET, R180 @ n) for g, p, n in pts if g == 'Hand_R']
            s['handToPartnerHand'] = round(clearance(hand, partner_hand), 4)
        info['samples'].append(s)
        worst['lowest'] = min(worst['lowest'], low); worst['highestLow'] = max(worst['highestLow'], low)
        worst['socketToHand'] = max(worst['socketToHand'], s['socketToHandCentroid'])
        worst['ownHandClearance'] = min(worst['ownHandClearance'], own)
    info['worst'] = {k: round(v, 4) for k, v in worst.items()}
    report[name] = info

rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = Quaternion(); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
scene.frame_set(1); bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)
result = {'saved': bpy.data.filepath, 'actions': sorted(a.name for a in bpy.data.actions), 'report': report}
