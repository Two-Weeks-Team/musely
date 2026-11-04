/** Projected cost includes settled actuals plus pending maxima and this request's full maximum.
 * Shed only near the resident cap: on a $1 hour, action/reflection stop above $.90,
 * chat above $.95, trade above $.98; Personal retains the last headroom to $1.
 * The same ratios apply near the $24 resident day. These are headroom choices,
 * not raised caps, a call-count limit, or permission to underestimate a reservation. */
export const RESIDENT_PRIORITY_CUTOFFS=Object.freeze({action:.90,reflection:.90,chat:.95,trade:.98,personal:1});
/** Trusted deployment settings only. A browser never chooses a tier or enables this policy. */
export type ResidentBudgetPolicy={enabled:boolean;residentDailyCapUsd:number;interactiveDailyCapUsd:number;residentHourlyCapUsd:number;periodStartAt:number;periodEndAt:number;periodCapUsd:number;residentEnabled:boolean};
type Settings=Partial<Record<'RESIDENT_BUDGET_MODE'|'DAILY_BUDGET_USD'|'RESIDENT_DAILY_BUDGET_USD'|'INTERACTIVE_DAILY_BUDGET_USD'|'RESIDENT_HOURLY_BUDGET_USD'|'MODEL_PERIOD_BUDGET_USD'|'MODEL_BUDGET_START_AT'|'MODEL_BUDGET_END_AT'|'RESIDENT_MODEL_ENABLED',string>>;
const positive=(env:Settings,key:keyof Settings,fallback:number)=>{const n=env[key]===undefined?fallback:Number(env[key]);if(!Number.isFinite(n)||n<=0)throw Error('invalid_'+key);return n;};
export function residentBudgetFromEnv(env:Settings):ResidentBudgetPolicy|undefined {
 const mode=env.RESIDENT_BUDGET_MODE;
 if(mode===undefined||mode===''||mode==='off')return undefined;
 if(mode!=='split-v1')throw Error('unsupported_RESIDENT_BUDGET_MODE');
 const residentDailyCapUsd=positive(env,'RESIDENT_DAILY_BUDGET_USD',24),interactiveDailyCapUsd=positive(env,'INTERACTIVE_DAILY_BUDGET_USD',6);
 if(residentDailyCapUsd+interactiveDailyCapUsd>positive(env,'DAILY_BUDGET_USD',30))throw Error('split_budget_exceeds_daily');
 const periodStartAt=Date.parse(env.MODEL_BUDGET_START_AT??'2026-11-04T00:00:00+09:00'),periodEndAt=Date.parse(env.MODEL_BUDGET_END_AT??'2026-11-09T00:00:00+09:00');
 if(!Number.isSafeInteger(periodStartAt)||!Number.isSafeInteger(periodEndAt)||periodEndAt<=periodStartAt)throw Error('invalid_period_window');
 const enabled=env.RESIDENT_MODEL_ENABLED??'true';if(!['true','false'].includes(enabled))throw Error('invalid_RESIDENT_MODEL_ENABLED');
 return {enabled:true,residentDailyCapUsd,interactiveDailyCapUsd,residentHourlyCapUsd:positive(env,'RESIDENT_HOURLY_BUDGET_USD',1),periodCapUsd:positive(env,'MODEL_PERIOD_BUDGET_USD',150),periodStartAt,periodEndAt,residentEnabled:enabled==='true'};
}
export function residentKindFor(action:'spotlight'|'encounter'|'trade'|'reflection',personalPeer=false):'action'|'chat'|'trade'|'personal'|'reflection' {
 return action==='encounter'?(personalPeer?'personal':'chat'):action==='spotlight'?'action':action;
}
export const isResidentBudgetRefusal=(reason:string)=>['budget','resident_disabled','budget_window','period_budget','resident_daily_budget','interactive_daily_budget','resident_hourly_budget','resident_priority_budget'].includes(reason);
