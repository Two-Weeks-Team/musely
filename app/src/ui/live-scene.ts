// I-09: read-only server snapshot/event → existing rig, props, labels and four small effects.
// The scripted eight-character scene stays intact; live mode reuses its matching IDs and adds Ember/Copper.
import * as T from 'three';
import {loadMuseLight, type MaterialLibrary} from '../character-kit/MaterialLibrary.ts';
import type {MuseActor} from '../character-kit/MuseActor.ts';
import {MUSE_VARIANTS, propsUrl} from '../character-kit/catalog.ts';
import {chooseLods} from '../character-kit/residents.ts';
import {surfaceHeightAt} from '../surfaces.ts';
import {LiveProjection, UPPER_BONES, inventorySummary, museName, ownerOf, type ActorFrame, type FxKind, type LiveWorld, type LiveEvent} from './live-scene-core.ts';

type Host = {scene: T.Scene; actors: MuseActor[] | null | undefined; muses: T.Object3D[]; shadows: T.Mesh[];
  selection: T.Object3D; library: MaterialLibrary | null | undefined; shadowTexture: T.Texture | null; ambient(t: number): void};
type Entry = {actor: MuseActor; shadow: T.Mesh; extra: boolean; label: HTMLElement | null};
type Point = {x: number; y: number};
const FX: Record<FxKind, number> = {teleport: 0x8fb8ff, item: 0xffd27d, stamp: 0x92d7b3, trade_lock: 0xe0b2f7};

export function makeLiveScene(host: Host, project: (p: T.Vector3) => Point = () => ({x: -100, y: -100})) {
  const projection = new LiveProjection(), entries = new Map<string, Entry>(), errors: string[] = [];
  let active = false, disposed = false, frames = new Map<string, ActorFrame>(), now = 0, selected = '00-jolly';
  let lods = MUSE_VARIANTS.map(() => 2 as 0 | 1 | 2);
  const root = typeof document === 'undefined' ? null : document.createElement('div');
  if (root) {root.id = 'live-muse-labels'; root.setAttribute('aria-hidden', 'true'); document.body.append(root);}
  function add(actor: MuseActor, shadow: T.Mesh, extra: boolean) {
    let label: HTMLElement | null = null;
    if (root) {label = document.createElement('div'); label.className = 'live-muse-label'; label.dataset.museId = actor.variant; label.hidden = true; root.append(label);}
    entries.set(actor.variant, {actor, shadow, extra, label});
    actor.root.userData.museId = actor.variant; actor.root.userData.liveExtra = extra;
    if (extra) {host.scene.add(actor.root, shadow); actor.root.visible = shadow.visible = active;}
  }
  for (const [i, actor] of (host.actors ?? []).entries()) add(actor, host.shadows[i], false);
  const effects = new Map<FxKind, T.InstancedMesh>();
  for (const kind of Object.keys(FX) as FxKind[]) {
    const color = FX[kind];
    const mesh = new T.InstancedMesh(new T.RingGeometry(.28, .34, 24), new T.MeshBasicMaterial({color, transparent: true, opacity: .65, side: T.DoubleSide, depthWrite: false}), 10);
    mesh.name = 'LiveEffect_' + kind; mesh.frustumCulled = false; mesh.visible = false; mesh.count = 0; host.scene.add(mesh); effects.set(kind, mesh);
  }
  const ready = Promise.all(MUSE_VARIANTS.filter(v => !entries.has(v.id)).map(async v => {
    if (!host.library) {errors.push(`${v.id}: character kit unavailable`); return;}
    try {
      const loaded = await loadMuseLight(v.id, host.library);
      if (disposed) {loaded.actor.dispose(); return;}
      const shadow = new T.Mesh(new T.PlaneGeometry(1, .8), new T.MeshBasicMaterial({map: host.shadowTexture, transparent: true, depthWrite: false}));
      shadow.rotation.x = -Math.PI / 2; add(loaded.actor, shadow, true);
      void loaded.upgrade();
    } catch (e) {errors.push(`${v.id}: ${String(e)}`);}
  }));
  // Carried props are needed for live events, so request their shared 145 KB file without waiting for all full LODs.
  if (host.library) void host.library.load(propsUrl(host.library.base)).then(g => {if (!disposed) for (const {actor} of entries.values()) actor.addProps(g);}).catch(e => errors.push('props: ' + String(e)));
  void ready.then(() => {if (host.library) void host.library.load(propsUrl(host.library.base)).then(g => {if (!disposed) for (const {actor} of entries.values()) actor.addProps(g);}).catch(() => {});});

  const shadowVisible = (e: Entry, visible: boolean) => {e.shadow.userData.instanceHidden = !visible;if (!e.shadow.userData.instanced) e.shadow.visible = visible;};
  function setActive(value: boolean) {
    const leavingLive = active && !value;
    active = value;
    if (!host.actors?.length) {for (const node of host.muses) node.visible = !value;for (const shadow of host.shadows) {shadow.userData.instanceHidden = value;if (!shadow.userData.instanced) shadow.visible = !value;}}
    if (root) root.hidden = !value;
    for (const e of entries.values()) {
      const visible = value ? !!projection.world?.muses.some(m => m.id === e.actor.variant) : !e.extra; e.actor.root.visible = visible; shadowVisible(e, visible);
      // Preview cues own their hold lifetime through endCues, including a hold begun before this frame leaves live mode.
      if (!value) {if (leavingLive) e.actor.carry(null); if (e.label) e.label.hidden = true;}
    }
    if (!value) for (const mesh of [...effects.values()]) mesh.visible = false;
  }
  function accept(world: LiveWorld, events: readonly LiveEvent[]) {return !disposed && projection.accept(world, events);}
  const sourceOf = (id: string) => [...projection.events].reverse().find(e => e.muse === id || e.other === id)?.source ?? 'rule';
  function update(at: number, selectedId = selected) {
    now = at; selected = selectedId;
    if (disposed || !active || !projection.world) return;
    frames = projection.frames(at);
    for (const e of entries.values()) {
      const f = frames.get(e.actor.variant), actor = e.actor;
      actor.root.visible = !!f; shadowVisible(e, !!f);
      if (!f) {if (e.label) e.label.hidden = true; continue;}
      if (f.upper) {if (!actor.setBlend(f.clip, f.upper, UPPER_BONES)) actor.setAction(f.clip);}
      else actor.setAction(actor.hasAction(f.clip) ? f.clip : 'idle_breathe');
      actor.carry(f.carry);
      actor.setExpression(f.line ? 'Listening' : f.clip === 'celebrate' ? 'Delight' : f.clip === 'think' ? 'Thinking' : 'Neutral');
      const y = surfaceHeightAt(f.x, f.z) + .006;
      actor.update(at / 1000, {x: f.x, y, z: f.z, yaw: f.yaw}, f.actionTime, f.upperTime);
      if (f.carry && !actor.carryShown()) {f.visual = 'fallback'; f.fallback = 'The shared 3D item prop is loading; shown as an item card.'; f.card ??= 'item (3D prop loading)';}
      e.shadow.position.set(f.x, surfaceHeightAt(f.x, f.z) + .002, f.z);
      if (e.label) {
        const p = project(new T.Vector3(f.x, y + 1.12, f.z));
        const foot = project(new T.Vector3(f.x, y, f.z));
        e.label.hidden = Math.abs(foot.y - p.y) < 20 || p.x < 12 || p.y < 70 || p.x > innerWidth - 12 || p.y > innerHeight - 110;
        e.label.style.transform = `translate(${Math.round(p.x)}px,${Math.round(p.y)}px) translate(-50%,-100%)`;
        e.label.textContent = `${museName(f.id)}${f.line ? ': ' + f.line : f.card ? ' · ' + f.card : ''}`;
        e.label.dataset.version = String(projection.world.version ?? projection.world.tick);
        e.label.dataset.source = sourceOf(f.id);
        e.label.dataset.visual = f.visual;
        e.label.title = `${f.status}${f.fallback ? ' · ' + f.fallback : ''}`;
      }
    }
    const ordered = MUSE_VARIANTS.map(v => entries.get(v.id));
    const heights = ordered.map(e => {if (!e?.actor.root.visible) return 0; const p = e.actor.root.position; return Math.abs(project(p.clone()).y - project(p.clone().add(new T.Vector3(0, .95, 0))).y);});
    lods = chooseLods(heights, lods, [MUSE_VARIANTS.findIndex(v => v.id === selectedId)]);
    ordered.forEach((e, i) => e?.actor.setLod(lods[i]));
    const chosen = frames.get(selectedId);
    host.selection.visible = !!chosen;
    if (chosen) host.selection.position.set(chosen.x, surfaceHeightAt(chosen.x, chosen.z) + .004, chosen.z);
    for (const [kind, mesh] of [...effects]) {
      let n = 0;
      for (const f of frames.values()) for (const fx of f.effects) if (fx.kind === kind && n < 10) {
        const s = .75 + fx.progress * 1.6, y = surfaceHeightAt(f.x, f.z) + .02;
        mesh.setMatrixAt(n++, new T.Matrix4().compose(new T.Vector3(f.x, y, f.z), new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2), new T.Vector3(s, s, s)));
      }
      mesh.count = n; mesh.visible = n > 0; mesh.instanceMatrix.needsUpdate = true;
    }
    host.ambient(at / 1000);
  }
  function getMetrics() {
    return {active, worldId: projection.world?.worldId ?? null, version: projection.world?.version ?? null, at: now, errors: [...errors],
      effects: Object.fromEntries([...effects].map(([k, m]) => [k, m.visible ? m.count : 0])),
      muses: (projection.world?.muses ?? []).map(m => {const e = entries.get(m.id), f = frames.get(m.id); return {id: m.id, variant: e?.actor.variant ?? null, owner: ownerOf(m.id), inventory: [...m.inventory], inventorySummary: inventorySummary(m.inventory).text,
        version: projection.world?.version ?? null, rootId: e?.actor.root.uuid ?? null, position: e?.actor.root.position.toArray() ?? null, floorY: f ? surfaceHeightAt(f.x, f.z) + .006 : null,
        source: sourceOf(m.id), frame: f ?? null, rendered: !!e?.actor.root.visible, lod: e?.actor.lod ?? null, loadedLods: e ? [...e.actor.loaded].sort() : [], propsLoaded: e?.actor.propsLoaded ?? false, carryShown: e?.actor.carryShown() ?? false};})};
  }
  function dispose() {
    setActive(false); disposed = true; root?.remove();
    for (const e of entries.values()) if (e.extra) {e.actor.dispose(); e.shadow.removeFromParent(); e.shadow.geometry.dispose(); (e.shadow.material as T.Material).dispose();}
    for (const mesh of [...effects.values()]) {mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as T.Material).dispose();}
  }
  return {ready, accept, setActive, update, getMetrics, dispose, projection, get frames() {return frames;}, get active() {return active;}};
}
