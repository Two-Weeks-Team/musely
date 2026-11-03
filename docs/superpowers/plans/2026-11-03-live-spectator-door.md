# Live spectator and door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First visitors see the live 3D world immediately and choose the door when they want to bring their Muse.

**Architecture:** Reuse the live scene, map and public polling. Default to world mode near the commons. Keep the staged walkthrough behind an explicit preview flag; the ordinary door shows honest connector guidance and never fabricates completion.

**Tech Stack:** TypeScript, existing Three/MapLibre assets, CSS, existing Playwright browser callback harness.

**Spec:** `docs/superpowers/specs/2026-11-03-living-world.md`

## Global Constraints

- No worker/engine/identity/key/permission/API changes, `preview/` changes, production calls or shared-browser changes in this UI task.
- General personal registration and server join receipts remain a separate implementation; no button, clipboard copy, local storage or timer can declare joined.
- The door glows gently until a future genuine own-actor entry confirmation. This increment has no such receipt, so keeps the invitation active and does not claim full onboarding.
- Preserve Story as explicit `?autoplay=1` or the existing Story controls and preserve labelled local harness trials.

## Review Focus

- Anonymous navigation must not open registration/permission panels or issue writes.
- Zooming out must not resurrect the large welcome overlay.
- Opening/closing/retrying guidance must keep the invitation and not create staged success.
- Reduced motion must keep a static highlight and no pulse animation.
- 390x844 and desktop must retain map/door/close controls, focus return and the same scene identity.

### Task 1: Make watching the default and the door an honest invitation

**Files:** `app/src/main.ts`, `app/src/ui/onboarding.ts`, `app/src/style.css`, `app/scripts/live-entry.browser.js`; compatibility query changes only in `app/scripts/entry.browser.js`, `app/scripts/walkthrough.browser.js`, `app/scripts/welcome-layout.browser.js` if their old Story/staged expectations require it.

**Interfaces:** Existing `mountOnboarding({onWatch,initial})` remains usable. Default guide is real setup instructions; old timer is reachable only with explicit `entryPreview=1`. No endpoint/receipt is invented. Public setup copy includes musely.net/mcp, secure credential entry and the Muse's own choices after say_hello; never copies a secret.

- [ ] Write a browser callback covering default world/no modal, close camera framing, no welcome overlay after zoom-out, door animation after open/close/guide waiting, no fake joined state, reduced-motion static invitation, focus return and unchanged scene IDs. Use local fixture routes for reads and label them as UI evidence, not live/Muse proof.
- [ ] Run against the unchanged built app and record expected RED (default Story/missing door). Own headless test browser only; close owned process/context.
- [ ] Change default autoplay to explicit opt-in and frame the commons for world mode. Watch returns to world, not Story. Hide the welcome overlay in ordinary world navigation.
- [ ] Add a small door glyph with a roughly44px hit target, continuous4s subtle glow, visible static reduced-motion state, accessible name/expanded/controls and Escape/focus return.
- [ ] Show actual operator-assisted connector guidance for now, preserving honest limits. Ordinary guide contains no timer-success button. Put the old staged path behind `entryPreview=1` and label that preview.
- [ ] Run browser callback GREEN, applicable legacy explicit-preview callbacks and `npm run typecheck`/`npm run build`. Root will run the combined full suite/dry run and independent review after all owned edits settle.

No commit/push/merge/deploy by the delegated implementer. Return file list, RED/GREEN evidence, limitations and ownership ACK to root.
