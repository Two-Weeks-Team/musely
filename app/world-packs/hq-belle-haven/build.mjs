import fs from "node:fs";
import { toLocal } from "./coordinates.mjs";
// Generate a dependency-free, inspectable glTF road ribbon mesh. No network or runtime imports.
export function buildRoads(source) {
  const positions = [],
    indices = [];
  for (const f of source.features) {
    if (f.properties.kind !== "transportation") continue;
    const lines =
      f.geometry.type === "LineString"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiLineString"
          ? f.geometry.coordinates
          : [];
    for (const line of lines)
      for (let i = 1; i < line.length; i++) {
        const a = toLocal(...line[i - 1]),
          b = toLocal(...line[i]);
        const dx = b.x - a.x,
          dz = b.z - a.z,
          len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = (-dz / len) * 1.5,
          nz = (dx / len) * 1.5,
          n = positions.length / 3;
        positions.push(
          a.x + nx,
          0.02,
          a.z + nz,
          a.x - nx,
          0.02,
          a.z - nz,
          b.x + nx,
          0.02,
          b.z + nz,
          b.x - nx,
          0.02,
          b.z - nz,
        );
        indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      }
  }
  if (!indices.length) throw new Error("No road segments");
  const p = Buffer.from(new Float32Array(positions).buffer),
    i = Buffer.from(new Uint32Array(indices).buffer),
    buffer = Buffer.concat([p, i]);
  const min = [0, 1, 2].map((k) =>
      Math.min(...positions.filter((_, j) => j % 3 === k)),
    ),
    max = [0, 1, 2].map((k) =>
      Math.max(...positions.filter((_, j) => j % 3 === k)),
    );
  return {
    asset: {
      version: "2.0",
      generator: "Musely World-01 coarse road authoring preview",
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
    ],
    materials: [
      {
        name: "preview-road-not-navigation",
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [0.35, 0.38, 0.4, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    buffers: [
      {
        byteLength: buffer.length,
        uri:
          "data:application/octet-stream;base64," + buffer.toString("base64"),
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: p.length, target: 34962 },
      { buffer: 0, byteOffset: p.length, byteLength: i.length, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min,
        max,
      },
      {
        bufferView: 1,
        componentType: 5125,
        count: indices.length,
        type: "SCALAR",
      },
    ],
    extras: {
      status: "coarse-authoring-preview",
      roadWidthM: 3,
      roadWidthSource: "stylistic estimate; not surveyed",
      notNavigable: true,
      attribution: source.metadata.attribution,
    },
  };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const source = JSON.parse(
    fs.readFileSync(new URL("./overview.geojson", import.meta.url)),
  );
  fs.writeFileSync(
    new URL("./roads-preview.gltf", import.meta.url),
    JSON.stringify(buildRoads(source)),
  );
}
