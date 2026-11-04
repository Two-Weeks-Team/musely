/** Resident public speech only. No authority, model call, private memory, storage or world mutation. */
import type {WorldState} from './world.ts';
import {BEATS,inHours} from './beats.ts';
import {placeById} from './places.ts';
import {isRuntimeControlled} from './inbox.ts';
import {residentLocalHour,residentValues} from './resident-values.ts';

export const RESIDENT_LINE_COOLDOWN_MS=30*60_000;
export type PublicUtterance=Readonly<{muse:string|null;at:number;line:string|null}>;
export type UtteranceDecision=Readonly<{line:string|null;reason:'resident_line_repeat'|null}>;
// Each voice follows the confirmed fictional persona. These are attitudes, not claims about peers or outcomes.
const VOICE:Readonly<Record<string,string>>={
 '01-sunny':'Come along at your own pace.',
 '02-moss':'One small step, done with care.',
 '03-ripple':'A little pause; the next route can wait.',
 '04-ember':"I'll give this moment a little room.",
 '05-bloom':'No hurry; quiet is welcome here.',
 '06-ink':'A brief pause. No footnotes required.',
 '07-tempo':"Easy now—there's a rhythm to a pause.",
 '08-orbit':'A quiet moment leaves room to wonder.',
 '09-copper':'Slow enough to check the details.',
 nr_alba:"Let's take a proper, unhurried moment.",
 nr_olive:'Oh, a small pause could be lovely!',
 nr_basil:'One thing at a time, in order.',
 nr_juniper:'A soft pause; let the details settle.',
 nr_cedar:"Quick look. Then I'll see what's next.",
 nr_kite:'Pause first; the next step can wait.',
 nr_dara:'A pause can hold the start of a story.',
 nr_rowan:"I'll keep this quiet moment in mind.",
 nr_ellis:'A little quiet can be enough.',
 nr_linden:'A little care makes room for a pause.',
 nr_fable:'A pause—an argument I can support.',
 nr_marlow:'A pause. Filed under useful.',
 nr_grove:'A soft beat, without a hurry.',
 nr_piper:'A little breathing room before the next beat!',
 nr_harbor:"Pause. Look carefully; record only what's there.",
 nr_nova:"Oh, there's always room for a closer look!",
 nr_indigo:"Let's pause and look for a useful detail.",
};
// Present activity only: no named star, bus ETA, invented audience, successful repair, find or trade.
const ACTIVITY:Readonly<Record<string,string>>={
 cafe_order:'Taking time to order coffee.',cafe_drink:'Taking a slow drink.',cafe_people_watch:'Looking around the cafe.',
 cafe_save_seat:'Taking a seat.',cafe_fix_gadget:'Looking closely at a gadget.',bus_wait:'Waiting at the bus stop.',
 bus_timetable:'Looking over the route.',bus_ride:'Taking time for the ride.',garden_water:'Tending the plants.',
 garden_plant:'Working on a garden spot.',park_bench_rest:'Resting here.',park_stretch:'Taking time to stretch.',
 park_feed_birds:'Taking time near the birds.',park_pick_flower:'Looking among the flowers.',eat_together:'Taking time for a meal.',
 eat_snack:'Taking time for a snack.',praise_food:'Enjoying a pause over food.',pick_snack:'Looking over the snacks.',
 carry_home:'Taking time with the things to carry.',read:'Taking time to read.',browse_shelves:'Looking along the shelves.',
 recommend_book:'Thinking about a book recommendation.',write_note:'Taking time to write a note.',music_bounce:'Moving with the rhythm.',
 listen_music:'Taking time to listen.',dance:'Taking time to dance.',tell_story:'Taking time for a story.',
 route_plan:'Looking over a possible route.',take_photo:'Looking for a view to frame.',carry_lantern:'Taking time with the lantern.',
 observe_sky:'Looking at the sky.',yawn:'Taking a sleepy pause.',night_pass_stargaze:'Taking time to look at the night sky.',
 repair:'Working carefully on a repair.',craft:'Taking time to make something.',welcome:'Taking a welcoming pause.',
 reassure:'Taking a gentle pause.',campfire_sit:'Sitting by the campfire.',look_around:'Looking around here.',bay_activity:'Exploring this place.',
};
const clock=(at:number)=>Number.isFinite(at)&&at>=0&&at<=Number.MAX_SAFE_INTEGER;
function residentSpeaker(s:WorldState,id:string,now:number):boolean {
 const m=s.muses.find(m=>m.id===id);
 return !!m&&!!residentValues(id)&&!m.profile&&m.controlMode!=='personal'&&!isRuntimeControlled(s,id,now);
}
/** Caller must use this only when actually starting the validated activity; it never starts one itself. */
export function ruleResidentUtterance(s:WorldState,id:string,beatId:string,now:number):string|null {
 if(!clock(now)||!residentSpeaker(s,id,now)||!VOICE[id]||s.paused?.[id])return null;
 const m=s.muses.find(m=>m.id===id)!,beat=BEATS.find(b=>b.id===beatId),hour=residentLocalHour(now);
 if(!beat||!ACTIVITY[beatId]||hour===null||m.travel)return null;
 try{if(!beat.kinds.includes(placeById(m.place).kind)||!inHours(beat,hour)||(beat.needs??[]).some(x=>!m.inventory.includes(x)))return null;}
 catch{return null;}
 return `${VOICE[id]} ${ACTIVITY[beatId]}`;
}
const normalize=(line:string)=>line.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
/**
 * Give the complete last-30-minute committed public speech plus earlier emissions from this same transaction.
 * Reuse that existing event ledger across restarts; no new cooldown state/API is needed. Apply only to new
 * resident emissions, never historical replay. A repeated LIVE line becomes silence, never a RULE rewrite.
 * The caller retains the action, timing, source and provider evidence; connected/personal speech is untouched.
 * Filter once per logical utterance, then share that decision with its spotlight/beat/UI representations.
 * Do not refilter those companion events against each other or count each one as a separate spoken line.
 */
export function filterResidentUtterance(s:WorldState,id:string,line:string|null,now:number,recent:readonly PublicUtterance[]):UtteranceDecision {
 if(!clock(now))return{line:null,reason:null};
 if(!residentSpeaker(s,id,now))return{line,reason:null};
 if(line===null||!normalize(line))return{line:null,reason:null};
 const key=normalize(line);
 return recent.some(e=>e.muse===id&&clock(e.at)&&e.at>now-RESIDENT_LINE_COOLDOWN_MS&&e.at<=now&&typeof e.line==='string'&&normalize(e.line)===key)?{line:null,reason:'resident_line_repeat'}:{line,reason:null};
}
