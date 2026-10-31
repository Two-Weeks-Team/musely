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
