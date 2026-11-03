# World-02: opt-in campfire visual pack

Supports #131. Based on main a31c9c9fb0d364f8e7ab8ec0fff2cfb647647620. The active main team PR129 changes directory documents; this change does not touch them, scene.ts, engine state, runtime, preview, deployment or submission.

## Delivered
- Original procedural GLB: 113840 bytes, 924 triangles, 40 mesh nodes, 5 exported materials, 5 flame-scale animation tracks.
- Independent pure-TypeScript visual controller: distance LOD, truthful arrival snapshot input, empty/stale/wrong-place fail-closed visuals and explicit owned-resource cleanup.
- Blender generator and eight Node contract tests. No third-party textures. Source geometry was created for this project, not extracted from proprietary maps or character assets.

## Integration boundary (not wired into production)
World-01 #130 supplies the world transform. Asset local origin is ground center; unit meters; glTF is Y-up. No geographic origin or road-grid rotation is baked in. Apply the pack transform exactly once. A renderer binding may map `flameScale`, `sparksVisible`, and `seatsOccupied` to node/material states; far LOD is an icon, not the full GLB. The binding exclusively owns resources it lists for disposal and must not list shared loader-cache resources.

ArrivalSnapshot is a rendering adapter DTO, **not an authentication proof**. Only an existing trusted world-state/event adapter may produce it, after validating real arrivals for that place. No browser/customer-supplied receipt string should be trusted. Missing, expired (60 seconds), future, other-place or unreceipted snapshots show zero occupancy. Idle flame means ambience, not a gathering. Source remains external; this module cannot write attendees, trade state or simulation events. Multi-place invitation server changes are explicitly out of scope.

## Standalone preview and reproduction
From the asset directory: `blender -b -t 2 --python create.py`. This writes GLB, editable blend source and preview.png to that same directory; do not run in a directory containing unsaved edits to those outputs. Requires Blender4.3.2 with glTF exporter. The source blend includes preview-only ground, lights and camera that are not in the GLB. The preview is not a mobile/browser renderer.

## Executed checks
- Node24.22.1: `node --test app/scripts/campfire-pack.test.mjs`: 8 passed.
- GLB2 magic/length/JSON checked; five animations present.
- Blender4.3.2 export succeeded. CPU still render visually inspected: split flames, stone ring, logs, coal visible. First render failed because OpenImageDenoise was absent; disabling denoising fixed it. At24 samples the image is slightly noisy.

## Not verified / not complete
Full app typecheck, build and aggregate checks were not run: HTTPS clone has no available GitHub CLI credentials in this executor. The connector can create the isolated branch without extracting credentials. No product CI success is claimed. `game-dev` CLI is absent, so canonical game-package validation is not claimed.

No Three.js GPU import, animation playback, browser rendering, physical mobile frame time, thermal/memory check, World-01 alignment or production integration has been performed. Sparks are currently static; seating assets and full LOD geometry variants are follow-up work. Rendering controller tests are not evidence of an actual gathering. This PR stays draft until these gates are addressed; it does not close #131 or authorize merge/deploy.
