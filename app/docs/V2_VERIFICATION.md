# V2 verification record

This is a dated verification record, not a statement that all S2/S3 acceptance criteria passed. The adopted direction and its original discussion are linked in [the decision record](../../docs/roadmap/decision-alignment.md). Later results retain their environment and limits. Real Muse connection, real webcam judging and physical-device performance still need their own evidence.

Status words: **Confirmed** = seen on an official page or in a real call/measurement recorded here. **Unconfirmed** = not seen; the reason is given.

## 1. Submission requirements (checked 2026-11-01)

Source: the event page https://cerebralvalley.ai/e/meta-ai-developer-hackathon, which embeds the Official Rules ("Hackathon Terms & Conditions").

| Item | Result | Status |
|---|---|---|
| Judging weights | Impact 30%, Use of Meta AI Tooling 25%, Technical Depth & Execution 20%, Demo 25%. Demo covers "whether the product holds up live, and the quality of the demo video". Impact includes fit with a problem statement | Confirmed |
| Startup track wording | "Judged on technical execution and whether it holds up in production" | Confirmed |
| Deadline | Nov 4, 9:00 PM ET (Nov 5 UTC). Judging Nov 4–8 | Confirmed |
| Team listing | The Representative identifies all team members in the submission; on the Startup track the Representative is an active employee of the startup; one track per project | Confirmed |
| Original work | The submission must be the participant's original work product; open source is allowed if licenses are followed and the submission builds on it. No explicit "started during the event" clause was found | Confirmed (wording) |
| Third-party IP | Must not violate others' IP rights, including copyright and trademark. No character-specific clause. See `character-kit/NOTICE.md` for the Jolly attribution | Confirmed (wording) |
| Credits | $150 Meta Model API credits for a 10-day development window. The Credit Terms PDF returned 403 | Confirmed (amount); terms unread |
| Public repository field | Sangeun reported checking the signed-in form and its screenshot in [PR #10](https://github.com/Two-Weeks-Team/musely/pull/10#issuecomment-6554726827); the [adoption reply](https://github.com/Two-Weeks-Team/musely/pull/10#issuecomment-6554848292) records the update | Required in that source record; no new signed-in check in this edit |
| Video length and remaining submission fields | The cited comments do not record the video-length value or enumerate every form field. The product plan uses a 3-minute video | Not established by that comment; D-06 rechecks the final signed-in form and video requirements |

Budget consequence: the planned $20/day cap over the 10-day window would exceed $150. The proxy keeps the daily cap configurable and the measured spend decides the setting (see 2).

## 2. Meta Model API real calls (2026-11-01)

Base `https://api.meta.ai/v1` (OpenAI-compatible Chat Completions), model `muse-spark-1.3`, key from the git-ignored `.env.local`. Probe script: `scripts/model-probe.mjs`; raw records (no key, no image bytes): `docs/probes/`.

| Probe | Result | Latency | Tokens in/out | Response id / `x-request-id` |
|---|---|---|---|---|
| Text, `json_schema` structured output | Valid JSON matching the schema | 1.39 s | 164 / 170 (115 reasoning) | `chatcmpl-01a195b2-9a00-70c9-8148-588be81504ac` / `482fdb5b-87d7-42bf-aa30-15f8de5e42e9` |
| Image input (`image_url` data URL), structured output | Correct negative: abstract pattern, `passed:false`, confidence 0.99 | 2.50 s | 469 / 196 (131 reasoning) | `chatcmpl-01a195b2-a3b2-7660-aa05-a4b8c02bbc00` / `2ed997a4-3384-4732-828e-4e26f7c26001` |

Findings that change the design:
- **Muse Spark is a reasoning model.** With `max_tokens: 300` and default effort, 298 of 300 output tokens were reasoning and the content was empty. `reasoning_effort` accepts `minimal, low, medium, high, xhigh, max` (`none` returns 400). Same prompt, `max_tokens` 1500: `minimal` 2.0 s / 252 tokens, `low` 3.8 s / 406, default 5.7 s / 843. The proxy uses `minimal` for spotlight/encounter and `low` for negotiation, with `max_tokens` sized for reasoning plus output, to stay inside the 8-second timeout.
- **Request id exists**: responses carry `x-request-id` (not in the docs) plus `x-ratelimit-*` headers (3,000 requests, 4M tokens per minute for the team). Evidence views use `x-request-id` as the model request id.
- Cost at `minimal`: about 170 input + 250 output tokens → about $0.0013 per call (official $1.25 / $4.25 per 1M).
- **Liveness judging quality on real frames is not yet confirmed.** Image input works; judging real challenge frames needs the owner's webcam run (task 2).
- **Synthetic-frame proxy (not a real person).** About eight photorealistic webcam-style frames generated with Codex image generation were judged with the challenge schema (36 calls):
  - `minimal`: 24/24 unambiguous judgments correct, including left/right hand 10/10 and date-on-paper match/mismatch. Median latency 2.5 s.
  - `low`: left/right 5/8. Two calls spent the token budget on reasoning, and one wrong pass came from wrong thumb-position reasoning. Up to 14.8 s.
  - A mirrored selfie frame without a hint was read as the opposite hand in 4/4 calls (pixel-identical to the other hand). With "this frame is mirrored" in the prompt, 6/6 were correct.
  - Design consequence: the ritual sends raw (non-mirrored) frames, says so in the prompt, and uses `minimal` effort.
  - Clean staged images, one frame per category: directional only. Blur, partial hands and spoofing were not tested.

## 3. Map data: OpenMapTiles `poi` classes (2026-11-01)

OpenFreeMap TileJSON `https://tiles.openfreemap.org/planet` (v3.16.0, build 2026-10-25, `poi` z11–14), z14 tiles x 2631–2633, y 6348–6350, compared with Overpass within 1,500 m of the commons anchor.

| class / subclass | Tiles (1.5 km) | Overpass |
|---|---|---|
| restaurant / restaurant | 10 | 11 (one node added after the tile build) |
| fast_food / fast_food | 12 | 12 |
| fast_food / food_court | 3 | 3 |
| cafe / cafe | 3 | 3 |
| shop / convenience | 1 | 1 |
| bus / bus_stop | 38 | 38 |
| park / park | 44 | 46 (outline-vs-point radius) |
| library / library | 2 | 2 |

`restaurant` comes through as its own class: **Confirmed**. Bookshops appear as `library / books` (none within 1.5 km). Bus stops appear only in `poi`.

## 4. Owner claim (Threads)

- Root key: ES256 (P-256) created once by `scripts/owner-key.mjs`. The private JWK is stored only in the owner's local config and as the Worker secret `OWNER_ROOT_JWK`; the public part and claim record are in `fixtures/owner-claim.json`.
- Fingerprint: SHA-256 over JCS `{v, root_kid (RFC 7638 thumbprint), owner_hash}`; `owner_hash` = SHA-256 of the normalized Threads handle. Main test account: **@combba82** (switched from @centisgood before anything was posted; @centisgood stays a secondary tester). Display: `ef96 1d6f 307b a775`.
- **Status: `claimed`, machine-verified at 2026-11-01T08:26:10Z.** Post: https://www.threads.com/@combba82/post/DfMS8pQk7S9 (media id 18127671887295795). The owner posted the approved text from the Threads app. The Worker's token path then found it among @combba82's recent posts, re-read it, and matched account, body and fingerprint (`note: existing claim post reused`). The Graph publish call had returned `code 24 / subcode 4279009` for this account even with `threads_content_publish` granted, so the reuse path was used. Agent Card `x-musely.owner_claimed: true`.
- Earlier status: `pending_claim`. Default path (direction v2 934c537, 6.3): the Worker exchanges the OAuth code with the app secret, publishes the approved text, re-reads the post and matches the fingerprint.
- Meta app "Musely Preview" (development mode, not submitted for review): Threads use case, `threads_basic` + `threads_content_publish`, redirect `https://preview.musely.net/api/threads/callback`. Testers: @centisgood (accepted) and @combba82. Worker secrets `THREADS_APP_ID` / `THREADS_APP_SECRET`.
- Owner-direct posting is a visual check only: on 2026-11-01 Threads exposed no post text without a token (oEmbed returns an embed shell; public and `/embed` pages render client-side).

## 5. Cloudflare facts used by the design

- Durable Objects on the Free plan are SQLite-backed only; alarms count as requests; each `setAlarm()` is a row write; alarms are at-least-once with up to 6 retries.
- Rate Limiting binding: `ratelimits` in wrangler config, period 10 or 60 s, per-location and approximate.
- Turnstile widgets can be created through the API.
- AI Gateway supports custom providers, and `cf-aig-collect-log-payload: false` keeps bodies out of logs. **Decision (I-12, 2026-11-02): Musely does not use AI Gateway.** The Worker calls `https://api.meta.ai/v1` directly (`MODEL_BASE` in `wrangler.jsonc`) and sends only `authorization` and `content-type`; the earlier gateway-only header was removed from `worker/core/model.ts`. Direction v2 (15) planned a gateway for logs and caching; it was never set up. If a gateway is adopted later, challenge (webcam frames) and negotiate (personal signals) requests must first have gateway body logging off (`cf-aig-collect-log-payload: false`) and caching off (`cf-aig-skip-cache: true`), and that change needs its own test and an update here. `scripts/boundaries.test.mjs` fails if `MODEL_BASE` stops being `api.meta.ai` or a model request carries any other header.
- Worker secrets set: `MODEL_API_KEY`, `OWNER_ROOT_JWK` (values never in the repository or the client bundle; the production HTML was re-checked for the key prefix after setting them).

## 6. Proxy limits in production (2026-11-01)

| Check | How | Result |
|---|---|---|
| Hourly quota → replay | One judge session, 120 paced live calls | Call 121 returned `source: replay, reason: session_quota`, a recorded real response (request id `2c7fc75e…`) |
| Failure → replay | Observed during the same run | One real timeout became `replay: timeout`; the reservation was charged in full |
| Daily cap → replay | Temporary deploy from the main build (`f8fddeea…`) with `DAILY_BUDGET_USD=0.372`, just above the day's spend ($0.3688); then redeployed with the config value | Proxy call → `replay, reason: budget` (`1b0893ff…`). Heartbeat tick 24 → `spotlight_fallback, reason: budget`, the world kept turning. Cap restored to $12 at 08:23 UTC; served HTML hash unchanged; 7 secrets intact |
| Key exposure | Served HTML scanned for key patterns and secret names | none |

Measured cost: about $0.0018 per live call (169 calls = $0.31). Daily cap set to $12 (team credits $150 over 10 days, with room for development).

## 7. I-12 operating boundaries (#60, 2026-11-02)

### 7.1 Demo limits and what is not built

The public wording is `static/terms.html`, section 5 "Limits in this demo" (`/terms#demo-limits`), linked from the About dialog. `scripts/boundaries.test.mjs` checks that wording against the constants below.

Enforced now (server side):

| Limit | Value | Where |
|---|---|---|
| Visitor session | Turnstile token checked on the server (allowed hostnames only), then a signed 24-hour session | `worker/core/session.ts` |
| Visitor live calls | 3 per session per hour (`HOURLY_LIMITS.visitor`); the welcome ritual's challenge has its own 3 per hour (`CHALLENGE_HOURLY_LIMIT`); priority spotlight requests 3 per hour (`SPOTLIGHT_REQUESTS_PER_HOUR.visitor`) | `worker/core/ledger.ts`, `worker/core/world-runtime.ts` |
| Visitor IP cap | 40 visitor calls per IP per hour (`IP_HOURLY_LIMIT`); the IP is kept only as a keyed hash | `worker/core/ledger.ts` |
| Judge quota | 120 live calls per judge session per hour in total, including challenge calls (`HOURLY_LIMITS.judge`) | `worker/core/ledger.ts` |
| Bursts | 20 requests per 60 s per key (Rate Limiting binding `BURST`, per location and approximate) | `wrangler.jsonc` |
| Daily budget | `DAILY_BUDGET_USD` (12 at this commit), per UTC day, reserved before each call. At the cap, `/api/muse` answers a labelled replay or scenario (`reason: budget`) and the heartbeat runs on rules (`spotlight_fallback`, meeting answers by rule). Meeting answers already stop at 40% of the day's budget left | `worker/core/ledger.ts`, `worker/core/world-runtime.ts` |
| Owners | one real owner (`owner:kim-sejun`, Jolly `00-jolly`) and two team-controlled system principals (`system:demo-peer` with `09-copper`, `system:reviewer` with `04-ember`). Agent keys are issued by the operators only | `worker/core/owner-session.ts`, `docs/DEPLOYMENT.md` |

Not built (S4, G-01): general user accounts and connections, a 24-hour probation for newly connected Muses, per-owner rate limits and protection against mass registration. The demo limits above are session, IP and global-budget limits for one operator's demo. They are not those safeguards and are not claimed as them (`docs/roadmap/2026-11-01-four-stage-roadmap.md` section 7, row "24시간 수습·주인 단위 제한").

### 7.2 Secret exposure checks

`scripts/boundaries.test.mjs` uses fake values for `MODEL_API_KEY`, `SESSION_SECRET`, `JUDGE_TOKEN`, `OWNER_CONTROL_TOKEN`, `DEMO_PEER_CONTROL_TOKEN`, `REVIEWER_CONTROL_TOKEN`, `TURNSTILE_SECRET`, `THREADS_APP_SECRET`, `OWNER_ROOT_JWK` (whole value and its private `d`), a Threads token and an agent key issued during the test. It also searches for patterns: Model API key (`LLM_…`), agent key (`msly_` + 43 characters), private EC JWK member (`"d": "<43 characters>"`). Base64url runs are decoded and searched too, so a secret inside a cookie body is found.

- Bundle: a copy of `app/` is built (`scripts/build.mjs`, then `wrangler deploy --dry-run`) with the fake values in the environment and in `.dev.vars` and `.env`. Every file of `dist/` and of the Worker bundle is searched. This checkout's own `dist/` and `.wrangler/dry-run/` are searched for the patterns.
- Worker: through `worker/index.ts` with WorldDO on node:sqlite. Calls: `/api/status`, visitor/judge `/api/session`, owner/peer/reviewer `/api/owner/session`, agent key issue and list, `/mcp` (initialize, tools/list, eight tool calls, a wrong key), `/api/muse` (spotlight, the ritual challenge), a heartbeat, P0, demo checks, owner location, revoke and re-delegate, reviewer reset, the Threads claim (wrong account, owner account, re-check), `/api/world`, events, highlights, `/api/world/run` and `?snapshot=1`, run inputs, autonomy, one event, every Agent Card and its JWKS (from `jku`), and the key purge. Searched: every response's headers and body, every storage table (events, runs and run inputs included), every console line, and every outbound request.
- Intended exceptions: the agent key appears exactly once, in its issue response. The Threads token is stored in `claims.token`. Resident and executor private keys are stored in `private_keys` (the owner root's `d` is not). The model key goes only to `api.meta.ai`, the Turnstile secret only to `challenges.cloudflare.com`, the Threads app secret and token only to `graph.threads.net`.
- Not covered: Cloudflare's own logs and dashboards, the real secret values (checked by hand against production, see below), and text a user types into public fields.
- `THREADS_APP_ID` is not a secret: it is the OAuth `client_id` in the authorize URL.

### 7.3 Acceptance criteria and evidence

| Criterion (#60) | Test (file: name) or record |
|---|---|
| Turnstile hostname, signed session, visitor 3/hour, judge quota | `proxy.test.mjs`: "Turnstile: success requires an allowed hostname"; "sessions: signed, expiring, tamper-evident; judge token compared in constant time"; "session quota exhaustion switches to replay without calling the model"; "the liveness challenge has its own allowance, separate from the 3-per-hour trial"; "I-12 quota boundaries: visitor 3/h and judge 120/h per session, 40 visitor calls/h per IP, the world unlimited; a late settle never charges twice". `world-runtime.test.mjs`: "I-05 #1 visitor priority: …". Production: section 6 (judge session, call 121 → `session_quota`) |
| Budget reservation under concurrency, timeout/429/5xx/malformed, late settle | `proxy.test.mjs`: "ledger: concurrent reservations never exceed the cap; settle is idempotent; stale reservations are charged"; "the daily budget cap switches everyone to replay"; "429, 5xx, malformed output and a missing key fall back to replay"; "a timed-out call is aborted, charged in full, and its late answer is never used"; "failures with unknown usage keep the full reservation; refusals before generation cost nothing"; "I-12 quota boundaries: … a late settle never charges twice". `world-runtime.test.mjs`: "the daily budget cap keeps the world running on the scenario only"; "a timeout falls back (replay only when valid, else scenario) and is charged in full"; "I-05 #3 slots are released on every path: …". Production: section 6 (`budget` and `timeout` fallbacks) |
| No key or token in bundle or logs; with a gateway, challenge body logging and cache off | `boundaries.test.mjs`: "I-12 bundle: fake secrets in the build environment and local secret files never reach dist/ or the Worker bundle"; "I-12 secrets: no key or token in Worker responses, events, run log, logs, storage or requests to other hosts"; "I-12 Gateway: model requests go straight to api.meta.ai with only authorization and content-type headers". `proxy.test.mjs`: "no Model API key appears in tracked sources or the built client". Gateway: not used (section 5) |
| Demo limits told apart from the unbuilt 24-hour probation and per-owner limits | `boundaries.test.mjs`: "I-12 wording: terms, About and this record tell the demo limits apart from the unbuilt probation and per-owner limits"; section 7.1; `/terms#demo-limits` |

Limits of this record: these are Node tests of the Worker code with stubbed outbound services, not a run on Cloudflare. A deployed quota, budget and fallback run was recorded on 2026-11-01 (section 6) for the earlier preview build of the same proxy. The main product deploy of this change still needs its own record.



### Personal connections update (2026-11-04)

The preceding dated demo evidence and its original single-operator limitations are preserved. Personal sign-in/profile/delegation/entry are now implemented; explicit personal claim adds separate ownership proof without adopting or replacing ComBba. The current endpoint and token-retention behavior are described in [MCP_TOOLS](MCP_TOOLS.md#personal-muse-ownership-proof) and the current privacy policy. Additional probation and per-owner rate limits remain unimplemented; existing visitor/IP/key/global-budget limits do not prove those safeguards. Local integration coverage is not actual new-account or Muse-platform acceptance.
