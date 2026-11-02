# Recorded world replay — I-11

This is a read-only projection of public recorded state. The scripted preview fixture stays in a separate mode. Loading an old, incompatible or incomplete run is an error, not an empty world and not a request to repeat its actions.

## Recording decision and migration

`run-log-1` preserved an initial public snapshot, input order, events and state hashes. Redacted model/private inputs cannot reconstruct every later state. I-11 therefore adds exact **public** after-snapshots and moves new recordings to `run-log-2`.

This is the I-10/I-11 integration ruling: use the existing `publicState` allow-list and text hashes; do not replay an engine, call a model or reconstruct private information. The public snapshots are not a visitor's authentication, claim, owner approval or reward.

`RunLog.init()` adds nullable `after_snapshot`/`after_snapshot_error` columns and the `run_counts.replay_bytes` counter when absent. Existing rows, events, runs and original snapshots are preserved. A schema change opens one `version_change` run linked to the old run; repeated startup is idempotent. Old `run-log-1` records remain accessible as records but the new player reports `incompatible_record`.

Each new checkpoint is stored with its input/event commit inside the existing synchronous transaction. The body is only `snapshotBody(publicState)`, its hash is the existing `musely-run-state-v1` hash, and input/event/version/hash continuity is checked before playback. Existing rollback tests cover the new checkpoint together with state, events, nonce and command result.

## API and finite loading

- `GET /api/world/run` lists runs; no snapshot body is returned in the list.
- `GET /api/world/run?runId=…&snapshot=1` includes the initial snapshot and a frozen `readThrough {inputSeq,eventSeq,inputs,events}` boundary.
- `GET /api/world/run/inputs?runId=…&since=…&limit=…` pages by input sequence. V2 responses contain at most 16 rows and stop before approximately 2 MiB; a caller must continue by the last sequence, not assume a short page is the end.
- `GET /api/world/events?runId=…&since=…&limit=…` reads only that run's events. The `(run_id, seq)` index supports this read. Legacy default/day/tail event queries retain their meaning.

The loader stops at the frozen input/event sequences and verifies the matching counts. Live commits appended during loading do not extend the replay. Any missing page, wrong run, hash mismatch, unknown version or missing checkpoint is explicit (`load_failed`, `invalid_record`, `incompatible_record` or `incomplete_record`). A genuine zero-input/zero-event record displays its initial public snapshot and says it is empty.

The pure `loadRun(record)` player has `getState()`, `getFrame()`, `play()`, `pause()`, `seek(seconds)`, `setSpeed(1|10|60)`, `restart()` and `advance(milliseconds)`. All speeds and seeks select the same stored public snapshots. Commit order is canonical if a source timestamp moved backwards; the source timestamp is preserved and the UI discloses the adjustment.

`RecordedFrame` contains `replay:true`, `runId`, `worldId`, `recordedAt`, `snapshotAt`, `snapshotHash`, `publicState`, visible `events`, compact ordered `inputs`, `empty`, `playout` and `timeOrderAdjusted`. `worldPanel.onReplayFrame(listener)` publishes it and publishes `null` on return to live, fixture mode or teardown. Private markers and `text-sha256:` strings must not be rendered as recovered dialogue. Use the public event's line when present.

The I-09 renderer uses one actor set with two pure projection stores. Live snapshot monotonicity is preserved while a separate recorded store is rebuilt at each selected checkpoint, so seeking backwards never overwrites live state. `recordedAt` drives actors and pins; cards and labels use the same active projection. Returning a null frame restores the preserved live projection and actor roots. Beat-line, reflection and wants hashes are excluded from the visual projection; only the recorded public event line can speak.

The final checkpoint is held through the last scheduled public animation cue. This read-only playout tail uses the same cue scheduler as live rendering (legacy records use `event.at`; newer event publication timestamps are used when supported by that scheduler). The UI distinguishes playback time from the stored commit time and explicitly states that no world tick is executed. The tail does not reconstruct private state or generate another input/event/reward.

## Read-only UI boundary

The Replay tab retains its separately labelled scripted fixture without requests. Explicit recorded-run preparation has a restricted transport for same-origin GETs to the three log endpoints above. Playback and cached evidence make no further requests. The global replay barrier also refuses `/api/*`, `/mcp` and `/.well-known/*` requests; the dedicated record reader cannot call other paths or use a write method.

Recorded event evidence includes the stored run/commit hashes, model request references or signature/verdict fields already in the record. It does not fetch new credentials or run a verification again. The evidence overlay pauses the correct clock and resumes it on return. Returning to live discards the recorded projection and fetches a fresh live view.

## Size bounds and observed workload

A checkpoint body is at most 512 KiB. Each run stores at most 64 MiB of checkpoint bodies, tracked in the same commit. Beyond a bound the live world still commits and the original inputs/events remain: the missing checkpoint has `snapshot_too_large` or `replay_storage_limit`. The player reports an incomplete record instead of claiming exact replay. No old row is deleted to enforce this bound.

Measured 2026-11-02, anonymous production GET:

- Current `run-log-1` initial public snapshot: **37,542 bytes**; item history **153** rows (the implementation keeps at most 200).
- Latest 50 input rows: mean commit interval **62,357.76 ms**.
- Four-hour estimate using that initial snapshot: **8,672,202 bytes**, about **8.27 MiB**. This uses the stored initial snapshot, not a newly captured full current state.

A local engine simulation with real item/discovery hooks and no model calls ran 240 heartbeat commits: peak **75,534 bytes**, total **10,484,016 bytes**, mean **43,683 bytes**, history **197** rows. That is roughly 10 MiB and leaves about 6.4× checkpoint budget headroom. This is a size/workload simulation, **not** four wall-clock hours of deployed resilience or physical-device evidence. A higher external-command rate can consume the budget faster and remains visible through the explicit gap status.

## Validation and remaining deployment evidence

- `npm run check`: Node regression suite, typecheck, build and Worker dry-run.
- `scripts/run-replay.test.mjs`: exact snapshots at all speeds/seek, mismatched versions, corrupted/missing states, source time ordering, empty/error distinction, frozen GET-only paging and replay request isolation.
- `scripts/run-log.test.mjs`: old-table migration/restart preservation, atomic public checkpoint capture, row/run bounds, 240-heartbeat size sample, real Worker bounded pagination feeding the player.
- `scripts/recorded-scene.test.mjs`: reverse seek in a separate recorded projection, live cache preservation/null restore, and exclusion of private/hashed dialogue and goals.
- `scripts/replay.browser.js`: actual built app with locally fulfilled API shapes; the fixture is generated through WorldRuntime/RunLog in SQLite by `node scripts/build-replay-fixture.mjs`. It is synthetic UI evidence, not a live provider/account receipt. Remove the generated ignored `dist/replay-test.json` after browser use; it is not a production asset.

The local browser run at 1280×800 and 390×844 checks all speeds, rewind, cached evidence and resume, zero playback API requests/writes/model/MCP calls, explicit bad/old/missing/failed/empty states and return to live. The I-09 3D bridge is also checked locally for the same ten actor roots, recorded pin/actor/card time, reverse seek, preserved live cache and null-frame restoration. These local synthetic API fixtures do not prove a deployed model call or signed-agent session. The production sample currently uses `run-log-1`; deployed schema-2 rotation and same-release runtime smoke remain unverified. Physical-device and four-hour operational acceptance remain S3 work.
