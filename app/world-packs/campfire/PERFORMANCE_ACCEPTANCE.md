# Campfire performance: measurement pending

Issue #131 requires performance measurement and a clear distinction from untested
physical-mobile behavior. As of 2026-11-03, the Mac report supplies **one paired
instantaneous Three.js counter snapshot**, not a timing benchmark:

- Runtime 373ad77c, Chrome/WebGL2, reported size 2056×1066.
- Same camera: zoom 22.7, pitch 54, bearing 12; reported scene distance 14.56 m.
- One synthetic attendee in the local test harness.
- OFF→ON: draw calls 91→101 (**+10**); triangles 110866→110986 (**+120**).
- Counts exclude MapLibre. No FPS, raw frame intervals, memory or sustained
  distribution was collected. DPR and CSS-versus-buffer size details are not
  provided in this snapshot's reported conditions.

These are observed counters, not estimates. They establish neither a frame-rate
regression nor a performance pass. **Paired FPS/frame-interval measurements,
sustained draw-call distributions and physical-mobile performance remain open.**
Do not fill missing values with zero or infer timing from mesh counts.

The measured source must identify runtime commit
`373ad77c37797d63775f901eb8bd20f7f3aec7dd` and main151
`d4521aa70467fb2e18705dcd26816ba482ec3892`, or an explicitly newer tested runtime.
A documentation-only descendant does not change the runtime identity. The latest
Mac functional report covers freshness/replay/disable behavior and the limited
counter snapshot above; the earlier 821843c report covers other visual/failure/
layout scenarios. Neither report is a timed paired performance benchmark.
See [README](README.md) for their separate scopes.

## Existing instrumentation and its limits

- `?perf=1` in `src/ui/perf.ts` samples requestAnimationFrame (RAF) intervals and
  shows a frame-weighted FPS estimate plus the worst recent interval. This is
  browser scheduling/frame cadence, **not GPU execution time** or a p95 result.
- `window.__world.getMetrics()` exposes `frame`, `fps`, `drawCalls` and `triangles`.
  In `src/main.ts`, the latter two come from `renderer.info.render` immediately
  after the Three.js render. They exclude MapLibre draws on the same WebGL canvas.
  Name them `threeDrawCalls` and `threeTriangles` in any new result.
  The full getter also computes actor/bounds information. Avoid calling it every
  frame during a timing run; use lightweight RAF collection and sparse counters,
  or a separately verified lightweight hook in the review harness.
- `window.__world.perf.report()` returns a rounded 30-second FPS average/minimum
  and worst interval, but **does not export raw intervals or draw calls**. A single
  screenshot or copied report cannot establish a p95 or sustained paired draw-call distribution.
- `scripts/perf.browser.js` checks overlay and DPR behavior with an emulated
  viewport. Its assertions are not physical-mobile performance results.
- `scripts/device-benchmark.mjs` already collects raw RAF/visibility/source
  evidence for the separate D-04 protocol. It does not toggle the campfire and
  cannot silently become a campfire A/B collector.

Three.js resets its statistics at render-call boundaries by default. Changing
autoReset, adding render passes or instrumenting the shared context changes the
measurement contract; record such changes instead of calling the numbers whole-
page GPU work. [Three.js renderer statistics](https://threejs.org/docs/pages/WebGLRenderer.html#info)

## What can run without a connected Chrome session

From `app/`, `node scripts/device-benchmark.mjs --prepare` runs successfully with
no browser/device connection. It prints the collector's required arguments. Source
inspection, asset/collector tests, fixture preparation and statistics validation
can proceed offline. **None of these steps collects performance.**

The current cloud executor has no verified hardware GPU device. Its prior
Chromium launch was blocked; no security restriction was bypassed or browser
connection invented. A CPU/SwiftShader result here would describe software
rendering, not the Mac or phone, even if a browser launch later succeeds.

An authorized operator can measure a visible page on the actual Mac using its
existing approved task browser and DevTools even when assistant browser automation
is disconnected. Alternatively, reconnect the existing exact task target to the
approved collector. Confirm the target and hardware first; do not select an
arbitrary tab or alter personal profiles, authentication or security settings.
The local functional harness must expose its existing `world.campfireVisual`
controller. Production `window.__world` does not expose that handle and there is
**no implemented `?campfire=1` switch**. Do not invent one in reproduction steps.

A separately authorized hardware-GPU headless host can provide a secondary
synthetic comparison with actual renderer/backend details recorded. Chrome's
headless mode supports automated browsing, but a headless/software run does not
satisfy the existing visible-device or physical-phone reference.
[Chrome headless documentation](https://developer.chrome.com/docs/automation-and-testing/headless)

## Paired full-scene ON/OFF procedure

This is a proposed collection protocol, not an executed result or a new approved
performance threshold.

1. Pin actual served app/GLB bytes, runtime commit and harness changes. Use the
   existing approved local product harness, same foreground browser/device,
   viewport, DPR, power mode, camera, map style/tiles, actor count/poses, arrival
   state and network/cache policy for both legs. Record fixture-backed data as
   such; do not call it live backend evidence. Leave automatic camera tours OFF.
2. Verify OFF restores the original fire. Verify ON finishes loading and visibly
   renders only the intended replacement with the real scene-distance provider.
   Record actual distance, LOD, attendance and errors. An invisible/failed ON leg
   cannot count as an inexpensive enabled effect.
3. Separate initial load from steady state. For steady state, load both variants
   once, settle assets/tiles and warm each condition for at least 15 seconds.
   Record an explicit precondition rather than pretending profile caches are
   equal. Report first-enable fetch/parse behavior separately if measured.
4. For the primary near-view attended/sparks case, collect three paired 30-second
   OFF/ON windows, alternating pair order (OFF→ON, ON→OFF, OFF→ON).
   Keep the page visible and record every RAF timestamp/interval plus independent
   visibilitychange events. Retain zero-frame one-second bins and interruptions.
   Store rendered-frame counter start/end and sparse (for example once per second)
   Three draw/triangle samples with timestamps. Do not call the expensive full
   metrics getter each frame, drop slow samples, interpolate missing windows or
   profile only a detached asset.
5. Add one diagnostic pair each for near-idle, mid, far and >200 m hidden states,
   keeping camera/population fixed within each pair and labeling actual LOD.
   Hidden geometry is not the enabled visible-effect benchmark. Preserve animation
   and expected attendance. Keep raw failed/hidden/changed-state legs and explain
   why they cannot be compared; do not silently remove them from the evidence.
   This initial plan has about 10.5 minutes of warmup/timed legs, plus setup.
   Reset/replay the same documented attendance fixture sequence for every leg:
   one seeded snapshot expires after 60 seconds, shorter than a 90-second pair.
   Preserve the normal transport/replay clock semantics and label synthetic data.
   Never renew stale live evidence artificially just to keep sparks visible.
6. Report frame-weighted FPS, one-second FPS distribution, median/p95/p99 raw
   frame interval, worst interval, Three draw-call/triangle median and maximum,
   each pair's ON-minus-OFF delta and run-to-run spread. RAF intervals must be
   named frame intervals, not GPU milliseconds. Inspect errors and the raw data.
7. If a slowdown needs diagnosis, collect a separate Chrome Performance trace.
   Label profiler overhead; do not mix traced and untraced legs. Retain the trace
   with the measurements and inspect CPU/rendering work rather than guessing a
   GPU bottleneck. [Chrome runtime profiling](https://developer.chrome.com/docs/devtools/performance)

Required artifact fields: source/harness/asset hashes; device and OS; browser
version; renderer/backend; visible/headless/emulated status; viewport/native and
applied DPR; camera/distance/LOD; actor/attendance state; warmup/sample durations;
network/cache policy; per-frame raw values; visibility/error/cleanup records;
paired summaries; and before/after screenshots. Missing fields stay unknown.

If GPU execution duration is separately required, CPU wall time around
`renderer.render()` is insufficient. Use a supported asynchronous
`EXT_disjoint_timer_query_webgl2` query with explicit pass scope. Poll temporarily
unavailable results asynchronously; reject disjoint or never-completed samples
and record the timeout policy. A Three-only query still excludes MapLibre and
compositing. Do not block rendering with `gl.finish()` or busy polling.
[Khronos timer-query contract](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)

## Existing device acceptance is separate

[DEVICE_ACCEPTANCE.md](../../docs/DEVICE_ACCEPTANCE.md) records the approved
MacBookPro18,2 visible 210-second manual-story route at applied DPR 1.5 and its
desktop median ≥55 FPS / p95 interval ≤33 ms gates. The physical SM-S918N route
uses its own ≥30 FPS / ≤50 ms and measured-memory comparison requirements.
Those historical measurements predate this campfire change. Reuse the protocol
for a broader regression when appropriate; do not reuse its old numbers as new
campfire results or apply its eight-character draw budget to a different actor
population. A 390×844 Mac emulation remains layout/functional evidence only.

Until actual paired measurements and the relevant device review exist, retain
the feature OFF, PR Draft and issue #131's performance acceptance as pending.
