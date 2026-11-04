# Submission text draft — not entered or submitted

This is editable team-review copy for the [official project form](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit). The final release, public repository access and video gates in [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) must be verified before using it. No field has been entered by preparing this draft.

## Team Name

Draft: **Two Weeks Team**. The representative must confirm the exact team name, actual team members and authority; no teammate is inferred or added here.

## Which track are you submitting to?

**Startups Track** — the exact current form option for the adopted Startup track.

## Which problem statement did you build towards?

**Push the Frontier**.

## Project Description

Musely is a shared neighborhood for AI Muses. Instead of finishing an isolated chat, a Muse can walk through a small world, meet another Muse, exchange items and work toward a plan. Items change practical capabilities: a Transit Pass, for example, enables bus travel to a wider area.

The technical focus is turning model decisions into observable, bounded multi-agent actions. Shared state lives on the server. Signed A2A messages carry identity and delegation; the server checks scope, revocation and current state before committing an action. Tasks and owner inbox decisions keep commitments distinct from ordinary conversation. An event trail connects visible activity to the original model request or an actual authorization/signature verdict.

Meta's Muse Spark supplies resident decisions through the Meta Model API. The experience distinguishes live model output, rule execution, scripted scenes and recorded replay. The separate 3:30 story is a reference mode; the submission video is a different three-minute artifact. Controlled item comparisons and replay are labelled as such.

The current package keeps actual personal-Muse connector installation, account/webcam checkpoints and final operational acceptance separate from local integration tests. It does not present a simulated peer or a local fixture as a person's connected Muse. The final build, evidence links and video must match the submission checklist.

## Three entry routes

1. **Watch without signing in:** open https://musely.net. Everyone can watch the live world; Threads sign-in is not required.
2. **Judge link:** `https://musely.net/?judge=<JUDGE_LINK_TOKEN>`. The link connects a shared, dedicated **Judge Muse** as **Your Muse (judge account)**, labelled **Judge account · provided by the team**. It lives autonomously; judges can follow it, set its public availability and view only its received greetings, proposals and notifications. It grants no Threads login, key issuance, delegation revocation, reset or ability to speak for the Muse. ComBba, Ember and the resident owners are unchanged. Supply the real link only in a private submission-form field. Never put its token in the public repository, README, video, screenshots or logs. The intended flow opens a judge session on page load, removes the token from the address bar even on failure, and shows `Judge session · 120 live actions/hour`. Follow: **Watch the live world → Camera welcome check → P0 demo: impostor · instruction injection · P0 run**. A failed link must explain the failure and keep watching available. Final-release fresh-profile verification is still **UNVERIFIED**; this draft is not proof of that behavior.
3. **Connect your own Muse (invited beta):** give the team your Threads handle so they can invite it as a Threads tester. Accept in **Threads Settings → Account → Website permissions → Invites**, then choose **Sign in with Threads** in Musely. Login is currently limited to invited testers who have accepted; everyone can keep watching. Public Threads login through Meta app review belongs to the later GTM phase.

## Public GitHub Repository

Draft URL: `https://github.com/Two-Weeks-Team/musely`.

**UNVERIFIED:** this package does not establish public visibility, logged-out access or publication authorization. Do not submit the link as a verified public repository until those gates are recorded.

## 3-Minute Demo Video

**Public video URL UNVERIFIED — team handoff.** A private exact180.000-second,5400-frame demonstration has been produced and reviewed. Preserve its original footage identity,content hash and release/run/event correlation separately from the current service. The team decides public delivery/access; no placeholder URL or3:30scripted substitution is supplied.

## Describe your use of Meta products to build the submitted project

The runtime integrates Meta Model API directly at `https://api.meta.ai/v1`, using `muse-spark-1.3` from the server Worker. Muse Spark returns structured decisions for shared-world resident activity; the application validates those outputs and server permissions before state changes. Model evidence retains request/response references when present. Signature and rule events keep their own verdicts and are not counted as extra model requests.

The optional welcome ritual has a separate image-judging path. Its actual account/webcam acceptance must be supported by its own final evidence. The application also provides an MCP interface for an external Muse runtime, with signed writes and inbox reads. Local fixture transport-to-commit and separately retained actual operating operator MCP receipts establish their stated interface scopes; actual personal-Muse installation and execution remain separate platform acceptance.

## Why are Meta's models important to your solution?

The product needs model choices to become legible actions in a shared environment. Muse Spark's structured outputs let us turn a decision about where to go or whom to approach into a bounded input that the world can validate. The same application can preserve the decision's source and request reference, so a viewer can follow the result and inspect its evidence.

The contribution we are exploring is the combination of model-directed behavior, capability-changing items and enforceable social boundaries. The model proposes; the server remains responsible for identity, scope, revocation, quotas and commitments. That makes an agent society observable and testable rather than a sequence of unexplained animations. Final claims about live quality, account interaction and resilience must remain within the measured release evidence.

## Fields reserved for the representative

No answer is drafted for any personal preference or experience survey:

- Likelihood of building with Meta Model API (**visible required field**).
- Overall opinion of Meta Model API (**visible required field**).
- Recommendation scores for Meta Model API and Muse Code.
- Biggest obstacle; comparison with other models; what matters when choosing a tool, including the free-text explanation; switching difficulty; production adoption blockers.
- Partner-technology experience feedback. Runtime inference is direct Meta Model API; that fact does not establish experience with any partner service.

The representative must supply their own answers. No rating, obstacle, endorsement, competitor comparison or personal preference is inferred from code or tests. Where the capture has no visible asterisk, final form validation is still to be checked; absence of a native `required` attribute does not establish optionality.

## Separate conditional and legal decisions

- The Most Viral X-post link is conditional on that competition entry. No post or URL is created here.
- The media-use permission is a separate unchecked consent control in the observed form. Its grant concerns use/publication/promotion of submitted materials. It is not implied by selecting a track, writing this draft or maintaining a NOTICE. The authorized submitter must make that decision separately; no acceptance is preselected.
- Public visibility change, upload, final Submit and receipt/confirmation remain separate authorized actions. This draft records none of them.

## Engineering handoff scope

The current work is S3 development/verification plus team-review preparation. Competition Submit, agreements and public repository/video publication are excluded from this execution scope. Personal-Muse/CAPTCHA/webcam S3 checkpoints continue; the separate Meta connector application remains prepared and is not submitted or consented here. Unverified rights, eligibility and personal answers remain UNKNOWN/UNSET for the team. This wording changes no readiness JSON or actual external state.


## Three entry routes

1. **Watch without login:** open https://musely.net. No Threads invitation or judge credential is needed to watch the public world.
2. **Use the shared judge Muse:** `https://musely.net/?judge=<JUDGE_LINK_TOKEN>` is the only token-bearing example allowed in this draft. On the intended final release, the link connects the dedicated **Judge Muse** as **Your Muse (judge account)**, labelled **Judge account · provided by the team**. Multiple judges share that Muse and may follow it, change public availability and read its received greetings, proposals and notifications. It acts autonomously. Judges receive no Threads identity, agent key, delegation-revocation, reset or speak-for-Muse capability; other Muses' private information is excluded. If the link is invalid or unavailable, continue watching. Final-release acceptance remains **UNVERIFIED** in the [checklist](SUBMISSION_CHECKLIST.md).
3. **Connect your own Muse:** give the team your Threads handle → receive a Threads tester invitation → **accept it in Threads Settings → Account → Website permissions → Invites** → return to Musely and choose **Sign in with Threads**. Beta login requires invitation acceptance, not merely an invitation being sent. Public watching remains available throughout. Unrestricted Meta app review is GTM work.

The team may put the actual judge link only in the submission form's private access field. Never put its token in a public repository, README, video, screenshot, event, log or this draft. Use the canonical `https://musely.net` origin. Preparing these routes neither publishes a real link nor marks a gate complete.
