// Public actor identity is separate from reusable appearance and from every private owner/key reference.
import type {WorldState} from './world.ts';
import {hasActorHarness,harnessById} from './harness.ts';
import {MUSE_VARIANTS} from '../character-kit/catalog.ts';
import type {ActorProfile} from '../identity/participant.ts';
export function actorProfile(value: unknown, actorId: string): ActorProfile {
 const p=value as ActorProfile;
 if(!p||typeof p!=='object'||Array.isArray(p)||p.actorId!==actorId||typeof p.displayName!=='string'||!p.displayName.trim()||[...p.displayName].length>40||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(p.displayName)||!MUSE_VARIANTS.some(v=>v.id===p.appearanceId)||!Number.isSafeInteger(p.revision)||p.revision<1)throw Error('invalid_actor_profile');
 return{actorId:p.actorId,displayName:p.displayName,appearanceId:p.appearanceId,revision:p.revision};
}
export function admitPersonal(s:WorldState,profile:ActorProfile,at:number):boolean{
 const p=actorProfile(profile,profile.actorId);
 if(!/^pm_[a-f0-9-]{36}$/.test(p.actorId))throw Error('invalid_personal_actor');
 const old=s.muses.find(m=>m.id===p.actorId);
 if(old){if(old.controlMode!=='personal'||!old.profile)throw Error('actor_conflict');
 return false;
 }
 s.muses.push({id:p.actorId,profile:p,controlMode:'personal',place:'commons:benches',travel:null,beat:null,inventory:[],memory:[],reflection:'',lastMet:{},intent:null,wants:{goal:'',items:[],source:'connected',updatedAt:at}});
 return true;
}
export function participantName(s:WorldState,id:string):string{const m=s.muses.find(m=>m.id===id);
 if(m?.profile)return actorProfile(m.profile,id).displayName;
 if(hasActorHarness(id))return harnessById(id).name;
 if(m)return 'Visiting Muse';
 throw Error('unknown_actor');
 }
export function participantRole(s:WorldState,id:string):string|null{const m=s.muses.find(m=>m.id===id);
 if(m?.profile)return'Personal Muse';
 return hasActorHarness(id)?harnessById(id).role:null;
 }
export function participantLikes(s:WorldState,id:string):readonly string[]{const m=s.muses.find(m=>m.id===id);
 if(!hasActorHarness(id))return[];
 return harnessById(id).persona.likes;
 }

