import {localClock,dayPhase,TIME_ZONE} from '../../src/engine/world-clock.ts';
const clocks=new WeakMap<object,Readonly<{date:string;time:string;timeZone:string;phase:string}>>();
/** Bind the final prepared model input using the trusted world observation time, after all input copies. */
export function bindWorldClock<T extends object>(input:T,now:number):T {
 if(!Number.isSafeInteger(now)||now<0)throw Error('invalid_world_clock');
 const clock=localClock(now);clocks.set(input,{date:clock.date,time:clock.hhmm,timeZone:TIME_ZONE,phase:dayPhase(clock.hour)});return input;
}
export function worldClockMessage(input:object):{role:'system';content:string}|null {
 const clock=clocks.get(input);return clock?{role:'system',content:`Current world local date/time: ${clock.date} ${clock.time}. TIME_ZONE: ${clock.timeZone}. Day phase: ${clock.phase}. Use this world clock for time-of-day greetings; never infer time from the observer, owner, host or budget timezone. A morning/afternoon/evening/night greeting must match this phase; a neutral hello is always fine.`}:null;
}
