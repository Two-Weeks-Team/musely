// One renderer, independent projection stores. Replay seeks never rewind or replace the live cache.
import type {RecordedFrame} from '../replay/player.ts';
import {LiveProjection, type LiveWorld, type LiveEvent} from './live-scene-core.ts';
export function recordedSceneFrame(frame: RecordedFrame): {world: LiveWorld; events: LiveEvent[]} {
  const state = frame.publicState;
  // Public checkpoints intentionally hash these strings. Neither hashes nor static harness text are dialogue.
  const world: LiveWorld = {worldId: frame.worldId, day: state.day, tick: state.tick, version: state.version, lastTickAt: state.lastTickAt,
    muses: state.muses.map((m: LiveWorld['muses'][number]) => ({id: m.id, place: m.place, travel: m.travel ? {...m.travel} : null,
      beat: m.beat ? {...m.beat, line: null} : null, inventory: [...m.inventory], paused: m.paused}))};
  return {world, events: structuredClone(frame.events)};
}
export class SceneProjection {
  readonly live = new LiveProjection();
  private recorded: LiveProjection | null = null;
  private key: string | null = null;
  private at: number | null = null;
  accept(world: LiveWorld, events: readonly LiveEvent[]) {return this.live.accept(world, events);}
  setRecordedFrame(frame: RecordedFrame | null) {
    if (!frame) {this.recorded = null; this.key = null; this.at = null; return;}
    const key = frame.runId + ':' + frame.snapshotHash;
    if (key !== this.key) {
      this.recorded = new LiveProjection();
      const view = recordedSceneFrame(frame);
      this.recorded.accept(view.world, view.events);
      this.key = key;
    }
    this.at = frame.recordedAt;
  }
  get projection() {return this.recorded ?? this.live;}
  get replay() {return this.recorded !== null;}
  get recordedAt() {return this.at;}
}
