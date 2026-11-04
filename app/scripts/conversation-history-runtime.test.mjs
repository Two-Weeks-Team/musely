import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bootWorldDo} from './test-support/world-life-harness.mjs';

test('installed contact history is a complete public metadata window, not a tail or private message projection',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1',envOverrides:{SOCIAL_STATUS_MODE:'public-v1'}}),now=Date.now()+60000;
 a.runtime.commitExternal(now,'fixture-contact-history',(_s,emit)=>{
  const row=(kind,at,muse,other,data={})=>emit({at,source:'rule',kind,muse,other,line:'PRIVATE_CONTACT_SOURCE_CANARY',data,tags:[]});
  row('encounter',now-1800000,'01-sunny','02-moss');
  for(let i=0;i<520;i++)row('resident_wave',now-500-i,'03-ripple','06-ink');
  row('greet',now-300,'01-sunny','02-moss',{public:false,privateReason:'PRIVATE_REASON_CANARY'});
  row('greet',now-200,'02-moss','01-sunny',{public:true,privateReason:'PRIVATE_REASON_CANARY'});
  row('resident_passby',now-100,'01-sunny','02-moss');
  row('encounter_reply',now,'01-sunny','02-moss');
  row('encounter',now-1800001,'09-copper','04-ember');
 });
 const history=a.runtime.engineHooks(now).conversationHistory;
 assert.ok(Array.isArray(history),'trusted runtime must supply complete committed contact metadata');
 assert.equal(history.length,524);
 assert.ok(history.some(e=>e.kind==='encounter'&&e.at===now-1800000));
 assert.equal(history.filter(e=>e.kind==='greet').length,1);
 assert.ok(history.every(e=>Object.keys(e).sort().join(',')==='at,kind,muse,other'));
 assert.doesNotMatch(JSON.stringify(history),/PRIVATE_CONTACT_SOURCE_CANARY|PRIVATE_REASON_CANARY/);
 assert.deepEqual(a.runtime.engineHooks(now+1800001).conversationHistory,[]);
});

test('a committed busy wave cannot suppress the next real conversation, while that conversation still consumes cooldown',async t=>{
 const a=await bootWorldDo(t,{mode:'sandbox-v1'}),now=Date.now()+60000;
 a.runtime.opts.residentValuesEnabled=false;
 a.runtime.opts.meetingGate='off'; // Local behavioral fixture; production verification is unchanged.
 a.runtime.opts.socialStatus=()=> 'welcoming';
 a.edit(s=>{for(const m of s.muses){m.travel=null;m.intent=null;m.place='commons:campfire';m.beat={id:'resident_stay',clip:'idle_breathe',startedAt:now-60000,endsAt:now+3600000,line:null};if(!['01-sunny','02-moss'].includes(m.id))(s.paused??={})[m.id]={at:now,version:1,by:'fixture'};}const x=s.muses.find(m=>m.id==='01-sunny'),y=s.muses.find(m=>m.id==='02-moss');x.lastMet[y.id]=y.lastMet[x.id]=now-60000;});
 a.runtime.commitExternal(now-60000,'fixture-previous-wave',(_s,emit)=>emit({at:now-60000,source:'rule',kind:'resident_wave',muse:'01-sunny',other:'02-moss',line:null,data:{clip:'wave'},tags:[]}));
 const first=await a.runtime.heartbeat(now);assert.equal(first.status,'committed');
 assert.equal(a.runtime.eventsOfKind(first.tick,'encounter').filter(e=>e.muse==='01-sunny'&&e.other==='02-moss'||e.muse==='02-moss'&&e.other==='01-sunny').length,1);
 const second=await a.runtime.heartbeat(now+60000);assert.equal(second.status,'committed');
 assert.equal(a.runtime.eventsOfKind(second.tick,'encounter').length,0);
});
