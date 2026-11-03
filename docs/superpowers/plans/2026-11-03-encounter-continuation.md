# Encounter-led personal life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make say_hello the beginning of a new meeting, returning real context for the personal Muse to choose what interests it next.

**Architecture:** Record a symmetric introduction on the two immutable Muse IDs in the signed commit. Share one read-only public opportunity builder between world, heartbeat and hello results. The actual personal runtime decides subsequent activity; this server never substitutes its own model or a fixed follow-up sequence.

**Tech Stack:** TypeScript, existing Worker/SQLite command pipeline, Node24 TLS fixtures, checkpoint replay.

**Spec:** `docs/superpowers/specs/2026-11-03-living-world.md`, clarified directly on 2026-11-03: say_hello starts meeting a new Muse, then that Muse thinks for itself and finds something new.

## Global Constraints

- Preserve existing greet for ordinary conversation. say_hello requires a nearby stationary recipient, optional public opener, existing scope/signature/nonce/version/commit-time authority checks.
- No automatic reply/trade/movement/model call/scheduler. Do not claim actual autonomous runtime completion from a tool response or fixture.
- Introductions are recorded protocol history, not an inference that no historical unrecorded meeting ever happened.
- Preserve credentials, active personal key, reviewer key, account state, frozen a31/observations, preview/, original failures and old replay evidence.
- The independent UI plan owns main.ts/onboarding.ts/style.css and UI browser callbacks. This plan does not edit those files or build dist until the UI implementer returns ownership.

## Review Focus

- Both parties/key rotations/restarts must not repeat a first hello, while the exact same command retry returns its first result.
- The new recipient context must stay server-structured; peer text stays untrusted, and no peer private memory or owner location enters it.
- New-contact lookup cannot cause an action before signed commit or after revocation/travel/range changes.
- Hello must make open-ended opportunities available without choosing or inventing the next action.
- Engine version change must rotate recording and keep exact historical engine3 and engine2 checkpoint tuples readable.

### Task 1: Record the first meeting and return continuation context

**Files:** `app/worker/core/encounters.ts` (new); `app/worker/core/mcp-tools.ts`; `app/src/engine/world.ts`; `app/src/engine/inbox.ts`; `app/worker/core/run-log.ts`; `app/scripts/say-hello.test.mjs`; `app/scripts/encounter-continuation.test.mjs` (new); existing directory/run-log compatibility tests.

**Interfaces:** `encounterOpportunities(state: WorldState, museId: string, now: number)` returns public current place, nearby not-yet-introduced stationary peers and allowed nearby places. `startIntroduction(state, from, to, at)` records symmetric `{id,at,place}` metadata and public factual memory; caller checks preconditions within the signed commit. `MuseState.introductions?` maps peer IDs to that metadata. `Message.encounter?` carries only encounter ID/place/first_contact. `messageView` returns that typed context separately from wrapped peer text.

- [ ] Write real TLS/SQLite tests: required recipient; first hello marks both parties and gives encounter/opportunities; sender and recipient heartbeat expose real next opportunities; no fixed action or generated reply; new-command repeat and reverse hello refused, exact duplicate once; travel/range/self/injection/revocation/stale guards; key rotation/restart persistence; no private memory/credential/precise location leaks.
- [ ] Run targeted tests on commit30a; expected RED: missing required-target semantics, durable introduction and continuation fields.
- [ ] Implement shared pure public context and atomic introduction metadata, update hello/get_world_state/heartbeat/messageView and snapshot allowlists. Existing greet stays unchanged. First-contact checks belong inside signedWrite so stored-command replay remains idempotent.
- [ ] Run targeted tests; expected GREEN with real messages/events/metadata and no invented follow-up effects.

### Task 2: Preserve historical playback and document the corrected tool

**Files:** `app/src/engine/world.ts` version constant; `app/src/replay/player.ts`; `app/scripts/run-replay.test.mjs`; `app/scripts/run-log.test.mjs`; `app/static/mcp-docs.html`.

**Interfaces:** ENGINE_VERSION='engine-4'; currentVersions retains existing catalog/harness hashes. Explicit historical engine3 tuple (run-log-2/engine-3/harness-c0c69e98b5e8/catalog-c7068bfa0238) and existing exact engine2 tuple remain checkpoint-readable without a live executor.

- [ ] Write a replay regression for the exact engine3 tuple plus mismatched tuple refusal and new-introduction checkpoint preservation; watch RED before compatibility change.
- [ ] Add engine4 version and exact engine3 compatibility tuple, preserve engine2 support and existing bounds/hash validation. Update the intentional engine-version assertion.
- [ ] Update public tool reference: required to, recorded first contact, repeat refusal, structured continuation and own-runtime decisions. No zero-argument broadcast example remains for say_hello; greet remains the public conversation tool.
- [ ] After UI ownership returns, run full Node24 app check (tests/types/build/dry-run) and independent whole-change review. Fix important findings with RED→GREEN, then preserve final source/evidence. No deployment or runtime autonomy claim from localhost tests.
