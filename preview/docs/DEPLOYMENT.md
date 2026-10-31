# Preview deployment

- Site: https://preview.musely.net
- Repository: https://github.com/Two-Weeks-Team/musely (private)
- Worker: `musely-preview`
- Cloudflare login: `sejun@2weeks.co`
- Zone/account: the account owning `musely.net`, configured by ID in `wrangler.jsonc`
- Published directory: `preview/dist` only

## Release validation

The initial published HTML is 2,882,280 bytes. Its SHA-256 is `f0a840836f4721331e76761ae854be7ef398e85198f464aefd690605132b0496`, matching the accepted visual preview. All 16 regression tests and TypeScript checks pass. The production URL returns HTTPS 200, with noindex headers. The actual browser renders the map, Muse characters, speech, and faint activity bubbles.

## Git build settings

Connect the existing Worker to `Two-Weeks-Team/musely`, production branch `main`, root directory `preview`, Node `24.22.2`. Run `npm ci && npm run check`, then `npx wrangler deploy`. Watch `preview/**`; keep non-production branch deployments disabled.

A configured Git connection alone does not prove automatic deployment. Confirm the triggering commit in Cloudflare Builds, a successful build and deploy outcome, and the resulting production artifact hash.

## Scope and rollback

`musely.net` and `www.musely.net` remain reserved for the main product. No Worker routes or redirects target either name. R2 and D1 are not provisioned because this static visual preview has no persistent application data.

To roll back, select a known successful deployment in the Worker dashboard or use `npx wrangler rollback` from this directory. Keep the Git source in sync with the selected release before the next push.
