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

/** Reserve count room while placing, then return it to every name without an actual count.
 * Both stages use only this frame's immutable candidates, never the previous DOM badge. */
export function layoutCompactLabels(input:readonly LabelCandidate[],bounds:{left:number;right:number;top:number;bottom:number},obstacles:readonly LabelBox[]=[]):LabelPlacement[]{
 const badge=28,byId=new Map(input.map(c=>[c.id,c]));
 const placed=layoutLiveLabels(input.map(c=>({...c,width:c.width+badge})),bounds,obstacles);
 return placed.map(p=>{const base=byId.get(p.id)!,width=p.count?p.width:Math.min(base.width,p.width);return{...p,left:p.left+(p.width-width)/2,width};});
}

/** Conservative opaque rectangle union, clipped to this frame's viewport. */
export function overlayUnionArea(boxes:readonly LabelBox[],viewport:{width:number;height:number}):number {
 const clipped=boxes.map(b=>{const left=Math.max(0,b.left),top=Math.max(0,b.top),right=Math.min(viewport.width,b.left+b.width),bottom=Math.min(viewport.height,b.top+b.height);return{left,top,right,bottom};}).filter(b=>Number.isFinite(b.left+b.top+b.right+b.bottom)&&b.right>b.left&&b.bottom>b.top);
 const xs=[...new Set(clipped.flatMap(b=>[b.left,b.right]))].sort((a,b)=>a-b);let area=0;
 for(let i=1;i<xs.length;i++){const left=xs[i-1],right=xs[i],ys=clipped.filter(b=>b.left<right&&b.right>left).map(b=>[b.top,b.bottom]).sort((a,b)=>a[0]-b[0]);let length=0,end=-Infinity;for(const [top,bottom]of ys)if(bottom>end){length+=bottom-Math.max(top,end);end=bottom;}area+=(right-left)*length;}
 return area;
}
/** Optional labels yield to immutable current UI/speech geometry. Protected names never yield to the budget. */
export function budgetMobileLabels(input:readonly (LabelCandidate&{priority?:number})[],bounds:{left:number;right:number;top:number;bottom:number},obstacles:readonly LabelBox[],opaque:readonly LabelBox[],viewport:{width:number;height:number},fraction=.19){
 const ranked=[...input].sort((a,b)=>Number(b.selected)-Number(a.selected)||Number(b.speaking)-Number(a.speaking)||(a.priority??0)-(b.priority??0)||a.id.localeCompare(b.id));
 const protectedIds=new Set(ranked.filter(c=>c.selected||c.speaking).map(c=>c.id)),optional=ranked.filter(c=>!protectedIds.has(c.id));let count=Math.max(0,8-protectedIds.size),placements:LabelPlacement[]=[],dots:string[]=[],area=0;
 for(;;){const keep=new Set([...protectedIds,...optional.slice(0,count).map(c=>c.id)]);placements=layoutCompactLabels(ranked.filter(c=>keep.has(c.id)),bounds,obstacles);dots=ranked.filter(c=>!keep.has(c.id)).map(c=>c.id);const dotBoxes=ranked.filter(c=>!keep.has(c.id)).map(c=>({left:c.x,top:c.y,width:5,height:5}));area=overlayUnionArea([...opaque,...placements.filter(p=>!p.hidden),...dotBoxes],viewport);if(area<=viewport.width*viewport.height*fraction||count===0)break;count--;}
 return{placements,dots,area,protectedOverBudget:area>viewport.width*viewport.height*fraction};
}
