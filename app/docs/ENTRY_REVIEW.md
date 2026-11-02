# Preview entry review — 2026-10-31

This patch addresses the supplied Muse review of the hosted visual preview. It changes the opening, loading dependency and on-stage disclosure; character production remains the separate base-plus-nine plan.

## Reproduction and cause

A fresh desktop browser context delayed every OpenFreeMap request by 3.5 seconds. The original production build still had no rendered geographic features after 14 seconds. At wall time 20 seconds, its story had only reached 5.3 seconds. Detailed Muse scale followed around wall time 29 seconds. The observed empty navy map and floating community bubbles reproduced the review.

The scene was initialized in MapLibre's `load` event, which waited for online sources. Its camera then held wide for four story seconds and reached the commons at fourteen. These delays accumulated.

## Changes

- Start the embedded character scene at `style.load`, independent of online tile completion.
- Bundle a simplified geographic overview of the actual Bay water and primary roads. Keep it beneath the online map below zoom 14, including later Bay returns; detailed online geography renders above it. Colors and coordinates follow the existing map. Attribution remains visible and the data carries ODbL source metadata.
- Hold the community overview for two story seconds and arrive at the same commons by eight seconds, through the existing continuous camera. The mapped anchor, authored ground, scene and eight Muse identities are unchanged.
- Keep a small Preview label. Remove the repeated technical disclaimer and dialogue turn number from the stage; full scripted/live-service disclosure stays in About.

## Verification

The final local browser check delayed every OpenFreeMap request by six seconds in new contexts. These are controlled map-dependency measurements, not a connection-speed guarantee for downloading the HTML itself.

| Check | Desktop 1440×1000 | 390×844 touch emulation |
| --- | --- | --- |
| First geography and scene sampled | 0.57 seconds | 0.52 seconds |
| Scene first render | 0.49 seconds | 0.44 seconds |
| First sample's local map features | 221 | 214 |
| At story 8.5 seconds | zoom 21.45, Muse 56 px tall | zoom 20.8, Muse 35 px tall |
| Bay return after online success, later online requests aborted | 533 local features visible | 273 local features visible |
| Page exceptions | 0 | 0 |

All 34 dialogue turns were checked in both sizes for the correct speaker/text, viewport clipping, overlap with interface panels and a single shared map canvas. All passed. About disclosure remained accessible. Three pause → Bay → replay cycles per viewport passed both before and after the change: the reported replay failure did not reproduce, so playback logic was not changed.

An uninterrupted local 210-second run completed naturally with the Replay button, continuing idle life, the same scene and Muse IDs, and no page exceptions. This run exercised the revised startup/camera before the final overview-retention adjustment. The final browser regression separately verified that adjustment.

`npm run check` passed all 18 unit tests, TypeScript and the production build. New regressions cover eight-second camera arrival and the entire authored ground remaining outside the overview's water polygons. The browser regression is `scripts/entry.browser.js`; its initial-world assertion failed against the original production build and passed after the patch. An independent review found the Bay-return retention gap; the corrected final patch has no blocking findings.

Physical phones, mobile Safari and arbitrary networks are not covered by touch emulation. The reported mobile/replay issue is not claimed as fixed. New character personalities and materials are not part of this patch.

## Artifact

Local final HTML: 3,486,966 bytes; SHA-256 `ddc42f553de81e074a037f83ecece577f47c352e58962d91faa58639b3ea096d`. Character GLB and Sigil source hashes remain unchanged. Raw QA logs and screenshots are local under ignored `output/`; source and the repeatable browser check are versioned. Production verification must match the triggering commit, successful Workers Builds check and served artifact rather than merely a configured Git connection.

## First visit on a slow connection (2026-11-01)

**Problem.** Since the rigged character kit (PR #2), `makeWorld` waited for every resident's files — base LOD0/LOD1/LOD2 and seven attachments, about 13.5 MB — before the world layer was added. Measured on production with no cache at 4 Mbps and 150 ms latency: the map appeared at 4.1 s but the commons, residents and story only at 33.5 s (about 25.4 MB transferred). The eight-second arrival above held only with a warm cache.

**Change.**
- The build derives `character-kit/runtime/base/clips.glb` (267,320 bytes) from the hash-checked base LOD0: the rig hierarchy and all 21 clips, no meshes, skins or images (`scripts/clips-glb.mjs`, deterministic; Khronos glTF Validator 2.0.0-dev.3.10: 0 errors, 0 warnings).
- The first view builds each resident from LOD2 (446,828 bytes, same rig digest) plus these clips. `makeWorld` waits only for those two shared files.
- In the background, every attachment, then LOD1, then LOD0 is added to the **same** actor (`MuseActor.addAttachment` / `addLod`). The root, skeleton, mixer, action clock and expression are never replaced. A requested LOD that has not arrived renders the closest loaded LOD.
- The two light files start downloading as soon as the script runs. Online map tiles join when they arrive, or after 4 s. Until then the embedded Bay overview stays visible.
- Fallbacks are kept. Kit files retry twice. A resident whose light files fail appears as the plain base Muse. If the kit is unreachable, the embedded rigid characters stand in. A failed upgrade step keeps the current detail.

**Measurement.** `scripts/first-load.browser.js` uses a fresh context, the HTTP cache disabled and Chromium emulation at 4 Mbps down / 150 ms latency. It asserts that the commons, residents and story appear within 8 s, that the first view uses LOD2, and that upgrades keep every actor's root and finish with LOD0/1/2 loaded. Local runs use `scripts/serve-dist.mjs`, which brotli-compresses text like production (HTML 0.90 MB vs 0.996 MB served).

| From navigation start | Desktop 1440×1000 | 390×844 touch emulation |
| --- | --- | --- |
| Map overview visible | 2.3 s | 2.3 s |
| Commons, residents and story | **3.9 s** | **3.9 s** |
| Camera arrival (story 8 s) | 12.0 s | 11.9 s |
| Attachments on all residents | 18.1 s | 17.3 s |
| LOD1 / LOD0 available | 21.5 s / 33.8 s | 20.7 s / 33.0 s |
| Transferred | 15.05 MB | 15.05 MB |

Before the map-tile deferral, the same harness measured the commons at 6.9 s on desktop: LOD2 and the clips shared bandwidth with tile downloads. `entry.browser.js` and `muse.browser.js` pass unchanged (close-up LOD0 for the selected Muse and speakers, 0 page exceptions). Production numbers after deployment are recorded in the PR.

## D-04 initial automatic arrival — 2026-11-02 amendment

C11's eight-second gate now uses the actual readable commons, not `sceneReadyAtMs` alone. The new local `scripts/cold-arrival.browser.js` records both. It requires the rigged eight-character scene, zoom ≥20.35 and at least one on-screen Muse at least20px tall whose centre is visible over the map canvas. Fresh contexts disable cache and bypass service workers at4Mbps/150ms, DPR cap1.5. These are local desktop/mobile-emulation diagnostics, not final physical-device or deployed-release acceptance.

| Navigation-relative time | Before desktop | After desktop | Before390×844 emulation | After390×844 emulation |
|---|---:|---:|---:|---:|
| Scene first render |4.389s|4.382s|4.368s|4.362s|
| Actual readable commons |**11.255s FAIL**|**6.955s PASS**|**11.682s FAIL**|**7.110s PASS**|

Only the first automatic entry compresses the original0–8 camera curve into3seconds, holds the original8-second pose, then rejoins the original camera timeline exactly at story8seconds. The3:30 story clock, actors, dialogue, geographic curve, source labels and all later camera poses remain unchanged. Manual `startStory`, the Play/Replay button and seek use the original intro. Camera unit checks cover curve equivalence and continuity at3/8seconds; the browser also verifies manual start and seek against the original3-second poses. Both cold cases had0 exceptions and0 API writes. The final pinned-release cold check and physical-device/FPS/PSS gates remain separate and pending.
