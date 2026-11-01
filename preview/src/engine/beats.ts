// Beat library (direction v2, 8.1): "condition → action bundle → result" fragments the scenario
// engine combines across 10 characters × real places × items × company × time of day.
import type {PlaceKind} from './places.ts';

export type Beat = {
  id: string;
  /** Where the beat can happen. */
  kinds: readonly PlaceKind[];
  /** Local hours [from, to) in America/Los_Angeles; wraps past midnight when from > to. */
  hours?: readonly [number, number];
  /** Muse ids that prefer this beat (weight ×3); others may still do it. */
  roles?: readonly string[];
  /** Items required to start (all). */
  needs?: readonly string[];
  /** Body clip sequence; the runtime plays the first available clip (new clips fall back to the listed shared one). */
  clips: readonly string[];
  minutes: number;
  /** Short public line shown in a bubble. `{place}` and `{other}` are filled in. */
  line?: string;
  /** Effects applied when the beat completes. */
  result?: {consume?: readonly string[]; craft?: string; mood?: number};
  weight?: number;
};

export const BEATS: readonly Beat[] = [
  // Cafes
  {id: 'cafe_order', kinds: ['cafe'], hours: [7, 18], clips: ['talk', 'offer_item'], minutes: 6, line: 'One coffee, please.'},
  {id: 'cafe_drink', kinds: ['cafe'], hours: [7, 19], clips: ['drink', 'sit_idle'], minutes: 15, line: 'A slow sip at {place}.'},
  {id: 'cafe_people_watch', kinds: ['cafe'], clips: ['sit_idle', 'look_around'], minutes: 12, roles: ['03-ripple', '05-bloom']},
  {id: 'cafe_save_seat', kinds: ['cafe'], clips: ['sit_down', 'wave'], minutes: 5, roles: ['01-sunny'], line: 'Saved you a seat!'},
  {id: 'cafe_fix_gadget', kinds: ['cafe', 'workbench'], clips: ['inspect_gadget'], minutes: 18, roles: ['09-copper'], line: 'Something here needs fixing.'},
  // Bus stops
  {id: 'bus_wait', kinds: ['bus_stop'], hours: [6, 22], clips: ['idle_breathe', 'look_around'], minutes: 8},
  {id: 'bus_timetable', kinds: ['bus_stop'], clips: ['inspect_map'], minutes: 5, roles: ['03-ripple'], line: 'Next bus in four minutes.'},
  {id: 'bus_ride', kinds: ['bus_stop'], needs: ['transit_pass'], clips: ['board', 'sit_idle'], minutes: 10, line: 'Riding the line with my Transit Pass.'},
  // Parks and the garden
  {id: 'garden_water', kinds: ['garden', 'park'], hours: [6, 20], clips: ['water_plants'], minutes: 15, roles: ['02-moss'], line: 'Little sprouts, drink up.'},
  {id: 'garden_plant', kinds: ['garden', 'park'], needs: ['clover_seed', 'garden_pass'], clips: ['plant', 'think'], minutes: 12, roles: ['02-moss'], result: {consume: ['clover_seed'], craft: 'bloom'}, line: 'A Bloom will grow right here.'},
  {id: 'park_bench_rest', kinds: ['park', 'benches', 'playground'], clips: ['sit_down', 'sit_idle', 'stand_up'], minutes: 14},
  {id: 'park_stretch', kinds: ['park', 'playground'], hours: [6, 11], clips: ['stretch', 'idle_breathe'], minutes: 6},
  {id: 'park_feed_birds', kinds: ['park'], hours: [7, 17], clips: ['feed_birds', 'offer_item'], minutes: 8, roles: ['05-bloom', '02-moss']},
  {id: 'park_pick_flower', kinds: ['park', 'garden'], hours: [8, 18], clips: ['pick_up', 'celebrate'], minutes: 4, line: 'A wildflower for later.'},
  // Food
  {id: 'eat_together', kinds: ['restaurant', 'fast_food'], hours: [11, 21], clips: ['sit_down', 'talk'], minutes: 25, line: 'Sharing a table at {place}.'},
  {id: 'eat_snack', kinds: ['fast_food', 'ice_cream'], hours: [10, 22], clips: ['eat', 'celebrate'], minutes: 10},
  {id: 'praise_food', kinds: ['restaurant'], clips: ['celebrate'], minutes: 3, roles: ['01-sunny', '04-ember'], line: 'This is wonderful!'},
  // Convenience
  {id: 'pick_snack', kinds: ['convenience'], clips: ['look_around', 'think'], minutes: 5},
  {id: 'carry_home', kinds: ['convenience'], clips: ['carry_walk'], minutes: 4},
  // Books and libraries
  {id: 'read', kinds: ['library', 'bookshelf'], clips: ['read_book'], minutes: 25, roles: ['06-ink'], line: 'Just one more chapter.'},
  {id: 'browse_shelves', kinds: ['library', 'bookshelf'], clips: ['look_around', 'think'], minutes: 8},
  {id: 'recommend_book', kinds: ['library', 'bookshelf', 'cafe'], clips: ['offer_item', 'talk'], minutes: 6, roles: ['06-ink'], line: 'You would like this one.'},
  {id: 'write_note', kinds: ['library', 'cafe', 'benches'], clips: ['write_note', 'think'], minutes: 7, roles: ['06-ink', '05-bloom']},
  // Music
  {id: 'music_bounce', kinds: ['bookshelf', 'campfire', 'park'], clips: ['music_bounce'], minutes: 10, roles: ['07-tempo'], line: 'Feel that beat?'},
  {id: 'listen_music', kinds: ['bookshelf', 'campfire'], clips: ['listen'], minutes: 8},
  {id: 'dance', kinds: ['campfire', 'park'], hours: [17, 23], clips: ['dance', 'music_bounce'], minutes: 6, roles: ['07-tempo']},
  // Landmark and stories
  {id: 'tell_story', kinds: ['campfire', 'landmark'], hours: [16, 24], clips: ['tell_story'], minutes: 15, roles: ['04-ember'], line: 'Gather round, this one is old.'},
  {id: 'route_plan', kinds: ['landmark', 'bus_stop', 'benches'], clips: ['inspect_map', 'think'], minutes: 6, roles: ['03-ripple']},
  {id: 'take_photo', kinds: ['landmark', 'park'], clips: ['photo', 'celebrate'], minutes: 3},
  {id: 'carry_lantern', kinds: ['landmark', 'campfire'], hours: [18, 24], clips: ['lantern_hold', 'walk'], minutes: 8, roles: ['04-ember']},
  // Night sky
  {id: 'observe_sky', kinds: ['park', 'landmark', 'benches'], hours: [19, 3], clips: ['observe_sky'], minutes: 18, roles: ['08-orbit'], line: 'There — Vega.'},
  {id: 'yawn', kinds: ['benches', 'campfire'], hours: [21, 2], clips: ['yawn', 'sit_idle'], minutes: 5},
  // Making and fixing
  {id: 'repair', kinds: ['workbench'], clips: ['hammer', 'inspect_gadget'], minutes: 16, roles: ['09-copper'], line: 'Tap, tap — good as new.'},
  {id: 'craft', kinds: ['workbench'], clips: ['think', 'inspect_gadget'], minutes: 12, roles: ['09-copper']},
  // Greetings and the campfire
  {id: 'welcome', kinds: ['campfire', 'cafe', 'benches'], clips: ['welcome_neighbors'], minutes: 4, roles: ['01-sunny'], line: 'Welcome, neighbor!'},
  {id: 'reassure', kinds: ['benches', 'garden', 'cafe'], clips: ['reassure'], minutes: 8, roles: ['05-bloom']},
  {id: 'campfire_sit', kinds: ['campfire'], hours: [17, 24], clips: ['sit_down', 'sit_idle'], minutes: 20, line: 'The fire is warm tonight.'},
  {id: 'look_around', kinds: ['campfire', 'benches', 'garden', 'cafe', 'park', 'bus_stop', 'landmark'], clips: ['look_around', 'idle_breathe'], minutes: 5, weight: .6},
  // Bay activity places (far map)
  {id: 'bay_activity', kinds: ['region'], clips: ['celebrate'], minutes: 40, line: 'Exploring {place}.'},
];

/**
 * Fallbacks for beat clips the shared rig does not ship yet: clip -> closest shipped clip.
 * Since task 5b every beat clip exists in character-kit/runtime/base/lod0.glb, so this is empty;
 * scripts/beat-clips.test.mjs fails if a beat names a clip that is neither shipped nor mapped here.
 */
export const CLIP_FALLBACK: Record<string, string> = {};

export const inHours = (b: Beat, hour: number) => {
  if (!b.hours) return true;
  const [from, to] = b.hours;
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to % 24;
};
