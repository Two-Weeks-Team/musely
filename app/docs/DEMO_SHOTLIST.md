# D05 — 180-second actual-highlight edit preparation

Status: **PREPARATION ONLY**. Base `81a7199c236733f159e607d349e6e0d6256a947b`; the final release has not been frozen. D02/D03/D04 and real Meta-account checkpoints remain separate. In particular, the owner claim is pending and a production P0 successful trade has not been established. This document never substitutes a fixture for that missing shot. I11/run-log-2 must be present in the final release; older records are incompatible.

The story is a place where Muses live together. Identity/delegation determines whether they may act together; items change what they can do and why they move or cooperate. People watch ordinary life and approve a real promise. This edit selects actual resulting highlights. The existing 3:30 scripted Story remains a reference for composition, never material renamed LIVE, and the product itself remains unrestricted in length.

## Shotlist — exactly 180 seconds

All recorded footage carries **REPLAY**, original `live / rule / scripted / replay`, and **VIRTUAL LOCATION (DEMO)** continuously. Keep the original Meta/model and map attribution in the full frame. Original LIVE evidence describes the original execution, not the act of recording it. No private candidate time/place, account credentials, camera originals or business verification documents may be filmed.

| Time | Cut | Picture and plain-language caption | Required original record and filming checkpoint |
|---|---|---|---|
| 0:00–0:12 | s01 | Bay → commons → two Muses. “We delegate. They meet, decide and live together.” | Final-release real world/highlight event; runId/eventId/inputSeq and an associated model or signed-check anchor. Do not invent a statistic about time saved. |
| 0:12–0:26 | s02 | Select one Muse; open the original Agent Card/delegation evidence. “Identity before action.” | Actual signed A2A check and its original verdict. Public card only; never the agent-key setup screen. |
| 0:26–0:46 | s03 | P0: a valid delegation, the offered items, one completed trade. “Permission makes cooperation possible.” | **Pending real-account claim checkpoint.** Same release, real claimed owner; `a2a_verified` plus correlated `trade_completed`, same message/job, actual inventory result. No fixture replacement. |
| 0:46–1:04 | s04 | P0: same job after owner revocation; refusal, unchanged inventory. “The owner can stop it.” | `a2a_refused`, `delegation_revoked`, fresh request ID/nonce, same item/target job; before/after inventory unchanged. Existing daily trade cap is not revocation proof. Actual owner action is recorded by the root/account owner; this capture tool only reads its result. |
| 1:04–1:24 | s05 | P1: ten seconds before, ten seconds after gaining an item. “A reward changes the next plan.” | Controlled pair: same initial snapshot/seed/time/public inputs, item is the changed variable. Store both run/commit/hash references and resulting action/ability change. Different random model answers do not prove causality. Show controlled comparison label; do not call synthetic input LIVE. |
| 1:24–1:42 | s06 | Follow the actual discovery/Transit Pass/garden ability into movement or cooperation. | Real item history and ability before/after hashes, resulting event; reference its model request or signed-check anchor. Show actual ETA/world time and virtual location. |
| 1:42–2:02 | s07 | Two Muses agree; owners decide; one public confirmation. “A promise needs both owners.” | Actual candidate/answers → owner approvals of same revision/hash → `meetup_confirmed` approval_refs. Film only public result; private reasons and exact candidate conditions stay off camera. Demo principal remains labelled as such. |
| 2:02–2:16 | s08 | Gift, postcard arrival or completed repair/story help. “They can help each other.” | Actual `gift`, postcard delivery or `help_completed`, item consumption/result, one reward. Connected Muse vs rule-resident source stays visible. |
| 2:16–2:30 | s09 | Open highlight evidence: event → run/commit → original model request or signed verdict. | Existing public `/api/world/event?id=…`; exact selected event and input row. Model-free verification gets no invented requestId. |
| 2:30–2:44 | s10 | Recorded replay controls, 1/10/60×, six autonomy measures with sample/notes. | Compatible run-log-2/hash chain, fixed recorded prefix, real source/origin breakdown and world/run/window. No new world action/model call/reward. |
| 2:44–2:54 | s11 | Actual previously observed budget/provider fallback, honest source label, world continuing. | Original observed event and fallback provenance. Never inject faults into production for filming; an isolated D03 scene must say ISOLATED TEST and cannot replace the operational proof. |
| 2:54–3:00 | s12 | World holds; concise build/model/limits and original attribution remain. | Same release/source/config/deploy identity; no unsupported real GPS, unattended personal Muse, booking, RL-learning or SAM claims. |

## Manifest and evidence chain

Generate a new private plan; do not overwrite an original take:

```sh
node scripts/demo-video.mjs plan /absolute/private/d05/plan.json
node scripts/demo-video.mjs collect /absolute/private/d05/plan.json /absolute/private/d05/observations
```

The tool has no credential options and uses bounded, nonredirecting, same-origin public GETs. The initial four reads are `/`, `/api/status`, `/api/world/run`, and `/api/world/highlights?limit=100`. Add chosen event references to the plan, then collect into another new directory to retain raw `/api/world/event?id=…` responses. Each receipt keeps URL/method/UTC time/raw SHA-256/byte count, with no headers or authorization. Planning observations never attest a frozen deployment. Do not use `record-replay.mjs`, which is a separate model-calling tool.

A cut reference has this form (values must come from its raw response):

```json
{"eventId":"actual-id","runId":"actual-run","inputSeq":1,"originalSource":"live","requestId":"actual-request-or-null","signedVerdict":null,"file":"raw/005.json","sha256":"actual-64-hex"}
```

For model-free signed checks use `requestId:null`, and `signedVerdict:"verified"` or `"refused:delegation_revoked"` only when the original event supports it. Additional state/item events may have `role:"support"` and neither model nor signature value, but every cut still requires at least one genuine evidence anchor. Do not attach a requestId from an unrelated call. The script verifies raw-byte hashes, event/run/commit joins, run-log-2, original source and actual request/verdict values. It does **not** independently prove semantic causality, real-account ownership, Cloudflare deployment identity or D03/D04 acceptance.

Set each cut's `seekSec` and `snapshotHash` to its selected public checkpoint. Multi-run controlled comparisons instead supply `views:[{id,duration,runId,seekSec,snapshotHash},…]`. Keep raw run headers/input pages/event rows as well as event-evidence responses. Use the I11 public replay loader/paging acceptance for the full frozen prefix; a 100-highlight page is only a discovery page, never an assertion that all history was read. Preserve schema/engine/catalog/harness versions, original event time and publication time; keep the selected readThrough boundary in the filming notes.

Before actual capture, the root supplies `release.frozen:true`, full 40-hex `sourceSha`, real `deployId`, `configVersion`, exact public HTML SHA-256, model IDs and a local C10 freeze-attestation reference. `/api/status` is **not** a deployment-ID endpoint. The root must reconcile its deployment/config receipt and prohibit redeployment throughout filming; HTML is additionally checked before/after every take. Same HTML alone does not prove unchanged Worker source/config. If a release changes, collect/capture under a new directory and plan. Never copy a freeze flag from a calibration fixture.

The five `review` flags record the delivery coordinator's evidence review: P0 same-job causality, P1 controlled pair, attribution/source legibility, absence of private material, final release/account/dependency receipts. They cannot be inferred from a green local test. Codex can complete these routine reviews within the existing task authorization; they do not add a new user approval step. Actual account-owner actions and external legal/publication decisions retain their separate boundaries. This tool returns `links_validated_only`, never final acceptance.

```sh
node scripts/demo-video.mjs verify /absolute/private/d05/observations/collected-plan.json /absolute/private/d05/observations
```

Exit 2 and `blocked` are expected until all required real evidence exists. Pending claim, missing P0/P1 or an old run-log stays blocked.

## Local capture and edit

D04 owns Chromium while measuring. Request the slot from its owner, receive an explicit release, and return it after closing contexts/browser/server. Preparation needs no browser. Use an existing local Playwright host and import `captureDemoCut` from `scripts/demo-capture.mjs`; it does not launch/discover Chrome or load a browser profile. It creates a fresh context with no cookies, permission grants or service workers, records 1920×960, denies writes/private APIs, then loads the actual recorded-run UI and selected checkpoint. It verifies selected run/hash and visible event IDs. No owner control, model request, key setup or camera flow is performed. Bootstrap means the prelude before the selected take starts, not successful owner access. The exact same-origin `GET /api/owner/location` is still aborted there, recorded in `bootstrapDeniedReads`, and excluded only from the fatal count. After the take starts it is a fatal denied private read. The observed exact same-origin `POST /cdn-cgi/rum` is also always aborted, in either phase, and retained separately as `deniedTelemetry`. These narrow cases require no query/fragment/credentials; other private API requests and every other write, including other telemetry writes, retain the fatal denial policy. No private/telemetry request is newly permitted to reach the network.

```js
const {captureDemoCut} = await import('/absolute/worktree/app/scripts/demo-capture.mjs');
const media = await captureDemoCut(browser, plan, 's09', evidenceDir, {
  play: false, // Hold the public evidence modal; no click through its backdrop.
  // Optional local operator action: open the exact PUBLIC event evidence, or adjust the camera.
  prepare: async (page, root, cut) => {
    await root.locator('[data-event-id=' + JSON.stringify(cut.refs[0].eventId) + ']').click();
  }
});
// Store the returned file/hash/receipt in this cut's media field, then save a NEW plan.
```

P1 needs two distinct recorded checkpoints and exactly one ten-second take per named side: `views:[{id:'before',duration:10,runId,seekSec,snapshotHash},{id:'after',duration:10,runId,seekSec,snapshotHash}]`. Select `{viewId:'before'}` and `{viewId:'after'}` in the two capture calls, then set `media:[takeA,takeB]`. A single-view cut uses the implicit `main` view and its full shot duration. Before/after duplication, omitted sides, ambiguous selection and a take duration different from its view are refused. Each new take gets its own UUID and directory. The `musely-demo-capture-2` receipt binds the actual video file path, byte length and SHA-256 to take/view/run identity, duration, exact refs, original source labels and the full frozen release. The returned media row carries the same identity and refs; store it intact. Old unbound receipts cannot be silently upgraded. The assembler preflights all receipts and bytes before invoking ffmpeg, so a correctly hashed replacement file or a duplicated before take cannot fill the after side. Framing actions are followed by another checkpoint/event check.

Capture receipt stores a monotonic page-creation trim offset; inspect the trimmed first/last frame and action timing during playback because Playwright's first encoded frame can lag page creation. Re-record instead of hiding a missing or late result. If an unexpected popup/network failure or fatal denial appears, discard the take and retain its failure evidence. Each allocated take directory keeps `network-audit.json`, even when capture fails; successful capture receipts also preserve both denied-attempt lists, the fatal count and `continuedWriteRequests:0`. Denial entries retain method/path/phase/time, origin-match and abort-outcome metadata, not query values, bodies, headers or credentials. `blockedRequests:0` now means no fatal denials, not zero network attempts: known bootstrap reads and telemetry may have been attempted and aborted. `denialsAreAccessReceipts:false` makes explicit that these are not successful owner/telemetry access receipts. No world/API/MCP write is forwarded by this policy; that is separate from proving all server-side effects or final acceptance. Source labels must remain readable during camera moves and overlays.

Use existing local ffmpeg and a local system font; no download, external TTS/music, AI image, provider call or uploaded media:

```sh
node scripts/demo-video.mjs calibrate /absolute/new-calibration /absolute/ffmpeg
node scripts/demo-video.mjs render PLAN.json EVIDENCE_DIR /absolute/ffmpeg /absolute/local-font.ttf
```

Calibration is a two-second synthetic test pattern with a visible NOT ACCEPTANCE slate. It never supplies a shot or release evidence. Render takes normalized 30fps H.264/YUV420p, preserves the full app frame above a 120px label band, adds a continuous CONTROLLED COMPARISON (SIMULATION) label to the P1 cut, strips audio, concatenates in shot order, decodes the output and requires 180 seconds (±0.1s). It refuses overwrite and does not upload. File names with arbitrary shell characters are passed as subprocess arguments, not shell commands. Output is `musely-180s-review.mp4` and `render-receipt.json`, status **rendered_needs_playback_review**, finalAcceptance **not_measured**. If narration is desired, record an authorized local human voice later; this preparation adds none.

Final D05 acceptance remains root work after release freeze: watch the complete MP4 in a real local player, check 3:00 duration and every cut's original evidence/labels/attribution, verify the P0/P1 causal checkpoints and final build/model/limits match D06. Actual publication/submission/upload requires its separate authority/receipt. Tool preparation and playable calibration do not close D05.


The range-input portability review was not reproduced as a failure: the coordinator's blank-page Chrome156/current-Playwright diagnostic filled3.5 successfully. The existing range fill/input path is preserved here. This preparation change is verified with offline context/route stand-ins, not an actual Chrome capture or new operating request.
