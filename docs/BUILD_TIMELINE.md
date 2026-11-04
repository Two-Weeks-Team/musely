# Build timeline — made from scratch during the hackathon

Musely was built by Two Weeks Team during the **Meta Global AI Developer Hackathon 2026** (kickoff 26 Oct 2026; submission deadline 4 Nov 21:00 ET = 5 Nov 11:00 KST). The team reports creating its own code, 3D work and writing during the event; third-party libraries, map data and Meta's original Muse/Jolly design are credited in the [README](../README.md#attribution-and-license). The repository's recorded history begins on 31 Oct, and its initial commit already contains the visual preview. Git facts below can be checked from the repository; event dates come from the official event page.

## Key dates (KST)

| When | Evidence |
|---|---|
| 26 Oct | Hackathon kickoff ([official event](https://cerebralvalley.ai/e/meta-ai-developer-hackathon)) |
| 30 Oct | Team record: first 3D render setup (`museion-renders/`) and the planning set — [`docs/museion-plan-final-2026-10-30.md`](museion-plan-final-2026-10-30.md), [`museion-prd-2026-10-30.md`](museion-prd-2026-10-30.md), [`museion-dev-plan-2026-10-30.md`](museion-dev-plan-2026-10-30.md), [`museion-art-direction-2026-10-30.md`](museion-art-direction-2026-10-30.md). These carry 30 Oct in their names; their first Git record is 1 Nov (`2779cb7`), when they were moved into this repository. |
| 31 Oct, 20:27 | Repository created (`createdAt 2026-10-31T11:27:06Z`) and root commit [`e0fb74d`](https://github.com/Two-Weeks-Team/musely/commit/e0fb74da54f5ed02205da404c7e202a772399cf4) — the initial visual preview (41 files) and its Cloudflare deployment. Not a fork. |
| 31 Oct, 23:25 | PR #1 — Muse/Jolly attributed to Meta and excluded from the license |
| 1 Nov | Meta model proxy and Threads claim (#13), shared world (#17), items and trades (#18), four-stage roadmap ([`docs/roadmap/`](roadmap/)) |
| 2 Nov | The product moves into `app/` from the preview ([`5712240`](https://github.com/Two-Weeks-Team/musely/commit/5712240f819bc02692647aefaeb053386cf1dabc)), MCP connector and keys (#94), verified-only travel (#92), recorded-run replay (#102) |
| 3 Nov | Owner neighborhoods (#128), native character kit (#150); ComBba starts living through the Muse app |
| 4 Nov | Connected-Muse reads (#162, 07:39), 26 resident personas and daily rhythms (#174), camera welcome check (#188), local perception (#187), English world speech (#191), Threads sign-in for personal Muses (#193) |
| 5 Nov | Simplified live UI and status bubbles (#194), Safari fix (#196), Character Studio onboarding (#200), Judge Muse (#203) |

## Activity by day (KST)

| Day | Commits | Merged PRs |
|---|---:|---:|
| 31 Oct | 7 | 1 |
| 1 Nov | 136 | 34 |
| 2 Nov | 150 | 29 |
| 3 Nov | 172 | 34 |
| 4 Nov | 139 | 41 |
| 5 Nov (to 02:35) | 41 | 13 |
| **Total** | **645** | **152** |

53 issues track the plan, from the four-stage roadmap to the final acceptance checks. Counts describe recorded activity, not the number of features or the quality of the work.

## Verify it yourself

Counts above are through commit `a5651f4` (5 Nov 02:35 KST), including merge commits.

```sh
gh repo view Two-Weeks-Team/musely --json createdAt          # 2026-10-31T11:27:06Z
git log --reverse --format='%h %ad %s' --date=iso | head -5   # first commit e0fb74d, 2026-10-31 20:27 +0900
git rev-list --count a5651f4                                  # 645
TZ=Asia/Seoul git log a5651f4 --format='%ad' --date=format-local:'%Y-%m-%d' | sort | uniq -c
git log a5651f4 --first-parent --merges --oneline | grep -c 'Merge pull request'   # 152
```

Pull requests are merged with merge commits (never squashed), so the full individual history is kept.
