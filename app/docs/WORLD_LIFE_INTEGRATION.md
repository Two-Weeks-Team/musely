# Integration-01: feature-off integration boundary prototype (#134)

## Status and evidence

This is **not completed product integration**. No production imports, server endpoints,
world mutations, model calls, migrations, deployments or runtime flags are added.
`activationStatus()` is permanently false in this revision. Turning it on needs reviewed
code and resolution of the blockers below, not an environment variable.

Base inspected: `bd6d9d5bab9a6c3e5653ed1b195e76f16b67d21b` (main, 2026-11-03).
Dependencies inspected and still **unmerged**:

| Work | PR | Exact reviewed head |
| --- | --- | --- |
| World-01 | #135 | bd946a0d9207198a2d5b8081e7d5255936a28261 |
| World-02 | #137 | 5060fcb968b01a52826e477d0eb21910f05261ef |
| Life-01 | #138 | 79d7086acd4281324a82a4cd1a7e7f9465e6d7ce |
| Life-02 | #139 | b718099432b4203ff42c47eb14e0ea1086680397 |

The two additional place IDs used by tests are explicitly `fixture:` IDs. They are not
new navigable product places and must never be treated as surveyed coordinates.

## Implemented and tested

- Resident suggestion validation against same-world/version server view; excludes personal,
  connected, revoked, busy actors and exhausted resident budget. Success is `proposal_only`.
- Legacy omitted invite place defaults to `commons:campfire`; non-invite actions require
  an explicit known place. No change to the existing invite tool's schema.
- An isolated **display projection** of already-committed invitation receipts, not an executor.
  Explicit place/participants/deadline/token-spend evidence remain immutable per invitation.
- A first committed receipt may already be gathered, matching the existing server.
  Multiple ordered invite revisions may share one world commit version.
  Exact receipt retry is idempotent; changed payload with the same key is rejected. Versions,
  revisions, terminal states, three-place isolation, max eight invitees and 30-minute bound
  are tested. A spent-token receipt cannot finance another invitation.
- Arrival is not consent. Only explicitly accepted participants at the right place, neither
  travelling nor paused, count toward three-person gathering. This preserves #136's consent
  direction; it does not make decisions on behalf of personal Muses.
- Snapshot/restart replay restores the separate projection and dedupe ledger. It does **not**
  prove existing world snapshot/replay or Durable Object joint-transaction compatibility.
- Allowlisted public facts only; private reasons, raw GPS, credentials and peer instructions
  are not copied. Peer claims are never accepted as server authenticity proof.
- Twenty-two offline Node tests and isolated strict TypeScript passed locally. The CI workflow
  runs those same bounded checks. These are not the full application test suite.

## Ownership and integration seams

1. Existing authenticated server code must create `AuthorityView` from authoritative world
   state inside its existing transaction. Map persistent personal control, current runtime
   connection, revocation and scheduling budgets; do not trust client booleans.
2. #138 proposes resident-only actions. Translate its bounded proposal to
   `ResidentSuggestion`, then recheck authority/version at actual command commit.
3. #139 use planning remains a recommendation. Existing signed trade/activity handlers own
   inventory and consent. Do not add trade acceptance to this module.
4. The existing server emits a committed `InviteReceipt` only after it commits a valid
   invitation/action; the projection observes it. `receiptId` and `spentTokenReceiptId` are
   stable server-issued references, not executable item tokens. The projection does not
   authenticate incoming JSON and must not be exposed as a public ingest endpoint.
5. #130's coordinate/place mapping and #137's fire renderer remain separate. Approved live
   place IDs will replace fixture IDs only after navigation, capacity, arrival, render
   coexistence and consent validation. Rendering observes committed results only.
6. Persist this projection and #138 life state in the same world transaction if wired.
   The in-memory immutable reducer alone does not establish joint atomicity. At 4,096
   receipts it fails closed rather than dropping replay protection; a reviewed persistent
   ledger/checkpoint/retention design is required before long-running production use.

## Activation blockers and exact next steps

1. **Existing craft consumption race:** a Muse can start `garden_plant`, transfer its
   `clover_seed` away during the beat, then finish and receive Bloom despite missing seed.
   Existing `finishBeat` skips missing consumption but creates output. #139's verifier can
   reject realized benefit, but does not prevent bogus creation. Shared-engine owner must
   fix atomic required consumption; add concurrent gift/trade/expiry completion tests.
   Do not weaken the gate or enable this prototype before that independent engine fix.
2. Merge/rebase dependent PRs only after user approval and independent review. Repeat
   contract validation against the actual merged exports; these pinned SHAs are not a
   claim that dependency artifacts have been installed in this branch.
3. Implement and test joint world/life/idempotency persistence and rollback using the real
   Durable Object transaction seam. Keep existing event/snapshot schema backward compatible.
4. Extend the existing invite tool with optional place ID, preserving default and ownership,
   per-invitation spend, explicit personal consent and server authorization. Obtain shared
   code ownership coordination first. No such tool change is included here.
5. Run real #130/#137 WebGL coexistence regression at near/far zoom and phone viewport,
   then one-to-three actual navigable campfires. Investigate the user's overlapping 3D
   reproduction; a passing fixture is not evidence that visual overlap is fixed.
6. Verify fixture, deterministic-rule, live-model and personal-Muse evidence separately.
   No real model, personal Muse, mobile device, deployment or production action was tested.

## Local checks and rollback

From `app/` using the repository's Node 24 and installed TypeScript:

```
node --test scripts/world-life-contract.test.mjs
npx tsc -p scripts/tsconfig.world-life-contract.json
```

Rollback is removal of these new files/workflow; no production state or route changed.
Keep feature OFF. Do not describe draft PR creation, these tests, or projection receipts
as completion of #134's full integration acceptance criteria.

## CI correction

The first remote run passed all 22 tests but TS 7 rejected CLI file selection next to
the application tsconfig (TS5112). A separate explicit project config now checks only
this module without altering app configuration or suppressing module type errors.
