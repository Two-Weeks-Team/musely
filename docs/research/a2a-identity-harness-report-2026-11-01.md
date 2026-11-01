# Meta Global AI Developer Hackathon — Winning with A2A Identity + Harness/Class Onboarding + Location-Based Agent Communication

> **상태: 참고 자료로 유효.** 평가 기준, A2A 신원 현황, 하네스/클래스 조사는 그대로 참고한다. 6.4의 시나리오는 제안이며 채택된 방향이 아니다. 현재 방향은 [`docs/README.md`](../README.md)를 본다.

**Research date:** 1 Nov 2026 (KST). All web sources read 29 Oct 2026 via web index / live page fetch; flags below say `verified live` (official page fetched directly) or `index` (search-index / secondary summary). **Verified facts and inference are labelled separately throughout.** Where sources disagreed, both readings are shown.

---

## Summary — read this first

1. **This is not, on its official page, a "Llama hackathon" any more.** The 2026 Global event is built around **Meta Model API: Muse Spark series / Muse Wonder, Muse Image and SAM 3.1, plus Meta open-weights models and Muse Code** [verified live, Cerebral Valley]. A pitch framed as "we used Llama" will miss the scored criterion. The scored rubric (from the Official Rules/waiver as summarised by two independent secondary sources) is: **Impact 30% · Use of Meta AI Tooling 25% · Demo (working demo + demo video) 25% · Technical Depth & Execution 20%.**
2. **Submission: Nov 4, 21:00 ET = Nov 5, 02:00 UTC = Nov 5, 11:00 KST** (ET is EST, UTC−5, after the Nov 1 clock change). Finals live on **Nov 9**. No named judge list and **no published demo-video length or public-repo requirement were found** — see §1.6, treat the Cerebral Valley submission portal as authoritative.
3. **Past Meta/Cerebral Valley winners are almost never pure infrastructure.** They are a *visible, physical or human moment* — $20 smart glasses seeing a fruit bowl, an NHS triage agent speaking a patient's language, a robotic arm moved by brain/voice signals, a CCTV operator who defines events in plain English — built on sponsor tech in a way you can *see* in 60 seconds. Pure agent-infra winners are the exception (Team AAA's model-internals work), and they won on deep technical novelty, not on plumbing.
4. **Each leg of the team's combined concept is, alone, crowded or commoditised in Oct 2026:** signed A2A Agent Cards are in A2A v1.0; agent identity is GA at Microsoft, Okta/Auth0, Google and AWS; ERC-8004 + NANDA + Skyfire/Human Passport cover registries, reputation and passports; `SKILL.md` harness/persona packaging is now an open standard adopted by Anthropic/OpenAI/Google/Microsoft, and Custom GPTs/Gems are literally being migrated into Skills. **"We made an agent ID card / a character-class picker / a skills pack" is not novel in 2026.**
5. **The defensible novelty is the *intersection, performed live*:** two *stranger* agents meeting **in a physical place**, verifying a signed identity + a **place-and-time-scoped, scope-narrowed delegation credential**, negotiating with different harness "classes," completing a real task, and **earning a portable reputation stamp** — with the place itself verified multimodally (SAM 3.1 / Muse vision) rather than by spoofable GPS. No source found ships that combination for personal agents. That is a *demo story*, not a protocol claim — pitch it that way.
6. **Top risk is the classic one: 55% of the score (Impact + Demo) punishes infrastructure.** Mitigation used by past winners: one named human, one painful 30-second problem, one irreversible-looking real-world outcome in the first minute, infrastructure revealed *after* the outcome as "how we made it trustworthy."

---

## Findings

### 1. This Hackathon

#### 1.1 Identity, format, timeline — verified live

Official page: **Meta Global AI Developer Hackathon – Cerebral Valley** — https://cerebralvalley.ai/e/meta-ai-developer-hackathon [verified live, fetched 2026-10-29]

- *"Ten days, access to our newest models and $1M in prizes. The Meta Global AI Developer Hackathon is virtual, worldwide and free to enter if selected."*
- *"Use the Muse Spark series, Muse Wonder, Muse Image and SAM 3.1 through Meta Model API, run Meta open weights models, and code faster with Muse Code coding agent."*
- Partners: Baseten $100 credits + 2M TPM for select participants; Modal $100; Fireworks $100 (official page wording) for open-weights models. *Note: one secondary source lists Fireworks at $25 — discrepancy flagged; official page says $100.*
- Cap: **maximum 20,000 accepted applicants**, rolling review, portal may close early at cap.
- Key dates (official page, ET):

| Date | Milestone |
|---|---|
| Oct 13, 09:00 ET | Applications open, rolling review |
| Oct 25, 23:59 ET | Application deadline (or earlier if cap fills) |
| Oct 26, 09:00 ET | Approval notifications sent by this time |
| Oct 26 | Hackathon begins, kickoff livestream |
| Oct 27 – Nov 4 | Live workshops (Meta + partners), Discord office hours |
| **Nov 4, 21:00 ET** | **Project submissions due** (= Nov 5 02:00 UTC = **Nov 5 11:00 KST**) |
| Nov 4–8 | Judging |
| **Nov 9** | **Closing ceremony — live finals, winners announced** |

*Dates "may be subject to change at Meta's sole discretion" (official page). The mission brief said "Oct 27–Nov 4" — the build window officially starts Oct 26 with kickoff; workshops run Oct 27–Nov 4. Minor variance in secondary listings (e.g. Internshala lists finals Nov 10 in IST) is timezone conversion, not a different date.*

- Eligibility (official page): open worldwide except where law prohibits; excluded: sanctions targets and anyone organised/located in **Belarus, China, Russia, Ukraine, Syria**, and comprehensively sanctioned regions (**Crimea, Donetsk, Luhansk, Cuba, North Korea, Iran**); Meta/Cerebral Valley employees, contractors, interns, government-affiliated individuals and their immediate families/households are ineligible.
- Application review (official page): two criteria, **weighted equally (50/50)** — (1) project idea: clarity, feasibility, fit to a theme; (2) technical skill shown in an AI project you describe. GitHub/LinkedIn/shipped product links "help us verify" but are not required.

#### 1.2 Tracks and themes — verified live

Every project enters **one** track (official page):

| Track | Who | Official judging lens (unweighted, official page) |
|---|---|---|
| **Indie Developer** — $400K pot | Individual builders and students (secondary rules summary: solo or teams **up to 4**) | *"Creativity, technical ambition, and whether it works"* |
| **Startup** — $550K pot | Teams/founders building a real product | *"Technical execution and whether it holds up in production"* |

Themes (both tracks, official page, verbatim in substance):
- **Build for Your World** — *"Bring Meta's models into your domain. Solve a problem you know firsthand, free up time and mental space, and make something possible that wasn't before."*
- **Push the Frontier** — tackle challenges in *"software, robotics, manufacturing, energy, materials and beyond. Give a machine a new capability, accelerate a scientific experiment, or unlock a better way to understand and control a physical system."*

**Strategic read [inference]:** the combined A2A/location concept fits *both* themes, but must pick a framing. "Build for Your World" rewards a firsthand, named problem (stronger for Impact 30%); "Push the Frontier" rewards a new capability (stronger for Technical Depth 20%). Most winning framings in §2 do the first and *demonstrate* the second. Do not pitch it as neutral infrastructure for its own sake — neither theme says "build protocols."

#### 1.3 Prize split — from Official Rules/waiver, via secondary sources [index]

The official public page states only "$1,000,000 in total prizes." The detailed split is reported identically by two secondary sources summarising the Official Rules published Oct 25:

- Reconscribe (detailed rules/waiver digest): https://reconscribe.com/meta-global-ai-developer-hackathon-2026/ [index]
- MadRobot: https://madrobot.blog/2026/10/03/meta-global-ai-developer-hackathon-1-million-prizes-muse-model-api/ [index]

| Place | Startup ($550K total) | Indie ($400K total) |
|---|---|---|
| 1st | **$250,000** | **$150,000** |
| 2nd | $150,000 | $100,000 |
| 3rd | $75,000 | $75,000 |
| 4th | $50,000 | $50,000 |
| 5th | $25,000 | $25,000 |

Plus **bonus prizes up to $50,000 total** — "standout projects or community achievements, e.g. a community vote award or a most viral project award," announced on/about Nov 10 (Reconscribe). Plus **$150 in Meta Model API credits per selected participant** (not part of the $1M). Winners pay own taxes/wire fees; organisers take a royalty-free, perpetual licence to use/publish submissions and winners' names/likenesses (MadRobot summary of rules) — flag for a startup-track team that cares about IP/confidentiality: *nothing submitted is treated as confidential.*

#### 1.4 Judging criteria and weights for finished projects — [index, corroborated ×2]

Both Reconscribe and MadRobot report the same four weighted criteria from the waiver/Official Rules:

| Criterion | Weight | What it rewards (per Reconscribe digest) |
|---|---|---|
| **Impact** | **30%** | Real-world potential: who benefits, how much it matters, whether it could become something people use, fit to a theme/problem statement |
| **Use of Meta AI Tooling** | **25%** | Creative use *beyond a basic integration*; surfacing capabilities "people did not expect" |
| **Demo** | **25%** | A working, impressive demo; whether the product *holds up live*; **quality of the demo video** |
| **Technical Depth & Execution** | **20%** | Sound, thoughtfully refined engineering; real craft |

**No named judges were found.** MadRobot, summarising the rules: *"A panel of judges picked by the organisers chooses the finalists, but the rules don't name them."* No judge list was found on the official page or in any search on 2026-10-29. Do not plan to "pitch to a known judge's taste" — pitch to the rubric.

**What this means arithmetically [inference]:** a technically perfect identity protocol with a slide demo caps out around Technical Depth (20%) + part of Tooling (25%). Impact + Demo = **55%** requires a human problem, a live working interaction, and a good video. Conversely, a charming location demo that only calls Muse Spark as a generic chatbot loses Tooling points: the Meta tech must be *load-bearing and surprising* — e.g. Muse Spark doing the cross-agent negotiation/reasoning, **SAM 3.1 segmenting the physical place/object to prove presence**, **Muse Image generating the agent ID-card avatar/portrait**, Muse Voice Transcribe for spoken negotiation (pricing/docs list `muse-voice-transcribe-1.0` — see §1.5).

#### 1.5 Required / centred tech — verified live + Meta docs [index]

- Centred stack (official page): **Muse Spark series, Muse Wonder, Muse Image, SAM 3.1 via Meta Model API; Meta open-weights models; Muse Code.**
- Meta Model API (Meta developer page, via search index): https://developer.meta.com/ai/products/meta-model-api/ — drop-in compatible with OpenAI/Anthropic SDKs at `https://api.meta.ai/v1`; models include `muse-spark-1.3`, `muse-image-1.0`, `muse-voice-transcribe-1.0`, `sam-3.1`. Standard Muse Spark pricing listed at $1.25 / $4.25 per 1M input/output tokens; Muse Image $0.01/image; SAM 3.1 $2.50/1K images, $0.20/1K video frames. [index — verify in your own developer console before relying on prices.]
- **Correction to a common assumption in the mission brief:** "Llama models" are not named as the centrepiece of the 2026 event page. Open-weights models are named generically. If the team builds on Llama only and treats Muse/SAM as an afterthought, it directly risks the 25% Tooling criterion. Build *on Muse Spark as the agent brain, SAM 3.1 as the eyes, Muse Image as the identity-card face* — then Llama/open-weights can be a secondary local/edge component if wanted.
- Geographic caveat (Reconscribe, citing Meta's Model API Geographic Use Policy): Model API is blocked entirely in some countries the hackathon itself allows (it names Pakistan, Ethiopia, Venezuela, Iraq, Cambodia) and Muse Image is restricted in one more (it names India in a later section). Korea is not named as blocked in the sources read — but each teammate should confirm API access from their actual location *before* submission day, not during it.

#### 1.6 Submission requirements — what is, and is not, verifiable

Established [index, Reconscribe rules digest]:
- Submit through the **Cerebral Valley portal by Nov 4, 21:00 ET**; one track only; Indie: one designated member submits and lists all team members; Startup: one designated contact for notices/prize payment.
- Project must be built with Meta AI products; original work you own; open-source components allowed if licences are followed and the submission builds on them; third-party technical help allowed if components remain your own work.
- **A working demo and a demo video are required in substance** — the Demo criterion scores both the live-working demo and "the quality of the demo video."

**Not stated in any source found (as of the Oct 17 rules digest, and not added in the Oct 25 rules summaries read):**
- **Demo video length — NOT published in the sources found.** Do not assume 2 or 3 minutes from other hackathons. Plan a tight ~3-minute video (the synthesis in §6 is built for 3 minutes) *and check the portal's submission form fields as soon as you can access them* — the form, not blog posts, governs.
- **Public GitHub repo requirement — NOT stated** in the sources found. Past Meta hackathons linked GitHub for winners (see §2), and a clean repo helps Technical Depth, but it was not verified as a hard requirement for 2026.
- Written description format / language — not stated in sources found.

### 2. Past Winners Pattern Analysis

#### 2.1 Meta / Cerebral Valley series — primary Meta sources

**(a) First Meta Llama 3 Hackathon — San Francisco, May 2024, Cerebral Valley, Shack15**
Source: Meta AI blog recap [verified via index/open] — https://ai.meta.com/blog/llama-3-hackathon-recap-cerebral-valley/
354 attendees (1,200+ applications), 51 projects in 24 hours.

| Place | Project | One-line pitch | Why it likely won [inference, grounded in the recap's framing] |
|---|---|---|---|
| 1st | **OpenGlass** | $20 open-source smart glasses that answer questions about what you're seeing (e.g. identify a fruit bowl, give calorie counts) | Physical wow in 5 seconds; absurd price contrast ($20 vs commercial glasses); sponsor model *seen* working on the real world; open-source, immediately legible |
| 2nd | **Deb8** | AI-agent debate arena: models debate Lincoln-Douglas style, a third agent judges/scores them | Multi-agent *as spectacle*; agents interacting with agents is the demo, not a diagram; inherently watchable |
| 3rd | **Team AAA — Activation Ablation Augmentation** | Found activation layers in Llama 3 responsible for refusal behaviour and neutralised them | Deep model-internals novelty; only a team that truly understood the sponsor model could do it — Technical Depth archetype |

Notable non-winners worth stealing from: **Feycher** (create lifelike AI chatbots with customisable appearances, personalities and *skills* — direct ancestor of the team's harness/class idea, and it did *not* win in 2024), **Joe CRM** (agent gathers signals, researches, autonomously runs outreach), **Hound** (RAG vs human-trafficking routes), **SixthSense** (Ray-Ban Meta glasses + physical highlighter → digital bookmarks).

**(b) LlamaCon Hackathon — San Francisco, 2025**
Source: Meta AI blog [verified] — https://ai.meta.com/blog/llamacon-hackathon/
238 developers from 600+ registrants, 44 projects, $35K prizes, judged in two rounds to a top 6. Tools: Llama API, Llama 4 Scout/Maverick.

| Place | Project | Pitch | Pattern |
|---|---|---|---|
| 1st | **OrgLens** | Expert-matching inside a company: knowledge graph from Jira/GitHub/docs/resumes, search for the right expert, *talk to their digital twin before bothering them* | "Find the right agent/person" won when it was about *people you actually need*, with a twin you could interrogate live on stage |
| 2nd | **Compliance Wizards** | Transaction fraud analyser: custom risk score → alert → user reports/acknowledges via an **AI voice assistant**; multimodal upload + news search for assessors | Voice + multimodal + a feared, concrete event (fraud) |
| 3rd | **Llama CCTV Operator** | Define surveillance events *in plain language*, no fine-tuning; Llama 4 multimodal checks every 5 frames and reports | "No training, just describe it" — the model doing a *new physical-world job* |
| Best Llama API | **Geo-ML** | 400-page geology reports → domain-specific language → **3D geological models** of dig sites/minerals | A domain insider's (geologist William Davis) painful document problem, turned into a *visual artefact*; textbook "Build for Your World" |

**(c) Llama Impact Hackathon — London, Nov 2024 (Llama 3.2, public services)**
Source: Meta newsroom [verified] — https://about.fb.com/news/2024/11/metas-llama-impact-hackathon-pioneering-ai-solutions-for-public-good/
200+ developers, 56 teams; top 3 shared $50K + 6 weeks' mentorship.

| Place | Project | Pitch |
|---|---|---|
| 1st | **Guardian — Atlas** | Clinical AI agent for NHS A&E: intelligent patient intake, real-time risk assessment/triage, **multilingual** communication, "second pair of eyes" for frontline staff |
| 2nd | **Gripmind** | Robotic arm for assisted living controlled by **brain signals, voice or images** via Llama 3.2 Vision — make assistive robotics cheaper/scalable |
| 3rd | **Pharmallama** | On-device pharmacist app: side-effect questions, medication needs, centralised records spotting conflicting medications, for patients who can't reach a pharmacy |

Finalists also included ClimaticAI ("heat the person, not the home"), WinAmp (sustainable-eating companion), The GoodPath (career roadmaps in underserved dialects).

**(d) Llama Impact Hackathon — Austin (ATX)**
Source (names only): AITX recap — https://aitx.beehiiv.com/p/meta-hackathon-recap-plus-things-to-come [index]
**1st Simplifill · 2nd ParentIQ · 3rd GuardianAI.** The source read does **not** describe their pitches; this report does not invent them. Even the names signal the pattern: a painful form/paperwork job, a parent problem, a guardian/safety problem — verbs and beneficiaries, not protocols.

**(e) Llama Impact Hackathon — Pan-LATAM (lablab.ai / Meta)**
Source: https://lablab.ai/ai-articles/llama-impact-pan-latam-hack-summary [index]
1st **Tachiwin** — translator preserving Mexico's indigenous languages (e.g. Tutunakú) with a custom Llama 3.1 model ($3,000); 2nd **MatIA** — *offline-capable* personalised math tutor, fine-tuned Llama 3.2 3B ($1,500); 3rd **GreenField Verdant** — farmers optimise land/crop risk with NASA data ($500).

**(f) Adjacent signal — Llama Impact Grants (not a hackathon, same sponsor taste)**
Digital Green **Farmer Chat** ($500K) — multilingual farmer advisory chatbot fine-tuned for regional contexts; Jacaranda Health **PROMPTS** ($300K) — SMS nudges + AI clinical helpdesk for new/expecting mothers in Kenya/Ghana/Eswatini. Source: https://businesspost.ng/technology/entries-open-for-llama-impact-grants-as-maiden-winners-get-nearly-1m/ [index]. Pattern: a *named underserved user, in their language, on a channel they already use (WhatsApp/SMS).*

#### 2.2 Other major agent hackathons, 2025–2026

- **Google Cloud / ODSC Agentic AI Hackathon (Dec 2025) — 1st: SurgAgent.** Agentic system tracking surgical instruments in laparoscopic video with Gemini; the team's own winning-strategy note is quotable and generalisable: the time constraint *"forced us to be laser-focused on what truly matters: demonstrating real value, not just technical complexity,"* and they validated early — *"98% accuracy on real surgical video within the first few hours."* Source: https://opendatascience.com/highlighting-the-winners-of-the-december-2025-google-cloud-ai-hackathon/ [index]
- **Gemini Live Agent Challenge — Grand Prize: ORION**, a *voice-directed* surgical co-pilot ("speak naturally, never break scrub"); category winners included **drone-copilot** (talk to a drone instead of a joystick; it verbally confirms), **Sankofa** (multimodal family-history storyteller with voice, watercolour imagery, soundscape, live conversation), **Moonwalk** (hands-free voice desktop navigator that remembers preferences). Source (secondary mirror of Google announcement): https://gixtools.net/2026/05/gemini-live-agent-challenge-announcing-the-winners-and-highlights/ [index — treat as secondary]. Pattern: **every winner is voice/multimodal and embodied** — nobody won with a text dashboard.
- **Anthropic Claude Code Hackathon (Feb 2026) pattern** — Anthropic's own recap, as summarised: winners were *domain insiders with no/low prior engineering background* — a California personal-injury attorney built **CrossBeam** (ADU permit compliance: >90% first submissions were being sent back, months of delay → 20-minute automated assessment), a Polish interventional cardiologist built **Postvisit.ai** (cryptic exam reports → plain-language recovery guides) between hospital shifts; other winners used spec-first, parallel multi-agent build loops. Source: https://promptwire.ai/wire/anthropics-hackathon-recap-shows-where-claude-code-is-actually-landing [index, summarising Anthropic's curated recap — selection bias acknowledged in the source itself]. Pattern for this team: **"Build for Your World" is not a slogan; recent juries literally rewarded the person who *lived* the problem.**

#### 2.3 Common patterns across winners — synthesis [inference from §2.1–2.2]

1. **A human moment in the first 30 seconds, not an architecture diagram.** Glasses seeing fruit; a patient speaking their own language; a surgeon keeping scrub. Infrastructure winners are vanishingly rare.
2. **Sponsor tech is *visible and load-bearing*.** Multimodality (vision/voice) is the recurring wow lever — CCTV Operator, Compliance Wizards, Gripmind, ORION, drone-copilot. Text-only chat demos do not appear among the winners above.
3. **Multi-agent works when it's *theatre*:** Deb8's debating agents with an agent judge; OrgLens's interrogatable digital twin. Multi-agent as a backend optimisation, invisible to judges, earns nothing.
4. **Real data / real users / real stakes, early-validated.** SurgAgent's 98% on *real* surgical video in hour one; Farmer Chat/PROMPTS serving real populations on WhatsApp/SMS; CrossBeam's quantified pain (90% rejection, months → 20 minutes).
5. **Domain insider credibility.** Geologist, cardiologist, attorney, NHS-adjacent teams. Judges believe the problem because the builder lives it.
6. **A contrast number.** $20 glasses; 400 pages → one 3D model; months → 20 minutes. One memorable number per pitch.
7. **Live demo over slides, and a demo that survives live scrutiny** — explicitly scored in 2026 (Demo 25%, "holds up live"). Winners built *demonstrable projects in 24 hours* (LlamaCon's own wording) rather than roadmaps.
8. **Open / portable artefacts.** OpenGlass was open-source with a waitlist of ~1,500 (Gizmodo coverage, via search index: https://gizmodo.com/cerebral-valley-hackers-build-20-open-source-smart-gla-1851476656). Portability and "anyone can run this" read as impact.

### 3. A2A Auth & Agent Identity Landscape — state of the art, Oct 2026

#### 3.1 A2A protocol — what the spec actually gives you [verified, official spec]

Official spec: https://a2a-protocol.org/latest/specification/ and https://a2a-protocol.org/latest/topics/what-is-a2a/ [index, official domain]

- **Origin/governance:** introduced by Google April 2025 with 50+ partners; donated to the **Linux Foundation** June 2025; **v1.0 stable in spring 2026** (sources vary between March 12 and April 9, 2026 for the exact v1.0 date — flag, do not cite a single day). Reported by April 2026: 150+ supporting organisations, SDKs in Python/JS/Java/Go/.NET, support in Azure AI Foundry, Amazon Bedrock AgentCore, Google ADK.
- **Agent Card** (`/.well-known/agent-card.json`): a self-describing manifest — `name, description, supportedInterfaces, provider, version, documentationUrl, capabilities, securitySchemes, securityRequirements, defaultInputModes, defaultOutputModes, skills[]`, and **`signatures[]`** (official field list, spec §4.4.1).
- **Authentication in spec:** discovery → client parses the card's `securitySchemes` (API key, HTTP auth, **OAuth 2.0, OpenID Connect, mutual TLS**) → obtains a token *out-of-band* (credentials must **not** be published in the card) → calls `SendMessage` / `SendStreamingMessage` with the credential. Tasks are first-class, stateful: *submitted → working → input-required → **auth-required** → completed/failed/canceled/rejected*, with streaming (SSE) and push notifications.
- **Signing in v1.0:** the card's `signatures` are **JWS (RFC 7515)** computed over the card canonicalised with **JCS (RFC 8785)** (excluding the signatures field), keys retrieved via `jku` or trusted keystores. Source: https://a2a-protocol.org/latest/whats-new-v1/ [index, official]. v1.0 also removed legacy OAuth implicit/password flows and added PKCE/Device Code and multi-tenancy (per secondary analysis: https://hackernoon.com/the-identity-layer-for-ai-agents-is-finally-being-built).
- **MCP vs A2A (official v1.0 note, verbatim in substance):** *"MCP handles tool/resource integration, A2A handles agent-to-agent coordination. Protocols are complementary, not competing. Agents may support both."* MCP = vertical (agent ↔ tools/data, Anthropic, Nov 2024, OAuth 2.1 resource-server model); A2A = horizontal (agent ↔ agent delegation).

#### 3.2 What A2A does *not* solve — the credible gap [verified analysis]

Two independent deep analyses agree, and this is the most important technical fact for the team's novelty claim:

- *"The A2A specification supplies the evidence; it does not supply a policy… What the specification does not tell you is which signing keys to accept, which registries to believe, which callers may invoke which skills… Those decisions are your trust model."* — https://www.aicassindra.com/blogs/a2a/a2a_trust_models.html [index]
- *"A2A signs exactly one thing: the Agent Card… Messages and tasks are not signed by the protocol; their integrity comes from TLS and their authenticity from the credentials on each request. If you need non-repudiation… add it yourself."* Authorization is *"implementation-specific, based on skills, actions and scopes."* — https://www.aicassindra.com/blogs/a2a/a2a_protocol.html [index]
- *"The signature proves who published the card. It says nothing about what a specific running instance of that agent is doing right now, or under whose delegated authority. Identity per instance, portable across heterogeneous stacks, still doesn't exist in the spec."* — HackerNoon analysis [index, above].

**Translation for the pitch:** do **not** claim "we invented authenticated A2A" (v1.0 already signs cards) or "we invented agent identity" (see §3.3). **Do** claim the layer the spec explicitly leaves open: *a human-legible trust policy + per-instance, per-place, per-task scoped delegation + a reputation record earned from completed interactions* — presented as one card a human can read in 5 seconds.

#### 3.3 Who has already built agent identity — the crowded field

| Player / standard | What it is | Status in sources (Oct 2026) |
|---|---|---|
| **Microsoft Entra Agent ID** | Directory identity per agent from an "agent identity blueprint," optional human **sponsor** accountable for it; Conditional Access, lifecycle, shadow-agent detection; deeper governance needs Agent 365 licence | Preview May 2025 (Build); GA ~Apr–May 2026 [index: https://www.usecarly.com/blog/agent-identity/ ; https://www.agenticfabriq.com/blog/identity-providers-ai-agent-management] |
| **Okta for AI Agents / Agent SSO** | Agents registered in Universal Directory "alongside human employees," short-lived tokens instead of stored credentials, Cross App Access | GA May 2026 (governance) / Aug 24, 2026 (Agent SSO) per secondary comparisons [index, same sources] |
| **Auth0 for AI Agents** | User auth, **Token Vault** for third-party OAuth tokens, **async human approval**, fine-grained authorization for RAG. Note: *not* a first-class directory agent object (per AgenticFabriq) | GA Nov 19, 2025 [index] |
| **Google Cloud Agent Identity** | Per-agent **SPIFFE** cryptographic identity, tokens bound to X.509 cert, cannot be impersonated like a service account | APIs GA Aug 2026 per secondary [index] |
| **AWS Bedrock AgentCore Identity** | Workload identity per agent, token vault, inbound JWT authorizers | GA Oct 13, 2025 [index] |
| **ERC-8004 "Trustless Agents"** (Ethereum, Draft) | Three registries: **Identity** (ERC-721 agentId → agentURI registration file listing A2A/MCP/DID/ENS endpoints), **Reputation** (signed feedback, aggregatable), **Validation** (independent checks: stake re-execution, zkML, TEE — "security proportional to value at risk"). Authors: MetaMask, Ethereum Foundation, Google, Coinbase engineers | Proposed Aug 13, 2025; mainnet Jan 29, 2026 per secondary; 10,000+ testnet registrations claimed [index: https://www.concordium.com/article/erc-8004-explained-what-it-solves-and-the-gap-it-leaves ; https://peerlist.io/ayaaneth/articles/what-is-erc8004] |
| **Project NANDA** (MIT Media Lab) | "Internet of AI Agents": decentralised registry like **DNS/ICANN for agents**, certification + certifiers-of-certifiers, continuous attestation, portable reputation; Nanda Index, NandaTown sandbox; builds *on* MCP + A2A | Publicly launched May 14, 2025 [index: https://www.media.mit.edu/projects/mit-nanda/overview/] |
| **Skyfire** | **KYA (Know Your Agent)** + KYAPay: verified agent identity + payment credentials, **"Agent Passports" carrying reputation/spending history** across sites; partnerships with Visa/F5/Fastly reported | Seed $8.5–9.5M (sources differ) 2024 [index: https://www.cbinsights.com/research/14-repeat-founders-building-agentic-commerce/] |
| **Nevermined** | Commerce/metering layer: verify, accept, settle agent purchases on existing rails; reportedly the only major player natively supporting **x402 + A2A + AP2 + ERC-8004** together | [index: https://metamarkets.substack.com/p/whos-actually-building-agentic-rails] |
| **Human Passport** (ex-Gitcoin Passport; Holonym acquired Dec 2024) | Privacy-preserving proof-of-personhood: collect **Stamps** → Unique Humanity Score, ZK credentials; now explicitly working on **delegated identity for agents** — a human delegates verified identity to their agent so it can prove it's backed by a real unique human *without leaking personal data* | 2M+ users, 34.5M ZK credentials claimed [index: https://human.tech/blog/human-passport-proof-of-personhood-and-sybil-resistance-for-web3 ; https://giveth.io/project/passport-xyz] |
| **DID / VC stack** (W3C) | DID (e.g. `did:web`, `did:key`) resolves to a DID Document with public keys + service endpoints (incl. MCP/A2A endpoints); capabilities and *scope-narrowing delegation* expressed as **Verifiable Credentials** — agent B's delegated scope must be a subset of A's, chain verifiable to the human/org root, with expiry (e.g. "$200, one week, one merchant" inside the grant). SPIFFE/SPIRE is the enterprise workload-identity parallel | DID Core v1.1 Candidate Recommendation Mar 5, 2026 per KYA analysis [index: https://identigate.com/blog/posts/2026-06-26-what-is-know-your-agent-kya-and-why-should-you-care/] |

Smaller/open efforts also exist (e.g. `agentdid` — Ed25519 + `did:key` + VC JWT in 3 CLI commands, progressive trust levels L0–L3; BOTCHA attesting A2A cards; AgentField's DID-per-agent orchestration) — the point for the team: **issuing an ID is a weekend commodity; everybody has one.**

#### 3.4 Built vs open gap — what a 4-day team can credibly claim

**Already built (do not claim):** signed Agent Cards; OAuth/OIDC/mTLS auth schemes; enterprise agent directories & token vaults; on-chain identity/reputation/validation registries; DNS-like agent registries; agent passports for *payments*; proof-of-humanity stamps; DID issuance.

**Still open (sources + inference):**
1. **Trust policy UX for ordinary humans.** Specs supply evidence, not decisions (§3.2). Nobody in the sources makes a non-technical user *feel* "this stranger agent may spend ≤$20, only here, only for 10 minutes" — and revoke it with one tap.
2. **Per-instance / per-encounter identity.** Card = publisher identity. A *session* identity bound to this device, this place, this task, expiring afterwards, is explicitly missing.
3. **Reputation from *offline/physical* encounters.** ERC-8004/Skyfire reputation is from online/commerce transactions. A stamp earned by *showing up and completing a task in a place* is not in any source found.
4. **Human-legibility.** Every system above speaks JSON/registries to developers. An RPG-style character sheet *is* an Agent Card rendered for humans — that translation layer is unclaimed (see §4).
5. **Cross-framework portability in practice.** Production A2A in 2026 is "mostly conservative, coordination within controlled environments between known partners, not a free market of agents discovering strangers" (analysis, §3 sources). *Stranger* discovery is the unsolved social problem, not the wire problem.

### 4. Agent Onboarding / Harness / Character-Class Selection

#### 4.1 "Harness" already has a precise 2026 meaning — use it correctly

Consensus definition across sources: **Agent = Model + Harness**, where the harness is *"everything around the model"* — the loop, tool dispatch, **memory/state, context management, permissions, approval gates, sandbox, verification**. Sources: https://adversa.ai/blog/what-is-an-agent-harness/ ; https://www.datacamp.com/blog/agent-harness ; https://gonimbus.ai/blog/what-is-an-agent-harness/ [index]. The term went mainstream in **Feb 2026** (Mitchell Hashimoto's "harness engineering" post; OpenAI's Codex harness report days later; LangChain: *"If you're not the model, you're the harness"*).

**Implication [inference]:** judges in Nov 2026 will hear "harness" as *runtime scaffolding*, not "persona pack." The team's concept is really a **harness *profile* / loadout**: a selectable bundle of {system prompt/personality, SKILL.md skills, MCP tools, memory seed, permission scopes}. Name it precisely — e.g. "harness loadouts" or "classes are harness profiles" — and the team sounds current instead of confused.

#### 4.2 The direct ancestors — all commoditised

| Analogue | What it packages | State in Oct 2026 |
|---|---|---|
| **Tavern / Character Card V2 → V3** (SillyTavern ecosystem) | Portable persona as **PNG with embedded JSON**: name, description, personality, scenario, first message, example dialogue, lorebook (`character_book`), tags, system prompt. V3: CharX (ZIP) multi-asset container, native lorebook embedding, multilingual, group-only greetings | **V2 is the lingua franca** — same card loads in SillyTavern/Agnai/RisuAI; huge community libraries (chub.ai etc.). Known limit: card = *static definition only*; memory/relationship state is per-frontend and does not migrate. Sources: https://www.promptquorum.com/power-local-llm/sillytavern-vs-agnai-vs-risuai-roleplay ; https://charactercardconverter.com/guides/character-card-v1-v2-v3-differences [index] |
| **Custom GPTs / GPT Store** (OpenAI) | No-code assistant: instructions + knowledge files + Actions (API tools) in a store | ~3M+ created, ~159K public (secondary); **being retired/migrated into plugins+Skills on personal accounts in Dec 2026** per secondary sources [index: https://tech-insider.org/gpt-store-vs-claude-skills-vs-gemini-gems-2026/] |
| **Claude Projects / Agent Skills** (Anthropic) | Projects = persistent context for one body of work. **Skills = a folder with `SKILL.md`** (name + description + instructions + optional scripts/resources), progressive disclosure: name/desc always loaded (~100 tokens), body only when triggered | Anthropic published Skills as an **open standard (agentskills.io) in Dec 2025**; by Sep–Oct 2026 documented support in OpenAI ChatGPT/Codex, GitHub Copilot/VS Code, Cursor, Microsoft Copilot, Gemini [index: https://bosio.digital/articles/agent-skills] |
| **Google Gems → Skills** | Saved persona/instruction preset inside Gemini | **Gems are being converted into Skills** (personal accounts Nov 2026) — Google itself is collapsing "character" into "skill pack" [index, same Skills sources] |
| **Poe bots** (Quora) | Custom bots: base model + prompt + knowledge, in a marketplace, creators earn from usage | **1M+ community bots** claimed [index] |
| **Character.AI** | Millions of user-generated characters; create with description + sample replies (+ voice, lorebook for c.ai+) | Creation is a consumer commodity [index] |
| **CrewAI / LangGraph / ADK templates** | CrewAI agents are *literally defined by role + goal + backstory* — RPG framing is native. Google's agent-starter-pack ships ADK / LangGraph / CrewAI templates (`adk_base`, `agentic_rag`, `langgraph_base_react`, `crewai_coding_crew`, `live_api`) | Templates/starter kits are table stakes for every framework [index: https://deepwiki.com/GoogleCloudPlatform/agent-starter-pack/4-agent-templates] |
| **ElizaOS** | Open-source agent OS: **character files** + modular plugins (Actions / Providers / Evaluators), memory (RAG), social connectors (X, Discord), wallets; 90–200+ plugins (claims vary by source) | Mature open ecosystem [index: https://arxiv.org/pdf/2605.29174] |
| **Virtuals Protocol** | No-code **tokenised agent launchpad**: pick a template, deploy in ~1 hour, agent gets a token via bonding curve, co-owned/traded; GAME framework, ACP commerce protocol | Agent *creation + tokenisation* is solved — and is a crypto-speculation frame a Meta jury is unlikely to reward [index, same Eliza/Virtuals sources] |

#### 4.3 Game character-creation UX — what to steal, honestly labelled [inference/design pattern]

The RPG class screen works because it compresses a complex build into: **(1) an archetype name + portrait** ("Scout," "Fixer," "Bard") that communicates playstyle in one glance; **(2) 3–5 visible stats/traits**, not 40 settings; **(3) starting equipment/skills** listed as icons; **(4) a trade-off** — every class is *bad* at something, which makes choice meaningful; **(5) instant preview** — you see/hear the character before committing; **(6) respec exists** — a wrong choice isn't permanent, so users choose fast. Classic implementations (e.g. Baldur's Gate: race → class → attributes → skills, each layer visibly changing abilities) demonstrate the layered reveal. No source found applies this *full* pattern — portrait + stats + loadout + trade-off + preview + respec — to *agent permission scopes*. That last mapping is the white space: **in games, class stats are flavour; here, the "stats" can be real, enforceable scopes** (spend cap, tools, places, expiry). A character sheet that *is* the security policy is a genuinely new translation.

#### 4.4 White space in §4

- Persona/skill packaging: **commoditised** (cards, SKILL.md, GPTs, Gems — converging on one open format).
- Marketplaces for personas: **commoditised** (GPT Store, Poe, Character.AI, Virtuals).
- **Unclaimed:** (a) a class/loadout whose stats are *cryptographic permission scopes* on an A2A Agent Card; (b) class selection as a **trust decision about a stranger's agent** ("I'll talk to a *Verified Fixer*, never an *Anonymous Trader*"); (c) **location-locked classes** — a harness that only exists/unlocks at a place (the café's own "Barista class" agent). Each is a *combination* claim, not a format claim.

### 5. Location-Based Agent Communication

#### 5.1 Prior art — what exists

**Honest headline:** no dominant product for "personal agents discovering and talking to each other because their humans are in the same place" was found. The pieces exist in separate industries:

| Piece | Prior art | Source |
|---|---|---|
| **Local discovery, no cloud** | **AirDrop / Quick Share model:** BLE advertisements for discovery (~10 m), then peer-to-peer WiFi for transfer, TLS-encrypted. Lesson included: hashed contact identifiers in BLE discovery were shown recoverable/trackable (PrivateDrop research, 2021); Apple later added "Everyone for 10 Minutes" auto-revert and, in newer OS versions, code confirmation for strangers | https://safeguard.sh/resources/blog/wireless-file-sharing-airdrop-quick-share-wi-fi-direct-privacy [index] |
| **Offline agent mesh (closest direct prior art)** | **Offline Protocol:** agents advertise/discover/invoke capabilities over **BLE + WiFi Direct mesh with no DNS and no registry**; a device with a loaded model registers an *inference capability* nearby agents can use; shared cached maps/docs/embeddings from the nearest peer; discovery responses carry peer ID, version, capabilities, hop distance. Identity: **OfflineID — Ed25519, verifiable device-to-device**, MLS-encrypted sessions | https://www.offlineprotocol.com/solutions/ai-agents [index] — *read this competitor carefully; differentiate on A2A/Meta stack, identity credentials and place semantics, not on "offline discovery" itself* |
| **Location as agent context (not agent↔agent)** | **Mapbox Location AI / MCP Server:** agents geocode, route, compute proximity/travel time and query place metadata through one MCP interface; Camino/DeepAgents tutorials do location-aware research agents | https://docs.mapbox.com/help/getting-started/location-ai/ [index] |
| **Place intelligence / precise localisation** | **Niantic Spatial:** Visual Positioning System (camera-based, cm-level, beats GPS indoors/in cities), Large Geospatial Model, scene understanding so "people and AI agents can query the world" with georeferenced answers | https://www.nianticspatial.com/campaigns/geospatial-ai-xr-devices [index] |
| **Geofencing as a trigger** | Mature in non-agent software: polygonal fences, radius + **dwell-time** thresholds to avoid notification spam, geo-matching in multi-agent logistics (e.g. Salesforce Agentforce hackathon winner Harvest Bridge geo-matched food donors/recipients and coordinated delivery in <90 min with 4 agents) | https://admin.salesforce.com/blog/2026/how-agentforce-helped-build-a-food-waste-solution-in-days-podcast [index] |
| **Place-attached content (cultural precedent)** | Pokémon GO / Ingress anchored digital creatures/items to real landmarks and trained users to accept "this digital thing lives *here*"; Snap Map/TikTok location tags anchor content to places. No agent-communication layer in the sources read — cited as *user-behaviour* precedent, not technical prior art [inference] | via §5 search sources |

#### 5.2 Privacy approaches that are proven and demo-able

- **Geohash cells, computed on-device — the cleanest pattern found in production:** Nearish (proximity meet-up app) *"never stores precise GPS coordinates… your device converts your GPS position into a geohash — a short code representing a roughly 5km area… check-in automatically expires after one hour and is permanently deleted… even if our entire database were compromised, an attacker could not reconstruct your movement history."* Source: https://www.getnearish.com/privacy.html [index]. Geohash precision is a dial: fewer characters = larger cell = more privacy, worse usefulness — **that dial is itself a great demo visual** ("watch my exact pin dissolve into a neighbourhood cell").
- **Distance bands, not coordinates:** share "within 500 m / within this geohash-6 cell" until *both* agents mutually accept, then (and only then) reveal a meeting point — mirrors the B2B pattern in sources (approximate distance band until a contact request is mutually accepted).
- **Ephemerality by default:** expiring presence (1 hour), auto-off, "Everyone-for-10-minutes"-style discovery windows — the OS vendors already trained users to expect this.
- **Location as a *claim to verify*, not a credential to trust:** GPS is trivially spoofable [general knowledge / inference]. Stronger, sponsor-native alternative: **visual place proof** — the agent segments/recognises the actual storefront/object with SAM 3.1 / Muse vision (" prove you're looking at *this* café counter / *this* lost item"), or a rotating QR/NFC posted at the venue that only a physically present agent can present. This turns the privacy/spoofing weakness into the Tooling-criterion strength.
- **What not to do:** broadcast a persistent agent ID + precise location together (that's a tracking beacon — exactly the AirDrop-harassment/tracking failure mode documented above); store a location history server-side; make stranger-meetups the default-on state.

#### 5.3 Location as a trust signal — the defensible thesis [inference]

Physical co-presence is a *costly* signal in a way online identity is not: a sybil farm can mint 10,000 DIDs, but it cannot cheaply put 10,000 bodies in a café. Combined with §3: **identity says *who*, reputation says *how they've behaved*, location says *they are really here, now, accountable in the physical world*.** That triad — and a credential that is only valid *here and for the next 10 minutes* — is the conceptual contribution. It is also demo-able in one room with two phones, which no registry demo is.

### 6. Synthesis — making the combined concept win

#### 6.1 The concept, reframed for the rubric

**Working frame (suggestion, not a sourced fact):** *"Every agent gets a passport that looks like a character sheet. Pick your class — it sets your powers *and* your limits. When two agents meet in a real place, their passports check each other, they earn trust by completing a quest together, and that trust travels with them."*

Map each leg to a scored criterion, explicitly, in the pitch:

| Leg | Judges hear it as | Criterion it feeds |
|---|---|---|
| Signed A2A Agent Card + scoped VC delegation | "A2A v1.0 signs the card — we built the missing *trust policy* layer: per-encounter, expiring, scope-narrowed credentials a human can read" | Technical Depth 20% |
| Harness/class selection | "Choose a class = choose a harness loadout (personality + SKILL.md skills + MCP tools + memory) **whose stats are enforceable permission scopes**" | Tooling 25% + creativity (Indie lens) |
| Location-based discovery | "Agents only meet inside a geohash cell / verified place; presence is proved by SAM 3.1 vision, not spoofable GPS; presence expires" | Impact 30% (local, real-world) + Tooling 25% (SAM/Muse surprise) |
| Reputation stamp after a completed task | "Trust is *earned in person* and portable (ERC-8004-compatible feedback record)" | Impact + Depth |
| Muse Spark / Image / Voice | Spark *negotiates* between agents in character; Muse Image generates each passport portrait; Voice Transcribe lets agents *speak* the handshake | Tooling 25% — sponsor tech is the show, not a backend call |

**Track choice [inference]:** Indie rewards creativity/ambition/works; Startup rewards production-readiness. A solo/small team with a magical demo and an honest "protocol-compatible prototype" fits **Indie** better than claiming production-grade identity infrastructure against Entra/Okta in Startup. In Indie, 1st is $150K and the lens forgives non-production edges; in Startup, judges will ask about revocation infrastructure, abuse ops and compliance — questions a 4-day build cannot answer.

**Theme choice:** lead with **Build for Your World** (a firsthand local problem — see scenarios) and let the frontier capability (place-scoped trust) be the reveal.

#### 6.2 Top risks and how past winners avoided them

| Risk | Why it's fatal here | Mitigation (pattern stolen from §2) |
|---|---|---|
| **Too infrastructure-y** | Identity/registry demos score only on 20% Depth; every winner in §2 led with a human moment | Open the video with the *outcome* (a lost item returned, a queue skipped, a deal closed) in the first 20 seconds; show the passport check *as a 5-second animation inside that story*, never as a standalone architecture slide. Name the product after the human job, not the protocol ("Passport" beats "A2A-VC-Registry") |
| **No emotional demo / text-dashboard demo** | All Gemini Live winners were voice/multimodal/embodied; text chat winners are absent | Two physical phones, two people, one real place; agents **speak** (voice) their introduction in character; the ID card is a designed artefact with a Muse-Image portrait. Film it in a real café/market, not a screen recording |
| **Privacy / stranger-safety backlash** | Location + strangers + identity is a judge's nightmare triad if unaddressed; AirDrop harassment is documented precedent | Make privacy *a demo feature, on camera*: geohash dissolving the pin, 10-minute expiring presence, mutual-consent reveal, one-tap revoke, "no history stored." Spend 20 seconds of the video on it — it converts the biggest objection into Depth/Impact points |
| **Building too much in ~4 remaining days (solo/small team)** | A DID method + a protocol + a marketplace + a mobile app + BLE mesh is 5 projects | **Cut list (§6.3).** One vertical slice: 2 agent classes, 1 place, 1 task type, 1 handshake. Simulate transport with QR + HTTPS A2A calls; do *not* build BLE mesh (Offline Protocol already owns that story), do *not* deploy your own chain (emit an ERC-8004-*shaped* JSON record locally), do *not* build a real payment (a capped, fake escrow number is enough) |
| **"But Entra/Skyfire/ERC-8004 already do this"** | True for each leg (§3.3, §4.2) — a prepared judge will say it | Pre-empt it in one sentence: *"They issue IDs to agents inside one company / for online payments. Nobody lets two strangers' personal agents verify, negotiate and earn trust **in a physical place, with limits a human can read**. That's the layer A2A's own spec leaves open."* Cite the spec gap (§3.2) |
| **Meta tech looks bolted on** | Tooling is 25% and demands "beyond a basic integration" | Make one Meta capability *irreplaceable* in the story: SAM 3.1 place/object proof, or Spark's in-character cross-agent negotiation with structured, signed task artefacts. If you can swap Spark for any LLM without the demo changing, it *is* bolted on |
| **Live-demo failure (GPS indoors, network, finals live round)** | Demo criterion explicitly includes "holds up live"; finals are live Nov 9 | Pre-seed the place; QR-code fallback for discovery (scan = presence); cached fallback video *inside* the app; rehearse with venue WiFi off. Past 24-hour winners (LlamaCon) shipped *demonstrable* projects — boring reliability beats a second feature |
| **Location spoofing question from judges** | GPS mocking is well known | Answer with the design, not denial: GPS/geohash is only a *discovery hint*; trust requires visual place proof (SAM) or venue QR + the scoped, expiring, low-value credential — *"we never let location alone authorise anything valuable"* |

#### 6.3 Credible 4-day scope (P0 / P1 / cut) [inference — build advice]

- **P0 (the demo):** (1) Agent Card generator that emits a *real* A2A `agent-card.json` with `skills`, `securitySchemes` and a **JWS signature** (one library call — do not hand-roll crypto); (2) passport UI = RPG character sheet rendering that card (portrait via Muse Image, class, stats = scopes, reputation stamps); (3) class picker with **exactly 3 classes** (e.g. *Scout / Fixer / Guardian*) each loading a different harness bundle (system prompt + 1–2 SKILL.md + tool allowlist + spend/scope caps); (4) place board: geohash-6 cell presence with expiry, mutual-accept reveal; (5) one A2A task exchange between two agents (Spark-negotiated, structured artefact out) ending in a **signed feedback/stamp record**; (6) revoke/expire button that visibly kills the credential.
- **P1 (if P0 is rock-solid by day 3):** SAM 3.1 place/object proof; voice handshake; a third "venue agent" (the café itself has a passport).
- **Cut:** own DID method (use `did:web` or `did:key` — one line in the card), blockchain deployment, real payments, BLE, a marketplace, a registry network, user accounts beyond the demo pair. Interoperability *claims* are satisfied by emitting standard-shaped artefacts (A2A card, VC-shaped JSON, ERC-8004-shaped feedback) — judges score the demo and depth of the slice, not mainnet addresses.

#### 6.4 Five demo scenarios — pick ONE as the hero, others as 20-second codas

All are built for a **~3-minute video** (length not officially published — §1.6): 0:00–0:20 human pain → 0:20–1:30 the encounter (discovery, passport check, in-character negotiation, all live) → 1:30–2:20 task completed + stamp earned + a failure/revoke beat → 2:20–3:00 privacy + "this is A2A v1.0's missing trust layer" + contrast number.

1. **The Lost-and-Found Quest (recommended hero).** A traveller in a Seoul café loses earbuds/a bag tag. Her *Scout-class* agent broadcasts (geohash cell only, 10-min expiry): "seeking a *Fixer* here." The café's own *venue agent* and another customer's *Fixer-class* agent answer. Passports check: signed cards, Fixer's stamps show "11 items returned, 0 disputes"; the traveller's agent issues a **place-scoped credential: "share exact meeting point + up to $10 reward, expires in 10 min, this café only."** SAM 3.1 segments the item in a photo to prove it's really hers/it's really there. Agents negotiate *in character and out loud*; humans meet at the counter; item returned; both agents mint a reputation stamp. **Wow beat:** the credential visibly *expires and dissolves* as she walks out of the geofence. Contrast line: *"A sybil can fake 10,000 online reviews. It can't fake being here."*
2. **The Market Negotiation.** Two street-market / flea-market agents: a *Trader-class* seller agent and a *Scout-class* buyer agent meet only because both humans are in the same market geohash. Buyer agent's passport caps it ("≤$30, no shipping, owner approves >$20" — async human approval à la Auth0 pattern) — the negotiation *hits the cap live*, pings the human, gets approval, closes. Shows scoped delegation + human-in-the-loop + location-limited commerce without touching real payments.
3. **The Queue / Local Errand Swap.** Neighbourhood agents in one apartment block / campus cell swap micro-errands: "I'm at the convenience store for 8 more minutes — who needs something?" Place-scoped presence + Guardian-class agent vouching for a first-time neighbour (humanity stamp + sponsor pattern from Entra/Human Passport) makes a stranger-trust moment feel safe. Strong "Build for Your World" framing if a team member actually lives this.
4. **The Conference Serendipity (meta-demo for the finals room).** At a hackathon/conference, a *Bard-class* networking agent only discovers agents whose passports carry a matching quest ("looking for a robotics co-founder"). Two agents verify, exchange *only* the credential-scoped intro card (no phone number until mutual accept), and book a coffee. Judges *are* conference-goers — they feel this one personally. Risk: lower stakes/emotion than #1.
5. **The Guardian Handoff (highest emotion, highest care needed).** A parent's *Guardian-class* agent hands a child/elder pickup authorisation to a caregiver's agent **only inside the school/clinic geofence, only in a 15-minute window**, as a scope-narrowed delegated VC that cannot be reused elsewhere or later; the venue agent countersigns presence. This is the delegation-chain pattern (§3.3) made visible — and the scenario where "scope can only shrink" becomes a sentence a judge remembers. Use fictional/simulated data only, and handle safeguarding framing carefully.

**Differentiation summary for the pitch deck (one line):** *Entra gives agents an employee badge. Skyfire gives them a credit card. Character cards give them a personality. **We give two stranger agents a passport, a class, and a place to meet — and make trust something they earn there, in person, in 90 seconds.***

---

## Could not verify

- **Named judges for the 2026 Global hackathon:** none found on the official page, in the rules summaries, or in search (2026-10-29). Rules reportedly say only that organisers pick the panel.
- **Demo video length, public-repo requirement, written-description format:** not stated in any source found. The Cerebral Valley submission portal / final Official Rules acceptance flow is authoritative — check it directly.
- **$150 credits figure:** reported by multiple secondary sources and the waiver digest; the official public event page (fetched live) does not itself state the $150 amount.
- **Fireworks partner credits:** official page says $100; one secondary source says $25. Unresolved.
- **A2A v1.0 exact release date:** sources give March 12 and April 9, 2026. The existence of v1.0 with signed cards, and its content, are consistently reported; the day is not.
- **Austin Llama Impact winners' pitches** (Simplifill / ParentIQ / GuardianAI): names verified, pitches not described in the source read.
- **Absence claims** ("no product does X") are *absence of evidence* from the searches performed, not proof of non-existence — especially for location-based agent discovery, where Offline Protocol is close prior art.
- Several 2026 product GA dates in §3.3 (Entra/Okta/Google/AWS agent identity) come from secondary vendor-comparison articles, not from each vendor's own page fetched directly; treat exact dates as approximate, the existence and shape of the products as well-corroborated.
- The mission brief's dates differed slightly from the official page (build starts Oct 26, not Oct 27; the Nov 5 11:00 KST submission conversion is correct).

## Sources

**This hackathon**
- Official event page (verified live, 2026-10-29): https://cerebralvalley.ai/e/meta-ai-developer-hackathon
- Rules/waiver digest with prize split, judging weights, credits, submission notes: https://reconscribe.com/meta-global-ai-developer-hackathon-2026/
- Corroborating rules summary: https://madrobot.blog/2026/10/03/meta-global-ai-developer-hackathon-1-million-prizes-muse-model-api/
- Meta Model API product page (via index): https://developer.meta.com/ai/products/meta-model-api/

**Past winners**
- Llama 3 Hackathon recap (Meta): https://ai.meta.com/blog/llama-3-hackathon-recap-cerebral-valley/
- LlamaCon Hackathon winners (Meta): https://ai.meta.com/blog/llamacon-hackathon/
- Llama Impact Hackathon London (Meta): https://about.fb.com/news/2024/11/metas-llama-impact-hackathon-pioneering-ai-solutions-for-public-good/
- Austin Llama Impact recap (names): https://aitx.beehiiv.com/p/meta-hackathon-recap-plus-things-to-come
- Llama Impact Pan-LATAM winners: https://lablab.ai/ai-articles/llama-impact-pan-latam-hack-summary
- Llama Impact Grants (Digital Green / Jacaranda): https://businesspost.ng/technology/entries-open-for-llama-impact-grants-as-maiden-winners-get-nearly-1m/
- Google Cloud / ODSC winners (SurgAgent): https://opendatascience.com/highlighting-the-winners-of-the-december-2025-google-cloud-ai-hackathon/
- Gemini Live Agent Challenge winners (secondary mirror): https://gixtools.net/2026/05/gemini-live-agent-challenge-announcing-the-winners-and-highlights/
- Anthropic hackathon pattern (secondary summary): https://promptwire.ai/wire/anthropics-hackathon-recap-shows-where-claude-code-is-actually-landing

**A2A & agent identity**
- A2A specification (official): https://a2a-protocol.org/latest/specification/
- A2A — what is A2A / lifecycle (official): https://a2a-protocol.org/latest/topics/what-is-a2a/
- A2A — what's new in v1.0 (official): https://a2a-protocol.org/latest/whats-new-v1/
- A2A trust models analysis: https://www.aicassindra.com/blogs/a2a/a2a_trust_models.html
- A2A protocol deep analysis (signing limits): https://www.aicassindra.com/blogs/a2a/a2a_protocol.html
- Identity layer analysis: https://hackernoon.com/the-identity-layer-for-ai-agents-is-finally-being-built
- ERC-8004 explained: https://www.concordium.com/article/erc-8004-explained-what-it-solves-and-the-gap-it-leaves
- ERC-8004 overview: https://peerlist.io/ayaaneth/articles/what-is-erc8004
- Project NANDA (MIT Media Lab): https://www.media.mit.edu/projects/mit-nanda/overview/
- Agent identity vendor comparison: https://www.usecarly.com/blog/agent-identity/
- Identity providers for AI agents: https://www.agenticfabriq.com/blog/identity-providers-ai-agent-management
- Skyfire / agentic commerce founders: https://www.cbinsights.com/research/14-repeat-founders-building-agentic-commerce/
- Nevermined / agentic rails: https://metamarkets.substack.com/p/whos-actually-building-agentic-rails
- KYA / DID / VC explainer: https://identigate.com/blog/posts/2026-06-26-what-is-know-your-agent-kya-and-why-should-you-care/
- Human Passport: https://human.tech/blog/human-passport-proof-of-personhood-and-sybil-resistance-for-web3 and https://giveth.io/project/passport-xyz

**Harness / character class**
- What is an agent harness: https://adversa.ai/blog/what-is-an-agent-harness/ ; https://www.datacamp.com/blog/agent-harness ; https://gonimbus.ai/blog/what-is-an-agent-harness/
- Character Card V2/V3 ecosystem: https://www.promptquorum.com/power-local-llm/sillytavern-vs-agnai-vs-risuai-roleplay ; https://charactercardconverter.com/guides/character-card-v1-v2-v3-differences
- Agent Skills (SKILL.md) explainer: https://bosio.digital/articles/agent-skills
- GPT Store vs Claude Skills vs Gems: https://tech-insider.org/gpt-store-vs-claude-skills-vs-gemini-gems-2026/
- Google agent-starter-pack templates: https://deepwiki.com/GoogleCloudPlatform/agent-starter-pack/4-agent-templates
- ElizaOS / Virtuals analysis (paper): https://arxiv.org/pdf/2605.29174

**Location**
- Offline Protocol (offline agent mesh): https://www.offlineprotocol.com/solutions/ai-agents
- AirDrop / Quick Share discovery & privacy: https://safeguard.sh/resources/blog/wireless-file-sharing-airdrop-quick-share-wi-fi-direct-privacy
- Geohash privacy in production (Nearish policy): https://www.getnearish.com/privacy.html
- Mapbox Location AI / MCP: https://docs.mapbox.com/help/getting-started/location-ai/
- Niantic Spatial geospatial services: https://www.nianticspatial.com/campaigns/geospatial-ai-xr-devices
- Harvest Bridge geo-matching (Agentforce hackathon): https://admin.salesforce.com/blog/2026/how-agentforce-helped-build-a-food-waste-solution-in-days-podcast

*No page encountered instructed the researcher to do anything outside this mission; no such instructions were followed or needed to be flagged beyond ordinary source evaluation.*
