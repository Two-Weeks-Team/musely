/** Public social availability. Never a location, calendar, reason or permission grant. */
import type {WorldState} from './world.ts';
import {hasActorHarness,harnessById} from './harness.ts';
export const SOCIAL_STATUSES = ['welcoming','busy','do_not_disturb'] as const;
export type SocialStatus = typeof SOCIAL_STATUSES[number];
export type SocialMode = 'auto' | SocialStatus;
export type Availability = {status:SocialStatus};
export type SocialWorld = Pick<WorldState,'muses'|'paused'>;
export const isSocialStatus=(v:unknown):v is SocialStatus=>typeof v==='string'&&(SOCIAL_STATUSES as readonly string[]).includes(v);
export const isSocialMode=(v:unknown):v is SocialMode=>v==='auto'||isSocialStatus(v);
// Existing catalog rest/social beats. Unknown future activities remain busy, never implicitly open.
const REST = new Set(['cafe_drink','cafe_people_watch','cafe_save_seat','park_bench_rest','eat_together','eat_snack',
 'resident_stay','listen_music','observe_sky','night_pass_stargaze','campfire_sit','look_around','welcome','reassure']);
export function resolveSocialStatus(world:SocialWorld,actorId:string,now:number,override:unknown='auto'):SocialStatus {
 const actor=world.muses.find(m=>m.id===actorId);
 if(!actor||!Number.isSafeInteger(now)||now<0||!isSocialMode(override))return 'do_not_disturb';
 if(override!=='auto')return override; // The owner's explicit setting takes priority over activity defaults.
 if(world.paused?.[actorId])return 'do_not_disturb';
 if(actor.travel)return 'busy';
 if(actor.beat&&actor.beat.endsAt>now&&!REST.has(actor.beat.id))return 'busy';
 return 'welcoming';
}
export function publicAvailability(world:SocialWorld,actorId:string,now:number,override:unknown='auto'):Availability {
 return {status:resolveSocialStatus(world,actorId,now,override)};
}
/** A caller must still verify ownership, distance, stationary state, signatures and consent. */
export const interactionPolicy=(status:unknown):'approach'|'wave'|'none'=>status==='welcoming'?'approach':status==='busy'?'wave':'none';
/** Both sides retain control: an unavailable peer cannot be opened by the initiator's label. */
export function pairInteractionPolicy(a:unknown,b:unknown):'approach'|'wave'|'none' {
 const x=interactionPolicy(a),y=interactionPolicy(b);return x==='none'||y==='none'?'none':x==='wave'||y==='wave'?'wave':'approach';
}
/** Additional personal-peer approach weight, not an action, model response or authority decision. No clock gate. */
export function personalApproachProbability(world:SocialWorld,actorId:string,peerId:string,now:number,peerStatus?:SocialStatus):number {
 const actor=world.muses.find(m=>m.id===actorId),peer=world.muses.find(m=>m.id===peerId);
 if(!actor||!peer||actorId===peerId||actorId==='00-jolly'||actor.profile||actor.controlMode==='personal'||!hasActorHarness(actorId)
   ||world.paused?.[actorId]||!(peer.controlMode==='personal'||peer.profile?.actorId===peer.id||peer.id==='00-jolly')
   ||interactionPolicy(peerStatus??resolveSocialStatus(world,peerId,now))!=='approach')return 0;
 const h=harnessById(actorId),social=h.persona.traits.includes('outgoing')||h.skills.includes('hosting')||h.persona.traits.includes('shared company');
 return social?0.45:0.15;
}
