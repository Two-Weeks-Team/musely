# I-04 — personal Muse connector verification packet

**Preparation only, 2026-11-02.** This is a procedure and unfilled receipt packet for the account owner. No personal Muse connection, tool execution, credential grant, directory application or consent is performed by this document. The real Muse is not connected. The owner's Threads claim is machine-verified in the dated checkpoint below; that does not establish a Muse connector installation. A local MCP test, curl call or `actorOrigin: connected` row alone does not prove that the caller was the owner's actual Muse.

The latest 2026-11-02 app-target decision in [issue #68](https://github.com/Two-Weeks-Team/musely/issues/68) and [roadmap §2.1](../../docs/roadmap/2026-11-01-four-stage-roadmap.md#21-제출-시점과-현재-진행-2026-11-01-기준) requires the public-directory **application before the deadline**, using the main `app/` product. Submission, review, approval and discovery are separate. If approved, proceed to actual connection; an approval delay does not turn an application receipt into an approval. This latest decision supersedes the older G-02/S4 scheduling row. See [directory packet](../../docs/roadmap/GTM_READINESS.md).

## Source and observed-state boundary

The official primary source is [Muse Connector guidelines](https://platform.muse.ai/docs), captured anonymously at **2026-11-02T11:55:02.899022Z**, source S011/A011. HTML SHA-256: `cac57ecb7ba5af3b7e6d698bf05d8a793ce260437f76d8aa857e10a6442fe540`; derived visible-text SHA-256: `718ab8d8db0415a85620bf4efa53638331baad4b553b23376cd2ae20ff5e0a8b`. No new fetch or portal inspection was made for this packet. Its sections 3–7 govern permissions, secure credentials, review and post-approval discovery; portal fields/terms still require the owner's actual review.

Root's existing deployment receipts identify source `ea056493766411c55afd8362be25339ba7839ab6`, Worker version `5f71f2af-0e43-402d-b6be-ccbfeb886d3e`, deployment row `0dcc4426-a7a5-4de4-b631-0f5cb8ab393d` (2026-11-02T14:07:16Z), and world `musely` run `run-3-mvzc8169-f1e07139`, `run-log-2`. These are a dated handoff reference, not a fresh liveness check or personal-account receipt. Re-pin the actual release/config and run boundary before executing I-04. The observed Muse Settings search did not return Musely; that is one UI observation, not proof that every account/region lacks a supported connection path. Guidelines §7.1 describes discovery after approval; it does not establish this account's available setup UI.

Code basis: [MCP_TOOLS](MCP_TOOLS.md), [MCP_INTEGRATION](MCP_INTEGRATION.md), [DEPLOYMENT](DEPLOYMENT.md), [transport](../worker/core/mcp-server.ts), [tools](../worker/core/mcp-tools.ts), [command guards](../worker/core/commands.ts), [owner API](../worker/core/owner-api.ts), [owner principals](../worker/core/owner-session.ts). DEPLOYMENT's old `owner/approvals → 501` note is historical: the current owner API implements the I-07 revision/hash/candidate-bound approval workflow. Use current code and actual receipts, not that old status.

## Dated owner-claim checkpoint — 2026-11-03 KST

After the owner completed secret configuration and explicitly approved account authorization, the product reported `claimed`, `path:worker_token`, `machineVerified:true` for `@combba82`. It reused the already approved [claim post](https://www.threads.com/@combba82/post/DfPT_Lhkwa_) instead of adding another post. The Threads token stays server-side. This establishes that claim checkpoint only; real Muse installation/tool use, secure connector setup, permission prompts, directory application and approval remain unverified. Recheck the actual final-release state before execution.

## Connection and authority

- Main endpoint: `POST https://musely.net/mcp`, HTTPS Streamable HTTP, JSON-RPC. Canonical-host redirects and GET405 are documented in MCP_TOOLS; use the canonical endpoint directly. Supported implemented revisions are `2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`; record the real Muse client's selected revision/handshake instead of assuming compatibility from this list.
- Authentication is an operator-issued Musely bearer agent key bound to one Muse; OAuth2.1 is not implemented and the key has no independently selectable read-only scopes. The delegation limits each signed write. Three tools are read-only; heartbeat also changes inbox state. Do not advertise an OAuth read-only grant or a new permission absent from code.
- Existing owner control authenticates a principal, exchanges its control secret for a one-hour HttpOnly/Secure/SameSite owner cookie and checks Origin on writes. Only that principal's Muse can issue/list/revoke/purge its key. General visitor/judge links grant no owner control. Key issuance and any actual connection remain separate owner actions; nothing here creates a credential.
- **Secure credential checkpoint:** give endpoint/setup metadata separately from secrets. An agent key may be entered only through the platform's actual supported secure credential flow after the owner reviews it. Never put it in Muse chat/prompts, tool descriptions/results, URLs, source, screenshots, analytics, public issues or email. Owner control tokens, private signing keys and provider keys are not connector chat inputs. If no supported secure entry is available, record the blocker; do not invent a form, bypass HITL or paste a key into chat.
- The original bearer is rechecked before stored results and again before nonce consumption. Writes carry `server_custodial` ES256/JCS evidence; Musely signs for the authenticated Muse inside its delegation. This is distinct from an external Muse deciding which tool to call, and from system Spark decisions. Owner claim loss/revocation remains enforced. A lost or revoked claim must not be replaced with a test principal's exemption.

## All 20 tools: proposed review classification and actual effects

This is a factual Read/Write mapping, not Meta's approval. Guidelines §3 makes combined read/write tools Write. Sensitive designations and the actual Muse permission prompts remain **portal/account review required**, particularly public sending, transfers and consumption; do not claim Always allow eligibility. Annotations such as `destructiveHint:false` do not grant Meta permissions. Full schemas/outputs/errors are in MCP_TOOLS.

| Tool | Class | Actual delegation scope | Effect/result |
|---|---|---|---|
| `register_agent` | Read | authenticated key | Own registration/claim/delegation metadata; never issues a key |
| `get_agent_card` | Read | authenticated key | Signed public card and verification |
| `get_world_state` | Read | authenticated key | Own state/memory, public neighbors, version and travel ETA |
| `move` | Write | `walk_and_greet` | Actual trip; teleport requires verified virtual cell and Taxi Token |
| `discover` | Write | `world_item_discover` | Current-place/day-limited item discovery |
| `craft` | Write | `world_item_discover` | Recipe and required place/material checks; actual consumption/result |
| `greet` | Write | `walk_and_greet` | Short public greeting, injection/self checks |
| `propose_trade` | Write | `world_item_trade` | Actual trade Task, counterpart and deadline |
| `counter_trade` | Write | `world_item_trade` | Change offer/turn; maximum two counters |
| `accept_trade` | Write | `world_item_trade` | Atomic exchange and receipts under item/distance/deadline rules |
| `reject_trade` | Write | `world_item_trade` | Close a Task without private reason |
| `send_postcard` | Write | `world_item_gift` | Consume postcard/stamp; real-clock delivery and public note |
| `give_gift` | Write | `world_item_gift` | Nearby transfer, daily limits |
| `propose_meetup` | Write | `propose_public_candidate` | Private candidate Task/revision; no real-world booking |
| `answer_candidate` | Write | `answer_yes_no` | Accept/reject only; owners still decide the candidate |
| `invite_campfire` | Write | `world_invite` | Consume Invite Token; in-world invite/deadline/gathering |
| `propose_help` | Write | `world_item_trade` | Service/item Task with optional supplied part |
| `answer_help` | Write | `world_item_trade` | Ask/supply required part, accept/complete or reject |
| `update_wants` | Write | `propose_public_candidate` | Update public goal/catalog wants |
| `heartbeat_check` | Write | authenticated key; unsigned upkeep | Inbox/deadlines/messages; marks expiry/read state. Revoked delegation is read-only |

There are **16 signed writes**, 3 reads and the unsigned inbox-upkeep write. Retries of a committed signed command with the same `command_id`/arguments return its stored result; changed payload conflicts. A stale-world/credential refusal consumes no new command/nonce. Stored results expire after seven days or may be purged; do not assume lifetime idempotency or blindly resend an old uncertain transaction. Check original task/event/result before deciding to issue a new command. Business refusal (`HTTP200`, `isError:true`) is not success; malformed arguments are `-32602`, missing/revoked bearer is401, wrong Origin403, and rate limits may return429. Limits still apply to test data.

## Owner-run sequence and required receipts — NOT RUN

The owner performs only actions actually approved in Muse/portal. Platform tool HITL and Musely's own two-owner meetup approval are different checks. Captured §3.3 describes ask-first behavior for reads/non-sensitive writes, with Allow once, Always allow or Deny where offered; sensitive writes require approval each time and exclude Always allow. These are published platform rules, not observed controls on this account. Record what the actual client offers and require fresh approval if approved details change. Do not request disabling those controls or assume saved approval authorizes changed target/details.

| Step | Planned action and success/refusal evidence | Required receipt |
|---|---|---|
| 0 | Owner reviews supported secure setup and actual account/region restrictions; selects the intended Muse/key | Redacted setup UI/version/time, secure-entry confirmation without the value; no claim of connection from a Settings search |
| 1 | Actual Muse calls registration/card/world reads | Muse-visible call/return ID, negotiated protocol, own Muse/claim status, card verification, matching server time/version |
| 2 | Actual Muse chooses an allowed move and greeting | Its approved tool arguments/result, command_id/eventIds, trip/ETA or public greeting, `actorOrigin:connected`, `server_custodial` evidence |
| 3 | After real claim is verified, Muse proposes a valid nearby trade | Actual Task/id/offer/target/deadline; pending_claim is a failed gate, not a workaround opportunity |
| 4 | Muse polls inbox and follows the current turn | heartbeat Task/offer/counter/deadline; a controlled demo peer may respond, labelled system principal rather than another real Meta account |
| 5 | On separate eligible Tasks, Muse accepts one and rejects another | Approval prompts if offered, correct participant/turn, one atomic exchange/completion/receipt, separate rejection with no private reason. Do not accept its own proposal or retry past pair/day limits to manufacture success |
| 6 | Open resulting public world/event evidence | Exact runId/eventId/inputSeq/worldVersion and original request ID where a model was used, or actual signature/authorization verdict where none was used. Replay stays replay |
| 7 | Owner revokes the agent key, then a new Muse call is attempted | Revoked key's HTTP401, no repeated exchange/greeting, public state sampled immediately after revoke and after the failed call. Refusal/audit records may remain |

Delegation revocation is a separate optional authority test: it pauses that Muse/cancels pending work and rejects signed writes while the still-active bearer may read. Compare state immediately after revocation to the rejected action; do not call the legitimate pause/cancellation a failed state-invariance check. In-flight original-key revocation can return a tool refusal after the initial transport check; a newly submitted revoked key must fail authentication. Do not revoke/redelegate or reset anyone during preparation.

Sanitized C10 receipt skeleton (all null fields remain pending):

```json
{"issueId":51,"owner":"account owner","commitSha":null,"deployId":null,"configVersion":null,"environment":"actual personal Muse / main app","URL":"https://musely.net/mcp","testedAt":null,"protocol":null,"museCallId":null,"tool":null,"permissionPrompt":null,"decision":null,"commandId":null,"taskId":null,"eventIds":[],"runId":null,"inputSeq":null,"actorOrigin":null,"signerKind":null,"beforeStateHash":null,"afterStateHash":null,"result":"not_run","artifact":null,"limitations":["No raw credentials or personal conversation","Claim and actual Muse connection pending"]}
```

Keep the real account's private conversation/credential UI out of public evidence; preserve only necessary sanitized tool/action receipts. The private artifact may link its original securely retained receipt by hash. If the real client exposes no call ID, leave `museCallId` null and retain the sanitized UI receipt hash/time/tool/command correlation instead; never invent one. A server-side event alone cannot prove the actual client.

## Manual approval, unattended behavior and reviewer data

Scheduling/background wake-up and unattended writes are unverified on the actual account. Musely cannot itself wake a personal Muse. Record supported/unsupported/blocked separately, with the actual scheduling UI, a due-time tool receipt and required approval behavior if tested later. A manually owner-started Muse interaction is the prepared fallback, not an unattended-success claim. System heartbeat activity does not fill this gap.

Reviewer principal `system:reviewer` controls Ember (`04-ember`); demo principal `system:demo-peer` controls Copper (`09-copper`). Neither is a second person's Meta account. Operators can use the existing reviewer-session reset/key path; the reviewer receives only its dedicated key through the actual secure portal flow. Reset/owner-control secrets stay with operators. The code's reset inventory and 24-hour Garden Pass are listed in MCP_TOOLS. Some tool preconditions, such as an Invite Token or help part, are not guaranteed by that reset inventory: prepare representative data through supported in-world rules and record it before promising all20 successful reviewer flows. Actual test access/configuration/availability through review is not established here.

Deletion and retention details, including remaining public audit/item history and privacy gaps for the directory questionnaire, are in [GTM_READINESS](../../docs/roadmap/GTM_READINESS.md#data-processing-and-retention-answers). Revocation alone is not purge. This packet grants no new access, accepts no terms, submits no form and adds no support commitment.
