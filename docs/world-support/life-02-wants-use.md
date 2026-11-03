# Life-02: wants to verified use

Related: #133; depends on Life-01 #132 and runtime integration #134.

## Implemented here

`app/src/engine/wants-use.ts` is an opt-in deterministic planning/verification module. It has no model, scheduler, storage, network, signed command or mutation side effects. `publicNeed` preserves declared-vs-inferred distinction and only copies existing public wants. Private motives never enter the plan. Peer language is explicitly untrusted data, not instructions.

`planUse` finds missing prerequisites for existing craft beats and uses existing `checkTrade` to propose mutually requested inventory exchanges. It never accepts, counters, rejects or commits an exchange on anyone's behalf. The executor must re-read the current version and authority before using existing signed trade/activity tools. Cancellation, deadline, paused delegation, ongoing activities, expired items, history integrity and permanent personal actor ownership block unsafe proposals. A connected or disconnected personal Muse is not assigned a resident policy.

`verifyUse` distinguishes acquisition from realized benefit using before/after engine state, actual craft event, item consumption, output delta and chained history. The caller must supply authoritative snapshots/events, not model or peer JSON. Mark the goal fulfilled durably in the same serialized runtime transaction, keyed by goal ID and returned event ID; a pure verifier is not a replay-protection database. Existing trade engine handles trade idempotency and current locks. Item effects are read from the existing catalog; a story scroll or reading list has no invented executable power.

## Evidence

Base main: bd6d9d5bab9a6c3e5653ed1b195e76f16b67d21b (2026-11-03).
Node 24.22.1: `node --test scripts/wants-use.test.mjs` — 16/16 passed. Includes existing `commitTrade` followed by real pure-engine `tick`: coffee exchanged for Garden Pass, Clover Seed consumed, Bloom crafted, Garden Pass kept, rule event plus chain evidence. This is deterministic local simulation, not a real model decision, TLS client acceptance, real personal Muse, browser result or deployment.

TypeScript 7.0.2 strict isolated module dependency check passed:
`node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --strict --skipLibCheck src/engine/wants-use.ts`

## Known risk discovered, not silently fixed

The existing `world.ts` `finishBeat` can craft after required ingredients disappear between start and completion. The regression exercises that case; this module refuses to attribute it as fulfilled (`lost_prerequisite`). It does not repair the underlying inventory mutation. Before runtime activation, the main engine must revalidate beat prerequisites/expiry and consume atomically at completion. This PR avoids concurrent edits to shared world runtime; coordinate that fix with the main team.

## Remaining integration gate

- Life-01 interface and opt-in persistence/serialized scheduler are not finalized; no imports from its unmerged branch.
- Wire proposals through existing command/consent gates without overriding personal Muse decisions; do not call raw `commitTrade` as an authority bypass.
- Provide dialogue/question delivery through existing protected messages and distinguish refused/expired/withdrawn agreements. Current module only proposes structured intent.
- Persist goal evidence idempotently, verify privacy snapshot allowlists, then local TLS signed-tool journey and real personal-runtime observation.
- Main/CI exact commit results must be checked separately; no automatic merge or deployment.

## Design references (inspiration, not reproduced results)

[Generative Agents](https://arxiv.org/abs/2304.03442): separate observations, memory and plans. [CICERO](https://ai.meta.com/research/cicero/): negotiation must connect intentions and actions. [Voyager](https://voyager.minedojo.org/): actions require environmental feedback. Here this means public declarations are not facts about private motives, agreement is not execution, and an acquired item is not a demonstrated benefit.
