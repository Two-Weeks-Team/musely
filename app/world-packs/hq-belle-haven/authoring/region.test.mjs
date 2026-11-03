import { gunzipSync } from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import validator from "gltf-validator";
import { region, glb } from "./build-region.mjs";
import { toLocal } from "../coordinates.mjs";
const root = new URL("../", import.meta.url);
const source = JSON.parse(
  gunzipSync(fs.readFileSync(new URL("detail.geojson.gz", root))),
);
test("detailed capture has pinned version, attribution and bounded source receipts", () => {
  assert.equal(source.metadata.version, "20261101_080013_pt");
  assert.equal(source.metadata.license, "ODbL-1.0");
  assert.equal(source.metadata.receipts.length, 6);
  assert.ok(
    source.metadata.receipts.every((r) => /^[a-f0-9]{64}$/.test(r.sha256)),
  );
  assert.ok(
    source.metadata.receipts.reduce((n, r) => n + r.bytes, 0) < 1024 * 1024,
  );
});
test("source is geographic, keeps known height semantics and hides non-3D buildings", () => {
  const b = source.features.filter(
    (f) => f.properties.sourceLayer === "building",
  );
  assert.ok(b.length > 1000);
  assert.ok(b.some((f) => f.properties.hide_3d));
  assert.ok(b.every((f) => f.properties.render_min_height === 0));
  const hq = toLocal(-122.15008, 37.48336);
  assert.ok(hq.x < 0 && hq.z < 0);
  assert.ok(Math.hypot(hq.x, hq.z) < 35);
});
for (const lod of [0, 1])
  test(`LOD ${lod}: reproducible binary, budget and validator`, async () => {
    const output = region(source, lod),
      bytes = glb(output.gltf, output.binary),
      saved = fs.readFileSync(new URL(`region-lod${lod}.glb`, root));
    assert.deepEqual(bytes, saved);
    assert.ok(bytes.length < (lod ? 1_000_000 : 2_500_000));
    assert.ok(output.metrics.drawCalls <= (lod ? 8 : 12));
    assert.ok(output.metrics.triangles < (lod ? 35_000 : 100_000));
    const report = await validator.validateBytes(new Uint8Array(bytes));
    assert.equal(report.issues.numErrors, 0);
    assert.equal(report.issues.numWarnings, 0);
    const metrics = JSON.parse(fs.readFileSync(new URL("metrics.json", root)))
      .reports[lod];
    assert.equal(
      metrics.sha256,
      crypto.createHash("sha256").update(bytes).digest("hex"),
    );
  });
test("LOD1 removes wall triangles while preserving mapped buildings", () => {
  const high = region(source, 0),
    low = region(source, 1);
  assert.equal(high.metrics.buildings, low.metrics.buildings);
  assert.ok(low.metrics.triangles < high.metrics.triangles * 0.4);
});
test("polygon holes triangulate without filling their interior", () => {
  const ring = [
      [-122.15, 37.48],
      [-122.149, 37.48],
      [-122.149, 37.481],
      [-122.15, 37.481],
      [-122.15, 37.48],
    ],
    hole = [
      [-122.1498, 37.4802],
      [-122.1498, 37.4808],
      [-122.1492, 37.4808],
      [-122.1492, 37.4802],
      [-122.1498, 37.4802],
    ];
  const out = region(
    {
      metadata: { attribution: "test" },
      features: [
        {
          properties: { sourceLayer: "building", render_height: 5 },
          geometry: { type: "Polygon", coordinates: [ring, hole] },
        },
      ],
    },
    1,
  );
  assert.equal(out.metrics.triangles, 8);
});
test("pack remains opt-in with no runtime place or navigation changes", () => {
  const m = JSON.parse(fs.readFileSync(new URL("manifest.json", root)));
  assert.equal(m.runtimeEnabled, false);
  assert.equal(m.geographicMeshRotationDeg, 0);
  assert.deepEqual(m.runtimePlaces, []);
  assert.equal(m.buildings.surveyed, false);
});

test("duplicate tile footprints dissolve before triangulation", () => {
  const f = {
    properties: {
      sourceLayer: "building",
      render_height: 5,
      render_min_height: 0,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-122.15, 37.48],
          [-122.149, 37.48],
          [-122.149, 37.481],
          [-122.15, 37.481],
          [-122.15, 37.48],
        ],
      ],
    },
  };
  const once = region({ metadata: { attribution: "test" }, features: [f] }, 0);
  const twice = region(
    { metadata: { attribution: "test" }, features: [f, f] },
    0,
  );
  assert.deepEqual(glb(once.gltf, once.binary), glb(twice.gltf, twice.binary));
});
test("colored pack contains ground, mapped water and near-view details", () => {
  const out = region(source, 0);
  const names = out.gltf.materials.map((m) => m.name);
  for (const name of [
    "bay-water",
    "warm-ground",
    "warm-stone-walls",
    "window-glass",
    "tree-foliage",
    "terracotta-roofs",
  ])
    assert.ok(names.includes(name));
  assert.ok(out.metrics.windows > 0);
  assert.ok(out.metrics.trees > 0);
  assert.match(out.gltf.extras.proceduralDetails, /not surveyed/);
});
test("LOD1 removes procedural near details and unused materials", () => {
  const out = region(source, 1);
  assert.equal(out.metrics.windows, 0);
  assert.equal(out.metrics.trees, 0);
  const used = new Set(out.gltf.meshes[0].primitives.map((p) => p.material));
  assert.equal(used.size, out.gltf.materials.length);
});
