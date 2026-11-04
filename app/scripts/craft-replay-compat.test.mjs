import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertCompatible} from '../src/replay/player.ts';
import {currentVersions} from '../src/replay/versions.ts';
const expectedEngine=process.env.MUSELY_INTEGRATED_ENGINE??'engine-18';
assert.ok(['engine-6','engine-7','engine-8','engine-9','engine-10','engine-11','engine-12','engine-13','engine-14','engine-15','engine-16','engine-17','engine-18'].includes(expectedEngine),'unsupported integration engine expectation');
const v4={schemaVersion:'run-log-2',engineVersion:'engine-4',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-c7068bfa0238'};
test('persona English speech uses its own current engine (or an exact requested historical composition)',()=>{assert.equal(currentVersions().engineVersion,expectedEngine);assert.doesNotThrow(()=>assertCompatible(currentVersions()));});
test('exact engine-4 checkpoint remains readable without rewriting its source version',()=>{const record={...v4};assert.doesNotThrow(()=>assertCompatible(record));assert.deepEqual(record,v4);});
test('mixed historical catalog and unknown engine are refused',()=>{assert.throws(()=>assertCompatible({...v4,catalogVersion:'catalog-unknown'}),/incompatible_record/);assert.throws(()=>assertCompatible({...v4,engineVersion:'engine-999'}),/incompatible_record/);});
test('explicit expected tuple cannot silently accept engine-4 as the current combined engine',()=>{assert.throws(()=>assertCompatible(v4,currentVersions()),/incompatible_record/);});
test('engine-2 and engine-3 historical exact tuples are still readable',()=>{assert.doesNotThrow(()=>assertCompatible({...v4,engineVersion:'engine-2',catalogVersion:'catalog-d69858ec160f'}));assert.doesNotThrow(()=>assertCompatible({...v4,engineVersion:'engine-3'}));});

test("published main engine-5 tuple remains readable",()=>{const v5={...v4,engineVersion:"engine-5"};assert.doesNotThrow(()=>assertCompatible(v5));assert.throws(()=>assertCompatible(v5,currentVersions()),/incompatible_record/);});

// Historical fixture is an explicit published tuple, separate from the current combined engine.
test('published goal-only engine-6 tuple remains checkpoint-compatible without accepting a mixed resident catalog',()=>{
 const goal6={schemaVersion:'run-log-2',engineVersion:'engine-6',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-c7068bfa0238'};
 const original=structuredClone(goal6);assert.doesNotThrow(()=>assertCompatible(goal6));assert.deepEqual(goal6,original);
 assert.throws(()=>assertCompatible({...goal6,catalogVersion:'catalog-ffb109917767'}),/incompatible_record/);
 assert.throws(()=>assertCompatible(goal6,currentVersions()),/incompatible_record/);
});

test('published engine-8 keeps its exact tuple and is not relabelled as the new activity engine',()=>{const v8={schemaVersion:'run-log-2',engineVersion:'engine-8',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-ffb109917767'};assert.doesNotThrow(()=>assertCompatible(v8));assert.throws(()=>assertCompatible(v8,currentVersions()),/incompatible_record/);assert.throws(()=>assertCompatible({...v8,catalogVersion:'catalog-c7068bfa0238'}),/incompatible_record/);});
test('published engine-9 exact tuple is historical checkpoint-only, with mixed data and current retagging rejected',()=>{
 const v9={schemaVersion:'run-log-2',engineVersion:'engine-9',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-ffb109917767'},original=JSON.stringify(v9);
 assert.doesNotThrow(()=>assertCompatible(v9));assert.throws(()=>assertCompatible(v9,currentVersions()),/incompatible_record/);assert.throws(()=>assertCompatible({...v9,catalogVersion:'catalog-c7068bfa0238'}),/incompatible_record/);assert.equal(JSON.stringify(v9),original);
});

test('published engine-10 is an exact checkpoint predecessor and never retagged',()=>{const v10={schemaVersion:'run-log-2',engineVersion:'engine-10',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-ffb109917767'},original=JSON.stringify(v10);assert.doesNotThrow(()=>assertCompatible(v10));assert.throws(()=>assertCompatible(v10,currentVersions()));assert.throws(()=>assertCompatible({...v10,catalogVersion:'catalog-unknown'}));assert.equal(JSON.stringify(v10),original);});

test('published engine-11 stays are exact read-only checkpoints under engine-12',()=>{const v11={schemaVersion:'run-log-2',engineVersion:'engine-11',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-ffb109917767'},original=JSON.stringify(v11);assert.doesNotThrow(()=>assertCompatible(v11));assert.throws(()=>assertCompatible(v11,currentVersions()));assert.throws(()=>assertCompatible({...v11,catalogVersion:'catalog-unreviewed'}));assert.equal(JSON.stringify(v11),original);});

test('published engine-12 speech checkpoints retain their exact historical identity under engine-13',()=>{const v12={schemaVersion:'run-log-2',engineVersion:'engine-12',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-ffb109917767'},original=JSON.stringify(v12);assert.doesNotThrow(()=>assertCompatible(v12));assert.throws(()=>assertCompatible(v12,currentVersions()));assert.throws(()=>assertCompatible({...v12,catalogVersion:'catalog-unreviewed'}));assert.equal(JSON.stringify(v12),original);});

test('published engine-13 recovery checkpoints remain exact history and cannot be retagged as engine-14',()=>{const v13={schemaVersion:'run-log-2',engineVersion:'engine-13',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-ffb109917767'},original=JSON.stringify(v13);assert.doesNotThrow(()=>assertCompatible(v13));assert.throws(()=>assertCompatible(v13,currentVersions()));assert.throws(()=>assertCompatible({...v13,catalogVersion:'catalog-unreviewed'}));assert.equal(JSON.stringify(v13),original);});
