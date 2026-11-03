import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertCompatible} from '../src/replay/player.ts';
import {currentVersions} from '../src/replay/versions.ts';
const expectedEngine=process.env.MUSELY_INTEGRATED_ENGINE??'engine-6';
assert.ok(['engine-6','engine-7'].includes(expectedEngine),'unsupported integration engine expectation');
const v4={schemaVersion:'run-log-2',engineVersion:'engine-4',harnessVersion:'harness-c0c69e98b5e8',catalogVersion:'catalog-c7068bfa0238'};
test('new consumed-ingredient semantics are explicitly engine-6',()=>{assert.equal(currentVersions().engineVersion,expectedEngine);assert.doesNotThrow(()=>assertCompatible(currentVersions()));});
test('exact engine-4 checkpoint remains readable without rewriting its source version',()=>{const record={...v4};assert.doesNotThrow(()=>assertCompatible(record));assert.deepEqual(record,v4);});
test('mixed historical catalog and unknown engine are refused',()=>{assert.throws(()=>assertCompatible({...v4,catalogVersion:'catalog-unknown'}),/incompatible_record/);assert.throws(()=>assertCompatible({...v4,engineVersion:'engine-999'}),/incompatible_record/);});
test('explicit expected tuple cannot silently accept engine-4 as engine-6',()=>{assert.throws(()=>assertCompatible(v4,currentVersions()),/incompatible_record/);});
test('engine-2 and engine-3 historical exact tuples are still readable',()=>{assert.doesNotThrow(()=>assertCompatible({...v4,engineVersion:'engine-2',catalogVersion:'catalog-d69858ec160f'}));assert.doesNotThrow(()=>assertCompatible({...v4,engineVersion:'engine-3'}));});

test("published main engine-5 tuple remains readable",()=>{const v5={...v4,engineVersion:"engine-5"};assert.doesNotThrow(()=>assertCompatible(v5));assert.throws(()=>assertCompatible(v5,currentVersions()),/incompatible_record/);});
