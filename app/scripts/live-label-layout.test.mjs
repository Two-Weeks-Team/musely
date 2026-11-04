import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutLiveLabels,layoutCompactLabels,budgetMobileLabels,overlayUnionArea} from '../src/ui/live-label-layout.ts';
const bounds={left:12,right:378,top:90,bottom:650};
const label=(id,extra={})=>({id,group:'commons:cafe',x:190,y:380,width:190,height:32,selected:false,speaking:false,...extra});
const overlaps=(a,b)=>a.left<b.left+b.width+3&&a.left+a.width+3>b.left&&a.top<b.top+b.height+3&&a.top+a.height+3>b.top;
test('dense labels stack without overlap, keep the selected name and account for every grouped neighbor',()=>{
 const input=Array.from({length:12},(_,i)=>label('actor'+i,{selected:i===11})),before=structuredClone(input),out=layoutLiveLabels(input,bounds),visible=out.filter(x=>!x.hidden);
 assert.ok(visible.some(x=>x.id==='actor11'));assert.ok(visible.length<=4);assert.equal(visible.reduce((n,x)=>n+1+x.count,0),12);
 for(const a of visible){assert.ok(a.left>=bounds.left&&a.left+a.width<=bounds.right);assert.ok(a.top>=bounds.top&&a.top+a.height<=bounds.bottom);for(const b of visible)if(a!==b)assert.equal(overlaps(a,b),false);}
 assert.deepEqual(input,before);assert.deepEqual(layoutLiveLabels([...input].reverse(),bounds),out);
});
test('full selected box is clamped inside a phone and speakers take priority over silent crowd members',()=>{
 const input=Array.from({length:8},(_,i)=>label('actor'+i,{selected:i===7,speaking:i===6,width:240,x:3,y:93}));
 const out=layoutLiveLabels(input,bounds),selected=out.find(x=>x.id==='actor7');assert.equal(selected.hidden,false);assert.equal(selected.width,240);assert.equal(out.find(x=>x.id==='actor6').hidden,false);
});
test('separate places and travelling actors are not counted as one gathering; busy UI boxes are avoided',()=>{
 const obstacles=[{left:12,top:400,width:220,height:200}],input=[label('selected',{selected:true,y:500}),label('other',{group:'commons:campfire',y:500}),label('traveller',{group:'traveller',y:500})];
 const out=layoutLiveLabels(input,bounds,obstacles);assert.ok(out.every(x=>x.count===0));for(const a of out.filter(x=>!x.hidden))for(const box of obstacles)assert.equal(overlaps(a,box),false);
});
test('when space is scarce selected wins, omitted neighbors retain a visible count',()=>{
 const out=layoutLiveLabels(Array.from({length:5},(_,i)=>label('a'+i,{selected:i===4,height:80})),{...bounds,top:200,bottom:285});
 const visible=out.filter(x=>!x.hidden);assert.equal(visible.length,1);assert.equal(visible[0].id,'a4');assert.equal(visible[0].count,4);
});

test('a place count includes offscreen same-place labels without borrowing another place',()=>{
 const out=layoutLiveLabels([label('selected',{selected:true,groupSize:10}),label('neighbor',{groupSize:10})],bounds);
 assert.equal(out.find(x=>x.id==='selected').count,8);
});


test('compact count layout returns blank count space without depending on the previous rendered badge',()=>{const input=[label('selected',{selected:true,width:92,height:32,groupSize:6}),label('nearby',{width:40,height:18,groupSize:6}),label('traveller',{group:'travel',groupSize:1,width:55,height:18})],before=structuredClone(input),out=layoutCompactLabels(input,bounds);assert.deepEqual(input,before);assert.deepEqual(out,layoutCompactLabels([...input].reverse(),bounds));const selected=out.find(x=>x.id==='selected'),nearby=out.find(x=>x.id==='nearby'),traveller=out.find(x=>x.id==='traveller');assert.equal(selected.hidden,false);assert.equal(selected.count,4);assert.equal(selected.width,120);assert.equal(nearby.width,40);assert.equal(traveller.width,55);for(const a of out.filter(x=>!x.hidden))for(const b of out.filter(x=>!x.hidden))if(a!==b)assert.equal(overlaps(a,b),false);});


test('mobile coverage counts opaque union once and removes lowest-priority optional names deterministically',()=>{const viewport={width:400,height:400},b={left:0,right:400,top:70,bottom:390},opaque=[{left:0,top:0,width:400,height:50},{left:0,top:0,width:100,height:50}],input=[label('selected',{selected:true,width:80,height:24,x:70,y:150,group:'pair',groupSize:2,priority:0}),label('speaker',{speaking:true,width:80,height:24,x:270,y:150,group:'pair',groupSize:2,priority:1}),...['near','middle','far'].map((id,i)=>label(id,{width:150,height:20,x:100,y:220+i*50,group:id,groupSize:1,priority:i+2}))],before=structuredClone(input);assert.equal(overlayUnionArea(opaque,viewport),20000);const out=budgetMobileLabels(input,b,[],opaque,viewport);assert.deepEqual(input,before);assert.deepEqual(out,budgetMobileLabels([...input].reverse(),b,[],opaque,viewport));assert.ok(out.placements.some(p=>p.id==='selected'&&!p.hidden));assert.ok(out.placements.some(p=>p.id==='speaker'&&!p.hidden));assert.ok(out.dots.includes('far'));assert.equal(out.dots.includes('near'),false);assert.ok(out.area<=400*400*.19);assert.equal(out.protectedOverBudget,false);assert.equal(out.placements.find(p=>p.id==='selected').count,0,'other places must never be added to this place count');});
test('protected labels and speech remain when their own opaque coverage exceeds the target',()=>{const viewport={width:390,height:844},opaque=[{left:0,top:0,width:390,height:170}],input=[label('selected',{selected:true,width:120,height:32,x:100,y:400,priority:0}),label('speaker',{speaking:true,width:130,height:32,x:290,y:500,priority:1}),label('optional',{width:55,height:20,x:80,y:600,priority:2})],out=budgetMobileLabels(input,{left:12,right:378,top:70,bottom:812},[],opaque,viewport);assert.deepEqual(out.dots,['optional']);assert.ok(out.placements.every(p=>!p.hidden));assert.equal(out.protectedOverBudget,true);assert.ok(out.area>viewport.width*viewport.height*.19);});
