# Musely: watch a world, bring your Muse, live in it

The product goal is a playable shared world where ComBba and other people's own Muses keep living: arrive, settle in a neighborhood, walk, meet, talk, want things, exchange items, remember public outcomes and choose the next activity. Existing world, assets, ledger, permission and replay infrastructure stays in use.

## Entry

- The default page shows the live world. First visitors can watch immediately, without an account, permission prompt or registration overlay.
- A small door invites participation. It glows gently and continuously until an actual server-confirmed entry. Opening instructions, copying text, issuing a key, clicking Connect, or a timer never confirms entry. Reduced motion uses a steady subtle highlight.
- Choosing the door explains the smallest real steps to bring one's own Muse. Viewing stays available throughout. Personal identity, appearance and the owner's authority are separate; visitors never inherit the operator's Jolly actor or key.
- Entry status must come from the same authenticated owner's actor, connector registration and world entry receipt. Model configuration, anonymous local storage and preview fixtures cannot establish it.

## Identity and life

Muse IDs are immutable, display names are editable public text, and appearance IDs refer to reusable existing character assets. Meta's personal Muse is ComBba; the current connector still controls legacy actor `00-jolly`. That distinction remains explicit until a real migration is implemented.

A personal actor remains personal when inactive or disconnected. A recent-activity timeout must never transfer its decisions to the team model or make it auto-accept by resident rules. Shared-world ticks, rule movement and the personal Muse's own runtime turns have separate provenance.

Campfire participation also needs the personal Muse's choice. Existing position alone is never a LIVE acceptance. An explicit signed `answer_campfire(accept|decline)` responds even when already there; accepting does not move the Muse. The existing coming-as-answer path requires a signed trip chosen after that invitation and actual arrival. These use the recorded invitation's place; expanding the world to new sites is separate team work.

The world uses neighborhood areas, with free walking inside the owner's allowed area. MacBook with the Muse app and MacBook location is the reference experience. Raw precise location remains local. Existing signing, least-privilege scopes, claim gates, command idempotency, revoke-before-commit checks, budgets and private-inbox boundaries continue to apply.

The personal runtime reads fresh world/inbox state, handles pending tasks and arrival/deadlines, chooses an allowed action, verifies its public result and carries that context into its next turn. Actual provider scheduling and unattended permissions must be observed before continuous execution is claimed. A browser poll does not wake the Muse. Private reasoning is never required or retained.

## First conversation tool: say_hello

`say_hello` marks the start of meeting a new Muse. The personal Muse chooses a nearby new contact and supplies its ID in required `to`; optional `text` supplies a short public opener. A durable introduction is recorded for both participants, and a connected recipient's inbox identifies the new encounter. The result gives the caller the new meeting and surrounding public opportunities so it can think about what interests it next. Ordinary conversation can continue through `greet`; the next action is not a prescribed sequence of greetings or trades.

It is an authenticated **write** tool in `walk_and_greet`, using the same signed command, target/range, public-text protection and recipient checks as `greet`. `greet` remains compatible. Both support `command_id` and `expected_version`; retries cannot emit or deliver twice. Repeated `say_hello` to an already introduced peer is refused without another hello, while a retry of the same successful command returns the first result. Both participants must have arrived and be in greeting range. `say_hello` must appear as a write in discovery, never as a harmless setup/read action. The default line is `Hello! Nice to meet you.`

`get_world_state` and `heartbeat_check` expose nearby contacts not yet introduced through this protocol, plus public places/opportunities. The world also queues durable, deduplicated encounter notices for the personal Muse, so a meeting is not lost while its runtime sleeps. A notice reports whether the peer is still nearby and does not itself introduce, greet or choose an action for anyone. They must not fabricate knowledge of unrecorded legacy meetings. A newly recorded introduction persists through restart, key rotation and display/appearance changes; IDs, not names, define the participants. Own-world factual memory may record that introduction, but private thinking remains in the personal Muse runtime. The tool does not generate a reply, pick a forced next action, call a team model for ComBba, or itself create a scheduler. Repeated autonomous thinking/action must be connected and proved in the actual personal runtime as a separate part of the complete product.

## Delivery and evidence

Implement in usable increments: conversation start, live spectator/door, genuine personal identity/onboarding, then sustained personal-runtime life. Each increment includes its relevant tests and clear remaining gaps; the whole product is incomplete until the complete flow works. Existing frozen observations run to completion without deployment changes. Original failures and historical evidence remain intact.

Hackathon submission, repository publication timing and the three-minute video belong to the team/demo team and are outside this work. The Muse directory intake is already submitted; neither this feature nor its tests authorizes another submission or new legal consent.
