import {LINES} from './story.ts';
import {positionAt} from './activity.ts';
const keys=[
 [0,10.25,0,0],[4,10.25,0,0],[14,21.45,0,0],[24,22.2,-1.15,2.45],[34,22.2,-1.15,2.45],
 [47,22.05,5.65,-2.8],[61,22.05,5.65,-2.8],[76,22.35,-3.9,-2.2],[141,22.35,-3.9,-2.2],
 [170,22.1,.1,2.4],[202,22.1,.1,2.4],[210,21.35,0,0],
];
function baseCameraAt(t:number){let k=0;while(k<keys.length-2&&t>=keys[k+1][0])k++;const a=keys[k],b=keys[k+1],f=Math.max(0,Math.min(1,(t-a[0])/(b[0]-a[0]))),e=f*f*(3-2*f);return {zoom:a[1]+(b[1]-a[1])*e,x:a[2]+(b[2]-a[2])*e,z:a[3]+(b[3]-a[3])*e,bay:0};}

const smooth=(u:number)=>{const f=Math.max(0,Math.min(1,u));return f*f*(3-2*f);};
function pair(line:typeof LINES[number],t:number){const a=positionAt(line.person,t),b=positionAt(line.listener,t);return{x:(a.x+b.x)/2,z:(a.z+b.z)/2};}
export function tourCameraAt(t:number,_person=0,mobile=false){const c=baseCameraAt(t);c.zoom-=mobile?(.65-.1*smooth((t-14)/4)):0;if(t<14)return c;
 let index=LINES.findIndex(l=>t>=l.start&&t<l.end);if(index<0)index=t>=202?LINES.length-1:0;let p=pair(LINES[index],t),dip=0;
 const transition=index>0&&t<LINES[index].start+2?index:index<LINES.length-1&&t>LINES[index].end-2?index+1:-1;
 if(transition>0){const boundary=LINES[transition].start,a=pair(LINES[transition-1],t),b=pair(LINES[transition],t),e=smooth((t-boundary+2)/4),distance=Math.hypot(a.x-b.x,a.z-b.z);p={x:a.x+(b.x-a.x)*e,z:a.z+(b.z-a.z)*e};if(distance>1.5)dip=Math.sin(Math.PI*Math.max(0,Math.min(1,(t-boundary+2)/4)))**2;}
 const weight=t<18?smooth((t-14)/4):t>202?1-smooth((t-202)/8):1;c.x+=(p.x-c.x)*weight;c.z+=(p.z-c.z)*weight;c.zoom+=(Math.min(c.zoom,mobile?20.95:21.5)-c.zoom)*dip;return c;
}
