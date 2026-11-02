import {DURATION} from './timing.ts';
export const ROUNDS=[
 {time:'19:45',place:'Riverside',jimin:false,sora:true},
 {time:'19:45',place:'HQ-front cafe',jimin:false,sora:true},
 {time:'19:00',place:'Riverside',jimin:false,sora:true},
 {time:'20:30',place:'Riverside',jimin:false,sora:true},
 {time:'19:00',place:'HQ-front cafe',jimin:true,sora:true},
] as const;
export const FIXTURE_LABEL='POC-2 fixture excerpts (scenario 4 · life meet-up), replayed in UI · no live Spark call · owner approval simulated in the fixture';
export type Clock={elapsed:number;paused:boolean;tourFinished:boolean};
export const makeClock=():Clock=>({elapsed:0,paused:false,tourFinished:false});
export function advance(c:Clock,dt:number):Clock{const elapsed=c.paused?c.elapsed:Math.min(DURATION,c.elapsed+Math.max(0,dt>1?.1:dt));return {...c,elapsed,tourFinished:elapsed>=DURATION};}
export function activityAt(t:number){if(t<14)return {phase:'arrive',committed:false};if(t<43)return {phase:'greet',committed:false};if(t<73)return {phase:'garden',committed:false};if(t<141)return {phase:'propose',committed:false};if(t<164)return {phase:'approval',committed:false};if(t<202)return {phase:'gather',committed:false};return {phase:'rest',committed:false};}
// Timed waypoints in the same mapped patch; dwell and travel match the dialogue chapters.
const routes:number[][][]=[
 [[0,-1.3,3.2],[34,-1.3,3.2],[39,-1.67,1],[47,4.8,-3],[61,4.8,-3],[66,1,-2.7],[70,-1.2,-2.7],[76,-4,-3],[141,-4,-3],[146,-1,-2.7],[150,.4,-2.7],[155,.4,0],[162,-1.3,1],[175,-1.3,3.2],[210,-1.3,3.2]],
 [[0,-3.8,-.65],[14,-3.8,-.65],[19,-1.2,.2],[24,-.9,1.5],[50,-.9,1.5],[56,-1,1],[70,-3.8,-.65],[153,-3.8,-.65],[166,-2,.2],[174,-1,1.8],[190,-1,1.8],[200,-1,1],[210,-3.8,-.65]],
 [[0,3,3],[35,3,3],[43,6,1],[55,5.4,-2],[74,5.4,-2],[90,6,1],[110,3,3],[210,3,3]],
 [[0,6.65,-3],[50,6.65,-3],[60,6.65,-4.8],[90,6.65,-4.8],[110,6.65,-3],[210,6.65,-3]],
 [[0,-6,3],[70,-6,3],[90,-5,0],[130,-5,0],[150,-6,3],[210,-6,3]],
 [[0,0,-4],[22,0,-4],[31,1,-4],[135,1,-4],[146,0,-4],[210,0,-4]],
 [[0,1.2,3.4],[30,1.2,3.4],[34,.8,3.2],[140,.8,3.2],[144,1.2,3.4],[210,1.2,3.4]],
 [[0,-4,4],[22,-4,4],[38,-2,5],[135,-2,5],[151,-4,4],[210,-4,4]],
];
export function positionAt(index:number,t:number){const route=routes[index%routes.length],time=((t%DURATION)+DURATION)%DURATION;let k=0;while(k<route.length-2&&time>=route[k+1][0])k++;const a=route[k],b=route[k+1],f=(time-a[0])/(b[0]-a[0]),e=f*f*(3-2*f);return {x:a[1]+(b[1]-a[1])*e,z:a[2]+(b[2]-a[2])*e,moving:(a[1]!==b[1]||a[2]!==b[2])&&f>0&&f<1,yaw:Math.atan2(b[1]-a[1],b[2]-a[2])};}
