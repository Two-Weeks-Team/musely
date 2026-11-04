/** Resident public speech only. No authority, model call, private memory, storage or world mutation. */
import type {WorldState} from './world.ts';
import {BEATS,inHours} from './beats.ts';
import {placeById} from './places.ts';
import {isRuntimeControlled} from './inbox.ts';
import {residentLocalHour,residentValues} from './resident-values.ts';
import {participantName} from './participants.ts';
import {hash32} from './rng.ts';

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


// Four authored variations for each confirmed persona, including distinct same-role residents.
// They invite conversation without claiming a meeting, an agreement or a successful activity.
const GREETINGS:Readonly<Record<string,readonly string[]>>={
 '01-sunny':['Good to see you, {name}. There is room here for you!','Welcome over, {name}! What would make this a good pause?','{name}, lovely to cross paths. Want some company?','A warm welcome, {name}. Settle in at your own pace.'],
 '02-moss':['Hello, {name}. A small pause can do a lot of good.','Good to see you, {name}. How are things growing?','{name}, take your time. I am glad to see you.','Hello there, {name}. Anything small you have noticed today?'],
 '03-ripple':['{name}! Which way has your curiosity taken you?','A familiar face on an interesting route, {name}!','{name}, found any corners worth a detour?','Good crossing paths, {name}. Where would you wander next?'],
 '04-ember':['There is room for your story, {name}.','{name}, a quiet moment can hold a good tale.','Good to see you, {name}. What story is on your mind?','Stay a moment if you like, {name}. No tale needs rushing.'],
 '05-bloom':['Hello, {name}. Company or a little quiet? Either is welcome.','Good to see you, {name}. No need to find the right words.','{name}, I can listen if you feel like talking.','Hello there, {name}. We can take this at your pace.'],
 '06-ink':['Hello, {name}. Any questions worth a footnote?','{name}, good to see you. I can offer a thought, not a lecture.','Hello, {name}. What have you been puzzling over?','{name}. A pleasant interruption; no citation required.'],
 '07-tempo':['{name}! What rhythm is your day keeping?','Good to see you, {name}! Got a tune on your mind?','{name}, there is room for another beat around here!','Hello, {name}! Want to trade a little good energy?'],
 '08-orbit':['Hello, {name}. Anything making you wonder today?','{name}, what small mystery has caught your eye?','Good to see you, {name}. I was leaving room for wonder.','Hello there, {name}. What would you look at a little longer?'],
 '09-copper':['Hello, {name}. Anything need a closer look?','{name}. How are things holding up?','Good to see you, {name}. Working on anything?','Hello, {name}. Got a practical puzzle?'],
 nr_alba:['Welcome, {name}. It is good to take a proper pause.','Good to see you, {name}. Would a little company suit you?','{name}, welcome back around. How are you keeping?','Hello, {name}. There is always time for a courteous hello.'],
 nr_olive:['Oh, {name}! What a lovely crossing of paths!','{name}! Fancy a completely unplanned little chat?','Hello, {name}! What new thing has your attention?','{name}, good timing! Shall we see where a chat takes us?'],
 nr_basil:['Hello, {name}. One thing at a time today.','{name}, good to see you. What comes next on your list?','Hello, {name}. Anything that needs steady attention?','Good to see you, {name}. A little order leaves room to talk.'],
 nr_juniper:['Hello, {name}. Have any little details caught your eye?','{name}, it is nice to share a quiet corner.','Good to see you, {name}. What color would you give this moment?','Hello there, {name}. Some things are lovelier at a slower pace.'],
 nr_cedar:['{name}! Any good shortcuts to compare?','Hey, {name}! What is worth a quick look?','{name}, good to run into you. Any fresh ideas?','Hey there, {name}! Where would you explore on a whim?'],
 nr_kite:['Hello, {name}. Comparing routes or taking a pause?','{name}, good to see you. What are you planning next?','Hello, {name}. Any path worth thinking through?','Good to see you, {name}. A pause can improve a plan.'],
 nr_dara:['{name}! You look like the start of a splendid conversation.','Hello, {name}! Shall we give this moment a plot twist?','{name}, what if a chance hello became a tiny story?','Oh, {name}! Any wonderfully unlikely ideas today?'],
 nr_rowan:['Hello, {name}. Is there a story you would like to remember?','Good to see you, {name}. Old stories leave room for new voices.','{name}, a quiet hello is worth keeping.','Hello there, {name}. What has stayed with you today?'],
 nr_ellis:['Hello, {name}. There is no hurry to say anything.','{name}, good to see you. Would being heard help today?','Hello, {name}. I have a little time to listen.','Good to see you, {name}. What would feel kind right now?'],
 nr_linden:['{name}, hello! How is your day treating you?','Good to see you, {name}! Anything I can lend an ear to?','Hello, {name}! A quick check-in, if you feel like one.','{name}, lovely to see a neighbor. How are you doing?'],
 nr_fable:['{name}! Read anything worth arguing about?','Hello, {name}. Got an opinion I should challenge?','{name}, good to see you. Any delightful contradictions today?','Hello there, {name}! A thought experiment for our next chat?'],
 nr_marlow:['Hello, {name}. Any reading to report?','{name}. Good to see you. What belongs on the reading list?','Hello, {name}. A brief conversation is easy to make room for.','Good to see you, {name}. Anything worth preserving today?'],
 nr_grove:['Hello, {name}. What sound has stayed with you?','{name}, good to see you. We can keep the tempo gentle.','Hello there, {name}. Any melody on your mind?','{name}, a quiet hello can have its own rhythm.'],
 nr_piper:['{name}! There is room for your rhythm here!','Hello, {name}! What could get a little chorus going?','{name}, good to see you! Fancy sharing a bit of cheer?','Hello there, {name}! Every voice can bring something different.'],
 nr_harbor:['Hello, {name}. Noticed anything worth recording?','{name}, good to see you. Any observations to compare?','Hello, {name}. What caught your attention, precisely?','Good to see you, {name}. Questions before conclusions.'],
 nr_nova:['Oh, {name}! Anything wonderful caught your eye?','{name}! What would you love to take a closer look at?','Hello, {name}! There is so much to wonder about.','{name}, good to see you! Got a small discovery to share?'],
 nr_indigo:['{name}! Any odd little problem we could think about?','Hello, {name}! What would you try making differently?','{name}, good to see you. Any experiments on your mind?','Hello there, {name}! A curious detail can start an invention.'],
};
/** Select before public emission AND inbox delivery. Reuse committed public speech and this transaction's
 * pending events; no hidden repeat state, snapshot field or model call is introduced. Separate seeded
 * choice leaves the meeting/trade random stream untouched. An exhausted set is silence, never a repeat.
 */
export function ruleResidentGreeting(s:WorldState,id:string,to:string,now:number,recent:readonly PublicUtterance[]):string|null {
 if(!clock(now)||id===to||s.muses.filter(m=>m.id===id).length!==1||s.muses.filter(m=>m.id===to).length!==1||!residentSpeaker(s,id,now)||s.paused?.[id]||s.paused?.[to])return null;
 const variants=GREETINGS[id];if(!variants)return null;
 let name:string;try{name=participantName(s,to);}catch{return null;}
 const start=hash32(JSON.stringify([s.seed,s.tick,id,to,'resident-greeting']))%variants.length;
 for(let i=0;i<variants.length;i++){
  const line=variants[(start+i)%variants.length].replace('{name}',()=>name);
  if(filterResidentUtterance(s,id,line,now,recent).line!==null)return line;
 }
 return null;
}
