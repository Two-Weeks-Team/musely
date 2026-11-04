import {presentationIn, type ProfileMuse} from './personal-profile.ts';
import type {ActorFrame,LiveEvent,LiveWorld} from './live-scene-core.ts';
type PublicWorld={muses:readonly ProfileMuse[]};
/** Explicit public addressee only: never infer one from speech, a destination or an animation partner. */
export function speechRecipient(event:Pick<LiveEvent,'muse'|'other'|'line'|'data'>,world?:PublicWorld|null):{id:string;name:string}|null {
 if(typeof event.line!=='string'||!event.line.trim())return null;
 const id=event.other??event.data?.target_agent;
 if(typeof id!=='string'||!id||id===event.muse||!world?.muses.some(m=>m.id===id))return null;
 const p=presentationIn(id,world);
 return p.kind==='unknown'?null:{id,name:p.name};
}
export function frameSpeech(frame:ActorFrame|undefined,world:LiveWorld|null|undefined,events:readonly LiveEvent[]):{text:string;recipient:string|null}|null {
 if(!frame?.line)return null;
 const event=frame.cue?events.find(e=>e.id===frame.cue!.eventId&&e.muse===frame.id):undefined;
 const recipient=event?speechRecipient(event,world)?.name??null:null;
 return{text:recipient?`→ ${recipient}: ${frame.line}`:frame.line,recipient};
}
/** Literal text. The alternate label gives the arrow a spoken meaning in both languages. */
export function paintFrameSpeech(node:HTMLElement,frame:ActorFrame|undefined,world:LiveWorld|null|undefined,events:readonly LiveEvent[],fallback:string):void {
 const speech=frameSpeech(frame,world,events);
 node.textContent=speech?.text??fallback;
 if(speech?.recipient){
  // Child content is cleared by the existing Story textContent assignment too: no stale spoken addressee.
  const visible=node.ownerDocument.createElement('span'),spoken=node.ownerDocument.createElement('span');
  visible.setAttribute('aria-hidden','true');visible.textContent=speech.text;
  spoken.className='speech-address-a11y';spoken.textContent=`To ${speech.recipient} / ${speech.recipient}에게: ${frame!.line}`;
  node.replaceChildren(visible,spoken);
 }
}
