## Native-preserving alternative

See native-preserving/README.md. Keep the regional GLB disabled in the live native-building
scene. The new optional color controller preserves native geometry and defaults OFF; it
has no application bootstrap import yet. npm test includes its regressions and
npm run browser:build builds its separate visual diagnostic.

# Isolated Musely integration proof

This directory does **not** enable anything in the production application. It supplies
an opt-in adapter candidate, the exact main-source fixtures it was tested against, and
executed tests using the application's **Three 0.186.1 and MapLibre GL 6.16.0**.

## What was actually executed

```
cd app/world-packs/hq-belle-haven/integration
npm ci --ignore-scripts
npm test
```

Node 24.22.1: 14 tests passed. Both real GLB files were decoded by `GLTFLoader` into
Three scenes, transformed vertex-by-vertex, checked for finite bounds and identity
root transform, then removed/disposed. This is real loader/scene execution in Node,
**not a WebGL canvas, browser frame, mobile FPS, or production application run**.

Tests import the unmodified pinned `places.ts` (Node native TypeScript stripping) and
its real geography/79 neighborhood POIs. They execute the coordinate declarations
extracted from the unmodified pinned `main.ts` and `live-scene-core.ts`; their full
imports and unrelated application side effects are not executed. Every fixture's
Git blob hash is checked against `provenance.json`.

## Important compatibility correction

The pack's authoring projection uses 111,320m/latitude degree and cosine longitude,
matching `places.ts`. The actual visual world uses **Mercator metres plus a 30-degree
commons grid**, defined in `main.ts` and `ui/live-scene-core.ts`. These are not identical.
A single inverse rotation of the uncorrected asset leaves up to **1.746m** positional
error across the 79 pinned neighborhood POIs (`osm:node/368169991` was the maximum).

`adapter.mjs` corrects every geographic vertex as follows:

1. Reverse the authoring-local projection to WGS84 using `toWgs84`.
2. Project WGS84 through the application's exact MapLibre `MercatorCoordinate`.
3. Divide by the commons-origin Mercator metre scale.
4. Apply the inverse grid rotation to enter the **existing commons scene frame**.
5. Keep the mounted group at identity position, scale and rotation. The application's
   existing custom-layer `localMatrix` then applies its own forward mapping once.

This is deliberately different from applying a global 30-degree rotation to the GLB.
The pack remains geographically unrotated on disk. If it is rendered directly in an
unrotated ENU viewer, no adapter rotation is appropriate.

Commons Place IDs are also special: they hold **authored scene coordinates**, whereas
neighborhood Place IDs represent geographic points. Never overwrite common IDs or
use their stored lat/lng as if it were the rendered authored location. The tests preserve
`commons:campfire` at scene `(0,2)` and validate all 79 neighborhood POIs separately.

## Candidate call site (not installed)

After the real app's commons world is ready, a future explicit feature-flag hook can
supply that `world.scene`, the application's **current** geography JSON, and fetched
same-origin GLB bytes:

```
const pack = await mountRegionPack({
  parent: world.scene,
  bytes,
  geography,
  enabled: flags.hqRegionalPack === true,
});
// On unloading or changing world:
pack.dispose();
```

`WORLD_PACK_ENABLED` defaults to false. Disabled calls parse no bytes and do not mutate
the scene. Enabled calls reject changed origin, invalid grid bearing, unknown asset
coordinate contracts, nonidentity source node transforms and duplicate mount attempts.
No movement, model decision, world state, owner location, remote request, or permission
is modified by the adapter. Attribution is retained on `root.userData.attribution`;
the application must expose it visibly before shipping.

## Remaining integration gates

- Main freshness: pinned source is `bd6d9d5bab9a6c3e5653ed1b195e76f16b67d21b`. Re-read
  current main and compare the six fixture files before integrating or refreshing them.
- No production call site or deployment was added. Tests demonstrate loader and spatial
  compatibility, not that Musely currently displays the pack.
- Test in the shared MapLibre WebGL2 canvas at near and far camera ranges, including
  depth order with the existing map extrusion, commons ground and existing props.
- Avoid duplicate buildings: hide/replace the corresponding map extrusion layer only
  under the same explicit flag and restore it when disabled; this adapter does neither.
- Choose a measured LOD/streaming policy. Parse-time CPU, memory, normals recomputation,
  GPU upload, far clip range, actual draw calls and Android/iOS performance are unmeasured.
- Full app test/typecheck/build, UI labels, screen reader output, mobile and live-server
  behavior remain outside this isolated Node proof. Do not describe these as passed.

## Repair log

Initial default import of MapLibre was incompatible with its ESM exports; changed to
namespace import. Fixture writing initially appended a newline; corrected exact bytes
and added Git blob SHA checks rather than weakening provenance verification.

## Browser/WebGL attempt and exact blocker

A second, real browser test was prepared: `npm run browser:build && npm run browser:test`.
It uses a local HTTP server, existing Chromium, an empty local MapLibre style, the
actual custom-layer matrix and `WebGLRenderer` sharing the MapLibre canvas. No tile
or API requests are required. Intended assertions cover flag OFF/ON/OFF, 79 POI
pixel alignment, errors, measured draw calls, and near/far screenshots.

The browser bundle **built successfully**, but Chromium did **not launch** in this
execution environment. Both ordinary execution and reviewed escalated execution
failed at `process_singleton_posix.cc:297: socket() failed: Operation not permitted`,
with SIGABRT. A writable temporary HOME fixed a preliminary Crashpad directory error
but did not resolve the socket restriction. Chromium sandbox was kept enabled.

Therefore no browser screenshots, WebGL pass, actual renderer draw-call measurement
or pixel-error result exists yet. `browser-status.json` records the failed stage.
The harness is provided for a permitted environment; its browser assertions remain
untested. Generated browser-dist is not committed. Do not weaken system/browser
security to force this test through.

Exact failed launch commands from the repository workspace:

```
node musely-support/world-130/app/world-packs/hq-belle-haven/integration/browser-test.mjs
HOME=/tmp/musely-browser-home node musely-support/world-130/app/world-packs/hq-belle-haven/integration/browser-test.mjs
```

The second command was executed through the reviewed `require_escalated` tool mode;
its result was the same socket/SIGABRT error, not a denied tool invocation. No further
launch workaround was attempted. Final Node retest output is `node-test-results.txt`.

## Review hardening

Mount ownership is guarded by a WeakSet before any await and released in finally;
concurrent requests cannot create two roots. A strict preflight validates GLB v2,
chunk lengths, the exact coordinate contract and one embedded buffer before parsing.
URI-bearing objects (including data URIs), images/textures and extensions are rejected
for this untextured offline pack. Loader dependency/geometry creation is tracked so
conversion errors and late resources after parse rejection are disposed, and successful
dispose is idempotent. Tests exercise concurrent mount, no-fetch URI rejection,
header/contract rejection, guard recovery and disposal exactly once.

## Main #136 refresh (2026-11-03)

`main.ts` now opens the ordinary live world at zoom 21.2/pitch 54, with autoplay
disabled unless explicitly requested. Only the main.ts fixture changed among the six
verified files: geography, place data, Three/MapLibre versions and coordinate transform
remain identical. Adapter code did not need a coordinate change.

The previous proof's default zoom 16/near zoom 19.2 did not represent that first view.
`view-policy.mjs` now uses the actual 21.2/54 entry camera; a regression test executes
the upstream query-parameter/camera declarations for desktop and mobile widths. It
checks ordinary entry, autoplay=0, explicit autoplay=1 and entryPreview=1 separately.
Browser screenshots now distinguish entry, overview and near. These are prepared
checks, **not newly executed WebGL evidence**; the launch blocker remains unchanged.

### Separate Mac evidence, not a pass for this refreshed asset set

A separate Mac validation reported Chrome WebGL2 rendering for earlier PR head
`0355ec17526f5c583bf1534799d6f8e098303807` with main
`bd6d9d5bab9a6c3e5653ed1b195e76f16b67d21b`: LOD0 near/wide and LOD1 wide,
12/8 render calls and OFF=0; 13 integration tests and 672 product tests plus typecheck
and build passed. That report did not establish actual product-scene coexistence or
mobile validation; its near-view assertion included off-screen coordinates.

The refreshed GLBs, 14th integration test and entry-camera policy in this revision
were **not** covered by that earlier Mac run. Do not generalize its result to this
revision. A matching-head Mac rerun is pending. The Linux launch failure above is
a historical environment-specific failure, not a claim that Mac rendering failed.
