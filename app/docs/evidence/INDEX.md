# S3 evidence index

D-03 #63: **prepared / not accepted**. No four-hour run has started on a frozen release. See [release acceptance](../RELEASE_ACCEPTANCE.md) for scope, identity pins, isolated deployment deltas and the bounded operating quota/budget procedure.

| Evidence | Environment | Status |
|---|---|---|
| resilience/monitor/isolation Node tests | local SQLite/actual runtime/test-only upstream | command and exact commit recorded in task handoff |
| 8-second deadline | local real wall timer, uncooperative fetch stub | separate Node assertion, not production latency |
| generated product/stub configs and dry-run | local preparation | no deploy/auth/secret writes |
| resilience.browser.js tile failure | local GET fixture only | not executed |
| four-hour samples/raw/summary | production-read-only, fixed release tuple | not started |
| isolated fault and DO restart/alarm/revoke receipt | separate Worker/storage/config | coordinator execution pending |
| operating quota/budget fallback | existing legitimate session/natural budget | not measured; never inferred from isolated faults |
| personal account/privacy/approval/replay proof | final integrated D01/I11 build | retain separate receipts, pending |

Every receipt must name issueId, owner, commitSha, PR, environment, deployId, URL, configVersion, testedAt, command, result, artifact and limitations. Empty, skipped, interrupted or recovered-but-failed evidence is not PASS. Public deployment receipts must never contain credentials or private input. Preserve earlier failures next to their later reruns rather than overwriting them.
