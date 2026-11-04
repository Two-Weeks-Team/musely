// Screen-space labels only. This never changes an actor's world position, selection or motion.
export type LabelBox={left:number;top:number;width:number;height:number};
export type LabelCandidate={id:string;group:string;x:number;y:number;width:number;height:number;selected:boolean;speaking:boolean;groupSize?:number};
export type LabelPlacement=LabelBox&{id:string;hidden:boolean;count:number};
const overlap=(a:LabelBox,b:LabelBox)=>a.left<b.left+b.width+4&&a.left+a.width+4>b.left&&a.top<b.top+b.height+4&&a.top+a.height+4>b.top;
export function layoutLiveLabels(input:readonly LabelCandidate[],bounds:{left:number;right:number;top:number;bottom:number},obstacles:readonly LabelBox[]=[]):LabelPlacement[]{
 const ordered=[...input].sort((a,b)=>Number(b.selected)-Number(a.selected)||Number(b.speaking)-Number(a.speaking)||a.id.localeCompare(b.id)),groups=new Map<string,LabelCandidate[]>();
 for(const c of ordered){const group=groups.get(c.group)??[];group.push(c);groups.set(c.group,group);}
 const out=new Map<string,LabelPlacement>(),placed:LabelBox[]=[];
 for(const c of ordered){
  const group=groups.get(c.group)!,eligible=group.length<=4||group.indexOf(c)<3;
  const width=Math.min(c.width,bounds.right-bounds.left),height=c.height;
  let box:LabelBox|null=null;
  if(eligible&&height<=bounds.bottom-bounds.top){
   const left=Math.max(bounds.left,Math.min(bounds.right-width,c.x-width/2)),top=Math.max(bounds.top,Math.min(bounds.bottom-height,c.y-height));
   // Start near the projected head, then stack upward/downward before trying another column.
   const xs=[left,bounds.left,bounds.right-width];
   for(const x of xs){
    const ys=[top];for(let d=height+6;d<=bounds.bottom-bounds.top+height;d+=height+6)ys.push(top-d,top+d);
    for(const y of ys){const b={left:x,top:y,width,height};if(y<bounds.top||y+height>bounds.bottom)continue;if([...placed,...obstacles].some(p=>overlap(b,p)))continue;box=b;break;}
    if(box)break;
   }
  }
  const row={id:c.id,...(box??{left:0,top:0,width,height}),hidden:!box,count:0};out.set(c.id,row);if(box)placed.push(box);
 }
 // A representative's count describes only omitted labels at this same public place.
 for(const group of groups.values()){
  const visible=group.map(c=>out.get(c.id)!).filter(p=>!p.hidden),hidden=Math.max(group.length,...group.map(c=>c.groupSize??0))-visible.length;
  if(visible.length)visible[0].count=hidden;
 }
 return [...out.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
