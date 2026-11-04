/** Small public cosmetic value. Asset, palette and deco choices never grant authority or tools. */
import {MUSE_VARIANTS,type MuseVariantId} from './catalog.ts';
export const APPEARANCE_VERSION='appearance-v1';
export const BODY_PALETTE=Object.freeze([...MUSE_VARIANTS.map(v=>({id:v.id,label:v.name,hex:v.body})),{id:'wheat' as const,label:'Wheat',hex:'#E6BE77'},{id:'sage' as const,label:'Sage',hex:'#9AAE91'}].map(v=>Object.freeze(v)));
// Preserve all ten original accent colors so every original Look has an exact round trip.
export const ACCENT_PALETTE=Object.freeze(MUSE_VARIANTS.map(v=>Object.freeze({id:v.id,label:v.name,hex:v.accent})));
export type BodyColorId=typeof BODY_PALETTE[number]['id'];
export type AccentColorId=MuseVariantId;
export type DecoId='none'|Exclude<MuseVariantId,'00-jolly'>;
export const DECOS=Object.freeze([{id:'none' as DecoId,label:'None'},...MUSE_VARIANTS.filter(v=>v.id!=='00-jolly').map(v=>({id:v.id as DecoId,label:v.name}))].map(v=>Object.freeze(v)));
export type AppearanceSpec=Readonly<{look:MuseVariantId;body:BodyColorId;accent:AccentColorId;deco:DecoId}>;
export type AppearanceId=MuseVariantId|AppearanceSpec;
export type ResolvedAppearance=AppearanceSpec&Readonly<{bodyHex:string;accentHex:string}>;
const invalid=():never=>{throw Error('invalid_appearance');};
export function normalizeAppearance(value:unknown):AppearanceId {
 if(typeof value==='string')return MUSE_VARIANTS.find(v=>v.id===value)?.id??invalid();
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='accent,body,deco,look')return invalid();
 const p=value as Record<string,unknown>,look=MUSE_VARIANTS.find(v=>v.id===p.look),body=BODY_PALETTE.find(v=>v.id===p.body),accent=ACCENT_PALETTE.find(v=>v.id===p.accent),deco=DECOS.find(v=>v.id===p.deco);
 if(!look||!body||!accent||!deco)return invalid();
 return{look:look.id,body:body.id,accent:accent.id,deco:deco.id};
}
export function isAppearance(value:unknown):value is AppearanceId {try{normalizeAppearance(value);return true;}catch{return false;}}
export function defaultAppearance(look:MuseVariantId):AppearanceSpec {
 const id=MUSE_VARIANTS.find(v=>v.id===look)?.id??invalid();return{look:id,body:id,accent:id,deco:id==='00-jolly'?'none':id};
}
export function resolveAppearance(value:unknown):ResolvedAppearance {
 const appearance=normalizeAppearance(value),spec=typeof appearance==='string'?defaultAppearance(appearance):appearance;
 return{...spec,bodyHex:BODY_PALETTE.find(v=>v.id===spec.body)!.hex,accentHex:ACCENT_PALETTE.find(v=>v.id===spec.accent)!.hex};
}
export const appearanceLook=(value:unknown):MuseVariantId=>{const a=normalizeAppearance(value);return typeof a==='string'?a:a.look;};
/** Legacy SQL values stay byte-identical. New specifications use a canonical four-field JSON value. */
export const encodeAppearance=(value:unknown):string=>{const a=normalizeAppearance(value);return typeof a==='string'?a:JSON.stringify(a);};
export const appearanceKey=encodeAppearance;
export function decodeAppearance(value:string):AppearanceId {
 if(typeof value!=='string')return invalid();
 if(value.startsWith('{')){try{return normalizeAppearance(JSON.parse(value));}catch{return invalid();}}
 return normalizeAppearance(value);
}
