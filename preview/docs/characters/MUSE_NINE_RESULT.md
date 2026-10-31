# Muse family — nine variants, world integration and viewer

Branch `feature/muse-nine`, built on Codex's rigged base (`83cf24d`, `feature/jolly-base`). It covers plan Tasks 4–6 and the in-demo part of Task 7. Muse and Jolly are Meta's characters. These fan-made recreations are excluded from the repository license; see `character-kit/NOTICE.md`.

## Inspect

From `preview/`, using Node 24:

```sh
npm ci && npm run check          # 44 Node tests, TypeScript, production build
python3 -m http.server 8789 --bind 127.0.0.1 --directory dist
```

- World (rigged residents by default): http://127.0.0.1:8789/ . The earlier rigid characters remain at `/?characters=legacy`.
- Ten-Muse viewer: http://127.0.0.1:8789/characters/ . Add `?muse=06-ink` to open a specific Muse.
- Browser regression: open any page on that server, then pass `scripts/muse.browser.js` to the Playwright CLI `run-code` command.

The local Workers runtime rejects the production compatibility date, so a static server is used for asset QA, as on the base branch.

## The ten

| ID | Role | Garments and props (material) | Signature clip |
|---|---|---|---|
| 00 Jolly | Base | none | uses the shared clips |
| 01 Sunny | Host | knit scarf with tail; enamel sun badge with brass rim | `welcome_neighbors` (once, 2.5 s) |
| 02 Moss | Gardener | linen apron with bib and pocket; steel watering can, wood handle | `water_plants` |
| 03 Ripple | Explorer | waxed-canvas crossbody bag; rubber soles; paper map | `inspect_map` |
| 04 Ember | Storykeeper | chunky knit shawl; brushed-brass lantern with a small warm flame | `tell_story` |
| 05 Bloom | Listener | open knit cardigan with embroidered petal patch | `reassure` (hand to chest, nod) |
| 06 Ink | Reader | cotton book pouch; round glasses; cloth/paper book | `read_book` (follows lines, turns page) |
| 07 Tempo | Music Friend | matte headphones, knit pads, steel hinges | `music_bounce` (beat, foot tap) |
| 08 Orbit | Stargazer | woven linen cape and collar; brushed-brass star pin | `observe_sky` (looks up, points) |
| 09 Copper | Maker | cotton-twill work apron; cork-grip tool; small device | `inspect_gadget` (twists, then presents) |

All ten share one body, rig, face morphs and fleece maps. Fleece is tinted per variant by palette ÷ measured mean fleece albedo (`#D6C6AB`), in linear light. The fleece sheen takes the coat color. The base's white sheen otherwise washed colored coats out to cream in the world. Contact sheets: `character-kit/validation/visual/roster-sheet.png` (front, three-quarter and back) and `signature-sheet.png`. Accessory textures are original procedural PBR maps (`source/make_accessory_textures.py`).

## Runtime kit (`character-kit/runtime/`, hashes in `character-kit/manifest.json`)

| File | Content | Triangles | Bytes |
|---|---|---|---|
| `base/lod0.glb` | rig, body, face (10 morphs), 6 sockets, **21 clips** | 22,886 | 6,030,464 |
| `base/lod1.glb` | same rig/sockets/morph names, 512 px maps | 5,069 | 1,635,856 |
| `base/lod2.glb` | same rig/sockets/morph names, 256 px maps | 1,982 | 446,828 |
| `attachments/<id>.glb` ×9 | skinned garments + bone-parented props, each with `__lod1`/`__lod2` copies; Ink also carries a 4 s page-only `read_book` clip | 1,316–2,600 at LOD0 | 0.54–0.97 MB |

Equipped maxima, measured in the browser: LOD0 25,486, LOD1 5,849 and LOD2 2,292. The budgets are 28,000, 8,000 and 3,000. All 12 files share one rig digest (joint names and order, parents, inverse binds), and `write_manifest.py` refuses a mismatch. Face morphs on reduced LODs are rebuilt by nearest-vertex delta transfer rather than decimated directly. The world's eight residents transfer 13.5 MB of character files, against a 15 MB target.

## World

- People keep their IDs, lines and routes. Each resident wears the variant that matches its everyday activity: Jimin→Jolly, Sora→Sunny, Mina→Tempo, Noa→Moss, Yuri→Ink, Ren→Orbit, Ari→Bloom, Sol→Ripple. Ember and Copper appear only in the viewer.
- `residents.ts` drives each Muse's behavior:
  - Routes own translation, and walk phase follows traveled distance.
  - Dialogue sets talk/listen. Jimin waves and Sunny welcomes on the opening lines.
  - When idle, each Muse alternates its signature clip with a calmer shared clip.
- One LOD selector picks each Muse's detail level:
  - At most two LOD0 actors: the selected Muse first, then the current speakers.
  - Promotion and demotion use projected box height with hysteresis: 150/130 px for LOD0 and 52/44 px for LOD1.
  - The design's 180/160 px starting point was tuned because the follow camera (zoom 22.7) frames a Muse at about 160 px.
- `setLod` swaps meshes only. The root, skeleton, action phase and expression continue across the swap.
- Rigged residents stay out of rigid instancing. Instancing had hidden bone-parented props and would have drawn all of their LOD copies.
- Lighting: night readability comes from a soft moonlight key, a weaker sky fill (0.95, down from 1.7) and a low-intensity room environment for the metal props. Cloth and face emission stays zero.
- If a variant file fails to load, it is retried twice. If it still fails, that resident falls back to the plain base and the scene continues.

## Verification (2026-11-01)

- `npm run check`: 44/44 tests, TypeScript and production build all pass. `scripts/character-kit-runtime.test.mjs` contains 16 tests:
  - catalog, Python spec and manifest agree
  - file hashes and rig digest match
  - 21 clip durations
  - LOD budgets for all ten
  - independent skeletons
  - props on their bones
  - LOD swap continuity
  - palette, sheen and face preservation
  - signature-action ground contact within 20 mm
  - resident clip coverage
  - LOD selector hysteresis
  - stride clock and same-action seek reset
  - actor-owned bone-texture disposal, preserving shared geometry
  - real Ink page rotation, LOD continuity and reset on other actions
  - furniture clearance for all eight equipped residents over the full 210 s
- `scripts/muse.browser.js` passed at desktop 1440×1000 and in 390×844 touch emulation:
  - Viewer: all ten load with fleece and accessory PBR maps; heights are 0.85–1.05 m; signature clips animate; LOD triangles stay within budget; expressions do not leak into each other; three lighting presets work; pause works; whole-character framing fits the sampled signature poses at both aspect ratios, with no horizontal page overflow.
  - World: the eight residents are the rigged kit; the scene and actor roots stay the same across seeks; speech framing works; there is a single canvas; LOD0 count is ≤2; the selected close Muse is at LOD0.
  - Draw calls ≤72 (target ≤90). 47–60 fps across independent desktop reruns (the final browser regression sampled 47 fps); this does not establish the continuous desktop performance target. No page errors.
- Khronos glTF Validator 2.0.0-dev.3.10 reports **0 errors and 0 warnings** on all 12 runtime files (`character-kit/validation/export/gltf-validator.json`). The first run found three problems, all fixed:
  - zero-length tangents left by decimation: repaired by `fix_tangents.py`
  - n-gon caps without tangents: now triangulated
  - skinned garments parented under the rig: now kept at the scene root
- Final independent browser evidence is saved in `character-kit/validation/runtime/browser-regression.json`.
- Visual review: Blender renders of every variant (front, three-quarter, back, signature) and browser captures of the world and viewer. Issues found and fixed during review:
  - arms swung outward instead of inward
  - a star pin left at the origin (stale world matrix)
  - a detached watering-can spout
  - washed-out coats (white sheen, sky fill)

## Independent review corrections (2026-11-01)

- Fixed actor replacement leaking bone textures: dispose each unique actor-owned skeleton, while retaining shared geometry, materials and maps.
- Reproduced GitHub Codex's same-action backward-seek finding (`wave` reached negative action time). Timeline discontinuities now reset both walking and single-play clocks.
- Added a separate hinged paper leaf to Ink in the Blender source and attachment. Its 4-second, six-track prop clip animates rotation/scale for all three page LODs, using the body action time. Other actions restore the leaf; the shared rig and 21 body clips are unchanged. Executed official MCP `build_variants.py` → `export_kit.py` with `ONLY=['06-ink']` → `write_manifest.py`; all 12 rig digests remain identical.
- Fixed portrait whole-character framing cutting off Sunny's extended arms. The camera now reserves width for the signature poses; face close-up and manual orbit/zoom remain available. Detail changes also refresh the visible triangle/LOD status.
- Independent code review of the full branch and correction diff, local CI, all 12 GLB validators, browser tests and direct image inspection completed. Inspected studio signature captures for all ten, night world desktop/mobile captures and the mobile viewer layout. No obvious garment or prop penetration was observed in those sampled poses; this does not establish collision-free cloth for arbitrary poses.
- LOD tests retain root/skeleton/phase/expression, and the page retains its local pose. Sampled world zoom/LOD swaps showed no actor replacement or pose restart. Simplification changes silhouette/material detail as expected; there is no cross-fade.
- CodeRabbit reported a successful check and generated a walkthrough, with no actionable inline findings. Its review excluded Blender/images and could not fetch two base GLBs; the independent binary validation and visual inspection cover those separately. Its success is not full binary review evidence.
- Independent logs/captures are in ignored `output/muse-nine-review/`; post-merge deployment and live evidence are recorded in PR #2.

## Not verified / deviations

- The original **≤6 draws per equipped avatar** target was not met. Actual LOD0 primitives/draws are Jolly 4, Sunny 8, Moss 7, Ripple 9, Ember 7, Bloom 7, Ink 9, Tempo 7, Orbit 6, Copper 10. For this demo, retain distinct PBR materials and bone-parented props instead of a broad atlas/geometry rewrite; the revised near-avatar budget is ≤10, with the existing eight-resident world gate ≤90. The final sampled world maximum is 72. This is an explicit target revision, not a pass against the original ≤6 target.
- Continuous 210-second median/p95 frame-time targets remain unmeasured; the 210-second test checks furniture clearance, not frame time.
- **Physical mobile performance was not measured.** Touch results are desktop emulation.
- Portable standalone per-variant GLBs are not produced or shipped, per the Task 7 release decision. The stale `portable/00-jolly/lod0.glb` (12 clips) was removed, and `character-kit/portable/` is ignored.
- Garments are skinned with weights transferred from the body. Extreme arm poses may still graze a shawl or cape edge. The inspected clips and the furniture test passed, but cloth simulation is out of scope.
- `base/lod0.glb` changed from the base branch: it now has 21 clips, SHA-256 `78211b7d…`. The hashes in `JOLLY_BASE_RESULT.md` describe the earlier 12-clip file.
- `scripts/jolly.browser.js` was replaced by `scripts/muse.browser.js`, because the world no longer exposes the single-candidate metric.

## Reproduce the assets

From `character-kit/source/`, using the official Blender MCP via `run_mcp_cli.py`:

1. `python3 make_accessory_textures.py`
2. `python3 run_mcp_cli.py muse_family.blend build_variants.py` (idempotent; saves the .blend)
3. `python3 run_mcp_cli.py muse_family.blend export_kit.py` (set `ONLY=['base']` or variant ids to split runs; the MCP call times out at about 2 min)
4. `python3 write_manifest.py` (also repairs zero tangents via `fix_tangents.py`)
5. Optional review renders: `python3 run_mcp_cli.py muse_family.blend render_variants.py` (use `ONLY` batches)
