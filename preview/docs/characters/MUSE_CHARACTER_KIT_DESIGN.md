# Muse Character Kit — Base + Nine

Status: design, 2026-10-31; implemented on 2026-11-01 for the demo (see [MUSE_NINE_RESULT.md](MUSE_NINE_RESULT.md)). Sections about portable downloads and a public kit are superseded by the release decision below.

## Purpose and release scope

Build a recognizable, reusable 3D Muse family for Musely: one cream Jolly reference model and nine original personalities. Each character must look tactile in the actual browser, move with a real skeleton, and express a distinct personality. The kit also serves other creators through editable sources, portable GLB exports, clear provenance, and a working viewer.

The current request authorizes planning. Modeling, runtime replacement, and external release are subsequent stages. The baseline is Meta Muse/Jolly as shown in the supplied references; our files will be identified as a community-made reconstruction, never an official Meta 3D asset or official release. Availability of an official downloadable rigged Jolly asset has not been established by this planning pass.

## Confirmed requirements and proposed decisions

Confirmed: base + nine = ten characters; material detail must be visible; the original Muse/Jolly shape is the reference; multiple colors and personalities; actual map/world placement and continuous zoom; all preview interface text is English; Sigil is the identity term; the repository root stays README.md + preview/.

Proposed by the author: names, palettes, nine character roles below, exact material/geometry budgets, shared rig and animation library, package layout, and release sequence. These choices can be revised before production. They are not claims about Meta's character catalog.

## Existing evidence

- `assets/muse_base.glb`: 191,488 bytes, four meshes, zero glTF skins, zero embedded animation clips, zero morph-target sets, checked from the GLB JSON on 2026-10-31. It is a low-poly adaptation, not a verified reproduction of every reference view.
- `src/scene.ts`: eight named people and palette variants, real geographic world placement, activity routes and environment.
- `src/instances.ts`: ordinary InstancedMesh batches with rigid object matrices. This path does not animate independent character skeletons.
- `src/materials.ts`: cloned materials with roughness 0.96 and cloth/face emission. The new material pipeline must preserve texture maps and physical material properties rather than applying one roughness/emission recipe to every surface.
- The prior character specification uses 0.90 m height and a maximum of 3,000 triangles. Keep 0.90 m as the Musely game scale, not an assertion of the mascot's official height. Retain a <=3,000-triangle distant LOD; the more detailed near LOD is a proposed extension to the old preview budget.
- The existing original source assets, v13 preview, scenario, geographic alignment, and production deployment remain unchanged during asset development.

## Reference hierarchy and likeness

1. Original Muse/Jolly images and motion supplied in this conversation, plus verified first-party references recorded in the existing character reference manifest.
2. Frontal master reference ID `ref-jolly-front-card-20261031`: uploaded file `orca-paste-1793448185478-1fff2d2e-ffde-44b9-a567-e64ebe516ebc.png`, 480 x 640 pixels, SHA-256 `1a64e197c004ab7710e8f13fe2fbc75fafbb5f9b700a8f7b3456a1b99f165840`. This is the mint poster headed “6 things Muse can do that your other AI can’t,” containing the large cream full-body character in its lower half. Proposed review crop is [132, 304, 368, 568), top-left pixel origin, right/bottom exclusive, without resampling. Exclude the white cutout border, grid, stickers and shadow from body/face contour measurements. Record any crop refinement explicitly; preserve the original hash. Smaller accessory examples establish material and pose possibilities.
3. AllTheMuse gallery is a variation/mood reference, not a list to copy or evidence of official 3D geometry.
4. Google search screenshots are discovery aids. The long-haired white creature, unrelated human avatars, empty face openings, and other search-result silhouettes do not become the base character.

Preserve the rounded pear-shaped body, integrated fleece hood, softly squared face opening, short rounded arms and legs, small glossy black eyes, subtle smile, rosy cheeks and warm cream face. Avoid a dark face cavity, hard helmet rim, long limbs, a generic teddy bear muzzle, large shiny plastic body, or long shaggy fur.

Measure head/body width, face/hood width, eye spacing and limb length from the selected frontal reference before freezing the base. Record the actual measured ratios. Existing cropped-reference ratios are starting evidence only. Side and back surfaces are authored interpretations until corresponding references are verified; do not claim 1:1 fidelity for unsupported views.

The plain base has no compulsory garment, headphones, logo or Sigil printed on its face/body. Optional Sigil is a removable attachment; an original plain Muse remains available.

## Ten-character lineup

Working names and colors; palette hex values are authoring targets in sRGB, not expected final screenshot pixel values.

| ID / working name | Personality and world role | Body / accent | Material and silhouette differences | Signature behavior |
|---|---|---|---|---|
| 00 Jolly / Base | Warm, attentive companion; reference standard | warm cream #E8DDC7 / blush #D9A38D | short cream fleece, thick soft hood trim, matte face, restrained glossy eyes; no required accessories | gentle breathing, curious head tilt, small wave |
| 01 Sunny / Host | Outgoing, welcomes neighbors | honey #E7B75B / apricot #D9886C | common fleece, loose woven neck scarf, small enamel sun badge | open two-hand greeting, quicker cheerful settling |
| 02 Moss / Gardener | Patient, notices and cares for small things | sage #9CAD82 / clay #BA8068 | common fleece, linen apron with visible weave, wood-handled watering can | bends to inspect a plant, careful two-hand watering |
| 03 Ripple / Explorer | Curious, observant, enjoys the long way home | seafoam #83B8AE / sand #DBC5A1 | common fleece, waxed-canvas crossbody bag, short matte rubber soles | pauses, studies a folded map, looks around before moving |
| 04 Ember / Storykeeper | Calm, invites others to stay and listen | terracotta #CC8F73 / amber #E6BE77 | common fleece, chunky knitted shawl, small brushed-brass lantern | settles at the fire and gestures slowly while telling a story |
| 05 Bloom / Listener | Empathetic, gives people space | dusty rose #D5A0B1 / sage #9AAE91 | common fleece, fine-knit cardigan, small embroidered petal patch | attentive lean, gentle nod, reassuring hand-to-chest motion |
| 06 Ink / Reader | Thoughtful, focused, quietly playful | mist blue #91ABC8 / plum #826D9B | common fleece, soft cotton book pouch, thin matte round glasses, paper/cloth book | follows a line of text and turns a page carefully |
| 07 Tempo / Music Friend | Playful rhythm and shared company | lavender #AE9CCB / butter #E5CF90 | common fleece, matte headphone shells, fabric ear pads, small metal hinge; no branded product replica | gentle beat bounce and a light one-foot tap |
| 08 Orbit / Stargazer | Dreamy, reflective, attentive to the sky | dusk blue #8D96B8 / pale gold #DCC589 | common fleece, woven short cape, brushed-metal star pin; no emissive plastic body | holds still, looks upward and points softly |
| 09 Copper / Maker | Practical, inventive, enjoys fixing things | cocoa #AD8E79 / teal #7EA6A2 | common fleece, cotton-twill work apron, cork/wood tool grip and restrained steel fitting | inspects a small device and presents a finished repair |

These are personalities, not ten different species. Identity must read through a combination of color, restrained accessory silhouette, expression/tempo and signature behavior. Remove an accessory and the character must still be recognizable as a Muse. Keep the face opening and eyes unobstructed in the standard camera.

## Material delivery contract

### Portable web material is the release requirement

Every character ships with a self-contained glTF 2.0 metallic/roughness GLB with embedded PNG textures. Core maps: base color, tangent-space normal (+Y/OpenGL convention), and ORM packing (R=occlusion, G=roughness, B=metallic). Base color/emissive are sRGB; normal and ORM are linear data. Cloth/skin emission defaults to zero. Selection effects and optional Sigil glow remain separate.

BaseColor tint masks isolate fleece from face, eyes, cheeks, seams and accessories. Palette changes must retain fur direction and microstructure, not overwrite maps. Export has UVs and tangents where normal maps require them. Close all visible front/back/side/underside surfaces and inspect UV seams in all views.

Short plush is built from baked directional fiber normals/roughness plus sparse short mesh tufts at selected hood/silhouette regions. Do not rely on procedural Blender nodes, a particle/hair system, screen-space noise or one custom Three.js shader for the portable GLB's basic appearance. Dense transparent fur layers are excluded from the default release. Alpha-mask cards are an optional refinement only after moving-camera aliasing/overdraw checks pass.

An optional enhanced GLB may add KHR_materials_sheen. The installed Three.js 0.186.1 GLTFLoader contains this extension, but the portable core GLB must remain attractive without it. Preserve MeshPhysicalMaterial on import for an enhanced asset; never cast away or replace its properties merely to tint it. KTX2/mesh compression may be added in an optimized web distribution after decoder validation; neither is required to open the portable release.

A Blender source may include higher-detail strand fur for hero artwork. That render is supplementary: the browser must independently demonstrate convincing short fleece and every accessory material using the release GLB.

### Starting material ranges (artist-adjustable through the comparison gate)

| Surface | Required cues | Starting roughness / metallic |
|---|---|---|
| Short fleece / hood | soft broken highlight, directional fibers, thickness at rim | 0.75–0.95 / 0 |
| Face | smooth, warm, gently matte; no hard plastic specular | 0.60–0.85 / 0 |
| Eyes | small controlled catchlight | 0.08–0.22 / 0 |
| Linen / cotton / knit | weave or knit has distinct scale and direction | 0.70–0.95 / 0 |
| Canvas / rubber / headphone shell | canvas weave; rubber and shell distinguishable from fleece | 0.45–0.85 / 0 |
| Brushed brass / steel | directional restrained highlight, metal remains separate from fabric | 0.30–0.60 / 0.8–1 |
| Wood / cork / paper | grain or pores at a plausible scale; paper remains matte | 0.55–0.90 / 0 |

Use fixed neutral studio, daylight and current Musely night/fire lighting presets to inspect the same asset. Night lighting must retain cream/cheek/color readability without lighting the entire body from inside. Capture unlit albedo and normal/roughness inspection views as diagnostics, in addition to beauty views.

## Shared rig, facial expression and actions

- One skeleton contract for all ten: mandatory bones Root, Hips, Spine, Chest, Neck, Head; UpperArm/Forearm/Hand and UpperLeg/LowerLeg/Foot/Toe with _L and _R suffixes. Maximum 40 deform bones; <=4 normalized influences per vertex.
- Sockets: Socket_Head, Socket_Hand_L, Socket_Hand_R, Socket_Back, Socket_Chest, plus existing-compatible SigilSocket. Props bind to named sockets or explicitly skinned garment bones. Document their coordinate frames.
- Blender is Z-up, facing -Y. Export GLB is Y-up, facing +Z. Feet rest on y=0 in glTF; root is centered between the feet; effective object scale is one. Total neutral base height is 0.900 m +/-0.005 m excluding optional hats/props.
- Eight facial presets: Neutral, Smile, Curious, Thinking, Focused, Listening, Concerned and Delight. Separate Blink_L, Blink_R and mouth-open controls support blinks and talking; face shapes must remain gentle and recognizably Muse.
- Twelve named shared clips: idle_breathe, walk, look_around, think, listen, talk, wave, sit_down, sit_idle, stand_up, celebrate, offer_item.
- Nine additional signature clips, one per variant, implement the lineup behaviors. Base uses shared clips. Every clip has documented duration, loop flag and required prop/socket bindings.
- walk is in place: game routes own world translation/yaw, and actual traveled distance drives stride time. Sitting transitions use a documented seat-anchor offset and seat-height contract. Talk/listen must face the actual partner. Avoid independent root movement fighting the route or furniture.

## Geometry, texture and runtime targets

These are proposed budgets, not measured performance claims.

| Tier | Whole equipped avatar budget | Intended use |
|---|---|---|
| LOD0 | <=28,000 triangles, including fleece tufts/accessories; target base 12,000–18,000 | selected close avatar; maximum two simultaneous near-detail avatars |
| LOD1 | <=8,000 triangles | other nearby Muses |
| LOD2 | <=3,000 triangles | distant map/world residents |

Initial near-LOD target was <=6 draw calls per fully equipped character. The reviewed demo uses 4–10 (Ink 9), retaining distinct PBR materials and bone-parented props; its revised per-avatar budget is <=10. This is a target revision, not a pass against the original <=6 target. Eight-character commons remains <=90 custom-layer draw calls, excluding MapLibre's own calls and measured separately (sampled maximum 72; see MUSE_NINE_RESULT.md). Shared rig/geometry/maps must be reused by the runtime, not duplicated by loading eight standalone full-body GLBs. Shared 2K maximum maps + bounded accessory atlases: target <=96 MiB resident character texture allocation including mipmaps for the eight-character test; report decoded/GPU estimates and actual resource counts separately. Portable standalone GLB <=8 MiB per character; default shared eight-character payload target <=15 MiB transferred excluding map tiles. If the measured budget fails, simplify nonessential accessories/tufts before degrading the base face or hood.

Performance targets for the existing map + eight Muses + bubbles: >=55 FPS desktop median with p95 frame time <=33 ms; >=30 FPS on an explicitly recorded physical mobile target with p95 <=50 ms after warmup. Use a continuous 210-second run with fixed route/camera and recorded browser/device/viewport; a desktop mobile viewport does not establish physical mobile performance. These release targets remain unverified until tested.

Skinned nearby Muses use SkeletonUtils.clone and AnimationMixer, with shared geometry/textures and independent skeleton state. Existing ordinary InstancedMesh batching is not reused for independent skinned poses. Far static/impostor batching is an optional, separately validated LOD path. Eight existing person IDs and dialogue speaker/listener bindings remain stable; the ten-character catalog does not automatically increase the world resident count to ten.

## Showcase, integration and packaging

One viewer provides all ten selectable characters, a 360-degree orbit, face/hood/hand closeups, the three lighting presets, animation and expression selection, and optional accessory/Sigil visibility. A roster overview uses appropriate LOD. Downloads and viewer must use the same manifest-hashed GLB bytes; these SHA-256 records are integrity checks, not a cryptographic signature or an endorsement. Use English names and copy, label community production and each format accurately, and identify interpreted side/back details.

The main build copies only manifest-allowlisted runtime GLBs/maps into `dist/character-kit/runtime/`. The later release build adds portable downloads under `dist/character-kit/portable/` and the viewer at `dist/characters/index.html`; curated, approved archives can live under `dist/downloads/`. Source .blend files, reference originals and raw validation logs are not copied to public dist automatically. Share resource maps through the runtime manifest rather than embedding ten standalone GLBs into the world HTML.

Implementation is developed on a feature branch with local candidate builds. The existing main-branch CI deploys automatically, so candidate asset/runtime changes reach main only after release review; non-production Cloudflare deployments remain disabled. This keeps the current preview available while the new kit is being validated.

The Musely world uses the actual exported rigged assets at the existing geographic coordinates. Continuous real zoom into the detailed patch must hold identity, surface grounding and material continuity. Do not substitute a separate Blender closeup scene or rendered character card for the world.

Planned reusable asset tree, all under preview/:

```text
preview/character-kit/
  README.md
  manifest.json
  ATTRIBUTION.md
  LICENSE-NOTES.md
  references/manifest.json
  source/muse_family.blend
  source/textures/
  portable/00-jolly/{lod0,lod1,lod2}.glb
  portable/01-sunny/... through 09-copper/...
  runtime/base/{lod0,lod1,lod2}.glb
  runtime/attachments/<variant-id>.glb
  runtime/textures/
  runtime/animations/manifest.json
  renders/<variant-id>/{front,three-quarter,side,back,material-closeup}.png
  validation/{gltf,materials,rig,visual,runtime}/
```

### Runtime binary and LOD contract

The runtime base GLBs contain the common skeleton, face morphs and **21 body clips**: twelve shared + nine variant signature body motions. Every base LOD exports the same rig joint order, hierarchy, rest transforms and inverse-bind matrices, recorded as a rig-contract digest. The face mesh/morph names are shared across LODs. A mismatch fails validation instead of silently rebinding an incompatible rig.

A runtime attachment GLB contains rigid socket props and/or skinned garment meshes. A skinned garment may include an export skeleton for self-contained validation, but the loader rebinds its matching JOINTS/WEIGHTS geometry to the actor skeleton and removes the duplicate joint hierarchy before playback. It must satisfy the exact rig contract and bind space; no second animated body rig remains in the actor. Garments use skinning in v1; no cloth-physics system or garment facial morphs are required.

Prop-local animation such as a book page hinge lives inside that attachment GLB and only references its own nodes. The manifest action record maps `bodyClip`, optional `propClip`, required attachment ID and socket ID. Actor code drives body and prop mixers from the same action time; all looping/duration mappings are explicit. An animation in one GLB never assumes it can reference nodes in another GLB. A portable standalone variant contains the whole rig, body, props and self-contained combined tracks: twelve shared clips plus its one signature; the plain base contains the twelve shared clips.

`MuseActor.setLod(lod)` replaces render meshes only, retaining the same world root/person ID, skeleton, mixer/action phase, expression weights, sockets, attachments and resource ownership. New meshes bind to the actor skeleton and restore morph weights by name. A single world LOD selector owns changes: <=2 LOD0 actors, prioritizing selected Muse and current conversation partner when close; all others use LOD1/2. Start with screen-height thresholds of 180 px promotion /160 px demotion for LOD0, 52 px promotion /44 px demotion for LOD1 versus LOD2; tune from moving-camera evidence. Do not replace identity roots or restart the walk/talk action when crossing a threshold. Compare all LODs in bind/animated poses for equivalent origin, bounds and planted-foot height.

A manifest maps character IDs to LOD paths, rig digest, material palette, socket bindings, body/prop action records, bounds, hashes and provenance. The catalog viewer and packaging code live under preview/; generated evidence/build output stays ignored except curated release documentation and approved distributable files.

Release decision (2026-10-31): Muse and Jolly are Meta's characters, so these fan-made recreations are attributed to Meta, excluded from the repository license, and not published as a downloadable or reusable kit (`character-kit/NOTICE.md`). They ship only inside the hackathon demo: the world and the in-demo viewer at `/characters/`. No separate public kit repository is planned. Any later public kit would use only original, non-Meta characters. The v1 compatibility claim covers Blender reimport and the pinned Three.js runtime.

Preserve private source/reference files separately from public downloads. Publish only files whose redistribution basis has been verified and recorded. Do not attach an unrestricted model license to the Meta-derived character without a verified basis; license our code separately from model/brand/reference materials. This is a release readiness check, not a claim about current permission. Public package visibility, redistribution terms and final publication destination are not settled by this plan.

## Release sequence and acceptance gates

1. **Base likeness:** frontal/three-quarter overlays and silhouette review against the selected cream reference. Side/back interpretations labeled. Freeze measured proportions only after this review.
2. **Material proof:** the base GLB in the browser shows short fleece, hood thickness, face and eyes under all three lighting presets, including 360-degree closeups and a slow zoom. A Blender-only beauty render cannot pass this gate.
3. **Rig proof:** all shared clips and facial presets survive GLB export/reimport, with no visible inverted seams, broken shoulders, stretched face, prop clipping or floating planted foot. Inspect walk, sit and wave from front/side/back.
4. **Two-variant pilot:** Moss and Tempo. This tests linen/wood/watering and plastic/fabric/metal/music while retaining the same Muse body. Freeze the shared rig/material/socket contract here.
5. **Remaining seven:** Sunny, Ripple, Ember, Bloom, Ink, Orbit and Copper. Review a ten-character contact sheet plus each signature action. Avoid expanding to nine before the pilot contract passes.
6. **World + viewer release candidate:** real map zoom, eight independent residents, full 210-second scenario, desktop and physical-mobile performance, and all ten selectable in the viewer. Retain the accepted current demo until candidate validation passes.
7. **Release package:** reopen every .blend/GLB, run structural/material/animation checks, verify hashes/downloads and provenance/redistribution records, produce source/runtime/portable archives and a known-good sample integration. External publication is a separate explicit release action after package review.

Use stages rather than a promised calendar date. Record actual production time through the material/rig pilot, then estimate the seven remaining variants from that evidence, including QA time. No paid generation/provider job is assumed or authorized by this plan.

## Sources and verification limits

- Supplied full-body cream Muse and accessory reference images in this conversation, 2026-10-31. The Google result screenshot is not a model license or an orthographic source.
- Existing character reference manifest: official frontal image https://muse.ai/images/landing/brand/hatch.jpg and motion https://muse.ai/videos/avatars/hatch_connecting.mp4. The manifest's source URLs must be reverified and captured in production before being called current source receipts.
- Meta Muse product page: https://ai.meta.com/muse/ ; official product context, not evidence that a downloadable 3D rig is available.
- Blender official MCP: https://projects.blender.org/lab/blender_mcp ; production must use the configured official blender server through the local blender-official adapter. No live MCP readiness has been claimed by this plan.
- Official Blender glTF exporter manual: https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html ; the installed official MCP manual copy was inspected where web retrieval failed. It documents mesh export, PBR maps, shape keys and skinning; non-mesh hair/curves are not a portable material representation.
- glTF 2.0 specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- Three.js loader: https://threejs.org/docs/pages/GLTFLoader.html ; actual pinned 0.186.1 loader source was also checked for sheen and skeleton handling. The documentation website and installed version can differ; validate the pinned implementation before selecting optional extensions.
