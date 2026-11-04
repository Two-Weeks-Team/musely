import {residentRhythm,residentLocalHour,residentSociability} from './resident-values.ts';
/** Public social availability. Never a location, calendar, reason or permission grant. */
import type {WorldState} from './world.ts';
import {hasActorHarness,harnessById} from './harness.ts';
import {BEATS} from './beats.ts';
export const SOCIAL_STATUSES = ['welcoming','busy','do_not_disturb'] as const;
export type SocialStatus = typeof SOCIAL_STATUSES[number];
export type SocialMode = 'auto' | SocialStatus;
export type Availability = {status:SocialStatus};
export type SocialWorld = Pick<WorldState,'muses'|'paused'>;
export const isSocialStatus=(v:unknown):v is SocialStatus=>typeof v==='string'&&(SOCIAL_STATUSES as readonly string[]).includes(v);
export const isSocialMode=(v:unknown):v is SocialMode=>v==='auto'||isSocialStatus(v);
// Only explicit catalog making/repair occupies a stationary Muse. A pending agreement is not processing.
const MAKING = new Set(['cafe_fix_gadget','repair','craft',...BEATS.filter(b=>b.result?.craft).map(b=>b.id)]);
export function resolveSocialStatus(world:SocialWorld,actorId:string,now:number,override:unknown='auto',residentValuesEnabled=false):SocialStatus {
 const actor=world.muses.find(m=>m.id===actorId);
 if(!actor||!Number.isSafeInteger(now)||now<0||!isSocialMode(override))return 'do_not_disturb';
 if(override!=='auto')return override; // The owner's explicit setting takes priority over activity defaults.
 if(world.paused?.[actorId])return 'do_not_disturb';
 if(actor.travel)return 'busy';
 if(actor.beat&&actor.beat.endsAt>now&&MAKING.has(actor.beat.id))return 'busy';
 // Daily rhythm changes resident-initiated tendencies, never willingness to receive conversation.
 return 'welcoming';
}
export function publicAvailability(world:SocialWorld,actorId:string,now:number,override:unknown='auto',residentValuesEnabled=false):Availability {
 return {status:resolveSocialStatus(world,actorId,now,override,residentValuesEnabled)};
}
/** A caller must still verify ownership, distance, stationary state, signatures and consent. */
export const interactionPolicy=(status:unknown):'approach'|'wave'|'none'=>status==='welcoming'?'approach':status==='busy'?'wave':'none';
/** Both sides retain control: an unavailable peer cannot be opened by the initiator's label. */
export function pairInteractionPolicy(a:unknown,b:unknown):'approach'|'wave'|'none' {
 const x=interactionPolicy(a),y=interactionPolicy(b);return x==='none'||y==='none'?'none':x==='wave'||y==='wave'?'wave':'approach';
}
/** Additional personal-peer approach weight, not an action, model response or authority decision. No clock gate. */
export function personalApproachProbability(world:SocialWorld,actorId:string,peerId:string,now:number,peerStatus?:SocialStatus,residentValuesEnabled=false):number {
 const actor=world.muses.find(m=>m.id===actorId),peer=world.muses.find(m=>m.id===peerId);
 if(!actor||!peer||actorId===peerId||actorId==='00-jolly'||actor.profile||actor.controlMode==='personal'||!hasActorHarness(actorId)
   ||world.paused?.[actorId]||!(peer.controlMode==='personal'||peer.profile?.actorId===peer.id||peer.id==='00-jolly')
   ||interactionPolicy(peerStatus??resolveSocialStatus(world,peerId,now))!=='approach')return 0;
 if(residentValuesEnabled===true){const probability=residentSociability(actorId);if(probability!==null){
  const hour=residentLocalHour(now),rhythm=hour===null?null:residentRhythm(actorId,hour);
  return probability*(rhythm?.moveMultiplier??1);
 }}
 const h=harnessById(actorId),social=h.persona.traits.includes('outgoing')||h.skills.includes('hosting')||h.persona.traits.includes('shared company');
 return social?0.45:0.15;
}
