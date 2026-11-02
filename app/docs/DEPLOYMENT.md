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
| `OWNER_CONTROL_TOKEN` | random (at least 32 characters; production uses 48), set by the owner. A token under 32 characters, or equal to `JUDGE_TOKEN`, makes owner control answer `503 not_configured`. Exchanged at `POST /api/owner/session` for the owner session. Not the judge link |
| `DEMO_PEER_CONTROL_TOKEN` | random, different from `OWNER_CONTROL_TOKEN`. The team-controlled demo peer principal for the two-owner checks |
| `TURNSTILE_SECRET` | the shared Turnstile widget; its hostnames now include `musely.net` and `www.musely.net` |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | Meta app for Threads claims; the redirect `https://musely.net/api/threads/callback` must be added to that app. A claim post made for the preview is not reused here: reuse needs this deployment's full claim text, so the owner posts once for musely.net |

## Owner control (contract C06, I-02)

Owner actions need an owner session, not the judge link: agent key issue/list/revoke, owner location writes, owner notification details, the owner-direct claim permalink, the owner's recorded ritual, `POST /api/owner/revoke` and `POST /api/owner/redelegate`. The judge link keeps the public reads and `POST /api/p0/run`.

- `POST /api/owner/session` with `{"token": "<control token>"}` from `https://musely.net` sets the `musely_o` cookie (`Path=/api`, 1 hour, `HttpOnly; Secure; SameSite=Strict`). `GET` reads it, `DELETE` ends it. Every owner write must carry `Origin: https://musely.net`. Rotating a control token ends every session issued with the old one.
- Principals: `owner` (`owner:kim-sejun`, Muse `00-jolly`) and `demo-peer` (`system:demo-peer`, Muse `09-copper`). The demo peer is a system principal the team controls. It is not a second real Meta account or person. Each session can act only on its own Muse; the other's revoke, re-delegate, approval or key revocation answers `403 not_your_muse`.
- Two independent sessions for the checks: keep one cookie jar per principal, and do not put the tokens in a URL, a chat or a log. Read each token from a file the owner keeps outside the repository:

```sh
curl -sS -c owner.jar -H 'Origin: https://musely.net' -H 'content-type: application/json' --data @- https://musely.net/api/owner/session <<< "{\"token\":\"$(cat ~/.config/musely/app-owner-control-token)\"}"
curl -sS -c peer.jar  -H 'Origin: https://musely.net' -H 'content-type: application/json' --data @- https://musely.net/api/owner/session <<< "{\"token\":\"$(cat ~/.config/musely/app-demo-peer-control-token)\"}"
curl -sS -b peer.jar -H 'Origin: https://musely.net' -H 'content-type: application/json' -d '{"muse":"00-jolly"}' https://musely.net/api/owner/revoke   # expect 403 not_your_muse
```

- Revocation closes the Muse's pending Tasks as `cancelled` and pauses it (no spotlight turn, beat, trip or meeting). Nothing delegates it again by itself: P0 after a revocation is refused with `delegation_revoked` on every run until the owner calls `POST /api/owner/redelegate`. To reset a demo, the owner re-delegates explicitly.
- Limit: signing out (`DELETE /api/owner/session`) only clears the cookie. There is no server-side session list, so a copied cookie stays valid until its 1-hour expiry or until the control token is rotated.
- `POST /api/owner/approvals` checks the session and the Task's Muse, then answers `501 capability_not_ready`: the approval workflow is I-07.

## Rollback

Select a known good version in the Worker dashboard or run `npx wrangler rollback` from `app/`.
