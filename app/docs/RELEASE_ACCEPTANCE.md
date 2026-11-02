# Release acceptance — D-03 preparation

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

## Isolated fault deployment preparation

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

## Four-hour wall-clock observer

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

Raw files are written exclusively in a new external directory, alongside append-only samples.jsonl and a current summary. No old run directory is reused. A recovered outage gets a recovery marker but does not erase the original failure or start a hidden new four-hour window. Interrupt/termination before completion remains incomplete; any prior failure remains failed. Restarting this process starts a separate run, not a stitched continuous pass. macOS sleep or a killed observer leaves a gap/incomplete record. Monotonic elapsed time must cover at least four real hours; synthetic-clock tests never satisfy this gate.

`observed_continuous` means only that the bounded GET/identity criteria were observed continuously. `faultAcceptance` remains `not_measured`. It does not prove all API writes, privacy, remote services or physical devices. Keep operating-demo and `isolated-read-only` directories separate.

## Safe bounded operating-demo quota/budget proof

This preparation and observer perform **GET only** on the operating service. They create no sessions or credentials. The coordinator may retain an already-authorized operator's normal UI receipt separately; it is not produced by the observer.

For a quota receipt, use one existing legitimate visitor session and its existing normal usage. Capture its authenticated `/api/status` quota before/after in that operator's browser without exporting the cookie. Reuse the three permitted normal actions already performed; do not manufacture new sessions/IPs or drain judge120/IP40. If a further normal action is separately authorized, make at most one after `usedThisHour=3` and retain its response `source`, `reason=session_quota`, timestamp and fixed deployment tuple. No extra model call should occur. For live permitted calls, compute their exact worst-case reservation with the existing `buildMessages/maxCostUsd`; the bounded plan is at most3 reservations, total ceiling `3*M`, and stop before the first request if the operator's explicit spend ceiling/headroom cannot cover it. The observer never performs those POSTs and does not treat a read-only quota counter as a fallback receipt.

For budget fallback, observe the natural operating `/api/status` remaining budget. Do not lower the production cap or deliberately exhaust it. When the naturally remaining budget is below the exact request reservation M, the coordinator can retain one separately authorized, normal valid action's `reason=budget`, non-live source and surrounding status/world/run. Prefer a session below quota so `session_quota` does not mask the budget branch. If no natural budget-bound event exists, record **not measured** and keep this acceptance item open; an isolated tiny-cap receipt is not operating-demo budget proof. At a zero/insufficient budget the world must keep advancing through rule/replay ticks. A missing key (`not_connected`) is not budget proof.

Bounded logs retain request/event/deployment IDs and public results, not camera frames, private reasons, owner schedules, cookies, tokens or real keys. Existing private-input/approval/revocation tests remain separate from an actual operator request receipt.

## Prepared local evidence

The task handoff records the exact tested commit and logs under the coordinator's S3 evidence directory. `resilience.test.mjs` is synthetic SQLite/runtime regression; its eight-second test uses a real wall timer. `resilience-monitor.test.mjs` accelerates time only to test classification and never claims a run. The test-only stub dry-run proves bundling, not deployment. Browser tile injection is local only and remains pending until executed against the integrated build.

The alarm test imports the actual WorldDO and uses the same test-only `cloudflare:workers` base-class adapter as worker-entry.test.mjs. Its SQL transactions and alarm scheduling callbacks are local. It tests the production alarm's duplicate and finally/re-arm branches; it does not claim workerd lifecycle or Cloudflare eviction proof.

References checked for the test Worker/config tooling: [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/), installed Wrangler4.154.0 schema/CLI and retrieved workers-types5.20261102.1. No production runtime API is added.

Account isolation requires the operator-attested account subdomain (verified against the configured account using the read-only Workers subdomain API). Both dedicated origins must use it, and product/stub Worker names must differ. Observation termination uses the last recorded sample, not a round finishing after the deadline; run summaries must have a valid matching world and required versions, counters and snapshot hashes.
