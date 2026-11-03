# Native-preserving regional mode (feature OFF)

This page describes the older color-only variant and its pinned e8060f13 fixtures.
The actual raised roof experiment and current-main tests are documented in
[ROOF_DETAILS.md](ROOF_DETAILS.md). Its Mac zero-detail failure and v6 subdivision
correction are separate from the color variant. Both remain OFF pending acceptance.
This module keeps MapLibre buildings, roads, water and ground and adds no regional GLB.
The color variant is a bounded alternative to duplicated buildings, not a finished world.

## Runtime integration seam

Import `createNativePreservingStyle` from `style-controller.mjs` after native building
layers exist. Construction defaults to OFF. Explicit `{enabled:true, radius:500}` opts
into color only. Call `disable()` or `dispose()` to restore owned colors; dispose also
removes the style listener. No application bootstrap imports or activates it automatically.
Do not mount `region-lod*.glb` at the same time as this mode. The exported render policy
requires native buildings/roads/water/ground and disables regional GLB/extra props.

The controller modifies only building.fill-color and building-3d.fill-extrusion-color.
It never changes source, filter, geometry, height, base, opacity or visibility. It snapshots
current colors, rolls back partial failure, and preserves concurrent color edits. Style
reload suspends it without writing an old snapshot into a new style. Explicit reenable
captures the new baseline. Returned conflicts require review; restoration on a failing or
unavailable real map is not guaranteed by mock tests.

## Circle contract

`region.mjs` derives center from actual commons:campfire scene (0,2) and the current 30°
scene/Mercator transform: [-122.14993103263174,37.4831155889765]. This is not the geography
anchor or an approximate POI coordinate. Radius500m is an adjustable design estimate,
not a confirmed user-selected distance; supported diagnostic range25–1000m.

Only evaluated polygons wholly inside the circle with a 2m reserve receive the warm tint.
Border/outside features retain original color. No building is geometrically clipped.
Distance-to-complement is used because within does not support evaluated Polygon features.
Vector features can be tile fragments: physical-building color continuity across seams is
not proven. This may produce color seams, but cannot delete geometry. A 50m smoothstep
function is provided only as a future decoration-density policy, not material opacity.

## Detail admission and safe fallback

The existing regional GLB's12 primitives are explicitly rejected in this mode: ten are
native-surface duplicates or building-dependent windows; the two tree groups lack individual
current-scene clearance. No extra props are admitted. Future props need verified bounds,
native-building, road/water, authored-commons, walking/interaction and source-version clearance.
Even complete synthetic clearance leaves their runtime visibility OFF pending GPU testing.

## Evidence

- Existing integration14 tests plus new native-preserving23 tests: **37/37 pass**.
- Complete cloned MapLibre style validates with zero errors after the candidate paints.
- Exact Git blobs cover latest main, geography, places, live-scene-core, map-style and package.
  Latest main worker/source-height startup differs; coordinate/layer contracts are unchanged.
- Original integration proof and native-only browser bundle both build successfully.
- `browser-build.mjs` creates a pinned MapLibre6.16 diagnostic with local workers/CSS and
  Original/Circle tint plus Entry/Near/Wide controls. It uses live public tile services.
  This bundle has not been run in a browser here and is not the full Musely application.
- Parent reported actual Mac product A/B at main e806 + older PR bd946: simultaneous native
  buildings and regional GLB showed stripes, removing native building visibility removed
  them. This supports duplicate-geometry interference; it does not validate this new color
  mode or authorize hiding native buildings in production. Raw A/B evidence is managed by
  the parent; no new screenshot or browser action was performed in this revision.

## Still unverified

Actual full-product opt-in/disable/style reload, shader appearance, zoom transitions,
mobile cost, tile-fragment color seams and the palette require same-camera Mac/mobile checks.
The module is implemented and unit-validated, but application wiring and visual acceptance
are not complete. Keep feature OFF and the PR Draft. No deployment or merge occurred.

Run from integration/: `npm test`; `npm run browser:build`.
Generated browser-dist, node_modules and local logs are not committed.

## Actual MapLibre layer-shape regression fixed

Mac full-product opt-in at the earlier 4c16 head failed with Native building contract changed.
The controller mistakenly inspected StyleSpecification['source-layer'], while actual
Map.getLayer returns StyleLayer.sourceLayer. The old JSON mock hid the mismatch. Both
enable validation and restore ownership now use the runtime sourceLayer field.

Four additional regressions instantiate the installed MapLibre6.16 FillStyleLayer and
FillExtrusionStyleLayer implementations, then use actual Map.prototype.getLayer and
getPaintProperty. They verify camelCase runtime identity, real paint enable/restore,
source-layer drift rejection and concurrent paint preservation. These do not instantiate
a GPU Map; scene loop and event delivery are still a harness. Runtime classes are bundled
locally using esbuild with type-only field semantics preserved. No new dependency added.

37/37 integration tests and both browser bundle builds pass after the fix. Actual Mac
ON/zoom/style reload must be retried on the corrected head; earlier ON failure is not a
successful visual test and no claim of visual completion is made here.
