# Muse Character Kit — Base + Nine Implementation Plan

> **For agentic workers:** Use the official Blender MCP as the primary Blender backend. For software implementation follow superpowers:executing-plans, or use superpowers:subagent-driven-development only when delegation is explicitly selected. The following checkboxes describe future work; no asset implementation or external publication is authorized merely by this document.

**Goal:** Build a tactile, recognizable cream Muse base and nine distinct, rigged character personalities (in-demo Muse customization) that work in the actual Musely world and an in-demo GLB viewer. Muse/Jolly remains Meta's character; these assets are attributed to Meta and not licensed for reuse.

**Architecture:** One measured Muse body, one rig and facial contract, shared physical materials and clips, with nine palette/accessory/signature-action configurations. Export portable self-contained character GLBs plus a shared runtime kit; keep source and evidence separately inspectable. Integrate independent skinned residents into the existing MapLibre/Three.js scene while retaining the current identity, camera and scenario contracts.

**Tech Stack:** Existing Blender installation + official Blender MCP; glTF 2.0 metallic/roughness; existing Three.js 0.186.1, TypeScript, MapLibre, esbuild; glTF Validator and actual browser captures during production.

**Spec:** [MUSE_CHARACTER_KIT_DESIGN.md](MUSE_CHARACTER_KIT_DESIGN.md)

## Global constraints

- Base + nine = ten catalog characters; preserve the eight existing world person IDs and their scenario bindings.
- All new application/assets/docs live under preview/; root remains README.md + preview/.
- Original Muse/Jolly shape and supplied cream full-body reference are the visual baseline; all nine variants share that identity.
- All preview interface text is English; the identity term is Sigil.
- Neutral base height 0.900 m +/-0.005 m, scale one, glTF Y-up, facing +Z, feet on y=0.
- LOD0 <=28,000, LOD1 <=8,000 and LOD2 <=3,000 triangles per complete equipped avatar.
- <=40 deform bones; <=4 normalized influences per vertex; twelve shared clips and eight face presets plus blink/mouth controls; nine signature clips.
- Web material visibility is mandatory. Blender-only strand fur or a beauty render cannot pass the material gate.
- Preserve accepted current source assets and deployed v13 until a candidate passes the world gate. Implement on a feature branch/local candidate output; the existing main CI publishes automatically, so merge/deploy only after asset and release review.
- No paid provider job, unrelated scene reset, new public repo, unrestricted asset license, or public publication is included in writing this plan.
- Ownership: Muse/Jolly is Meta's character. Every Jolly-derived asset is attributed to Meta and excluded from the repository license; we grant no reuse or redistribution rights (`character-kit/NOTICE.md`). The nine variants are in-demo Muse customization (as Meta's own outfit and name customization allows), not a public character kit.
- Long-term direction: bring each user's real Muse avatar in through the Muse Gadget SDK, with Jolly as the default before connection.

## Review focus

1. A believable Blender render can export as smooth plastic: validate the exported GLB in the actual loader with nonconstant fleece normals/roughness visible in motion.
2. The current rigid InstancedMesh path cannot carry independent skeleton animation: near residents must have separate skeleton/mixer state while sharing geometry/maps.
3. Seat/route movement and in-place clips can fight each other: check planted feet, root ownership, seat height and hand-prop bindings throughout all 210 seconds.
4. Texture/UV or optional extension failures can hide on front-only captures: inspect 360 degrees, alternate lighting, core-only fallback and independently reopened archives.
5. A good desktop viewport does not prove mobile performance or package reuse: test recorded physical mobile hardware and a clean standalone import with documented resource counts.

---

## Task 1: Freeze source references and base proportions

**Files:** Create `character-kit/references/manifest.json`, `character-kit/README.md`, `character-kit/source/muse_family.blend`, `character-kit/validation/visual/base-proportions.json` under preview/.

**Consumes:** Supplied cream Muse and accessory images; existing reference manifest and original assets, read-only.
**Produces:** Selected/captured references with source hashes, authority/view labels and redistribution status; measured front landmarks; a clean neutral base candidate at the fixed game scale.

- [ ] Verify official MCP capability/readiness and intended scene before editing; write to a new source file, not canonical originals. Run `game-dev capabilities --json` and `game-dev doctor --json` to establish available read-only inspection/package operations; no paid generation is assumed. If unavailable, record that capability gap and use the official glTF validation path for asset checks; do not claim a game-dev package receipt.
- [ ] Resolve `ref-jolly-front-card-20261031` to the exact upload basename/hash/crop pinned in the design and inventory actual reference files/URLs; distinguish the cream Jolly from unrelated Google search characters.
- [ ] Measure and record normalized front silhouette/face landmarks. Label invented side/back geometry explicitly.
- [ ] Model the base; export front/three-quarter/side/back contact views with the same camera and neutral pose.
- [ ] Compare front and three-quarter appearance to the selected references. Reject a dark face cavity, hard rim, wrong limb length or generic bear/yeti silhouette.
- [ ] Freeze base measurements and save/reopen the .blend. Gate: recognizable base likeness approved before material/variant expansion.

## Task 2: Prove portable tactile materials on the base

**Files:** Create `character-kit/source/textures/`, `character-kit/runtime/base/lod0.glb`, `character-kit/portable/00-jolly/lod0.glb`, `character-kit/validation/materials/base.json`; create `src/character-kit/MaterialProof.ts`, `src/character-kit/materialProof.html`, `scripts/build-character-proof.mjs` and npm `proof:build`/`proof:dev` scripts under preview/. Ignore generated `dist-character-proof/`. This proof page is a development artifact until later catalog integration.

**Consumes:** Task 1 base and frozen measurements.
**Produces:** UV-complete PBR base with embedded base color/normal/ORM, texture tint masks, material comparison captures and a core-only GLB.

- [ ] Establish UV layout and plausible fiber/face/eye scale; inspect all visible surfaces and seams.
- [ ] Bake/export core PBR maps and sparse silhouette tufts; keep cloth and face emission at zero.
- [ ] Build a minimal viewer that loads the actual exported GLB with the existing pinned GLTFLoader and three fixed lighting presets. `scripts/build-character-proof.mjs` uses existing esbuild to bundle the proof entry and copies the candidate base/maps into `dist-character-proof/`; it must not modify the regular dist or live world.
- [ ] Run `npm run proof:build`, then `npm run proof:dev` (defined as `wrangler dev --assets ./dist-character-proof --port 8788`). Expected: http://localhost:8788/ displays the exported candidate with all three presets and has zero application/asset-load errors. Abort on an occupied port rather than stopping an unrelated process. This executable proof exists in Task 2, before any later integration task.
- [ ] Inspect fleece, hood rim, face and eye closeups plus a 360-degree slow orbit. Add side-by-side Blender/reference/browser captures.
- [ ] Validate glTF structure, embedded texture decode, material channel hookup/color spaces and core-only appearance. Capture a slow moving zoom to detect texture shimmer or fur sorting artifacts.
- [ ] Gate: the portable browser asset independently reads as short soft fleece; no growth of the nine-variant set until this passes.

## Task 3: Rig, facial expressions and reusable action library

**Files:** Modify `character-kit/source/muse_family.blend` and base exports; create `character-kit/runtime/animations/manifest.json`, `character-kit/validation/rig/base.json`, `scripts/character-kit-rig.test.mjs` under preview/.

**Consumes:** Material-approved base.
**Produces:** Stable skeleton/socket names, shared clips, face presets and documented seat/stride/prop coordinate contracts. The runtime base gains the nine signature body clips during Tasks 4–5; the complete runtime base ultimately contains all 21 body clips.

- [ ] Create the twenty mandatory bones and any justified extra deformation bones within the <=40 budget. Bind/normalize weights and add the six named sockets.
- [ ] Add eight face presets and blink/mouth controls without changing the neutral likeness.
- [ ] Animate the twelve exact shared clips from the design. Document each duration/loop flag and in-place root contract.
- [ ] Export and reopen the GLB. A regression check verifies skin existence, joints/weights, names, clip presence/duration, morph channels, neutral bounds and sockets; validate results independently with glTF Validator.
- [ ] Render front/side/back pose grids for walk, wave and sitting transitions, and inspect face/shoulder/hood deformation and hand placement.
- [ ] Gate: every clip and expression works after import; root movement is driven by routes rather than a second animation translation.

## Task 4: Validate Moss and Tempo as the material/personality pilot

**Files:** Create `character-kit/runtime/attachments/{02-moss,07-tempo}.glb`, their portable exports, source prop collections, signature animation tracks and per-character captures/validation under preview/.

**Consumes:** Task 3 rig/material/socket/animation contract.
**Produces:** Two working variants with linen/wood/watering and plastic/fabric/metal/music contrasts; a frozen family production template.

- [ ] Author original palette masks, accessory geometry and authored signature poses without duplicating or reshaping the shared body.
- [ ] Add `water_plants` and `music_bounce` signature body tracks to the common runtime base, and bind props to named sockets. Any attachment-local animation stays in its attachment GLB. Record bodyClip/propClip/attachment/socket mappings and their time synchronization; bake self-contained combined tracks into each portable variant. Garment export rigs must match the base rig digest and be rebound to the actor skeleton at load time.
- [ ] Verify variant material contrasts in the same neutral/day/night setups as the base. Inspect both-hand prop grips, apron deformation and face visibility.
- [ ] Import both into the runtime together: skeleton motion and expression changes on one must not change the other; common geometry/maps should be shared.
- [ ] Gate: base + Moss + Tempo all pass material, rig, visual and preliminary runtime budget checks; freeze the family contract before authoring seven more.

## Task 5: Produce the remaining seven and full ten-character roster

**Files:** Create the Sunny, Ripple, Ember, Bloom, Ink, Orbit and Copper source collections, runtime attachments, signature tracks, portable exports and evidence; create `character-kit/manifest.json` under preview/.

**Consumes:** Frozen pilot family template.
**Produces:** Exactly ten unique character IDs, complete material palettes/attachments, nine signature actions and a consistent catalog manifest.

- [ ] Produce each remaining variant with the design's original role, accessory material and movement tempo. Review each before moving to the next batch.
- [ ] Signature track IDs: Sunny `welcome_neighbors`; Ripple `inspect_map`; Ember `tell_story`; Bloom `reassure`; Ink `read_book`; Orbit `observe_sky`; Copper `inspect_gadget`.
- [ ] Complete LOD1 and LOD2 for every equipped avatar, retaining face/hood/feet landmarks, rig-contract digest, joint order/inverse binds, face morph names and socket coordinates. Signature actions may use reduced distant detail but must retain behavior identity.
- [ ] Produce a 10-character front/three-quarter roster and 21-action contact set (12 shared +9 signature), plus the face-preset sheet. Inspect palette distinguishability at actual map viewing distances.
- [ ] Validate unique IDs, complete paths, <=8 MiB portable file size, geometry/material/bone budgets and recorded hashes. Record unsupported reference views as interpretations.
- [ ] Gate: all ten look like one Muse family and all nine have a distinct personality beyond a recolor.

## Task 6: Integrate the shared rigged kit with the actual world

**Files:** Create `src/character-kit/{catalog.ts,loadMuse.ts,MuseActor.ts,MaterialLibrary.ts}` and `scripts/character-kit-runtime.test.mjs`; modify `src/{scene.ts,instances.ts,materials.ts}` and `scripts/build.mjs` under preview/.

**Interfaces:** `catalog.ts` exports `MuseVariantId` with the ten manifest IDs. `loadMuse(id, lod, materialLibrary)` resolves manifest assets, clones a skeleton correctly, and returns a `MuseActor`. `MuseActor` exposes `root`, `setAction(name)`, `setExpression(name)`, `setSigil(textureOrNull)`, `setVariant(id)`, `setLod(lod)`, `update(dt, routePose)` and `dispose()`. `root` and the actor skeleton/mixer remain stable across LOD changes. A world LOD selector owns screen-height/hysteresis/cap decisions as specified in the design; the loader does not independently change actor LOD. `routePose` carries world position, yaw, traveled-distance delta and optional seat anchor; the route owns translation. `MaterialLibrary` caches geometry/maps/palettes and owns shared resource disposal.

**Consumes:** Hashed runtime kit and existing person/route/dialogue/geography contracts.
**Produces:** Eight stable world identities using genuine independent skeletal animation, material-preserving variants and shared texture resources.

- [ ] Add behavior regressions before replacing the old path: independent poses/expressions, stable person picking/follow IDs, shared map identity, retained UV/normal/ORM channels, exact rig/attachment compatibility, prop/body clip synchronization and safe disposal. Exercise LOD0->LOD1->LOD2->LOD0 mid-walk and mid-talk; assert identical root/skeleton/person identity, continuous action time, preserved expression/prop state and no extra retained textures/mixers.
- [ ] Update the main builder to copy only manifest-allowlisted runtime GLBs/maps into `dist/character-kit/runtime/`, preserving shared resource URLs and excluding private sources/references. The world must load this shared runtime distribution rather than embedding all ten standalone GLBs.
- [ ] Implement the loader/actor/material library and single world LOD selector; use SkeletonUtils.clone and AnimationMixer for near residents, bind garment geometry to the actor skeleton, and synchronize any prop-local mixer. `setLod` swaps bound render meshes and restores named morph weights without replacing the actor root. Exclude independent skinned meshes from ordinary InstancedMesh batching.
- [ ] Map current eight people to suitable catalog variants without changing their identity or scenario lines. A later selection can expose all ten without adding residents automatically.
- [ ] Align in-place gait to traveled distance; bind sitting/props/partner-facing to current activities. Preserve real map ground, existing patch location and continuous camera zoom. If the faithful new silhouette exposes a furniture clearance issue, adjust only authored furniture/route waypoints inside this patch and revalidate the unchanged dialogue/timing/identity contract; do not distort the mascot or hide mapped ground to force a fit.
- [ ] Run all existing sixteen regressions plus the new semantic runtime checks. Capture the full 210-second run, LOD transitions, feet/support phases and speaker/listener framing.
- [ ] Gate: no missing materials or cross-character skeleton state; no furniture/prop penetration visible in inspected actions; planted support feet clear surfaces within the documented <=20 mm tolerance and do not sink through them.
- [ ] Measure eight-character resource targets from the design, on the recorded desktop and physical mobile target. Tune accessory/tuft detail and resource sharing until targets pass; record incomplete hardware coverage honestly.

## Task 7: In-demo showcase and attribution (no public kit)

**Files:** Create `src/character-kit/viewer/`, its HTML entry, `scripts/validate-character-kit.mjs` and curated evidence under preview/. Attribution lives in `character-kit/NOTICE.md`, the root `README.md` and `preview/README.md`.

**Consumes:** Validated ten-character set and world integration.
**Produces:** An in-demo character viewer using the identical runtime GLBs, plus provenance records. Jolly-derived assets are never offered as downloads or as a reusable kit, because Muse/Jolly is Meta's character and we have no right to license it.

- [ ] Build the English viewer at `dist/characters/index.html`: roster, 360 orbit, zoom, three lighting presets, materials closeups, expression/action selection and optional accessory/Sigil visibility. Present the nine variants as Muse customization inside the demo. Ship only the runtime GLBs the demo needs; no `dist/downloads/`, portable archives or standalone import example.
- [ ] Keep the manifest as the source for the viewer and world; compare served SHA-256 values to the validated files.
- [ ] Record creators and source/reference provenance. Every Jolly-derived file stays listed in `character-kit/NOTICE.md` and outside the repository license.
- [ ] Reopen every exported GLB and source .blend; decode preview images; store structural, visual, performance and device results separately.
- [ ] Deferred until after the hackathon: any public, reusable character kit uses only original, non-Meta characters of our own. No Jolly-derived asset is published as a kit.

## Production sequencing and estimation

Critical path: source/likeness -> browser material proof -> rig/actions -> Moss/Tempo pilot -> remaining seven -> actual world -> in-demo viewer and attribution review. Software scaffolding that is necessary for each gate belongs to that gate. Different export formats or nine variants are not nine independent projects; they depend on one stable family contract.

Do not promise a calendar deadline from model count alone. After the pilot, report actual elapsed production/rework time, the observed per-variant work, and a proposed finish estimate that includes QA and packaging. Launch all ten only after shared gates pass; an internal base/pilot review is not the announced ten-character release.

## Plan completion record

- [x] Read the request and supplied references.
- [x] Inspect existing GLB/runtime source and current official glTF/loader guidance.
- [x] Separate observed facts from proposed creative/technical decisions.
- [x] Builder check performed; runtime GLB/prop binding, LOD state ownership, independently runnable material proof and exact frontal-reference identity were clarified. The reviewer reread the corrections and reported all four gaps resolved with no remaining substantive blocker. Publication/build allowlists were additionally clarified in self-review.
- [x] Base (Tasks 1–3) implemented by Codex; Tasks 4–6 and the in-demo part of Task 7 implemented 2026-11-01. Results, deviations and open items: [MUSE_NINE_RESULT.md](MUSE_NINE_RESULT.md).
- [x] Redistribution basis settled: Jolly-derived assets are attributed to Meta and not redistributed as a kit (2026-10-31).
