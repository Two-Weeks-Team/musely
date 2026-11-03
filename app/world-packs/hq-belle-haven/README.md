# HQ / Belle Haven regional authoring pack (World-01)

Related: #130. Source main: `a31c9c9fb0d364f8e7ab8ec0fff2cfb647647620`, rechecked 2026-11-03.

An isolated, reproducible geographic **asset pack**, not imported by the production application.
Real mapped footprints, roads and green cover are included with estimated heights.
Runtime activation belongs to #134; this pack changes no Place ID, movement, authentication,
teleportation or public-access policy. No terrain elevation or surveyed accuracy is claimed.

## Reproduce and verify

Node 24 (tested 24.22.1); dependencies pinned independently of the product.

```sh
cd app/world-packs/hq-belle-haven/authoring
npm ci --ignore-scripts
npm run build
npm test
npm run validate
# Optional Blender 4.3.2 CPU rendering (writes ../preview.png):
blender -b --python render.py
blender -b --python render.py -- --lod1
```

`npm run acquire` is a separate **network** step, not a test/build dependency. It fetches
six fixed-version OpenFreeMap tiles serially with an identifying User-Agent. Source tile
URLs, sizes and SHA-256 are recorded in `detail.geojson.gz`. Network source updates are an
explicit authoring task, not automatic runtime downloads. Never run acquisition in CI.

## Coordinates and landmarks

- WGS84 longitude/latitude; commons origin `[-122.14991969950646, 37.48313116566372]`
  matches `app/assets/geography.json`. HQ anchor `[-122.15008,37.48336]` is about 29m NW.
- Local metres: +X east, +Y up, +Z south, matching `places.ts`' local approximation.
- Geographic meshes are already projected; their rotation is **0 degrees**.
- The separate `gridToLocal` helper rotates authored commons objects 30 degrees once.
  Never rotate this regional mesh by that angle a second time.
- Helpers reject coordinates more than 5km away; not global projection utilities.
- Data bounds: longitude -122.1679197 to -122.1319197, latitude 37.4691312 to 37.4971312.
  Approximately 3.2 × 3.1 km around HQ, including nearby Belle Haven, not the entire bay.

## Data, estimates and LOD

`detail.geojson.gz`: OpenFreeMap tile build **20261101_080013_pt**, acquired 2026-11-03.
Six zoom-14 tiles total 512,149 bytes. Includes 4,578 building polygon parts, 526
transportation features, 302 landcover and 76 landuse parts. Exact duplicate geometries
are discarded during generation; hide_3d features are excluded. Output retains 4,378
building parts, **not a verified count of unique real buildings**.

Heights use OpenMapTiles `render_height`: these may derive from levels or defaults;
individual values are not asserted as surveyed heights. `render_min_height` is 0 in
this captured set (tested). Holes are triangulated using Earcut; roofs and walls are
batched. Stylized road width is 3m, or 1m for paths, not a measured width. Green cover
includes mapped wood, grass, park, scrub and forest classes, not all possible vegetation.

Whole polygon parts are kept only when entirely inside the bounds. Tile boundary
fragments, clipped edge walls, incomplete margins, flat terrain and coarse vertical
accuracy remain limitations. No inference of public access or safe navigation is allowed.

| Asset | Bytes | Triangles | Indexed vertices | Authored draw calls* |
| --- | ---: | ---: | ---: | ---: |
| region-lod0.glb | 1,980,516 | 91,120 | 73,720 | 3 |
| region-lod1.glb | 888,796 | 29,978 | 43,886 | 3 |

LOD1 retains roof silhouettes and omits vertical walls. It is a far-view map LOD,
not a low-poly close-up building model. Close or low-angle views can expose floating roof edges; do not use LOD1 there. Suggested 500m switch is **unmeasured** and
must be tuned in #134. *Three primitives/materials in one mesh; actual renderer passes,
shadows and mobile draw calls/FPS are not measured. Static budgets are tested, not FPS.

`overview.geojson` / `roads-preview.gltf` retain an earlier lightweight fallback derived
from main's `arrival-map.json` (2026-10-31, 37 complete road segments, 74 triangles).
This incomplete simplified layer must not be used for pedestrian navigation.

## License and attribution

**OpenFreeMap © OpenMapTiles Data from OpenStreetMap contributors (ODbL)**.
Preserve visible attribution in any renderer that displays this data. Included gzip-compressed GeoJSON
and generated map assets derive from OSM and retain ODbL data obligations. The editable
source subset (gunzip detail.geojson.gz) is included here; redistribution must preserve license and source access.
This is not a license change to the application's code. No third-party logos or imagery.

- https://www.openstreetmap.org/copyright
- https://opendatacommons.org/licenses/odbl/1-0/
- https://openfreemap.org/quick_start/ (offline limit: 3,000 tiles/50MB, max 4 parallel)
- https://openmaptiles.org/schema/building/ (render height / hide_3d semantics)
- https://docs.overturemaps.org/guides/buildings/ (researched alternative, **not used**)

## Validation and evidence

- 16 focused tests pass: coordinate axes/roundtrip/rotation, source receipts, bounds,
  deterministic GLB bytes, holes, height assumptions, disabled integration and budgets.
- Khronos glTF Validator 2.0.0-dev.3.10: **0 errors, 0 warnings for both GLBs**;
  machine-readable result in `validation.json`, SHA-256 and geometry counts in `metrics.json`.
- Blender 4.3.2 imported both LODs and rendered `preview.png` and `preview-lod1.png`. Both far-view overviews inspected: mapped
  neighborhood, roads and green patches visible; not field or mobile renderer QA.
- Main application typecheck/build/`npm run check` **not run locally**: no app source or
  dependencies changed. These isolated checks are not a claim of application CI success.
- No real device, WebGL runtime, terrain elevation, route safety, public-access,
  geolocation, or deployment validation. Runtime remains disabled until #134 checks it.

## Attempts, corrections and handoff

Initial coarse whole-feature selection yielded no roads; changed to complete segments.
Initial tile selection excluded grouped MultiPolygons crossing the bounds; corrected to
individual polygon parts before filtering. Initial GLB duplicated triangle vertices;
indexed sharing reduced LOD0 from 4.38MB to 1.98MB. Blender denoising was unavailable,
so disabled; initial camera far clipping omitted the scene, fixed to 15km then re-rendered.
No source data was invented to conceal those failures.

Before integration, recheck main's geography/places and preview origin, use an explicit
opt-in adapter, choose LOD by measured camera distance, show attribution, and profile
on Android/iOS. Do not treat fictional commons or map footprints as access permission.
