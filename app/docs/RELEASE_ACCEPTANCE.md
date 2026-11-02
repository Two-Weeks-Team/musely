# D-02 release evidence

Issue: #62. Contracts: C04/C08/C09/C10 in `docs/roadmap/execution-contract.md`; implementation targets are `app/`. This document prepares evidence; it does not declare S3, deployment, an owner claim or a physical device accepted.

## Current gates

| Evidence | Prepared implementation | Acceptance still required |
|---|---|---|
| P0 | Actual local Trust signatures, WorldRuntime commits, owner revocation and fresh-nonce refusal; public state remains unchanged | The real owner claim is pending. No production P0/revoke/redelegate was executed by this task |
| P1 | Same engine initial state, seed, clock and public decision input; only Ripple's Transit Pass differs; recorded decision is controlled, no model called | Keep this causal simulation separate from any subsequently captured live scene |
| P2 | Scene descriptor → exact event/run/world/version → commit before/after hash → existing request reference or actual verification verdict | Capture the corresponding scene on the final release; a constructed local scene descriptor is not a production screenshot |
| Six measures | Raw event recount against independent UI/server implementations, source/origin splits, per-run values, duplicate handling, empty/missing/partial cases | Collect the same settled period on the final release and compare its actual server oracle and sample/run cohort |
| Release identity | C10 metadata and public GET collector prepared | Root supplies final release SHA/deployId/configVersion/URL and signals the measurement window |

## Local controlled evidence

Run from `app/` with Node 24:

```sh
node scripts/proof-evidence.mjs --out docs/evidence/d02-local.json
node --test scripts/proof-evidence.test.mjs
npm run check
```

The local generator uses fresh ephemeral test roots in an in-memory SQLite database. It never reads production credentials, creates a real owner claim, calls a provider or writes to the deployed world. The artifact labels its environment and limitations. Internal event source `live` means a real local signature/check occurred; the enclosing bundle is still **simulation**.

P0 compares the same semantic business content, target, actor, old delegation and scope. The second message has a new nonce and message ID. A changed world version can legitimately change the signed envelope content hash, so equal envelope hashes are not required. The refusal must be at the delegation step with `delegation_revoked`; daily/pair limits cannot substitute. The first trade must actually have committed, a separate revoke event must follow, and the public state immediately before/after refusal must match. The local full-state digests and the actual runtime `stateUnchanged` result must also agree; the private full body is not exported. No automatic re-delegation is performed.

P1 starts both runs from cloned identical full local engine state. It adds exactly one `transit_pass` to `03-ripple`, holds seed/time/public decision input fixed, and observes Bay travel refused without it and a bus departure with it. This is a controlled causal test, not a live model decision. Goals/private fixture fields are synthetic harness state; no person's private input is collected.

## Final release public-read collection

Only after root identifies the final release and measurement window, fill [the metadata template](evidence/release-template.json) and run:

```sh
node scripts/proof-evidence.mjs --collect --base https://musely.net --meta /path/release-meta.json --run RUN_ID --from FROM_MS --to TO_MS --scenes /path/captured-scenes.json --out /path/release-public-records.json
```

A captured scene entry contains `classification` (`live` or `replay`), `worldId`, `runId`, `eventId`, `version` and `snapshotHash`. Use the selected event's actual checkpoint, not an unrelated current state. Replay stays labelled replay; a rule/signature event gets its real verdict, never an invented model request ID.

The collector has a fixed same-origin allow-list: public GET `/api/world/run`, `/api/world/events`, `/api/world/event`, `/api/world/autonomy`. It omits credentials and rejects redirects, owner/session/provider/MCP paths and other origins. It reads a frozen run boundary, pages by event sequence, filters `[from,to)` locally, and records URL/time/status/body hashes. A page/count failure or bounded collection is partial. Equal six displayed values are insufficient: oracle world, period, run cohort and event sample must agree. These APIs do not themselves attest deployId; root's deployment receipt binds the supplied release metadata.

No production POST, owner-root/claim setup, new authentication, provider/quota consumption or fault injection is authorized by this collector. A missing scene, actual owner P0, release receipt, physical-device proof or four-hour run remains pending. A local pass cannot fill those gaps.
