import {activityStatus} from './ui/i18n.ts';
import type {Map as LibreMap} from 'maplibre-gl';
import {conversationAt,hubStories,stateAt} from './story';
import {PEOPLE} from './scene';
type P={x:number;y:number};type R={x:number;y:number;w:number;h:number};
const overlap=(a:R,b:R,pad=5)=>a.x<b.x+b.w+pad&&a.x+a.w+pad>b.x&&a.y<b.y+b.h+pad&&a.y+a.h+pad>b.y;
export function makeBubbles(map:LibreMap,headAt:(person:number)=>P){
 const root=document.createElement('div');root.id='world-bubbles';root.setAttribute('aria-hidden','true');document.body.append(root);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('bubble-leaders');root.append(svg);
 const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');defs.innerHTML='<marker id="hub-dot" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7"><circle cx="4" cy="4" r="2.8" fill="#FFB36B"/></marker>';svg.append(defs);
 const line=(kind:string)=>{const l=document.createElementNS('http://www.w3.org/2000/svg','path');l.setAttribute('class',kind);if(kind==='hub-leader')l.setAttribute('marker-end','url(#hub-dot)');svg.append(l);return l;};
 const statuses=PEOPLE.map((p,i)=>{const el=document.createElement('div');el.className='action-bubble';el.dataset.person=String(i);root.append(el);return{el,leader:line('status-leader'),person:i};});
 const speech=document.createElement('div');speech.className='speech-bubble';speech.innerHTML='<span class="bubble-speaker"></span><p></p>';root.append(speech);const speechLine=line('speech-leader');
 const hubs=hubStories.map((hub,i)=>{const el=document.createElement('div');el.className='hub-story';el.dataset.hub=hub.id;el.innerHTML='<span class="hub-label"></span><p></p><small></small>';el.querySelector('span')!.textContent=hub.name;root.append(el);return{el,leader:line('hub-leader'),hub,index:i};});
 const placements=new WeakMap<HTMLElement,{key:string;index:number}>();
 const sizes=new WeakMap<HTMLElement,{key:string;w:number;h:number}>();
 let reservedAt=0;
 let metrics:any={hubs:[],speech:null,statuses:[]};let lastLayout=0,cachedReserved:R[]=[],softHeads:R[]=[];
 const rect=(el:Element):R=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};};
 function show(el:HTMLElement,l:SVGPathElement,anchor:P,placed:R[],kind:string,force=false){
  el.style.display='block';el.style.visibility='hidden';const key=el.textContent+'|'+innerWidth;let size=sizes.get(el);if(!size||size.key!==key){size={key,w:el.offsetWidth,h:el.offsetHeight};sizes.set(el,size);}const {w,h}=size;
  const candidates=kind==='hub'?[[0,-h-18],[-w*.85,-h-18],[w*.35,-h-18],[0,18],[-w*.85,28],[w*.35,28],[0,-h-90]]:[[-w/2,-h-16],[-w/2-20,-h-16],[-w/2+20,-h-16],[-w/2-36,-h-16],[-w-22,-h/2],[22,-h/2],[-w/2,-h-28],[-w/2,-h-40],[-w/2,-h-54],[-w/2,-h-68],[-w/2,-h-92],[-w-20,-h-30],[20,-h-30]];
  const previous=placements.get(el),order=[...(previous?.key===key?[previous.index]:[]),...candidates.map((_,i)=>i)].filter((v,i,a)=>a.indexOf(v)===i);let bestSoft=Infinity;let r:R|undefined;for(const ci of order){const [dx,dy]=candidates[ci];const p={x:anchor.x+dx,y:anchor.y+dy,w,h};if(p.x<8||p.y<8||p.x+w>innerWidth-8||p.y+h>innerHeight-25)continue;if([...cachedReserved,...placed].some(b=>overlap(p,b)))continue;const score=softHeads.filter(b=>overlap(p,b)).length;if(score<bestSoft){bestSoft=score;r=p;placements.set(el,{key,index:ci});}if(score===0)break;}
  if(!r&&force){const top=Math.max(110,...cachedReserved.filter(b=>b.y<160).map(b=>b.y+b.h+10));const p={x:Math.max(8,Math.min(innerWidth-w-8,anchor.x-w/2)),y:Math.min(innerHeight-h-140,top),w,h};if(![...cachedReserved,...placed].some(b=>overlap(p,b)))r=p;}
  if(!r){el.style.display='none';l.style.display='none';return null;}
  el.style.left=r.x+'px';el.style.top=r.y+'px';el.style.visibility='visible';placed.push(r);
  let tx=Math.max(r.x+12,Math.min(r.x+w-12,anchor.x)),ty=anchor.y>=r.y+h?r.y+h:r.y;if(anchor.x<r.x){tx=r.x;ty=Math.max(r.y+9,Math.min(r.y+h-9,anchor.y));}else if(anchor.x>r.x+w){tx=r.x+w;ty=Math.max(r.y+9,Math.min(r.y+h-9,anchor.y));}
  l.setAttribute('d',`M ${tx} ${ty} L ${anchor.x} ${anchor.y}`);l.style.display='block';return {...r,anchor,tail:{x:tx,y:ty}};
 }
 function update(t:number){
  const now=performance.now(),zoom=map.getZoom();lastLayout=now;
  if(now-reservedAt>140){reservedAt=now;cachedReserved=[...document.querySelectorAll('header,footer,#muse-card,#story-heading,.map-tools,.top-note,#network-note,#loading,.world-caption,.attribution')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}).map(rect);}
  softHeads=[];const placed:R[]=[];metrics={hubs:[],speech:null,statuses:[],lineId:conversationAt(t)?.id??null};
  svg.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);
  statuses.forEach(s=>{s.el.style.display='none';s.leader.style.display='none';});speech.style.display='none';speechLine.style.display='none';hubs.forEach(h=>{h.el.style.display='none';h.leader.style.display='none';});
  if(zoom<18.3){for(const h of hubs){const p=map.project([h.hub.lng,h.hub.lat]);if(p.x<12||p.x>innerWidth-12||p.y<90||p.y>innerHeight-70)continue;const turn=h.hub.lines[Math.floor(t/6+h.index)%h.hub.lines.length];h.el.querySelector('p')!.textContent='“'+turn[1]+'”';h.el.querySelector('small')!.textContent=turn[0]+' · '+h.hub.people+' Muses';const box=show(h.el,h.leader,p,placed,'hub');if(box)metrics.hubs.push({id:h.hub.id,...box});if(metrics.hubs.length>=(innerWidth<700?3:5))break;}return;}
  if(zoom<20.35)return;
  const turn=conversationAt(t),heads=PEOPLE.map((_,i)=>headAt(i));
  const hudReserved=cachedReserved;const protectedIds=[turn?.person,turn?.listener];const allHeads=heads.map((p,i)=>({person:i,x:p.x-13,y:p.y-2,w:26,h:30})).filter(p=>p.x>0&&p.x<innerWidth&&p.y>80&&p.y<innerHeight-50);cachedReserved=[...hudReserved,...allHeads.filter(p=>protectedIds.includes(p.person))];softHeads=allHeads.filter(p=>!protectedIds.includes(p.person));
  if(turn){const p=heads[turn.person];if(p.x>0&&p.x<innerWidth&&p.y>65&&p.y<innerHeight-90){speech.querySelector('span')!.textContent=PEOPLE[turn.person].name;speech.querySelector('span')!.style.color=PEOPLE[turn.person].color;speech.querySelector('p')!.textContent=turn.text;const box=show(speech,speechLine,p,placed,'speech',true);if(box)metrics.speech={person:turn.person,text:turn.text,...box};}}
  const order=[turn?.listener??0,...PEOPLE.map((_,i)=>i)].filter((v,i,a)=>a.indexOf(v)===i);for(const i of order){if(i===turn?.person&&metrics.speech)continue;const p=heads[i];if(p.x<12||p.x>innerWidth-12||p.y<90||p.y>innerHeight-110)continue;const s=statuses[i];s.el.textContent=activityStatus(stateAt(i,t));const box=show(s.el,s.leader,p,placed,'status');if(box)metrics.statuses.push({person:i,state:s.el.textContent,...box});}
  cachedReserved=hudReserved;
 }
 return {update,invalidate:()=>{reservedAt=0;},getMetrics:()=>metrics};
}
