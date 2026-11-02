import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as recorded from '../src/ui/recorded-scene.ts';
const AT = 1800000000000;
const world = (version, place = 'commons:cafe') => ({worldId:'world', day:'2026-11-02', tick:version, version, lastTickAt:AT+version, muses:[{id:'00-jolly', place, travel:null, beat:null, inventory:[]}]});
const frame = (version, place, at=AT+version) => ({replay:true,runId:'run',worldId:'world',recordedAt:at,snapshotAt:at,snapshotHash:'hash-'+version,publicState:world(version,place),events:[],inputs:[],empty:false,timeOrderAdjusted:false});
test('I-11 recorded 3D seeks backwards in its own projection and null restores the newest live state', () => {
 const p = new recorded.SceneProjection();
 p.accept(world(20),[]);
 p.setRecordedFrame(frame(2,'commons:garden'));
 assert.equal(p.replay,true); assert.equal(p.projection.world.version,2);
 p.accept(world(21,'commons:workbench'),[]);
 assert.equal(p.projection.world.version,2,'live poll cannot replace the recorded scene');
 p.setRecordedFrame(frame(1,'commons:cafe'));
 assert.equal(p.projection.world.version,1,'backwards seek does not hit live monotonic guard');
 assert.equal(p.projection.world.muses[0].place,'commons:cafe');
 assert.equal(p.recordedAt,AT+1);
 p.setRecordedFrame(null);
 assert.equal(p.replay,false); assert.equal(p.projection.world.version,21);
 assert.equal(p.projection.world.muses[0].place,'commons:workbench');
 assert.equal(p.accept(world(19),[]),false,'the live monotonic guard survives replay');
});
test('I-11 only recorded public event.line speaks; private hashes never become dialogue or wants', () => {
 const p = new recorded.SceneProjection(), f = frame(1,'commons:cafe',AT+7000);
 f.publicState.muses[0].beat={id:'rest',clip:'sit_idle',startedAt:AT,endsAt:AT+60000,line:'text-sha256:private-line'};
 f.publicState.muses[0].reflection='text-sha256:private-reflection';
 f.publicState.muses[0].wants={goal:'text-sha256:private-goal',source:'live'};
 const before=JSON.stringify(f);
 p.setRecordedFrame(f);
 assert.equal(p.projection.world.muses[0].beat.line,null);
 assert.equal(p.projection.world.muses[0].reflection,undefined);
 assert.equal(p.projection.world.muses[0].wants,undefined);
 assert.equal(p.projection.frames(AT+7000).get('00-jolly').line,null);
 f.events=[{id:'public',seq:1,tick:1,at:AT,source:'live',kind:'greet',muse:'00-jolly',line:'A recorded public hello',data:{}}];
 f.snapshotHash='hash-public'; p.setRecordedFrame(f);
 assert.equal(p.projection.frames(AT+12500).get('00-jolly').line,'A recorded public hello');
 f.events=[];f.snapshotHash='hash-1'; assert.equal(JSON.stringify(f),before,'render projection never mutates public checkpoints');
});

test('I-11 the displayed public line carries its own cue source rather than a later unrelated event source', () => {
 const p=new recorded.SceneProjection(), f=frame(2,'commons:campfire',AT+12500);
 f.events=[{id:'hello',seq:1,tick:1,at:AT,source:'live',kind:'greet',muse:'00-jolly',line:'Public model hello',data:{}}, {id:'arrival',seq:2,tick:2,at:AT+1000,source:'rule',kind:'arrive',muse:'00-jolly',line:null,data:{}}];
 p.setRecordedFrame(f);const shown=p.projection.frames(f.recordedAt).get('00-jolly');
 assert.equal(shown.line,'Public model hello');assert.equal(recorded.frameSource(p.projection,shown,'00-jolly'),'live');
});
