import {resolveAppearance,appearanceKey,type AppearanceId} from '../character-kit/appearance.ts';
const marks:Record<string,string>={'01-sunny':'✦','02-moss':'❀','03-ripple':'⌁','04-ember':'◆','05-bloom':'❧','06-ink':'▤','07-tempo':'♫','08-orbit':'✧','09-copper':'⚙'};
export const appearanceIconMark=(deco:string)=>marks[deco]??'';
/** Abstract world/card/list icons use the same public colors and a small decorative cue; legacy icons stay unchanged. */
export function paintAppearanceIcon(node:HTMLElement,appearance:AppearanceId|null){
 const badge=node.querySelector('.cosmetic-deco');if(!appearance||typeof appearance==='string'){node.style.removeProperty('--muse-accent');node.removeAttribute('data-appearance');badge?.remove();return;}
 const key=appearanceKey(appearance);if(node.dataset.appearance===key)return;const p=resolveAppearance(appearance);node.style.setProperty('--muse',p.bodyHex);node.style.setProperty('--muse-accent',p.accentHex);node.dataset.appearance=appearanceKey(appearance);badge?.remove();if(p.deco!=='none'){const glyph=document.createElement('span');glyph.className='cosmetic-deco';glyph.setAttribute('aria-hidden','true');glyph.textContent=appearanceIconMark(p.deco);(node.querySelector('.muse-icon')??node).append(glyph);}
}
