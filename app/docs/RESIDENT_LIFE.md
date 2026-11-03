# Resident life and the opt-in fixed neighborhood

Related issue #132, PR #138. No deployment or production activation is performed by this PR.

## Population and identity

The ten original harnesses remain reusable role/appearance templates. The fixed `neighborhood-24-v1` catalog adds seventeen exact `nr_*` instance IDs, producing 24 resident NPCs plus the three existing legacy-owned actors in WorldState. No `nr_` prefix wildcard, arbitrary actor, profile, appearance, name or `pm_*` personal identity grants NPC control.

The trusted server must opt in with both `residentLife.enabled === true` and the exact roster mode. It must provide registry-positive ownership for every new instance. The ownership adapter must preserve personal and legacy registry results before an exact-catalog unknown fallback. PR #140 owns the actual WorldDO/controller/HTTP installation; this PR's WorldDO remains the latest main baseline and does not activate the feature by itself.

Enrollment atomically writes the actual WorldState members, LifeStore additions, join events and run-log checkpoint. Repeated initialization and SQLite restart do not duplicate identities or receipts. A collision, missing ownership, invalid public routine place or capacity overflow rejects the entire enrollment. Only existing non-transferable role props are seeded, never currency, gifts, passes or craft receipts. The actor's `residentRole` enrollment marker is distinct from any personal profile or authority.

Trust provisioning takes an optional exact list of the seventeen new IDs. Personal root, key, scope, grant, revocation, signed entry and receipt paths from main remain intact. Existing personal Muse admission is still authenticated through main's signed atomic entry contract, not through the NPC catalog.

## Activity, cost and OFF behavior

Residents use the existing world spotlight, travel, beat, encounter and shared budget paths. There is no timer or model loop per NPC. Existing two-call concurrency, encounter-turn limit, reservation-before-call, daily budget, visitor priority, stale response and delegation checks remain in force.

Public routine or pending-promise intent may run only on the resident's own ordinary turn. Active travel/beat, personal control, connected presence, visitor priority, live/replay decisions and pending social commitments take precedence. A proposal or expired promise is never recorded as completed work. Empty routine profiles do not indefinitely suppress ordinary activity.

Turning the feature or roster mode OFF freezes only the enrolled seventeen additional instances: no new model call, movement, beat, encounter or automatic invitation participation. In-flight responses are rechecked at commit. A public `residentFrozenAt` timestamp preserves positions, activity and remaining timers across restart. Reactivation shifts existing travel/beat clocks by the paused interval and retains identity, memory, inventory and public history. Existing seven NPCs and personal/legacy actors are not paused by this roster switch. No destructive rollback migration is performed.

## Memory and personal communication

Bounded LifeStore memory records facts from committed arrivals, encounters, crafts, public greetings and actual replies. External signed public greetings contribute receipts for resident participants in the same transaction as their event. Raw greeting text, private Wants, credentials and arbitrary event data are not copied into these receipts.

Actual spotlight and encounter model inputs receive a bounded public context: goal, up to six routine slots, three pending promises and five factual executed receipts. Inferred claims, future evidence, private extras and other residents' history are excluded. Context is explicitly delimited as untrusted data and included before the existing cost reservation. Only the revision is logged as model evidence. Changed revision, authority, world state or OFF policy invalidates a late result.

Personal actors never become model actors. Only actual world members with permanent personal control and positive personal registry ownership may enter the trusted peer list. A normal heartbeat's actual NPC encounter reply is delivered to the personal/connected recipient inbox. Signed `say_hello` retains main's contract: it records the introduction but does not fabricate an immediate reply or choose a personal Muse's next action.

## Presentation and replay

Every catalog actor resolves its own name/role and an existing appearance asset. Instances sharing an appearance have separate actor IDs, renderer roots, positions and selection. Public personal/legacy profiles retain precedence. Unknown/invalid profiles do not borrow an NPC appearance or authority.

The branch uses `engine-6-resident-v1`, separate from main engine-5 and PR139 engine-6. Catalog content versions include the fixed resident descriptors. Exact published engine2/3/4/5 checkpoint tuples remain readable as stored snapshots; mixed tuples are rejected. This is checkpoint playback, not re-execution of historical engines. PR140 owns the distinct combined engine-7 version.

## Verification and remaining gates

Local tests exercise the real WorldRuntime and SQLite transactions, actual 27-member WorldState, all resident scheduler turns, public factual memory, visitor priority, atomic rollback, repeated initialization, two-connection races, restart, OFF/reactivation, synthetic model request/response validation, shared concurrency/budget and personal inbox delivery. Main signed entry, authority, revocation, receipt rollback and legacy-profile regressions are rerun. Synthetic providers/transports do not contact paid APIs.

The local downloaded checkout has empty LOD0/LOD1 files. Full real-GLB renderer tests therefore explicitly skip locally and must run without skips in CI against repository assets. Presentation/frame tests are separate from full asset/rendering tests. No mobile/GPU performance or live visual acceptance, real model quality/cost, real connected-account session, deployed Durable Object persistence, or production readiness is claimed.

Before activation, require the exact #138/#139/#140 composition with registry/controller/Trust wiring, actual signed personal entry and NPC interaction, routine/goal precedence and combined engine version checks. Review the spatial placement results and actual renderer CI separately. No automatic merge or deployment.
