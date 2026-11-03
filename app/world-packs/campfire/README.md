# World-02: isolated campfire visual pack (draft)

Related #131. Default-OFF scene hooks implemented; not visually accepted or ready to merge. World-01 #130 / PR135 is still a draft awaiting actual WebGL acceptance; its coordinate contract may change.

## Scope and coexistence

Original procedural stone ring, three logs, coal, layered flame, eight spark meshes and four static benches. No fabricated occupants, activity, invitations, world writes or inventory grants. `renderer.mjs` clones this untextured GLB's geometry/materials per instance, updates near/mid/far/hidden visuals, and disposes only its own resources. Do not pass arbitrary textured/skinned models: shared textures and skeleton ownership are outside this pack's contract.

`ArrivalSnapshot` is a trusted adapter DTO, **not an authorization mechanism**. `receiptId` nonemptiness only catches missing data; it does not cryptographically verify arrival. Existing authoritative world state must supply same-place arrived Muse IDs. Expired, future or wrong-place snapshots show no attendance/sparks. A low idle flame is ambient decoration. Count/seat occupancy is metadata, not rendered avatars.

Coordinates are metres, local ground center, Y up. The prop contains no geographic offset or 30-degree commons rotation. Position/orientation must be supplied once by the existing Place/scene adapter. PR135 geographic-mesh reprojection is not automatically applicable to this local prop. main.ts, world engine, Place IDs and server remain unchanged. scene.ts and live-scene.ts now import/use the optional port.

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

Remote exact-commit CI, real WebGL frames and animation, actual Musely scene/Place-state adapter, mobile/draw-call/performance testing, and #130 coordinate acceptance. No production deployment or real-device validation has happened. The feature remains OFF by default until these gates are satisfied.

Original procedural asset/code only; no imported Muse/Jolly assets or third-party textures. This folder does not change repository-wide licensing.

## Independent review follow-up

Review found initial visible sparks before first update (P2) and a stale seven-material authoring count (P3). Construction now applies a hidden zero-attendance frame; actual-GLB regression test covers it. Metrics now count five exported materials. Malformed arrival arrays also fail closed, with a regression test. Review did not find P0/P1. This is code review, not product acceptance.

Latest main includes signed campfire arrival consent (#136). This pack does not bypass or replace it. No current app/worker files are changed. #130 coordinate/scene-overlap investigation remains blocking actual integration.

CI correction: first remote run passed 14 tests but TS7 discovered the parent app tsconfig and failed TS5112 with command-line files. Added an explicit isolated tsconfig and use tsc -p; no parent compiler config changed.


## Optional actual-scene port (e806 baseline)

`makeWorld(..., sourceHeight, {enabled: true, distanceM: () => distanceInSceneMetres})` explicitly enables the replacement. Otherwise no model parsing, request or scene replacement occurs. The returned `world.campfireVisual` exposes enable/disable/dispose/getMetrics. A valid camera-distance provider is mandatory; unavailable/invalid distances hide the replacement. This PR does not add an end-user toggle or guess camera distances.

The existing `Fire` group is swapped only after asset loading succeeds. Original ring, logs, benches and glow are batched in the main scene and remain untouched. This integration hides the pack's extra architecture to avoid duplicated seats/rings. It uses the existing Fire's x/z without a new map transform, and applies no #130 terrain/building layer. Failed loading and disable restore original visibility. Dispose is idempotent; disabled/disposed pending loads cannot resurrect a model.

Actual `makeLiveScene` feeds the accepted current projection world each update (including replay projection). Only current-place Muses with travel:null count; invite/gathering events alone never count. This is read-only projection, not consent/identity validation. Existing engine/worker arrival policy remains authoritative. Leaving live mode clears evidence; disposing a live controller disables but does not destroy the world-owned port, allowing controller recreation. Final world owners must call port.dispose() at teardown.

The existing production build is IIFE and has no generic GLB URL copier. To avoid a new server/build pipeline or broken import.meta URL, a byte-identical base64 JSON is bundled and parsed only on explicit enable. This adds about 160 KB of uncompressed source payload even while OFF; no network fetch is added, and compressed delivery/GPU timing is not yet measured. validate.mjs enforces equality with the independently validated GLB. This is an explicit cost, not zero-cost feature gating.

Verification at e8060f13b08142758aaa0ef0fb27a736bf3d7c3d: 21 independent pack tests, 2 actual makeLiveScene integration tests, app+worker typecheck passed locally. Local full build reached bundle output but failed existing character-kit lod0 checksum: reused verification mirror has two mismatching lod0/lod1 files. All other available original app files were Git-blob checked; missing source-authoring images are not required by this feature. Exact repository CI is authoritative for final build. WebGL frames, actual makeWorld character/DOM execution, mobile FPS and final #130 overlap acceptance remain unverified.


## Cost/UX revision on latest main 7a85add (supersedes inline-byte approach above)

Removed asset-bytes.json and all inline base64. The build now emits the validated GLB with existing writeHashed and includes its exact URL in the asset manifest as deferred. Only explicit enable fetches the same-origin pinned URL. OFF issues zero asset requests and parses no model. The response must match both length and SHA256 before GLTFLoader receives it. Failed HTTP/integrity/loading retains the old fire; retry remains possible. This is a small additive latest-build.mjs change, not a new deployment path. The 160KB inlined payload cost described historically above is removed; renderer/port JS still ships. Browser network transfer/compression and GPU timings remain unmeasured.

23 isolated tests pass, including deferred emitter, OFF zero requests, correct hash path, corrupt response rejection and ownership recreation. The two app-level tests stub transport only: actual GLB parser, scene port and live projection execute. This is not an HTTP/browser acceptance claim. Customer-visible toggle and visual usability still need a separate acceptance pass; no Mac UI was touched while #130 owns that screen.

Review found optional asset loading could stall makeWorld. Startup is now fire-and-forget with legacy fire retained, and fetch/body use an 8-second abort signal. A failed optional prop cannot block the commons load. Timeout is a loading bound, not a performance measurement.
