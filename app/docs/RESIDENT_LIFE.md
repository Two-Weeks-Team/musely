# Life-01: resident contracts and opt-in heartbeat connection

Related #132; Draft. This does not close the issue or enable production behavior.

## Actual implementation

- Separate role templates and resident instances hold routines, goals, bounded factual memory and pending promises. rule/live/scripted/replay labels stay distinct; proposals are not execution receipts.
- WorldRuntime now consumes an optional trusted server-only `residentLife` configuration. Absent/disabled creates no life table and preserves baseline tick behavior. Production WorldDO passes no configuration: OFF.
- Only a known harness, not any of the three legacy-owned slots, whose ownershipKind is positively `resident` can seed or receive a new routine. Unknown, personal, legacy, connected, paused and revoked actors fail closed. Appearance/name never grants resident authority.
- Existing spotlight visitor priority and live/replay decisions take precedence. Intent, invitation, pending task, incoming approach, active travel and active beat prevent routine takeover. Expired beats finish normally before a rule trip can start. Enrolled residents then wait idle until their normal spotlight instead of immediately restarting a generic beat off-turn. This fixes scheduler/beat-alignment starvation, at the visible cost of waiting up to a rotation. Pending social actions and personal authority never wait behind this hold. No deferred command or new execution authority is persisted.
- Rules use the existing startTrip path, constrained to common-area walking. Rule movement is never a fabricated live or replay Decision. Dry-run and commit receive the same planned input; version, persistence revision and ownership are rechecked at commit.
- One shared SQL transaction writes resident evidence memory, world state, ticks, events and run log. The separate table supports CAS and restart; the in-transaction write does not open a nested transaction. Recorded tick inputs include policyVersion 1, source rule and the proposed routine, not private goals or model prompts.
- Pending promises may be considered within an explicit lead window and a bounded grace window. Runtime grace defaults to one hour, covering the tested cursor rotation and activity window rather than requiring exact-millisecond arrival. Outside that bound a promise remains pending for explicit reconciliation; no fulfillment or cancellation is fabricated. Expiration and arrival never automatically mean promise fulfillment.

## Actual verification

Source baseline checked against main 52d737e03c2562346b35fe06f5b03b2d5fa029a9 (PR141 ownership registry); existing runtime/world source is unchanged from bd6d9d5. New ownership modules were included in local typechecking. PR139 world changes concern finishBeat/engine version, not the tick seam; file ownership was coordinated.

`node --test scripts/resident-life*.test.mjs`: 46 tests passed on Node 24.22.1, including real createWorld/tick/spotlightFor/isRuntimeControlled, local SQLite, actual WorldRuntime heartbeat, arrival memory, repeated routine after a finished beat, delayed promise under unmodified cursor rotation, restart, incoming/visitor precedence, changed ownership/version, and rollback after life/world/event/run-log failures. Synthetic live/replay decisions test precedence without model calls. Network fetch is blocked in the new runtime suite; no paid/API experiment.

Both app and worker TypeScript checks passed on the local source snapshot. A targeted CI workflow runs only resident-life tests; exact commit results belong in the PR.

The earlier full existing-suite attempt was blocked pending verification of external request contents and was not retried. No full-suite success is claimed. Local character GLB fixtures differ from repository blobs; rendering/build claims are not made from that snapshot. No live AI, external connected-agent, actual Durable Object deployment/storage, mobile/GPU or production acceptance validation has run.

## Remaining integration gates

1. #130 canonical Place contract and #134 trusted ownership adapter/WorldDO configuration. Keep deployment disabled until those gates and consent checks pass.
2. Combine PR139 ingredient safety and this seam under ONE agreed engine version; standalone branch retains current engine version to avoid assigning competing values. Do not deploy the new opt-in behavior under the old engine version. Historical replay semantics require combined verification, not a new-execution replay claim.
3. Extend to 24+ actual world residents only after stable identity/catalog/ownership support; controlled 24-resident fairness simulation is not production support.
4. Real model planning, visitor response/fairness/cost measurement, connection E2E and actual DO restart/rollback remain unverified. No automatic merge/deployment.

The event intake accepts only trusted committed server events and stores small factual summaries, never raw event lines/data or private Wants. It is not a client authentication endpoint. Bounded memories are not an indefinite event ledger. Promise closure requires authoritative execution evidence and is not inferred from a movement proposal.

## Follow-up integration evidence (2026-11-03, not a production acceptance)

Pinned sources: main 7a85add2bc8eb2d8d34d70d37857950be453713d; PR138 234bbd25c64413df3d20611686c667bc9fd37018; PR139 2e7629976c6f53d15fdb7c586aa355cc28a431df; PR140 6bcc218f7bbb47a6fb49f7e4cb8536022108ee2f. Locally composed PR139 engine-5 with the two zero-fuzz resident tick hunks, preserving the ingredient fix, plus PR140 contract/server code. This is isolated composition, not a branch merge or an agreed combined engine semantic version.

- 51 resident tests pass, including five additional actual-registry, two-runtime/two-SQLite-connection concurrency, competing life revision, dynamic-entry failure boundary, and current-run replay checks.
- The named combined offline set passes 114/114 (51 resident + 34 contract/server + 29 craft/Wants/replay). App/worker strict types were checked after the latest main's prepare-assets generated the required local asset descriptor. This does not establish rendering or asset equivalence.
- Actual local execution was recorded into the real run log for 25 heartbeats. Checkpoint playback at 1x/10x/60x and rewind preserve recorded world state/hash, original record, world and LifeStore; no network call. This is a captured current offline run, NOT a historical production engine4 recording and NOT engine re-execution.
- Two WorldRuntime instances with separate SQLite connections race the same tick: one commit and one duplicate, one life revision, no repeated event IDs or model calls.
- A competing life revision invalidates the old movement while preserving the newer edit. Legacy and unknown actors are excluded by the actual registry adapter.

### Reproduced dynamic-personal limitation

The latest main supports personal registry/auth but has no verified dynamic world-entry integration. In a synthetic future-entry fixture, inserting a registered `pm_*` personal actor into WorldState and allowing encounters reaches `replyTo -> harnessById(pm_*)`, which throws `Unknown Muse harness`. The entire heartbeat (world, life and event rows) rolls back. The regression test asserts this safe FAILURE, not successful personal participation. Identity/appearance/harness resolution must be fixed with the owning development team before dynamic personal world entry can be enabled. No production identity code was changed here.

WorldDO policy remains OFF; signed MCP, real account/model, actual Durable Object, normal dynamic personal participation, engine-version agreement, historical real recordings and deployment remain separate gates.


## Resident context continuity follow-up

The persisted resident goal, routine, pending promises and factual execution memories now reach actual spotlight and encounter request assembly. The server projects only the selected registry-positive resident's public fields: at most six routine slots, three pending promises and five executed receipts. Claims, inferred memories, future receipts, private/unknown fields and other residents' history are excluded. Data is explicitly untrusted and delimited with escaped angle brackets. The larger prompt is included before the existing cost reservation; this does not introduce another model call or bypass the shared call cap, daily budget or deadline.

Model evidence records only the resident revision. Changed life revision, ownership, disabled policy, personal/connected control or revoked delegation prevents using a late response. Registry personal/unknown ownership blocks both spotlight and encounter model calls even if the world actor still has stale resident controlMode, and commit checks do not depend on having attached a context. Turning the resident feature OFF stops subsequent LifeStore writes, including after restart.

Local verification against main `d2892ebebde56d495341493b2317a40c7a5d0658` plus this PR candidate: 83 resident tests, including 23 new context/authority/OFF cases, and both app/worker types. Synthetic in-memory transport exercises the real request builder, budget reservation, response validation, persisted restart and stale-answer discard paths without contacting a provider. It does not prove model quality, measured real cost, live connection or production behavior.

A separately pinned local composition with PR139 `172957844d85c791f3a8cbb3a141db780d406b41` and the in-progress PR140 WorldDO wiring passes 125 resident/goal/Wants tests and both typechecks after local asset descriptor generation. The PR139 standalone goal-loop fixture needs a complete residentLife configuration when combined (empty explicit initialState and allowedPlaceIds were supplied in that local test fixture); that adaptation is not shipped by this PR. Source composition is not a merge or deployment.

The real-world population limit remains: ten hardcoded harness actors minus three legacy-owned slots permits seven enrolled NPCs. The 24-resident pure-state fairness test does not instantiate 24 actors in WorldState, and this follow-up does not add identity/catalog/appearance support for more residents. It also does not establish authenticated personal-Muse entry, live personal social interaction, historical production engine replay or deployment readiness.
