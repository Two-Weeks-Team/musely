# V2 verification record

The direction document (`docs/musely-direction-v2-2026-11-01.md`, PR #10) asks task 0 to record results in its chapter 17. That file is maintained in PR #10, so the results live here and a summary is posted on PR #10. Later PRs update this file as items are confirmed.

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
| Video length, public repository, submission fields | The submit page (`/hackathon/submit`) needs sign-in | **Unconfirmed** — owner to check in the signed-in form |

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
- Status: `pending_claim`. Default path (direction v2 934c537, 6.3): the Worker exchanges the OAuth code with the app secret, publishes the approved text, re-reads the post and matches the fingerprint.
- Meta app "Musely Preview" (development mode, not submitted for review): Threads use case, `threads_basic` + `threads_content_publish`, redirect `https://preview.musely.net/api/threads/callback`. Testers: @centisgood (accepted) and @combba82. Worker secrets `THREADS_APP_ID` / `THREADS_APP_SECRET`.
- Owner-direct posting is a visual check only: on 2026-11-01 Threads exposed no post text without a token (oEmbed returns an embed shell; public and `/embed` pages render client-side).

## 5. Cloudflare facts used by the design

- Durable Objects on the Free plan are SQLite-backed only; alarms count as requests; each `setAlarm()` is a row write; alarms are at-least-once with up to 6 retries.
- Rate Limiting binding: `ratelimits` in wrangler config, period 10 or 60 s, per-location and approximate.
- Turnstile widgets can be created through the API; AI Gateway supports custom providers, and `cf-aig-collect-log-payload: false` keeps bodies out of logs.
- Worker secrets set: `MODEL_API_KEY`, `OWNER_ROOT_JWK` (values never in the repository or the client bundle; the production HTML was re-checked for the key prefix after setting them).
