// Anchored to operating event14120/input2689/run8: Ink must not be pulled 2.452 m during an encounter.
import test from 'node:test';import assert from 'node:assert/strict';
import{liveFrames,scheduleCues,CUE_DELAY_MS}from'../src/ui/live-scene-core.ts';
import{RESIDENT_INSTANCES}from'../src/engine/resident-catalog.ts';
const at=1793757203128,publishedAt=1793757213459;
const muse=(id,extra={})=>({id,place:'commons:cafe',travel:null,beat:null,inventory:[],...extra});
const world=muses=>({worldId:'musely',day:'2026-11-03',tick:2579,version:3043,lastTickAt:at,muses});
const event=(a,b)=>({id:'2026-11-03:2578:14',seq:14120,tick:2578,at,source:'rule',kind:'encounter',muse:a,other:b,place:'commons:cafe',data:{publishedAt}});
function anchored(w,events){const cues=scheduleCues(events);for(let elapsed=-100;elapsed<=2300;elapsed+=100){const t=publishedAt+CUE_DELAY_MS+elapsed,base=liveFrames(w,[],t),frames=liveFrames(w,cues,t);for(const [id,f]of frames){assert.deepEqual([f.x,f.z],[base.get(id).x,base.get(id).z],`${id} presentation root moved at ${elapsed}ms`);}}return liveFrames(w,cues,publishedAt+CUE_DELAY_MS+900);}
test('actual legacy Ink/Copper contact falls back in place rather than a fast out-and-back trip',()=>{const w=world([muse('06-ink',{beat:{id:'cafe_save_seat',clip:'sit_down',startedAt:at,endsAt:at+60000}}),muse('09-copper')]);const frames=anchored(w,[event('09-copper','06-ink')]);assert.match(frames.get('06-ink').fallback,/contact reach/);});
test('new resident and personal displays also preserve authoritative slots through contact',()=>{const nr=muse(RESIDENT_INSTANCES[0].id),pm=muse('pm_contact',{profile:{actorId:'pm_contact',displayName:'Visitor',appearanceId:'00-jolly',revision:1}});anchored(world([nr,pm]),[event(nr.id,pm.id)]);});
test('already close ordinary contact remains fist bump without moving either root',()=>{const f=anchored(world([muse('00-jolly'),muse('01-sunny')]),[event('00-jolly','01-sunny')]);assert.equal(f.get('00-jolly').clip,'fist_bump');assert.equal(f.get('01-sunny').clip,'fist_bump');});
test('active real travel interpolation, clip and ETA survive a queued contact unchanged',()=>{const w=world([muse('06-ink',{place:'commons:bookshelf',travel:{to:'commons:cafe',departAt:publishedAt,arriveAt:publishedAt+67000,speed:'walk'}}),muse('09-copper')]);const frames=anchored(w,[event('09-copper','06-ink')]),f=frames.get('06-ink');assert.equal(f.clip,'walk');assert.equal(f.cue,null);assert.equal(f.travel.etaMs,67000-CUE_DELAY_MS-900);});
