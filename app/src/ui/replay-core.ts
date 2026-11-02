import type {AutoEvent} from './autonomy.ts';

export const SPEEDS = [1, 10, 60] as const;
export type Speed = typeof SPEEDS[number];
export type ReplayEvent = AutoEvent & {seq: number; tick: number; t: number; place?: string | null; line?: string | null; fixture: true};
export type ReplayRun = {label: string; note: string; worldId: string; runId: string; day: string; startAt: number; durationSec: number; events: ReplayEvent[]};
export type ReplayState = {cursor: number; playing: boolean; speed: Speed; durationSec: number; ended: boolean};

export function createPlayer(durationSec: number, _now?: () => number) {
  const duration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const state: ReplayState = {cursor: 0, playing: false, speed: 1, durationSec: duration, ended: duration === 0};
  const clamp = (t: number) => Math.max(0, Math.min(duration, Number.isNaN(t) ? 0 : t));
  return {
    getState(): ReplayState { return {...state}; },
    play() { if (state.ended) state.cursor = 0; state.ended = duration === 0; state.playing = !state.ended; },
    pause() { state.playing = false; },
    setSpeed(s: Speed) { if (SPEEDS.includes(s)) state.speed = s; },
    seek(t: number) { state.cursor = clamp(t); state.ended = state.cursor >= duration; if (state.ended) state.playing = false; },
    restart() { state.cursor = 0; state.ended = duration === 0; state.playing = false; },
    advance(dtMs: number) {
      if (!state.playing || !Number.isFinite(dtMs) || dtMs <= 0) return;
      state.cursor = clamp(state.cursor + dtMs / 1000 * state.speed);
      state.ended = state.cursor >= duration;
      if (state.ended) state.playing = false;
    },
  };
}

export type Filter = {tag: string; muse: string; place: string; part: '' | 'night' | 'morning' | 'afternoon' | 'evening'};
export const EMPTY_FILTER: Filter = Object.freeze({tag: '', muse: '', place: '', part: ''});
/** Hour of the day as the viewer sees it: their own time zone unless one is given (tests pass one). */
const hourIn = (tz?: string) => new Intl.DateTimeFormat('en-US', {...(tz ? {timeZone: tz} : {}), hour: 'numeric', hourCycle: 'h23'});
export function matchFilter(e: Pick<ReplayEvent, 'tags' | 'muse' | 'other' | 'place' | 'at'>, f: Filter, tz?: string): boolean {
  if (f.tag && !e.tags.includes(f.tag) || f.muse && e.muse !== f.muse && e.other !== f.muse || f.place && e.place !== f.place) return false;
  if (f.part) {
    const h = Number(hourIn(tz).format(e.at));
    const part = h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
    if (f.part !== part) return false;
  }
  return true;
}
export function visibleEvents(events: ReplayEvent[], cursor: number): ReplayEvent[] { return events.filter(e => e.t <= cursor); }
export function formatT(sec: number): string {
  const t = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
