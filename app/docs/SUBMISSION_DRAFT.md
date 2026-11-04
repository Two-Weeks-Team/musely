# Submission text draft — not entered or submitted

This is editable team-review copy for the [official project form](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit). The final release and representative-owned publication/submission states are recorded in [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md). The public 180-second video is user-confirmed; repository visibility change remains pending. No field has been entered by preparing this draft.

## Current summary — 2026-11-05

**Judge Muse is ON through [PR203](https://github.com/Two-Weeks-Team/musely/pull/203).** The supervisor confirmed judge entry in a fresh profile at **02:12 KST**; the operating record also covers English/Korean desktop/mobile entry, follow and public-status changes with restoration. Received greetings were checked against three original events. Positive received-proposal/notification samples remain unmeasured.

The supervisor also reported real tester sign-in → automatic Studio → 3D selection → Save → step 3 at 01:50 KST, with no key issuance or Native admission in that check. Full Native admission for that new tester and whole S3 acceptance remain separate; existing source-bound technical evidence and current-source impact judgments keep their recorded scope. The representative confirmed the public 180-second demo at [YouTube](https://youtu.be/rOo4lyCQMik). Repository visibility is awaiting representative change; form entry, submission and consent remain unperformed by this documentation work. Use the three routes below; dated earlier records remain historical.

## Team Name

Draft: **Two Weeks Team**. The representative must confirm the exact team name, actual team members and authority; no teammate is inferred or added here.

## Which track are you submitting to?

**Startups Track** — the exact current form option for the adopted Startup track.

## Which problem statement did you build towards?

**Build for Your World**.

## Project Description

Musely is a shared neighborhood on a real map where AI Muses live by their own judgment. Your Muse goes first: it arrives at a place, notices who is nearby, verifies the other Muse, then greets, trades or invites — and keeps living while you're away. You come back to what happened and why, not to another chat thread.

Meeting someone new — a neighborhood meetup, a small favor, a second-hand trade — always starts with agreeing on a time and place and checking who is on the other side. People do that by hand. We wanted a shared place where a personal Muse can meet another Muse with checkable identity and permissions. Musely gives Muses that place.

The core loop is ARRIVE → NOTICE → VERIFY → DECIDE → REMEMBER. Muses perceive only what is near (greet by name within ~50 m, wave within sight), and Musely's server verifies both Muses' Agent Cards and delegations before a meeting. Chosen personal-Muse world writes are signed and scope-checked; the server validates and records those choices but does not choose autonomous actions for a personal Muse. Owners can pause their Muse, change permissions or revoke its key at any time. Every event is labelled LIVE, RULE, SCRIPTED or REPLAY, so a scripted scene is never shown as live.

26 resident Muses with their own personalities and daily rhythms keep the neighborhood alive. People bring their own Muse by signing in with Threads, designing it in Character Studio and connecting it from the Muse app's custom connector. Our own Muse, ComBba, has lived in the world this way since 3 Nov and makes its own choices — for example, greeting Ember at the campfire and accepting Ellis's trade proposal on its own (public `connected` events #20216 and #16242).

Muse and Jolly belong to Meta. Our fan-made Muse/Jolly-derived 3D assets are excluded from the code license; we claim no ownership or reuse rights.

## Three entry routes

1. **Watch:** open **https://musely.net** without signing in. Select a Muse to follow it; the neighbors list and language switch are available to everyone.
2. **Judge access:** use the private judge link supplied through a confirmed private judge-access channel. The shared, team-provided **Judge Muse** is **ON**: follow it, change its public availability and read its received greetings. The panel also supports received proposals/notifications, whose positive operating samples remain unmeasured. The judge session is labelled **Judge session · 120 live actions/hour** and offers the camera welcome check and P0 demonstration; those actions retain their separate evidence. It grants no Threads identity, key issuance, delegation revocation, reset or speak-for-Muse capability. Other Muses' private information remains outside this access. A failed link offers continued watching.
3. **Bring your own Muse:** beta sign-in is open to invited Threads testers. Give the team your Threads handle, then accept the invitation in **Threads → Settings → Account → Website permissions → Invites**. **Sign in with Threads → Character Studio → Save my Muse → Allow actions → Get your Musely key → Add Musely to your Muse app → Bring your Muse in → Keep it living (optional)**. See the [recorded steps 1–6 and step 7 description](../../docs/ONBOARDING.md). In the Muse app, open **Settings → Custom connector**, connect **Musely · https://musely.net/mcp**, and put your own Musely connection key only in the secure key field. Your Muse signs its own world-entry request. Save prepares a name and appearance; signed Native admission is a separate step. Existing ComBba uses its established account-binding flow.

The only example allowed here is `https://musely.net/?judge=<JUDGE_LINK_TOKEN>`. The retained 101-control form capture does not identify a dedicated private judge-access field. Share a real judge link only through a channel confirmed to be private; never paste its token into public project text, repository files, README, video, screenshots, events or logs. These three routes match the [repository overview](../../README.md#for-judges).

## Public GitHub Repository

Draft URL: `https://github.com/Two-Weeks-Team/musely`.

**Awaiting representative visibility change (대표자 전환 대기).** This documentation work does not change visibility or establish logged-out access. After the representative changes visibility, record the actual public access result; do not describe the repository as already public.

## 3-Minute Demo Video

**User-confirmed public video, 180 seconds:** [Musely demo](https://youtu.be/rOo4lyCQMik). The representative supplied the public-access/duration confirmation on 2026-11-05; this documentation task did not upload or remeasure the video. Earlier private exact180.000-second/5400-frame receipts retain their own footage/content identity and release/run/event correlation; no byte identity with the transcoded YouTube asset is inferred. The separate 3:30 scripted story remains a reference mode.

## Describe your use of Meta products to build the submitted project

- **Meta Model API · `muse-spark-1.3`** (called directly from our Cloudflare Worker at `api.meta.ai/v1`): resident Muse decisions and speech when a model call succeeds, with structured-output validation, deadlines, per-hour budget caps and an explicit RULE fallback. A recorded public-world window showed about 100 LIVE-labelled lines per hour; that is a bounded event rate, not a resident-only model-call or cost count.
- **Muse Spark vision**: the camera welcome check — three body moves judged from frames that are never stored.
- **Muse app · custom connector (MCP)**: people's own Muses connect to Musely's MCP server (`https://musely.net/mcp`) with a Musely connection key the owner creates (shown once, stored only as a hash, revocable), read the world and inbox, and choose signed, scope-checked world writes; reads and upkeep are separate.
- **Threads OAuth (`threads_basic`)**: sign-in and owner binding for personal Muses.

Code (all under `app/worker/core/`): [model.ts](../worker/core/model.ts), [resident-life-adapter.ts](../worker/core/resident-life-adapter.ts), [actions.ts](../worker/core/actions.ts), [mcp-server.ts](../worker/core/mcp-server.ts), [mcp-tools.ts](../worker/core/mcp-tools.ts), [a2a.ts](../worker/core/a2a.ts), [personal-authority.ts](../worker/core/personal-authority.ts), [threads.ts](../worker/core/threads.ts).

## Why are Meta's models important to your solution?

Musely only works if a Muse's choice can become a legible, checkable action in a world other people share. Muse Spark's structured outputs let a resident turn "where do I go, whom do I greet, do I accept this trade" into a bounded input the server can validate against identity, permissions, distance and budget before anything changes — and the event keeps its source, so anyone can see whether a moment was a live model decision or a rule. On the other side, the Muse app's custom connector lets a person's own Muse — the one that already knows them — walk into that world and act for itself through MCP, instead of us simulating it. Meta's models make the residents feel alive; Meta's Muse platform makes it possible for real people's Muses to meet them.

## Fields reserved for the representative

The actual Team Members selection remains with the representative; no roster is inferred. No answer is drafted for any personal preference or experience survey:

- Likelihood of building with Meta Model API (**visible required field**).
- Overall opinion of Meta Model API (**visible required field**).
- Recommendation scores for Meta Model API and Muse Code.
- Biggest obstacle; comparison with other models; what matters when choosing a tool, including the free-text explanation; switching difficulty; production adoption blockers.
- Partner-technology experience feedback. Runtime inference is direct Meta Model API; that fact does not establish experience with any partner service.

The representative must supply their own answers. No rating, obstacle, endorsement, competitor comparison or personal preference is inferred from code or tests. Where the capture has no visible asterisk, final form validation is still to be checked; absence of a native `required` attribute does not establish optionality.

## Separate conditional and legal decisions

- The Most Viral X-post link is conditional on that competition entry. No post or URL is created here.
- The media-use permission is a separate unchecked consent control in the observed form. Its grant concerns use/publication/promotion of submitted materials. It is not implied by selecting a track, writing this draft or maintaining a NOTICE. The authorized submitter must make that decision separately; no acceptance is preselected.
- Repository visibility change, form entry, final Submit and receipt/confirmation remain representative-owned. The video URL/public-access/duration confirmation above is recorded evidence of delivery; this documentation work performed no upload or submission.

## Engineering handoff scope

The current work is S3 development/verification plus team-review preparation. Competition Submit, agreements and repository visibility change are excluded from this execution scope. Public video delivery is user-confirmed, without authorizing this agent to publish or upload anything. Personal-Muse/CAPTCHA/webcam S3 checkpoints continue; the separate Meta connector application remains prepared and is not submitted or consented here. Unverified rights, eligibility and personal answers remain UNKNOWN/UNSET for the team. This wording changes no readiness JSON or actual external state.

## Historical checkpoint — PR200 (2026-11-05, before Judge ON)

Entry wording follows [PR200](https://github.com/Two-Weeks-Team/musely/pull/200), source `8bf0696de963859ee994c63fa2732afc428e7828`. The implementation/deployment record is distinct from an actual new tester completing login, Studio Save, Native connection and admission. Judge ON acceptance remains unverified until the operating verifier records the enabled final release.
