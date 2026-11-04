# Submission checklist — D-06 #66

**State: team-review preparation; final submission readiness unverified; competition submission/publication/agreements are outside the current engineering work.** Source baseline: `81a7199c236733f159e607d349e6e0d6256a947b`. Later release integration must update the gates without rewriting the historical plan as PASS.

## Requirements and evidence basis

The adopted direction is **Startup / Push the Frontier**. The current form uses the exact option **Startups Track**. [Official event](https://cerebralvalley.ai/e/meta-ai-developer-hackathon): project deadline **2026-11-04 21:00 America/New_York = 2026-11-05 02:00 UTC = 2026-11-05 11:00 KST**. The event can change dates; recheck before execution.

A read-only authenticated form capture at **2026-11-02T12:45:16.657614+00:00** contains **101 controls**. Its visible required labels confirm **Public GitHub Repository** and **3-Minute Demo Video**, along with team name, track, problem statement, project description, Meta-product use, why Meta models matter, build-likelihood and overall-opinion questions. Native HTML required attributes are absent; visible labels/ARIA and the actual form are the requirement basis.

Capture SHA-256: `ba508566504af4f492bff7ebd06ce2377e98fa1715c01c9be6c252597e75263d`. Raw authenticated material stays outside this public-facing package; account names, private values, internal workspace paths and source preparation records are not copied here. [Sanitized 101-control coverage](submission/form-coverage.json) records every control's handling without field values. The [field draft](SUBMISSION_DRAFT.md) provides product text and leaves personal answers unset. This later capture resolves the older anonymous unknowns about repository/video requirements; the older dated verification record is preserved.

## Entry routes to provide

| Route | Entry and audience | Verification boundary |
|---|---|---|
| Public observation | https://musely.net — no login needed to watch | Verify in a new signed-out profile on the final release |
| Judge experience | `https://musely.net/?judge=<JUDGE_LINK_TOKEN>` → intended shared **Judge Muse**, shown as **Your Muse (judge account)** with **Judge account · provided by the team** | Dedicated Muse currently **OFF**; ON behavior awaits the operating verifier. After enablement, judges share this Muse: follow it, set public availability and read received greetings/proposals/notifications. It acts autonomously; Threads identity, key issuance, delegation revocation, reset and speech-by-proxy are unavailable. Exclude other Muses' private information; public watching remains available |
| Own Muse connection | Threads tester invitation → accept in Threads Settings → Account → Website permissions → Invites → **Sign in with Threads** → new-account **Muse Studio** → **Save my Muse** → **3 · Connect your Muse** using the existing Native Muse app | Save updates draft/profile name and appearance only; admission still requires the Muse's signed `enter_world` through the existing connection. Existing ComBba keeps its established account flow. Invitation must be accepted. The actual new-tester end-to-end path remains unverified; watching is open to everyone |

The judge URL above contains only the placeholder `?judge=<JUDGE_LINK_TOKEN>`. Use the canonical `https://musely.net` origin. The actual link belongs only in the submission form's private access field; never put the token in a public repository, README, video, screenshot, event or log. Preparing these routes neither publishes a real link nor marks any gate complete.

Entry implementation checkpoint (2026-11-05): [PR200](https://github.com/Two-Weeks-Team/musely/pull/200), source `8bf0696de963859ee994c63fa2732afc428e7828`, has the reported Studio **Save my Muse → 3 · Connect your Muse** flow on Worker `4f0a308f-e9c0-4b8d-bbbf-aca10b9e2122`. Saving prepares a profile; existing Native signed admission remains authoritative. Dedicated Judge Muse is **OFF** and its UI is still being integrated. A source/deployment record, corrected day lookup or successful session exchange does not establish actual new-account admission or Judge ON acceptance.

## Completion gates

| Gate | Current state | Evidence required before marking complete |
|---|---|---|
| Exact final release | **Identity recorded; whole S3 acceptance pending** | Retain source/deploy/config and scoped acceptance records; D01/D03 and dependent outputs are not inferred from a fixed build |
| Public repository | **Public access not established: anonymous draft check HTTP 404; final visibility UNVERIFIED** | Exact repository URL, explicit publication authorization, observed public visibility and logged-out source access |
| Three-minute video | **Private180.000s media reviewed; public delivery team-owned/UNVERIFIED** | Retain5400frames/content hash and original footage/run/event links. Public URL/upload/anonymous access require the team's separate action; no platform duration tolerance is inferred |
| Judge entry and fallback | **Dedicated Muse OFF; ON acceptance UNVERIFIED** | Only after enablement: fresh en-US/ko-KR desktop/mobile profiles, immediate session exchange/token removal on success/failure; badge; Watch → Camera → P0 guidance; team-labelled **Your Muse (judge account)** card, follow and public-status change; received-only inbox/notifications and no other-Muse private access. Current OFF404/session-transport evidence does not complete ON acceptance. The operating verifier must record the enabled final behavior without its token |
| P0/P1/P2 and six measures | **Recorded scoped proofs available; D02 prerequisite acceptance pending** | Revocation cause isolated with fresh IDs/nonces; controlled item-only comparison; scene→event→run/input→request or verdict; raw recount with scope/sample/missing notes |
| Recorded replay | **I11 technical evidence retained; actual C01 reclosure23:41:10Z recorded** | Actual supported record versions, public-only state, backward seek/end/return live, zero new model/MCP/write/reward effects |
| Device and operational evidence | **D04 numeric/physical scope evidenced; D01/D03 acceptance pending** | Preserve approved Pro/S23 references, local physical-client pair vs production cold entry,8vs10 budgets and source identities;4h/fallback/quota and whole prerequisites remain separate |
| Actual Muse-account use | **Existing ComBba connected receipts retained; #51 own proposal/explicit rejection still unobserved** | Keep actual connected command/event evidence and its release identity distinct from NPC behavior and local MCP fixtures. Existing-account binding does not demonstrate a new installation or unattended scheduler completion |
| Account verification / OAuth | **C3 existing-account binding evidenced on 2026-11-04; whole path pending** | [D01 update](D01_ACCEPTANCE.md#m4-path-evidence-update-2026-11-05): reported authenticated/connected success screen plus sanitized completed flow/adoption record and matching public event. Preserve the separate original claim receipt. A public profile event alone is insufficient; this documentation performs no new auth action |
| Team / representative | **UNVERIFIED — confirm before execution** | Actual roster; one track per participant and project; all members have read and agree to the rules. For Startup, the representative must be an active employee and authorized to represent the startup, receive notices and receive prize payment. Confirm those conditions privately; do not copy personal, employment or business evidence into the public repository |
| Attribution / asset scope | **Existing notice preserved** | Code/asset licenses and exclusions reviewed for the actual submission. Attribution alone does not establish a separate asset permission or media-use grant |
| Personal survey answers | **UNSET** | Representative's actual answers, including the two visible required opinion questions; no fabricated ratings or feedback |
| Media-use permission | **UNSET / separate legal decision** | Authorized submitter reviews the exact grant and records their decision separately; no checkbox is accepted by this package |
| Draft consistency | **Await final release** | README, field text, video, runtime/model, source labels, limitations and every cited artifact agree |

The representative requirements above come from the [official rules](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver), including their Startup-specific condition. They remain unverified; selecting the track or preparing this document does not establish eligibility. The readiness schema enforces our exact 180-second video package criterion only when `submissionReady=true`; the machine-readable video/public-delivery fields remain unset here despite the separate private media review, and no official duration tolerance is inferred.

Current runtime source config is **Meta direct `muse-spark-1.3` at `https://api.meta.ai/v1`**. This is separate from an actual successful live call on the final release. A2A, Tasks/inbox and MCP source/local tests are separate from a person's Muse installation. The 2026-11-04 C3 success connects the owner's existing ComBba to the Threads account; prior actual connected command receipts retain their own source and limits. Neither fact establishes a new connector installation or unattended scheduler completion. The separate Meta Connector application remains prepared at Review with its uploaded icon; legal consent, Submit and public-directory approval are not established by this package.

For character scope, see [NOTICE](../character-kit/NOTICE.md), [repository license](../../LICENSE) and [app attribution](../README.md#attribution). Meta retains Muse/Jolly rights; the fan-made reconstruction is excluded from the code license, has no ownership claim and grants no reuse right. This package neither asserts a blanket permission nor decides a legal violation. Keep any later rights evidence scoped to the actual assets and allowed use.

## Separate readiness and external execution

[Machine-readable readiness](submission/readiness.json) keeps these fields distinct:

| State | Value in this package |
|---|---|
| Draft preparation | prepared; final gates still unverified |
| Public visibility execution | not authorized here; current visibility unverified |
| Form data entered | false |
| Video uploaded | false |
| Media consent accepted | false |
| Submission execution | `not-authorized` |
| Submitted / confirmed | false / false |
| Submission receipt / approval receipt | null / null |

D-06 completion means a checked team preparation/handoff package; it is not a submission, approval or directory receipt. The private media and physical measurement evidence are distinct from whole S3 acceptance. Public access/video upload, agreements and final Submit are team-owned execution/permission decisions outside the current work, not new D04/D05 technical gates. Their states remain unverified/not-authorized; no readiness, consent or personal-fact field is silently set. C10 evidence records `issueId`, owner, commit SHA, PR, environment, deploy ID, URL, config version, time, command, result, artifact and limitations. Blank evidence, a fixture or a skipped measurement cannot fill a gate.

## Final handoff order

1. Integrate the final release source and record its identity; reconcile every statement above with that release and its actual acceptance evidence.
2. Hand the reviewed local media/content/duration record and clean-export candidate to the team; keep public visibility, video URL/access and publication decisions unverified until the team supplies actual evidence.
3. Have the representative confirm roster, field text and their own survey answers; keep media permission as a distinct decision.
4. Recheck the official form and deadline, validate all links and limits, and record preparation readiness without claiming submission.
5. The team owns any later publication/upload/form/agreement/Submit decision and its receipt. This engineering work performs none of those actions; submitted/confirmed remain false until separately evidenced.

No authentication, account change, form input, upload, public visibility change, submission or message delivery is performed by this documentation task.
