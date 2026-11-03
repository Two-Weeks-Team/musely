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

## Second increment: actual server adapter, still not installed in production

New base: main `52d737e03c2562346b35fe06f5b03b2d5fa029a9` (merged PR141).
Engine5 dependency: PR139 `2e7629976c6f53d15fdb7c586aa355cc28a431df`.
The earlier race now has a tested **unmerged** fix. The activation blocker is therefore
unmerged/live-unverified fix, not absence of an implementation. Feature remains OFF.

`world-life-server.ts` reads the real PersonalOwners registry. Only positively identified
residents are eligible; legacy owners, personal registrations and unknown actors cannot
fall through to RULE merely because their connection/controlMode is absent. It reads
invite facts from an actual WorldRuntime instance and its internal stored event log;
there is no public event-array ingestion entrypoint. This is not new cryptographic
verification: the existing server database/authenticated command boundary is trusted.
Missing/truncated spend or terminal evidence fails closed. No production caller is wired.

Actual WorldRuntime + messages + SQLite tests verify committed immediate gathering,
pending personal Muses until explicit answers, stale command rejection, durable restart,
and rollback of world/event/projection/run-input writes on early and late failure. An
independent review found a delayed-first-read bug: current attendance/time incorrectly
replaced historical gathering evidence. The fix uses stored closedAt plus matching
campfire_gathering event participants, including after everyone moved or 31 minutes
elapsed. Expiry bootstrap replays the real opening and terminal facts. Snapshot worldVersion
is an observation version, not an invented historical event version.

First local attempts corrected two fixture errors: appearance IDs use `00-jolly` rather
than `jolly`, and projection scope is a bounded campfire set rather than all world POIs.
The adapter omits out-of-scope current positions, rather than inventing arrival.

Local results: 12 actual-server tests plus 22 contract tests. Baseline and engine5 overlay
are separate checks; the latter also runs 29 Life-02 craft/Wants/replay checks. Dependency
changed-file blob hashes were compared with PR139's exact head. CI now checks merged
main and a separate pinned PR139 checkout with only these integration files and merged
registry files overlaid. The worker's real strict tsconfig is used because DOM's timeout
signature differs from the Cloudflare worker types; no shared source/type rules weakened.

Not done: signed MCP end-to-end calls, real identity/login, live model, production
WorldDO hookup, #132 scheduler hookup, actual multi-site rendering/navigation, deployment.
Rollback tests use real server classes over local SQLite, not a deployed Durable Object.
Production atomicity is still a gate until the approved caller uses this table in the same
transaction. No world.ts/world-runtime.ts/WorldDO changes are included in this PR.

## Pinned combined dependency candidate

PR138 is now published at `234bbd25c64413df3d20611686c667bc9fd37018`.
A third CI job composes its resident tick seam and scheduler/life files with PR139's
engine5 at the pinned SHA above. It applies the main-to-PR138 world diff with zero
fuzz, rather than replacing the engine5 file and accidentally removing the craft fix.
Only end-of-file whitespace is normalized when producing the seam diff. All seven
resident source/test blob hashes were checked against the published PR head.

The equivalent local candidate passed **109/109** tests and worker strict TypeScript
(46 resident tests, 34 integration tests, 29 craft/Wants/replay checks). This is a
review/test composition, not a merged or deployed product. Engine semantic-version
coordination, historical real replay evidence and final production caller ownership
remain explicit integration gates. The root/owning team must review those before merge.


## Latest main and authenticated MCP path, local Cloudflare host fixture

Base main `7a85add2bc8eb2d8d34d70d37857950be453713d` includes the team's
new personal-auth store. The new harness imports the **actual WorldDO class**, owner
key route, MCP HTTP handler, ConnectedHost, Trust, command executor and server methods.
Only the Cloudflare DurableObject base, SQLite/storage host and alarm scheduling are
replaced with a local Node fixture. This is NOT workerd, a deployed Durable Object or
real provider authentication. Owner claim setup is explicitly synthetic, ephemeral keys
never leave the process, no model key is provided, and a fail-closed fetch guard checks
zero network calls. No production constructor or route changed.

Eight additional tests cover full local MCP invocation through its actual internal signed
command path: invite/explicit peer answer/projection, concurrent duplicate command spending
once, conflicting payload, fabricated bearer, revoked key, revoked delegation, stale world
version, foreign invitation response and actor-argument spoofing. Real PersonalOwners
registration confirms a private draft actor cannot inherit legacy-owner/resident authority.

Two extra place IDs are rejected by the real MCP schema (`-32602`). That is the CURRENT
product boundary, not completed multi-site support. The three-place reducer tests remain
fixtures. Production optional-place invite wiring, actual navigation/rendering and multi-site
consent are still unfinished. Initial test assertions were corrected to distinguish protocol
JSON-RPC errors from tool-result isError rather than treating every refusal as a tool result.

Baseline target is 42 tests; engine5 dependency target 71; combined resident+engine5 target
117. Runtime/registry/claim fixtures, actual route logic, and real deployment are reported
separately. Broader end-to-end claims must wait for real caller integration and credentials.


## Latest pinned branch and conflict audit (2026-11-03)

Current CI pins PR138 `e65b6a1b193d01d568d5cdf3a9af7b0d48f7828b` and
PR139 `5818030f773f842eb64af36d48f59b7688663dd3`, on main `7a85add2`.
All pinned source/test file Git blob hashes matched the local tested bytes. PR138's
subsequently edited documentation is not treated as executed code evidence.

Latest five-PR heads inspected:
- #135 b121902302fd7971bee7393cc1f7a0c9d6964bc3
- #137 57d8c636932f18f3bad78da3e56d826f65d7f99f
- #138 e65b6a1b193d01d568d5cdf3a9af7b0d48f7828b
- #139 5818030f773f842eb64af36d48f59b7688663dd3
- #140 11a1c5d4a80cd1faf0a5b1da91f4da9e57ea9e41 before this test-only update

GitHub reported each branch mergeable individually. Changed-path comparison across all
five finds only two shared paths, `app/src/engine/world.ts` and `rules.ts`, both shared by
#138/#139. Three-way text composition against current-main versions returned success for
both, retaining actor-label/control isolation alongside atomic craft and truthful trade
refusal attribution. CI now uses that same three-way composition rather than overwriting
shared files. No branch was merged or published to main. File-disjoint assets do NOT prove
render/runtime coexistence, and textual merge success is not semantic integration proof.

Fresh combined offline run: **185/185**, full worker strict types passed. This covers
60 resident, 83 Wants/craft/journey/replay, and 42 integration tests. CI also retains
separate main and engine5-only combinations (42 and 125 tests respectively).

The neutral display helper is not a persona, role, login or ownership implementation.
Unknown actors remain runtime-controlled; a registered actor's profile does not authorize
resident decisions. Main-team dynamic onboarding/world-entry and identity/appearance
integration still need their owning team. Test fixtures do not establish live personal
Muse participation or autonomous model decisions. Production callers, multi-site MCP,
real rendering and the shared semantic-version decision remain activation gates.
