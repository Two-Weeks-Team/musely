#!/usr/bin/env bash
# Test-only merge of visual PRs with the server/life composition. Never enables deployment.
set -euo pipefail
base=$(realpath "$1"); world=$(realpath "$2"); fire=$(realpath "$3"); out=$(realpath "$4")
mkdir -p "$out/world-packs"
cp -a "$world/world-packs/hq-belle-haven" "$out/world-packs/"
cp -a "$fire/world-packs/campfire" "$out/world-packs/"
git merge-file -p "$out/src/ui/live-scene.ts" "$base/src/ui/live-scene.ts" "$fire/src/ui/live-scene.ts" > "$out/src/ui/live-scene.ts.composed"
mv "$out/src/ui/live-scene.ts.composed" "$out/src/ui/live-scene.ts"
cp "$fire/scripts/boundaries.test.mjs" "$out/scripts/boundaries.test.mjs"
cp "$fire/scripts/build.mjs" "$out/scripts/build.mjs"
cp "$fire/scripts/campfire-composition.test.mjs" "$out/scripts/campfire-composition.test.mjs"
cp "$fire/scripts/campfire-visual-port.test.mjs" "$out/scripts/campfire-visual-port.test.mjs"
cp "$fire/scripts/campfire-world.test.mjs" "$out/scripts/campfire-world.test.mjs"
cp "$fire/scripts/character-proof-build.test.mjs" "$out/scripts/character-proof-build.test.mjs"
cp "$fire/scripts/transport-build.test.mjs" "$out/scripts/transport-build.test.mjs"
cp "$fire/src/main.ts" "$out/src/main.ts"
cp "$fire/src/scene.ts" "$out/src/scene.ts"
cp "$fire/src/ui/world-observation.ts" "$out/src/ui/world-observation.ts"
cp "$fire/src/ui/world-panel.ts" "$out/src/ui/world-panel.ts"
