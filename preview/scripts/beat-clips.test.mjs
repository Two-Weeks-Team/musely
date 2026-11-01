import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BEATS, CLIP_FALLBACK} from '../src/engine/beats.ts';
import {readGlbJson} from './clips-glb.mjs';

test('every clip a beat uses ships in base/lod0.glb or has a fallback to a shipped clip, and fallbacks exist only for missing clips', async () => {
  const shipped = new Set(readGlbJson(await readFile(new URL('../character-kit/runtime/base/lod0.glb', import.meta.url))).animations.map(a => a.name));
  for (const beat of BEATS) for (const clip of beat.clips) {
    if (shipped.has(clip)) continue;
    assert.ok(CLIP_FALLBACK[clip], `beat ${beat.id} uses ${clip}, which is neither in lod0.glb nor in CLIP_FALLBACK`);
    assert.ok(shipped.has(CLIP_FALLBACK[clip]), `fallback for ${clip} (${CLIP_FALLBACK[clip]}) is not in lod0.glb`);
  }
  for (const [clip, to] of Object.entries(CLIP_FALLBACK)) {
    assert.ok(!shipped.has(clip), `${clip} ships in lod0.glb; remove its fallback to ${to}`);
    assert.ok(shipped.has(to), `fallback target ${to} is not in lod0.glb`);
  }
});
