import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/engine/world.ts';
import {resolveMeeting} from '../src/engine/rules.ts';
import {placeById} from '../src/engine/places.ts';
const now=Date.parse('2026-11-03T18:00:00Z');
function fixture(personal=true,valid=false){const s=createWorld('refusal-provenance',now),a=s.muses.find(m=>m.id==='02-moss'),b=s.muses.find(m=>m.id==='09-copper');a.place=b.place='commons:garden';a.inventory=valid?['tea']:[];b.inventory=['clover_seed'];b.wants.items=['tea'];a.intent={kind:'trade',target:b.id,give:'tea',want:'clover_seed'};if(personal)b.controlMode='personal';return {s,a,b};}
test('invalid proposal to an offline personal Muse is world refusal, not their invented reply',()=>{const {s,a,b}=fixture();const before=structuredClone(b.inventory),events=resolveMeeting(s.items,s,a,b,placeById(a.place),()=>0.2,now);assert.equal(events.some(e=>e.muse===b.id&&e.kind==='trade_rejected'),false);const e=events.find(e=>e.kind==='trade_refused');assert.ok(e);assert.equal(e.muse,a.id);assert.equal(e.other,b.id);assert.equal(e.line,null);assert.equal(e.source,'rule');assert.equal(e.data.recipientDecision,'not_requested');assert.equal(e.data.reason,'not_held');assert.deepEqual(b.inventory,before);assert.equal(s.inbox.tasks.length,0);});
test('valid proposal to personal Muse remains pending without forced answer',()=>{const {s,a,b}=fixture(true,true);const events=resolveMeeting(s.items,s,a,b,placeById(a.place),()=>0.2,now);assert.equal(s.inbox.tasks.at(-1).status,'pending');assert.equal(s.inbox.tasks.at(-1).awaiting,b.id);assert.equal(events.some(e=>e.kind==='trade_rejected'||e.kind==='trade_committed'),false);assert.ok(b.inventory.includes('clover_seed'));});
test('existing resident rejection semantics are preserved',()=>{const {s,a,b}=fixture(false);const events=resolveMeeting(s.items,s,a,b,placeById(a.place),()=>0.2,now);assert.ok(events.some(e=>e.kind==='trade_rejected'&&e.muse===b.id));});
