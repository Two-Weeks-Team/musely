import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/engine/world.ts';
import {RESIDENT_VALUES} from '../src/engine/resident-values.ts';
import {harnessRoleId} from '../src/engine/harness.ts';
const api=await import('../src/engine/resident-utterance.ts');
const subject=()=>{assert.ok(api,'resident utterance helper is required');return api;};
const NOW=Date.parse('2026-11-04T05:00:00Z'); // 21:00 in the world, not budget KST.
function world(){const s=createWorld('utterance-fixture',NOW);for(const r of RESIDENT_VALUES.filter(r=>r.id.startsWith('nr_'))){const role=harnessRoleId(r.id);s.muses.push({...structuredClone(s.muses.find(m=>m.id===role)),id:r.id,residentRole:role});}for(const m of s.muses){m.place='commons:benches';m.travel=null;m.beat=null;}return s;}
test('26 confirmed residents have distinct RULE voices for the actual available sky activity, without invented stars or listeners',()=>{
 const s=world(),before=JSON.stringify(s),lines=RESIDENT_VALUES.map(r=>subject().ruleResidentUtterance(s,r.id,'observe_sky',NOW));
 assert.equal(lines.length,26);assert.equal(new Set(lines).size,26);
 for(const line of lines){assert.equal(typeof line,'string');assert.match(line,/looking at the sky/i);assert.doesNotMatch(line,/Vega|Gather round|met |traded|everyone|calendar|private/i);assert.ok([...line].length<=140);}
 assert.equal(JSON.stringify(s),before);
});
test('same-role storykeepers retain their own confirmed warm, playful and careful voices',()=>{
 const s=world();for(const m of s.muses)m.place='commons:campfire';
 const lines=['04-ember','nr_dara','nr_rowan'].map(id=>subject().ruleResidentUtterance(s,id,'tell_story',NOW));
 assert.equal(new Set(lines).size,3);for(const line of lines)assert.match(line,/taking time for a story/i);
 assert.match(lines[0],/moment/);assert.match(lines[1],/start of a story/);assert.match(lines[2],/mind/);
});
test('unavailable or unowned activities produce no RULE line and never speak for personal actors',()=>{
 const s=world(),m=s.muses.find(m=>m.id==='02-moss');
 for(const [id,beat] of [['00-jolly','observe_sky'],['pm_unknown','observe_sky'],['unknown','observe_sky'],['02-moss','invented'],['02-moss','garden_plant']])assert.equal(subject().ruleResidentUtterance(s,id,beat,NOW),null);
 assert.equal(subject().ruleResidentUtterance(s,m.id,'observe_sky',NOW-12*3600000),null);
 m.travel={to:'commons:cafe',departAt:NOW,arriveAt:NOW+60000,speed:'walk'};assert.equal(subject().ruleResidentUtterance(s,m.id,'observe_sky',NOW),null);m.travel=null;
 m.profile={actorId:m.id,displayName:'Owner label',appearanceId:m.id,revision:1};assert.equal(subject().ruleResidentUtterance(s,m.id,'observe_sky',NOW),null);delete m.profile;
 m.controlMode='personal';assert.equal(subject().ruleResidentUtterance(s,m.id,'observe_sky',NOW),null);delete m.controlMode;
 s.paused={[m.id]:{at:NOW,version:1,by:'fixture'}};assert.equal(subject().ruleResidentUtterance(s,m.id,'observe_sky',NOW),null);
});
test('30 minute duplicate filter spans LIVE and RULE and normalizes Unicode, case and whitespace without replacing LIVE words',()=>{
 const f=(...args)=>subject().filterResidentUtterance(world(),...args).line,recent=[{muse:'03-ripple',at:NOW-1,line:'ＴＡＫＥ  a\n pause.'}];
 assert.equal(f('03-ripple','Take a pause.',NOW,recent),null);
 assert.equal(f('03-ripple','A different LIVE sentence.',NOW,recent),'A different LIVE sentence.');
 assert.equal(f('nr_cedar','Take a pause.',NOW,recent),'Take a pause.');
 assert.equal(f('03-ripple','Take a pause.',NOW+1800000-1,recent),'Take a pause.');
 assert.equal(f('03-ripple','Take a pause.',NOW,[{...recent[0],at:NOW-1800000}]),'Take a pause.');
 assert.deepEqual(recent,[{muse:'03-ripple',at:NOW-1,line:'ＴＡＫＥ  a\n pause.'}]);
});
test('silencing a repeated line leaves its action and provider evidence intact, including same-commit duplicates',()=>{
 const f=(...args)=>subject().filterResidentUtterance(world(),...args).line,events=[],action={kind:'beat',muse:'03-ripple',at:NOW,line:'Looking around.',data:{minutes:15,evidence:{requestId:'public-fixture-request'}}};
 for(let i=0;i<2;i++)events.push({...action,line:f(action.muse,action.line,NOW,events)});
 assert.equal(events[0].line,action.line);assert.equal(events[1].line,null);
 for(const e of events){assert.equal(e.kind,'beat');assert.equal(e.data.minutes,15);assert.equal(e.data.evidence.requestId,'public-fixture-request');}
 assert.equal(f('00-jolly',action.line,NOW,[action]),action.line);
 assert.equal(f('pm_unknown',action.line,NOW,[{...action,muse:'pm_unknown'}]),action.line);
});
test('empty or invalid resident speech clocks fail closed and irrelevant historical rows do not invent speech',()=>{
 const f=(...args)=>subject().filterResidentUtterance(world(),...args).line;
 for(const at of [NaN,Infinity,-1])assert.equal(f('01-sunny','Hello.',at,[]),null);
 assert.equal(f('01-sunny',null,NOW,[]),null);assert.equal(f('01-sunny','   ',NOW,[]),null);
 assert.equal(f('01-sunny','Hello.',NOW,[{muse:'01-sunny',at:NOW-1,line:null},{muse:'01-sunny',at:NOW+1,line:'Hello.'}]),'Hello.');
});
test('current connected operator or a profiled actor keeps its own signed speech untouched',()=>{
 const s=world(),recent=[{muse:'04-ember',line:'My own words.',at:NOW-1}];s.inbox.connected['04-ember']=NOW;
 assert.equal(subject().filterResidentUtterance(s,'04-ember','My own words.',NOW,recent).line,'My own words.');
 assert.equal(subject().ruleResidentUtterance(s,'04-ember','observe_sky',NOW),null);
 const m=s.muses.find(m=>m.id==='03-ripple');m.profile={actorId:m.id,displayName:'Private owner label',appearanceId:m.id,revision:1};
 assert.equal(subject().filterResidentUtterance(s,m.id,'My own words.',NOW,[{...recent[0],muse:m.id}]).line,'My own words.');
});
test('repeat decision exposes only the suppression reason for next-input bookkeeping',()=>{
 const decision=subject().filterResidentUtterance(world(),'03-ripple','Same line.',NOW,[{muse:'03-ripple',line:'Same line.',at:NOW-1}]);
 assert.deepEqual(decision,{line:null,reason:'resident_line_repeat'});
});
