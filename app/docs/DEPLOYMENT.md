# Main product deployment

- Site: https://musely.net and https://www.musely.net
- Worker: `musely` (account configured by ID in `wrangler.jsonc`, the account that owns the `musely.net` zone)
- Source: `app/` in `Two-Weeks-Team/musely`. The preview (`preview/`, Worker `musely-preview`, preview.musely.net) is separate and is not changed from here.

## Separation from the preview

| | Main product | Preview |
|---|---|---|
| Directory | `app/` | `preview/` |
| Worker | `musely` | `musely-preview` |
| Domains | `musely.net`, `www.musely.net` | `preview.musely.net` |
| World state | its own `WorldDO` namespace, world id `musely` | its own namespace, world id `musely-preview` |
| Rate limit namespace | `26110201` | `26110101` |
| Public origin | `PUBLIC_ORIGIN=https://musely.net` (Agent Cards, MCP page) | — |

## Hosts and indexing

`musely.net` is the canonical origin (`PUBLIC_ORIGIN`). The Worker runs first for every request (`run_worker_first: true`) and answers any other host, such as `www.musely.net`, with a 308 to the same path on `musely.net`. A 308 keeps the method and body for MCP clients, and keeps one host for session cookies and the Threads OAuth redirect. The main product is meant to be found, so it does not send the preview's `noindex` header. Lines in `preview/docs/DEPLOYMENT.md` that say the apex and `www` are reserved no longer apply. That file belongs to the preview and is left as is.

## Deploy

From `app/` with Node 24.22.2: `npm ci && npm run check && npx wrangler deploy`. Workers Builds is not connected for `app/` yet, so deploys are run from a checkout of `main` after a PR merges. Record the deployed commit and the Worker version ID in the PR or issue.

The first deploy (2026-11-02) needed the apex parking records removed: the zone had two proxied `A` records for `musely.net` pointing at the registrar parking page, which blocks a Worker custom domain. Only those two apex records were deleted; `preview.musely.net` and `pv.musely.net` (Worker records) were left untouched.

## Secrets

Set with `npx wrangler secret put <NAME>` from `app/`. Values never go into the repository or the client bundle.

| Secret | Source |
|---|---|
| `MODEL_API_KEY` | same Muse Spark key as the preview (git-ignored `.env.local`). The daily budget (`DAILY_BUDGET_USD`) is counted per Worker |
| `OWNER_ROOT_JWK` | the owner's root key, `node scripts/owner-key.mjs --print-private` (`~/.config/musely/owner-root.jwk`) |
| `SESSION_SECRET` | random, generated for this Worker |
| `JUDGE_TOKEN` | random, generated for this Worker (kept in the owner's `~/.config/musely/app-judge-token`) |
| `TURNSTILE_SECRET` | the shared Turnstile widget; its hostnames now include `musely.net` and `www.musely.net` |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | Meta app for Threads claims; the redirect `https://musely.net/api/threads/callback` must be added to that app. A claim post made for the preview is not reused here: reuse needs this deployment's full claim text, so the owner posts once for musely.net |

## Rollback

Select a known good version in the Worker dashboard or run `npx wrangler rollback` from `app/`.
