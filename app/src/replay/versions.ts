// Shared content versions; neither this module nor the player has a live executor.
import {ENGINE_VERSION} from '../engine/world.ts';
import {HARNESSES} from '../engine/harness.ts';
import {ITEMS} from '../engine/items.ts';
import {BEATS} from '../engine/beats.ts';
import {PLACES} from '../engine/places.ts';
import {NEIGHBORHOOD_AREAS} from '../engine/location.ts';
import {canonicalize} from '../identity/jcs.ts';
import {sha256Hex} from '../engine/sha256.ts';
export const RUN_SCHEMA_VERSION = 'run-log-2';
export type RunVersions = {schemaVersion: string; engineVersion: string; harnessVersion: string; catalogVersion: string};
let versions: RunVersions | null = null;
export function currentVersions(): RunVersions {
  return (versions ??= {schemaVersion: RUN_SCHEMA_VERSION, engineVersion: ENGINE_VERSION,
    harnessVersion: 'harness-' + sha256Hex(canonicalize(HARNESSES)).slice(0, 12),
    catalogVersion: 'catalog-' + sha256Hex(canonicalize({items: ITEMS, beats: BEATS, places: PLACES, areas: NEIGHBORHOOD_AREAS})).slice(0, 12)});
}
export const MAX_REPLAY_SNAPSHOT_BYTES = 512 * 1024;
export const MAX_RUN_REPLAY_BYTES = 64 * 1024 * 1024;
