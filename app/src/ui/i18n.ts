import {itemName} from '../engine/items.ts';
import {BEATS} from '../engine/beats.ts';
import {KO_UI} from './ui-strings.ts';
export type UILanguage='ko'|'en';
export const languageOf=(value?:string):UILanguage=>typeof value==='string'&&/^ko(?:-|$)/i.test(value)?'ko':'en';
export const uiLanguage=():UILanguage=>languageOf(typeof navigator==='undefined'?undefined:navigator.language);
function bilingual(key:string,language:UILanguage):string|null{
 for(const separator of [' / ',' · ']){let at=key.indexOf(separator);while(at>=0){const ko=key.slice(0,at),en=key.slice(at+separator.length);if(/[가-힣]/.test(ko)&&!/[가-힣]/.test(en)&&/[A-Za-z]/.test(en))return language==='ko'?ko:en;if(!/[가-힣]/.test(ko)&&/[A-Za-z]/.test(ko)&&/[가-힣]/.test(en))return language==='ko'?en:ko;at=key.indexOf(separator,at+separator.length);}}
 return null;
}
/** Only author-marked product wording goes here. Interpolated names, speech, IDs and other public data are never translated. */
export function translateFor(language:UILanguage,input:string|readonly string[],...values:unknown[]):string{
 const key=typeof input==='string'?input:input.map((part,i)=>part+(i<input.length-1?`{${i}}`:'')).join('');
 const translated=bilingual(key,language)??(language==='ko'?(KO_UI as Record<string,string>)[key]??key:key);
 return translated.replace(/\{(\d+)\}/g,(whole,index)=>Number(index)<values.length?String(values[Number(index)]):whole);
}
export function uiText(input:string|readonly string[],...values:unknown[]):string{return translateFor(uiLanguage(),input,...values);}
export function provenanceLabel(value:{source:string;scope:string}|null,language=uiLanguage(),recorded=false):string|null{
 if(!value)return null;
 if(value.source==='connected')return language==='ko'?(value.scope==='recent_action'?'최근 연결행동 · 주인의 Muse':`${recorded?'기록된 행동 · ':''}주인의 Muse가 스스로 함 (connected)`):(value.scope==='recent_action'?'Recent connected action · owner’s Muse':`${recorded?'Recorded action · ':''}owner’s Muse acts for itself (connected)`);
 if(!['live','rule','scripted','replay'].includes(value.source))return null;
 return `${language==='ko'?(recorded?'기록된 행동 출처':'행동 출처'):(recorded?'Recorded action source':'Action source')} · ${value.source.toUpperCase()}`;
}
/** Static authored HTML only, before dynamic/public content mounts. Never runs over server data. */
export function localizeStaticUI(root:HTMLElement=document.body){
 document.documentElement.lang=uiLanguage();document.title=uiText('Musely — a little life, in motion');
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes:Text[]=[];for(let node=walker.nextNode();node;node=walker.nextNode())if(!node.parentElement?.closest('script,style,.quotes,[data-ui-content]'))nodes.push(node as Text);
 for(const node of nodes){const value=node.data,trim=value.trim();if(trim)node.data=value.replace(trim,uiText(trim));}
 for(const node of root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder],[alt]'))for(const name of['aria-label','title','placeholder','alt']){const value=node.getAttribute(name);if(value)node.setAttribute(name,uiText(value));}
}

/** Known product/catalog labels only; never call this on a profile name or NPC/user speech. */
export const catalogText=(value:string):string=>uiLanguage()==='ko'?(KO_UI as Record<string,string>)[value]??value:value;
/** Only a known engine beat ID/humanized ID is a product activity; unknown public values stay literal. */
export function activityLabel(value:string):string {
 const beat=BEATS.find(b=>b.id===value||b.id.replace(/_/g,' ')===value);
 if(!beat&&value!=='resident_stay'&&value!=='resident stay')return value;
 const label=(beat?.id??'resident_stay').split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join(' ');
 return uiLanguage()==='ko'?catalogText(label):value.replace(/_/g,' ');
}
export function activityStatus(value:string):string{
 if(uiLanguage()==='en')return value;
 const paused=' · paused (delegation revoked)';if(value.endsWith(paused))return activityStatus(value.slice(0,-paused.length))+' · 일시 정지 (위임 철회)';
 // A public name may contain separators or look like an activity. Keep it as a template value.
 let m=/^(.*) is not here: ([A-Za-z0-9_]+) is shown as wave$/.exec(value);if(m)return uiText`${m[1]} is not here: ${m[2]} is shown as wave`;
 m=/^At (.+)$/.exec(value);if(m)return uiText`${catalogText(m[1])} is here`;
 m=/^(Walking|Riding the bus|Teleporting) to (.+) · ETA (\d+:\d{2})$/.exec(value);if(m)return `${({Walking:'걷는 중','Riding the bus':'버스 이동 중',Teleporting:'순간이동 중'} as Record<string,string>)[m[1]]} · ${catalogText(m[2])} · 남은 시간 ${m[3]}`;
 m=/^(.+?) at (.+)$/.exec(value);if(m&&(BEATS.some(b=>b.id.replace(/_/g,' ')===m![1])||m[1]==='resident stay'))return `${activityLabel(m[1])} · ${catalogText(m[2])}`;
 m=/^stands for ([A-Za-z0-9_]+) \(no stand_up transition while a cue interrupts a seated beat\)$/.exec(value);if(m)return uiText`stands for ${m[1]} (no stand_up transition while a cue interrupts a seated beat)`;
 m=/^no 3D prop for (.+): shown as an item card$/.exec(value);if(m)return uiText`no 3D prop for ${catalogText(m[1])}: shown as an item card`;
 let x=/^Server proxy ready \((.+)\). (\d+) live calls today\. The model key never reaches this page\.$/.exec(value);if(x)return uiText`Server proxy ready (${x[1]}). ${x[2]} live calls today. The model key never reaches this page.`;
 x=/^Today's budget \(\$(.+)\) is used up\. Live calls fall back to recorded replays\.$/.exec(value);if(x)return uiText`Today's budget ($${x[1]}) is used up. Live calls fall back to recorded replays.`;
 return catalogText(value);
}

export function inventoryText(items:readonly string[]):string{
 const counts=new Map<string,number>();for(const id of items){const key=id.startsWith('postcard:')?'postcard':id;counts.set(key,(counts.get(key)??0)+1);}
 const name=(id:string)=>id==='postcard'?'Postcard':itemName(id),rows=[...counts].sort((a,b)=>b[1]-a[1]||name(a[0]).localeCompare(name(b[0])));
 const top=rows.slice(0,3).map(([id,n])=>catalogText(name(id))+(n>1?' ×'+n:''));
 if(uiLanguage()==='ko')return items.length?`아이템 ${items.length}개 · ${top.join(', ')}${rows.length>3?` · 그 외 ${rows.length-3}종`:''}`:'아이템 없음';
 return items.length?`${items.length} item${items.length===1?'':'s'} · ${top.join(', ')}${rows.length>3?` · +${rows.length-3} more`:''}`:'No items';
}
