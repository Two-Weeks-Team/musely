import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {frameSpeech,paintFrameSpeech} from '../src/ui/speech-recipient.ts';
const bundle=await build({entryPoints:[new URL('../src/ui/world-panel.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {describe}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const profile=(actorId,displayName)=>({actorId,displayName,appearanceId:'00-jolly',revision:1});
const world={muses:[{id:'01-sunny'},{id:'02-moss'},{id:'pm_a',profile:profile('pm_a','<이웃 & Neighbor>')}]};
const event={id:'speech',at:1800000000000,tick:1,source:'live',kind:'greet',muse:'01-sunny',other:'pm_a',line:'Hello, Moss.',data:{}};
test('Feed and evidence descriptions address the explicit public actor, never a name mentioned in speech',()=>{
 const text=describe(event,world);assert.match(text,/→ <이웃 & Neighbor>/);assert.doesNotMatch(text,/→ Moss/);
});
test('Spotlight speech can address an explicit target_agent without treating a destination as a person',()=>{
 const text=describe({...event,kind:'spotlight',other:null,data:{freedom:'who',decision:'greet',target_agent:'02-moss',target:'commons:cafe'}},world);
 assert.match(text,/→ Moss/);assert.doesNotMatch(text,/→ commons:cafe/);
});
test('self speech, absent or unknown recipients and a place target do not invent an addressee',()=>{
 for(const patch of [{other:'01-sunny'},{other:null},{other:'pm_unknown'},{other:null,data:{target:'02-moss'}},{other:null,line:null}])assert.doesNotMatch(describe({...event,...patch},world),/→/);
 for(const other of[null,'01-sunny']){const text=describe({...event,other},world);assert.match(text,/Sunny speaks/);assert.doesNotMatch(text,/greets World|greets Sunny/);}
});
test('recorded descriptions use only their supplied snapshot profile',()=>{
 const recorded={muses:[{id:'01-sunny'},{id:'pm_a',profile:profile('pm_a','Recorded neighbor')}]};
 assert.match(describe(event,recorded),/→ Recorded neighbor/);assert.doesNotMatch(describe(event,recorded),/이웃/);
});
test('selected card keeps the exact line, gives the arrow a bilingual spoken label, and clears it on the next non-speech frame',()=>{
 const element=()=>({children:[],attrs:{},set textContent(text){this.text=text;this.children=[];},get textContent(){return this.children.length?this.children.map(c=>c.textContent).join(''):this.text;},set innerHTML(_){throw Error('must never parse public names or speech');},setAttribute(k,v){this.attrs[k]=v;},replaceChildren(...children){this.children=children;}}),node=element();node.ownerDocument={createElement:element};
 const frame={id:'01-sunny',line:event.line,cue:{eventId:event.id,partner:'02-moss'}};
 paintFrameSpeech(node,frame,world,[event],'Inventory');
 assert.equal(node.children[0].textContent,'→ <이웃 & Neighbor>: Hello, Moss.');assert.equal(node.children[0].attrs['aria-hidden'],'true');assert.equal(node.children[1].textContent,'To <이웃 & Neighbor> / <이웃 & Neighbor>에게: Hello, Moss.');
 node.textContent='A scripted Story line';assert.equal(node.textContent,'A scripted Story line');assert.equal(node.children.length,0);
 paintFrameSpeech(node,{...frame,line:null},world,[event],'Inventory');assert.equal(node.text,'Inventory');assert.equal(node.children.length,0);
});
test('an animation partner, different speaker, invalid public profile or missing event cannot create a speech recipient',()=>{
 const frame={id:'01-sunny',line:'Original',cue:{eventId:event.id,partner:'02-moss'}};
 for(const [w,events] of [[world,[]],[world,[{...event,muse:'02-moss'}]],[world,[{...event,other:null}]],[{muses:[{id:'pm_a',profile:profile('foreign','Not mine')}]},[event]]]){
  assert.deepEqual(frameSpeech(frame,w,events),{text:'Original',recipient:null});
 }
});
