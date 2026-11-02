# MCP integration acceptance (I-03B #50)

`scripts/mcp-integration.test.mjs` opens a real, certificate-verified **localhost HTTPS connection** to the Worker entry, then calls the product `WorldDO`, `ConnectedHost`, ES256/JCS checks and `WorldRuntime` transaction. It uses generated fixture credentials/claims, independent owner cookies and `node:sqlite`. Only the `cloudflare:workers` base class and storage are substituted. No model credential is configured. This is local integration evidence; it does not prove workerd, production deployment, a real Threads claim or a real Muse-account call (I-04).

Run from `app/` with Node 24 and OpenSSL:

```sh
npm run check
# Optional redacted TLS/command evidence outside the source tree:
MCP_SMOKE_EVIDENCE=/absolute/local/evidence node --test scripts/mcp-integration.test.mjs
```

The fixture (`scripts/test-support/https-world.mjs`) trusts only its temporary certificate and removes it and its private key on cleanup; it never disables TLS verification globally. Every fixture closes its HTTPS server, client agent and SQLite database, including after an assertion failure. Optional evidence records protocol/tool, verified TLS, HTTP/RPC/refusal codes and returned command/envelope IDs. Arguments, bearer credentials, cookies and control tokens are excluded.

## Complete tool matrix

All 20 tools run over TCP/TLS. Every signed write has a successful commit and a same-ID retry with the original envelope and no repeated domain effect/event. All 16 signed writes refuse missing delegation scopes and revoked delegations. All 20 reject actor/owner/signed argument spoofing and revoked bearer keys. Strict argument errors use JSON-RPC `-32602`; schema-valid business refusals remain tool errors.

| Tool | Success and correlation | Extra behavior/refusal |
|---|---|---|
| register_agent | caller Muse, claim, custodial signer metadata | read only; no key issuance or secret returned |
| get_agent_card | own/Jolly signed card verifies | private signing material absent |
| get_world_state | own inventory, memory, place, version | other Muse's private memory absent |
| heartbeat_check | trade/counter, meetup, help, invites, received messages/deadlines | expiry, read once, revoked read-only mode |
| move | actual trip/ETA | shared scope/revocation/version checks |
| discover | current-place item | duplicate makes no second discovery |
| craft | garden Bloom, seed consumption | duplicate grants nothing more |
| greet | all nine connected fixture peers address Jolly | self and wrong signing key refused |
| propose_trade | connected Task and deadline | self, claim and late claim withdrawal refused |
| counter_trade | connected counters both directions | max two, wrong turn, expired Task |
| accept_trade | atomic swap/one receipt each/one completion | expired Task; claim/delegation withdrawal during await |
| reject_trade | closed Task | no private reason input; expired Task |
| send_postcard | both directions including Copper→Jolly, stamp and delivery | self refused; inbox note wrapped as untrusted data |
| give_gift | both directions including Copper→Jolly | self refused; retry survives WorldDO restart |
| propose_meetup | Copper→Jolly candidates | self and pending claim refused |
| answer_candidate | both yes responses, owner approval stage | accept/reject only, no reason, expired Task |
| invite_campfire | Invite Token spent, invitation open | self_invite and 30-minute expiry |
| propose_help | connected helper Task and deadline | self_help; Jolly has no_help_service, not a schema error |
| answer_help | need_item → requester supplies → helper completes | no reason input; expired Task |
| update_wants | caller-owned public goal | no actor/owner/signed override |

The existing suites remain part of the full check: `mcp.test.mjs` (protocol/auth/rules), `tasks.test.mjs` (migration and dual-owner approval), `messages.test.mjs` (quotas/help/gathering), `command-runtime.test.mjs` (binding, replay, atomic rollback, concurrency and settlement). Their fixtures do not become actual-account evidence.

## Boundaries verified

- Peer schemas include every `HARNESS_IDS` member. Self checks use the authenticated current Muse before item upkeep. Reading one's own card is valid; peer actions require another Muse. Help/campfire keep their domain refusal codes.
- Signing retains request time. After async peer verification, MCP uses a fresh server clock for Task apply, own delegation/envelope expiry and peer credential currentness. An expired envelope consumes no nonce. Current claim is re-read before apply/upkeep; withdrawing it during the await cannot authorize a later write. Reviewer-only claim exemption remains separate from another Muse's card.
- Refusal assertions compare inventory, movement, wants/memory, item ledger, Tasks, mail and messages. A rule refusal may store its command result/refusal evidence; this is not a successful action. Scope/signature refusals create no command row or nonce.
- Stored command event IDs, message ID, tool, actor origin and returned version are checked against actual committed events. Restart preserves retry results; changed payload conflicts; stale version can retry with the same ID and a fresh version.
- Both owner sessions approve the same Task revision/content hash/candidate; `meetup_confirmed.approval_refs` match the stored decisions. Wrong owner/hash/candidate cannot confirm. Repeating a decision grants no extra Ember. Candidate time/private reasons are absent from public event/state/notification surfaces and remain in the owner's inbox.

No public-service deployment, production credential, model invocation, unattended schedule, 4-hour soak, external-world action or submission receipt is established here. D-01/I-04/D-03 retain those separate acceptance records.
