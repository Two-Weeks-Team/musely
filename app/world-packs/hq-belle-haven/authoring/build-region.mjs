import polygonClipping from "polygon-clipping";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import crypto from "node:crypto";
import earcut from "earcut";
import { toLocal } from "../coordinates.mjs";
const root = new URL("../", import.meta.url);
const data = JSON.parse(
  gunzipSync(fs.readFileSync(new URL("detail.geojson.gz", root))),
);
const materialNames = [
  "warm-stone-walls",
  "asphalt-roads",
  "park-grass",
  "terracotta-roofs",
  "sage-roofs",
  "sand-roofs",
  "bay-water",
  "warm-ground",
  "window-glass",
  "tree-foliage",
  "tree-bark",
  "path-gravel",
];
const colors = [
  [0.72, 0.58, 0.4, 1],
  [0.11, 0.16, 0.18, 1],
  [0.24, 0.43, 0.18, 1],
  [0.48, 0.14, 0.065, 1],
  [0.18, 0.3, 0.24, 1],
  [0.76, 0.62, 0.36, 1],
  [0.055, 0.34, 0.45, 1],
  [0.47, 0.46, 0.31, 1],
  [0.035, 0.12, 0.17, 1],
  [0.08, 0.28, 0.12, 1],
  [0.24, 0.12, 0.055, 1],
  [0.69, 0.56, 0.34, 1],
];
const bounds = [
  -122.16791969950646, 37.46913116566372, -122.13191969950646,
  37.49713116566372,
];
// Clip water rings against the convex data bounding box before local projection.
function clipRing(ring) {
  let ps = ring.slice(0, -1);
  for (const [axis, value, sign] of [
    [0, bounds[0], 1],
    [0, bounds[2], -1],
    [1, bounds[1], 1],
    [1, bounds[3], -1],
  ]) {
    const out = [];
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i],
        b = ps[(i + 1) % ps.length],
        ia = (a[axis] - value) * sign >= 0,
        ib = (b[axis] - value) * sign >= 0;
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (value - a[axis]) / (b[axis] - a[axis]);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    ps = out;
    if (!ps.length) return [];
  }
  return [...ps, ps[0]];
}

// Dissolve same-height/class tile buffer overlaps before triangulation: otherwise
// coplanar faces cause black stripes/z-fighting at tile boundaries and road crossings.
export function dissolve(features) {
  const grouped = new Map(),
    other = [];
  for (const f of features) {
    const p = f.properties;
    if (f.geometry.type !== "Polygon" || p.hide_3d) {
      other.push(f);
      continue;
    }
    let key;
    if (p.sourceLayer === "building")
      key = `building:${p.render_height}:${p.render_min_height}`;
    else if (p.sourceLayer === "water") key = "water";
    else if (
      ["landcover", "landuse"].includes(p.sourceLayer) &&
      ["wood", "grass", "park", "scrub", "forest"].includes(p.class)
    )
      key = "green";
    else {
      other.push(f);
      continue;
    }
    if (!grouped.has(key)) grouped.set(key, { properties: p, polys: [] });
    const rings =
      p.sourceLayer === "water"
        ? f.geometry.coordinates.map(clipRing).filter((r) => r.length >= 4)
        : f.geometry.coordinates;
    if (rings.length) grouped.get(key).polys.push(rings);
  }
  for (const { properties, polys } of grouped.values()) {
    if (!polys.length) continue;
    for (const coordinates of polygonClipping.union(...polys))
      other.push({ properties, geometry: { type: "Polygon", coordinates } });
  }
  return other;
}

export function region(source, lod = 0) {
  const groups = colors.map(() => ({ p: [], idx: [], vertices: new Map() }));
  const seen = new Set();
  let buildings = 0,
    hidden = 0,
    windows = 0,
    trees = 0;
  const roadPolygons = new Map();
  function triangle(g, a, b, c) {
    const u = b.map((v, k) => v - a[k]),
      v = c.map((v, k) => v - a[k]);
    const ny = u[2] * v[0] - u[0] * v[2];
    if (a[1] === b[1] && b[1] === c[1] && ny < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      const key = p.join(",");
      let n = g.vertices.get(key);
      if (n === undefined) {
        n = g.p.length / 3;
        g.vertices.set(key, n);
        g.p.push(...p);
      }
      g.idx.push(n);
    }
  }
  function polygon(g, rings, height, walls, wallGroup = g) {
    const flat = [],
      holes = [],
      coords = [];
    for (const [ri, ring] of rings.entries()) {
      const points = ring.slice(0, -1).map((p) => toLocal(...p));
      if (points.length < 3) continue;
      if (ri) holes.push(coords.length);
      for (const p of points) {
        flat.push(p.x, p.z);
        coords.push([p.x, height, p.z]);
      }
      if (walls)
        for (let i = 0; i < points.length; i++) {
          const a = points[i],
            b = points[(i + 1) % points.length];
          triangle(wallGroup, [a.x, 0, a.z], [b.x, 0, b.z], [a.x, height, a.z]);
          triangle(
            wallGroup,
            [a.x, height, a.z],
            [b.x, 0, b.z],
            [b.x, height, b.z],
          );
        }
    }
    const tris = earcut(flat, holes, 2);
    for (let i = 0; i < tris.length; i += 3)
      triangle(g, coords[tris[i]], coords[tris[i + 1]], coords[tris[i + 2]]);
  }
  if (source.metadata.bounds) {
    const [w, s, e, n] = bounds;
    polygon(
      groups[7],
      [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
      -0.03,
      false,
    );
  }
  for (const f of dissolve(source.features)) {
    const p = f.properties,
      geo = f.geometry,
      key = p.sourceLayer + JSON.stringify(geo);
    if (seen.has(key)) continue;
    seen.add(key);
    if (p.sourceLayer === "building" && geo.type === "Polygon") {
      if (p.hide_3d) {
        hidden++;
        continue;
      }
      const h = Number(p.render_height);
      if (!Number.isFinite(h) || h <= 0 || h > 300) continue;
      const pts = geo.coordinates[0].slice(0, -1).map((c) => toLocal(...c));
      const center = pts.reduce(
        (a, p) => ({ x: a.x + p.x / pts.length, z: a.z + p.z / pts.length }),
        { x: 0, z: 0 },
      );
      const palette =
        3 + (Math.abs(Math.floor(center.x * 0.13 + center.z * 0.17)) % 3);
      polygon(groups[palette], geo.coordinates, h, lod === 0, groups[0]);
      buildings++;
      // Decorative windows only near HQ. They are fictional facade details, not survey data.
      if (lod === 0 && Math.hypot(center.x, center.z) < 350 && h >= 4) {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i],
            b = pts[(i + 1) % pts.length],
            dx = b.x - a.x,
            dz = b.z - a.z,
            len = Math.hypot(dx, dz);
          if (len < 5) continue;
          const steps = Math.min(12, Math.floor(len / 5));
          for (let j = 0; j < steps; j++) {
            const t = (j + 0.5) / steps,
              cx = a.x + dx * t,
              cz = a.z + dz * t,
              ux = (dx / len) * 0.8,
              uz = (dz / len) * 0.8,
              nx = (-dz / len) * 0.025,
              nz = (dx / len) * 0.025;
            const low = 1.8,
              high = Math.min(h - 0.6, 3.4);
            for (const sign of [-1, 1]) {
              const q = [
                [cx - ux + nx * sign, low, cz - uz + nz * sign],
                [cx + ux + nx * sign, low, cz + uz + nz * sign],
                [cx - ux + nx * sign, high, cz - uz + nz * sign],
                [cx + ux + nx * sign, high, cz + uz + nz * sign],
              ];
              triangle(groups[8], q[0], q[1], q[2]);
              triangle(groups[8], q[2], q[1], q[3]);
            }
            windows++;
          }
        }
      }
    } else if (p.sourceLayer === "water" && geo.type === "Polygon") {
      const rings = geo.coordinates.map(clipRing).filter((r) => r.length >= 4);
      if (rings.length) polygon(groups[6], rings, 0, false);
    } else if (
      ["landuse", "landcover"].includes(p.sourceLayer) &&
      ["wood", "grass", "park", "scrub", "forest"].includes(p.class) &&
      geo.type === "Polygon"
    ) {
      polygon(groups[2], geo.coordinates, 0.01, false);
      // Stylized tree markers inside small nearby mapped green polygons; not real tree positions.
      if (lod === 0) {
        const ring = geo.coordinates[0].slice(0, -1).map((c) => toLocal(...c)),
          cx = ring.reduce((n, p) => n + p.x / ring.length, 0),
          cz = ring.reduce((n, p) => n + p.z / ring.length, 0);
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i],
            b = ring[j];
          if (
            a.z > cz !== b.z > cz &&
            cx < ((b.x - a.x) * (cz - a.z)) / (b.z - a.z) + a.x
          )
            inside = !inside;
        }
        if (inside && Math.hypot(cx, cz) < 700 && trees < 80) {
          for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3,
              b = ((i + 1) * Math.PI) / 3;
            triangle(
              groups[9],
              [cx + Math.cos(a) * 3, 2, cz + Math.sin(a) * 3],
              [cx + Math.cos(b) * 3, 2, cz + Math.sin(b) * 3],
              [cx, 8, cz],
            );
            triangle(
              groups[10],
              [cx + Math.cos(a) * 0.35, 0, cz + Math.sin(a) * 0.35],
              [cx + Math.cos(b) * 0.35, 0, cz + Math.sin(b) * 0.35],
              [cx, 3, cz],
            );
          }
          trees++;
        }
      }
    } else if (p.sourceLayer === "transportation") {
      const lines =
        geo.type === "LineString"
          ? [geo.coordinates]
          : geo.type === "MultiLineString"
            ? geo.coordinates
            : [];
      for (const line of lines)
        for (let i = 1; i < line.length; i++) {
          const a = toLocal(...line[i - 1]),
            b = toLocal(...line[i]),
            dx = b.x - a.x,
            dz = b.z - a.z,
            len = Math.hypot(dx, dz);
          if (len < 0.01) continue;
          const w =
            {
              motorway: 16,
              trunk: 13,
              primary: 11,
              secondary: 9,
              tertiary: 8,
              minor: 6,
              service: 4,
              path: 1.8,
            }[p.class] ?? 4;
          const nx = ((-dz / len) * w) / 2,
            nz = ((dx / len) * w) / 2;
          const c = [
            [a.x + nx, 0.03, a.z + nz],
            [a.x - nx, 0.03, a.z - nz],
            [b.x + nx, 0.03, b.z + nz],
            [b.x - nx, 0.03, b.z - nz],
          ];
          const groupId = p.class === "path" ? 11 : 1;
          if (!roadPolygons.has(groupId)) roadPolygons.set(groupId, []);
          roadPolygons
            .get(groupId)
            .push([[c[0], c[2], c[3], c[1], c[0]].map((v) => [v[0], v[2]])]);
        }
    }
  }
  for (const [gi, polys] of roadPolygons) {
    for (const rings of polygonClipping.union(...polys)) {
      const flat = [],
        holes = [],
        coords = [];
      for (const [ri, ring] of rings.entries()) {
        if (ri) holes.push(coords.length);
        for (const [x, z] of ring.slice(0, -1)) {
          flat.push(x, z);
          coords.push([x, gi === 11 ? 0.055 : 0.04, z]);
        }
      }
      const t = earcut(flat, holes, 2);
      for (let i = 0; i < t.length; i += 3)
        triangle(groups[gi], coords[t[i]], coords[t[i + 1]], coords[t[i + 2]]);
    }
  }
  const buffers = [],
    views = [],
    accessors = [],
    primitives = [];
  let offset = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    if (!g.idx.length) continue;
    const positions = new Float32Array(g.p),
      indices = new Uint32Array(g.idx);
    const ps = Buffer.from(positions.buffer),
      is = Buffer.from(indices.buffer);
    const vi = views.length,
      ai = accessors.length;
    views.push(
      { buffer: 0, byteOffset: offset, byteLength: ps.length, target: 34962 },
      {
        buffer: 0,
        byteOffset: offset + ps.length,
        byteLength: is.length,
        target: 34963,
      },
    );
    offset += ps.length + is.length;
    buffers.push(ps, is);
    const mins = [Infinity, Infinity, Infinity],
      maxs = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      mins[i % 3] = Math.min(mins[i % 3], positions[i]);
      maxs[i % 3] = Math.max(maxs[i % 3], positions[i]);
    }
    accessors.push(
      {
        bufferView: vi,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min: mins,
        max: maxs,
      },
      {
        bufferView: vi + 1,
        componentType: 5125,
        count: indices.length,
        type: "SCALAR",
      },
    );
    primitives.push({
      attributes: { POSITION: ai },
      indices: ai + 1,
      material: gi,
    });
  }
  const usedMaterials = [...new Set(primitives.map((p) => p.material))];
  for (const p of primitives) p.material = usedMaterials.indexOf(p.material);
  const binary = Buffer.concat(buffers),
    gltf = {
      asset: {
        version: "2.0",
        generator: "Musely World-01 deterministic region authoring",
      },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives }],
      materials: usedMaterials.map((i) => ({
        name: materialNames[i],
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: colors[i],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      })),
      buffers: [{ byteLength: binary.length }],
      bufferViews: views,
      accessors,
      extras: {
        lod,
        buildings,
        hiddenBuildings: hidden,
        coordinateSystem:
          "ENU-derived: east +X, up +Y, south +Z; geographic rotation 0",
        proceduralDetails:
          "Colors, windows, green-area tree markers and road widths are stylized, not surveyed",
        heightSource:
          "OpenMapTiles render_height: rendering estimate; not survey",
        access:
          "No public access, routing, elevation or location-authentication claim",
        attribution: source.metadata.attribution,
      },
    };
  return {
    gltf,
    binary,
    metrics: {
      lod,
      buildings,
      hiddenBuildings: hidden,
      windows,
      trees,
      triangles: groups.reduce((n, g) => n + g.idx.length / 3, 0),
      vertices: groups.reduce((n, g) => n + g.p.length / 3, 0),
      drawCalls: primitives.length,
    },
  };
}
export function glb(gltf, binary) {
  const json = Buffer.from(JSON.stringify(gltf)),
    jp = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]),
    bp = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
  const header = Buffer.alloc(12),
    jh = Buffer.alloc(8),
    bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jp.length + bp.length, 8);
  jh.writeUInt32LE(jp.length);
  jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bp.length);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jp, bh, bp]);
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const reports = [];
  for (const lod of [0, 1]) {
    const out = region(data, lod),
      bytes = glb(out.gltf, out.binary),
      name = `region-lod${lod}.glb`;
    fs.writeFileSync(new URL(name, root), bytes);
    reports.push({
      ...out.metrics,
      file: name,
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
  }
  fs.writeFileSync(
    new URL("metrics.json", root),
    JSON.stringify(
      {
        status: "static-generation-only",
        runtimeLoaded: false,
        mobileMeasured: false,
        reports,
      },
      null,
      2,
    ),
  );
  console.log(reports);
}
