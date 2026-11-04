import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,lastConversationAt} from '../src/engine/world.ts';
import {reactionCandidates} from '../worker/core/resident-activity.ts';
const NOW=Date.parse('2026-11-04T07:45:00Z'), A='01-sunny',B='02-moss';
function world(){const s=createWorld('wave-cooldown',NOW);s.paused={};for(const m of s.muses){m.place='commons:cafe';m.beat=null;m.travel=null;m.intent=null;s.paused[m.id]=![A,B].includes(m.id);}return s;}
const turn=(s,at,status='welcoming',extra={})=>tick(s,{now:at,spot:{muse:'00-jolly',priority:false},residentGoalIdle:[A,B]}, {socialStatus:()=>status,...extra});
test('a busy wave leaves conversation available when both welcome one minute later',()=>{let s=world();const first=turn(s,NOW,'busy');assert.equal(first.events.filter(e=>e.kind==='resident_wave').length,1);assert.equal(first.state.muses.find(m=>m.id===A).lastMet[B],undefined);const next=turn(first.state,NOW+60000);assert.equal(next.events.filter(e=>e.kind==='encounter').length,1);assert.equal(turn(next.state,NOW+120000).events.filter(e=>e.kind==='encounter').length,0);});
test('complete public receipts distinguish old wave pollution from a real conversation',()=>{const s=world();s.muses.find(m=>m.id===A).lastMet[B]=NOW; s.muses.find(m=>m.id===B).lastMet[A]=NOW;
 const receipt={at:NOW,muse:A,other:B};
 assert.equal(turn(s,NOW+60000,'welcoming',{conversationHistory:[{...receipt,kind:'resident_wave'}]}).events.filter(e=>e.kind==='encounter').length,1);
 for(const kind of ['encounter','greet','encounter_reply'])assert.equal(turn(s,NOW+60000,'welcoming',{conversationHistory:[{...receipt,kind}]}).events.filter(e=>e.kind==='encounter').length,0);
 assert.equal(turn(s,NOW+1800000,'welcoming',{conversationHistory:[{...receipt,kind:'encounter'}]}).events.filter(e=>e.kind==='encounter').length,1);
 assert.equal(turn(s,NOW+60000).events.filter(e=>e.kind==='encounter').length,0,'no complete receipt source preserves conservative old cooldown');
});
test('wave recovery retains do-not-disturb, credentials, distance and actor control gates',()=>{const s=world();assert.equal(turn(s,NOW,'do_not_disturb').events.some(e=>['encounter','resident_wave'].includes(e.kind)),false);assert.equal(turn(s,NOW,'welcoming',{canMeet:()=>({ok:false,event:null})}).events.some(e=>['encounter','resident_wave'].includes(e.kind)),false);const far=structuredClone(s);far.muses.find(m=>m.id===B).place='commons:garden';assert.equal(turn(far,NOW).events.some(e=>e.kind==='encounter'),false);const personal=structuredClone(s);personal.muses.find(m=>m.id===A).controlMode='personal';const reaction={kind:'wave',triggerId:'passby:control',reply:{muse:A,other:B,place:'commons:cafe',encounterId:'control',source:'rule',output:null}};const r=tick(personal,{now:NOW,spot:{muse:'00-jolly',priority:false},residentActors:[A],residentGoalIdle:[A,B],residentReactions:[reaction]},{socialStatus:()=> 'do_not_disturb'});assert.equal(r.events.some(e=>e.muse===A&&e.kind==='resident_wave'),false);});
test('passby wave does not consume a conversation; an actual passby reply still does',()=>{for(const kind of ['wave','reply']){const s=world();s.muses.find(m=>m.id===B).travel={to:'commons:garden',departAt:NOW,arriveAt:NOW+600000,speed:'walk'};const r=tick(s,{now:NOW,spot:{muse:'00-jolly',priority:false},residentActors:[A],residentGoalIdle:[A],residentReactions:[{kind,triggerId:'passby:test',reply:{muse:A,other:B,place:'commons:cafe',encounterId:'passby:test',source:'rule',output:null}}]},{socialStatus:()=> 'welcoming'});assert.equal(r.state.muses.find(m=>m.id===A).lastMet[B],kind==='reply'?NOW:undefined);}});

test('passby candidates use complete conversation receipts and same-batch real contact',()=>{const s=world();s.muses.find(m=>m.id===B).travel={to:'commons:garden',departAt:NOW,arriveAt:NOW+600000,speed:'walk'};s.muses.find(m=>m.id===A).lastMet[B]=NOW;const kind=id=>id==='00-jolly'?'legacy':'resident',status=()=> 'welcoming',receipt={at:NOW,muse:A,other:B};
 assert.equal(reactionCandidates(s,[],[],NOW+60000,kind,status).candidates.some(c=>c.muse===A),false);
 assert.equal(reactionCandidates(s,[],[],NOW+60000,kind,status,undefined,false,[{...receipt,kind:'resident_wave'}]).candidates.some(c=>c.muse===A),true);
 const event={...receipt,id:'committed',tick:0,source:'rule',kind:'encounter',data:{},tags:[]};
 assert.equal(reactionCandidates(s,[event],[],NOW+60000,kind,status,undefined,false,[]).candidates.some(c=>c.muse===A),false);
 assert.equal(lastConversationAt(s,A,B,NOW+60000,[],[event]),NOW);
});
test('outside rhythm lowers autonomous approaches without changing explicit intent or replies',()=>{const active=Date.parse('2026-11-04T04:00:00Z'),outside=NOW;let inside=0,out=0;
 for(let i=0;i<200;i++){for(const [at,key] of [[active,'in'],[outside,'out']]){const s=world();s.seed='rhythm-'+i;const r=tick(s,{now:at,spot:{muse:'00-jolly',priority:false},residentGoalIdle:[A,B]},{socialStatus:()=> 'welcoming',residentValuesEnabled:true});const n=r.events.filter(e=>e.kind==='encounter').length;if(key==='in')inside+=n;else out+=n;}}
 assert(inside>out&&out>0,JSON.stringify({inside,out}));
 const s=world();s.muses.find(m=>m.id===A).intent={target:B};assert.equal(turn(s,NOW,'welcoming',{residentValuesEnabled:true}).events.filter(e=>e.kind==='encounter').length,1);
 const incoming={id:'real-greeting',at:NOW,muse:B,other:A,kind:'greet',data:{public:true},line:'Hello'};assert.equal(reactionCandidates(world(),[incoming],[],NOW,id=>id==='00-jolly'?'legacy':'resident',()=> 'welcoming').candidates.find(c=>c.muse===A)?.kind,'reply');
});
