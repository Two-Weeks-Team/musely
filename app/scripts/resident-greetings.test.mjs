// Offline persona RULE greetings; no provider, user account or live world calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick} from '../src/engine/world.ts';
import {RESIDENT_VALUES} from '../src/engine/resident-values.ts';
import {harnessRoleId} from '../src/engine/harness.ts';
import {placeById} from '../src/engine/places.ts';
import {makeHooks,resolveMeeting} from '../src/engine/rules.ts';
import * as speech from '../src/engine/resident-utterance.ts';
const NOW=Date.parse('2026-11-04T05:00:00Z');
function world(){const s=createWorld('greeting-fixture',NOW);for(const r of RESIDENT_VALUES.filter(r=>r.id.startsWith('nr_'))){const role=harnessRoleId(r.id);s.muses.push({...structuredClone(s.muses.find(m=>m.id===role)),id:r.id,residentRole:role});}for(const m of s.muses){m.place='commons:cafe';m.travel=null;m.beat={id:'resident_stay',clip:'idle_breathe',startedAt:NOW,endsAt:NOW+3600000,line:null};m.intent=null;m.inventory=[];}return s;}
function greet(s,id,to,at=NOW,history=[]){assert.equal(typeof speech.ruleResidentGreeting,'function','persona greeting selector must exist');return speech.ruleResidentGreeting(s,id,to,at,history);}

test('26 confirmed residents each have several distinct short greeting variants in their own voice',()=>{
 const s=world(),before=JSON.stringify(s),all=new Set();
 for(const resident of RESIDENT_VALUES){const recent=[],to=resident.id==='02-moss'?'01-sunny':'02-moss',name=s.muses.find(m=>m.id===to).id==='02-moss'?'Moss':'Sunny';
  for(let n=0;n<4;n++){const line=greet(s,resident.id,to,NOW,recent);assert.equal(typeof line,'string',resident.id+' needs multiple variations');assert.ok(line.includes(name));assert.ok([...line].length<=140);assert.doesNotMatch(line,/^Hi .*!$|Vega|we traded|you agreed|your owner|private calendar/i);assert.ok(!recent.some(e=>e.line===line));assert.ok(!all.has(line),resident.id+' must retain a distinct voice');recent.push({muse:resident.id,other:to,at:NOW,line});all.add(line);}
  assert.equal(greet(s,resident.id,to,NOW,recent),null,'an exhausted voice must stay quiet instead of repeating');
 }
 assert.equal(JSON.stringify(s),before,'selection must not add state or change role, skills, Wants or authority');
});

test('same sender to same recipient cannot repeat inside thirty minutes; exact boundary and other peers remain available',()=>{
 const s=world(),id='04-ember',to='nr_dara',first=greet(s,id,to),history=[{muse:id,other:to,at:NOW,line:first}];
 assert.notEqual(greet(s,id,to,NOW+1799999,history),first);assert.equal(greet(s,id,to,NOW+1800000,history),first);
 assert.notEqual(greet(s,id,'02-moss',NOW,history),null);assert.equal(greet(s,id,to,NOW,[]),first);
 assert.notEqual(greet(s,id,to,NOW,[{...history[0],line:first.toUpperCase().replaceAll(' ','  ')}]),first);
});

test('no persona greetings are generated for personal, connected, profiled, paused, missing or self actors',()=>{
 const s=world();for(const id of['00-jolly','pm_unknown','unknown'])assert.equal(greet(s,id,'02-moss'),null);assert.equal(greet(s,'02-moss','02-moss'),null);assert.equal(greet(s,'02-moss','missing'),null);
 const m=s.muses.find(m=>m.id==='04-ember');s.inbox.connected[m.id]=NOW;assert.equal(greet(s,m.id,'02-moss'),null);delete s.inbox.connected[m.id];m.controlMode='personal';assert.equal(greet(s,m.id,'02-moss'),null);delete m.controlMode;
 m.profile={actorId:m.id,displayName:'My own name',appearanceId:m.id,revision:1};assert.equal(greet(s,m.id,'02-moss'),null);delete m.profile;(s.paused??={})[m.id]={at:NOW,version:1,by:'fixture'};assert.equal(greet(s,m.id,'02-moss'),null);
});

test('selected RULE greeting reaches both public event and connected recipient inbox; silence never sends stale Hi text',()=>{
 for(const line of['There is room for a quiet story, Jolly.',null]){const s=world(),a=s.muses.find(m=>m.id==='04-ember'),b=s.muses.find(m=>m.id==='00-jolly');b.controlMode='personal';s.inbox.connected[b.id]=NOW;
 const events=resolveMeeting(s.items,s,a,b,placeById(a.place),()=>0,NOW,undefined,line);assert.equal(events.find(e=>e.kind==='greet').line,line);assert.equal(s.inbox.messages.length,line?1:0);if(line)assert.equal(s.inbox.messages[0].text,line);
 }
});

test('explicit new greeting hook changes only speech; legacy hook retains old greeting and encounter cooldown',()=>{
 const s=world(),a=s.muses.find(m=>m.id==='04-ember'),b=s.muses.find(m=>m.id==='00-jolly');s.muses=[a,b];b.controlMode='personal';s.inbox.connected[b.id]=NOW;a.intent={kind:'greet',target:b.id};
 const base={...makeHooks(),residentValuesEnabled:true,residentSpeechHistory:[]};
 const old=tick(s,{now:NOW},base),next=tick(s,{now:NOW},{...base,residentGreetingsEnabled:true});
 assert.equal(old.events.find(e=>e.kind==='greet')?.line,'Hi Jolly!');assert.ok(next.events.find(e=>e.kind==='greet')?.line);assert.notEqual(next.events.find(e=>e.kind==='greet').line,'Hi Jolly!');
 assert.deepEqual(next.events.map(e=>e.kind),old.events.map(e=>e.kind));assert.equal(next.state.muses.find(m=>m.id===a.id).lastMet[b.id],NOW);assert.equal(next.state.muses.find(m=>m.id===b.id).lastMet[a.id],NOW);
 assert.equal(next.state.inbox.messages[0].text,next.events.find(e=>e.kind==='greet').line);assert.equal(next.events.find(e=>e.kind==='greet').source,'rule');assert.equal(next.events.some(e=>e.muse===b.id&&e.line),false);
 const again=tick(next.state,{now:NOW+60000},{...base,residentGreetingsEnabled:true});assert.equal(again.events.some(e=>e.kind==='greet'),false,'the interaction cooldown is unchanged');
});

test('long public recipient names remain literal data and every persona greeting stays within speech size',()=>{
 const s=world(),peer=s.muses.find(m=>m.id==='00-jolly'),name='$& {name} '+ 'x'.repeat(30);peer.profile={actorId:peer.id,displayName:name,appearanceId:peer.id,revision:1};
 for(const r of RESIDENT_VALUES){const history=[];for(let i=0;i<4;i++){const line=greet(s,r.id,peer.id,NOW,history);assert.ok(line.includes(name));assert.ok([...line].length<=140);history.push({muse:r.id,at:NOW,line});}}
});
