/** Bounded deterministic staggering for already admitted resident model slots, not a new scheduler. */
export function residentCallJitterMs(decisionId:string,maximum:number):number{
 if(!Number.isSafeInteger(maximum)||maximum<0||maximum>2000)throw Error('invalid_resident_call_jitter');
 if(maximum===0)return 0;
 let h=2166136261;for(const c of decisionId)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;
 return 1+h%maximum;
}
