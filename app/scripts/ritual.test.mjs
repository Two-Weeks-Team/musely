import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {RitualStore, RITUAL_TTL_MS} from '../worker/core/ritual.ts';
import {CHALLENGE_STEPS, buildMessages, checkOutput} from '../worker/core/actions.ts';
const sqlite = () => { const db = new DatabaseSync(':memory:'); return {exec(q, ...b) { const st = db.prepare(q); if (/^\s*(select|with)/i.test(q)) return {toArray: () => st.all(...b)}; st.run(...b); return {toArray: () => []}; }}; };

test('ritual steps are server-chosen, distinct, single-use, session-bound and expiring', () => {
  const r = new RitualStore(sqlite()); r.init();
  const a = r.start('s1', 1000);
  assert.equal(new Set(a.steps.map(s => s.id)).size, 3);
  for (const s of a.steps) assert.equal(s.text, CHALLENGE_STEPS[s.id]);
  assert.equal(r.take(a.id, 's2', 1001), null, 'another session cannot use it');
  assert.deepEqual(r.take(a.id, 's1', 1001), a.steps.map(s => s.id));
  assert.equal(r.take(a.id, 's1', 1002), null, 'single use');
  const b = r.start('s1', 1000);
  assert.equal(r.take(b.id, 's1', 1000 + RITUAL_TTL_MS + 1), null, 'expired');
});

test('the owner record (saved only for a passing owner-session run, see owner-control.test) keeps no frames', () => {
  const r = new RitualStore(sqlite()); r.init();
  assert.equal(r.ownerRecord(), null);
  r.saveOwnerRecord({at: 5, passed: true, results: [{step: 'thumbs_up', passed: true, confidence: .9}], requestId: 'req', model: 'muse-spark-1.3', tier: 'owner'});
  const rec = r.ownerRecord();
  assert.equal(rec.requestId, 'req');
  assert.ok(!JSON.stringify(rec).includes('data:image'));
});

test('a session can hold at most two open rituals; finishing one frees a slot', () => {
  const r = new RitualStore(sqlite()); r.init();
  const a = r.start('s', 1000), b = r.start('s', 1000);
  assert.ok(a && b);
  assert.equal(r.start('s', 1000), null, 'third open ritual refused');
  assert.ok(r.start('other', 1000), 'other sessions unaffected');
  r.take(a.id, 's', 1001);
  assert.ok(r.start('s', 1002), 'a used ritual frees a slot');
  assert.ok(r.start('s', 1000 + RITUAL_TTL_MS + 5) , 'expired ones free slots too');
});

test('new rituals use body-only steps without writing or props and keep old records untouched',()=>{
 assert.ok(Object.hasOwn(CHALLENGE_STEPS,'show_two_fingers'));assert.equal(Object.keys(CHALLENGE_STEPS).length,8);
 for(const text of Object.values(CHALLENGE_STEPS))assert.doesNotMatch(text,/paper|date|weather|write|phone|prop/i);
 const db=sqlite(),store=new RitualStore(db);store.init();const old={at:5,passed:true,results:[{step:'retired_step',passed:true,confidence:.9}],requestId:'old',model:'old',tier:'owner'};store.saveOwnerRecord(old);store.start('s',1000);assert.deepEqual(store.ownerRecord(),old);
});
test('challenge judge is instructed to fail a frame without the requested visible action and binds result order',()=>{
 const input={steps:['raise_left_hand','show_two_fingers','turn_head_left'],frames:['data:image/jpeg;base64,OFFLINE','data:image/jpeg;base64,OFFLINE','data:image/jpeg;base64,OFFLINE']};
 const system=buildMessages('challenge',input)[0].content;assert.match(system,/not visible.*passed=false/i);assert.match(system,/not infer/i);
 const results=input.steps.map(step=>({step,passed:true,confidence:.9,observation:'Visible requested body posture.'}));assert.equal(checkOutput('challenge',input,{results}),null);
 const missing=structuredClone(results);missing[1].passed=false;missing[1].observation='The hand is not visible.';assert.equal(checkOutput('challenge',input,{results:missing}),null);assert.ok(!missing.every(x=>x.passed===true));
 assert.match(checkOutput('challenge',input,{results:[results[1],results[0],results[2]]}),/step.*match|order/);
});
