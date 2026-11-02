import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MuseActor} from '../src/character-kit/MuseActor.ts';
import {MUSE_VARIANTS, PARTNER_DISTANCE} from '../src/character-kit/catalog.ts';
import * as live from '../src/ui/live-scene-core.ts';
import {PLACE_BY_ID} from '../src/engine/places.ts';
import {MercatorCoordinate} from 'maplibre-gl';
import geography from '../assets/geography.json' with {type: 'json'};

const NOW = 1_800_000_000_000;
const muse = (id, extra = {}) => ({id, place: 'commons:cafe', travel: null, beat: null, inventory: [], ...extra});
const world = (muses, version = 1) => ({worldId: 'musely', day: '2026-11-02', tick: 1, version, lastTickAt: NOW, muses});
const event = (kind, extra = {}) => ({id: 'e-1', tick: 1, seq: 1, at: NOW, source: 'live', kind, muse: '00-jolly', other: '01-sunny', data: {}, ...extra});
const near = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('I-09 unknown Muse IDs never borrow Jolly\'s slot or actor', () => {
  assert.equal(live.slotAt('commons:cafe', 'unknown-muse'), null);
  assert.equal(live.liveFrames(world([muse('unknown-muse')]), [], NOW).size, 0);
});

test('I-09 all ten IDs keep separate stable places and inventory/owner summaries', () => {
  const w = world(MUSE_VARIANTS.map(v => muse(v.id, {inventory: ['coffee', 'coffee', 'postcard:sf']})));
  const f = live.liveFrames(w, [], NOW);
  assert.deepEqual([...f.keys()], MUSE_VARIANTS.map(v => v.id));
  assert.equal(new Set([...f.values()].map(p => `${p.x},${p.z}`)).size, 10);
  for (const m of w.muses) assert.deepEqual(live.museLngLat(m, NOW), live.sceneToLngLat(f.get(m.id).x, f.get(m.id).z));
  assert.equal(live.inventorySummary(w.muses[0].inventory).text, '3 items · Coffee ×2, Postcard');
  assert.equal(live.ownerOf('00-jolly').kind, 'owner');
  assert.equal(live.ownerOf('04-ember').kind, 'reviewer');
  assert.equal(live.ownerOf('09-copper').kind, 'demo-peer');
});

test('I-09 far map places and commons use the exact Mercator scene transform without geographic drift', () => {
  for (const id of ['bay:sf', 'bay:stanford', 'bay:san-jose']) {
    const p = PLACE_BY_ID.get(id), s = live.placeScene(id), ll = live.sceneToLngLat(s.x, s.z);
    near(ll[0], p.lng, 1e-9); near(ll[1], p.lat, 1e-9);
    const anchor = MercatorCoordinate.fromLngLat(geography.commons), unit = anchor.meterInMercatorCoordinateUnits(), es = live.sceneToEastSouth(s.x, s.z);
    const rendered = new MercatorCoordinate(anchor.x + es.e * unit, anchor.y + es.s * unit, 0).toLngLat();
    near(rendered.lng, p.lng, 1e-9); near(rendered.lat, p.lat, 1e-9);
  }
});

test('I-09 travel uses the server ETA, identical pin/actor pose, and Taxi has no walking interpolation', () => {
  const m = muse('03-ripple', {travel: {to: 'commons:garden', departAt: NOW, arriveAt: NOW + 60_000, speed: 'walk'}});
  const a = live.slotAt(m.place, m.id), b = live.slotAt(m.travel.to, m.id);
  const f = live.liveFrames(world([m]), [], NOW + 30_000).get(m.id);
  near(f.x, (a.x + b.x) / 2); near(f.z, (a.z + b.z) / 2);
  assert.equal(f.clip, 'walk'); assert.equal(f.travel.etaMs, 30_000);
  assert.deepEqual(live.museLngLat(m, NOW + 30_000), live.sceneToLngLat(f.x, f.z));
  const taxi = {...m, travel: {...m.travel, speed: 'taxi'}};
  assert.deepEqual(live.musePose(taxi, NOW + 59_999), {...a, moving: false, progress: 59999 / 60000, travelled: 0, speed: 'taxi'});
  near(live.musePose(taxi, NOW + 60_000).x, b.x);
});

test('I-09 repeated and reordered poll events do not schedule a reward/gesture twice', () => {
  const a = event('greet'), b = event('trade_completed', {id: 'e-2', seq: 2, data: {give: 'coffee', want: 'pastry'}});
  assert.deepEqual(live.scheduleCues([b, a, a]), live.scheduleCues([a, b]));
});

test('I-09 communication and approval events have honest local projections, including a three-Muse campfire invite', () => {
  const kinds = ['postcard_sent', 'postcard_delivered', 'trade_countered', 'meetup_proposed', 'meetup_confirmed', 'campfire_invite', 'campfire_gathering', 'help_requested', 'help_input_required', 'help_completed', 'impostor_rejected', 'injection_blocked'];
  for (const kind of kinds) assert.ok(live.EVENT_PROJECTION[kind], kind);
  const cues = live.scheduleCues([event('campfire_gathering', {other: null, data: {muses: ['00-jolly', '01-sunny', '04-ember']}})]);
  assert.deepEqual(cues.map(c => c.muse).sort(), ['00-jolly', '01-sunny', '04-ember']);
  assert.ok(cues.every(c => c.clip === 'clap'));
});

test('I-09 a handoff has one holder on either side of contact and keeps the authored contact distance', () => {
  const w = world([muse('00-jolly'), muse('01-sunny')]);
  const cues = live.scheduleCues([event('trade_completed', {data: {give: 'coffee', want: 'pastry'}})]);
  const at = cues[0].contactAt;
  const before = live.liveFrames(w, cues, at - 1), after = live.liveFrames(w, cues, at + 1);
  assert.deepEqual([before.get('00-jolly').carry, before.get('01-sunny').carry], ['drink', null]);
  assert.deepEqual([after.get('00-jolly').carry, after.get('01-sunny').carry], [null, 'drink']);
  const a = after.get('00-jolly'), b = after.get('01-sunny');
  near(Math.hypot(a.x - b.x, a.z - b.z), PARTNER_DISTANCE);
  assert.equal(live.liveFrames(w, cues, at + 1).get('00-jolly').actionTime, a.actionTime, 'seek/reconnect does not advance a second local clock');
});

test('I-09 a third Muse in the contact slot causes a stated fallback instead of overlapping bodies', () => {
  const w = world([muse('00-jolly'), muse('01-sunny'), muse('02-moss')]);
  const cues = live.scheduleCues([event('gift', {other: '02-moss', data: {item: 'coffee'}})]);
  const f = live.liveFrames(w, cues, NOW + live.CUE_DELAY_MS + 1500).get('00-jolly');
  assert.equal(f.visual, 'fallback'); assert.match(f.fallback, /occupied/); assert.equal(f.clip, 'wave');
  const sunny = live.slotAt('commons:cafe', '01-sunny'); assert.ok(Math.hypot(f.x - sunny.x, f.z - sunny.z) > .6);
});

test('I-09 seated conversation keeps the posture clip and overlays upper-body speech', () => {
  const w = world([muse('00-jolly', {beat: {id: 'unknown', clip: 'sit_idle', startedAt: NOW - 10_000, endsAt: NOW + 60_000}}), muse('01-sunny')]);
  const cues = live.scheduleCues([event('greet', {line: 'A real hello'})]);
  const f = live.liveFrames(w, cues, NOW + live.CUE_DELAY_MS + 500).get('00-jolly');
  assert.equal(f.clip, 'sit_idle'); assert.equal(f.upper, 'talk'); assert.equal(f.seated, true); assert.equal(f.line, 'A real hello');
});

test('I-09 a missing prop/remote partner is a named fallback rather than a false contact', () => {
  const w = world([muse('00-jolly'), muse('01-sunny', {place: 'commons:garden'})]);
  const cues = live.scheduleCues([event('gift', {data: {item: 'spark'}})]);
  const f = live.liveFrames(w, cues, NOW + live.CUE_DELAY_MS + 500).get('00-jolly');
  assert.equal(f.clip, 'wave'); assert.equal(f.visual, 'fallback'); assert.match(f.fallback, /not here/); assert.equal(f.carry, null);
});

test('I-09 projection store ignores stale snapshots and reconnect/seek is deterministic without mutating server inputs', () => {
  assert.equal(typeof live.LiveProjection, 'function', 'a single snapshot/version owns the live scene');
  const p = new live.LiveProjection(), w = world([muse('00-jolly')], 3), e = event('discover', {data: {item: 'coffee', stamp: 'stamp_cafe'}});
  const original = JSON.stringify(w);
  assert.equal(p.accept(w, [e, e]), true);
  assert.equal(p.accept(world([muse('01-sunny')], 2), []), false);
  assert.equal(p.world.version, 3);
  const now = NOW + live.CUE_DELAY_MS + 2_000;
  assert.deepEqual([...p.frames(now)], [...p.frames(now)]);
  assert.equal(p.events.length, 1);
  p.accept(w, [e, event('gift', {id: 'future', tick: 2})]);
  assert.deepEqual(p.events.map(e => e.id), [e.id], 'an event from a newer tick waits for its matching snapshot');
  assert.equal(JSON.stringify(w), original);
  assert.deepEqual(p.frames(now).get('00-jolly').effects.map(x => x.kind).sort(), ['item', 'stamp']);
  assert.equal(p.accept({...w, day: '2026-11-03', version: 0}, []), true);
  assert.equal(p.accept(w, []), false, 'a late reply from the previous day cannot replace the new day');
});

test('I-09 the actual rig preserves blend/prop phase and identity across LOD and arbitrary local seeks', async () => {
  const loader = new GLTFLoader().register(() => ({name: 'GeometryOnlyAudit', loadTexture: async () => null}));
  const parse = async path => {const b = await readFile('character-kit/runtime/' + path); return loader.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');};
  const [l0, l1, l2, props] = await Promise.all(['base/lod0.glb', 'base/lod1.glb', 'base/lod2.glb', 'attachments/props.glb'].map(parse));
  const a = new MuseActor([l0, l1, l2], null, '00-jolly'); a.addProps(props);
  const root = a.root, skeleton = a.skeleton, leg = skeleton.bones.find(b => b.name === 'UpperLeg_L'), arm = skeleton.bones.find(b => b.name === 'UpperArm_R');
  assert.equal(a.setBlend('sit_idle', 'talk', live.UPPER_BONES), true);
  a.carry('drink'); a.update(1, {x: 1, y: 0, z: 2, yaw: .3}, .4, .7);
  const q = leg.quaternion.clone(), u = arm.quaternion.clone();
  assert.equal(a.carryShown(), true);
  for (const lod of [2, 1, 0]) {a.setLod(lod); a.update(1, {x: 1, y: 0, z: 2, yaw: .3}, .4, .7); assert.equal(a.root, root); assert.equal(a.skeleton, skeleton); near(leg.quaternion.angleTo(q), 0, 1e-6); near(arm.quaternion.angleTo(u), 0, 1e-6); assert.equal(a.carryShown(), true);}
  a.setAction('wave'); a.carry(null); a.update(1, {x: 1, y: 0, z: 2, yaw: .3}, 1); const atEnd = arm.quaternion.clone();
  a.update(1, {x: 1, y: 0, z: 2, yaw: .3}, 0); assert.ok(arm.quaternion.angleTo(atEnd) > .01);
  a.update(1, {x: 1, y: 0, z: 2, yaw: .3}, 1); near(arm.quaternion.angleTo(atEnd), 0, 1e-6); a.dispose();
});

test('I-09 renderer applies the same ten server identities, props, version and selected pose; scripted mode restores its actors', async () => {
  const {makeLiveScene} = await import('../src/ui/live-scene.ts');
  const {MaterialLibrary, loadMuseLight} = await import('../src/character-kit/MaterialLibrary.ts');
  const T = await import('three');
  const {deriveClipsGlb} = await import('./clips-glb.mjs');
  const parser = new GLTFLoader().register(() => ({name: 'GeometryOnlyAudit', loadTexture: async () => null}));
  const library = new MaterialLibrary('character-kit/runtime/', {loadAsync: async path => {const b = path.endsWith('/clips.glb') ? deriveClipsGlb(await readFile(path.replace('/clips.glb', '/lod0.glb'))) : await readFile(path); return parser.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');}});
  const {actor} = await loadMuseLight('00-jolly', library), scene = new T.Scene(), shadow = new T.Mesh();
  scene.add(actor.root, shadow);
  const host = {scene, actors: [actor], muses: [actor.root], shadows: [shadow], selection: new T.Group(), library, shadowTexture: null, ambient: () => {}};
  const view = makeLiveScene(host);
  const w = world(MUSE_VARIANTS.map(v => muse(v.id, {inventory: ['coffee']})), 42);
  view.accept(w, [event('trade_completed', {data: {give: 'coffee', want: 'pastry'}})]);
  await view.ready;
  view.setActive(true); view.update(NOW + live.CUE_DELAY_MS + 2000, '09-copper');
  let metrics = view.getMetrics();
  assert.equal(metrics.version, 42); assert.equal(metrics.muses.length, 10); assert.equal(new Set(metrics.muses.map(m => m.rootId)).size, 10);
  for (const row of metrics.muses) {assert.equal(row.id, row.variant); assert.deepEqual(row.inventory, ['coffee']); assert.equal(row.version, 42); assert.deepEqual(row.position, [row.frame.x, row.floorY, row.frame.z]);}
  const copper = metrics.muses.find(m => m.id === '09-copper');
  near(host.selection.position.x, copper.frame.x); near(host.selection.position.z, copper.frame.z);
  const rootId = metrics.muses[0].rootId;
  view.update(NOW + live.CUE_DELAY_MS + 500, '00-jolly'); view.update(NOW + live.CUE_DELAY_MS + 2000, '00-jolly');
  assert.equal(view.getMetrics().muses[0].rootId, rootId);
  assert.equal(actor.hold('wave', 6), true);
  view.setActive(false); assert.equal(actor.root.visible, true);
  assert.equal(actor.heldAction, 'wave', 'leaving live preserves a newly started preview hold');
  view.setActive(false); actor.setAction('idle_breathe'); actor.update(0, {x: 0, y: 0, z: 0, yaw: 0}, 0);
  assert.equal(actor.heldAction, 'wave', 'inactive live frames preserve a scripted preview hold until endCues');
  assert.equal(actor.getMetrics().action, 'wave');
  actor.release();
  assert.equal(scene.children.filter(o => o.userData.liveExtra && o.visible).length, 0);
  view.dispose(); library.dispose();
});

test('I-09 instanced shadows follow live visibility without drawing the original shadow twice', async () => {
  const T = await import('three'), {instanceMovingMeshes} = await import('../src/instances.ts');
  const scene = new T.Scene(), shadow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial()); scene.add(shadow);
  const update = instanceMovingMeshes(scene, [shadow]), batch = scene.children.find(o => o.isInstancedMesh), matrix = new T.Matrix4();
  assert.equal(shadow.userData.instanced, true);
  shadow.userData.instanceHidden = true; update(); batch.getMatrixAt(0, matrix);
  assert.equal(matrix.elements[0], 0); assert.equal(matrix.elements[5], 0); assert.equal(shadow.visible, false);
  shadow.userData.instanceHidden = false; shadow.position.x = 12; update(); batch.getMatrixAt(0, matrix); near(matrix.elements[12], 12);
});

test('I-09 a missing character kit cannot mislabel the legacy scripted actors as live', async () => {
  const T = await import('three'), {makeLiveScene} = await import('../src/ui/live-scene.ts');
  const root = new T.Group(), shadow = new T.Mesh(), scene = new T.Scene(); scene.add(root, shadow);
  const view = makeLiveScene({scene, actors: null, muses: [root], shadows: [shadow], selection: new T.Group(), library: null, shadowTexture: null, ambient: () => {}});
  await view.ready; view.accept(world([muse('00-jolly')]), []); view.setActive(true); view.update(NOW);
  assert.equal(root.visible, false, 'the local story is not a fallback live actor');
  assert.equal(view.getMetrics().muses[0].rendered, false); assert.equal(view.getMetrics().errors.length, 10);
  view.dispose(); assert.equal(root.visible, true); assert.equal(scene.children.filter(o => o.name.startsWith('LiveEffect_')).length, 0);
});


test('I-09 publication time keeps a slow heartbeat cue ahead of the next poll, preserving the business event time', () => {
  const e = event('spotlight', {data: {publishedAt: NOW + 16_000}, line: 'A delayed live reply'});
  const cues = live.scheduleCues([e]);
  assert.ok(cues.length > 0);
  assert.equal(cues[0].start, NOW + 16_000 + live.CUE_DELAY_MS);
  assert.ok(cues[0].end > NOW + 26_000, 'a 10s poll after publication can still show the cue');
  assert.equal(e.at, NOW);
  assert.equal(live.scheduleCues([event('spotlight', {data: {publishedAt: NOW - 1000}})])[0].start, NOW + live.CUE_DELAY_MS);
});

test('I-09 every original portrait selects the actual live actor instead of the fixed commons', async () => {
  const {transform} = await import('esbuild');
  const src = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function select(i:number)'), src.indexOf('function selectLive('));
  const code = (await transform(fn, {loader: 'ts'})).code;
  const ids = ['00-jolly','01-sunny','02-moss','03-ripple','05-bloom','06-ink','07-tempo','08-orbit'];
  const picked = [];
  Function('mode','RESIDENT_VARIANTS','selectLive','manual','updateUI','map','visit',code+';for(let i=0;i<8;i++)select(i);')('world',ids,id=>picked.push(id),()=>{},()=>{},{getZoom:()=>10},()=>{throw Error('fixed commons visit');});
  assert.deepEqual(picked, ids);
});
