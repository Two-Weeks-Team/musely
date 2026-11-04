# Native rooftop detail candidate: default OFF

This revision adds actual raised parapet and inset roof-panel geometry, not another
building color. It is an isolated opt-in experiment, not an accepted product feature.
No production bootstrap imports it. Do not merge or deploy without user approval.

## Real-screen failure and correction

The Mac product check of PR135 `6c11419` on main `18df53b` returned **zero details**.
That result is a failed activation, not successful visual acceptance. Two defects
were hidden by the original source-PBF test:

1. MapLibre 6.16 subdivides z14 parent tiles into higher **canonical child tiles**.
   `querySourceFeatures` exposes the child's z/x/y and clipped geometry. The old
   z14-only gate rejected every z20 child in the product. Source maxzoom14 is still
   correct; it is not the maximum canonical zoom of runtime query results.
2. Subdivision can produce a finite closed three-point degenerate ring. The old
   validation aborted all source geometry when just one such ring appeared.

The correction uses actual child tile bounds, retaining the 2 m edge exclusion.
It never relabels a child as its parent or decorates a clipped building. Finite
unsupported rings are rejected locally and retained as conservative collision
obstacles. Geometry with unknown coordinates and exhausted budgets still fails
the whole query closed. No native layer or map option is changed in the product.

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

- Actual canonical tile z14–24; entire component at least 2 m inside that tile.
  z15+ can be runtime subdivisions of the pinned z14 source, not new upstream data.
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

- Exact current immutable template: OpenFreeMap 20261101_080013_pt, source maxzoom14.
  This is checked separately from the query feature's canonical tile zoom.
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

The two original PBFs were fetched again on 2026-11-03 at 15:10 UTC; both byte
lengths and SHA-256 hashes match their stored receipts. The current public
TileJSON was also captured with its hash and confirms source maxzoom14/template.
No network access is required by CI.

The earlier direct z14 PBF test remains as a parent-tile test, admitting 18 roof
components / 36 decorations. It does **not** model the product's tile subdivision.
New tests run the installed MapLibre 6.16 **VectorTileWorkerSource._getOverzoomTile**
(including clipping and PBF reserialization), parse the child PBF, then invoke
**Tile.querySourceFeatures** with canonical child z17, z18, z19 and z20 and a
separate overscaledZ22. Fixed sampled child coordinates admit nonempty details at
each zoom. A real degenerate point at z18/42128/101590 no longer erases the valid
roof at z18/42125/101592. Real child-boundary-clipped geometry remains rejected.
The same results drive controller enable/source-change/cleanup regressions.
These are actual source-byte and CPU pipeline tests, **not** browser/GPU evidence.

Synthetic fixtures separately cover collision, duplicate/ambiguous IDs, courtyard,
concavity, tile/circle boundary, short/unclosed/oversized obstacle rings, malformed
holes, source drift, errors, movement, terrain, zoom,
projection, partial failure, ownership and cleanup. Real installed
FillExtrusionStyleLayer is used in controller tests. This still is not a GPU Map.

This correction follows main151 `d4521aa70467fb2e18705dcd26816ba482ec3892`.
The new roof-main-contract tests read the actual checked-out app, verifying map
style, geography, places, MapLibre version, coordinate conversion and camera.
The map-only diagnostic now also uses the product's maxZoom23.8, which affects
canonical tile subdivision, rather than MapLibre's default. Existing historical
fixture suites remain explicitly pinned to their older commits. These checks are
not a full app execution. No application or server source file is modified.

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
Nearest admitted roof, Verified z20 roof, OFF, Campfire entry and Zoom 16 fallback
for same-camera A/B. The fixed verified roof is at
`[-122.14889690747935, 37.48346800272857]`, zoom21/pitch60, native height5 m.
It is complete in z20/168503/406368 and therefore suitable for the product's
canonical z20 query. The main campfire camera can legitimately contain zero
eligible roofs because of the 40 m commons reserve and loaded-viewport domain.
`window.nativeRoofProof.getState()` includes rejected reasons, admitted centers,
canonical source zooms, source maxzoom/template and rendered-feature count.
Screenshots must identify their camera
and whether they are from this diagnostic or the full product.

For **full product** validation, build `roof-runtime.mjs` using the same script,
make it available through the existing authorized local dev server, import it,
and call `createNativeRoofDetails(existingMap, {enabled:true,radius:500})` after
native layers exist. No extra map, GLB or native-layer hiding. Keep the returned
controller for disable/dispose. First navigate the existing map to the fixed
verified roof above; do not assume the initial campfire viewport contains one.
Wait for source loading and stable frames, inspect `controller.status()` and the
rendered owned layer, then return
to the campfire view and test 21.2 → 18 → 16 → 18 plus movement, tile failure and
style reload. Record current PR/main commits and verify residents remain present.
No production code should import this module before visual acceptance.

## Official references

- [MapLibre querySourceFeatures: loaded tiles, duplicates and split geometry](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#querysourcefeatures)
- [MapLibre 6.16 Tile query implementation](https://github.com/maplibre/maplibre-gl-js/blob/v6.16.0/src/tile/tile.ts)
- [MapLibre v6 default subdivision migration](https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/#zoomlevelstooverscale)
- [MapOptions zoomLevelsToOverscale](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/#zoomlevelstooverscale)
- [MapLibre 6.16 overzoom worker](https://github.com/maplibre/maplibre-gl-js/blob/v6.16.0/src/source/vector_tile_worker_source.ts)
- [Fill-extrusion base/height and geometry properties](https://maplibre.org/maplibre-style-spec/layers/#fill-extrusion)
- [Official GeoJSON 3D extrusion example](https://maplibre.org/maplibre-gl-js/docs/examples/extrude-polygons-for-3d-indoor-mapping/)
- [Map events](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/MapEventType/)
- [OpenStreetMap attribution and ODbL](https://www.openstreetmap.org/copyright)
