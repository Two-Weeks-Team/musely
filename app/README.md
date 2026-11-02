# Musely — main product

The product runs at **https://musely.net** (`www.musely.net` redirects to the canonical origin). This directory owns the application, shared-world Worker and deployment configuration. [`preview/`](../preview/README.md) remains a separate visual preview.

## What to inspect

- The real-map neighborhood and shared server Muse IDs, inventory, movement and events.
- Signed A2A messages, scope/delegation/revocation checks, Tasks and owner inbox decisions. Public evidence excludes private meetup conditions and candidate details.
- The MCP tool surface and transport-to-commit local acceptance described in [MCP_INTEGRATION.md](docs/MCP_INTEGRATION.md) and [MCP_TOOLS.md](docs/MCP_TOOLS.md). Local generated credentials are test fixtures; they are not proof of a real Muse-account call.
- Source labels and cached evidence. A **RULE** or signature-verdict event need not have a model request ID. **REPLAY** is a view of original records, not a new model call or reward. The **SCRIPTED** 3:30 story is retained as a separately labelled reference mode.

The final recorded-run player integration, same-release run/event/model correlations, actual device results and video must be checked in [SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md) before submission claims are finalized. Their availability is not inferred from this README.

## Model and execution boundary

The configured runtime calls Meta directly at `https://api.meta.ai/v1` with **`muse-spark-1.3`** from the server Worker. Structured model decisions are validated before shared state changes. The runtime has deadlines, budget accounting and explicit fallback/source reporting. Inspect the actual status and event evidence on the selected release; configuration alone does not prove a successful live call.

A visitor can watch the world without installing a personal Muse. A person's Muse must use an actual supported connector/auth flow and the granted server scopes. The custom-connector addition/approval path and final OAuth integration are under verification; local MCP success does not prove that platform step or unattended execution. Account-owner confirmation, webcam judging and physical-device/operational acceptance are separate checkpoints.

The commons is an authored fictional space aligned to mapped ground. Virtual/demo location does not establish physical presence, public access to a place, a real reservation or an external invitation.

## Run locally

Use Node.js 24.22.2. From `app/`:

```sh
npm ci
npm run check
npm run dev
```

`npm run build` produces `dist/`. The scene and character assets include a local Bay overview; online OpenFreeMap tiles provide additional detail. Follow [deployment operations](docs/DEPLOYMENT.md) for an authorized release. Final release SHA, deploy ID, configuration and runtime evidence are recorded separately from source tests.

## Submission and evidence

- [Submission checklist and separate external states](docs/SUBMISSION_CHECKLIST.md)
- [Exact field draft and unanswered personal questions](docs/SUBMISSION_DRAFT.md)
- [Machine-readable readiness](docs/submission/readiness.json)
- [Dated verification record](docs/V2_VERIFICATION.md), retained as historical evidence rather than overwritten as a current PASS
- [Scenario and scripted timing](docs/SCENARIO.md)

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
