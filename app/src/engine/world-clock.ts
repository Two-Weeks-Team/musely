/** World civil time; independent of host locale, observer KST and budget clocks. */
export const TIME_ZONE='America/Los_Angeles';
export type DayPhase='morning'|'afternoon'|'evening'|'night';
export const dayPhase=(hour:number):DayPhase=>hour>=6&&hour<12?'morning':hour>=12&&hour<17?'afternoon':hour>=17&&hour<21?'evening':'night';
const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
export function localClock(ms: number) {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return {date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), hhmm: `${parts.hour}:${parts.minute}`};
}

/** Authored greeting template only: call before substituting a public proper name. */
export function greetingFitsPhase(template:string,phase:DayPhase):boolean {
 for(const word of ['morning','afternoon','evening','night'] as const)if(new RegExp('\\b'+word+'\\b','i').test(template)&&word!==phase)return false;
 return !/\btonight\b/i.test(template)||phase==='evening'||phase==='night';
}
