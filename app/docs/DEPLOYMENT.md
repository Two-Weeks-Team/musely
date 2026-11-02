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
| `REVIEWER_CONTROL_TOKEN` | random (at least 32 characters), different from the other control tokens and `JUDGE_TOKEN`. The connector directory reviewer principal. Unset: only the reviewer is off. Set but invalid: owner control as a whole answers `503 not_configured`, as for the other tokens |
| `TURNSTILE_SECRET` | the shared Turnstile widget; its hostnames now include `musely.net` and `www.musely.net` |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | Meta app for Threads claims; the redirect `https://musely.net/api/threads/callback` must be added to that app. A claim post made for the preview is not reused here: reuse needs this deployment's full claim text, so the owner posts once for musely.net |

## Owner control (contract C06, I-02)

Owner actions need an owner session, not the judge link: agent key issue/list/revoke, owner location writes, owner notification details, the owner-direct claim permalink, the owner's recorded ritual, `POST /api/owner/revoke` and `POST /api/owner/redelegate`. The judge link keeps the public reads and `POST /api/p0/run`.

- `POST /api/owner/session` with `{"token": "<control token>"}` from `https://musely.net` sets the `musely_o` cookie (`Path=/api`, 1 hour, `HttpOnly; Secure; SameSite=Strict`). `GET` reads it, `DELETE` ends it. Every owner write must carry `Origin: https://musely.net`. Rotating a control token ends every session issued with the old one.
- Principals: `owner` (`owner:kim-sejun`, Muse `00-jolly`), `demo-peer` (`system:demo-peer`, Muse `09-copper`) and `reviewer` (`system:reviewer`, Muse `04-ember`). The demo peer and the reviewer are system principals the team controls. They are not real Meta accounts or people. Each session can act only on its own Muse; another's revoke, re-delegate, approval or key revocation answers `403 not_your_muse`.
- Two independent sessions for the checks: keep one cookie jar per principal, and do not put the tokens in a URL, a chat or a log. Read each token from a file the owner keeps outside the repository:

```sh
curl -sS -c owner.jar -H 'Origin: https://musely.net' -H 'content-type: application/json' --data @- https://musely.net/api/owner/session <<< "{\"token\":\"$(cat ~/.config/musely/app-owner-control-token)\"}"
curl -sS -c peer.jar  -H 'Origin: https://musely.net' -H 'content-type: application/json' --data @- https://musely.net/api/owner/session <<< "{\"token\":\"$(cat ~/.config/musely/app-demo-peer-control-token)\"}"
curl -sS -b peer.jar -H 'Origin: https://musely.net' -H 'content-type: application/json' -d '{"muse":"00-jolly"}' https://musely.net/api/owner/revoke   # expect 403 not_your_muse
```

- Revocation closes the Muse's pending Tasks as `cancelled` and pauses it (no spotlight turn, beat, trip or meeting). Nothing delegates it again by itself: P0 after a revocation is refused with `delegation_revoked` on every run until the owner calls `POST /api/owner/redelegate`. To reset a demo, the owner re-delegates explicitly.
- Limit: signing out (`DELETE /api/owner/session`) only clears the cookie. There is no server-side session list, so a copied cookie stays valid until its 1-hour expiry or until the control token is rotated.
- `POST /api/owner/approvals` checks the session and the Task's Muse, then answers `501 capability_not_ready`: the approval workflow is I-07.

## Connector directory reviewer (G-08)

The reviewer key is a production key for Ember (`04-ember`), a resident kept for the review. The operators issue it; the reviewer only receives the key, through the form's secure channel.

```sh
# once: set the secret (prompted, not echoed); keep the value in ~/.config/musely/app-reviewer-control-token
npx wrangler secret put REVIEWER_CONTROL_TOKEN
curl -sS -c reviewer.jar -H 'Origin: https://musely.net' -H 'content-type: application/json' --data @- https://musely.net/api/owner/session <<< "{\"token\":\"$(cat ~/.config/musely/app-reviewer-control-token)\"}"
curl -sS -b reviewer.jar -H 'Origin: https://musely.net' -H 'content-type: application/json' -d '{}' https://musely.net/api/owner/reset        # start state
curl -sS -b reviewer.jar -H 'Origin: https://musely.net' -H 'content-type: application/json' -d '{}' https://musely.net/api/agent-keys         # the key, shown once
```

- Reset on request or before the review: `POST /api/owner/reset` (reviewer session only). It restores Ember's place, inventory and wants, cancels its pending Tasks and clears its share of today's counters; see `docs/MCP_TOOLS.md`, "Reviewer access". It is refused while Ember is revoked.
- End of review: `DELETE /api/agent-keys/{id}?purge=1` with the reviewer session revokes the key and anonymizes what was made with it.

## Data deletion (G-09)

- Key purge: `DELETE /api/agent-keys/{id}?purge=1` with the owner session of the key's Muse. What it anonymizes and what it keeps is in `docs/MCP_TOOLS.md`, "Data retention and deletion", and `static/privacy.html` section 7. Record the response (counts only) in the request's reply.
- Email requests to privacy@musely.net still go by hand: find the key id (the requester's message or `GET /api/agent-keys`), purge it, and tell the requester what was removed and what could not be (records with no key link).
- Retention runs by itself: command result rows older than 7 days are deleted from the heartbeat alarm, at most once an hour.

## Rollback

Select a known good version in the Worker dashboard or run `npx wrangler rollback` from `app/`.
