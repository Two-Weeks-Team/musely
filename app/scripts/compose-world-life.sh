#!/usr/bin/env bash
# Test-only composition of exact pinned checkouts. Unknown textual conflicts fail closed.
set -euo pipefail
own=$(realpath "$1"); base=$(realpath "$2"); life=$(realpath "$3"); wants=$(realpath "$4"); mode=${5:-full}
merge() { local p=$1 right=$2; git merge-file -p "$own/$p" "$base/$p" "$right/$p" > "$wants/$p.merge"; mv "$wants/$p.merge" "$wants/$p"; }
# Preserve main151 personal onboarding in dependencies based on earlier main150.
for p in src/main.ts src/style.css src/ui/onboarding.ts src/ui/personal-connection.ts src/ui/personal-entry.ts src/ui/recorded-scene.ts scripts/live-entry.browser.js scripts/personal-connection.test.mjs scripts/personal-entry-ui.test.mjs scripts/personal-onboarding.browser.mjs; do cp "$base/$p" "$wants/$p"; done
cp "$own"/worker/core/world-life*.ts "$wants/worker/core/"
cp "$own"/worker/core/{campfire-policy,connected}.ts "$wants/worker/core/"
merge worker/core/mcp-tools.ts "$wants"
cp "$own"/worker/{world-do,index,env}.ts "$wants/worker/"
cp "$own"/scripts/world-life*.test.mjs "$wants/scripts/"
cp "$own"/scripts/{compose-resident-*,prepare-integrated-replay*,capture-engine-checkpoint.mjs,verify-integrated-replay.mjs} "$wants/scripts/"
cp "$own"/scripts/test-support/{world-life-harness,personal-entry-harness}.mjs "$wants/scripts/test-support/"
mkdir -p "$wants/scripts/compat"
cp "$own"/scripts/compat/*.test.mjs "$wants/scripts/compat/"
if [ "$mode" = wants ]; then
 cp "$own"/worker/core/{run-log,messages}.ts "$wants/worker/core/"
 exit 0
fi
[ "$mode" = full ] || exit 2
node "$own/scripts/compose-resident-runtime.mjs" "$wants/worker/core/world-runtime.ts" "$base/worker/core/world-runtime.ts" "$life/worker/core/world-runtime.ts" "$wants/worker/core/world-runtime.ts" runtime
node "$own/scripts/compose-resident-runtime.mjs" "$wants/src/engine/world.ts" "$base/src/engine/world.ts" "$life/src/engine/world.ts" "$wants/src/engine/world.ts" world
node "$own/scripts/compose-resident-runtime.mjs" "$own/worker/core/messages.ts" "$base/worker/core/messages.ts" "$life/worker/core/messages.ts" "$wants/worker/core/messages.ts" messages
node "$own/scripts/compose-resident-runtime.mjs" "$wants/src/replay/player.ts" "$base/src/replay/player.ts" "$life/src/replay/player.ts" "$wants/src/replay/player.ts" player
merge worker/core/run-log.ts "$life"
cp "$life"/worker/core/{resident-life*,resident-roster,actions,trust,encounters}.ts "$wants/worker/core/"
cp "$life"/src/engine/{resident-life,resident-catalog,harness,actor-display,inbox,participants}.ts "$wants/src/engine/"
cp "$life"/src/ui/{personal-profile,live-scene-core,live-scene,commons-clearance}.ts "$wants/src/ui/"
cp "$life/src/replay/versions.ts" "$wants/src/replay/versions.ts"
cp "$life"/scripts/resident-life*.test.mjs "$life"/scripts/resident-slot-clearance.test.mjs "$wants/scripts/"
mkdir -p "$wants/scripts/installed"
cp "$own"/scripts/installed/*.test.mjs "$wants/scripts/installed/"
node "$own/scripts/prepare-integrated-replay.mjs" "$wants/src/replay/player.ts"
