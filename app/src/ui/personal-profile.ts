// Presentation only: server public profile -> existing appearance; no ownership/authentication decisions.
import {HARNESSES} from '../engine/harness.ts';
import {MUSE_VARIANTS, type MuseVariantId} from '../character-kit/catalog.ts';
import type {ActorProfile} from '../identity/participant.ts';
export type ProfileMuse = {id: string; profile?: unknown};
export type MusePresentation = {actorId: string; name: string; appearanceId: MuseVariantId | null; color: string; role: string; kind: 'personal' | 'legacy' | 'unknown'; profile: ActorProfile | null};
export function readPublicProfile(id: string, raw: unknown): ActorProfile | null {
 if(typeof id!=='string'||!id||!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='actorId,appearanceId,displayName,revision')return null;
 const p=raw as ActorProfile;
 if(p.actorId!==id||typeof p.displayName!=='string'||!p.displayName.trim()||[...p.displayName].length>40||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(p.displayName)||!MUSE_VARIANTS.some(v=>v.id===p.appearanceId)||!Number.isSafeInteger(p.revision)||p.revision<1)return null;
 return{actorId:id,displayName:p.displayName,appearanceId:p.appearanceId,revision:p.revision};
}
export function resolveMuse(m: ProfileMuse): MusePresentation {
 const profile=readPublicProfile(m.id,m.profile),legacy=m.profile===undefined?HARNESSES.find(h=>h.id===m.id):null;
 const appearanceId=profile?.appearanceId??(legacy?.id as MuseVariantId|undefined)??null;
 const variant=MUSE_VARIANTS.find(v=>v.id===appearanceId);
 return{actorId:m.id,name:profile?.displayName??legacy?.name??`Unknown Muse · ${m.id}`,appearanceId,color:variant?.body??'#E8DDC7',role:profile?'Personal Muse':legacy?.role??'Profile unavailable',kind:profile?'personal':legacy?'legacy':'unknown',profile};
}
/** Never copy a current profile into a recorded world. The raw recorded checkpoint is the only source. */
export function withSnapshotProfiles<W extends {muses: readonly ProfileMuse[]}>(world: W, state: {muses?: readonly ProfileMuse[]}): W {
 const recorded=new Map((state.muses??[]).map(m=>[m.id,m]));
 return {...world,muses:world.muses.map(m=>{const {profile:_current,...rest}=m;const raw=recorded.get(m.id);return raw?.profile!==undefined?{...rest,profile:readPublicProfile(m.id,raw.profile)}:rest;})} as W;
}
export const presentationIn = (id: string, world?: {muses: readonly ProfileMuse[]} | null) => resolveMuse(world?.muses.find(m=>m.id===id)??{id});
