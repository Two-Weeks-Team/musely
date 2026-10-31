# Musely preview

A 3 minute 30 second visual story on a real map: colorful Muse characters walk, think, tend a garden, and talk while their Muses find a mutually suitable meetup. The opening map shows stories across the neighborhood; one continuous camera then moves into the detailed commons.

## Run

Use Node.js 24.22.2. From this directory:

```sh
npm ci
npm run check
npm run dev
```

`npm run build` generates `dist/index.html`. The application, character assets and a Bay geographic overview are bundled into the HTML. Online OpenFreeMap tiles add detailed geography, labels and fonts; their download does not block the local scene. The same overview remains underneath the online map when returning to the Bay.

## Deploy

`npm run deploy` deploys only `dist/` to the `musely-preview` Cloudflare Worker and its custom domain `preview.musely.net`. The account and domain configuration are in `wrangler.jsonc`. Authenticate as `sejun@2weeks.co`; the selected account owns the `musely.net` zone.

Cloudflare Workers Builds connects `two-weeks-team/musely`, branch `main`, with root directory `preview`. Build command: `npm ci && npm run check`; deploy command: `npx wrangler deploy`; Node version: `24.22.2`. Watch path: `preview/**`. Changes deploy after tests, type checking, and the asset integrity build pass.

The apex and `www` are reserved for the main product. No routes or redirects target them.

## Contents

- `src/`: map, characters, movement, camera, dialogue, and interface.
- `assets/`: character GLB, Sigil textures, map style, embedded Bay overview, geographic context, and SHA-256 manifest.
- `scripts/`: build, embedding helper, and regression tests.
- `fixtures/`: public meetup proposal transcript used by tests.
- `docs/SCENARIO.md`: complete English story and timing.

The conversations and activity are scripted. The commons is an authored fictional space aligned to mapped ground; it does not imply public access to the physical location. This preview does not run personal agents, send invitations, or persist user data.

## Opening and playback verification

See [the entry review](docs/ENTRY_REVIEW.md) for before/after conditions and measured limits. `scripts/entry.browser.js` is an additional browser regression, separate from the Node unit tests. Pass its contents to the Playwright CLI `run-code` command after opening the desired local or production URL. It checks delayed map requests, desktop and 390×844 touch emulation, eight-second arrival, dialogue identity, disclosure, and returning to Bay with failed online requests.

After `npm run build`, a static server can also serve `dist/` for asset-only browser QA when the installed local Workers runtime does not support the configured compatibility date.

## Attribution

**Owned by Meta (not ours):** the Muse product and its default character, Jolly, including the original character design. `assets/muse_base.glb` and everything under `character-kit/` recreate that character. These assets fall outside the repository license, and no reuse rights are granted. See [`character-kit/NOTICE.md`](character-kit/NOTICE.md).

**Made by Two Weeks Team during the hackathon (from 2026-10-26):**

- 3D recreation of the Muse character: modeling, materials, rig, actions and facial expressions
- In-demo Muse customization (colors, outfits and props)
- Sigil identity textures (`assets/variant_*.png`)
- Real-map world, camera, movement, dialogue and interface code (`src/`)
- The scenario (`docs/SCENARIO.md`), tests, build and deployment scripts

The map data below keeps its own license.

The embedded geographic data in `assets/arrival-map.json` is derived from OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors and is provided under the [Open Database License (ODbL)](https://www.openstreetmap.org/copyright). Its metadata records capture bounds, date and simplification; this data license does not change the license of the application or character assets.
