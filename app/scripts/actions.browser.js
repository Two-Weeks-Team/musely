// Playwright CLI run-code callback. Open the local dist world first (node scripts/serve-dist.mjs 8790).
// Plays every chapter-10 action clip (window.__world.actionClips, i.e. catalog ACTION_CLIPS) on real world
// residents in explicit Story mode (live projection is verified by live-scene.browser.js), whose clips come from the build-derived base/clips.glb, at LOD2 and LOD0. Each clip runs
// synchronously inside one evaluate so the story loop cannot interleave. Checks:
//   every clip: bones move, no NaN in any bone matrix, Root stays in place, lowest vertex >= -20 mm
//   locomotion clips (stride): Root stays in place (the route owns translation) and the feet slide no more than the
//     shared walk does: 2 x foot sweep / declared stride is between 0.8 x walk's ratio and 1.2
//   drink: Socket_Hand_R (the cup socket) within 25 mm of the hand surface on every sampled frame (inside = negative)
//   two-actor clips (partner): two residents 0.9 m apart, facing, A plays the clip and B its partner clip;
//     palms (Socket_Hand_R) within 60 mm at the contact frame, no hand or forearm vertex inside the other
//     actor's torso/head on any sampled frame, and the two right hands do not pass through each other (> -5 mm)
//   prop clips: the clip's prop is shown on its socket bone while playing, and hidden for other clips
// Signed distances use the nearest skinned vertex and its skinned normal.
async (page) => {
 const target = new URL(page.url()); target.search = '?autoplay=0';
 const ctx = await page.context().browser().newContext({viewport: {width: 1440, height: 1000}});
 const p = await ctx.newPage(), errors = [];
 p.on('pageerror', e => errors.push(e.message));
 try {
  await p.goto(target.href, {waitUntil: 'domcontentloaded'});
  await p.waitForFunction(() => window.__world?.getMetrics().ready && window.__world.getMetrics().characterKit, null, {timeout: 60000});
  await p.waitForFunction(() => window.__world.getMetrics().characterUpgrade?.props, null, {timeout: 120000});
  await p.evaluate(() => window.__world.setMode('story'));
  await p.waitForTimeout(100);
  if (await p.locator('#pause').isVisible()) await p.locator('#pause').click();
  const {results, CLIPS} = await p.evaluate(() => {
   const W = window.__world, A = W.actor(0), B = W.actor(1), CLIPS = W.actionClips, PARTNER = .9;
   if (!A || !B || !CLIPS) throw Error('World actors or action clips are not exposed');
   const V = A.root.position.constructor;
   const TORSO = new Set(['Hips', 'Spine', 'Chest', 'Neck', 'Head']);
   const visibleBody = a => a.meshes.filter(m => m.visible && m.parent?.visible !== false && m.name.startsWith('Jolly'));
   const toLocal = (a, v) => a.root.parent.worldToLocal(v);
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
   // Signed distance from a closed surface sampled as (vertex, normal) pairs: exact nearest-vertex test inside the
   // surface's bounding box, the distance to the box outside it (a lower bound, > 0). With `far`, a point farther
   // than `far` from its nearest vertex counts as outside (small closed parts such as a hand).
   const clearance = (pts, surface, far = Infinity) => {
    const lo = new V(Infinity, Infinity, Infinity), hi = new V(-Infinity, -Infinity, -Infinity);
    for (const [q] of surface) { lo.min(q); hi.max(q); }
    let worst = Infinity;
    for (const p of pts) {
     const c = p.clone().max(lo).min(hi), outside = c.distanceTo(p);
     if (outside > 0) { worst = Math.min(worst, outside); continue; }
     let best = Infinity, k = -1; for (let j = 0; j < surface.length; j++) { const d = p.distanceToSquared(surface[j][0]); if (d < best) { best = d; k = j; } }
     worst = Math.min(worst, Math.sqrt(best) > far ? Math.sqrt(best) : p.clone().sub(surface[k][0]).dot(surface[k][1]));
    }
    return worst;
   };
   const socket = (a, s = 'R') => toLocal(a, a.root.getObjectByName('Socket_Hand_' + s).getWorldPosition(new V()));
   const finite = a => a.skeleton.bones.every(b => b.matrixWorld.elements.every(Number.isFinite) && b.quaternion.toArray().every(Number.isFinite));
   const quats = a => a.skeleton.bones.flatMap(b => b.quaternion.toArray());
   const base = A.root.position.clone(), floorY = base.y;
   const poseA = {x: base.x, y: floorY, z: base.z, yaw: 0}, poseB = {x: base.x, y: floorY, z: base.z + PARTNER, yaw: Math.PI};
   const prevLods = [A.lod, B.lod], prevActions = [A.getMetrics().action, B.getMetrics().action];
   const props = a => { const out = []; a.root.traverse(o => { if (o.userData.musely_kind === 'prop' && o.userData.musely_clip) out.push(o); }); return out; };
   const sweep = (name, frames) => { A.setAction(name); const zs = []; for (let f = 0; f <= frames; f++) { A.update(f / 24, poseA, f / 24); zs.push(toLocal(A, A.skeleton.bones.find(b => b.name === 'Foot_L').getWorldPosition(new V())).z); } return Math.max(...zs) - Math.min(...zs); };
   const walkRatio = 2 * sweep('walk', 32) / .27;
   const out = [];
   for (const lod of [2, 0]) {
    A.setLod(lod); B.setLod(lod);
    for (const [name, spec] of Object.entries(CLIPS)) {
     if (!A.actions.has(name)) throw Error('World actor has no clip ' + name + ' (clips.glb not rebuilt?)');
     A.setAction(name);
     const root = A.skeleton.bones.find(b => b.name === 'Root');
     const r = {clip: name, lod, frames: spec.frames, moved: 0, finite: true, rootDrift: 0, lowestMm: Infinity};
     A.update(0, poseA, 0); const rp = root.position.clone(), rq = root.quaternion.clone(); const first = quats(A);
     const foot = [];
     for (let f = 0; f <= spec.frames; f += 2) {
      const t = f / 24; A.update(t, poseA, t);
      if (!finite(A)) r.finite = false;
      const q = quats(A); r.moved = Math.max(r.moved, q.reduce((s, v, i) => s + Math.abs(v - first[i]), 0));
      r.rootDrift = Math.max(r.rootDrift, root.position.distanceTo(rp) + root.quaternion.angleTo(rq));
      let low = Infinity; for (const m of visibleBody(A)) { m.computeBoundingBox(); const box = m.boundingBox.clone().applyMatrix4(m.matrixWorld); low = Math.min(low, toLocal(A, box.min.clone()).y); }
      r.lowestMm = Math.min(r.lowestMm, (low - floorY) * 1000);
      if (spec.stride) foot.push(toLocal(A, A.skeleton.bones.find(b => b.name === 'Foot_L').getWorldPosition(new V())).z - base.z);
      if (name === 'drink') {
       const s0 = socket(A), hand = points(A, g => g === 'Hand_R'), c = hand.reduce((s, v) => s.add(v), new V()).multiplyScalar(1 / hand.length);
       const surface = points(A, g => g === 'Hand_R' || g === 'Forearm_R', true);
       let best = Infinity, k = -1; for (let j = 0; j < surface.length; j++) { const d = s0.distanceToSquared(surface[j][0]); if (d < best) { best = d; k = j; } }
       r.socketToHandSurfaceMaxMm = Math.max(r.socketToHandSurfaceMaxMm ?? -Infinity, s0.clone().sub(surface[k][0]).dot(surface[k][1]) * 1000);
       r.socketToHandCentroidMaxMm = Math.max(r.socketToHandCentroidMaxMm ?? 0, s0.distanceTo(c) * 1000);
      }
      if (spec.prop && f === Math.round(spec.frames / 2)) {
       const shown = props(A).filter(o => o.visible && o.parent?.visible !== false);
       r.propShown = shown.filter(o => o.userData.musely_clip === name).map(o => o.name + '@' + o.parent.name);
       r.otherPropsShown = shown.filter(o => o.userData.musely_clip !== name).map(o => o.name);
      }
     }
     if (spec.stride) { r.footSweepPerCycleM = 2 * (Math.max(...foot) - Math.min(...foot)); r.strideM = spec.stride; r.slipRatio = r.footSweepPerCycleM / spec.stride; r.walkRatio = walkRatio; }
     if (spec.partner) {
      if (!B.actions.has(spec.partner)) throw Error('World actor has no partner clip ' + spec.partner);
      B.setAction(spec.partner);
      r.partnerClip = spec.partner; r.partnerDistanceM = PARTNER; r.minHandToPartnerTorsoMm = Infinity; r.minHandToPartnerHandMm = Infinity;
      for (let f = 0; f <= spec.frames; f += 2) {
       const t = f / 24; A.update(t, poseA, t); B.update(t, poseB, t);
       const armsA = points(A, g => /^(Hand|Forearm)_/.test(g)), armsB = points(B, g => /^(Hand|Forearm)_/.test(g));
       const torsoA = points(A, g => TORSO.has(g), true), torsoB = points(B, g => TORSO.has(g), true);
       r.minHandToPartnerTorsoMm = Math.min(r.minHandToPartnerTorsoMm, Math.min(clearance(armsA, torsoB), clearance(armsB, torsoA)) * 1000);
       const handA = points(A, g => g === 'Hand_R'), handB = points(B, g => g === 'Hand_R', true);
       r.minHandToPartnerHandMm = Math.min(r.minHandToPartnerHandMm, clearance(handA, handB, .05) * 1000);
       if (f === spec.contact) { r.contactFrame = f; r.palmDistanceMm = socket(A).distanceTo(socket(B)) * 1000; r.actorDistanceM = A.root.position.distanceTo(B.root.position); }
      }
     }
     for (const k of Object.keys(r)) if (typeof r[k] === 'number') r[k] = +r[k].toFixed(3);
     out.push(r);
    }
   }
   A.setLod(prevLods[0]); B.setLod(prevLods[1]); A.setAction(prevActions[0]); B.setAction(prevActions[1]);
   return {results: out, CLIPS};
  });
  const failures = [];
  for (const r of results) {
   const spec = CLIPS[r.clip], at = `${r.clip} LOD${r.lod}`;
   if (!r.finite) failures.push(`${at}: NaN in bone matrices`);
   if (!(r.moved > .05)) failures.push(`${at}: bones do not move (${r.moved})`);
   if (r.rootDrift > 1e-5) failures.push(`${at}: Root moved ${r.rootDrift}`);
   if (r.lowestMm < -20) failures.push(`${at}: sinks ${r.lowestMm} mm below the floor`);
   if (r.clip === 'drink' && !(r.socketToHandSurfaceMaxMm <= 25)) failures.push(`${at}: cup socket ${r.socketToHandSurfaceMaxMm} mm from the hand surface`);
   if (spec.stride && !(r.slipRatio >= .8 * r.walkRatio && r.slipRatio <= 1.2)) failures.push(`${at}: foot sweeps ${r.footSweepPerCycleM} m per cycle for a declared stride of ${spec.stride} m (walk ratio ${r.walkRatio})`);
   if (spec.partner) {
    if (!(r.palmDistanceMm <= 60)) failures.push(`${at}: palms ${r.palmDistanceMm} mm apart at contact`);
    if (!(r.minHandToPartnerTorsoMm > 0)) failures.push(`${at}: a hand enters the partner's body (${r.minHandToPartnerTorsoMm} mm)`);
    if (!(r.minHandToPartnerHandMm > -5)) failures.push(`${at}: the two hands pass through each other (${r.minHandToPartnerHandMm} mm)`);
   }
   if (spec.prop && (!r.propShown?.length || r.otherPropsShown?.length)) failures.push(`${at}: prop ${spec.prop} shown ${JSON.stringify(r.propShown)}, others ${JSON.stringify(r.otherPropsShown)}`);
  }
  if (errors.length) failures.push('page errors: ' + errors.join('; '));
  if (failures.length) throw Error(failures.join('\n') + '\n' + JSON.stringify(results));
  return {clips: Object.keys(CLIPS).length, results, errors};
 } finally { await ctx.close(); }
}
