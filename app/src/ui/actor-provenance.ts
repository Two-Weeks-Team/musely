// Pure projection of trusted public server events, not a signature verifier or a runtime-presence claim.
import type {ActorFrame,LiveEvent,LiveWorld} from './live-scene-core.ts';
export type ActionProvenance={source:'connected'|'live'|'rule'|'scripted'|'replay';scope:'current_action'|'recent_action';basis:'cue'|'travel'|'beat'|'event';eventId:string;eventKind:string;at:number};
const ACTIONS=new Set(['depart','beat','spotlight','encounter_reply','greet','trade_proposed','trade_countered','trade_rejected','trade_completed','gift','postcard_sent','discover','craft','wants_updated','meetup_proposed','meetup_answer','meetup_candidate','help_requested','help_rejected','help_input_provided','help_completed','campfire_invite','campfire_invite_answer','resident_wave','wave']);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
/** Result events may name the proposer/recipient rather than the actor who chose the recorded result.
 * A trade's source belongs to accepted_by. Missing or inconsistent receipts have no single-actor label.
 * Automatic arrivals/delivery, group attendance and joint owner approvals are excluded above.
 */
function actingMuse(e:LiveEvent):string|null {
 if(!ACTIONS.has(e.kind))return null;
 if(e.kind==='trade_completed')return text(e.data?.accepted_by)&&e.data.accepted_by===e.other&&e.other!==e.muse&&e.data.accepted_via===e.source&&(e.source==='live'||e.source==='rule')?e.data.accepted_by:null;
 if(e.kind==='help_completed'&&(e.data?.accepted_by!==e.muse||e.data?.accepted_via!==e.source))return null;
 return text(e.muse)?e.muse:null;
}

function provenance(e:LiveEvent,scope:ActionProvenance['scope'],basis:ActionProvenance['basis']):ActionProvenance|null {
 if(!text(e.id)||!Number.isFinite(e.at)||e.at<0||!ACTIONS.has(e.kind))return null;
 let source:ActionProvenance['source'];
 switch(e.source){case 'live':case 'rule':case 'scripted':case 'replay':source=e.source;break;default:return null;}
 if(source==='live'&&e.data?.actorOrigin==='connected'){
  // Public events carry envelopeEvidence, unlike the response-only envelope.verified flag.
  // This checks that the recorded command attribution is present; it never asserts independent crypto verification.
  const p=e.data.envelope;
  if(!p||typeof p!=='object'||!['browser','server_custodial','server_heartbeat'].includes(p.signer_kind)||!['message_id','agent_id','delegation_ref','scope','content_hash'].every(k=>text(p[k])))return null;
  source='connected';
 }
 return{source,scope,basis,eventId:e.id,eventKind:e.kind,at:e.at};
}
/** Current visual action only. A receiver/listener cue is not a command chosen by that actor. */
export function actorProvenance({actorId,world,frame,events}:{actorId:string;world:Pick<LiveWorld,'muses'>|null;frame:Pick<ActorFrame,'id'|'cue'|'travel'|'beat'>|undefined;events:readonly LiveEvent[]}):ActionProvenance|null {
 const actor=world?.muses.find(m=>m.id===actorId);if(!actor||!frame||frame.id!==actorId)return null;
 if(frame.cue){const e=events.find(e=>e.id===frame.cue!.eventId&&e.kind===frame.cue!.kind&&actingMuse(e)===actorId);return e?provenance(e,'current_action','cue'):null;}
 const matches=events.filter(e=>actingMuse(e)===actorId&&(
  frame.travel&&actor.travel&&frame.travel.to===actor.travel.to&&e.kind==='depart'&&e.at===actor.travel.departAt&&e.data?.to===actor.travel.to||
  frame.beat&&actor.beat&&frame.beat===actor.beat.id&&e.kind==='beat'&&e.at===actor.beat.startedAt&&e.data?.beat===frame.beat));
 const e=matches.at(-1);return e?provenance(e,'current_action',e.kind==='depart'?'travel':'beat'):null;
}
/** Latest loaded connected action, never current presence/control. Replay callers bound this by recordedAt. */
export function recentConnectedAction(actorId:string,events:readonly LiveEvent[],notAfter=Infinity):ActionProvenance|null {
 if(notAfter!==Infinity&&(!Number.isFinite(notAfter)||notAfter<0))return null;
 const es=events.filter(e=>actingMuse(e)===actorId&&e.at<=notAfter).slice().sort((a,b)=>typeof a.seq==='number'&&typeof b.seq==='number'?b.seq-a.seq:b.at-a.at);
 for(const e of es){const p=provenance(e,'recent_action','event');if(p?.source==='connected')return p;}
 return null;
}
