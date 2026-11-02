# Acceptance evidence (P-07, #46)

Saved results of the browser checks run on production (https://preview.musely.net/, main `8ccb2b3`, Workers build
`aedcac64-3293-4c82-97fe-8b219ba17c84`) for `docs/PREVIEW_ACCEPTANCE.md`. Each file is the full output of the script:
`info` (URL, start and end time in UTC, Chrome and Node versions, platform) and `cases`. The walkthrough, preview-flows, world-ui and layout files list checks with viewport, name, result and detail (world-ui also has two per-viewport summary records without a result); `entry.json` has two per-viewport records with the page errors (empty).
Viewports: D = desktop 1440x900, M = mobile 390x844 (DPR 2, touch emulation). Failures were injected in the browser only.
Checked before saving: no local path, terminal handle, key, token or email address appears in the files. The one string that
looks like a token, `judge=TESTTOKEN` in `world-ui.json`, is the dummy value a test puts in the address bar; it is not a credential.

| file | script | cases ok | run (UTC) |
|---|---|---|---|
| `walkthrough.json` | `scripts/walkthrough.browser.js` | 194/194 | 2026-11-02T03:06:26.605Z → 2026-11-02T03:09:17.845Z |
| `preview-flows.json` | `scripts/preview-flows.browser.js` | 66/66 | 2026-11-02T03:09:20.620Z → 2026-11-02T03:12:06.564Z |
| `world-ui.json` | `scripts/world-ui.browser.js` | 138 checks ok + 2 summary records (140 entries) | 2026-11-02T03:12:09.457Z → 2026-11-02T03:14:44.980Z |
| `entry.json` | `scripts/entry.browser.js` | 2 records, no errors | 2026-11-02T03:14:47.560Z → 2026-11-02T03:15:49.348Z |
| `layout.json` | `scripts/layout.browser.js` | 120/120 | 2026-11-02T03:15:52.270Z → 2026-11-02T03:24:26.394Z |

The 162 walkthrough screenshots (45 MB) are not stored here; `scripts/walkthrough.browser.js` writes them to
`output/wt-<viewport>-<experience>-<state>.png`. To repeat: run the script with the Playwright CLI against the URL, one script at a time.
