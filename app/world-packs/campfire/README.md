# World-02: isolated campfire visual pack (draft)

Related #131. Not production-integrated, not ready to merge. World-01 #130 / PR135 is still a draft awaiting actual WebGL acceptance; its coordinate contract may change.

## Scope and coexistence

Original procedural stone ring, three logs, coal, layered flame, eight spark meshes and four static benches. No fabricated occupants, activity, invitations, world writes or inventory grants. `renderer.mjs` clones this untextured GLB's geometry/materials per instance, updates near/mid/far/hidden visuals, and disposes only its own resources. Do not pass arbitrary textured/skinned models: shared textures and skeleton ownership are outside this pack's contract.

`ArrivalSnapshot` is a trusted adapter DTO, **not an authorization mechanism**. `receiptId` nonemptiness only catches missing data; it does not cryptographically verify arrival. Existing authoritative world state must supply same-place arrived Muse IDs. Expired, future or wrong-place snapshots show no attendance/sparks. A low idle flame is ambient decoration. Count/seat occupancy is metadata, not rendered avatars.

Coordinates are metres, local ground center, Y up. The prop contains no geographic offset or 30-degree commons rotation. Position/orientation must be supplied once by the existing Place/scene adapter. PR135 geographic-mesh reprojection is not automatically applicable to this local prop. No main.ts, world engine, Place IDs, server or production import has been changed in the proposed final layout.

## Reproduce

Requires Node 24. `npm ci --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run validate` in this directory. Typecheck covers controller.ts only, not the whole application or JS renderer. Tests execute actual Three.js GLTFLoader and scene objects under Node, not WebGL.

Regenerate with installed Blender 4.3.2: `blender -b --python create.py`. Generator writes GLB, metrics, Blender working file and preview beside itself. Blender working files are ignored. `preview.png` is a CPU Cycles authoring preview: the ground/light/camera are preview-only, not exported. Five scale animation tracks are exported; this renderer uses its own procedural frame updates rather than an AnimationMixer. Never run both animation systems on the same instance.

## Evidence (2026-11-03)

- Latest checked main: bd6d9d5bab9a6c3e5653ed1b195e76f16b67d21b (#136 live-world/onboarding merge).
- Coordinate reference: draft PR135 0355ec17526f5c583bf1534799d6f8e098303807, not an accepted dependency.
- Node tests: 14 passed, including actual GLB parsing, LOD, arrival filtering, resource ownership and disposal.
- Strict TS controller check passed.
- Khronos validator: 0 errors / 0 warnings. GLB 120160 bytes, 972 triangles, 44 meshes, 5 materials, 5 animation tracks.
- SHA256: 88a12de90b22b022f0baf5b3900e897320004397e54b55eabae6533a4e35fd3b.
- Blender still inspected: stones, wood, flames and four benches visible. Stylized mesh flame, not volumetric fire. Preview has mild CPU sampling noise.
- 44 meshes means potentially many draw calls near/mid: no measured GPU cost or mobile FPS claim. Mid hides sparks but retains base geometry; far replaces model with a single cone. Instancing/merged geometry should be considered after measurement.

## Remaining acceptance gates

Remote exact-commit CI, real WebGL frames and animation, actual Musely scene/Place-state adapter, mobile/draw-call/performance testing, and #130 coordinate acceptance. No production deployment or real-device validation has happened. Integration stays disabled until these gates are satisfied.

Original procedural asset/code only; no imported Muse/Jolly assets or third-party textures. This folder does not change repository-wide licensing.

## Independent review follow-up

Review found initial visible sparks before first update (P2) and a stale seven-material authoring count (P3). Construction now applies a hidden zero-attendance frame; actual-GLB regression test covers it. Metrics now count five exported materials. Malformed arrival arrays also fail closed, with a regression test. Review did not find P0/P1. This is code review, not product acceptance.

Latest main includes signed campfire arrival consent (#136). This pack does not bypass or replace it. No current app/worker files are changed. #130 coordinate/scene-overlap investigation remains blocking actual integration.

CI correction: first remote run passed 14 tests but TS7 discovered the parent app tsconfig and failed TS5112 with command-line files. Added an explicit isolated tsconfig and use tsc -p; no parent compiler config changed.
