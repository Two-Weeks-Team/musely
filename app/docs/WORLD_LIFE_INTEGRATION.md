# Integration-01: installed feature-OFF server integration (#134)

## Current integration candidate (2026-11-03)

This revision installs a **default-OFF** WorldDO capability. An explicit server-only
`sandbox-v1` mode plus both unmerged dependency capabilities is required. No deployed
configuration is enabled. Missing dependencies and unknown mode strings fail closed.

Reviewed main: `d4521aa70467fb2e18705dcd26816ba482ec3892` (main151).
The ten main151 personal-onboarding files are preserved in feature and dependency
compositions; server source did not change. New personal-connection regressions run.
Pinned dependencies: #138 `6fe12e6c7782d2048b179b617b7dce123ae701ea` and
#139 `c9a7ef0d4a21a7e0496cb02e3326eb1e3ba176ef`.

- Actual in-process Worker/WorldDO/SQLite signed MCP paths preserve main148 personal
  admission, nonce/receipt rollback, main149 legacy profiles and main150 asset responses.
- An opted-in world has 24 distinct resident identities (seven existing plus 17 exact
  catalog instances), separate trust roots, roles/appearance reuse, public-place routines,
  registered goals, discovery, proposal, model-assisted negotiation and verified use.
  Goal creation/routines are rules, not claimed emergent model intentions.
- Signed personal entry and introduction lead to a normal heartbeat NPC reply in the
  personal inbox. The model response transport and OAuth provider are **offline mocks**.
  Normal meeting verification retains main's requirement for both walk-and-greet and
  item-trade scopes; a signed greeting alone requires only its original greeting scope.
  No automatic personal answer or movement is invented.
- Dynamic pending-claim personal actors remain excluded from autonomous trades, including
  generic encounter rules and model offers. Legacy connected owner slots remain distinct.
- Explicit refusal persists for the same actor/peer/item pair for 30 minutes. Restart,
  transaction rollback, OFF withdrawal, late model results and immediate pre-alarm signed
  gift/trade/invite requests are tested. OFF freezes the enrolled expansion residents.
- Projection reads actual committed opening/terminal facts. Overdue open invitations wait
  for actual upkeep, so restart does not fabricate expiry or fail before upkeep.
- Three independently recorded SQLite histories from engine5, engine6 and
  engine6-resident-v1 replay unchanged through the combined **engine7** reader. Exact
  catalog/harness tuples are checked; mixed/unknown tuples are rejected. The composition
  helper rejects unknown conflicts and duplicate predecessor insertion.

Local evidence: default-OFF 251/251 plus worker strict; full combined suite 545 passed,
zero failed and two explicit missing-GLB renderer skips (547 total). An independent
installed/installation/replay-helper run passed 35/35 plus worker strict, including the
new `nr_basil` negotiation. Exact-head CI is recorded in the PR after completion. Large renderer GLBs are not
available in this local snapshot, so local renderer skips are not visual acceptance;
repository CI uses real checked-in binaries. GPU/browser rendering, actual provider login,
paid model execution, public HTTP/TLS/workerd deployment and operational activation remain
**unverified and unperformed**. Main is not merged, and no deployment is requested.

The following sections are preserved chronological investigation history. Earlier claims
of no caller or endpoints describe those earlier revisions, not the current capability.

---


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

Independent composition review reran185/185 and worker strict types. It identified a
future-main risk: using changed main as a three-way base could silently drop changes
unknown to both pinned branches. CI now asserts exact reviewed-main Git blob hashes
for all six existing source files replaced/merged from PR138 before composition;
a moved baseline fails closed and requires a fresh reviewed integration.

## Actual optional-place MCP implementation, default OFF

This increment changes four narrow existing server files: connected.ts carries an optional
server-only policy into ToolCtx; mcp-tools.ts accepts optional place_id and includes it in
the signed payload; messages.ts selects the validated venue; run-log.ts preserves place_id
in the redacted command record. A new campfire-policy.ts validates the server allowlist.
WorldDO production configuration is unchanged and never enables the option. No browser or
tool argument can enable it; policy is re-read at the synchronous signed-command commit.

Omitted place_id and explicit commons:campfire preserve legacy behavior. Additional venues
must be existing allowed commons places; the host and eligible recipients must be arrived
within100m, and remote/travelling participants fail closed. Open-invitation uniqueness is
per host+place only when the policy is enabled, otherwise the old one-open-invite restriction
remains. Each invitation spends its own token, has its own30-minute deadline and explicit
answers; proximity/arrival still does not imply personal consent. Turning the policy off
blocks new nonlegacy invites but does not erase or rewrite already committed invitations.

Thirteen new actual in-process MCP tests cover three venue IDs, place-bound signed-command
idempotency/conflicts, recorded venue evidence, same-site uniqueness, unknown/disallowed/
remote/travelling rejection, policy withdrawal before commit, explicit consent, actual signed
movement+heartbeat arrival at the selected venue, per-invite expiry and owner revocation
cancelling both sites. Existing11 messages tests are also run for legacy compatibility.
Initial OFF tests were corrected to use separate command IDs for separate refused payloads:
reusing the same ID with a changed venue correctly returns command_conflict.

The logical test venues reuse commons:garden and commons:benches. This does not install a
visual fire there, create real-world gatherings or assert render/navigation pack integration.
The Node harness injects trusted server configuration for tests; it is not a production
configuration route. Model key absent, all network blocked. No actualHTTP/TLS/workerd or
provider login, deployment, user account mutation or paid experiment.

Shared messages.ts actor-label/control changes from #138 are composed using an exact
reviewed-main base and three-way merge, not overwritten. The reviewed-main blob is pinned;
world/rules still retain both #138 control and #139 inventory/consent changes. CI overlays
all new adapter/server files and runs the multisite test file in every composition.


Final multi-venue dependency pin advances PR139 to
`74befdd9ad08d11ded9e0a5d965de184277cc7c3`, retaining PR138 e65b6a1b.
Its14 mocked-transport callModel/Ledger/SQLite goal tests are included in the combined
checks. The new resident trade bridge remains proposal-only with no production caller;
this integration does not imply autonomous negotiations or real paid provider execution.


## Merged main188fcb7 registration boundary

Team PR145 registration and PR146 asset transport are now merged into main188fcb7.
The compatibility test uses actual Worker registration plus personal ownership resolution,
then verifies no world entry, no MCP entitlement, and no NPC authority even with a
synthetically supplied resident controlMode. Profile changes and logout retain the durable
personal classification. Synthetic future entry is a negative authority probe, not a feature.

The first registration composition found an old worker/index.ts left from the Life02 base,
producing404 instead of exercising main's HTTP routes. This was a test-composition omission,
not a team registration bug. Previous223 checks used direct MCP handlers and did not prove
full Worker HTTP integration. CI now overlays current main index, asset-encoding and complete
personal modules/tests, retains all shared3-way merges and pins reviewed-main188fcb7.
Existing main-team code is copied only into ephemeral test checkouts; this PR does not
rewrite or fork their registration implementation. No provider calls or deployment.

## Actual resident negotiation caller composition

PR139 pin now f9b427b91d81ab96f5ee17cff56a49a32eb52264. Its optional heartbeat
caller can commit existing trade accept/counter/reject and associated goal decision records
in the actual WorldRuntime transaction, using the existing model parser/budget/slot and
server trade implementation. The transport in these tests is mocked; no model quality,
provider response, autonomous goal creation, movement/craft loop or production enablement
is claimed. WorldDO still supplies neither resident policy. System model events explicitly
carry actorOrigin=system and decisionSource=resident_model, not personal agent provenance.

mcp-tools.ts is now three-way composed to retain both optional-place changes and the new
completeTrade export. world-runtime.ts also needs three-way composition: the one reviewed
conflict is the adjacent addition of residentWants and residentLife RuntimeOptions. A small
composition helper accepts only those exact two blocks and preserves both; other conflicts
fail closed. Three synthetic helper regressions verify preservation, ordinary clean merge
and rejection of an unreviewed conflict. No branch is merged by this script.

## Opt-in WorldDO installation and durable projection (supersedes earlier caller limitations)

The new installation is absent/OFF by default. No deployment configuration enables it.
Only the server environment value WORLD_LIFE_MODE=sandbox-v1 installs the controller;
unknown values fail closed. HTTP parameters and public requests cannot enable it. An
installation without the resident service factory or resident-life storage fails explicitly.
Standalone main plus this PR must still boot OFF without either dependent PR or new tables.

The controller supplies actual WorldRuntime services on the same SQL handle, fresh personal
owner registry classification, delegation checks and the existing signed meeting gate.
Goal selection is deterministic and restricted to existing role-matched craft recipes.
It does not create dozens of actors, invent personal desires, accept offers for a user,
or provide free-form conversation. Existing signed personal Wants and accept_trade can
participate; the personal actor's priority is respected before NPC activity proceeds.
Actual heartbeat activity uses existing travel/activity/craft and mandatory verified receipts.
Model negotiation tests inject an offline transport into the existing model pipeline.

Committed invitation projections persist in per-invitation SQL rows with a unique consumed
receipt token. The installed reader selects matching committed event evidence directly,
rather than truncating all world history at 20,000 rows. Projection writes execute in the
same world transaction: forced SQL failure rolls back world state, receipts, inventory and
signed-command acknowledgement, allowing the same command to retry. The read-only
/api/world/life route exposes public invitation and NPC goal summaries; it returns 404 OFF.

### Failures found and regression coverage

An initial implementation attempted to re-project overdue open invitations at restart time.
After an unrelated world-version advance this rejected an expired invitation before upkeep
could run, preventing boot. Boot now leaves overdue open world records unchanged and waits
for actual upkeep; existing projection rows explicitly indicate awaitingUpkeep. First
OFF-to-ON installation follows the same rule. Only the real expiry commit updates projection.
Forced expiry-projection failure rolls back and a subsequent heartbeat retries successfully.

An initial withdrawal guard disabled endpoints but left resident scheduling/state writes
active. The controller now reads enabled dynamically, and the resident runtime also guards
its save path. OFF alarm/restart keeps resident state and revision unchanged; reinstalling
ON resumes it. Withdrawal while a mocked model response is pending rejects the late trade
and does not write a resident decision. The runtime guard belongs to PR138 and must be
present at the exact pinned dependency head, not merely patched in a local test checkout.

The new installed suite exercises real WorldDO class, Worker Request/Response routes,
signed MCP, SQLite transactions, alarms and persisted restart. This is an in-process
Cloudflare shim, not workerd, provider OAuth, live network/TLS, mobile, production rendering,
real paid model inference or deployment. Global fetch is forbidden by the fixture.
Setup inventory/cursor/task inputs and ephemeral signing keys are explicit test fixtures.

Full composition also exposed a PR139 test fixture supplying only part of the PR138 life
policy: absent initialState/allowedPlaceIds failed actual initialization. This is not treated
as a passing integrated suite; the dependency fixture must be corrected and the complete
suite rerun before publishing final evidence. Shared world/runtime additions are composed
from exact reviewed conflict pairs, retaining goal priority, resident control and run-log
metadata; any other conflict fails closed. This script prepares isolated test checkouts,
never merges a branch or changes production configuration.

Current reviewed pins are main d2892ebebde56d495341493b2317a40c7a5d0658
(team PR147 presentation-only changes), PR138 ca17e3ee15bda46f4b2101605d7f761b39fb9465,
and PR139 fbecb3e61da28905fa903b5c4d81dc176ef1c608. PR138 includes the published
save guard and fresh registry/context authority checks; PR139 fixes the complete life-policy
fixture. Local installed 17/17 and worker strict pass. The expanded local run reports
373/377 passing: four new main147 personal-scene rendering tests lack valid local lod0/lod1
binary files (both zero-byte fixture placeholders). They are not declared passed or blamed
on main; CI uses the repository checkout assets to establish the result. No placeholder
assets are committed by this PR.

Exact-head CI for 42f6b3e609cc2348093f4d17c0d9f5d31a34efb4 supersedes the local
asset limitation: run41646636837 passed standalone OFF152/152, PR139 overlay281/281,
and complete installed composition378/378 plus worker strict in all three jobs. The four
main147 render tests passed with repository binaries. The first wiring CI failed at its
main guard because the PR event base metadata still reported7a85; the fixed guard checks
the actual fetched main ref against d289, retaining the exact-source fail-closed condition.

A further composition regression blocked a false routine-served claim: when goal-idle
wins engine priority, a resident routine is no longer marked accepted or counted as served.
The installed test checks unchanged served/lastServedAt, no travel, recorded goal idle and
absence of a recorded residentLife proposal. It is included in the378-test composition.

## Explicit refusal interoperability

The next composition pins PR13915373e56fefff6b9a46ea26addd40335bdc327fc. Three
installed signed-MCP regressions exercise actual rejection, persistence through restart,
new personal proposals without an automatic-counter loophole, and mode withdrawal.
The user's new signed proposal remains allowed; only the resident's repeated proposal of
the same item pair to that person is suppressed by the server's bounded refusal policy.
No private refusal text is stored. OFF rejection changes the legitimate trade task but
writes no resident refusal memory or life revision. Focused installed/installation21/21 pass.

The first restart assertion also compared an unrelated legacy owner's inventory; legacy
boot legitimately restores that owner's starter items. The regression now specifically
checks both exchange participants, the rejected task and absence of repeated offers.
Shared runtime merges preserve engineHooks (including all refusal gates), resident move/idle,
goal idle and exact run-log fields. Shared rules/world/MCP changes merge cleanly against
the pinned reviewed source. CI still runs personal-scene tests with real repository assets;
local broad server checks exclude that known-incomplete binary fixture only.
