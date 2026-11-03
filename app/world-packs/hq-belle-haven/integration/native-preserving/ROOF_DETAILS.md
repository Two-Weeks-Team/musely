# Native rooftop detail candidate: default OFF

This revision adds actual raised parapet and inset roof-panel geometry, not another
building color. It is an isolated opt-in experiment, not an accepted product feature.
No production bootstrap imports it. Do not merge or deploy without user approval.

## Geometry and evidence

The controller reads **the current map's `querySourceFeatures('openmaptiles',
{sourceLayer:'building'})` result**. It never mounts the region GLB, replaces a
building, hides native geometry, edits native paint, or places ground-level props.
The existing native building stays intact. Decorative shapes are fictional, not
claims about the real building or surveyed roof equipment.

Only convex, complete, single-ring components inside the campfire-centered circle
are admitted. Default radius 500 m remains a design estimate. Source MultiPolygons
can group hundreds of separate buildings of equal height; their feature ID is not
a physical-building ID. Component identity is tile + source feature + component.
The real tiles exposed this grouping and the implementation handles it explicitly.

Admission requires all of these:

- Actual canonical source tile z14; entire component at least 2 m inside that tile.
- Entire component at least 2 m inside the circle; 40 m exclusion around campfire.
- Native roof height 3–60 m, known numeric base, no hide_3d, area 35–1800 m².
- Convex inset succeeds; no courtyard, tiny/narrow roof or arbitrary simplification.
- No overlapping/adjacent native polygon within 0.15 m, including hidden polygons.
- No ambiguous same-tile feature ID or duplicate geometry.

The parapet is inset 0.4–0.8 m from the native footprint. Its bottom is 0.16 m above
the native roof and its top 0.7 m above it. The separate inset panel starts 1.05 m
inside, with top 0.3 m above the native roof. These shapes do not share surfaces
with the native roof/walls or each other. Coordinates use MapLibre Mercator, not
the prior static pack's approximate local conversion or double commons rotation.

All added vertices are above an existing roof. No walking surface, Place ID,
interaction route, source building height, or resident policy is changed. This
geometric separation is not a substitute for actual product coexistence inspection.

## Runtime fail-closed policy

- Exact current immutable template: OpenFreeMap 20261101_080013_pt, maxzoom14.
- Exact native fill-extrusion layer/source/filter/height/base contract; no translated
  or rounded native extrusion, opacity changes, hidden native layer or globe mode.
- Terrain must be OFF. Heights are source render_height, potentially estimated.
- Zoom must be at least 17. Movement hides detail and rebuilds on a stable frame, including
  transitions to cached tiles that produce no source-loading event.
- Native tile changes, terrain/projection events and contract drift hide immediately.
- Tile errors and style reload require explicit re-enable. No automatic fallback
  to guessed geometry or old source data.
- A fresh owned GeoJSON source is created on rebuild, never an async stale setData.
  A stable render/idle event reveals it; later events confirm visible source loading.
  Render events are required because the real Musely custom layer calls
  triggerRepaint continuously, so idle may never fire. Stable frames do not rebuild.
  `active`
  describes controller/source state, not proof of visible pixels or GPU quality.
- Disable/dispose removes only owned layer/source and preserves concurrent edits.
- At most 180 components / 360 features. Inputs above 20,000 components or 200,000
  vertices reject entirely. CPU/GPU cost on actual mobile hardware is unmeasured.

## Verification and limits

Two original PBFs were downloaded on 2026-11-03 from the immutable source and stored
with SHA-256 receipts under roof-fixtures. Their checksums also match the original
pack receipts. Tests call the **installed MapLibre 6.16 Tile.querySourceFeatures**
implementation on those bytes, including the real runtime `tile` field. They do
not fabricate tile shapes or treat old split GeoJSON as native query results.
These PBF fixtures admit 18 roof components / 36 decoration features. This is an
offline source/geometry result, not a live screen count.

Synthetic fixtures separately cover collision, duplicate/ambiguous IDs, courtyard,
concavity, tile/circle boundary, source drift, errors, movement, terrain, zoom,
projection, partial failure, ownership and cleanup. Real installed
FillExtrusionStyleLayer is used in controller tests. This still is not a GPU Map.

The current main snapshot checked at authoring was d2892ebebde56d495341493b2317a40c7a5d0658.
Map style/geography/places blobs match the existing fixtures; current main.ts was
inspected separately. Older integration suites remain pinned to their stated
commits. They are not a full current-main product test. No server file changed.

Cloud Chromium launch failed with socket `Operation not permitted`. Do not bypass
that restriction. **Actual product GPU coexistence, depth/flicker, mobile cost and
zoom-transition aesthetics remain pending. Keep default OFF and PR Draft.**

## Run and inspect

From integration/:

```sh
npm ci --ignore-scripts
npm test
npm run browser:build
```

Serve the generated native-preserving/roof-dist directory locally in an authorized
browser. This uses live public tiles and is a map-only diagnostic. Use ON, Region,
Nearest admitted roof, OFF, Campfire entry and Zoom 16 fallback for same-camera A/B.
`window.nativeRoofProof.getState()` includes rejected reasons, admitted centers,
source state and rendered-feature count. Screenshots must identify their camera
and whether they are from this diagnostic or the full product.

For **full product** validation, build `roof-runtime.mjs` using the same script,
make it available through the existing authorized local dev server, import it,
and call `createNativeRoofDetails(existingMap, {enabled:true,radius:500})` after
native layers exist. No extra map, GLB or native-layer hiding. Keep the returned
controller for disable/dispose. Inspect the first admitted center from
`controller.status().report.accepted[0].centerLngLat` at zoom21/pitch60, then return
to the campfire view and test 21.2 → 18 → 16 → 18 plus movement, tile failure and
style reload. Record current PR/main commits and verify residents remain present.
No production code should import this module before visual acceptance.

## Official references

- [MapLibre querySourceFeatures: loaded tiles, duplicates and split geometry](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#querysourcefeatures)
- [MapLibre 6.16 Tile query implementation](https://github.com/maplibre/maplibre-gl-js/blob/v6.16.0/src/tile/tile.ts)
- [Fill-extrusion base/height and geometry properties](https://maplibre.org/maplibre-style-spec/layers/#fill-extrusion)
- [Official GeoJSON 3D extrusion example](https://maplibre.org/maplibre-gl-js/docs/examples/extrude-polygons-for-3d-indoor-mapping/)
- [Map events](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/MapEventType/)
- [OpenStreetMap attribution and ODbL](https://www.openstreetmap.org/copyright)
