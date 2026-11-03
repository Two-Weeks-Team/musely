# World-02 campfire visual pack

Related #131 / PR137. Default OFF, draft, not visually accepted. No merge or deployment. The latest integration follows main151 (`d4521aa70467fb2e18705dcd26816ba482ec3892`) and preserves its personal Muse onboarding, profile priority and original character-body loader.

## What is connected

`makeWorld(..., sourceHeight, {enabled: true, distanceM: () => distanceInSceneMetres})` or `world.campfireVisual.enable({distanceM})` opts in. OFF fetches/parses no campfire asset. There is no customer-facing toggle and no guessed camera distance. The port requires a valid distance provider.

The same-origin deferred asset is 120160 bytes at its SHA256-pinned URL. Build emission uses the existing asset pipeline; this is not an inline-base64 payload or a new deployment route. Fetch and response consumption have an eight-second abort bound. HTTP/hash/load failure keeps the original fire and permits retry. Optional loading does not block `makeWorld` startup.

Only flames and sparks replace the existing `Fire` group. Existing batched stone ring, logs, benches, light and glow remain. Pack furniture is hidden, not laid on top of the original furniture. The replacement uses the existing Fire x/z and ground-centred Y-up metre coordinates with no second geographic transform. #130's map/roof overlap acceptance remains separate.

Near is <=18m, mid <=60m, far <=200m, otherwise hidden. Far uses one cone. Unavailable/invalid distance hides the replacement. No occupants are generated; attendee/seat counts are metadata, not fabricated avatars or consent.

## Truthful attendance and lifetime

Only accepted current world snapshots with `place === 'commons:campfire'` and `travel === null` supply arrival evidence. Events alone never create attendance.

Transport freshness uses the successful `/api/world` JSON response time (`Fetched.at`), carried by `observeWorld` through world-panel, the startup `pendingLive` cache and `makeLiveScene.accept`. It does not use the minute-long business tick clock, the frame clock, or the time a cached response is finally handed to a renderer. Failed/rejected polls retain the original observation time; paused/startup-delayed stale data cannot become fresh on resume. Callers without transport evidence default conservatively to `lastTickAt`.

Replay uses the explicit recorded frame clock, never renewing live freshness. Returning from replay without a live snapshot clears recorded attendance, sparks, actors and selection. Leaving live mode clears evidence. The old disposed live controller cannot clear a newer controller's evidence.

`disable()` restores the original fire and removes owned resources. `dispose()` also releases scene ownership. Cleanup errors still restore the fallback and release ownership; remaining live-scene cleanup runs in `finally`. Synchronous custom loader failures clear pending state and allow retry. Out-of-order disabled loads cannot resurrect a replacement. Final world owners must call `campfireVisual.dispose()` at teardown.

The source model contract is an exclusively owned, untextured, unskinned scene. Renderer instances clone mutable geometries/materials and do not dispose shared source resources. Arbitrary textured/skinned models are outside this ownership contract. `ArrivalSnapshot` is a trusted adapter DTO, not cryptographic arrival authorization.

## Reproduce and evidence boundary

Node24: run `npm ci --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run validate` in this folder. App-level tests are in `scripts/campfire-visual-port.test.mjs`, `campfire-composition.test.mjs`, and `campfire-world.test.mjs`.

The tests parse the real checked-in GLB with Three.js and execute the actual scene/projection code. The complete `makeWorld` tests use real character GLB geometry with explicit HTTP, canvas drawing and texture-decode fixtures. They check OFF network silence, startup while the optional response is pending, geometry preservation, flame-only placement and near/mid/far/hidden transitions. They are CPU integration tests, not browser pixels, real network timing or GPU performance evidence.

Khronos validator: 0 errors / 0 warnings. GLB: 120160 bytes, 972 triangles, 44 meshes, 5 materials, 5 animation tracks. SHA256: `88a12de90b22b022f0baf5b3900e897320004397e54b55eabae6533a4e35fd3b`. The renderer uses procedural updates, not the exported animation tracks; do not run both animation systems on the same instance.

Real WebGL frames, original-ring alignment under zoom/pitch/terrain, browser OFF network tracing, mobile performance, user-facing enable/disable control and final #130 coexistence acceptance remain open. Keep the feature OFF and this PR draft until accepted. Production activation and merge need separate approval.

## Asset provenance

Original procedural asset/code; no imported Muse/Jolly models or third-party textures. Regenerate with Blender4.3.2: `blender -b --python create.py`. Blender working files are ignored. `preview.png` is a CPU Cycles authoring preview; its ground/light/camera are not exported. The pack does not change repository-wide licensing.

References: [Three.js resource disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html), [GLTFLoader](https://threejs.org/docs/#GLTFLoader). Prior implementation/CI history remains in the PR conversation; it is not new browser acceptance evidence.
