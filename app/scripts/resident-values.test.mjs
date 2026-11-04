import {sha256Hex} from '../src/engine/sha256.ts';
import test from 'node:test';import assert from 'node:assert/strict';
import {HARNESSES,harnessById,harnessRoleId,ACTOR_IDS} from '../src/engine/harness.ts';
import {createWorld,tick} from '../src/engine/world.ts';
import * as actions from '../worker/core/actions.ts';
const {buildMessages,validate,residentPersona}=actions;
import {activityMessages} from '../worker/core/resident-activity-schema.ts';
import {resolveSocialStatus,personalApproachProbability} from '../src/engine/social-status.ts';
const values=await import('../src/engine/resident-values.ts').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const input={muse:'nr_olive',freedom:'where',localTime:'18:00',place:'Commons Cafe',places:[],muses:[],items:[],memory:[]};
test('confirmed values have exactly the 26 fixed resident IDs, never a personal identity, with immutable bounded fields',()=>{
 assert(Array.isArray(values.RESIDENT_VALUES));const rows=values.RESIDENT_VALUES;assert.equal(rows.length,26);assert.equal(new Set(rows.map(r=>r.id)).size,26);
 assert.deepEqual(rows.map(r=>r.id).sort(),ACTOR_IDS.filter(id=>!['00-jolly','10-judge'].includes(id)).sort());assert.equal(rows.filter(r=>r.type[0]==='E').length,12);
 for(const r of rows){assert.match(r.type,/^[EI][SN][TF][JP]$/);assert(r.values.length>=1&&r.values.length<=2);assert.equal(r.role,harnessById(r.id).role);assert(Object.isFrozen(r));assert(Object.isFrozen(r.values));}
 for(const id of['00-jolly','pm_someone','nr_unknown'])assert.equal(values.residentValues(id),null);
});
test('opt-in persona overrides preserve every existing role, skills, likes, tools, Wants and role item without mutating global templates',()=>{
 const before=JSON.stringify(HARNESSES);for(const id of ACTOR_IDS){const base=harnessById(id),on=harnessById(id,{residentValuesEnabled:true});assert.deepEqual(harnessById(id,{residentValuesEnabled:false}),base);
 for(const k of['id','name','role','skills','tools','wants','roleItem'])assert.deepEqual(on[k],base[k]);assert.deepEqual(on.persona.likes,base.persona.likes);
 if(id==='00-jolly')assert.deepEqual(on,base);else {const r=values.residentValues(id);assert.equal(on.persona.traits,r.traits);assert.equal(on.persona.voice,r.voice);}}
 assert.equal(JSON.stringify(HARNESSES),before);assert.equal(harnessRoleId('nr_olive'),'01-sunny');assert.notEqual(harnessById('nr_olive',{residentValuesEnabled:true}).persona.traits,harnessById('nr_alba',{residentValuesEnabled:true}).persona.traits);
});
test('prompts opt in only through trusted boolean true; external validation strips the flag, with no persona substitution for 00',()=>{
 const off=buildMessages('spotlight',input);assert.deepEqual(buildMessages('spotlight',{...input,residentValuesEnabled:false}),off);assert.deepEqual(buildMessages('spotlight',{...input,residentValuesEnabled:'true'}),off);
 const on=JSON.stringify(buildMessages('spotlight',{...input,residentValuesEnabled:true}));assert.match(on,/ENFP/);assert(on.includes('새로움'));assert(on.includes('낯선 이들을 즉흥으로 엮어 주는 호스트'));assert.match(on,/not an assessment/);
 assert.equal(validate('spotlight',{...input,residentValuesEnabled:true}).residentValuesEnabled,undefined);
 assert.equal(typeof residentPersona,'function');for(const id of['00-jolly','pm_someone','nr_unknown'])assert.equal(residentPersona(id),'');
 assert.deepEqual(buildMessages('spotlight',{...input,muse:'00-jolly',residentValuesEnabled:true}),buildMessages('spotlight',{...input,muse:'00-jolly'}));
});
test('activity choice receives LA local rhythm context and advisory durations while flag OFF keeps the exact existing message list',()=>{
 const off=activityMessages(input,null);assert.deepEqual(activityMessages({...input,residentValuesEnabled:false},null),off);
 const on=JSON.stringify(activityMessages({...input,localTime:'08:00',residentValuesEnabled:true},null));assert.match(on,/evening/);assert.match(on,/outside/);assert.match(on,/longer/);assert.match(on,/not.*required|not.*force/);
});
test('rhythm intervals are LA-time half-open, including night midnight wrap and DST, never budget KST',()=>{
 assert.equal(typeof values.residentRhythm,'function');for(const [id,start,end]of[['02-moss',6,11],['03-ripple',11,17],['01-sunny',17,22]]){assert.equal(values.residentRhythm(id,start).active,true);assert.equal(values.residentRhythm(id,end).active,false);}
 for(const hour of[20,23,0,1])assert.equal(values.residentRhythm('08-orbit',hour).active,true);for(const hour of[2,19])assert.equal(values.residentRhythm('08-orbit',hour).active,false);
 assert.equal(values.residentLocalHour(Date.parse('2026-11-04T02:00:00Z')),18);assert.equal(values.residentLocalHour(Date.parse('2026-07-04T01:00:00Z')),18);
 assert.equal(values.residentRhythm('pm_unknown',18),null);assert.equal(values.residentRhythm('01-sunny',NaN),null);
 const a=values.residentRhythm('01-sunny',18),b=values.residentRhythm('01-sunny',8);assert(b.moveMultiplier<a.moveMultiplier);assert(b.stayMultiplier>a.stayMultiplier);
});
test('status welcomes stationary residents at every rhythm while keeping owner preference and explicit busy actions',()=>{
 const at=Date.parse('2026-11-04T16:00:00Z'),s=createWorld('rhythm',at),sun=s.muses.find(m=>m.id==='01-sunny');sun.travel=null;sun.beat=null;
 assert.equal(resolveSocialStatus(s,sun.id,at,'auto',false),'welcoming');assert.equal(resolveSocialStatus(s,sun.id,at,'auto',true),'welcoming');assert.equal(resolveSocialStatus(s,sun.id,at,'welcoming',true),'welcoming');
 const evening=Date.parse('2026-11-04T02:00:00Z');assert.equal(resolveSocialStatus(s,sun.id,evening,'auto',true),'welcoming');sun.travel={to:'commons:cafe',departAt:evening,arriveAt:evening+60000,speed:'walk'};assert.equal(resolveSocialStatus(s,sun.id,evening,'auto',true),'busy');sun.travel=null;sun.beat={id:'craft',clip:'think',startedAt:evening,endsAt:evening+60000,line:null};assert.equal(resolveSocialStatus(s,sun.id,evening,'auto',true),'busy');
 assert.equal(resolveSocialStatus(s,'00-jolly',at,'auto',true),resolveSocialStatus(s,'00-jolly',at));sun.controlMode='personal';sun.beat=null;assert.equal(resolveSocialStatus(s,sun.id,at,'auto',true),'welcoming');
});
test('E/I approach probabilities apply to the actual resident, never its reusable role, and both remain nonzero only for welcoming',()=>{
 const at=Date.parse('2026-11-04T02:00:00Z'),s=createWorld('social-values',at),p=s.muses[0];p.controlMode='personal';
 s.muses.push({...structuredClone(s.muses[6]),id:'nr_fable'},{...structuredClone(s.muses[6]),id:'nr_marlow'});
 const e=personalApproachProbability(s,'nr_fable',p.id,at,'welcoming',true),i=personalApproachProbability(s,'nr_marlow',p.id,at,'welcoming',true);assert(e>i&&i>0);
 assert.equal(personalApproachProbability(s,'01-sunny',p.id,at,'busy',true),0);assert.equal(personalApproachProbability(s,'00-jolly','01-sunny',at,'welcoming',true),0);
});
test('opt-in RULE fallback has less wandering and longer stays outside rhythm; OFF and personal control remain unchanged',()=>{
 const at=Date.parse('2026-11-04T16:00:00Z');let oldMoves=0,onMoves=0,oldDuration=0,onDuration=0,stays=0;
 for(let n=0;n<300;n++){const s=createWorld('rule',at);s.seed='values-'+n;s.muses=s.muses.filter(m=>m.id==='01-sunny');const m=s.muses[0];m.place='commons:cafe';m.beat=null;m.travel=null;
 const input={now:at,residentActors:[m.id],residentFallback:[m.id]},off=tick(s,input),explicit=tick(s,input,{residentValuesEnabled:false}),on=tick(s,input,{residentValuesEnabled:true});assert.deepEqual(explicit,off);
 oldMoves+=!!off.state.muses[0].travel;onMoves+=!!on.state.muses[0].travel;
 if(off.state.muses[0].beat&&on.state.muses[0].beat){oldDuration+=off.state.muses[0].beat.endsAt-at;onDuration+=on.state.muses[0].beat.endsAt-at;stays++;}}
 assert(onMoves<oldMoves,`outside rhythm moves ${onMoves} vs ${oldMoves}`);assert(stays>0&&onDuration>oldDuration);
 const s=createWorld('personal',at);s.muses=s.muses.slice(0,1);s.muses[0].controlMode='personal';assert.deepEqual(tick(s,{now:at},{residentValuesEnabled:true}),tick(s,{now:at}));
});
test('actual new automatic encounter uses E/I tendencies for residents and leaves explicit intents and absent flag unchanged',()=>{
 const at=Date.parse('2026-11-04T02:00:00Z');let e=0,i=0;
 for(let n=0;n<400;n++)for(const [ids,key]of[[['01-sunny','07-tempo'],'e'],[['02-moss','05-bloom'],'i']]){
  const s=createWorld('approach',at);s.seed='approach-'+n;s.muses=s.muses.filter(m=>ids.includes(m.id));for(const m of s.muses){m.place='commons:cafe';m.beat={id:'look_around',clip:'look_around',startedAt:at,endsAt:at+3600000,line:null};m.travel=null;m.lastMet={};m.intent=null;}
  const h={residentValuesEnabled:true,socialStatus:()=> 'welcoming',canMeet:()=>({ok:true,event:null})};const out=tick(s,{now:at},h);if(out.events.some(e=>e.kind==='encounter'))key==='e'?e++:i++;
  if(n===0){s.muses[0].intent={kind:'greet',target:s.muses[1].id};assert(tick(s,{now:at},h).events.some(e=>e.kind==='encounter'));assert(tick(s,{now:at},{...h,residentValuesEnabled:false}).events.some(e=>e.kind==='encounter'));}
 }
 assert(e>i&&i>0&&e<400,`E=${e}, I=${i}: neither fixed or zero approach`);
});
test('all confirmed entries match the reviewed table bytes and rhythm places only reweight valid catalog candidates',()=>{
 assert.equal(sha256Hex(JSON.stringify(values.RESIDENT_VALUES)),'30c631e42a149b613496503f96ac93693c4cf1062ebf53858ef7337141e1427b');
 assert.equal(typeof values.residentPlaceWeight,'function');assert(values.residentPlaceWeight('01-sunny','campfire',18)>values.residentPlaceWeight('01-sunny','workbench',18));assert(values.residentPlaceWeight('08-orbit','park',23)>values.residentPlaceWeight('08-orbit','workbench',23));
 assert.equal(values.residentPlaceWeight('00-jolly','campfire',18),1);assert.equal(values.residentPlaceWeight('pm_unknown','park',23),1);
});

test('universal English policy is the only added line; values-OFF retains original C38b4bc2 persona, activity prompt and tick bytes',()=>{
 const englishPolicy='Always speak in English. All public speech and public_reason text must be English, even when your character description or incoming words use another language. Preserve the exact public names of Muses and places.';
 const withoutUniversalEnglish=messages=>{
  const lines=messages.flatMap(m=>typeof m.content==='string'?m.content.split('\n'):[]);
  assert.equal(lines.filter(line=>line===englishPolicy).length,1,'exactly one standalone universal English policy line');
  return messages.map(m=>typeof m.content==='string'?{...m,content:m.content.split('\n').filter(line=>line!==englishPolicy).join('\n')}:m);
 };
 assert.equal(sha256Hex(JSON.stringify(withoutUniversalEnglish(buildMessages('spotlight',input)))),'4437cd0045bc88065beff7993e4f5c4d631b84e17cad81768e521d5d3df993d7');
 assert.equal(sha256Hex(JSON.stringify(withoutUniversalEnglish(activityMessages(input,null)))),'de49e1fd7cb6614c0408112a40a3d16e9b37f23985a8e7c641e0e1527ab2cbe9');
 const at=Date.parse('2026-11-04T16:00:00Z'),s=createWorld('off-golden',at);assert.equal(sha256Hex(JSON.stringify(tick(s,{now:at}))),'cd6416eba05c2e7f7e8df2070bd9262f983c0c190af26907a1f09845c33a73f4');
 assert.deepEqual(['01-sunny','nr_olive'].map(harnessById),['01-sunny','nr_olive'].map(id=>harnessById(id)));
});


test('outside rhythm lowers only resident-initiated personal approach weight; a quiet peer remains available',()=>{
 const inside=Date.parse('2026-11-04T02:00:00Z'),outside=Date.parse('2026-11-04T16:00:00Z'),s=createWorld('personal-approach-rhythm',inside);
 const p=s.muses[0];p.controlMode='personal';p.travel=null;p.beat=null;
 const active=personalApproachProbability(s,'01-sunny',p.id,inside,'welcoming',true),quiet=personalApproachProbability(s,'01-sunny',p.id,outside,'welcoming',true);
 assert.equal(active,.45);assert.equal(quiet,active*values.residentRhythm('01-sunny',8).moveMultiplier);assert(quiet>0&&quiet<active);
 assert.equal(resolveSocialStatus(s,'01-sunny',outside,'auto',true),'welcoming');
 assert.equal(personalApproachProbability(s,'01-sunny',p.id,outside,'busy',true),0);assert.equal(personalApproachProbability(s,'01-sunny',p.id,outside,'do_not_disturb',true),0);
 assert.equal(personalApproachProbability(s,'01-sunny',p.id,outside,'welcoming',false),personalApproachProbability(s,'01-sunny',p.id,inside,'welcoming',false));
 assert.equal(personalApproachProbability(s,p.id,'01-sunny',outside,'welcoming',true),0);
});
