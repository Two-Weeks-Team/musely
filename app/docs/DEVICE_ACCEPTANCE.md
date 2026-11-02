# D-04 device acceptance — preparation and approved reference amendment

This document defines collection and review. It contains no final release/device PASS. Measurements require the release owner to freeze one release SHA, Worker version, configuration hash and served-body manifest first. A local diagnostic, emulated viewport, source hash, or completed collector is a separate evidence layer.

## Approved reference amendment, 2026-11-02

The approval in the current execution conversation replaces C11's original MacBook Air M1 reference with **MacBookPro18,2** for D-04 acceptance. Keep the original contract text as historical provenance. Label results with actual hardware; a Pro measurement is not an Air M1 measurement.

The mobile reference is **Samsung Galaxy S23 Ultra (SM-S918N), Android 16/API 36**, using the existing task tab in Chrome. Record actual Chrome version, viewport, native DPR and applied DPR. The approved comparison uses a **1.5 DPR cap, 210 seconds, manual `setMode('story'); startStory()` route**, matching the saved baseline. Do not use the accelerated first automatic entry for this fixed-route comparison.

## Acceptance and evidence

| Scope | Acceptance | Evidence and limitations |
| --- | --- | --- |
| First visit | Cache disabled, service worker bypass, 4 Mbps/150 ms, actual readable commons arrival ≤8 s | Navigation-relative `performance.now()`: ready kit, eight actors, zoom ≥20.35 and ≥1 on-screen Muse at least 20 CSS px high whose centre hits the canvas. Record scene-ready separately; scene-ready alone cannot pass arrival. |
| Desktop | Visible Chrome on MacBookPro18,2; 210-second median ≥55 FPS and p95 frame ≤33 ms | All 210 one-second FPS bins include zero-frame seconds. Record raw RAF frame intervals, an independent visibilitychange log (even while hidden RAF stops), and actual DPR. Remove that listener during cleanup; cleanup failures remain failures. |
| Physical mobile | Same device/context; median ≥30 FPS and p95 frame ≤50 ms | Browser emulation does not satisfy this gate. Record Chrome group PSS every approximately 10 seconds and at end. |
| Mobile memory | Peak and end candidate increase each ≤`max(20% × baseline, 64 MiB)`; no crash or sustained upward growth | No invented absolute browser memory cap. Missing process samples remain UNKNOWN. Review raw trend and context, separately from numeric comparison. |
| Eight-character kit | LOD0/1/2 triangles ≤28,000/8,000/3,000; ≤2 simultaneous LOD0; character draw ≤10; Three draw ≤90 excluding MapLibre | Sample the paused 0–210 story route at one-second poses. This is pose-budget evidence, not 210-second FPS. |
| Eight-character assets | Shared eight-character GLBs including clips/props ≤15 MiB; character texture estimate ≤96 MiB | Twelve required runtime files. Texture estimate uses unique GPU Texture IDs, RGBA8 width×height×4, ×4/3 for mipmaps. Unknown dimensions do not pass. |
| Live ten-character world | Separate actor IDs/LOD/draw observations | Never apply the eight-character 90-draw gate automatically. Ten world actors do not establish all ten are on screen. Camera/screenshot evidence requires review. |
| Layout | Horizontal overflow 0; essential controls reachable at 360×640, 390×844 and 1440×1000 | The dedicated welcome-layout browser regression owns actual clicks and keyboard access. Collector end-state geometry/hit checks supplement that regression. |

The saved same-phone baseline contains all 210 FPS bins, 22 PSS samples, viewport 411×742, native DPR 2.625/applied 1.5, Chrome 156.0.8078.73. PSS peak/end were 1,514,268 / 1,341,987 KiB. Its script left profile cache state unchanged and intercepted frozen HTML; it did not record an exact cache inventory or a controlled cold/warm precondition. Preserve this limitation in the comparison. A new context declaration does not retroactively prove the old cache state. Chrome group PSS includes other preserved Chrome processes, so assess process/sample continuity and raw trend.

## Reproducible collector

Run Node 24 from the application directory. `node scripts/device-benchmark.mjs --prepare` makes no connection. `--metadata --cdp http://127.0.0.1:PORT --target EXACT_ID` performs a read-only exact-target inventory and prints only that page. Never select the first matching Musely tab.

The private freeze JSON requires `status: "frozen"`, 40-hex `releaseSHA`, Worker UUID `workerVersion`, 64-hex `configSHA256` and `htmlSHA256`, HTTPS `origin`, exact `targetId`, `referenceDevice` (`MacBookPro18,2` or `SM-S918N`), `dpr: 1.5`, `durationMs: 210000`, and served `files` entries `{path, sha256, bytes}`. The manifest must uniquely contain `index.html` plus all twelve required shared GLBs, valid SHA-256/positive byte counts, and bind the index hash to `htmlSHA256`. Every external script/stylesheet/module-preload referenced by the HTML must also be listed; unsupported foreign/query-varying code URLs fail closed. Actual fetched bytes must match both hash and byte count. Exclude deployment-only `_headers` from served GET entries. For non-first-load runs, supply `htmlFile` containing exactly the frozen body. Mobile comparison also requires `baselineSHA256` of the exact baseline artifact and a declared `baselineContext`. Before any CDP/source request, the collector verifies that hash and compares model, Android, Chrome, viewport, applied DPR, route and cache policy wherever the artifact actually records those fields. Contradictory values in the artifact itself also fail. A declaration cannot substitute for an unrecorded historical field. The saved old baseline records viewport/applied DPR/Android/Chrome, but has no structured model/route/cachePolicy fields; keep its original receipt/method/source-document reference and explicit cache limitation. Missing fields remain `baselineProvenance.missing`; a numeric PSS pass is still available, but automated `measuredChecksPass` stays false until context evidence is complete. Do not edit a historical baseline to backfill inferred device/OS/cache values. Root may assess original separate receipts explicitly; this tool does not silently convert them to measurements. The final owner supplies the release/Worker/config identity; the public status endpoint cannot attest that identity. HTML/assets are independently hashed before and after collection.

```sh
node scripts/device-benchmark.mjs --execute --pin PRIVATE_FREEZE.json \
  --cdp http://127.0.0.1:PORT --target EXACT_ID --kind mobile-210 \
  --serial DEVICE_SERIAL --baseline PRIVATE_BASELINE.json --out NEW_PRIVATE_DIRECTORY
```

Other `--kind` values are `desktop-210`, `first-load`, `eight-budget` and `live-observation`. First-load runs on each approved reference use the same target-local network policy and record actual device identity. Use separate freeze copies with each exact target/reference. The task tab must already be visible. The collector never activates other tabs, clears global caches, creates/removes ADB forwards, kills processes or closes browser/pages. It restores its own CDP network/interception changes and closes only its connection. It blocks non-GET/HEAD requests on the measured target, preserving attempted-write evidence without request bodies.

Each new output directory retains `results.json`, an end screenshot and mobile progress samples. Errors, missing values, attempted writes, source changes and cleanup failures remain failures/unknowns. `measuredChecksPass` covers automated checks only. Final review must also assess raw memory growth/crashes, cache provenance, layout interactions, image quality and ten-actor visibility. No final measurements have been run by this preparation commit.

## Preparation repair validation

Required-source-manifest, baseline provenance and visibility gates are offline-tested. No real Chrome/ADB/operational GET measurement is established by those tests. `cold-arrival.browser.js` now exposes both `pass` and identical `ok` values, including `ok:false` on exceptions, so the shared callback runner cannot treat a failed diagnostic as ALLPASS. A plain uncompressed local server and a compressed production build have different transfer conditions; preserve server/content-encoding/transfer measurements and do not infer a product regression from incomparable runs. The cold diagnostic remains separate from physical-device and final-release acceptance.


The follow-up offline guard repair compares every non-null recorded value for each context key across `context`, top-level, `device` and `conditions`. Applied DPR is taken only from an explicit number or `dpr.applied`; native DPR alone does not supply it. Conflicting aliases remain conflicts, and declarations do not fill missing history. Static code discovery uses quote-aware start-tag tokens and the first `base[href]` URL; comments and script/style raw text cannot supply a different base or a fake resource. Foreign or query-varying code remains refused. These guards cover the repaired input forms; the current product has inline code, so the offline malformed-coverage fixtures do not demonstrate an actual missing product file or a device result.
