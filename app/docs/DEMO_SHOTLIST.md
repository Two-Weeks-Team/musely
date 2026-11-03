# D05 — reviewed 180-second actual-highlight media; prerequisite acceptance pending

Status: **Private media produced and reviewed; whole D05 remains pending its original D02/D03/D04 acceptance outputs.** The dated preparation/tool protocol below is retained, while the observed-media closeout records the later actual result. Recorded footage is source8b13/ba0508d2/b5e18f5e; currently serving494/359cb5c5/e10feb65 is separately verified. Actual operator P0 trade/revocation and I11 recorded replay evidence exist; neither is a personal Muse installation or webcam receipt. Existing claim/account provenance is not a new visitor authorization. This engineering scope ends at S3 development/verification and team-review preparation; competition Submit, agreements, public repository/video publication are team decisions outside it.

The story is a place where Muses live together. Identity/delegation determines whether they may act together; items change what they can do and why they move or cooperate. People watch ordinary life and approve a real promise. This edit selects actual resulting highlights. The existing 3:30 scripted Story remains a reference for composition, never material renamed LIVE, and the product itself remains unrestricted in length.

## Shotlist — exactly 180 seconds

All recorded footage carries **REPLAY**, original `live / rule / scripted / replay`, and **VIRTUAL LOCATION (DEMO)** continuously. Keep the original Meta/model and map attribution in the full frame. Original LIVE evidence describes the original execution, not the act of recording it. No private candidate time/place, account credentials, camera originals or business verification documents may be filmed.

| Time | Cut | Picture and plain-language caption | Required original record and filming checkpoint |
|---|---|---|---|
| 0:00–0:12 | s01 | A recorded public world; select a Muse. “We delegate. They meet, decide and live together.” | Final-release real world/highlight event; runId/eventId/inputSeq and an associated model or signed-check anchor. Do not invent a statistic about time saved. |
| 0:12–0:26 | s02 | Select one Muse; open the original signed-request/delegation verdict. “Identity before action.” | Actual signed A2A check and its original verdict. Public card only; never the agent-key setup screen. |
| 0:26–0:46 | s03 | P0: a valid delegation, the offered items, one completed trade. “Permission makes cooperation possible.” | **Recorded operator P0 exists.** Source8b13 original `a2a_verified`/`trade_completed`,input349; matching job/fresh-ID revocation refusal is input351. Keep server verdict, operator and recorded provenance; do not present it as a personal Muse client. |
| 0:46–1:04 | s04 | P0: same job after owner revocation; refusal, unchanged inventory. “The owner can stop it.” | `a2a_refused`, `delegation_revoked`, fresh request ID/nonce, same item/target job; before/after inventory unchanged. Existing daily trade cap is not revocation proof. Actual owner action is recorded by the root/account owner; this capture tool only reads its result. |
| 1:04–1:24 | s05 | P1: two ten-second controlled views without/with Transit Pass. “One item changes an available action.” | Controlled pair: same initial snapshot/seed/time/public inputs, item is the changed variable. Store both run/commit/hash references and resulting action/ability change. Different random model answers do not prove causality. Show controlled comparison label; do not call synthetic input LIVE. |
| 1:24–1:42 | s06 | A recorded rule discovery and a separate model greeting. | Rule discovery4265 and separate model greeting4270/input427, with its actual request anchor. Do not claim the discovery caused that greeting; keep virtual location and original source labels. |
| 1:42–2:02 | s07 | Two Muses agree; owners decide; one public confirmation. “A promise needs both owners.” | Actual candidate/answers → owner approvals of same revision/hash → `meetup_confirmed` approval_refs. Film only public result; private reasons and exact candidate conditions stay off camera. Demo principal remains labelled as such. |
| 2:02–2:16 | s08 | One recorded gift result, once. “They can help each other.” | Actual gift4446/input466 and its inventory result; exact-command duplicate returns the stored outcome without a second reward. Keep the operator/connected source label; do not imply later help/postcard footage was filmed. |
| 2:16–2:30 | s09 | Open highlight evidence: event → run/commit → original model request or signed verdict. | Existing public `/api/world/event?id=…`; exact selected event and input row. Model-free verification gets no invented requestId. |
| 2:30–2:44 | s10 | Recorded replay controls, 1/10/60×, six autonomy measures with sample/notes. | Compatible run-log-2/hash chain, fixed recorded prefix, real source/origin breakdown and world/run/window. No new world action/model call/reward. |
| 2:44–2:54 | s11 | Original `connected_muse` SCRIPTED guard followed by a separate LIVE turn; world continuing. | Original events4438/input462 SCRIPTED and4439/input463 LIVE. This is not quota/budget/provider-outage proof. D03 operating and isolated fault evidence remain separate; no new fault or retake is required by this cut. |
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

Those are generic preparation-verifier states, not the later root media review. Preserve original preparation/assembly flags, failed takes and their bytes. The reviewed media and its later root review are recorded below; fresh capture cannot inherit those results.

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

Root completed the exact-file native playback, full decode and cut/source/privacy/attribution review recorded below. Whole D05 still requires its original prerequisite acceptance outputs and consistent team handoff text. Competition publication/upload/agreements/Submit are outside this engineering scope. Tool preparation or a later unrelated receipt must not overwrite earlier not_measured/failed flags.


The range-input portability review was not reproduced as a failure: the coordinator's blank-page Chrome156/current-Playwright diagnostic filled3.5 successfully. The existing range fill/input path is preserved here. This preparation change is verified with offline context/route stand-ins, not an actual Chrome capture or new operating request.

## Observed media closeout, 2026-11-03

The exact private movie is `musely-180s-cfr-caption-v2-review.mp4`:7,930,897B/SHA256 `8e11ce0187e97b4839b551895af916896de036b838897fa252d103261b9deec6`,H.2641920×1080/30fps/5400frames/**180.000s**/no audio. The package's exact180s criterion is satisfied; no platform duration tolerance is inferred and no narration requirement is added.

There are **12 semantic cuts and13takes/assembled segments**, because s05 contains two separate10s controlled views. Source/capture8b13/ROWba0508d2/Workerb5e18f5e/config893a8e4…/model`muse-spark-1.3` is retained. Current service494/ROW359cb5c5/Workere10feb65 is not substituted into footage provenance.

| Cut/time | Preserved original proof |
|---|---|
| s01,0–12 | Actual public run3,input222/events3316–3317/model requestac22677a…; recorded living world |
| s02,12–26 | Original server-verdict event4012/input349; evidence, not a fresh signature check |
| s03,26–46 | P0 authorized operator trade events4012–4013/input349 |
| s04,46–64 | Original owner revoke350; same-job fresh refusal event4016/input351; original harness FAIL and separate correction retained |
| s05,64–84 | Two10s controlled simulation RunRecords; identical seed/clock/publicinputs,only TransitPass differs; no fake live/model/signature |
| s06,84–102 | Rule discovery4265 and separate model greeting4270/input427; discovery is not claimed to cause that separate greeting |
| s07,102–122 | Original stored MCP answer4133/input380,owner approvals381–382,confirmation4139;operator principals,private candidate conditions not filmed |
| s08,122–136 | Original gift4446/input466,one result; exact-command duplicate is stored-result proof,not a second reward |
| s09,136–150 | Actual event4270/input427→original model request7dbd8855… |
| s10,150–164 | Read-only recorded replay1/10/60×/pause/seek/autonomy; exact checkpoint proof stays in framing receipt/code |
| s11,164–174 | Original SCRIPTED connected_muse guard4438/462 and separate LIVE4439/463;not operating quota/provider fault |
| s12,174–180 | Original recorded event4443/input464;build/model/attribution/limits remain visible |

Root verified03:00/00:00 and actually played this exact file in QuickTime from20:32:10.953Z to the final brand frame20:35:32.675Z,with no seek/pause/rate change. Fresh ordinary decode recorded5400frames/180s. Root inspected the13listed frame times/contactsheet and source/REPLAY/VIRTUAL/operator/controlled labels. End controls were hidden,so a separately captured03:00elapsed reading is not claimed.

A later bounded optical review used only the last6s of s08/s10 at4Hz,48pictures total. First sampled gift proof131.50s was inside136s;60×159.75,Paused162.00,displayed175:23at162.25 and autonomy162.75 were inside164s. Quarter-second samples are not exact transition timestamps. No trim/hold/re-encode/retake was needed. The exact10523.6seek/hash remains separate receipt proof. Root's20:52:36Z fresh hash review recorded99assembly+59optical files with0mismatch. This note does not rerun decode/playback or rewrite original assembly finalAcceptance:not_measured.

Private evidence IDs: `root-movie-review`, `root-filming-preparation/render-cfr-180-v1`, `root-filming-preparation/optical-timing-review`, `root-filming-preparation/work/coordinator-reviewed-plan.json`. Keep original179.666667s render/probe failures unchanged. Rights/distribution/submission/media-use permission remains UNKNOWN for team review; attribution and private technical review do not supply permission. Actual public video URL/anonymous access/upload/Submit remain unexecuted or unverified,without becoming new engineering media gates.

Original D05 requires D02,D03,D04 acceptance outputs. D02's scoped P0/P1/P2/C09 proofs exist; D03's old8b13/default494four-hour FAILs remain separate from its new independent family1000run and operating quota/fallback gaps. D04's physical/C11 evidence now exists,so an older statement that the final phone was never measured is historical. Whole D04 still awaits its original D01 prerequisite. The23:30Z I09/I11 verification reopening is historical: I13#57 full handoff closed23:39:44Z,then actual I09#56 supplemental C10/reclosure23:40:41Z,then I11#59 reclosure23:41:10Z. PR125 normal merge5787d5d records the doc/order correction. Original partial-projection completion was withdrawn,not reinstated; technical evidence stayed valid and no time was backdated. Neither issue OPEN alone nor this media review establishes missing or completed prerequisites. D05 remains pending the actual required outputs,not competition submission. Personal Muse/CAPTCHA/webcam S3 checkpoints continue separately; Meta connector application remains prepared,separate from submission/consent.
