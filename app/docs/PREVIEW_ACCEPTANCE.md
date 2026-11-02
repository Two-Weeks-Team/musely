# Preview acceptance — S1 gate (P-07, issue #46)

Status: **S1 closed by the owner's decision of 2026-11-02; DEC-01 released (§8). Evidence for criteria 1 and 4 is on one build (re-run on production after the real-device layout and time-zone fix, PR #81). The owner accepted the fallbacks and the S1 scope, and closed the product experience review, by that decision, not by ticking the statements in §8 one by one; a real-device re-check stays open (§9).** Records the walkthrough of the whole preview on one build (8 experiences × 6 states × desktop and mobile), the allowed fallbacks, the review and the S1 → S2 decision (DEC-01). Everything here is a **preview**: scenes are SCRIPTED fixtures unless a cell says it reads the live world. Nothing here claims a real connector, the webcam ritual, real-phone performance, S2/S3 completion or a submission.

## 1. Identification

| field | value |
|---|---|
| issueId | #46 (P-07, epic #33) |
| owner | @ComBba (implementation and walkthrough by the preview's coding agent; the walkthrough plan and the reviews by separate agent sessions) |
| build under test | main `8ccb2b3` (merge of PR #81; includes #76, #77, #78, #79, #80 (the first version of this record) and the matrix at that commit). The first walkthrough ran on `5546113`; a phone and tablet check on real devices then found layout problems and Menlo Park times, PR #81 fixed them, and every check below was run again on this build |
| deployment | Workers Builds `musely-preview` success, build `aedcac64-3293-4c82-97fe-8b219ba17c84`, finished 2026-11-02 03:05 UTC (the earlier build `ef3a2abb-ec56-47a4-a3e4-8dca7b873518` of `5546113` no longer serves) |
| URL | https://preview.musely.net/ (`?autoplay=0`; Story · scripted, Live world, Preview flows, Replay tabs) |
| configVersion | `wrangler.jsonc` unchanged by #76–#79 and #81; client bundle, fixtures and scripts only. `wrangler deploy --dry-run` passed (231.55 KiB, gzip 63.96 KiB) |
| walkthrough run | 2026-11-02T03:06:26.605Z → 2026-11-02T03:09:17.845Z (UTC), one `walkthrough.browser.js` run on production |
| environment | Chrome 156.0.8078.76 headless via Playwright 1.56, Node 24.22.2, darwin arm64, a fresh browser context (empty cache) per experience page, network = this machine to Cloudflare. Times are shown in the viewer's zone, so `walkthrough.browser.js` and `world-ui.browser.js` fix the browser zone to `America/Los_Angeles` (the replay fixture then reads 09:00 "your time", and the walkthrough observations below are those values); `layout.browser.js` sets Seoul, London and Los Angeles itself |
| devices | **D** desktop 1440×900, DPR 1, no touch. **M** mobile 390×844, DPR 2, touch emulation. Both are browser emulation, **not a real phone** (DEC-04 stays open). `layout.browser.js` also runs 30 screen sizes from 320×568 to 1440×900, landscape phones and low windows included, and a phone sweep (§3) |
| modes | fixtures (Preview flows, Replay) are SCRIPTED; the Live world feed, header chip and evidence for LIVE rows are real GETs from the deployed Worker; failures are injected in the browser only, never in the service |
| secrets | none used or recorded; no judge token, no agent key, no camera |

### 1.1 Prerequisite acceptance

| issue | task | state | C10 record | accepted at | relation to the tested build |
|---|---|---|---|---|---|
| #43 | P-04 traceability | CLOSED | https://github.com/Two-Weeks-Team/musely/issues/43#issuecomment-6557524062 | `c93b314` (PR #73) | an earlier change to docs and the matrix checker; the matrix has been edited several times since (#76–#80), and this walkthrough exercised the matrix as of `8ccb2b3` |
| #44 | P-05 one continuous scene | CLOSED | https://github.com/Two-Weeks-Team/musely/issues/44#issuecomment-6558746164 | `0a60183` (PR #76 `6641d22`, PR #77) | an ancestor of `8ccb2b3`; exercised again by this walkthrough |
| #45 | P-06 source, replay, evidence UI | CLOSED | https://github.com/Two-Weeks-Team/musely/issues/45#issuecomment-6559785434 | `d918e0d` (PR #78) | an ancestor of `8ccb2b3`; exercised again by this walkthrough |
| (no issue) | PR #81 real-device layout and time zone fix | MERGED | PR #81 body | `8ccb2b3` | the tested build itself; read-only reviews by a separate Claude session (three rounds) and one independent subagent, plus bot summaries, see §6 |

Evidence files for this record are in `preview/docs/acceptance-evidence/` (§3). A closed issue does not by itself pass its content here: each criterion below was observed again on the tested build.

## 2. Verdict

| criterion (issue #46) | result | where |
|---|---|---|
| Every experience: entry, action, success, reject, cancel, retry on desktop and mobile | **PASS** (browser emulation, scripted fixtures) | §4: 8 experiences × 6 states, 81 cells per viewport, D 81/81 and M 81/81 (production, `8ccb2b3`) |
| Blocked paths and missing visual items resolved or an allowed, labelled fallback | **accepted by the owner's decision of 2026-11-02 (§8)** | §5: 0 missing items (2 promoted to labelled fallback, accepted by that decision), every fallback has an on-screen label and an owner task |
| Product experience review and agreed changes recorded; undecided core experiences = 0 | **closed by the owner's decision of 2026-11-02 (§8); no item-by-item review was recorded** | §6 records what the walkthrough and the reviews found; §7 lists 0 undecided core experiences and 6 decisions, settled by the same decision |
| `npm run check` and the related browser regressions on the same build | **PASS** (browser emulation, scripted fixtures) | §3 |

**Decision DEC-01 (S1 → S2): released on 2026-11-02 by the owner.** On build `8ccb2b3` the evidence criteria 1 and 4 are met. For criteria 2 and 3 the owner told the coding agent in the working session to mark S1 complete. That is recorded as the owner's acceptance of the fallbacks in §5 and of the S1 scope, and as the closing of the product experience review. What the record does not show: that a person walked the preview on a phone, tablet or foldable; the re-check in §9 stays open. Test counts and code review did not replace the owner's decision; they are the evidence it rests on. This is an S1 scope and experience gate only: real connector (DEC-02, DEC-11), webcam ritual (DEC-03), real phones (DEC-04) and the later stages stay with their own tasks and decisions.

## 3. Same-build checks

| check | command | result | artifact |
|---|---|---|---|
| unit, types, build, deploy dry-run | `npm run check` (cwd `preview/`, main `8ccb2b3`) | **172/172 tests**, typecheck, build, dry-run pass (231.55 KiB, gzip 63.96 KiB) | executor's command output (not stored as a file) |
| experience matrix | `node scripts/experience-matrix-check.mjs` | PASS: ids match the catalogs; 10 requirements, S2 14/14, S3 6/6, gates 4, decisions 11, problems 0 | executor's command output |
| walkthrough | `scripts/walkthrough.browser.js` on production | **194/194** (97 per viewport: 81 walkthrough cells + 16 isolation cases) | `acceptance-evidence/walkthrough.json` |
| flows and cues | `scripts/preview-flows.browser.js` on production | **66/66** | `acceptance-evidence/preview-flows.json` |
| live world, replay, evidence, failures, accessibility | `scripts/world-ui.browser.js` on production | **138/138 checks** (the runner prints 140: two more entries are per-viewport summary records without a result) | `acceptance-evidence/world-ui.json` |
| entry and first paint | `scripts/entry.browser.js` on production | **2 viewport records, no page errors** (the script throws on any failure) | `acceptance-evidence/entry.json` |
| layout on phones and tablets, and times in the viewer's zone | `scripts/layout.browser.js` on production | **120/120**: 30 screen sizes × (story, world mode, no page errors) + compact-strip cases + one phone sweep over 78 sizes (60 from 320–420 × 520–700 plus 18 either side of each media-query edge; the card text never under 49 px) + Seoul, London and Los Angeles (rows, evidence time and day, replay clock and filter, Feed and Highlights day headings, Highlights filter) | `acceptance-evidence/layout.json` |

The saved result files keep every case with its viewport and detail (the walkthrough, preview-flows, world-ui and layout checks also have a name and a result), plus the run's start and end time, URL, browser and Node versions. The scripts are those of `8ccb2b3`; none changed after these runs. The 162 screenshots of this walkthrough run (45 MB) are not stored in the repository; the script writes them to `output/wt-<viewport>-<experience>-<state>.png`. The deploy build id was read from the GitHub check run of `8ccb2b3`.

The isolation cases in the walkthrough (one pair per experience page) require **no `/api` write, no page error, and no request for the browser's position**.

## 4. Walkthrough: 8 experiences × 6 states × 2 viewports

How to read it: each row is one cell, a visitor path on the screen with an assertion on what is visible. Scenario cells click the scenario's own buttons, require the card to reach the expected step (`data-step`), and read only that step's title, text, status chips, metrics, checks, inventory and inbox. Replay uses its speed buttons, its position slider (End / Home) and its Restart button. Internal reads are limited to the replay clock, the world metrics (zoom, follow, pause), the onboarding state and the map zoom; the one synthetic input is the map touch that leaves Follow on mobile (a real drag on desktop). A cell that cannot be reached would be FAIL, never skipped. The branch after the state name says which of several paths a state is shown by (for example reject has several causes).

### EXP-ENTRY

| state | cell (what is walked and asserted) | D 1440×900 | M 390×844 | observed (desktop run) |
|---|---|---|---|---|
| entry | — | PASS | PASS | {"paths":3,"view":"choose"} |
| action | choose a harness job | PASS | PASS | harnesses 10 |
| success | harness worn | PASS | PASS | {"chip":"Trial · Copper · local","steps":3} |
| success | staged connection | PASS | PASS | {"done":4,"chip":"Connect · staged"} |
| reject | staged connection error | PASS | PASS | {"state":"STAGED · ERROR EXAMPLE","failed":1} |
| cancel | leave without choosing | PASS | PASS | {"path":null,"chip":"Enter"} |
| cancel | end trial | PASS | PASS | {"trial":null,"resume":1} |
| cancel | cancel the connection | PASS | PASS | {"c":"cancelled","t":"CANCELLED · NOTHING CONNECTED"} |
| retry | re-entry keeps the trial | PASS | PASS | view trial-card trial 09-copper |
| retry | connection retry | PASS | PASS | connecting |

Isolation checks: the browser was never asked for a position — D PASS, M PASS; no /api writes, no page errors — D PASS, M PASS

### EXP-WORLD

| state | cell (what is walked and asserted) | D 1440×900 | M 390×844 | observed (desktop run) |
|---|---|---|---|---|
| entry | map to the commons | PASS | PASS | {"zoom":21.7,"muses":8,"h":89} |
| action | spotlight turn | PASS | PASS | Spotlight · Tempo next · offer · last: SCRIPTED · 12 spotlight rows |
| success | decision shown LIVE with its model (live world) | PASS | PASS | ×EVIDENCECare for a snack-box plot twist with your campfire chapter?LIVE · Muse SparkWhen (your time |
| reject | out-of-scope decision refused (scripted fixture) | PASS | PASS | ×EVIDENCECopper's decision was refused: out_of_scopeRULERecordPreview fixture (SCRIPTED) — not a live recordWhen (your t |
| cancel | pause, leave follow | PASS | PASS | {"a":{"paused":true,"label":"Resume world"},"f1":true,"f2":false} · real drag |
| retry | resume the world | PASS | PASS | {"paused":false,"label":"Pause world","chip":"Spotlight · Tempo next · offer · last: SCRIPTED"} |

Isolation checks: the browser was never asked for a position — D PASS, M PASS; no /api writes, no page errors — D PASS, M PASS

### EXP-IDENTITY

| state | cell (what is walked and asserted) | D 1440×900 | M 390×844 | observed (desktop run) |
|---|---|---|---|---|
| entry | — | PASS | PASS | claim: claimedtask: submitteddeadline: 30 min |
| entry | visitor | PASS | PASS | visitor-unclaimed |
| action | — | PASS | PASS |  |
| success | — | PASS | PASS | ["complete","complete"] |
| reject | refused after revoking | PASS | PASS |  |
| reject | visitor trade refused | PASS | PASS |  |
| cancel | revoke | PASS | PASS |  |
| retry | standby, then run 1 again | PASS | PASS | standby → run 1 |
| retry | Restart returns to the first step | PASS | PASS | propose |
| retry | a recorded ritual changes nothing | PASS | PASS |  |

Isolation checks: the browser was never asked for a position — D PASS, M PASS; no /api writes, no page errors — D PASS, M PASS

### EXP-REWARD

| state | cell (what is walked and asserted) | D 1440×900 | M 390×844 | observed (desktop run) |
|---|---|---|---|---|
| entry | — | PASS | PASS | p1-transit |
| action | stamps and craft | PASS | PASS | ["complete"] |
| success | after | PASS | PASS |  |
| reject | no ability change | PASS | PASS | reward-trade-limits |
| reject | too far | PASS | PASS |  |
| reject | pair limit | PASS | PASS |  |
| reject | repeat find | PASS | PASS |  |
| reject | daily cap | PASS | PASS |  |
| cancel | withdrawn | PASS | PASS |  |
| cancel | expired | PASS | PASS |  |
| retry | next day, offer again | PASS | PASS | back to the offer, inventories as at the start: SparkPaper Map \| Snack BoxBus Stop Stamp |
| retry | another place, offer again | PASS | PASS | inventories as at the start |
| retry | another partner, offer again | PASS | PASS | inventories as at the start |

Isolation checks: the browser was never asked for a position — D PASS, M PASS; no /api writes, no page errors — D PASS, M PASS

### EXP-MEETUP

| state | cell (what is walked and asserted) | D 1440×900 | M 390×844 | observed (desktop run) |
|---|---|---|---|---|
| entry | — | PASS | PASS | meetup-agree |
| action | — | PASS | PASS |  |
| success | both approve | PASS | PASS | ["complete","complete"] |
| reject | one owner declines | PASS | PASS |  |
| reject | the approval target changed | PASS | PASS |  |
| reject | no shared time, private reasons stay private | PASS | PASS | public / owner A / owner B views |
| cancel | the window expires | PASS | PASS |  |
| cancel | an owner revokes | PASS | PASS |  |
| retry | back to normal life | PASS | PASS |  |
| retry | the next candidate | PASS | PASS | a different time and place |

Isolation checks: the browser was never asked for a position — D PASS, M PASS; no /api writes, no page errors — D PASS, M PASS

### EXP-LOCATION

| state | cell (what is walked and asserted) | D 1440×900 | M 390×844 | observed (desktop run) |
|---|---|---|---|---|
| entry | — | PASS | PASS | location-walk |
| entry | GPS permission states, no prompt | PASS | PASS | geolocation calls 0 |
| action | owner moves the cell, walk with ETA | PASS | PASS |  |
| action | verified teleport | PASS | PASS |  |
| success | arrived | PASS | PASS |  |
| reject | not arrived yet | PASS | PASS |  |
| reject | no Taxi Token | PASS | PASS |  |
| cancel | after arrival, the owner switches back | PASS | PASS |  |
| cancel | mid-walk, the owner switches back | PASS | PASS | from the walk |
| retry | verify the neighborhood again | PASS | PASS |  |

Isolation checks: the browser was never asked for a position — D PASS, M PASS; no /api writes, no page errors — D PASS, M PASS

### EXP-REPLAY

| state | cell (what is walked and asserted) | D 1440×900 | M 390×844 | observed (desktop run) |
|---|---|---|---|---|
| entry | open highlights | PASS | PASS | 200 moments |
| entry | the replay says what it is | PASS | PASS | 0:00 / 30:00 · 1× · 09:00 your time |
| action | play at 1×, 10×, 60× | PASS | PASS | 1.0 / 10.0 / 60.1 virtual s per real s |
| action | find a moment with the filters | PASS | PASS | 26 → 1 → none |
| success | evidence shows signer and verified steps | PASS | PASS | ×EVIDENCEJolly's signed request passed every checkLIVE · verifiedRecordPreview fixture (SCRIPTED) —  |
| reject | missing evidence shown as such | PASS | PASS | 3 replay rows: 1 missing, 2 replayed from a recorded request (no /api request: see the no-writes case) |
| cancel | close evidence by button and by Escape, focus returns | PASS | PASS | opened fx-0024, focus after button fx-0024, after Escape fx-0024 |
| retry | restart the replay | PASS | PASS | end 1800 → restart 0 |
| retry | reload newest events after a failure (failure injected in the browser) | PASS | PASS | Not responding (HTTP 503) · showing  → Connected · live data from · events fetched again, 80 feed rows |

Isolation checks: the browser was never asked for a position — D PASS, M PASS; no /api writes, no page errors — D PASS, M PASS

### EXP-COMMS

| state | cell (what is walked and asserted) | D 1440×900 | M 390×844 | observed (desktop run) |
|---|---|---|---|---|
| entry | greet | PASS | PASS | comms-day |
| action | gift | PASS | PASS |  |
| action | postcard | PASS | PASS |  |
| action | campfire invite (planned tool) | PASS | PASS | ["complete"] |
| action | help request (planned tool) | PASS | PASS | ["complete"] |
| success | postcard on the commons character | PASS | PASS | ["complete"] |
| success | answered, recorded with its source | PASS | PASS | comms-task-expiry |
| reject | injected instruction refused | PASS | PASS |  |
| reject | declined | PASS | PASS |  |
| reject | out of scope | PASS | PASS |  |
| reject | gift limit | PASS | PASS |  |
| cancel | the request expires | PASS | PASS |  |
| retry | next encounter | PASS | PASS |  |

Isolation checks: the browser was never asked for a position — D PASS, M PASS; no /api writes, no page errors — D PASS, M PASS

**Totals.** Walkthrough cells: D 81/81, M 81/81; every case including the isolation checks: 194/194.

## 5. Allowed fallback register

Statuses in `EXPERIENCE_MATRIX.md` after this change: experiences 6 complete / 2 fallback; actions (beats + body clips + meaningful actions) 93 complete / 55 fallback; items 58/58 and places 93/93 complete; communication 6 complete / 2 fallback; **missing 0** (two items promoted from missing to labelled fallback; the promotion is accepted by the owner's decision of 2026-11-02, §8). The matrix counts visuals; this register lists every substitute, so an entry can also sit under an experience that the matrix counts as `complete`. A fallback is a substitute the viewer can see and that is labelled on screen; it is not a claim that the real behaviour works.

| fallbackId | what is shown instead | where | label the viewer sees | real thing, owner |
|---|---|---|---|---|
| FB-REPLAY-FIXTURE | a SCRIPTED replay of 30 virtual minutes at 1× / 10× / 60× instead of a real run player | EXP-REPLAY | `SCRIPTED · PREVIEW FIXTURE`, `PLANNED · real run player (I-11)` | I-11 (run player), I-10 (server aggregation) |
| FB-COMMS-PLANNED | invite and help as staged cards and task states | EXP-COMMS | `Campfire invite (planned tool)`, `Help request (planned tool)` | I-13 |
| FB-TELEPORT-CARD | teleport arrival as a labelled card, no 3D effect (was missing) | `action:move_teleport_arrive`, EXP-LOCATION | `Verified teleport with a Taxi Token` card | I-09 |
| FB-HELP-CARD | `comm:help` as the staged card (was missing) | `comm:help` | `Help request (planned tool)` | I-13 |
| FB-WITHDRAW | a withdrawn offer as a scripted preview of the planned `cancelled` Task state (EXP-REWARD stays `complete` in the matrix; its source mode says scripted) | EXP-REWARD | "A scripted preview of the planned cancelled Task state: today's engine has no withdraw action yet" | I-07 (C06) |
| FB-CUE-PROP | an item card instead of a 3D prop that is not loaded yet or missing | Preview flows cues | `… is not loaded yet · item shown as a card` | I-09 |
| FB-CUE-ABSENT | "not in the commons (card only)" for a Muse that is not one of the eight commons characters | Preview flows cues | `not in the commons (card only)` | I-09 |
| FB-BEATS-ACTIONS | 26 beats and 29 meaningful actions use a substitute clip or a card | EXP-WORLD and the matrix §4 | the clip or card is labelled in the matrix; compound beats play their first clip | I-05 and I-09 (beats), I-09 with I-02 / I-07 / I-13 (actions) |
| FB-MEETUP-CONTRACT | "the approval target changed" and "next candidate, at most five rounds" are scripted contract behaviour (C04 approval target check, C05 up to five candidates, C06 task revision and content hash), not engine behaviour yet | EXP-MEETUP | task states shown on SCRIPTED · PREVIEW FIXTURE cards | I-07 |

## 6. Reviews and changes so far

This log is the record of what the walkthrough and the reviews found, what was changed, and the result on the tested build. Code review and test counts do **not** replace the owner's own look at the same build; the owner's decision to close S1 (§8) did not rest on a recorded walk of the preview on a phone, which §9 keeps open.

| source | finding | change | where |
|---|---|---|---|
| PR #76 review (Codex, browser-reproduced) | a cue could restart the story after a mode change; the pause button did not match a cue-held world; a replaced cue left the previous character mid-clip; a cue claimed a 3D prop that was not there; `?entry=watch` crashed | fixed; 19 regression cases | #44 |
| PR #76 | at 390 px the story heading and time caption printed over the welcome card in Live world (also on main) | hidden in Live world on mobile; regression case | #44 |
| production check after #76 | on a slow link the props file arrives minutes late, so the prop cue only ever showed its fallback | a cue loads its prop on demand and upgrades its card | #77 |
| PR #78 reviews (Codex, three rounds: 5 + 4 findings, then none) | replay isolation leaked through in-flight requests; re-clicking the Replay tab stopped it; `replayOf` objects not de-duplicated; missing request ids shown as measured zeros; 80,000-event read limit treated as complete; a forced refresh bypassed isolation; a refused session call used up the judge token | all fixed with browser and unit regressions | #45 |
| found while fixing #78 | a real replayed event has no top-level request id, so the evidence dialog called a good replay "Missing evidence" | fixed; fixture uses the Worker's shape | #45 |
| walkthrough plan | EXP-REWARD had no refused, withdrawn, expired or next-try screens; EXP-COMMS had no declined, out-of-scope, expired or next-encounter screens; EXP-MEETUP had no approval-target-changed or next-candidate screens | new scenarios `reward-trade-limits`, `comms-task-expiry` and two `meetup-agree` steps | #79 |
| PR #79 reviews (two Claude passes, one Codex bot) | the reward example "Coffee for a Fruit refused for no ability change" contradicted the engine (`checkTrade` approves it); withdraw is not an engine action; the matrix claimed a daily cap with no screen; "next candidate" showed the same candidate; walkthrough cells read the whole panel | Spark for a Snack Box (engine-verified by a unit test), withdraw labelled as planned, daily-cap step, `candidate-2`, cells read only the current step | #79 |
| real-device report, 2026-11-02 (screenshots of a phone in portrait and of a tablet or foldable) | on a phone the selected-Muse card grew over the header chips; on tablets (701–886 px) the header folded into three rows and an element overflowed to x=886, so mobile Chrome widened the layout viewport and shrank the page; the story heading sat on the character; times were Menlo Park times. The 390×844 emulation had shown none of it | PR #81: the header wraps; the card is anchored to the measured header and footer heights and its text scrolls while the two buttons stay; map buttons follow the footer; on short screens the card becomes a compact strip; every shown time is the viewer's own (the world keeps Menlo Park time for its day) | #81 |
| PR #81 reviews (a separate Claude session in three rounds on heads `1c14b10`, `a82d2a9` and `133ab71`: 6 important + 11 minor, then 1 + 10, then 8 minor; one independent subagent on `67433a2`: 2 important, 6 minor, 1 uncertain; the last commit `4f2e9d1` was checked by the layout check and the regression only. The Codex bot reviewed the first commit only and found nothing; CodeRabbit left a summary and no review comments) | map buttons over the footer; buttons pushed out of a scrolled card; Follow and the meet-up plan unreachable when the card was hidden on short screens; meet-up line lost on small phones; card text squeezed to 3 px (320×568, world mode) and 12–46 px just outside the first strip edges; map buttons jumping 30 px (phone) / 18 px (desktop) when the zoom crossed 20.35; heading over the strip at 932×430; meet-up line cut off at 568×320; formatters keeping the zone they were built in; weak or flaky checks | each finding was checked by reading the code or by measuring, then fixed. Not reproduced by measurement and left unchanged: tablet landscape 1024×768 … 1194×834 and headers at 1181 px and wider (kept as regression sizes). The layout check grew from 17 sizes to 30 sizes plus a phone sweep | #81 |

## 7. Undecided core experiences: 0

Questions that were open during S1 and how each was settled. "Decided by" is the implementer for the preview scope, settled by the owner's decision in §8.

| question | decision | evidence |
|---|---|---|
| How does a reward end without a trade (withdrawn, expired, refused) and start again? | scripted states from the engine's own rules, with the engine reason pinned by a test; withdraw labelled as planned | §4 EXP-REWARD, `preview-flows.test.mjs` |
| How does a message end without delivery and start again? | task states: declined, out of scope, daily limit, expired, next encounter as a new task | §4 EXP-COMMS |
| Is a real run player part of S1? | no: S1 ships a playable fixture (1× / 10× / 60×, seek, filters, evidence); the real player is I-11 and is shown as PLANNED | §4 EXP-REPLAY, §5 FB-REPLAY-FIXTURE |
| Does the preview ask for GPS? | no: GPS is phase 2; the preview shows the three permission states and never asks the browser | §4 EXP-LOCATION (geolocation calls 0) |
| What does the viewer see for actions without a built effect? | a labelled fallback clip or card | §5 |
| Where does a stage-one claim stop? | at a SCRIPTED fixture or a labelled live read; no hidden S2 prerequisite is added | §1, §2 |

Known gaps that are **not** core experiences and are not hidden by this document: the header label "Muse Spark · not connected" is still read once at load (only its tooltip was made honest); EXP-WORLD success reads the live feed and fails if the world has no LIVE row at that moment; accessibility is checked by emulation and attributes, not with a real screen reader or phone; on screens under 530 px tall (and phones up to 380 × 610 px) the selected-Muse card is a compact strip, so its activity line and "Wants" note are not shown there; layout is measured in emulation on 30 sizes and a sweep, not on the owner's phone, tablet or foldable (browser toolbar shown or hidden, rotation, system font size and notch are not covered).

## 8. Owner decision (S1 closed)

**Decision, 2026-11-02:** the owner instructed the coding agent in the working session to mark S1 complete. The agent recorded it here and did not tick the statements below on the owner's behalf: the record cannot say that the owner walked the preview on a phone or read §5 line by line. It applies to the build at https://preview.musely.net/ (build `aedcac64-3293-4c82-97fe-8b219ba17c84`, commit `8ccb2b3`).

- [ ] I walked the preview on desktop and on a phone and found no core experience undecided. (not ticked: not stated by the owner)
- [ ] I accept the allowed fallbacks in §5, including the two promoted from missing (teleport arrival card, help card). (covered by the decision above)
- [ ] I accept the S1 scope: SCRIPTED fixtures plus labelled live reads; no real connector, webcam ritual or phone performance claim. (covered by the decision above)
- Changes agreed from this decision: none recorded.
- Decided by, date: the owner, 2026-11-02, by instruction in a working session (not a form signature).

## 9. Remaining work and decisions

Not closed by this document (see `EXPERIENCE_MATRIX.md` §9 for the per-experience I-* and D-* mapping and §10 for the decisions):

- S2 builds the real connection, claim and ritual, rewards, meet-ups, location, replay record player and communication tools (I-* tasks). DEC-02 and DEC-11 (real connector, unattended calls), DEC-03 (webcam ritual), DEC-08 (printed agent key to rotate) must be resolved with the owner's real account.
- S3 integrates and verifies on one deployment (D-* tasks), including DEC-04 (target phones, memory, DPR), DEC-05 (judges are not Threads testers), DEC-06 (submission authority) and DEC-07 (public-switch cleanup).
- **DEC-10** (390 px header overlap): the release condition (no overlap at 390×844) is met on this build by the mobile header and Live-world layout cases in `preview-flows.browser.js` (66/66, `acceptance-evidence/preview-flows.json`) and by `layout.browser.js` (120/120, 30 screen sizes and a phone sweep, `acceptance-evidence/layout.json`); the owner's decision in §8 closes it.
- **Real-device re-check** (owner, after the fix in PR #81): the layout and the viewer's-zone times on the phone and tablet or foldable that showed the problems, with the browser toolbar shown and hidden, in both orientations and at a larger system font size. Emulation cannot show these. It is not a condition of S1; it stays open and is covered at the latest by D-04 (S3).

## 10. Repeat the checks

```text
cd preview && npm run check
node scripts/serve-dist.mjs 8788 --api https://preview.musely.net     # or open the production URL
# with Playwright CLI run-code, one script at a time (never two Chrome runs together):
#   scripts/walkthrough.browser.js, preview-flows.browser.js, world-ui.browser.js, entry.browser.js, layout.browser.js
```
