"""Replace zero-length exported tangents with a unit tangent orthogonal to the vertex normal.

Decimation can leave a few zero-UV-area triangles; Blender's exporter then writes (0,0,0,w) tangents,
which glTF requires to be unit length. Edits GLB binaries in place (same byte length). Plain Python.
"""
from pathlib import Path
import json, struct, math, sys


def fix(path):
    b = bytearray(path.read_bytes())
    jlen = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jlen])
    bin0 = 20 + jlen + 8
    fixed = 0

    def view(acc_index):
        a = j['accessors'][acc_index]
        v = j['bufferViews'][a['bufferView']]
        comps = {'VEC3': 3, 'VEC4': 4}[a['type']]
        stride = v.get('byteStride', comps * 4)
        return bin0 + v.get('byteOffset', 0) + a.get('byteOffset', 0), stride, a['count']

    for mesh in j['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            if 'TANGENT' not in at or 'NORMAL' not in at:
                continue
            to, ts, n = view(at['TANGENT'])
            no, ns, _ = view(at['NORMAL'])
            for i in range(n):
                x, y, z, w = struct.unpack_from('<4f', b, to + i * ts)
                if x * x + y * y + z * z > 1e-12:
                    continue
                nx, ny, nz = struct.unpack_from('<3f', b, no + i * ns)
                # Any axis not parallel to the normal, projected onto the tangent plane.
                ax = (1.0, 0.0, 0.0) if abs(nx) < .9 else (0.0, 1.0, 0.0)
                d = ax[0] * nx + ax[1] * ny + ax[2] * nz
                tx, ty, tz = ax[0] - d * nx, ax[1] - d * ny, ax[2] - d * nz
                L = math.sqrt(tx * tx + ty * ty + tz * tz) or 1.0
                struct.pack_into('<4f', b, to + i * ts, tx / L, ty / L, tz / L, w if w in (1.0, -1.0) else 1.0)
                fixed += 1
    if fixed:
        path.write_bytes(bytes(b))
    return fixed


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent / 'runtime'
    files = sys.argv[1:] or [str(p) for p in sorted(root.rglob('*.glb'))]
    print(json.dumps({Path(f).relative_to(root).as_posix(): fix(Path(f)) for f in files}))
