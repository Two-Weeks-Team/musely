import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deriveClipsGlb, readGlbJson} from './clips-glb.mjs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

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
  // Every dropped channel restates the rest pose, reduced channels stay within 1.5e-3, and clips keep their duration.
  const loader = new GLTFLoader().register(() => ({name: 'NoTextures', loadTexture: async () => null})), parse = buf => loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const [full, light] = await Promise.all([parse(lod0), parse(a)]);
  for (const clip of full.animations) {
    const l = light.animations.find(x => x.name === clip.name);
    assert.ok(Math.abs(l.duration - clip.duration) < 1e-6, clip.name + ' duration');
    for (const t of clip.tracks) {
      const lt = l.tracks.find(x => x.name === t.name);
      if (lt) {
        // Key reduction (1e-3 per component) stays within 1.5e-3 of the full track at every original key time (three.js interpolation).
        const interp = lt.createInterpolant(), n = t.getValueSize();
        for (let k = 0; k < t.times.length; k++) { const got = interp.evaluate(t.times[k]); for (let c = 0; c < n; c++) assert.ok(Math.abs(got[c] - t.values[k * n + c]) < 1.5e-3, `${clip.name} ${t.name} at ${t.times[k]}: ${got[c]} vs ${t.values[k * n + c]}`); }
        continue;
      }
      const [nodeName, prop] = t.name.split('.'), node = full.scene.getObjectByName(nodeName);
      const rest = prop === 'quaternion' ? node.quaternion.toArray() : node[prop === 'position' ? 'position' : 'scale'].toArray();
      for (let i = 0; i < t.values.length; i++) assert.ok(Math.abs(t.values[i] - rest[i % rest.length]) < 1e-5, `${clip.name} dropped ${t.name} that is not the rest pose`);
    }
  }
  const lod2 = readGlbJson(await readFile(new URL('../character-kit/runtime/base/lod2.glb', import.meta.url)));
  assert.equal(manifest.files['base/lod2.glb'].rigDigest, manifest.files['base/lod0.glb'].rigDigest, 'LOD2 shares the rig that the clips target');
  assert.ok(src.nodes.filter(n => n.mesh === undefined).every(n => lod2.nodes.some(m => m.name === n.name)), 'every animated rig node exists in LOD2');
});
