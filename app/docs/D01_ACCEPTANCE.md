# D-01 product path acceptance

Status: **PREPARED — actual end-to-end acceptance remains PENDING**.

This is the D-01 working record for [the execution contract](../../docs/roadmap/task-execution.md). It does not replace the shared release acceptance or evidence index. No production authentication, write, claim, camera capture, revocation, upload or submission is authorized by this document.

## Current evidence boundary

The default [product observer](../scripts/product-e2e.browser.js) runs two fresh browser contexts (desktop and phone), disables service workers, starts without stored credentials and performs public GETs only. It observes the initial page, actual server Muse IDs and selection, source labels, owner-inbox denial and anonymous reconnect. Identity/claim/ritual UI is not opened: its claim-status GET can recheck Threads and persist authorization state. Screenshots show only the public Feed. Its report always says `acceptedD01: false`.

A request guard rejects every non-GET, effectful claim GET, model/MCP endpoint, unknown API and off-origin request except the existing OpenFreeMap asset host. It does not click account, ritual, approval or revocation controls. A refused application write or attempted effectful claim GET is a failed observer case, even though transport was blocked. No synthetic 200, claim snapshot, blank key or fabricated credential substitutes for the excluded identity flow. The callback strips entry URL query/path and logs method/origin/path only. It retains no cookie, authorization, private response, webcam frame or private condition. Run it through a Playwright callback host with an existing page at the approved product origin or loopback origin; screenshots use the host's `output/` directory. No production write mode exists.

Default production origin is `https://musely.net/`. Loopback defaults to `local-read-only`; pass `{environment: 'local-fixture'}` for locally fulfilled synthetic data. Origin/environment mismatches fail before a browser context opens. Other inputs are rejected except an optional operator-attested release pin.

## Same-build evidence contract

An operator supplies a release tuple, never inferred from local main or a successful HTTP response:

```json
{
  "releaseSha": "<40 lowercase hex>",
  "deployId": "<redacted deployment reference>",
  "configVersion": "<redacted configuration reference>",
  "baseUrl": "https://musely.net/",
  "htmlSha256": "<64 lowercase hex of served HTML>"
}
```

The callback additionally requires `operatorAttested: true` if `releasePin` is supplied, checks the served HTML hash, and reports that SHA/deploy/config remain operator-attested. HTML equality alone does not bind every asset, Worker or runtime configuration. The release must be independently reconciled with deployment output and its artifact manifest. An absent pin is explicitly unverified.

[auditProductEvidence](../scripts/lib/product-e2e-evidence.mjs) checks redacted receipt envelopes. Its fields are our evidence metadata, not a claim about Muse platform response fields. Each envelope has `step`, `provenance: connected-real`, the exact `release` tuple, UTC `observedAt`, an opaque `artifactRef` and `artifactSha256`. Optional `actorRefs`, `requestId`, `challengeId`, `verdict`, `framesStored`, `approvalRefs`, `taskId` and `revision` are allow-listed. They must be sanitized references, never real account names, credentials, private conditions or raw upstream responses. Unknown fields are rejected. The referenced redacted artifact still requires an independent human audit; this helper always returns `acceptedD01: false`, even for complete consistent metadata. Every real step stays in `pending`; `missingMetadata` only identifies absent envelopes.

Webcam evidence requires one actor, challenge/request references, a passed verdict and `framesStored: false`. This is metadata validation and does not prove a physical camera was used. Two-owner approval requires two distinct actor/approval references for the same task and positive revision; the auditor must check the actual authenticated decisions, selected candidate, event/input/signature linkage and reward. Separate observers and a synthetic second actor cannot establish two real owners.

## Required operator runs

A concrete separate root execution plan must identify the release tuple, isolated real sessions, actual account/Muse connection, allowed endpoints/actions and cleanup boundaries before any production write. Execute and inspect each path on that same build. Do not substitute a previously recorded ritual or replay for a new person, or trial delegation for a connected Muse.

| Required path | Current state | Completion evidence |
| --- | --- | --- |
| Watch → select | Prepared observer; executed results below | Public page/GET/source/selection report, identified environment |
| Claim / own Muse connection | Pending | Real account/platform receipt and world identity, same release |
| New person's webcam ritual | Pending | Physical camera verdict/request/challenge metadata, no raw frames |
| Activity | Pending | Connected Muse action → world event/input/request/signature evidence |
| Real connected Muse inbox → response → world | Pending | Platform connection and actual MCP/request/response/commit linkage; trial separate |
| Coordination / both owners approve / reward | Pending | Distinct real owner sessions, same task revision/candidate and reward commit |
| Revoke | Pending | Authorized revocation and stale credential/refusal evidence |
| No agreement / one refusal / changed candidate / expiry | Pending | Separate sessions and actual state transition/refusal receipts |
| Reconnect | Observer covers anonymous authority boundary only | Same authenticated real owner/Muse session recovery still pending |

A failed or unavailable step stays failed/pending with cause and unblock condition. An envelope is not a PASS receipt. Replay proves recorded public state and cannot recover private state. Read-only status or claimed identity alone does not prove that a real Muse has been added in the platform.

## Reused validation tools

| Tool | Valid scope and limitation |
| --- | --- |
| [owner inbox browser](../scripts/owner-inbox.browser.js) | Locally fulfilled UI/auth fixtures; no real owner proof |
| [MCP integration](../scripts/mcp-integration.test.mjs) and [TLS Worker fixture](../scripts/test-support/https-world.mjs) | Actual local Worker/WorldDO, ephemeral keys/SQLite/signature path; no real account or model |
| [ritual browser](../scripts/ritual.browser.js) | Synthetic camera and active model/auth/write flow; excluded from default observer; separate authorization required |
| [replay browser](../scripts/replay.browser.js) | Actual writer fixture/public-state playback and write-zero checks; recorded provenance |
| [owner-control regression](../scripts/owner-control.test.mjs) | Local state/auth model; not production owner receipt |

## Original preparation validation at afa620f5 (before readonly guard repair)

- Node 24 `npm run check`: **460/460 PASS**, typecheck/build/Worker dry-run PASS on the D01 preparation source (no deployment).
- New offline evidence and guard regressions: **13/13 PASS**. Initial absent-module RED was retained before the evidence contract implementation.
- Chromium 156.0.8078.76: **26/26 PASS**, 1280×800 and 390×844. Actual local TLS Worker → WorldDO → SQLite fixture; temporary synthetic setup keys/claim, no real owner/Muse/model/deployment. Observer API calls: 38 GET, POST/model/MCP/page-error/blocked requests: 0. Browser and local servers closed afterward. Screenshots and report are fixture evidence only.
- Browser artifact names: `d01-browser/results.json`, `d01-browser/output/product-e2e-anonymous-{A,B}.png`; full-check log: `d01-full-check.log`. These are private execution artifacts supplied with the handoff, not public real-user receipts.
- Final release tuple, actual account/Muse/webcam and both-owner artifacts: **unverified / absent**.

These results establish preparation and local regression coverage only. D-01 remains open until the required actual receipts and same-build operational proof are audited.

## Readonly claim-refresh repair

The original local fixture made two GETs to `/api/claim/owner-muse` when opening Identity. In production that GET can read a stored Threads token, recheck a stale post and persist `setClaim` (including claim revocation). Its absence of HTTP POST was not enough to establish an effect-free observer. The default observer now blocks that endpoint, avoids the Identity tab, and explicitly fails its guard if such a GET is attempted. It does not modify Worker/runtime behavior or replace the response with a fake claim. Feed/source/selection/protected-inbox and anonymous reconnect observations remain real GET paths; claim, ritual UI and all 13 human receipt checks stay pending. The metadata helper still never authenticates a receipt or accepts D01.

The original 26-case fixture report above is historical evidence from the previous source, not proof of the repaired callback or an actual account. The repair's fresh offline/full/browser logs and exact source hash are retained separately with the source pin; any subsequent fixture run remains local-fixture evidence, not production/real-owner/Muse/webcam acceptance.

Fresh repair validation after merging main `4dfac70`: offline evidence/guard **14/14 PASS**, independent original claim-GET reproduction **1/1 GREEN**, and full `npm run check` **487/487 PASS** plus typecheck/build/Worker dry-run. The repaired actual local TLS Worker/WorldDO/SQLite fixture ran desktop and phone Chromium **25/25 PASS**: observer API GET 30, claim GET 0, API writes 0, MCP 0 and backend provider-fetch attempts 0. The fixture setup separately used two synthetic MCP reads; those are neither observer calls nor real-account proof. The exact copied callback matches this source. All 13 human gates remain pending, `acceptedD01: false`, and no production request, authentication or deployment was performed.
