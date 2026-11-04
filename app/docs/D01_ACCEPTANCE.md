# D-01 product path acceptance

> Latest status: [PR209/210 scoped path follow-up, 2026-11-05](#pr209210-scoped-path-follow-up-2026-11-05). D01 remains open; earlier dated results and failures retain their original source.

Status: **PREPARED — actual end-to-end acceptance remains PENDING**.

This is the D-01 working record for [the execution contract](../../docs/roadmap/task-execution.md). It does not replace the shared release acceptance or evidence index. No production authentication, write, claim, camera capture, revocation, upload or submission is authorized by this document.

## Current evidence boundary

The default [product observer](../scripts/product-e2e.browser.js) runs two fresh browser contexts (desktop and an emulated phone viewport), disables service workers, starts without stored credentials and performs public GETs only. These are observer viewport cases, not a D01 physical-phone requirement. The actual personal-Muse/device-permission reference is a MacBook with Muse installed. The observer covers the initial page, actual server Muse IDs and selection, source labels, owner-inbox denial and anonymous reconnect. Identity/claim/ritual UI is not opened: its claim-status GET can recheck Threads and persist authorization state. Screenshots show only the public Feed. Its report always says `acceptedD01: false`.

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

Webcam evidence requires one actor, challenge/request references, a passed verdict and `framesStored: false`. This is metadata validation and does not prove a physical camera was used. Two-owner approval requires two distinct authenticated principal/approval references for the same task and positive revision; the auditor checks actual decisions, selected candidate, event/input/signature linkage and reward. C06 permits operator-controlled demo principals with separate sessions. Two real people or two Meta accounts are not D01 requirements. Local synthetic fixtures alone do not establish those actual authenticated decisions.

## Required operator runs

A concrete separate root execution plan identifies the release tuple, isolated authenticated sessions, actual MacBook/Muse connection, allowed endpoints/actions and cleanup before production writes. Execute and inspect each applicable path against its identified build and record reuse/impact differences. Do not substitute a recorded ritual for the owner's fresh MacBook webcam attempt, or trial delegation for actual personal-Muse use.

| Required path | Current state | Completion evidence |
| --- | --- | --- |
| Watch → select | Prepared observer; executed results below | Public page/GET/source/selection report, identified environment |
| Claim / own Muse connection | Recorded Threads claim exists; personal-Muse use pending | Preserve the dated machine-verified claim; actual MacBook Muse call/platform receipt and world identity remain separate |
| Owner's MacBook webcam ritual | Pending | Actual MacBook camera verdict/request/challenge metadata, no raw frames |
| Activity | Pending | Connected Muse action → world event/input/request/signature evidence |
| Real connected Muse inbox → response → world | Pending | Platform connection and actual MCP/request/response/commit linkage; trial separate |
| Coordination / both owners approve / reward | Operating two-principal records retained | Two operator-controlled authenticated principals are permitted; match the same task revision/candidate and reward commit, then assess final-source impact |
| Revoke | Operator authority/credential records retained; personal-Muse key test pending | Preserve existing revocations; after the actual MacBook Muse run revoke only its dedicated key and check401/public state |
| No agreement / one refusal / changed candidate / expiry | Operating independent-session records retained | Use each retained actual path's stated scope; source/build impact remains explicit, no second-person requirement |
| Reconnect | Operating authenticated-principal reconnect evidence retained | Keep anonymous observer and authenticated operator receipts distinct; compare source/build impact |

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

Fresh repair validation after merging main `4dfac70`: offline evidence/guard **14/14 PASS**, independent original claim-GET reproduction **1/1 GREEN**, and full `npm run check` **487/487 PASS** plus typecheck/build/Worker dry-run. The repaired actual local TLS Worker/WorldDO/SQLite fixture ran desktop and phone Chromium **25/25 PASS**: observer API GET 30, claim GET 0, API writes 0, MCP 0 and backend provider-fetch attempts 0. The fixture setup separately used two synthetic MCP reads; those are neither observer calls nor real-account proof. The exact copied callback matches this source. At that preparation checkpoint all13 receipt metadata steps remained pending, `acceptedD01: false`, and no production request, authentication or deployment was performed. Those historical helper flags are not a current requirement for13 new human actions.

## Direct MacBook and principal-basis correction (2026-11-03)

D01 and I04 use a **MacBook with the Muse app installed and that MacBook browser's location**. A physical phone, satellite-GPS proof and a second real person are not prerequisites. D04's already measured Pro18,2/S23 evidence remains intact. The requested actual browser permission checks are one MacBook device-location allow and one denial; raw coordinates stay on the device. The separate neighborhood-area change and its fresh release acceptance are still pending implementation here.

The existing [owner-workflow acceptance](OWNER_WORKFLOW_ACCEPTANCE.md) and [I07 final C10](https://github.com/Two-Weeks-Team/musely/issues/54#issuecomment-6589504329) retain operating Jolly/Copper independent principals and150 checks over confirmation, rejection, revision invalidation, candidate mismatch, actual deadline expiry, reconnect and key cleanup. Those are actual operator-controlled sessions, not two people's Meta accounts. They satisfy that principal/session distinction and may be reused within their source/impact limits; they do not establish personal-Muse use or a fresh webcam run.

The earlier blanket missing list that included a second person and physical phone/GPS is withdrawn as an added condition. D01 remains open for the actual MacBook personal-Muse/inbox/world path, fresh webcam, requested location permission cases, applicable remaining operating acceptance and full prerequisite handoff. The generic metadata helper remains non-accepting and its old receipt flags are preserved. Required human actions will be requested together only once the current implementation/procedure is concrete. D05/video and D06/submission belong to the demo team/team; this work performs no new preparation, execution or request for them.


## Current candidate path checkpoint (2026-11-04)

The [current S3 candidate record](RELEASE_ACCEPTANCE.md#current-s3-candidate-and-remaining-acceptance-2026-11-04) identifies a858/deploymentdb3261ea and supersedes the historical pending summaries only for the evidence explicitly listed there. This document's commit is not a new product deployment.

The unchanged anonymous observer actually ran25/25 on a858 at09:17:39.916–09:18:05.895KST: actual Muse selection, source legend, viewport fit, protected inbox401 and anonymous reconnect, two fresh contexts,154GET/errors0, four external analytics GETs blocked. Both browser Documents matched `fe4f089d…`; authored/Node-HTTP `50436d66…` is separate. Original callback SHA256 is `ccc350728e39bb729fff32d430a0ffd62816f8f17237f994858fb757098c977f`. Only screenshot output names were host-mapped to fresh prefixes. [Actual C10](https://github.com/Two-Weeks-Team/musely/issues/61#issuecomment-6618966328).

This is the watch/select/reconnect portion, not whole D01. Actual ComBba/Copper acceptance and connected activity are retained; own proposal/explicit rejection remain unobserved. Existing independent operator-principal approval/rejection/change/expiry/reconnect records retain their original build with current source-impact supplements. A new personal-account alias binding is on hold and is not a D01 prerequisite; no second person, physical-phone gate or Native internal scheduler UUID is added.

Actual camera execution and location allow/deny are finished: no repeat user request. The camera's retained LIVE3false/`productPassed:false` is not changed into identity PASS. Direct temporary-key200→revoke→401/public-state-invariant evidence remains a direct MCP test, not a second Muse-app connector completion. The observer's historical13humanChecks flags remain metadata limitations, not a fresh request list. D01 stays open for the original whole-path evidence/prerequisite judgment; four-hour observation is still incomplete at this checkpoint.

External artifacts: `final-d01-anonymous-observer/a858-final-1104-1-results.json` (SHA256`f9ff06ea458afed1d4bd24e4e63946583badf5d787a2497cc2262dc112df9096`) and uniquely prefixed screenshots in its existing `output/`; `human-ritual-living-final-actual-v7-ready-1/progress.jsonl`; `personal-muse-runtime-plan-1103/post-context-three-slots-1104.jsonl`; original `production-owner-flows/`. No camera frames, credentials or private conditions are copied into this index.


## Activated-world path limit (2026-11-04)

The [later activation checkpoint](RELEASE_ACCEPTANCE.md#world-life-activation-and-evidence-limits-2026-11-04) records merged/deployed135→137→138→139→140 and165ON:24NPCs/27total actors, with ComBba's permanent identity/key/schedule preserved and no personal decisions delegated to NPC policy. The earlier a858 anonymous25/25 remains evidence for that source; activation does not establish the new build's complete personal path.

D01 remains open, including the remaining #51 choice/response evidence; NPC actions or Task expiry are not ComBba's proposal/rejection. The a858 four-hour run stopped incomplete; the old13:04 freeze is historical, and a new final-build four-hour result is still needed. Camera/location outcomes above are retained without another human request. C3 account adoption remains on hold, not a D01 prerequisite.


## M4 path evidence update (2026-11-05)

This dated update supersedes the earlier pending-camera/C3-hold descriptions, not their original failure records. It is documentation of existing evidence, not a new browser, account, camera or model execution. [D01 remains open](https://github.com/Two-Weeks-Team/musely/issues/61).

- **Anonymous watch/selection/reconnect:** the [a858 run](https://github.com/Two-Weeks-Team/musely/issues/61#issuecomment-6618966328) passed 25/25 with 154 GETs and no writes. It retains its a858 source/deployment; it is not a new final-build run.
- **Actual camera:** [PR188 owner LIVE pass](https://github.com/Two-Weeks-Team/musely/issues/61#issuecomment-6627920486), source `6955722e24403943b6cca7c395a47bbf4a15f4a4`, Worker `cf9532ed-55b4-4c79-bb8f-1136530c68e9`, ROW `e26a677a-418c-4717-b700-248522fbc05f`. At 2026-11-04 18:55:58.842 KST, event 18945/input 3288/run `run-14-mw1u1bcm-0b2cd79c`: body-only three steps passed, source live, framesStored false. The earlier paper-step failure and v7 false result remain unchanged. No repeat camera request is introduced.
- **C3 existing-account binding:** the reported 20:50 KST success followed removal of the Meta account restriction, using the existing `/me` path on PR189 merge `6b0a8219403aed3bd8298b2920dd0e573e994ea6`, Worker `2fb2dc55-209a-42ca-88ef-275d1f7f2ee4`. The user saw authenticated → existing ComBba → connected success. The recorded 20:58 KST audit found a completed flow with no failure and a sanitized matching adoption receipt; public `legacy_profile_updated` event 20239/input 3433/run14 matches. The success UI requires adopted true and entry joined; the auditing agent did not re-call the private personal endpoint. A public profile event alone is not binding proof. This completes that existing-account binding checkpoint, not a new connector installation, scheduler proof or the whole D01 path. C3 is not an extra D01 prerequisite.
- **Personal autonomous actions:** retain the [actual Copper acceptance](https://github.com/Two-Weeks-Team/musely/issues/61#issuecomment-6618509145) and [later Ellis acceptance/independent movement](https://github.com/Two-Weeks-Team/musely/issues/51#issuecomment-6627249688). The inspected later progress still reports no new personal own proposal or explicit rejection. NPC decisions, silence, expiry and server command refusal cannot fill those #51 gaps.
- **Two-principal outcomes and revocation:** retain `production-owner-flows/REPORT_MEETUPS.md` and its original runs/receipts for agreement, reward, decline, change, expiry and reconnect. These are operator-controlled independent principals on the original release. `candidate_mismatch` is not private-condition empty-intersection proof. The retained temporary-key direct MCP 200 → revoke that key → same request 401/public unchanged is not a second Muse-app connector or a new revocation test on the final build.

The final source/deployment/config must still be matched to the whole path and failure branches, including the dedicated judge-Muse entry. Fresh final-profile checking belongs to the designated operating verifier. No issue is closed, no extra human gate is created, and a documentation PR is not a deployment or whole-S3 acceptance. See the [M4 handoff](RELEASE_ACCEPTANCE.md#m4-evidence-and-closeout-handoff-2026-11-05).

## PR209/210 scoped path follow-up (2026-11-05)

The [posted D01 partial C10](https://github.com/Two-Weeks-Team/musely/issues/61#issuecomment-6638815031) supplements, rather than closes, D01. PR210 source `56b82c86f0cc02fa013bb93d3702a81bfe2f2e92` is associated with reported Worker `ec8e32ab-2613-4f1c-ade3-664f2338b96f`; start/end service metadata matched. Judge remains ON/actions OFF. This is existing operating evidence, not a new execution.

- **Human use, separate sources:** the supervisor's PR200 01:50 KST tester run reached login → automatic Studio → Sage/Orbit 3D → Save → 3 · Connect, with key issuance0/Native admission0. On PR209 (`cc3f506e953755002d20818d94e869a0d96fd8fd`, Worker `97ffe0c2-d5c3-46b7-b299-42dd2780594a`), the supervisor confirmed the optional four-step guidance and actual owner Pause → Resume with the same key. This does not establish a new Native entry, scheduler completion or the whole final-source path.
- **PR209 public/judge scope:** EN/KO desktop/mobile public-name and status-label checks passed; 24 retained 5-second interaction-state observations are not personal-connection poll responses. Foreign reads were denied 48/48, owner reads returned owner:null 8/8 and Judge personal-Pause reads were denied 4/4. No real-account Pause was performed by the browser verifier.
- **PR210 original gesture:** EN/KO × desktop/mobile passed 4/4 profiles, with 8/8 trusted grant/read clicks delivered through select focusout to the same original button, without the blur-first control. Each profile recorded grant POST1/location GET1, with one pending poll aborted by each operation. Held-pointer revocation/logout/expiry cleared the old input 4/4 in 19–34ms after the synthetic response; pageerror0. These personal responses were browser-internal synthetic responses against the deployed UI: real private backend calls, real key/account/Native/schedule/resident changes0. The native select popup itself remains unmeasured. Chrome was cleaned up after verification.

PR209's original four failed gestures, three diagnostic rows and intentional interruption remain preserved. Blur-first POST/read success established that the #205 abort path worked; focusout-triggered DOM replacement lost the original click, superseding the earlier self-busy hypothesis. PR210's scoped pass does not rewrite those failures. See [first-arrival evidence](DEVICE_ACCEPTANCE.md#pr209210-scoped-first-arrival-2026-11-05) and the [remaining M4 limits](RELEASE_ACCEPTANCE.md#pr210-m4-partial-handoff-2026-11-05). Earlier camera, C3 and operator-principal receipts are not promoted to one final-build run.
