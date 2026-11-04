import './ui-language-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
const api=await import('../src/ui/i18n.ts').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
test('Korean browser language uses Korean UI; other browser languages use English',()=>{assert.equal(api.languageOf('ko-KR'),'ko');assert.equal(api.languageOf('ko'),'ko');for(const s of['en-US','fr','',undefined])assert.equal(api.languageOf(s),'en');});
test('product messages select one language including existing bilingual controls',()=>{assert.equal(api.translateFor('ko','About this world'),'이 세계 소개');assert.equal(api.translateFor('en','About this world'),'About this world');assert.equal(api.translateFor('ko','내 Muse / Your Muse'),'내 Muse');assert.equal(api.translateFor('en','내 Muse / Your Muse'),'Your Muse');});
test('tagged messages localize only static wording, preserving public names and messages literally',()=>{const name='<Live world & 이웃>',text='A place to be yourself.';assert.equal(api.translateFor('ko',['Follow ', ''],name),'따라가기: '+name);assert.equal(api.translateFor('en',['Follow ', ''],name),'Follow '+name);assert.equal(api.translateFor('ko',['', ': ', ''],name,text),name+': '+text);});
test('source absence is silent and observed connected actions have scope-specific wording',()=>{assert.equal(api.provenanceLabel(null,'ko'),null);assert.equal(api.provenanceLabel({source:'connected',scope:'current_action'},'ko'),'주인의 Muse가 스스로 함 (connected)');assert.equal(api.provenanceLabel({source:'connected',scope:'recent_action'},'en'),'Recent connected action · owner’s Muse');assert.equal(api.provenanceLabel({source:'scripted',scope:'current_action'},'en'),'Action source · SCRIPTED');});
test('known item, role, common-place and permission labels are product wording',()=>{for(const [en,ko]of[['Coffee','커피'],['Host','호스트'],['Commons Cafe','마을 카페'],['Walk and greet','걷기와 인사']])assert.equal(api.translateFor('ko',en),ko);assert.equal(api.translateFor('ko','custom public name'),'custom public name');});

const {actorProvenance,recentConnectedAction}=await import('../src/ui/actor-provenance.ts');
test('signed wave provenance belongs only to the actor; missing proof is silent and recent stays recent',()=>{
 const e={id:'wave-event',kind:'wave',muse:'pm_actor',other:null,source:'live',at:100,seq:1,data:{actorOrigin:'connected',clip:'wave',envelope:{signer_kind:'server_custodial',message_id:'command',agent_id:'agent',delegation_ref:'delegation',scope:'walk_and_greet',content_hash:'content'}}};
 const world={muses:[{id:'pm_actor'},{id:'pm_listener'}]},frame={id:'pm_actor',cue:{eventId:e.id,kind:'wave'},travel:null,beat:null};
 assert.equal(actorProvenance({actorId:'pm_actor',world,frame,events:[e]})?.source,'connected');
 assert.equal(actorProvenance({actorId:'pm_listener',world,frame:{...frame,id:'pm_listener'},events:[e]}),null);
 assert.equal(actorProvenance({actorId:'pm_actor',world,frame,events:[{...e,data:{actorOrigin:'connected',clip:'wave'}}]}),null);
 const recent=recentConnectedAction('pm_actor',[e]);assert.equal(recent?.scope,'recent_action');
 assert.match(api.provenanceLabel(recent,'en'),/Recent connected action/);assert.match(api.provenanceLabel(recent,'ko'),/최근 연결행동/);
});

test('reverse bilingual author messages choose a single locale',()=>{assert.equal(api.translateFor('ko','Try again. / 다시 해보세요.'),'다시 해보세요.');assert.equal(api.translateFor('en','Try again. / 다시 해보세요.'),'Try again.');});

test('ritual feed descriptions render the verdict in the browser language',async()=>{
 const {build}=await import('esbuild'),r=await build({entryPoints:[new URL('../src/ui/world-panel.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'}),{describe}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');try{for(const language of['ko-KR','en-US'])for(const passed of[true,false]){Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language}});const text=describe({id:'ritual-local',kind:'ritual_judged',muse:'00-jolly',data:{passed,who:'PUBLIC_PERSON'}});assert.match(text,new RegExp(language.startsWith('ko')?(passed?'통과':'통과하지 못함'):(passed?'passed':'not passed')));if(language.startsWith('ko'))assert.doesNotMatch(text,/\bpassed\b/);}}finally{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});

test('nearby location copy retains its neighborhood and on-device privacy guidance in both languages',async()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');try{for(const language of['ko-KR','en-US']){
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language}});const {deviceText}=await import('../src/ui/location-state.ts');
  const text=deviceText({status:'near',preset:'stanford',startedAt:null,at:100});assert.match(text.heading,/Stanford/);
  assert.match(text.detail,language.startsWith('ko')?/보내거나 저장하지 않아요/:/not sent or stored/);assert.match(text.detail,language.startsWith('ko')?/인증은 하지 않아요/:/does not verify/);
 }}finally{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});

test('real missing-partner fallback retains the full public name and localizes only its product template',async()=>{
 const {liveFrames,scheduleCues,CUE_DELAY_MS}=await import('../src/ui/live-scene-core.ts'),at=1800000000000,name='하늘 · Alice';
 const world={worldId:'locale-public',day:'2026-11-04',tick:1,version:1,lastTickAt:at,muses:[{id:'00-jolly',place:'commons:cafe',travel:null,beat:null,inventory:[]},{id:'01-sunny',place:'commons:garden',travel:null,beat:null,inventory:[],profile:{actorId:'01-sunny',displayName:name,appearanceId:'01-sunny',revision:1}}]};
 const e={id:'missing-peer',at,kind:'encounter',source:'rule',muse:'00-jolly',other:'01-sunny',data:{},tags:[]};const f=liveFrames(world,scheduleCues([e]),at+CUE_DELAY_MS+500).get('00-jolly');assert.equal(f.fallback,name+' is not here: fist_bump is shown as wave');
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');try{for(const language of['ko-KR','en-US']){Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language}});const text=api.activityStatus(f.fallback);assert.ok(text.includes(name));assert.match(text,language.startsWith('ko')?/손인사/:/is shown as wave/);assert.equal(api.catalogText(name),name);assert.equal(api.activityStatus('PUBLIC · unknown / fallback'), 'PUBLIC · unknown / fallback');}}finally{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});

test('actual live frame place and humanized activity statuses follow the Korean product grammar',()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');try{Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'ko-KR'}});assert.equal(api.activityStatus('At Commons Cafe'),'마을 카페에 있어요');assert.equal(api.activityStatus('cafe people watch at Commons Cafe'),'카페에서 이웃 구경 · 마을 카페');assert.equal(api.activityStatus('Walking to 하늘 · Alice / studio · ETA 1:20'),'걷는 중 · 하늘 · Alice / studio · 남은 시간 1:20');}finally{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});

test('autonomy server comparison remains canonical for both locales including unmeasured rows',async()=>{
 const {computeAutonomy}=await import('../src/ui/autonomy.ts'),{recountAutonomy,values}=await import('../worker/core/autonomy-oracle.ts');const events=[{id:'rule-beat',kind:'beat',source:'rule',muse:'01-sunny',at:1800000000000,tags:[],data:{}}],scope={label:'test',day:'2026-11-04',worldId:'w',runId:'r',complete:true};
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');try{for(const language of['ko-KR','en-US'])for(const sample of[[],events]){Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language}});const client=computeAutonomy(sample,scope),server=values(recountAutonomy(sample,{...scope,runIds:['r'],from:null,to:null}));for(const row of client.rows)assert.deepEqual({value:row.comparisonValue,measured:row.measured},server[row.key],language+' '+row.key);if(language.startsWith('ko')&&sample.length)assert.match(client.rows.find(r=>r.key==='signatures').value,/통과/);}}finally{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});

test('fallback names that resemble status grammar remain intact and Feed uses actual beat IDs',async()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'navigator');try{Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'ko-KR'}});for(const name of['At Alice','read at Alice','하늘 · Alice / neighbor']){assert.ok(api.activityStatus(name+' is not here: fist_bump is shown as wave').includes(name));assert.equal(api.catalogText(name),name);}
 const {build}=await import('esbuild'),r=await build({entryPoints:[new URL('../src/ui/world-panel.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'}),{describe}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
 const name='하늘 · Alice',w={muses:[{id:'00-jolly',profile:{actorId:'00-jolly',displayName:name,appearanceId:'00-jolly',revision:1}}]},text=describe({id:'actual-beat',kind:'beat',muse:'00-jolly',place:'commons:cafe',data:{beat:'cafe_people_watch'}},w);assert.ok(text.includes(name));assert.match(text,/카페에서 이웃 구경/);assert.doesNotMatch(text,/cafe people watch/);
 }finally{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
});


test('public turn summaries are human wording and never echo internal fallback codes',async()=>{const {build}=await import('esbuild'),r=await build({entryPoints:[new URL('../src/ui/world-panel.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'}),{describe}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));for(const kind of ['spotlight_fallback','decision_rejected','decision_discarded','encounter_reply','encounter_reply_discarded','a2a_refused']){const e={id:'ui-summary',kind,muse:'01-sunny',other:'02-moss',source:'rule',data:{reason:'resident_priority_budget',step:'PRIVATE_INTERNAL_STAGE'}};const text=describe(e);assert.doesNotMatch(text,/resident_priority_budget|PRIVATE_INTERNAL_STAGE/);assert.ok(text.includes('Sunny'));}});
