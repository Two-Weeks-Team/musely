// Derives a small "rig + clips" GLB from the verified base LOD0: the node hierarchy (names and rest
// transforms) and every animation, without meshes, skins, materials or images, and without channels that
// only restate a node's rest transform. The light first view
// plays these clips on the LOD2 body, whose rig is identical (same rig digest), before LOD0 arrives.
// Deterministic: the same input bytes always give the same output bytes.

const align4 = n => (n + 3) & ~3;

export function deriveClipsGlb(glb) {
  if (glb.readUInt32LE(0) !== 0x46546c67) throw Error('Not a GLB');
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  const binLength = glb.readUInt32LE(binHeader);
  const bin = glb.subarray(binHeader + 8, binHeader + 8 + binLength);
  if (!json.animations?.length) throw Error('Source has no animations');
  for (const a of json.animations) for (const c of a.channels) if (c.target.path === 'weights') throw Error('Morph-weight clips need the mesh; not supported in clips.glb');

  const accessorMap = new Map(), accessors = [], bufferViews = [], chunks = [];
  let offset = 0;
  // Key reduction (first view only): drop samples that linear interpolation between the kept neighbours
  // reproduces within TOLERANCE per component (quaternion components / metres / scale). Deterministic.
  const TOLERANCE = 1e-3;
  const reduced = new Map();
  const reduceSampler = s => {
    const key = s.input + ':' + s.output;
    if (reduced.has(key)) return reduced.get(key);
    const times = readFloats(s.input), data = readFloats(s.output);
    if (!times || !data || s.interpolation === 'CUBICSPLINE' || s.interpolation === 'STEP') { reduced.set(key, null); return null; }
    const t = times.values, v = data.values, n = data.n, count = t.length, keep = [0];
    let i = 0;
    while (i < count - 1) {
      let j = i + 2;
      for (; j < count; j++) {
        let ok = true;
        for (let k = i + 1; k < j && ok; k++) { const u = (t[k] - t[i]) / (t[j] - t[i]); for (let c = 0; c < n; c++) if (Math.abs(v[i * n + c] + (v[j * n + c] - v[i * n + c]) * u - v[k * n + c]) > TOLERANCE) { ok = false; break; } }
        if (!ok) break;
      }
      i = j - 1; keep.push(i);
    }
    const r = {times: keep.map(k => t[k]), values: keep.flatMap(k => v.slice(k * n, k * n + n)), n, type: json.accessors[s.output].type};
    reduced.set(key, r); return r;
  };
  const writeFloats = (values, type, count, minmax) => {
    const packed = Buffer.alloc(values.length * 4); values.forEach((x, k) => packed.writeFloatLE(x, k * 4));
    bufferViews.push({buffer: 0, byteOffset: offset, byteLength: packed.length});
    chunks.push(packed, Buffer.alloc(align4(packed.length) - packed.length)); offset += align4(packed.length);
    accessors.push({componentType: 5126, count, type, ...(minmax ? {min: [Math.min(...values)], max: [Math.max(...values)]} : {}), bufferView: bufferViews.length - 1});
    return accessors.length - 1;
  };
  const timeAccessors = new Map();
  const keepReduced = s => {
    const r = reduceSampler(s);
    if (!r) return {...s, input: keepAccessor(s.input), output: keepAccessor(s.output)};
    const tk = r.times.join(',');
    if (!timeAccessors.has(tk)) timeAccessors.set(tk, writeFloats(r.times, 'SCALAR', r.times.length, true));
    return {...s, input: timeAccessors.get(tk), output: writeFloats(r.values, r.type, r.times.length, false)};
  };
  const keepAccessor = index => {
    if (accessorMap.has(index)) return accessorMap.get(index);
    const src = json.accessors[index];
    if (src.sparse) throw Error('Sparse animation accessors are not supported');
    const view = json.bufferViews[src.bufferView];
    const elementBytes = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16}[src.type] * {5126: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1}[src.componentType];
    const stride = view.byteStride ?? elementBytes;
    const start = (view.byteOffset ?? 0) + (src.byteOffset ?? 0);
    const packed = Buffer.alloc(src.count * elementBytes);
    for (let i = 0; i < src.count; i++) bin.copy(packed, i * elementBytes, start + i * stride, start + i * stride + elementBytes);
    bufferViews.push({buffer: 0, byteOffset: offset, byteLength: packed.length});
    chunks.push(packed, Buffer.alloc(align4(packed.length) - packed.length));
    offset += align4(packed.length);
    const {bufferView, byteOffset, ...rest} = src;
    accessors.push({...rest, bufferView: bufferViews.length - 1});
    accessorMap.set(index, accessors.length - 1);
    return accessors.length - 1;
  };
  // Channels whose every sample equals the node's rest TRS are dropped: they only restate the rest pose, which
  // three.js restores when the previous action stops (BaseMuseActor.setAction stops all actions first).
  const readFloats = index => {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView];
    if (a.componentType !== 5126 || a.sparse) return null;
    const n = {SCALAR: 1, VEC3: 3, VEC4: 4}[a.type], stride = v.byteStride ?? n * 4, start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), out = [];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out.push(bin.readFloatLE(start + i * stride + c * 4));
    return {values: out, n};
  };
  const REST = {translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1]};
  const restating = (a, c) => {
    if (c.target.path === 'weights') return false;
    const s = a.samplers[c.sampler], data = readFloats(s.output); if (!data) return false;
    const node = json.nodes[c.target.node], rest = node[c.target.path] ?? REST[c.target.path];
    return data.values.every((x, i) => Math.abs(x - rest[i % data.n]) < 1e-6);
  };
  const animations = json.animations.map(a => {
    const kept = a.channels.filter(c => !restating(a, c));
    const samplerMap = new Map();
    const samplers = [];
    for (const c of kept) if (!samplerMap.has(c.sampler)) { const s = a.samplers[c.sampler]; samplerMap.set(c.sampler, samplers.length); samplers.push(keepReduced(s)); }
    return {name: a.name, channels: kept.map(c => ({...c, sampler: samplerMap.get(c.sampler)})), samplers};
  });
  const nodes = json.nodes.map(({mesh, skin, ...node}) => node);
  const out = {
    asset: {version: '2.0', generator: 'musely clips-glb (derived from base/lod0.glb)'},
    scene: json.scene ?? 0,
    scenes: json.scenes,
    nodes,
    animations,
    accessors,
    bufferViews,
    buffers: [{byteLength: offset}],
  };
  const jsonBytes = Buffer.from(JSON.stringify(out), 'utf8');
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc(align4(jsonBytes.length) - jsonBytes.length, 0x20)]);
  const binPadded = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binPadded.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonPadded, binChunkHeader, binPadded]);
}

export function readGlbJson(glb) {
  return JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
}
