import {test} from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ??= {devicePixelRatio: 3};
const {pixelRatioFor, DEFAULT_DPR_CAP} = await import('../src/ui/perf.ts');

test('?dpr overrides the pixel-ratio cap for one visit; max removes it; bad values fall back', () => {
  assert.deepEqual(pixelRatioFor('?dpr=1.5', 3), {device: 3, cap: 1.5, applied: 1.5, source: 'url'});
  assert.equal(pixelRatioFor('?dpr=2', 1.25).applied, 1.25, 'never above the device ratio');
  assert.equal(pixelRatioFor('?dpr=max', 3).applied, 3);
  assert.equal(pixelRatioFor('?dpr=0', 3).cap, DEFAULT_DPR_CAP);
  assert.equal(pixelRatioFor('?dpr=99', 3).applied, 3, 'clamped to 4, then to the device');
  assert.equal(pixelRatioFor('', 2).source, 'default');
});
