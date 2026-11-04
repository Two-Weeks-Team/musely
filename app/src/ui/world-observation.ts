// Read-only transport evidence travels with the cached world through pause, startup and failed polls.
// The business tick clock must not be used as the time at which an HTTP response was observed.
import {acceptsSnapshot, type LiveWorld} from './live-scene-core.ts';
import type {Fetched} from './resource-state.ts';
export type WorldObservation<T extends LiveWorld> = {world: T; observedAt: number};
export function observeWorld<T extends LiveWorld>(current: WorldObservation<T> | null, result: Fetched<T>): WorldObservation<T> | null {
  return result.ok && Number.isFinite(result.at) && acceptsSnapshot(current?.world ?? null, result.data)
    ? {world: result.data, observedAt: result.at}
    : current;
}
