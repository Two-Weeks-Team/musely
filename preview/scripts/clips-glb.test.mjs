import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deriveClipsGlb, readGlbJson} from './clips-glb.mjs';

test('clips.glb carries every LOD0 clip and the rig hierarchy, without meshes or images, deterministically', async () => {
  const lod0 = await readFile(new URL('../character-kit/runtime/base/lod0.glb', import.meta.url));
  const manifest = JSON.parse(await readFile(new URL('../character-kit/manifest.json', import.meta.url), 'utf8'));
  const a = deriveClipsGlb(lod0), b = deriveClipsGlb(lod0);
  assert.ok(a.equals(b), 'same input gives identical bytes');
  const src = readGlbJson(lod0), out = readGlbJson(a);
  assert.deepEqual(out.animations.map(x => x.name).sort(), [...manifest.files['base/lod0.glb'].clips].sort());
  assert.deepEqual(out.nodes.map(n => n.name), src.nodes.map(n => n.name), 'node names match the shared rig');
  assert.ok(!out.meshes && !out.images && !out.materials && !out.skins);
  assert.ok(out.nodes.every(n => n.mesh === undefined && n.skin === undefined));
  for (const anim of out.animations) for (const c of anim.channels) assert.ok(out.nodes[c.target.node], 'channel targets an existing node');
  assert.ok(a.length < 400_000, 'light enough for the first view: ' + a.length);
  const lod2 = readGlbJson(await readFile(new URL('../character-kit/runtime/base/lod2.glb', import.meta.url)));
  assert.equal(manifest.files['base/lod2.glb'].rigDigest, manifest.files['base/lod0.glb'].rigDigest, 'LOD2 shares the rig that the clips target');
  assert.ok(src.nodes.filter(n => n.mesh === undefined).every(n => lod2.nodes.some(m => m.name === n.name)), 'every animated rig node exists in LOD2');
});
