# Life-02: wants to verified use

Related: #133; depends on Life-01 #132 and runtime integration #134.

## Implemented here

`app/src/engine/wants-use.ts` is an opt-in deterministic planning/verification module. It has no model, scheduler, storage, network, signed command or mutation side effects. `publicNeed` preserves declared-vs-inferred distinction and only copies existing public wants. Private motives never enter the plan. Peer language is explicitly untrusted data, not instructions.

`planUse` finds missing prerequisites for existing craft beats and uses existing `checkTrade` to propose mutually requested inventory exchanges. It never accepts, counters, rejects or commits an exchange on anyone's behalf. The executor must re-read the current version and authority before using existing signed trade/activity tools. Cancellation, deadline, paused delegation, ongoing activities, expired items, history integrity and permanent personal actor ownership block unsafe proposals. A connected or disconnected personal Muse is not assigned a resident policy.

`verifyUse` distinguishes acquisition from realized benefit using before/after engine state, actual craft event, item consumption, output delta and chained history. The caller must supply authoritative snapshots/events, not model or peer JSON. Mark the goal fulfilled durably in the same serialized runtime transaction, keyed by goal ID and returned event ID; a pure verifier is not a replay-protection database. Existing trade engine handles trade idempotency and current locks. Item effects are read from the existing catalog; a story scroll or reading list has no invented executable power.

## Evidence

Base main: bd6d9d5bab9a6c3e5653ed1b195e76f16b67d21b (2026-11-03).
Node 24.22.1: `node --test scripts/wants-use.test.mjs scripts/craft-completion.test.mjs scripts/craft-replay-compat.test.mjs scripts/run-log.test.mjs scripts/run-replay.test.mjs` — 73/73 passed across Wants, craft completion, version, run-log and replay checks. Includes existing `commitTrade` followed by real pure-engine `tick`: coffee exchanged for Garden Pass, Clover Seed consumed, Bloom crafted, Garden Pass kept, rule event plus chain evidence. This is deterministic local simulation, not a real model decision, TLS client acceptance, real personal Muse, browser result or deployment.

TypeScript 7.0.2 strict isolated module dependency check passed:
`node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --strict --skipLibCheck src/engine/wants-use.ts`

## Consumed-material fix and replay boundary

`finishBeat` now checks the entire consumed-material multiset before mutation. A missing ingredient cancels without partial consumption or craft. Duplicate quantities count correctly both in execution and the benefit verifier. `Beat.needs` remains a START condition: moving or expiring a nonconsumed Garden Pass does not cancel an activity already started. Existing pause/history-integrity protections remain.

Engine content version becomes engine-5. The exact historical engine4/3/2 tuples remain checkpoint-readable. Tests use SYNTHETIC present-day fixtures labelled with historical version tuples and assert full state, snapshot hashes and original header preservation. They do not constitute a captured real engine-4 run, historical-production replay or execution of an old engine. Such real historical evidence remains unverified.

Run-log fixtures previously defaulted to a real model URL with key='k' and no fake fetcher. Offline fixtures now default model:null; model tests supply an explicit fake transport. Both log/replay suites install a fail-closed fetch guard and assert zero unintended external requests. Initial execution was rejected; only after this safety correction did formal re-review permit the 73-test run. No real provider data was requested.

## Remaining integration gate

- Life-01 interface and opt-in persistence/serialized scheduler are not finalized; no imports from its unmerged branch.
- Wire proposals through existing command/consent gates without overriding personal Muse decisions; do not call raw `commitTrade` as an authority bypass.
- Provide dialogue/question delivery through existing protected messages and distinguish refused/expired/withdrawn agreements. Current module only proposes structured intent.
- Persist goal evidence idempotently, verify privacy snapshot allowlists, then local TLS signed-tool journey and real personal-runtime observation.
- Main/CI exact commit results must be checked separately; no automatic merge or deployment.

## Design references (inspiration, not reproduced results)

[Generative Agents](https://arxiv.org/abs/2304.03442): separate observations, memory and plans. [CICERO](https://ai.meta.com/research/cicero/): negotiation must connect intentions and actions. [Voyager](https://voyager.minedojo.org/): actions require environmental feedback. Here this means public declarations are not facts about private motives, agreement is not execution, and an acquired item is not a demonstrated benefit.

## Customer journey increment

The actual in-process WorldDO / MCP handler / signed-command path now tests public Wants, greeting, counteroffer, accepted exchange and immediate Bloom craft. A real bug was reproduced: the verifier required a running beat and rejected a successful direct MCP craft. It now recognizes trusted committed craft-tool provenance plus inventory/chain evidence. This is not independent verification of arbitrary JSON signatures. A second bug selecting an earlier craft from full history was fixed by matching newer ledger evidence with the event.

Seven authenticated-path tests include rejection, task expiry, delegation revocation, concurrent craft idempotency, actor argument spoofing, injection rejection, missing provenance and repeated craft attribution. The local fixture supplies only Cloudflare base/storage/alarm hosting, test claim setup and ephemeral test credentials. No actual HTTP server/TLS, provider authentication, external personal Muse, AI-decided negotiation, persistent goal executor or deployment is established. Calls are manually selected by the test. Network is blocked and unexpected calls must remain zero.

Main7a85add, PR138acf8024 and PR14011a1c5 were read for integration boundaries; test composition is not a merge. Existing app/runtime authority remains in charge. Production activation is still off.

## Personal refusal attribution

Failed rule proposals to a personal/connected recipient now emit `trade_refused` attributed to the proposer with no speech and recipientDecision=not_requested. The world must not fabricate the personal recipient saying “Not this time.” Three regressions preserve real resident rejection and pending valid personal proposals. This is an engine5 candidate fix, not a new personal decision policy.

## Feature-OFF model and persistent goal bridge

`worker/core/resident-wants-model.ts` adds `prepareResidentTrade(context, goalId, taskId)` and `ResidentGoalStore`. This is NOT a production scheduler or an executor. `enabled` defaults false. No WorldRuntime/WorldDO caller is added. Integration belongs to #134 after #132 shared runtime ownership coordination.

Context requires authoritative current world/clock/ownership readers, the SAME runtime model-slot allocator and Ledger, existing ModelConfig, and the goal store. Only positive registered resident harness actors excluding legacy/personal/unknown/connected/paused actors may be considered. A pending trade must actually await that resident. Existing `validate/buildMessages/checkOutput`, trade response schema and `callModel` are reused; prompt context comes from the canonical beat recipe (required/consumed items, output, eligible places and current missing items), not private reasons or peer instructions. Unknown dynamic peer harnesses fail closed until owning-team identity/model context supports them. Output wording is not sent or persisted.

A deterministic hashed reservation ID prevents repeat provider calls. Existing maximum/actual/failure costs, timeouts and shared slot release are used. After model completion, feature flag, world version, ownership, goal revision/status/expiry and pending task are reread. Acceptance/counter choices also pass existing `checkTrade`. The result is explicitly `proposal_only`, with expected world/goal versions and model-response provenance, not a completed trade. The host MUST validate again at the actual command commit boundary. Model request IDs are evidence of responses, never proof of action.

Goal persistence stores bounded immutable objective IDs/times/status using CAS. It omits extra/private properties. Cancellation is terminal. `completeInTransaction` requires verified real item-use snapshots/events and stores an evidence receipt; neither model output nor ordinary save can set fulfilled. The caller MUST hold the same SQL transaction as world/events and propagate exceptions. Tests inject receipt INSERT failure and show rollback. Without that enclosing transaction the method alone does not guarantee atomicity. Retention/quota provisioning and production DB migration remain integration work.

Fourteen new tests use a mocked transport while exercising real model serialization/parsing, Ledger accounting, SQL goal storage, restart reads, late authority/goal/world changes, timeout, duplicate reservation, invalid counters, terminal status, actual tick-based completion and transactional rollback. No paid provider/model-quality result, autonomous dialogue discovery, production persistence, or continuous runtime has been demonstrated. Existing trade schema has no question state: first-contact/question selection continues to require the separately gated encounter path. This increment must not be reported as all AI life completed.


## Feature-OFF actual heartbeat caller (2026-11-03)

`resident-wants-caller.ts` now connects opt-in `WorldRuntime.heartbeat` to the existing model parser and real trade mutation/transaction, not just a proposal helper. The trusted host must install `residentWants` plus enabled `residentLife` ownership registry and verified `authorize` callback. No WorldDO production configuration is installed. Runtime overrides plugin budget/model with its own shared values and applies current delegation revocation. Unknown/personal/visitor actors fail closed.

Goal store must use the identical runtime SQL adapter, checked before spend. Successful trade, goal decision revision, turn receipt, world/events/run log share one transaction. Latched history tamper blocks pre-spend/commit; expired passes are swept before final trade validation. Low-level exported `completeTrade` remains an internal mutation helper, not an independently authorized API. Counteroffers await the peer; nothing impersonates a personal Muse. Model prose is not emitted. Goal remains active after trade; crafting/goal fulfillment is still independently verified.

A separate trade commit refreshes heartbeat snapshot and monotonic time. It suppresses the normal spotlight model for that consumed/attempted turn; ordinary world physics/encounters continue. A persisted turn receipt survives a crash before the tick. Across two runtime instances, the common model reservation prevents duplicate trade spend; a competing tick makes a late response stale and discards it rather than executing twice.

Verification: 14 offline caller tests use real SQLite, runtime, transaction and trade code with **mocked model HTTP transport only**. Cases include accept/counter/reject, personal/visitor denial, late delegation changes, write-failure rollback, crash/restart, cross-runtime race, item integrity, mixed expired/live passes, and storage mismatch. Combined existing suite totals 111 tests. Strict worker TypeScript checked. No actual provider, paid API, production scheduler, real user data, merge or deployment tested or performed. The broader discovery/goal creation/movement/crafting loop and production authorization wiring remain integration work, not completion claims.


## Catalog goal loop and production-controller seam (2026-11-03, feature OFF)

The next integration uses deterministic server-allowlisted catalog recipes, not invented LLM goals. `WorldRuntime.createResidentServices(sql,config)` builds one shared goal store plus goal/trade policies. Actual WorldDO enablement belongs to #134. Public Wants matching can create a pending trade, never the peer's acceptance. Missing partners produce a bounded public need declaration; unchanged declarations are deduplicated. Movement and activities reuse engine startTrip/startBeat, with goal idle ownership at arrivals/activity completion so random beats do not starve goal progress. Personal, priority visitor, live decision and existing intent control remain authoritative.

Goal receipts are mandatory inside every runtime commit transaction, not an optional observer. The separate synchronous onCommit observer supports projection storage and throws roll back the whole commit. Each tick records exactly the goal-idle list used by the engine. Goal creation/decisions are bounded by catalog IDs and stable daily identity; fulfilled/cancelled goals do not restart that day. Engine-5 is still an unreleased draft bundle; its description includes this opt-in policy. Historical tests remain synthetic checkpoint tests, not captured production recordings or dynamic re-execution proof.

Twelve new offline tests include uninterrupted heartbeat sequences cafe→arrival→plant→verified receipt and public need→pending trade→mock-model acceptance→actual craft→receipt; they also cover OFF/personal denial, store mismatch, missing optional observer, and full observer failure rollback. Role/catalog selection is deterministic. Only negotiation model transport is mocked; no real-provider judgment quality, production traffic or paid calls were tested. Autonomous free-form questions, long-range exploration and recipient utility optimization remain separate behavior work; this is a concrete bounded recipe/trade/use loop.

Design basis checked against Cloudflare's official SQLite Durable Object storage documentation: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ . Synchronous same-storage transactions cover state/events/receipts; SQL cursors are fully consumed before await, snapshots are copied before model work and authority/version is rechecked at commit. Node SQLite tests exercise rollback locally; Cloudflare-hosted rollout remains unverified.
