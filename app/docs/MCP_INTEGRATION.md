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

The original bearer key is also re-read after signing and again inside the commit guard. Revoking it during a peer-card await refuses the in-flight action before nonce or command storage; another active key for the same Muse does not revive that revoked credential.


## Final I-13 and I-03B acceptance handoff (2026-11-03)

The earlier local-only/no-production statement records its original checkpoint. Subsequent operating evidence and independent acceptance audit cover I-13 #57's five criteria and I-03B #50's three criteria. Original source references, failures, local fixtures and pending receipts remain intact. I-13 handoff precedes I-03B closure under C06. Personal Muse client use remains I-04.

Local transport-to-commit records contain **29 fixtures / 304 HTTPS messages = 301 tools/call + 3 tools/list**, covering all20 types and16 signed writes. The localhost TLS server exercises Worker/WorldDO/SQLite/ES256/JCS handlers with synthetic identities/items; it is not a Cloudflare or Meta-account run. Current scoped Worker/engine/MCP/messages/tasks/command source is unchanged from the later600-test check, and candidate494 equals the tested610-check tree. Original I-03B reviewed blobs match11/11; I-13's corrected dirty manifest matches16/17 against its integration, with only an EXPERIENCE_MATRIX document difference. No whole-file equality beyond that comparison is claimed.

Actual HTTPS dispatch smoke is **20/20 tool types**, assembled from historical receipts plus two new operating stages. This is not twenty new positive actions on494. A signed rule refusal counts only as that dispatch path; auth/schema/unknown-tool rejection is not successful tool smoke.

| Tool | Operating receipt scope |
|---|---|
| register_agent | Original8b13 owner150 authenticated registration |
| get_agent_card | Current494 actual1 positive server card verdict |
| get_world_state | Current494 own-state reads; cleanup401 is separate |
| heartbeat_check | Current494 own Task/message/deadline projections |
| move | Current494 Copper walk; Ember already_here refusal separate |
| discover | Current494 Invite Token discovery |
| craft | Current494 needs_three_bus_stops_today business refusal only |
| greet | Current494 signed greet-apply injection_blocked business refusal only |
| propose_trade | Current494 actual2 new Tasks21/22; earlier travelling refusal retained |
| counter_trade | Current494 actual2 task22 positive |
| accept_trade | Current494 actual2 task22 completed; one tea/coffee swap |
| reject_trade | Current494 actual2 distinct task21 rejected |
| send_postcard | Historicalce3a nonself HTTPS send and later m_9 delivery |
| give_gift | Current494 Copper→Ember Spark1; then consumed by repair |
| propose_meetup | Original8b13 owner150 task_f proposal |
| answer_candidate | Original8b13 owner150 bilateral candidate responses |
| invite_campfire | Current494 invite_1u; separately observed three-Muse gathering |
| propose_help | Current494 actual2 new task20 |
| answer_help | Current494 task20 completed; held part/result/about counts verified |
| update_wants | Current494 actual1 preserves current public wants |

I-13 evidence combines local success/refusal/deadline/idempotency/quotas and original three RED→GREEN corrections with the following operating results:

- Historical Ember→Sunny postcard is delivered as m_9 in the preserved public snapshot, at deliver_at+1397ms, read=false. Receipt at the destination is not a recipient read-ack. The2-hour clamp and duplicate/daily limits retain their local branch evidence.
- Actual1 creates invite_1u at event5944/input765 with a30-minute deadline. A later existing observer sample records one gathering event5963/input770,86.385s later: Ember/Copper/Sunny, Copper accepted via live and Sunny via resident rule. Sixteen tail appearances are one event. Original actual1 gathering=false remains the result of its earlier window; no new invite or forced travel is used as its replacement.
- Actual2's normal Spark gift changes Copper1→0 and Ember0→1. Help task20 then changes part1→0, Repaired Gadget0→1 and held Brass Lantern1→1; event6115/input807 records reflections-present boolean and accepted_via=live. Reflection bodies are not retained.
- Distinct trade task21 is proposed/rejected before task22 is proposed/countered/accepted. Tea/coffee counts verify one swap. Gift/help/trade events6111/6115/6120 join input802/807/812 and item-history sequences72/73/75.
- Each of the two MCP operating stages creates one temporary Copper test key, deletes only that validated new key, and confirms fresh same-key HTTP401/RPC−32001. This series total2 excludes earlier owner150/P0 key history. Existing Ember keys/delegations remain unchanged; no Jolly key or Meta permission is created here.

Current494 is `4946517bbad0ec7677edd73205d7b4390dbdc4e5`, deployment `359cb5c5-dff3-4153-ae58-b36412e0cdd9`, Worker `e10feb65-a7a2-463e-8537-7b1a876ed182`, configSHA256 `893a8e4ffd2857d25032a6454363134a2329a00a3e71f4e83c56413233df9e10`, frozen backend bundle `bf4d985ce91a6f861b047d8a526a64f5de3bf2470fe9db4b488316dee0908b5a`. Original8b13 owner receipts and ce3a postcard receipts keep their source/deployment identities. Postcard source differences are later self-target refusals, inapplicable to that nonself send; later claim/bearer checks retain separate current-source regression evidence.

Actual1 has29HTTP. A separate unavailable stationary preflight has1GET/auth0/key0/MCP0; a later new GO after observed arrival performs actual2's31HTTP/19.607s, including cleanup. Related harness total61 is not the whole project/observer/identity traffic total. Actual2's GO binds the23:01:29.537Z root CLI/source/full-HTML attestation and has a separate23:03:59.243Z end attestation, same494/359c/e10f/config/HTML. The API is not an independent deployment-UUID endpoint, and the remote executable was not downloaded again.

Evidence custody is external `tasks/s3-execution-20261102/`: `s2-final-mcp-actual-1`, `s2-final-mcp-stationary-actual-1`, `s2-final-mcp-stationary-actual-2`, `s2-final-mcp-observed-gathering-1`, and `s2-final-mcp-stationary-actual-independent/TOOLS20.md`. Final acceptance audit `s2-i03b-i13-final-acceptance-review` passed94/94 offline checks over100 retained inputs; manifestSHA256 `4bd7b4a0007951bfaf8058005340d87278cd2ca89d1f9bc858081d9991c55de6`. These are offline receipt/hash checks, not94 new runtime tests. A root recheck overwrote one derived23-reference list; exact original5764-byte/hash737ea937… restoration and original six-file manifest equality are recorded separately, with actual receipts unchanged. Original writing check.py is preserved; the separate check-v2 defaults to read-only.

Greet's original verifier FAIL assumed every command increments world version. Its1134→1134 refusal and the separate offline correction remain retained. The projected response did not retain step; its apply/business classification comes from the actual handler/event path. Stored verified server verdicts, command/event/input/hash pointers and observed counts are not independent cryptographic re-verification, a controlled causal experiment excluding all concurrent changes, personal Muse app use, two real people, new model calls or whole S3 acceptance. Helper accepted=false flags remain unchanged; final C10/checklist handoff belongs to #57 then #50.

Implementation/API semantics remain in [MCP tools](MCP_TOOLS.md). [Experience mapping](EXPERIENCE_MATRIX.md#i-13-and-i-03b-operating-evidence-handoff-2026-11-03) and the [contract handoff](../../docs/roadmap/execution-contract.md#i-13-and-i-03b-evidence-handoff-2026-11-03) connect the accepted output. This documentation update changes no product runtime, frozen494/collector3105 or deployment.
