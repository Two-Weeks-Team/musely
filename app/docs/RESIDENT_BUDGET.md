# Resident model budget

The trusted `RESIDENT_BUDGET_MODE=split-v1` deployment setting enables the existing
SQLite ledger's split policy. Browser input cannot select a budget or elevate a
reply's priority. Absent/OFF mode retains the original ledger contract.

Production limits are environment variables: total `DAILY_BUDGET_USD=30`,
`RESIDENT_DAILY_BUDGET_USD=24`, `INTERACTIVE_DAILY_BUDGET_USD=6`, and
`RESIDENT_HOURLY_BUDGET_USD=1`. Days use Asia/Seoul; the hour is rolling, not a
clock-hour reset. Visitor/judge calls and camera challenges use the protected
interactive pool. Background resident choices and replies use the resident pool.

`MODEL_PERIOD_BUDGET_USD=150` covers the five-day half-open interval configured by
`MODEL_BUDGET_START_AT=2026-11-04T00:00:00+09:00` and
`MODEL_BUDGET_END_AT=2026-11-09T00:00:00+09:00`. Existing reservation timestamps
are counted, including pre-feature spending; pruning retains the configured
period. Expiry or exhausted limits prevent another paid call, allowing existing
rule/replay fallbacks rather than spending past the limit.

Calls reserve their maximum before transport and settle actual known cost.
Abandoned reservations remain charged at the full maximum. IDs are idempotent.
The implementation reserves response headroom by projected hour/day cost:
action/reflection 60%, resident chat 80%, trade/invitation replies 95%, personal
Muse replies 100%. These fractions are implementation choices for the approved
degradation order, not spending targets or an extra 400-call limit.

`/api/status` exposes aggregate `residentBudget` counters only. `calls` counts
reservations; `knownModelCalls` counts settled, non-abandoned attempts, while
`pending` and `abandoned` remain separate. These are accounting records, not
proof that a particular model response was used. No actor, message, credential,
private reason or location is included. Legacy action classifications remain
conservative when a pre-feature reservation lacks a decision-kind tag.

Set `RESIDENT_MODEL_ENABLED=false` to stop resident spending while keeping the
interactive allocation. A full legacy-policy rollback also restores the earlier
daily-cap setting. The model credential remains the existing secret binding
`MODEL_API_KEY`; replacing it uses Wrangler's secure secret input. A later
operator sets the next budget interval/limits through environment configuration.
No key value, automatic key replacement, new model engine or authorization
change is introduced by this feature.
