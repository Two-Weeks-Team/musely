// Playwright CLI run-code callback. Open the local dist world first (node scripts/serve-dist.mjs 8790).
// Plays each chapter-10 action clip on real world residents (clips from the build-derived base/clips.glb)
// at LOD2 and LOD0, synchronously inside one evaluate so the story loop cannot interleave, and checks:
//   every clip: bones move, no NaN in any bone matrix, Root stays in place, lowest vertex >= -20 mm
//   drink: Socket_Hand_R (the cup socket) within 25 mm of the hand surface on every sampled frame (inside = negative)
//   high_five: two residents 0.9 m apart, facing; palms (Socket_Hand_R) within 60 mm at the contact frame,
//              and no hand or forearm vertex inside the other actor's torso/head on any sampled frame
// The partner is checked with a nearest-vertex signed distance against skinned torso/head normals.
async (page) => {
 const CLIPS = {drink: {frames: 96, loop: true}, plant: {frames: 96, loop: false}, high_five: {frames: 60, loop: false, contactFrame: 24, partner: .9}};
 const only = Object.keys(CLIPS);
 const target = new URL(page.url()); target.search = '?autoplay=0';
 const ctx = await page.context().browser().newContext({viewport: {width: 1440, height: 1000}});
 const p = await ctx.newPage(), errors = [];
 p.on('pageerror', e => errors.push(e.message));
 try {
  await p.goto(target.href, {waitUntil: 'domcontentloaded'});
  await p.waitForFunction(() => window.__world?.getMetrics().ready && window.__world.getMetrics().characterKit, null, {timeout: 60000});
  await p.waitForFunction(() => window.__world.getMetrics().characterUpgrade?.lod0, null, {timeout: 120000});
  if (await p.locator('#pause').isVisible()) await p.locator('#pause').click();
  const results = await p.evaluate(({CLIPS, only}) => {
   const W = window.__world, A = W.actor(0), B = W.actor(1);
   if (!A || !B) throw Error('World actors are not exposed');
   const V = A.root.position.constructor;
   const TORSO = new Set(['Hips', 'Spine', 'Chest', 'Neck', 'Head']);
   const visibleBody = a => a.meshes.filter(m => m.visible && m.parent?.visible !== false && m.name.startsWith('Jolly'));
   const toLocal = (a, v) => a.root.parent.worldToLocal(v);
   // Per-vertex dominant bone name, from skin weights.
   const dominant = m => {
    const idx = m.geometry.attributes.skinIndex, w = m.geometry.attributes.skinWeight, out = new Array(idx.count);
    for (let i = 0; i < idx.count; i++) { let best = 0; for (let c = 1; c < 4; c++) if (w.getComponent(i, c) > w.getComponent(i, best)) best = c; out[i] = m.skeleton.bones[idx.getComponent(i, best)].name; }
    return out;
   };
   const cache = new Map();
   const groupsOf = m => { if (!cache.has(m)) cache.set(m, dominant(m)); return cache.get(m); };
   const points = (a, filter, withNormals = false) => {
    const out = [];
    for (const m of visibleBody(a)) {
     const g = groupsOf(m), pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal, face = m.name.includes('Face');
     for (let i = 0; i < pos.count; i++) {
      if (!filter(face ? 'Head' : g[i])) continue;
      const v = new V(); m.getVertexPosition(i, v); const pw = toLocal(a, v.clone().applyMatrix4(m.matrixWorld));
      if (!withNormals) { out.push(pw); continue; }
      const rest = new V().fromBufferAttribute(pos, i), n = new V().fromBufferAttribute(nor, i);
      const q0 = m.applyBoneTransform(i, rest.clone()), q1 = m.applyBoneTransform(i, rest.clone().addScaledVector(n, .01));
      const n0 = toLocal(a, q0.applyMatrix4(m.matrixWorld)), n1 = toLocal(a, q1.applyMatrix4(m.matrixWorld));
      out.push([pw, n1.sub(n0).normalize()]);
     }
    }
    return out;
   };
   // Signed distance of points from a closed surface sampled as (vertex, normal) pairs: exact nearest-vertex test
   // for points inside the surface's bounding box; outside it, the distance to the box (a lower bound, > 0).
   const clearance = (pts, surface) => {
    const lo = new V(Infinity, Infinity, Infinity), hi = new V(-Infinity, -Infinity, -Infinity);
    for (const [q] of surface) { lo.min(q); hi.max(q); }
    let worst = Infinity;
    for (const p of pts) {
     const c = p.clone().max(lo).min(hi), outside = c.distanceTo(p);
     if (outside > 0) { worst = Math.min(worst, outside); continue; }
     let best = Infinity, k = -1; for (let j = 0; j < surface.length; j++) { const d = p.distanceToSquared(surface[j][0]); if (d < best) { best = d; k = j; } }
     worst = Math.min(worst, p.clone().sub(surface[k][0]).dot(surface[k][1]));
    }
    return worst;
   };
   const socket = a => toLocal(a, a.root.getObjectByName('Socket_Hand_R').getWorldPosition(new V()));
   const finite = a => a.skeleton.bones.every(b => b.matrixWorld.elements.every(Number.isFinite) && b.quaternion.toArray().every(Number.isFinite));
   const quats = a => a.skeleton.bones.flatMap(b => b.quaternion.toArray());
   const base = A.root.position.clone(), floorY = base.y;
   const poseA = {x: base.x, y: floorY, z: base.z, yaw: 0};
   const prevLods = [A.lod, B.lod], prevActions = [A.getMetrics().action, B.getMetrics().action];
   const out = [];
   for (const lod of [2, 0]) {
    A.setLod(lod); B.setLod(lod);
    for (const name of only) {
     const spec = CLIPS[name];
     if (!A.actions.has(name)) throw Error('World actor has no clip ' + name + ' (clips.glb not rebuilt?)');
     A.setAction(name);
     const root = A.skeleton.bones.find(b => b.name === 'Root');
     const r = {clip: name, lod, frames: spec.frames, moved: 0, finite: true, rootDrift: 0, lowestMm: Infinity};
     A.update(0, poseA, 0); const rp = root.position.clone(), rq = root.quaternion.clone(); let prev = quats(A);
     const first = prev.slice();
     for (let f = 0; f <= spec.frames; f += 2) {
      const t = f / 24; A.update(t, poseA, t);
      if (!finite(A)) r.finite = false;
      const q = quats(A); r.moved = Math.max(r.moved, q.reduce((s, v, i) => s + Math.abs(v - first[i]), 0)); prev = q;
      r.rootDrift = Math.max(r.rootDrift, root.position.distanceTo(rp) + root.quaternion.angleTo(rq));
      let low = Infinity; for (const m of visibleBody(A)) { m.computeBoundingBox(); const box = m.boundingBox.clone().applyMatrix4(m.matrixWorld); low = Math.min(low, toLocal(A, box.min.clone()).y); }
      r.lowestMm = Math.min(r.lowestMm, (low - floorY) * 1000);
      if (name === 'drink') {
       // Gate: signed distance of the cup socket from the hand surface (Hand_R/Forearm_R vertices with skinned
       // normals; negative = inside the hand). Also recorded: distance to the Hand_R vertex centroid, which on the
       // decimated LOD2 is biased by uneven vertex density.
       const s0 = socket(A), hand = points(A, g => g === 'Hand_R'), c = hand.reduce((s, v) => s.add(v), new V()).multiplyScalar(1 / hand.length);
       const surface = points(A, g => g === 'Hand_R' || g === 'Forearm_R', true);
       let best = Infinity, k = -1; for (let j = 0; j < surface.length; j++) { const d = s0.distanceToSquared(surface[j][0]); if (d < best) { best = d; k = j; } }
       const signed = s0.clone().sub(surface[k][0]).dot(surface[k][1]);
       r.socketToHandSurfaceMaxMm = Math.max(r.socketToHandSurfaceMaxMm ?? -Infinity, signed * 1000);
       r.socketToHandCentroidMaxMm = Math.max(r.socketToHandCentroidMaxMm ?? 0, s0.distanceTo(c) * 1000);
      }
     }
     if (name === 'high_five') {
      const poseB = {x: base.x, y: floorY, z: base.z + spec.partner, yaw: Math.PI};
      B.setAction(name);
      r.partnerDistanceM = spec.partner; r.minHandToPartnerTorsoMm = Infinity; r.minHandToPartnerHandMm = Infinity;
      for (let f = 0; f <= spec.frames; f += 2) {
       const t = f / 24; A.update(t, poseA, t); B.update(t, poseB, t);
       const armsA = points(A, g => /^(Hand|Forearm)_/.test(g)), armsB = points(B, g => /^(Hand|Forearm)_/.test(g));
       const torsoA = points(A, g => TORSO.has(g), true), torsoB = points(B, g => TORSO.has(g), true);
       const c = Math.min(clearance(armsA, torsoB), clearance(armsB, torsoA)) * 1000;
       r.minHandToPartnerTorsoMm = Math.min(r.minHandToPartnerTorsoMm, c);
       if (f === spec.contactFrame) {
        r.contactFrame = f; r.palmDistanceMm = socket(A).distanceTo(socket(B)) * 1000;
        r.actorDistanceM = A.root.position.distanceTo(B.root.position);
        const handA = points(A, g => g === 'Hand_R'), handB = points(B, g => g === 'Hand_R', true);
        r.minHandToPartnerHandMm = clearance(handA, handB) * 1000;
       }
      }
     }
     for (const k of Object.keys(r)) if (typeof r[k] === 'number') r[k] = +r[k].toFixed(3);
     out.push(r);
    }
   }
   A.setLod(prevLods[0]); B.setLod(prevLods[1]); A.setAction(prevActions[0]); B.setAction(prevActions[1]);
   return out;
  }, {CLIPS, only});
  const failures = [];
  for (const r of results) {
   if (!r.finite) failures.push(`${r.clip} LOD${r.lod}: NaN in bone matrices`);
   if (!(r.moved > .05)) failures.push(`${r.clip} LOD${r.lod}: bones do not move (${r.moved})`);
   if (r.rootDrift > 1e-5) failures.push(`${r.clip} LOD${r.lod}: Root moved ${r.rootDrift}`);
   if (r.lowestMm < -20) failures.push(`${r.clip} LOD${r.lod}: sinks ${r.lowestMm} mm below the floor`);
   if (r.clip === 'drink' && !(r.socketToHandSurfaceMaxMm <= 25)) failures.push(`drink LOD${r.lod}: cup socket ${r.socketToHandSurfaceMaxMm} mm from the hand surface`);
   if (r.clip === 'high_five') {
    if (!(r.palmDistanceMm <= 60)) failures.push(`high_five LOD${r.lod}: palms ${r.palmDistanceMm} mm apart at contact`);
    if (!(r.minHandToPartnerTorsoMm > 0)) failures.push(`high_five LOD${r.lod}: a hand enters the partner's body (${r.minHandToPartnerTorsoMm} mm)`);
   }
  }
  if (errors.length) failures.push('page errors: ' + errors.join('; '));
  if (failures.length) throw Error(failures.join('\n') + '\n' + JSON.stringify(results));
  return {results, errors};
 } finally { await ctx.close(); }
}
