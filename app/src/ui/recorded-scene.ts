// One renderer, independent projection stores. Replay seeks never rewind or replace the live cache.
import type {RecordedFrame} from '../replay/player.ts';
import {LiveProjection, type LiveWorld, type LiveEvent, type ActorFrame} from './live-scene-core.ts';
export function recordedSceneFrame(frame: RecordedFrame): {world: LiveWorld; events: LiveEvent[]} {
  const state = frame.publicState;
  // Public checkpoints intentionally hash these strings. Neither hashes nor static harness text are dialogue.
  const world: LiveWorld = {worldId: frame.worldId, day: state.day, tick: state.tick, version: state.version, lastTickAt: state.lastTickAt,
    muses: state.muses.map((m: LiveWorld['muses'][number]) => ({id: m.id, place: m.place, travel: m.travel ? {...m.travel} : null,
      beat: m.beat ? {...m.beat, line: null} : null, inventory: [...m.inventory], paused: state.paused?.[m.id] ?? null}))};
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
    const key = `${frame.runId}:${frame.snapshotHash}:${frame.inputs.at(-1)?.seq ?? 0}:${frame.events.at(-1)?.seq ?? 0}`;
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

export function frameSource(projection: LiveProjection, frame: ActorFrame | undefined, id: string) {
  const cueEvent = frame?.cue ? projection.events.find(e => e.id === frame.cue!.eventId) : null;
  if (cueEvent?.source) return cueEvent.source;
  const muse=projection.world?.muses.find(m=>m.id===id);
  const action=[...projection.events].reverse().find(e=>e.muse===id&&(
    frame?.travel&&muse?.travel&&e.kind==='depart'&&e.at===muse.travel.departAt&&e.data?.to===muse.travel.to ||
    frame?.beat&&muse?.beat&&e.kind==='beat'&&e.at===muse.beat.startedAt&&e.data?.beat===frame.beat));
  return action?.source ?? 'waiting';
}

export function sceneModeLabel(recorded:boolean,language='en'){
  return language.startsWith('ko')?(recorded?'기록된 세계':'실시간 세계'):(recorded?'Recorded world':'Live world');
}
export function actionSourceLabel(source:string,recorded:boolean,language='en'){
  const known=['live','rule','scripted','replay'].includes(source);
  if(language.startsWith('ko'))return known?`${recorded?'기록된 행동':'행동'} 출처 · ${source.toUpperCase()}`:'행동 출처 정보 없음';
  return known?`${recorded?'Recorded action':'Action'} source · ${source.toUpperCase()}`:'Action source unavailable';
}
