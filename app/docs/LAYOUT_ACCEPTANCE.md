# D-04 layout acceptance (2026-11-02)

This is viewport/layout evidence on local built main `ce3a7d8`, using fresh headless Chrome contexts and deterministic read-only API fixtures. It is separate from the approved physical-device FPS/PSS comparison, which has not started for this candidate. No user Chrome session, phone state or preview source is changed.

## Regression and fix

Before the fix, at 360×640 the wrapped header ended at 224.3 px, but the welcome began at 125 px and ended at 521.0 px; the footer began at 460 px. The welcome overlapped both. At 390×844 it also overlapped the wrapped header. Merely moving it below the header would still run into the footer on the short phone.

`style.css` now uses the existing measured header/footer heights to bound the welcome. At short heights its contents scroll within that panel, including by keyboard focus, while header/footer controls retain their space. Desktop keeps its original 150 px top minimum. No card, character, asset, animation or application state logic is changed.

## Actual browser results

`scripts/welcome-layout.browser.js` passes **71/71** checks at 360×640, 390×844 and 1440×1000 (DPR cap 1.5). Each test context is new and closes after its run. The callback uses the built local product, real map/WebGL rendering and local GET fixtures for world/status/location; non-GET API requests are aborted and counted. Observed application exceptions: 0. API writes attempted: 0.

The checks cover welcome/header/footer separation, document horizontal overflow ≤1 px, scroll and hit testing of both welcome buttons, actual entry-choice opening/closing, Tab/Enter activation of Find my Muse and close-up card appearance, the card's clearance, actual Follow behavior, unobscured pause/zoom/Bay/World/mode controls, World popover bounds and real Story→World transitions. Initial welcome and post-transition screenshots are captured for every viewport. On 360×640, welcome text/actions are reachable through internal scrolling; the whole document stays fixed in the viewport.

The original `scripts/layout.browser.js` remains byte-for-byte unchanged, preserving its 30-size/grid/timezone assertions. This focused pass does not claim that older full matrix was rerun. Physical mobile screenshots, production rendering, fixed-release 210-second FPS/PSS measurements and memory-budget acceptance require their own evidence.

## Device acceptance remains separate

The approved later comparison uses MacBookPro18,2 and Galaxy S23 Ultra/Android 16, DPR cap 1.5, the same fixed 210-second path and the approved relative memory budget (allowed increase = max(20% of baseline, 64 MiB)). This layout pass does not start that measurement or establish its acceptance. Freeze and identify the integrated release before measuring it, as directed by the coordinating task.

Local full check on this layout candidate: **390/390** tests, TypeScript, production build and Worker dry-run pass (exit 0). This does not change the separate physical-device acceptance status.
