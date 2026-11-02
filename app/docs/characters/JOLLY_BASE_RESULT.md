# Jolly base — local implementation result

The cream base is implemented on `feature/jolly-base`, based on `origin/main` at `ec9bffe`. The four IP files already merged to main are unchanged. The existing character plan, including its ownership and Task 7 edits, is preserved and included with this work.

## Inspect the actual asset

From `preview/`, use Node 24 and run:

```sh
npm ci
npm run check
npm run proof:build
npm run proof:dev
```

- Character studio: http://127.0.0.1:8788/
- Same asset in the actual geographic world: http://127.0.0.1:8788/world/?character=jolly
- Editable source: `character-kit/source/muse_family.blend`
- Runtime asset: `character-kit/runtime/base/lod0.glb`
- Matching local portable copy: `character-kit/portable/00-jolly/lod0.glb`

The proof builder bundles current source independently of production `dist/`. It does not deploy. The world candidate uses the new base for Jimin and preserves all eight person IDs, the existing map, routes, continuous camera and 210-second story. The default world keeps its accepted appearance while the base is reviewed.

## Delivered base

- Height: 0.899757 m. Front width/height 0.8973 versus approximately 0.9016 observed in the supplied poster, excluding its white cutout border. This is an overall aspect comparison, not a claim of full silhouette IoU or verified side/back identity.
- 22,886 triangles; four rendered character material primitives; twenty bones and six attachment sockets.
- Twelve reusable clips: idle breathing, walking, looking around, thinking, listening, talking, waving, sitting down, sitting idle, standing up, celebrating and offering an item. Timelines begin at zero and match the animation manifest.
- Eight expression presets, separate left/right blinks and mouth opening. The shared face controller composes expressions with blinking without inverted eye geometry.
- Original short-fleece color, tangent normal and ORM textures, a warm face/blush texture, opaque short silhouette tufts, smooth face and glossy eyes. Cloth/face emission is zero. The browser appearance was also inspected with the optional sheen contribution set to zero. Maps are embedded PNGs; no Blender hair system is required for the exported appearance.
- GLB: 5,912,584 bytes. SHA-256: `6543bd2d53731e4512f11ad3ccffb92b6339464df00d80dd7f8ccbe7d80af771`. Runtime, portable, regular build and proof copies match.

The source scripts record the modeling/material/rig/export process. `build_base.py` starts a new scene in an otherwise clean background Blender file; `rig_base.py` consumes its saved source, `export_base.py` normalizes the portable export, and `render_review.py` captures the rigged model from four directions. Use the official Blender MCP backend. Canonical prior assets were not overwritten.

## Verification

- `npm run check`: 28 Node tests, TypeScript and the production build passed.
- Official Khronos glTF Validator 2.0.0-dev.3.10: zero errors, zero warnings. Eleven informational notices concern attachment empty nodes and unused non-normal-material UV/tangent attributes; they were not suppressed.
- Source .blend reopened through the official MCP background tool with no missing external files. Textures are packed; embedded/exported PNGs decode successfully.
- Actual imported skin binds arms, hands, feet and torso; cloned actors share geometry while retaining independent bones and facial state. Route transforms apply to the rendered geometry. Skinned meshes are excluded from rigid instancing.
- All twelve actions, eight expressions and three lighting presets were captured in the browser. Front, quarter, side and complete back views were inspected; the studio cove is moved behind the character for each view.
- All eight expressions were tested at a complete blink using actual exported top/bottom eye vertices. The eyes stay correctly ordered and close to below 15% of their open height.
- Support feet remain within the specified 20 mm ground tolerance. An independent full-clip check measured a worst value of approximately -12.77 mm. The actual animated base clears existing furniture throughout the full Jimin route.
- Desktop 1440×1000 and 390×844 touch emulation passed imported-material, action, expression, pause, zoom, dialogue, person identity and follow checks. The actual map keeps one canvas and the same actor through the camera tour.
- Final uninterrupted 210-second run completed with Replay available, continuing idle life, the same scene/Muse/actor IDs, 60 fps and 40 custom-layer draw calls at the final desktop sample, and no page exceptions or recorded map errors. This is a recorded desktop sample, not a physical-mobile performance guarantee.

Physical phones and the later multi-character LOD/catalog release are outside this base-only result. Detailed local QA logs and browser captures live under ignored `output/jolly-base/`; structural/visual reports are under `character-kit/validation/`.

## Review decisions

One independent whole-candidate review found two important issues: additive expression/blink inversion and a proof builder depending on absent/stale production output. Both were reproduced and fixed with failing-then-passing tests. Its timeline mismatch was treated as important because it altered distance-owned gait; its obscured back capture was treated as important because it blocked complete visual inspection. Both were corrected and checked. No deferred review findings remain.

Execution used the existing checkout and a feature branch to preserve the requested folder layout; only the base was implemented. The official MCP stdio client reached the same official backend because native Blender tools were not exposed in this turn. A separate static proof server substitutes for local Workers emulation because the installed runtime does not support the production compatibility date. These choices do not establish a production deployment or a physical-device pass.
