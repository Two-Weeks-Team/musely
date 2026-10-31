# Preview deployment

- Site: https://preview.musely.net
- Repository: https://github.com/Two-Weeks-Team/musely (private)
- Worker: `musely-preview`
- Cloudflare login: `sejun@2weeks.co`
- Zone/account: the account owning `musely.net`, configured by ID in `wrangler.jsonc`
- Published directory: `preview/dist` only

## Release validation

The initial published HTML is 2,882,280 bytes. Its SHA-256 is `f0a840836f4721331e76761ae854be7ef398e85198f464aefd690605132b0496`, matching the accepted visual preview. All 16 regression tests and TypeScript checks pass. The production URL returns HTTPS 200, with noindex headers. The actual browser renders the map, Muse characters, speech, and faint activity bubbles.

The entry-review patch and its separate measurements are documented in [ENTRY_REVIEW.md](ENTRY_REVIEW.md).

## Git build settings

The Worker is connected to `Two-Weeks-Team/musely`, production branch `main`, root directory `preview`, Node `24.22.2`. It runs `npm ci && npm run check`, then `npx wrangler deploy`. The watch path is `preview/**`; non-production branch deployments are disabled.

A configured Git connection alone does not prove automatic deployment. Confirm the triggering commit in Cloudflare Builds, a successful build and deploy outcome, and the resulting production artifact hash.

## Scope and rollback

`musely.net` and `www.musely.net` remain reserved for the main product. No Worker routes or redirects target either name. R2 and D1 are not provisioned because this static visual preview has no persistent application data.

To roll back, select a known successful deployment in the Worker dashboard or use `npx wrangler rollback` from this directory. Keep the Git source in sync with the selected release before the next push.

## Build credential

The dedicated user token expires on 2027-10-31. It grants Workers Scripts edit, Workers Builds Configuration edit, and Account Settings read within the selected account; Workers Routes edit within `musely.net`; and user/membership read. It has no R2, D1, or KV access. Renew or replace it in Cloudflare Builds before expiration. Never put token values in this repository.
