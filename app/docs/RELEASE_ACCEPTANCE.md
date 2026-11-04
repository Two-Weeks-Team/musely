# Release acceptance evidence

> Latest status: [PR210 M4 partial handoff, 2026-11-05](#pr210-m4-partial-handoff-2026-11-05). M4/M5 and whole acceptance remain incomplete; historical evidence keeps its source.

Both scopes retain their original evidence environment and pending acceptance boundaries. Preparation and local checks do not establish operational acceptance.

## D02 controlled proof and raw recount

### D-02 release evidence

Issue: #62. Contracts: C04/C08/C09/C10 in `docs/roadmap/execution-contract.md`; implementation targets are `app/`. This document prepares evidence; it does not declare S3, deployment, an owner claim or a physical device accepted.

#### Current gates

| Evidence | Prepared implementation | Acceptance still required |
|---|---|---|
| P0 | Actual local Trust signatures, WorldRuntime commits, owner revocation and fresh-nonce refusal; public state remains unchanged | The real owner claim is pending. No production P0/revoke/redelegate was executed by this task |
| P1 | Same engine initial state, seed, clock and public decision input; only Ripple's Transit Pass differs; recorded decision is controlled, no model called | Keep this causal simulation separate from any subsequently captured live scene |
| P2 | Scene descriptor → exact event/run/world/version → commit before/after hash → existing request reference or actual verification verdict | Capture the corresponding scene on the final release; a constructed local scene descriptor is not a production screenshot |
| Six measures | Raw event recount against independent UI/server implementations, source/origin splits, per-run values, duplicate handling, empty/missing/partial cases | Collect the same settled period on the final release and compare its actual server oracle and sample/run cohort |
| Release identity | C10 metadata and public GET collector prepared | Root supplies final release SHA/deployId/configVersion/URL and signals the measurement window |

#### Local controlled evidence

Run from `app/` with Node 24:

```sh
node scripts/proof-evidence.mjs --out docs/evidence/d02-local.json
node --test scripts/proof-evidence.test.mjs
npm run check
```

The local generator uses fresh ephemeral test roots in an in-memory SQLite database. It never reads production credentials, creates a real owner claim, calls a provider or writes to the deployed world. The artifact labels its environment and limitations. Internal event source `live` means a real local signature/check occurred; the enclosing bundle is still **simulation**.

P0 compares the same semantic business content, target, actor, old delegation and scope. The second message has a new nonce and message ID. A changed world version can legitimately change the signed envelope content hash, so equal envelope hashes are not required. The refusal must be at the delegation step with `delegation_revoked`; daily/pair limits cannot substitute. The first trade must actually have committed, a separate revoke event must follow, and the public state immediately before/after refusal must match. The local full-state digests and the actual runtime `stateUnchanged` result must also agree; the private full body is not exported. No automatic re-delegation is performed.

P1 starts both runs from cloned identical full local engine state. It adds exactly one `transit_pass` to `03-ripple`, holds seed/time/public decision input fixed, and observes Bay travel refused without it and a bus departure with it. This is a controlled causal test, not a live model decision. Goals/private fixture fields are synthetic harness state; no person's private input is collected.

#### Final release public-read collection

Only after root identifies the final release and measurement window, fill [the metadata template](evidence/release-template.json) and run:

```sh
node scripts/proof-evidence.mjs --collect --base https://musely.net --meta /path/release-meta.json --run RUN_ID --from FROM_MS --to TO_MS --scenes /path/captured-scenes.json --out /path/release-public-records.json
```

A captured scene entry contains `classification` (`live` or `replay`), `worldId`, `runId`, `eventId`, `version` and `snapshotHash`. Use the selected event's actual checkpoint, not an unrelated current state. Replay stays labelled replay; a rule/signature event gets its real verdict, never an invented model request ID.

The collector has a fixed same-origin allow-list: public GET `/api/world/run`, `/api/world/events`, `/api/world/event`, `/api/world/autonomy`. It omits credentials and rejects redirects, owner/session/provider/MCP paths and other origins. It binds the declared C10 URL origin to the actual reader origin before any fetch. It reads a frozen run boundary, enforces ascending event sequences, filters `[from,to)` locally, and records URL/time/status plus complete bounded response bytes, not only the filtered interval. A page/count failure or bounded collection is partial. Equal six displayed values are insufficient: oracle world, period/day, run cohort, full sample (received/events/duplicates/firstAt/lastAt), source/origin breakdowns, all numeric measure denominators and missing-evidence fields must agree. Server completeness must be the boolean `true`. P2 binds the input row to the same run and the exact event retained within the selected frozen cohort. Its correlation points to the original event-response receipt. These APIs do not themselves attest deployId; root's deployment receipt binds the supplied release metadata.

No production POST, owner-root/claim setup, new authentication, provider/quota consumption or fault injection is authorized by this collector. A missing scene, actual owner P0, release receipt, physical-device proof or four-hour run remains pending. A local pass cannot fill those gaps.

#### Bounded raw-source archive and fix validation

Each successful GET receipt stores `requestOrigin`, `URL`, UTC time, status, `rawSource`, `rawBytes`, `rawSha256`, `rawBodyBase64`, canonical `bodyHash` and a cohort derived from the parsed response. Raw bytes are the Fetch response body (after HTTP content decoding), not compressed transfer packets. Base64 preserves JSON whitespace/encoding exactly; decode it and recompute SHA-256 before parsing or rechecking the canonical hash. All fetched event pages remain present, including rows outside `[from,to)` or after the frozen boundary; only the analysis cohort is filtered. A P2 receipt contains actual event/run/input identities, and correlations carry its receipt index/hash/origin. No authorization/cookie headers or credentials are archived. Only the four public run APIs are allowed; original key, camera, claim and owner endpoints remain outside scope.

The collector caps each fetch-plus-body read at 10 seconds, each decoded response at 8 MiB, total retained source bodies at 64 MiB, and pagination at 100 pages. Limits may be reduced in injected local tests but cannot exceed those defaults. Timeout/byte overflow, invalid JSON or nonascending/foreign-run pages fail rather than produce a matched report. Do not treat a failed invocation or absent artifact as PASS; retain its command/error and rerun in a new artifact path after resolving the cause. These limits bound source-body bytes; Base64 and parsed summaries add memory/output overhead. The public APIs' 30-second caches and a still-changing world can legitimately yield a partial/mismatched comparison; choose a settled final interval and never hide that mismatch.

Native Fetch responses provide real response-body bytes. Historical injected JSON-only test doubles are explicitly labelled `injected-json-fixture`; their serialized bytes are a synthetic test representation and cannot establish wire/production evidence. No operational collection was run while fixing these validators. The committed `d02-local.json` remains the original clearly labelled simulation with its original source commit; a new local generation can be written privately for fresh validation. Origin equality does not prove deployId/source/config truth: the root's actual deployment receipt and final freeze remain mandatory, as do the actual claimed-owner P0, captured scene and device/soak checkpoints.

## D03 observation and isolated faults

### Release acceptance — D-03 preparation

Issue #63 is **not accepted**. The release is still changing. No four-hour production run, isolated deployment fault receipt, production quota/budget receipt or resilience browser run is claimed by these tools. Local regressions, isolated faults and operating-demo observations remain separate environments (C10).

This work changes scripts and documentation only. The product entry point, routes, model proxy, secrets, client flow and Worker configuration have no fault flags or test branches. Preparation must be regenerated from the final clean release checkout after I-09/I-11 integration; its SHA is not the submission release merely because these tests pass.

| Requirement | Existing evidence to retain | Added preparation / remaining proof |
|---|---|---|
| Duplicate alarm/concurrent reserve | world-runtime/command-runtime/proxy tests | `resilience.test.mjs`: fault tick+duplicate and next tick, actual WorldDO alarm handler duplicate calls and re-arm after unexpected failure; Cloudflare deployment remains separate |
| Restart/crash reservation | runtime command persistence and stale charge | file-backed SQLite closes/reopens after a pre-call reservation: no second model call, next tick proceeds, stale reservation charged once; actual DO restart still required |
| UTC and world midnight | engine day changes | separate UTC-budget midnight and America/Los_Angeles world midnight with reconstructed runtime and concurrent alarms |
| 429/5xx/timeout | proxy/world-runtime fallback and accounting tests | test-only upstream, honest non-live world fallback and continuation; one actual 8-second deadline test, not an accelerated timeout |
| Session/IP/quota/budget | proxy tests, including shared judge120 and visitor3+3/IP40 | operating-demo bounded protocol below; read-only monitor itself never consumes a quota |
| Revoke during await / approvals | world-runtime, owner-control, command-runtime, tasks tests | retain actual owner/peer request IDs and before/after state under the final build; no full security guarantee from fixtures |
| Keys/injection/private reasons | boundaries, a2a, tasks, run-log, proxy tests | final-build fake-secret scan and request evidence; never copy real secret values into artifacts |
| Tile failure/source/world continuity | map fallback/error handling | `resilience.browser.js` is local-host-only, blocks tile GETs and every API write; execution remains pending |
| Replay writes0 | existing replay/isolation tests and I-11 | final integrated replay browser capture remains pending; do not replace it with a fixture pass |
| Four-hour continuity | none on this release | explicit wall-clock monitor described below; not started |

#### Isolated fault deployment preparation

`scripts/prepare-resilience.mjs` writes new local configs and a preparation receipt. It performs no authentication, deployment, secret write or network request. It requires dedicated `musely-d03-*.workers.dev` hosts, refuses production/provider URLs and product Worker names, clears routes, uses a new rate-limit namespace, and keeps DO bindings local to the new script. It uses the frozen `.wrangler/dry-run/index.js` with `no_bundle: true` and built `dist/`; it does not rebuild or wrap them with fault conditionals. Run the release build/dry-run first. Preparation hashes the exact prebuilt Worker and HTML bytes; the operator still attests which source/config produced them.

```sh
node scripts/prepare-resilience.mjs --name musely-d03-CASE --account-subdomain ACCOUNT \
  --origin https://musely-d03-CASE.ACCOUNT.workers.dev \
  --fault-origin https://musely-d03-fault.ACCOUNT.workers.dev \
  --mode 503 --cap 0.05 --out /new/external/d03-case
```

Replace CASE/ACCOUNT with actual lowercase dedicated identities. Allowed modes: `429`, `503`, `timeout`, `bad-output`, `healthy`. The separate stateless stub handles only an explicit mode path; the product uses that URL as its existing MODEL_BASE. `timeout` waits nine seconds so the product's eight-second deadline wins. It neither logs headers/body nor forwards anything. Healthy responses support only spotlight/encounter fixtures. No camera, claim, Threads, real owner roots or production API keys belong in this environment. The isolated product must use disposable test credentials supplied by the operator through the normal secret mechanism; this preparation neither obtains nor writes any. Turnstile remains unconfigured, so a real visitor-registration receipt is not inferred from this setup.

The coordinator owns actual deploy/cleanup. Before deploying, record clean SHA, lockfile, built HTML/Worker bundle SHA256 and config SHA256. Compare the isolated dry-run Worker bytes with the frozen Worker: source-path comments from rebuilding in another config directory are not identical bytes. Dry-run both generated configs, inspect bindings, and verify distinct Worker names, no production routes and no cross-script DO `script_name`. Each fault config change produces its own deployId/configVersion: same code is not the same deployment. Keep the old receipt; never mutate the operating demo's MODEL_BASE, cap, secrets, rate limits, alarm or routes for a fault test. A cap must be positive: `0` is not a zero-budget simulation because WorldDO's existing defaulting maps it to the default cap.

For each isolated case capture: status and world/run before; normal authenticated test action; exact response source/reason; reservation/settlement/event IDs and amounts; model stub request ID; world/run after at least two alarms; and the new deployment identity. 429 must charge0 when no generation occurred; unknown 5xx/timeout usage retains the full reservation. Malformed output cannot become live. No duplicate commit or late-answer effect is allowed. Use an isolated owner/peer to revoke during an awaited response and record the actual discard reason/state invariance; no production revocation is injected by this harness.

#### Four-hour wall-clock observer

The default command prints preparation help and exits. **Do not start it until the coordinator freezes the release and attests its source/deployment/config mapping.** `scripts/resilience-monitor.mjs --run` requires a pin with only these public fields:

```json
{
  "issueId": 63,
  "environment": "production-read-only",
  "releaseSha": "<40 lowercase hex>",
  "deployId": "<active deployment ID>",
  "versionIds": ["<the single active 100% Worker version>"],
  "configVersion": "<operator config receipt ID>",
  "configSha256": "<64 lowercase hex of the deployed config file>",
  "htmlSha256": "<64 lowercase hex of the served root HTML>",
  "workerName": "musely",
  "baseUrl": "https://musely.net",
  "operatorAttested": true,
  "sourcePath": "/absolute/frozen/release-checkout",
  "configPath": "/absolute/deployed/wrangler.jsonc"
}
```

The placeholders are deliberately invalid. Do not set `operatorAttested` until the deployment/config receipt exists. That attestation is not generated from a local SHA or a successful GET. Pin the config actually used by the deployment, including the documented non-secret environment changes; never put tokens/cookies/keys in this file. Unknown fields are rejected. Mixed/gradual deployments are refused because a single-build run cannot be inferred from them.

```sh
node scripts/resilience-monitor.mjs --run --pin /absolute/release-pin.json \
  --out /new/external/d03-production-4h
```

Each round uses only credential-free GETs to `/`, `/api/status`, `/api/world`, `/api/world/run`, and the newest100 public events. Redirects are not followed; response bodies are bounded and headers are allow-listed (no Set-Cookie/authorization). The existing authenticated Wrangler **read-only** `deployments list --json` observes the latest deployment, in non-interactive mode with metrics disabled. It never invokes login/deploy/secret commands or records raw CLI output. Missing/expired auth or unknown deployment data is an observation failure, not permission to authenticate. Keep existing auth valid before starting; do not create new auth during the run.

Every sample stores UTC timestamps, monotonic elapsed time, request status/selected headers/raw body/hash, deployment IDs, source SHA/dirty state, config/HTML hashes, public world/run and budget/model state. Source/config edits, a new deployment/version/HTML, a gap over90seconds, world stalling over3minutes, clock jump over30seconds, same-day rewind, malformed data or duplicate event IDs in one response fail the run. Repeated event IDs across overlapping polls are normal and do not count as duplicate commits. New world days are preserved; UTC budget day and Menlo Park world day are distinct.

New observer GETs explicitly send `Connection: close`, matching the existing device collector's connection policy. A fetch or streamed-body failure retains a fixed `error` classification and `failure: {errorName, causeCode, stage}` in that request receipt. Stage is `fetch` or `body`; error names/cause codes come from a fixed allow-list, and unknown values are null. No original exception message, stack, arbitrary cause object, cookie, credential, request header or additional URL is persisted. Existing successful status, selected response headers, bounded body and SHA256 receipts remain unchanged. Timeout/byte bounds, no-retry behavior and continuity failure rules are unchanged.

This is a changed collection condition for a **new** run, not proof that a prior transport fault was fixed. Earlier records containing only `fetch failed` lack the underlying cause/stage and remain cause **UNKNOWN**; do not backfill `UND_ERR_SOCKET` or another diagnosis. A successful request from a different process or later time does not establish the old failure's cause. Keep the earlier failed run and any later recovery as recorded; a new collector/release run has separate raw evidence and must independently complete its full window.

Raw files are written exclusively in a new external directory, alongside append-only samples.jsonl and a current summary. No old run directory is reused. A recovered outage gets a recovery marker but does not erase the original failure or start a hidden new four-hour window. Interrupt/termination before completion remains incomplete; any prior failure remains failed. Restarting this process starts a separate run, not a stitched continuous pass. macOS sleep or a killed observer leaves a gap/incomplete record. Monotonic elapsed time must cover at least four real hours; synthetic-clock tests never satisfy this gate.

`observed_continuous` means only that the bounded GET/identity criteria were observed continuously. `faultAcceptance` remains `not_measured`. It does not prove all API writes, privacy, remote services or physical devices. Keep operating-demo and `isolated-read-only` directories separate.

#### Safe bounded operating-demo quota/budget proof

This preparation and observer perform **GET only** on the operating service. They create no sessions or credentials. The coordinator may retain an already-authorized operator's normal UI receipt separately; it is not produced by the observer.

For a quota receipt, use one existing legitimate visitor session and its existing normal usage. Capture its authenticated `/api/status` quota before/after in that operator's browser without exporting the cookie. Reuse the three permitted normal actions already performed; do not manufacture new sessions/IPs or drain judge120/IP40. If a further normal action is separately authorized, make at most one after `usedThisHour=3` and retain its response `source`, `reason=session_quota`, timestamp and fixed deployment tuple. No extra model call should occur. For live permitted calls, compute their exact worst-case reservation with the existing `buildMessages/maxCostUsd`; the bounded plan is at most3 reservations, total ceiling `3*M`, and stop before the first request if the operator's explicit spend ceiling/headroom cannot cover it. The observer never performs those POSTs and does not treat a read-only quota counter as a fallback receipt.

For budget fallback, observe the natural operating `/api/status` remaining budget. Do not lower the production cap or deliberately exhaust it. When the naturally remaining budget is below the exact request reservation M, the coordinator can retain one separately authorized, normal valid action's `reason=budget`, non-live source and surrounding status/world/run. Prefer a session below quota so `session_quota` does not mask the budget branch. If no natural budget-bound event exists, record **not measured** and keep this acceptance item open; an isolated tiny-cap receipt is not operating-demo budget proof. At a zero/insufficient budget the world must keep advancing through rule/replay ticks. A missing key (`not_connected`) is not budget proof.

Bounded logs retain request/event/deployment IDs and public results, not camera frames, private reasons, owner schedules, cookies, tokens or real keys. Existing private-input/approval/revocation tests remain separate from an actual operator request receipt.

#### Prepared local evidence

The task handoff records the exact tested commit and logs under the coordinator's S3 evidence directory. `resilience.test.mjs` is synthetic SQLite/runtime regression; its eight-second test uses a real wall timer. `resilience-monitor.test.mjs` accelerates time only to test classification and never claims a run. The test-only stub dry-run proves bundling, not deployment. Browser tile injection is local only and remains pending until executed against the integrated build.

The alarm test imports the actual WorldDO and uses the same test-only `cloudflare:workers` base-class adapter as worker-entry.test.mjs. Its SQL transactions and alarm scheduling callbacks are local. It tests the production alarm's duplicate and finally/re-arm branches; it does not claim workerd lifecycle or Cloudflare eviction proof.

References checked for the test Worker/config tooling: [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/), installed Wrangler4.154.0 schema/CLI and retrieved workers-types5.20261102.1. No production runtime API is added.

Account isolation requires the operator-attested account subdomain (verified against the configured account using the read-only Workers subdomain API). Both dedicated origins must use it, and product/stub Worker names must differ. Observation termination uses the last recorded sample, not a round finishing after the deadline; run summaries must have a valid matching world and required versions, counters and snapshot hashes.


##### Source-clean scope correction — PR104, 2026-11-02

`sourcePath` may identify the attested repository root or its `app/` directory. Every CLI observation round now obtains HEAD and dirty state through `gitSourceState` in `scripts/lib/resilience-io.mjs`. Git status uses `--porcelain --untracked-files=all -- :(top)app/`, so the scope is always the repository-root **entire app/**, including Git-visible tracked and untracked changes. Ignored files are not covered by this Git-status predicate. It must not become `app/app/` when the command cwd is app. The deployed configuration read/hash and served HTML/deployment pin checks remain independent and unchanged.

This source-clean check does **not** attest repository-wide cleanliness, safety of paths outside app, deployment provenance or actual resilience. Real temporary-Git regressions cover tracked `app/worker/index.ts` changes and untracked app worker files from both root and app cwd. These are local filesystem tests, not an actual production observation, isolated fault deployment or four-hour wall-clock run. Earlier local/isolated/operating-demo evidence retains its original environment and limitations.


## D02 final technical-evidence handoff (2026-11-03)

**D02's four technical criteria are supported; overall acceptance/closure remains pending the full original D01 #61 prerequisite.** The earlier D02 preparation/pending statements above retain their original checkpoint. This appended record does not rewrite them, accept D01, or close D02/S3. The original criteria and [C04/C08/C09/C10](../../docs/roadmap/execution-contract.md) remain unchanged.

| Original criterion | Retained evidence and exact scope |
|---|---|
| P0: same job, fresh nonce/ID, revocation-cause refusal, unchanged state | Original8b13 operator-owner trade verified4012/completed4013/input349/version800→801; separate revoke4014/4015/input350; fresh refusal4016/input351/version802→802, delegation_revoked and public beforeHash=afterHash. Same trade/actor/target/scope/delegation; each signed-content hash binds its own current expectedVersion, while the stable business payload hash agrees. Server stateUnchanged=true is retained separately from public hash reconstruction; private full state/signature bytes were not exported. |
| P1: controlled initial state/seed/clock/inputs, item-only delta | Two actual WorldRuntime/RunLog-2 records in a separate local virtual world differ only by one Ripple transit_pass. Without: actual decision_rejected; with: actual bus depart. Exact full initial-state comparison, pure loadRun1/10/60x end-state/hash, reverse seek and65-second recorded projection agree. All seven selected JSON files equal an independent regeneration. This is CONTROLLED COMPARISON (SIMULATION), not a production/model action; no provider ID or signature is invented. |
| P2: scene→event→real request or authority verdict | Original8b13 captured REPLAY10/10 and current494 production REPLAY11/11 join original event4012/run-3-mvzc8169-f1e07139/input349/version801/checkpoint1e829885f31537cf9c5c7ebbf2dde6fa8be6b03dd762b6159e89d61e3a6da51a. Exact response bytes, parsed record and snapshot hash agree. The visible evidence is the original server-custodial signature/authority verdict for message XoEzltTmZ9cr7RmLOUa3pQ, with no model call; it is not independent raw-signature crypto or new authentication. |
| Six measures: same-period original-record recount | Three actual public GET response bodies are retained with Base64/byte counts/SHA. Raw289-event cohort and full server-oracle/UI recount agree, including sample, denominators, missing evidence, source/origin and run scope. Complete=true; no missing denominator is promoted to zero. |

### Exact retained C09 interval

World musely, run-3-mvzc8169-f1e07139, **2026-11-02T16:12:08.719Z inclusive to17:00:00Z exclusive**. These are interval statistics, not whole-product lifetime autonomy or personal-Muse behavior.

| Measure | Original-record result |
|---|---|
| Intent-initiated encounters |0/13=0%;13 system/rule encounters. Connected-origin denominator0 remains Not measured.|
| Owner interventions |12 request events;6 candidates|
| Signature verdicts |27 passed;1 refused;0 unrecorded|
| Model requests and scenario events |44 unique live request IDs;0 replay request IDs;10 scripted spotlight events; missing live/replay IDs0|
| Ability changes |1 tagged/hashed/actually changed|
| Blocks |0 instruction blocks;0 out-of-scope decisions|

Sample received/unique289, duplicate event/encounter/verification IDs0. Original sources139live/111rule/39scripted/0replay; actor origins246system/30connected/0trial/13unrecorded. Connected includes operator-controlled MCP; it is not proof of a personal Muse's autonomous initiation.

### Release, custody and remaining handoff

Original P0/P2/C09 operating receipts retain source8b13a776b5a0a76558efee8c8c8bb6efb1408438, ROWba0508d2-9870-43da-8aee-f633594eddb0 and Workerb5e18f5e-96b7-4198-a14c-dc3775c40174. Current replay client retains source4946517bbad0ec7677edd73205d7b4390dbdc4e5, ROW359cb5c5-dff3-4153-ae58-b36412e0cdd9 and Workere10feb65-a7a2-463e-8537-7b1a876ed182. Both use configSHA256893a8e4ffd2857d25032a6454363134a2329a00a3e71f4e83c56413233df9e10 and unchanged Worker bundlebf4d985ce91a6f861b047d8a526a64f5de3bf2470fe9db4b488316dee0908b5a. Worker/engine/player/oracle/proof source is unchanged8b13→494; changed read-only loader/UI has its own actual494 replay verification. No original business execution is retagged as a new494 action. P1 remains a distinct local controlled world, not that operational run.

Custody paths below are external tasks/s3-execution-20261102/, not bundled public/private credentials: production-owner-flows/REPORT_P0.md and its original/corrected receipts; d05-controlled-p1/records-final; final-p2-captured-replay-v4; final-c09-raw-recount-v2; final494-production-replay; d02-final-acceptance-review-1103. The final independent audit recorded133/133 offline receipt/hash/pure-projection checks over78 retained files, manifestSHA256d0d9c200c93230528a0795372a084553638c74f502eeb6b65f241d0ad80427a3. These are not133 new operating tests. The original [D02 C10](https://github.com/Two-Weeks-Team/musely/issues/62#issuecomment-6583852395) remains an earlier operating checkpoint, not a full D01/S3 acceptance.

Preserve original P0 harness exit2/equal-signed-hash mistake, corrected offline judgment and separately authorized restoration; P2 selector/framing/UNKNOWN-load failures; earlier C09 freeze-crossing collection; and the old wall-clock-dependent full-check failure. Later3/3 original reproductions,26/26 corrected proof/regression checks and470/470+type/build/dry-run belong to their own pins. The actual494 scene/evidence retains blocked analytics POST and owner-location bootstrap attempts; neither is an owner access success or an absence of all attempted network traffic. Body annotations behind the evidence popover do not establish D05's continuous film provenance.

P2 results inherit C09 collection meta.command/artifact. Preserve that raw metadata, but use the actual capture source/time when writing final C10: capture-final-p2.mjs / scene2026-11-02T17:26:12.591Z for v4; capture-production-replay-494.mjs --run / actual2026-11-02T20:26–20:28Z for494. Do not describe collect-final-c09.mjs as the capture command. No replacement capture is required by this metadata clarification.

I11's [original technical C10](https://github.com/Two-Weeks-Team/musely/issues/59#issuecomment-6588006084) remains technical evidence; its earlier partial-predecessor interpretation was withdrawn. The [later C01 handoff](https://github.com/Two-Weeks-Team/musely/issues/59#issuecomment-6591330425) records root's actual #57 closure23:39:44Z→#56 reclosure23:40:41Z→#59 reclosure23:41:10Z without rewriting histories. It supplies read-only RunRecord/seek/source/evidence output, not a substitute for D01.

**D01's full original actual Muse/inbox/world, webcam and whole-path acceptance remains pending.** Keep D02 open/awaiting that prerequisite, preserve its unchecked overall completion boundary, and only after D01's full handoff record the final D02 C10/checklist/dependent handoff at the actual time. Visitor quota, four-hour, physical-device, movie and whole-S3 records remain separate where applicable; this D02 record neither completes them nor adds them as new D02 experiments. Hackathon Submit/terms/competition-publication is the team's decision/action and remains excluded from our execution scope, not a new technical gate. No product494/collector3105/export235 or runtime/deployment changes are made here. See the [updated D02 index](evidence/INDEX.md#d02-final-operating-evidence-and-prerequisite-status-2026-11-03).

## Direct device and execution-scope basis (2026-11-03)

[D01's corrected basis](D01_ACCEPTANCE.md#direct-macbook-and-principal-basis-correction-2026-11-03) and [I04's procedure](CONNECTOR_VERIFICATION.md) use a MacBook with Muse installed and the MacBook browser location. D01/I04 require no physical phone, satellite-GPS proof or second real person. Existing operating independent-principal approval/expiry/reconnect records remain evidence under C06; personal-Muse and actual webcam receipts are still distinct and pending. The requested device-location allow/deny cases run on the MacBook after the neighborhood-area implementation. D04's measured Pro18,2/S23 evidence is retained without relabelling.

D05's three-minute video belongs to the demo team and D06 submission belongs to the team. This work neither executes nor creates new preparation or requests for their video, forms, representative, surveys, consent or repository-publication timing. Previously created evidence remains preserved; only its locations are handed over. Earlier descriptions of our submission/video preparation duties are historical and superseded by this direct scope decision.


## Current S3 candidate and remaining acceptance (2026-11-04)

This checkpoint supplements the dated records above; it does not replace their original builds, failures or environments. **D01, D02, D03 and D04 remain open.** The engineering scope excludes D05/video and D06/competition submission, which belong to the demo team/team.

The tested product is main `a858b4aad8c81c12dd0e93de0057f477fdcafc41` (PR163), app tree `a6fd8f52b568ebba4bf342798c105a7ecf2529d7`, https://musely.net/, deployment `db3261ea-6bd3-4435-a02b-ee861cb4bae7`, sole Worker `debc3b90-3adf-4086-aca7-2291afe0f1dd`100%, config SHA256 `893a8e4ffd2857d25032a6454363134a2329a00a3e71f4e83c56413233df9e10`. Authored/Node-HTTP HTML is8521B/SHA256 `50436d66a0756a5fba84b5b43717508f8656863d6e65f1e20501fbf3b3563043`; actual browser HTML is8888B/SHA256 `fe4f089d5b4eb4447a2aa8b7fa12cb25e6738218a05a52d23b423038b38f01da` (367B managed insertion, no deletion). These are separate observations. This documentation commit is not the tested product SHA.

C10 owner/executor: Codex root with the existing i07/i09/i12 workers. Commands use Node24 and the unchanged `product-e2e.browser.js`, `current-cli.mjs`, `device-benchmark.mjs` and `resilience-monitor.mjs` through scoped external adapters. Raw artifacts below remain outside Git under `tasks/s3-execution-20261102/`; no credentials, private conditions or camera frames are included here.

| Acceptance scope | Current direct evidence | Remaining boundary |
|---|---|---|
| D01 anonymous watch/selection/reconnect | Actual a858 production, two fresh contexts1280×800/390×844,25/25;154GET, four external analytics GETs explicitly blocked, errors0. [C10](https://github.com/Two-Weeks-Team/musely/issues/61#issuecomment-6618966328) | Observer `acceptedD01:false` remains correct. It does not establish account/camera/owner approvals. Its historical13humanChecks strings are not13new user requests. |
| Connected personal Muse | Existing ComBba five-minute job, connected/server-custodial actions and actual Copper acceptance; operating key/root/delegation unchanged. [Observed choice](https://github.com/Two-Weeks-Team/musely/issues/51#issuecomment-6618789373) | Own proposal/explicit rejection remain unobserved. After Tempo/Orbit intentions, observed choices were greetings; no private reason is inferred, silence is not rejection and outcomes are not induced. |
| Camera/location/revoke | Actual MacBook location allow/deny complete; camera LIVE request returned3false, `productPassed:false`; dedicated temporary MCP key200→revoke→same-call401/public state unchanged | Human executions are finished and are not requested again. A failed camera verdict is not identity PASS. Direct MCP revocation is not a second Muse-app connector receipt. |
| C06 and D02 | Retain actual independent-owner150, original P0+correction, controlled P1, recorded P2 and fixed-interval C09, with their original identities | No second real person required; no old business action retagged a858. D02's four technical rows remain supported, overall closure awaits D01. |
| D03 faults and operating quota | Actual isolated fault33/33, controlled CF reset15/15,5500ms revoke-await; local duplicate-alarm/re-arm/restart/UTC-vs-LA boundaries; operating visitor3LIVE→quota fallback and $0.006516 settlement. [Quota handoff](https://github.com/Two-Weeks-Team/musely/issues/63#issuecomment-6618622207) | Environments stay separate. Host crash, actual duplicate delivery, natural midnight and production provider faults are not claimed. Natural production budget exhaustion is unmeasured, not an invented forced-drain gate. |
| D03 four-hour run | Actual a858 fixed-tuple observer started2026-11-04 09:04:41.591KST; unique prefix in an existing topic. [Start receipt](https://github.com/Two-Weeks-Team/musely/issues/63#issuecomment-6618746058) | At this checkpoint **incomplete**. A sufficient final sample must be at/after13:04:41.591KST. Earlier failed runs/UNKNOWN causes are retained, never stitched into this run. |
| D04 current client | Readable arrival3948.5ms at4Mbps/150ms/no-cache; desktop210003.6ms median120FPS/p959.9ms;1440×1000 and390×844 overflow0/eight offered controls geometrically reachable. [Device details](DEVICE_ACCEPTANCE.md#current-candidate-client-evidence-2026-11-04) | Controlled arrival uses recorded public GET data, not a production-backend/account acceptance. Original desktop collector FAIL remains; a separate completed after-audit supplies the missing source proof for numeric acceptance. Final S23/PSS comparison still needs a new coordinated resource window. |

The current full product check is1236/1236, skip0, plus types/build/Worker dry-run, with exact risk reviews for changed personal identity/claim/adoption paths and receipt rollback/tamper checks. These are local source evidence, separate from actual accounts/devices. Model/proxy/ledger/session and the resilience regression are byte-unchanged from the retained isolated source; WorldDO/runtime/Trust/commands/connected/A2A/run-log and profile-aware replay changed. Do not claim whole-backend byte identity. Retained component receipts are supplemented by current regressions and post-deploy read-only checks. Controlled reset is actual CF deployment behavior; duplicate-alarm/clock injection remains local.

Real C3 existing-account alias binding is **on hold**: it would bind the actual Threads account and owner proof in production, and PR163 has no undo path. Main Chrome is untouched. No login/OAuth/token entry/adoption occurs until the owner returns and confirms. This is not a D01 gate. ComBba's permanent key, autonomous schedule and shared browser are preserved.

No merge or deployment before13:04KST. Required fixes during observation stop at branch/PR. A later deployment means this run is not evidence for that new build: restart a full four-hour observation after the last deployment, no later than2026-11-05 06:00KST, with final acceptance/readout before11:00KST. Keep the observer checkout fixed even when later documentation merges elsewhere.

The next acceptance decisions are the actual four-hour result, scoped final S23 comparison, D01/#51 remaining evidence and then D02/D04 prerequisite handoff. Neither successful local tests nor this documentation closes those issues.


## World-life activation and evidence limits (2026-11-04)

This later checkpoint supersedes the scheduling/deployment statements in the a858 checkpoint above; its original measurements and failures remain historical. PRs135 →137 →138 →139 →140 have merged and deployed. PR165 then activated `WORLD_LIFE_MODE=sandbox-v1` on main `3f969a3a6d27797776223b92255077fa8b456984`, Worker `1953e31e-6d7d-40e4-a152-ef2787a44634`. Initial propagation showed life404/10actors; the later read showed life200/enabled/27actors:24NPCs plus legacy00/04/09. This does not authorize server decisions for ComBba or change the permanent personal key/schedule. The temporary Copper/Ember clients stopped and their own keys were revoked; those cleanup receipts are separate from NPC activation.

The fixed-a858 four-hour observation was **stopped incomplete**; its old13:04 target is no longer a pending run or deployment freeze. Earlier failed/interrupted observations remain separate. A new full four-hour observation of the final product is still required; activation and a30-minute activity window do not satisfy it.

The first activated-build ready observation was12433ms, **uncalibrated and not C11**. A new final-build controlled C11 result is not yet measured at this checkpoint. The a8583948.5ms and desktop120FPS/p959.9ms measurements above retain their original source only. Historical S23/PSS evidence and the prepared comparison are not final-build PSS acceptance. See [device limits](DEVICE_ACCEPTANCE.md#activated-build-device-limit-2026-11-04).

I04/#51 still awaits observed personal choices/responses: own proposal and explicit rejection are not supplied by NPC behavior, an expired Task or silence. D01, D02 and D04 remain unclosed; D02 still depends on D01. Actual C3 account adoption remains on hold and is not a new D01 gate. D05/video and D06/submission remain team-owned. This append records existing execution reports, not new tests or acceptance.

### Activated-world follow-up and optional-load correction

The exact first30-minute interval (11:20:14.928–11:50:14.928KST) had19 moving Muses,21 departures,45 greetings,43 completed conversation replies (43 encounter starts tracked separately),3 proposals and3 completed NPC trades. ComBba independently greeted4 new residents and made no move or trade response in this interval. [Per-Muse C10 and global-cost scope](https://github.com/Two-Weeks-Team/musely/issues/134#issuecomment-6621237188) records the51 global server-model calls/$0.132986 delta over31.1294minutes; this is neither a resident-only nor exact30-minute cost bucket. The personal choices and NPC/system outcomes remain separate.

After that unchanged-build interval, [PR166](https://github.com/Two-Weeks-Team/musely/pull/166) changed only the optional campfire fetch/body deadline8→30seconds, with real-GLB delayed/hung transport regressions. Current product is merge `58492c0bbf608ac827cb4dbeaaf3b92393f3955c`, app tree `b19534f9931204a5fa985a9ff26f19fac95e79bf`, Worker `e9a78682-d96e-42ab-860c-6554c11fc984`100%, deployment `93545dd3-3efe-476d-839b-6920bd48539e`. Auth/Card/privacy/replay read-only checks passed. The unchanged controlled C11 runner then passed: scene3964.7ms/readable3978.3ms,27/27 projected actors, zero errors; campfire completed11909.2ms with exact pinned bytes. [C10 and limitations](https://github.com/Two-Weeks-Team/musely/pull/166#issuecomment-6621314847). The earlier165 overallFAIL remains preserved; controlled client performance does not establish actual account/backend entry. Current desktop/phone final decisions and final four-hour evidence remain separate.


## M4 evidence and closeout handoff (2026-11-05)

This is a documentation handoff for D01 → D02/D04. It supersedes the earlier fixed 13:04 freeze/06:00 start and C3-hold instructions while preserving their dated results. The old a858 four-hour run stopped incomplete. **M5 starts only on the supervisor's signal after the final deployment**; no four-hour run or new deployment is claimed here. Product implementation, merge and deployment remain with the main implementation agent; this document performs none of them.

| Issue | Reusable evidence | Remaining final handoff |
|---|---|---|
| [D01 #61](https://github.com/Two-Weeks-Team/musely/issues/61) | [D01 path update](D01_ACCEPTANCE.md#m4-path-evidence-update-2026-11-05): anonymous a858 25/25, actual PR188 camera pass, reported C3 success plus recorded sanitized flow/adoption/public-event correlation, existing connected and independent-principal receipts | Match the final source/deploy/config and changed failure branches; preserve #51 own-proposal/explicit-rejection gaps and the unmeasured private-condition empty intersection. Judge entry/card/status need final operating evidence. No whole-path PASS from these separate sources |
| [D02 #62](https://github.com/Two-Weeks-Team/musely/issues/62) | [Technical C10](https://github.com/Two-Weeks-Team/musely/issues/62#issuecomment-6591725010): P0 original 8b13 production, P1 controlled simulation, P2 captured verdict/replay494, C09 fixed 289-record cohort; original four technical criteria checked | D01 whole predecessor handoff is still open. Retain original builds, denominators and source/origin. Offline 133 checks are not new production calls; 44 unique live request IDs and 10 scripted spotlight events are different units. No new final-runtime totals are manufactured |
| [D04 #64](https://github.com/Two-Weeks-Team/musely/issues/64) | Original approved Pro18,2/S23 physical/PSS scope; a858 cold 3948.5ms and scoped desktop120FPS/p95 9.9ms plus separate successful after-source audit; [166 controlled C11](https://github.com/Two-Weeks-Team/musely/pull/166#issuecomment-6621314847) scene3964.7ms/readable3978.3ms | [Final device boundary](DEVICE_ACCEPTANCE.md#m4-device-handoff-2026-11-05): latest product needs its own source-bound C11/device impact judgment and D01 handoff. Historical S23/PSS and emulated layout are not final-build physical measurements |

The inspected progress records PR193 entry release at source `a15ede0eb32b389dc4acafad33e9652fa8053f5c`, Worker `32a4867f-1fa5-4131-9813-caee559c1131`, ROW `4e4fe999-4f71-4d8b-9235-9bfe12ffcd6f` (2026-11-04 23:37:27 KST). It records fresh EN/KO desktop/mobile entry checks and separate successful error-return supplements while retaining original desktop navigation timeouts. These are scoped entry results, not final dedicated-Judge-Muse proof or C11. Merging later product source into this documentation branch does not establish that source's deployment.

The intended entry routes are [public watching, shared judge Muse and invited Threads tester login](SUBMISSION_DRAFT.md#three-entry-routes). Judge entry stays unverified until the operating verifier confirms the final release, without recording a real token. Documentation preparation does not authorize publishing a judge link, changing an account, submitting competition fields, uploading video or agreeing to terms. #170/#176 closure text is prepared separately for review; neither issue is closed by this documentation change. D05/D06 execution stays team-owned.

## PR210 M4 partial handoff (2026-11-05)

The operating snapshot for this supplement is PR210 `56b82c86f0cc02fa013bb93d3702a81bfe2f2e92`, Worker `ec8e32ab-2613-4f1c-ade3-664f2338b96f`, deployed exit0 with Judge ON/actions OFF. The recorded three product CI checks succeeded; this is PR210 product evidence, not CI run by this documentation change. PR203's supervisor 02:12 KST Judge confirmation supersedes the earlier dated pending-Judge statements only within its measured entry/follow/status/isolation scope; received-proposal/notification positive samples remain absent.

[D01's posted partial C10](https://github.com/Two-Weeks-Team/musely/issues/61#issuecomment-6638815031) now includes [scoped PR210 gestures and separate PR200/209 human use](D01_ACCEPTANCE.md#pr209210-scoped-path-follow-up-2026-11-05). [D04's posted partial C10](https://github.com/Two-Weeks-Team/musely/issues/64#issuecomment-6638821976) adds [one PR210 readable first arrival at 4.7905s](DEVICE_ACCEPTANCE.md#pr209210-scoped-first-arrival-2026-11-05), preserving PR209's 5.3143s and original failed gestures/diagnostics. These are limited supplements, not whole-path or whole-C11 acceptance.

**D01/#61, D02/#62 and D04/#64 remain open; M4 and M5 remain incomplete.** #51 own proposal/explicit rejection remain unobserved. #170 private production persistence and daily eligible/attempt/success denominators remain unmeasured. #176's [arrival/conversation partial C10](https://github.com/Two-Weeks-Team/musely/issues/176#issuecomment-6638364776) uses different ON/OFF sources; same-source OFF tokens and causal effect remain unmeasured. Full C11, final-source 210-second FPS and physical phone/PSS remain unaccepted. Original receipt units and prerequisites are unchanged; no new gate is added.

The subsequently authorized seven-step onboarding/Manage, permission-revocation recovery guidance and ten-minute screen-retention changes are being implemented separately and remain unmeasured here. PR210 first-arrival/interaction results do not cover that future source.

M5 has not started and still awaits the supervisor's signal. This documentation-only handoff adds no operating deployment, account/provider/browser action, issue closure or competition submission. Historical source-specific failures and evidence stay intact; see the [evidence supplement](evidence/INDEX.md#pr209210-evidence-supplement-2026-11-05).
