# HQ / Belle Haven authoring pack — draft World-01

Related: #130. Pinned source main: a31c9c9fb0d364f8e7ab8ec0fff2cfb647647620.

This is an isolated authoring pack, NOT imported by the production application.
It establishes coordinates and a real-data coarse road mesh; it does not complete
regional buildings, a surveyed reconstruction, routing, public access, or #130.

## Run
Node 24, no dependencies, no credentials or network:

```
node app/world-packs/hq-belle-haven/build.mjs
node --test app/world-packs/hq-belle-haven/contract.test.mjs
```

## Coordinates
- WGS84 longitude/latitude, commons origin copied from app/assets/geography.json.
- Local metres: +x east, +y up, +z south; approximate local projection matches places.ts.
- Geographic roads have ALREADY been projected. Do not apply commons grid rotation to them.
- gridToLocal is only for authored local commons objects; 30 degrees must be applied once.
- The contract rejects coordinates over 5km from origin; these helpers are not global projection tools.
- Place IDs and runtime geography are unchanged. This pack does not grant movement, access or teleport rights.

## Dataset and generated asset
`overview.geojson` derives solely from the pinned existing app/assets/arrival-map.json.
It retains 37 transportation segments with both endpoints within 1500m of the origin.
This is incomplete simplified overview geometry, NOT detailed street coverage. It does
not interpolate missing segments or create clipped boundary links. The original dataset
is simplified to five decimal places and 0.00012-degree tolerance, unsuitable for
precise pedestrian routing or building alignment.

`roads-preview.gltf` is an inspectable glTF 2.0 mesh (148 vertices, 74 triangles).
Road width is an explicitly stylistic 3m estimate, not a real road width. One mesh,
one material and one primitive are authored; actual renderer draw calls are unmeasured.
No building footprint/height source has been acquired; no fabricated real buildings
are included. No GLB, visual rendering, mobile profiling, or runtime integration is claimed.

## Data attribution and license
OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors, ODbL:
https://www.openstreetmap.org/copyright

Capture 2026-10-31; source metadata is retained in overview.geojson. This derived
geographic subset retains ODbL. The generated road geometry is derived from that
subset; preserve attribution and evaluate database distribution obligations when
shipping it. Code is covered by the repository code license. No character assets are
included and no rights to Muse/Jolly are implied.

## Tests and remaining gates
Nine focused tests pass on Node 24.22.1: coordinate basis/roundtrip, rotation, extent
rejection, provenance, mesh bounds and deterministic regeneration. Full product
`npm run check` was NOT run in this isolated pack; these tests do not replace it.
The first whole-feature selection produced no roads; selection was corrected to
retain complete segments only and the generator rejects empty road input.

Before integration: verify common frame against the current main; obtain detailed
footprints and height provenance; validate actual landmark alignment and public
access; add measured LOD and mobile budgets; perform real renderer visual QA.
Keep runtime loading disabled until those gates pass. Existing main work is untouched.
