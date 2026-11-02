# Live scene projection — I-09

The `Live world` mode projects the server's shared snapshot and recorded events. `Story · scripted` retains the original eight-character 3:30 story, state and dialogue. This document describes the renderer, not a production or physical-device acceptance.

## Data and identities

- `main.ts` passes the same successful `world-panel.ts` poll to `makeLiveScene.accept(world, events)`. There is no second world decision loop, new model call or write endpoint in the renderer.
- `LiveProjection` copies one snapshot/version, refuses older in-flight replies, deduplicates event IDs and holds future-tick events until a matching snapshot arrives. Scene frames, map pins, selected cards and inventory/owner summaries use server Muse IDs. A name is never used as the binding key.
- The original actors are reused by variant ID, and Ember/Copper are added from the existing shared kit. Ten IDs stay independent across modes, reconnects, animation seeks and LOD swaps.
- Map and actor poses use the exact same MapLibre Mercator transform, including outside the commons. Walking/bus progress comes from server depart/arrival times. Taxi stays at its origin until the recorded arrival time; no client move or reward is executed.
- Events are presented at their recorded time + 12 s (one world poll is 10 s), ordered by tick/sequence. This is a visual delay only. It never changes the authoritative inventory or event source.
- Pins/card metadata carry snapshot version, Muse ID and inventory. Public UI shows the Muse, owner, activity, inventory and event source. Private meetup choices or reasons are never used by the projection.

## Posture, props and effects

Beat bundles are sequenced on a local clock derived from their server `startedAt`. Seated speech overlays Spine/Chest/head/arms onto `sit_idle`; Root/Hips/legs remain in the posture clip. The blend's actions do not share bone tracks. The actual rig test checks phase and bone pose through all three LODs and backwards/forwards seeks.

Pairs face each other; contact cues use the authored 0.9 m distance and clip contact frame. A handoff has one holder before contact and the other after it. If the partner is elsewhere or the contact slot is occupied by a third Muse, contact becomes a named wave fallback; another body is not overlapped. Shared item props are requested separately from full-detail upgrades. An unavailable item model or loading prop is an explicit item-card fallback.

The four effects are ring instances: teleport (blue), item appearance (gold), stamp (green), and trade lock (purple). They add no new textures or character assets. A recorded event is required; a renderer frame cannot grant a reward.

| Event | Clips | Event item fields | Effects | Visual | Behaviour / fallback |
|---|---|---|---|---|---|
| encounter | fist_bump / fist_bump | — | — | complete | both turn to each other 0.9 m apart and touch fists at the clip contact frame |
| cards_verified | nod / nod | — | — | complete | both nod after the Agent Card check |
| greet | talk / listen | — | — | complete | speaker talks with the greeting in a bubble, the other listens; seated Muses talk over sit_idle (blend) |
| encounter_reply | talk / listen | — | — | complete | the answering Muse talks, the other listens |
| trade_proposed | offer_item / think | give | — | complete | offer_item holding the offered item; the other thinks |
| trade_rejected | head_shake / listen | — | — | complete | the declining Muse shakes its head (no reason shown) |
| trade_completed | handoff_give / handoff_receive → handoff_receive / handoff_give → celebrate / celebrate | give, want | trade_lock | complete | two synchronized hand-overs (the item moves hand to hand at contact frame 32), then the trade-lock glow |
| gift | handoff_give / handoff_receive → idle_breathe / celebrate | item | item | complete | hand-over with the gift, then the receiver celebrates with the item-appear effect |
| discover | pick_up | item | item | complete | pick_up; the found item appears (stamp effect too when a place stamp was found) |
| craft | celebrate | item | item | complete | celebrate with the item-appear effect |
| arrive | idle_breathe | — | teleport | complete | teleport arrival only (Taxi Token): teleport effect at the arrival slot |
| spotlight | think | — | — | complete | the spotlight Muse thinks with its decision line in a bubble |
| gathering | clap | — | — | complete | every Muse in data.muses claps at the campfire |
| postcard_sent | write_note | item | — | fallback | the sender writes; postcard artwork is an item card, with no invented delivery |
| postcard_delivered | celebrate | item | item | fallback | the recorded recipient celebrates; the postcard is shown as an item card |
| trade_countered | think / listen → offer_item / think | give | — | complete | a thought then the revised offer, with a card for an item without a model |
| meetup_proposed | talk / listen | — | — | complete | the public proposal only; no private candidate details enter the scene |
| meetup_confirmed | celebrate / celebrate | — | item | complete | both celebrate the recorded agreement; its private time and place are never displayed |
| campfire_invite | wave | — | — | complete | the inviter waves; travel is still driven only by the server snapshot |
| campfire_gathering | clap | — | — | complete | every recorded participant claps, including the reviewer and demo peer Muses |
| help_requested | offer_item / think | item | — | complete | the requested item is offered as a prop or a named card |
| help_input_required | think | — | — | complete | the helper waits for input; nothing is completed by the animation |
| help_completed | celebrate / celebrate | — | item | fallback | both celebrate; the result stays a named inventory item, with no unsupported repair animation |
| impostor_rejected | head_shake | — | — | complete | head shake after the recorded identity rejection |
| injection_blocked | head_shake | — | — | complete | head shake only; the injected text is never echoed |

Further fallbacks: unknown beat clips use `idle_breathe`; a bus uses `bus_sway` along its recorded route with no invented bus model; a seated character interrupted by a full-body cue stands directly, with the missing transition stated in the selected card. Assets unavailable at startup remain a character-kit error rather than a claimed complete ten-character render.

## LOD, assets and ownership of resources

- No model/texture/animation/manifest bytes are changed. Existing manifest hashes, rig digests, runtime triangle/draw checks and support-foot/contact checks remain the asset evidence; this change does not claim a new glTF Validator execution.
- Ten-character mode applies the same LOD selector, keeping LOD0 at a maximum of two. Its draw/triangle measurement is reported separately from C11's eight-character `draw ≤90` acceptance. It does not extend the eight-character budget without measurement.
- All 13 manifest runtime files total 15749092 bytes (15.02 MiB). Clips are derived by the existing build script. Geometry/textures/material maps are shared by `MaterialLibrary`; the two added characters use their existing attachments. Four instanced ring effects have no texture allocation.
- The adapter owns labels, the two extra actors/shadows and four effect meshes. `dispose()` removes those resources. It installs no timers, global listeners, fetches or polling loops. The existing world-panel GET polls remain the data owner; replay isolation still gates those polls. Pause view freezes presentation time, pins and the accepted snapshot while the server and GET collection keep running; resume refreshes and catches up without a write.
- Mode changes only toggle presentation. Live mode hides scripted bubbles; returning to story restores the original actor set, clears carried live props and hides extra actors/effects. Polling while a story is visible does not make that story live.

## Verification

- `scripts/live-scene.test.mjs`: deterministic poses, all ten IDs/owner/inventory, exact Mercator alignment, ETA/Taxi, deduplication, future-tick exclusion, handoff ownership/contact distance, seated speech, fallback, actual-rig blend/LOD/seek and the renderer adapter using locally parsed real GLBs.
- `scripts/live-scene.browser.js`: local read-only GET fixture integration for ten IDs/pins/cards, source/mode transitions, travel, 10-character render counts, 390×844/360×640/1280×800 layout, zero writes and application exceptions. Browser result must be recorded separately after execution.
- Existing `scripts/character-kit-runtime.test.mjs`, `scripts/actions.browser.js` (explicit Story mode for direct asset/contact manipulation) and the rest of `npm run check` remain regression checks. Runtime/browser/production/physical-device results are distinct.

The browser fixtures prove the rendering contract with fixed inputs. They are not a personal Muse connector receipt, live model proof, operating deployment receipt, or S3/device acceptance.

## Local execution receipt (2026-11-02)

- `live-scene.browser.js`: 26/26 read-only fixture assertions, application exceptions 0, writes 0, Chrome 156.0.8078.76, macOS arm64. Includes ten actors/pins/cards, source and story return, exact geographic pose, direct selection of the added Copper actor, server ETA, stale reply rejection, pause, and three viewport sizes.
- Evidence: `/private/tmp/musely-i09-browser-complete-20261102/results.json` and its `output/live-scene-*.png` files. An earlier browser run found horizontal overflow at 390 px and a pause that kept animating; those failures were preserved before their passing reruns.
- This is local fixture evidence. No production POST, connector call, deployment or physical-device claim was made.

- Existing `actions.browser.js`: 24 clips × LOD2/LOD0 = 48 cases passed; page exceptions 0. This executes the original geometry/support-foot/socket/partner-contact assertions in explicit Story mode, without weakening an assertion. Evidence: `/private/tmp/musely-i09-actions-20261102/results.json`.
- The ten-character fixture measurement was 93 layer draw calls and 76,808 triangles. Its short headless FPS sample is not the 210-second baseline-device performance gate; D-04 must measure that separately.

## Integration API

- `makeLiveScene(host, project?)`: `host` supplies the existing scene, actors, roots, shadows, selection, material library, shadow texture and `ambient(t)`. `project(Vector3)` returns screen `{x,y}`. The adapter adds only missing variant IDs.
- `.ready: Promise<void[]>` resolves after the missing light actors are available (individual failures are reported in metrics); full LOD/prop upgrades continue independently.
- `.accept(world: LiveWorld, events: readonly LiveEvent[]): boolean` accepts one non-stale server snapshot. `.setActive(boolean)` changes presentation, `.update(at: number, selectedId?: string)` applies the local pose at milliseconds since epoch, `.getMetrics()` reports version/IDs/owner/inventory/frame/loaded LODs/prop status, and `.dispose()` removes owned resources.
- `.projection: LiveProjection` exposes the read-only copied `world`, deduplicated `events`, and `frames(at): Map<string, ActorFrame>`. It accepts no network/model/command executor.
- `mountWorldPanel(map, {onWorld?, onSelect?, isLive?, paused?})` adds optional presentation callbacks. Existing callers without options remain valid. `onWorld` receives the accepted snapshot plus the collected event tail; a replay still blocks polls through the existing isolation flag.

Final source check: `npm run check` 342/342, typecheck, build and Worker dry-run exit 0. `preview/` and all character-kit asset bytes remain unchanged. All work is on the original `156a078` base; rebase/integration onto the later main must be verified by the coordinator.


### Publication clock

The world stores `data.publishedAt` on each committed event after asynchronous model work finishes. It preserves the business timestamp `at`. Cue scheduling uses `max(at, publishedAt) + CUE_DELAY_MS`, allowing the next ten-second poll to receive a slow heartbeat before its gesture starts. Older records without publication metadata use `at`. Replay retains this public timestamp and includes the final cue window. Selecting any live portrait focuses that actor’s projected server position, including places outside the commons.
