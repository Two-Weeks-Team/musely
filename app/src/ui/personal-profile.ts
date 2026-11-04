// Presentation only: server public profile -> existing appearance; no ownership/authentication decisions.
import {isAppearance,normalizeAppearance,resolveAppearance,appearanceLook,type AppearanceId} from '../character-kit/appearance.ts';
import {JUDGE_MUSE} from '../engine/judge-muse.ts';
import {HARNESSES,harnessById} from '../engine/harness.ts';
import {MUSE_VARIANTS, type MuseVariantId} from '../character-kit/catalog.ts';
import {residentInstance} from '../engine/resident-catalog.ts';
import type {ActorProfile} from '../identity/participant.ts';
export type ProfileMuse = {id: string; profile?: unknown};
export type MusePresentation = {actorId: string; name: string; appearanceId: MuseVariantId | null; color: string;accent:string;appearance:AppearanceId|null; role: string; kind: 'personal' | 'resident' | 'judge' | 'legacy' | 'unknown'; profile: ActorProfile | null};
export function readPublicProfile(id: string, raw: unknown): ActorProfile | null {
 if(typeof id!=='string'||!id||!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='actorId,appearanceId,displayName,revision')return null;
 const p=raw as ActorProfile;
 if(p.actorId!==id||typeof p.displayName!=='string'||!p.displayName.trim()||[...p.displayName].length>40||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(p.displayName)||!isAppearance(p.appearanceId)||!Number.isSafeInteger(p.revision)||p.revision<1)return null;
 return{actorId:id,displayName:p.displayName,appearanceId:normalizeAppearance(p.appearanceId),revision:p.revision};
}
export function resolveMuse(m: ProfileMuse): MusePresentation {
 const judge=m.id===JUDGE_MUSE.id&&m.profile===undefined;
 const instance=m.profile===undefined?residentInstance(m.id):null;
 const profile=readPublicProfile(m.id,m.profile),legacy=m.profile===undefined?HARNESSES.find(h=>h.id===m.id):null;
 const appearanceId=(judge?JUDGE_MUSE.appearanceId:undefined)??(profile?appearanceLook(profile.appearanceId):undefined)??(instance?.appearanceId as MuseVariantId|undefined)??(legacy?.id as MuseVariantId|undefined)??null;
 const variant=MUSE_VARIANTS.find(v=>v.id===appearanceId);
 return{actorId:m.id,name:judge?JUDGE_MUSE.name:profile?.displayName??instance?.name??legacy?.name??`Unknown Muse · ${m.id}`,appearanceId,color:profile?resolveAppearance(profile.appearanceId).bodyHex:variant?.body??'#E8DDC7',accent:profile?resolveAppearance(profile.appearanceId).accentHex:variant?.accent??'#D9A38D',appearance:profile?.appearanceId??appearanceId,role:judge?JUDGE_MUSE.label:profile?'Personal Muse':instance?harnessById(instance.id).role:legacy?.role??'Profile unavailable',kind:judge?'judge':profile?'personal':instance?'resident':legacy?'legacy':'unknown',profile};
}
/** Never copy a current profile into a recorded world. The raw recorded checkpoint is the only source. */
export function withSnapshotProfiles<W extends {muses: readonly ProfileMuse[]}>(world: W, state: {muses?: readonly ProfileMuse[]}): W {
 const recorded=new Map((state.muses??[]).map(m=>[m.id,m]));
 return {...world,muses:world.muses.map(m=>{const {profile:_current,...rest}=m;const raw=recorded.get(m.id);return raw?.profile!==undefined?{...rest,profile:readPublicProfile(m.id,raw.profile)}:rest;})} as W;
}
export const presentationIn = (id: string, world?: {muses: readonly ProfileMuse[]} | null) => resolveMuse(world?.muses.find(m=>m.id===id)??{id});

/** Current public sender label only. The legacy owner's asset name is never a live fallback. */
export function publicSenderName(id:string,world?:{muses:readonly ProfileMuse[]}|null,unknown='The Muse'):string {
 const muse=world?.muses.find(m=>m.id===id);if(id==='00-jolly')return readPublicProfile(id,muse?.profile)?.displayName??unknown;
 return resolveMuse(muse??{id}).name;
}
