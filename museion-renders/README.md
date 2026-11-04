# Museion renders (2026-10-30 prototype)

Early Blender work from before the map-based Musely preview. It was authored in
`~/museion-renders` and is kept here as a record of how the concept started:
the night campfire diorama, the ember-split moment and the cold-open frame,
followed by a first real-geography Bay Area map scene.

- `BLENDER_TASK.md` — the original art-direction brief (night palette, one fire light, two cream avatars).
- `diorama-hero.png`, `ember-split.png`, `cold-open.png`, `preview-hero.png` — first renders; `museion-cafe.blend` holds the three scenes.
- `build_scene.py`, `build_followups.py`, `fix_*.py`, `render_finals.py`, `mcp_client.py`, `run_preview.py` — scene build and render scripts driven through Blender MCP.
- `out/` — staged rebuild (flame, avatars, cafe, ember animation) with per-stage `.blend`, checks and validation JSON; `out/ember-split.mp4` is the encoded animation and `out/ember-check/` a frame sample.
- `map/`, `map_scene.py`, `out/map-real-geo.png` — OpenStreetMap extraction and the first real-geography map scene.
- `*.log`, `*-status.*`, `render-notes.json` — MCP session logs and validation notes (method, issues, provenance).

All meshes, curves and materials are procedural and locally authored; no external assets
(see `render-notes.json`). Scripts and logs reference the original absolute path
`~/museion-renders`; adjust it before rerunning.

Not included (regenerable or local-only): `out/.tools/` (Python env with an ffmpeg binary),
`out/ember-frames/` (72 PNG frames; the MP4 and `out/ember-check/` remain), `*.blend1` backups,
and browser-tool caches. The `norcal.osm.pbf` extract read by `map/extract_osm.py` was not in the original folder either.

> Note: scripts in this record keep the absolute paths of the machine they were run on, written here as `/Users/you/…`. Point them at your own checkout before running.
