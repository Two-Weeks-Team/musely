# I-07 owner workflow acceptance

The I-07 implementation criteria are supported by the evidence below. This record updates the earlier implementation-only receipt that still reported a pending owner claim and no positive deployed bilateral approval. I-04's personal Muse client and D-01's webcam and full user flow retain their own acceptance records.

## Release and review identity

- Original implementation: PR96, reviewed40955b4, integrated552f372, release3d598da4a916f5bede0c56822532c3071166bc33. Local357checks plus typecheck/build/dry-run and an independent20file review were recorded.
- Actual deployed owner scenarios: source8b13a776b5a0a76558efee8c8c8bb6efb1408438, URLhttps://musely.net, deploymentba0508d2-9870-43da-8aee-f633594eddb0, Workerb5e18f5e-96b7-4198-a14c-dc3775c40174, configSHA256893a8e4ffd2857d25032a6454363134a2329a00a3e71f4e83c56413233df9e10.
- Current product: source4946517bbad0ec7677edd73205d7b4390dbdc4e5, deployment359cb5c5-dff3-4153-ae58-b36412e0cdd9, Workere10feb65-a7a2-463e-8537-7b1a876ed182, same config and compiled backendbf4d985ce91a6f861b047d8a526a64f5de3bf2470fe9db4b488316dee0908b5a. The20owner-workflow files are byte-identical from actual8b13to494. Older receipts keep their original deployment identity; they are not new494executions.
- The current494tree equals the testedf957candidate tree:610checks plus typecheck/build/dry-run. Subsequent tooling changes do not change product runtime. Of the original40955review files,8/20remain identical; later reviewed I-13/I-11 integration changed the others. Reuse is based on the actual8b13→494comparison, not a claim that all original40955files stayed unchanged.

## Criteria and evidence boundaries

| Criterion | Evidence |
|---|---|
| First trade answer, at most two counters, locks, atomic exchange and one reward on duplicate acceptance | Actual Worker/SQLite tasks tests cover each branch, inventory/history rollback and idempotency. Production P0 records a valid signed trade at events4012/4013,input349,version800→801. Not every counter branch was replayed in production. |
| At most five public candidates; private conditions stay local; both owners approve the same revision/hash/candidate | Local candidate/redaction/approval tests plus actual two-principal confirmation30/30. Task_f first approval is not confirmed; the other participant confirms revision1, event4139/input382, approval_refs ap_i/ap_j and each Meetup Ember0→1. An exact repeated original command adds no reward. |
| Reject, deadline, revocation and candidate change do not confirm or reward | Actual reject25/change34/mismatch26/expiry23 checks, including1799.607seconds of real waiting. Delegation revocation/redelegation of a meetup is covered locally; actual P0 revocation is separate. |
| Agent inbox and three owner notifications stay separate; reasons are not sent or logged | Local Worker/SQLite and DOM/network-redaction fixtures test private sentinel rejection and strict approval-body fields. The deployed scenario recorder omits raw inbox/reasons; its filtered artifacts alone are not proof about every server log. |
| Preserve old Task/inbox/key data and make migration/restart idempotent | Local v1→v2 tests preserve five nonempty Tasks, IDs/deadlines/offers/history/items and a working key across repeated restarts. The production migration event at tick407 had zero existing Tasks, so it is not called a nonempty production migration. |

Actual owner scenarios total150/150: confirm30,reject25,change34,mismatch26,reconnect6,expiry23 and revocation of the two test-created keys6. The principals are the real deployment owner and an operator-controlled demo peer. They are distinct authenticated sessions, not two real people or two Meta accounts.

The owner claim receipt at2026-11-02T15:00:20Z is claimed/worker_token/machineVerified=true. It precedes the successful P0 and bilateral approval. The original pending-claim and failed verification records remain retained.

UI evidence distinguishes the accepted pre-retry browser22/22 from a separate final20/20 result. The last retry correction has DOM10/10 and an independent RED/GREEN check; no post-correction22case browser run is claimed.

## Contract and handoff

This covers the I-07 event/command/idempotency portions of C03, identity/authorization/commit boundaries of C04, and Task/local-condition/bilateral-approval portions of C06. C05 model/time/accounting limits retain their separate I-12/D-03 evidence. The related experience rows are EXP-REWARD, EXP-MEETUP, EXP-COMMS and AUTONOMY. The implementation maps are [the experience matrix](EXPERIENCE_MATRIX.md) and [the execution contract](../../docs/roadmap/execution-contract.md).

The private C10 archive preserves original commands, receipts and hashes. Independent final review rechecked150actual checks and source equivalence with no additional required I-07experiment. Original P0/verifier failures remain alongside their separate offline corrections. Downstream I-03B, I-09, I-13 and D-01 may reuse these specific owner-workflow criteria; each retains its other prerequisites.

This document changes no product code, deployment, approval policy, private data or contract requirement. It does not complete personal Muse/webcam use, operating quota/fallback, four-hour continuity, full D-01/D-03 or S3, and it grants no external publication/submission authority.
