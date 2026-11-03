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
