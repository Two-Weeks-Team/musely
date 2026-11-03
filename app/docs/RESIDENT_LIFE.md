# Life-01: opt-in resident life contracts and adapters

Related #132. No production import/caller is added; this does not close the issue.

## What runs

- Role templates map onto existing actor IDs; instances own goals, routines, public evidence memories and promises.
- Bounded schema-1 serialization validates data and strips unknown fields. Memory distinguishes declared/inferred/agreement/executed and rule/live/scripted/replay; labels are not proof of authenticity.
- Rule proposals obey an explicit promise preparation horizon (default zero), allowed places, world version and authority snapshots. No movement is executed by this module.
- The adapter calls the existing `spotlightFor` and `isRuntimeControlled`. It does not replace the visitor queue, clock, budgets or scheduler. Visitor priority, paused actors, active trips/beats and persistent personal control fail closed, even after connected presence expires.
- Committed arrival/encounter/craft events can become bounded factual memory. Caller must supply trusted events from this world's committed log. Free text, event data and private Wants are never copied. This helper does not verify receipt origin.
- A separate SQL table supports validated snapshots, revision compare-and-swap and synchronous rollback. Tested with real local SQLite, including close/reopen. It is not yet installed in the Durable Object; joint atomicity with world/events requires the caller's existing transaction boundary.

## Verification

Baseline: main bd6d9d5bab9a6c3e5653ed1b195e76f16b67d21b, including #136 personal control and encounter changes.

`node --test scripts/resident-life*.test.mjs`: 30 tests passed on Node 24.22.1. These use real createWorld/tick/spotlightFor/isRuntimeControlled plus local SQLite; no external API/model call.

`tsc --noEmit && tsc --noEmit -p worker`: passed against a local baseline source snapshot plus these additions, TypeScript 7.0.2.

The isolated fairness test gives 24 synthetic residents 240 turns with a serialization restart (10 attempts each). This is not real visitor-load fairness or successful AI actions. Actual production actor count remains unchanged.

Full existing-suite execution was attempted, but its status check was blocked because external api.meta.ai request contents had not been established. It is not reported as passing and was not retried. Some local character GLB fixtures differ from repository blobs; no rendering/build claim is made from that snapshot. New tests and typechecks do not use those binaries. No real-model, connected-agent end-to-end, browser/mobile, deployment or production persistence test has run.

## Remaining gates

1. Recheck latest main and coordinate #130 place contract; do not invent or migrate production Place IDs.
2. Agree trusted receipt and shared transaction adapter integration. Do not install untrusted client memory/receipt endpoints.
3. Wire behind a default-off feature gate into the real heartbeat only after dependency review. Revalidate permissions and version at atomic command commit. Do not turn a rule proposal into a fabricated live/replay Decision.
4. Measure visitor response, fairness and model cost under the existing budget. Add real AI only with transparent source and cost accounting.
5. Test restart in the actual DO store, failure recovery, connected revocation and deploy separately. No automatic merge/deployment.

Bounded public memory is not an indefinite event ledger. Promise capacity never evicts pending agreements silently. Fulfillment requires trusted executed evidence; no inference or proposal completes a promise. Expired promises stay pending for explicit reconciliation.
