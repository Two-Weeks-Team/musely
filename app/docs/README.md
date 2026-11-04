# Musely product documentation

Start with the [live world](https://musely.net), [product setup](../README.md) or [current submission checklist](SUBMISSION_CHECKLIST.md). This guide groups the existing documentation and supporting records; a dated result applies to its named build, environment and measured scope.

## Architecture

- World runtime: [resident life](RESIDENT_LIFE.md), [integration boundaries](WORLD_LIFE_INTEGRATION.md) and [model budget](RESIDENT_BUDGET.md).
- Browser and geography: [live scene projection](LIVE_SCENE.md), [neighborhood areas](LOCATION_AREAS.md), [experience matrix](EXPERIENCE_MATRIX.md) and [recorded replay](RUN_REPLAY.md).
- Character kit: [design](characters/MUSE_CHARACTER_KIT_DESIGN.md), [implementation plan](characters/MUSE_CHARACTER_KIT_PLAN.md), [Jolly base result](characters/JOLLY_BASE_RESULT.md) and [nine-variant result](characters/MUSE_NINE_RESULT.md). These are design/build records; [asset attribution and exclusions](../character-kit/NOTICE.md) remain separate.
- Recorded model-response probes: [text](probes/text-structured.json) and [image](probes/image-structured.json). They do not establish current provider availability.

## MCP tools

- [Tool reference](MCP_TOOLS.md) — available reads, actions and permission boundaries.
- [MCP integration](MCP_INTEGRATION.md), [personal connector verification](CONNECTOR_VERIFICATION.md) and [owner workflow evidence](OWNER_WORKFLOW_ACCEPTANCE.md) — retain their stated distinction between local tests, deployed commands and actual Muse-account use.

## Deployment

- [Deploy the product](DEPLOYMENT.md); [run and check it locally](../README.md). The live product is `app/`; `preview/` is a separate reference experience.
- For the current access routes and release gates, use the [submission checklist](SUBMISSION_CHECKLIST.md) and [field draft](SUBMISSION_DRAFT.md). Preparing those documents does not publish a link, deploy a build or submit the project.

## Dated evidence & limitations

- Release and path evidence: [release acceptance](RELEASE_ACCEPTANCE.md), [D01 user paths](D01_ACCEPTANCE.md) and [evidence index](evidence/INDEX.md).
- Device/UI records: [device acceptance](DEVICE_ACCEPTANCE.md), [layout acceptance](LAYOUT_ACCEPTANCE.md), [entry review](ENTRY_REVIEW.md) and [V2 verification](V2_VERIFICATION.md).
- Earlier preview/reference work: [preview acceptance](PREVIEW_ACCEPTANCE.md), [scripted scenario](SCENARIO.md) and [walkthrough evidence guide](acceptance-evidence/README.md).
- Preview JSON records: [entry](acceptance-evidence/entry.json), [layout](acceptance-evidence/layout.json), [flows](acceptance-evidence/preview-flows.json), [walkthrough](acceptance-evidence/walkthrough.json) and [world UI](acceptance-evidence/world-ui.json).
- Release JSON records: [local D02 evidence](evidence/d02-local.json) and [release template](evidence/release-template.json).
- Submission/media records: [shot list](DEMO_SHOTLIST.md), [form coverage](submission/form-coverage.json), [readiness snapshot](submission/readiness.json) and [readiness schema](submission/readiness.schema.json). A schema or preparation record is not a submission receipt.
- Historical illustration: [Muse Wants screenshot](muse-wants-screenshot.png).

Keep local/fixture results, operating behavior, real-account actions and physical-device measurements distinct. Preserve recorded failures and unmeasured branches when reusing evidence. Real judge links and credentials belong outside these documents; examples use placeholders. Current access guidance is in the submission documents above, while [planning and build history](../../docs/README.md) remain separate.
