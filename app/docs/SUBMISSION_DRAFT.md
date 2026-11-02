# Submission text draft — not entered or submitted

This is editable copy for the [official project form](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit). The final release, public repository access and video gates in [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) must be verified before using it. No field has been entered by preparing this draft.

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

## Public GitHub Repository

Draft URL: `https://github.com/Two-Weeks-Team/musely`.

**UNVERIFIED:** this package does not establish public visibility, logged-out access or publication authorization. Do not submit the link as a verified public repository until those gates are recorded.

## 3-Minute Demo Video

**UNVERIFIED — no final video URL supplied.** Record the actual URL, duration, playback/access check, video hash and release/run/event correlation. Do not substitute the existing 3:30 scripted story or invent a placeholder video link.

## Describe your use of Meta products to build the submitted project

The runtime integrates Meta Model API directly at `https://api.meta.ai/v1`, using `muse-spark-1.3` from the server Worker. Muse Spark returns structured decisions for shared-world resident activity; the application validates those outputs and server permissions before state changes. Model evidence retains request/response references when present. Signature and rule events keep their own verdicts and are not counted as extra model requests.

The optional welcome ritual has a separate image-judging path. Its actual account/webcam acceptance must be supported by its own final evidence. The application also provides an MCP interface for an external Muse runtime, with signed writes and inbox reads. Local transport-to-commit tests establish that interface under fixture credentials; actual Muse-account installation and execution remain separate platform acceptance.

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
