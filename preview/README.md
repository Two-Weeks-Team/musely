# Musely preview

A 3 minute 30 second visual story on a real map: colorful Muse characters walk, think, tend a garden, and talk while their Muses find a mutually suitable meetup. The opening map shows stories across the neighborhood; one continuous camera then moves into the detailed commons.

## Run

Use Node.js 24.22.2. From this directory:

```sh
npm ci
npm run check
npm run dev
```

`npm run build` generates `dist/index.html`. The application and character assets are bundled into the HTML; the map needs an internet connection for OpenFreeMap tiles and fonts.

## Deploy

`npm run deploy` deploys only `dist/` to the `musely-preview` Cloudflare Worker and its custom domain `preview.musely.net`. The account and domain configuration are in `wrangler.jsonc`. Authenticate as `sejun@2weeks.co`; the selected account owns the `musely.net` zone.

Cloudflare Workers Builds should connect `two-weeks-team/musely`, branch `main`, with root directory `preview`. Build command: `npm ci && npm run check`; deploy command: `npx wrangler deploy`; Node version: `24.22.2`. Watch path: `preview/**`. Changes deploy after tests, type checking, and the asset integrity build pass.

The apex and `www` are reserved for the main product. No routes or redirects target them.

## Contents

- `src/`: map, characters, movement, camera, dialogue, and interface.
- `assets/`: character GLB, Sigil textures, map style, geographic context, and SHA-256 manifest.
- `scripts/`: build, embedding helper, and regression tests.
- `fixtures/`: public meetup proposal transcript used by tests.
- `docs/SCENARIO.md`: complete English story and timing.

The conversations and activity are scripted. The commons is an authored fictional space aligned to mapped ground; it does not imply public access to the physical location. This preview does not run personal agents, send invitations, or persist user data.
