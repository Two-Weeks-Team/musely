// P-03 fixture invariants: real catalog ids, reachable steps, and private reasons never in any public bubble.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {ITEMS} = await import('../src/engine/items.ts');
const {HARNESS_IDS} = await import('../src/engine/harness.ts');
const flows = JSON.parse(readFileSync(new URL('../fixtures/preview-flows.json', import.meta.url)));
const items = new Set([...ITEMS.map(i => i.id), "postcard"]);
const TASK = new Set(['none', 'submitted', 'input-required', 'completed', 'rejected', 'expired', 'cancelled']);

test('every scenario uses real harness and item ids', () => {
  for (const sc of flows.scenarios) {
    for (const p of [sc.a, sc.b].filter(Boolean)) assert.ok(HARNESS_IDS.includes(p.muse), `${sc.id}: ${p.muse}`);
    for (const st of sc.steps) for (const k of ['a', 'b']) for (const i of st.inventory?.[k] ?? []) assert.ok(items.has(i), `${sc.id}/${st.id}: ${i}`);
  }
});

test('every step is reachable and every link resolves', () => {
  for (const sc of flows.scenarios) {
    const ids = new Set(sc.steps.map(s => s.id)), seen = new Set(), queue = [sc.start];
    while (queue.length) { const id = queue.shift(); if (seen.has(id)) continue; assert.ok(ids.has(id), `${sc.id}: missing ${id}`); seen.add(id); const s = sc.steps.find(x => x.id === id); queue.push(...(s.next ? [s.next] : []), ...(s.choices ?? []).map(c => c.goto)); }
    assert.equal(seen.size, ids.size, `${sc.id}: unreachable steps`);
  }
});

test('task status values follow the C06 Task states', () => {
  for (const sc of flows.scenarios) for (const st of sc.steps) if (st.status?.task) assert.ok(TASK.has(st.status.task), `${sc.id}/${st.id}: ${st.status.task}`);
});

test('private reasons never appear in a public bubble, an owner inbox or a step text', () => {
  for (const sc of flows.scenarios) {
    const privates = sc.steps.flatMap(st => ['a', 'b'].map(k => st[k]?.private).filter(Boolean));
    const publicText = sc.steps.flatMap(st => [st.text, st.title, st.a?.bubble, st.b?.bubble, ...(st.ownerInbox ?? []).map(n => n.text)]).filter(Boolean).join('\n').toLowerCase();
    for (const p of privates) {
      // Any distinctive fragment (a run of four or more words) of a private reason must not leak.
      const words = p.toLowerCase().replace(/[^a-z0-9: ]/g, '').split(' ');
      for (let i = 0; i + 4 <= words.length; i++) assert.ok(!publicText.includes(words.slice(i, i + 4).join(' ')), `${sc.id}: leaks "${words.slice(i, i + 4).join(' ')}"`);
    }
  }
});

test('the required states exist: P0 before/after, P1 before/after, no overlap, one declines, revoke, expire, return', () => {
  const step = (sc, id) => flows.scenarios.find(s => s.id === sc)?.steps.find(s => s.id === id);
  for (const [sc, id] of [['p0-delegation', 'traded'], ['p0-delegation', 'refused'], ['p1-transit', 'before'], ['p1-transit', 'after'], ['meetup-no-overlap', 'stop'], ['meetup-agree', 'declined'], ['meetup-agree', 'revoked'], ['meetup-agree', 'expired'], ['meetup-agree', 'return']]) assert.ok(step(sc, id), `${sc}/${id}`);
});

test('P0 runs are controlled: same start and proposal, and the in-force trade passes the real trade rules', async () => {
  const {checkTrade, emptyLedger} = await import('../src/engine/items.ts');
  const sc = flows.scenarios.find(s => s.id === 'p0-delegation');
  const step = id => sc.steps.find(s => s.id === id);
  assert.deepEqual(step('revoke-first').inventory, step('propose').inventory, 'run 2 starts from run 1 state');
  assert.deepEqual(step('refused').inventory, step('propose').inventory, 'refused run leaves inventories unchanged');
  const start = step('propose').inventory, done = step('traded').inventory;
  const give = start.a.find(i => !done.a.includes(i)), want = start.b.find(i => !done.b.includes(i));
  const r = checkTrade(emptyLedger(), '2026-11-01', {id: sc.a.muse, place: 'commons:cafe', inventory: start.a}, {id: sc.b.muse, place: 'commons:cafe', inventory: start.b}, give, want);
  assert.deepEqual(r, {ok: true}, `trade ${give} ↔ ${want}: ${r.reason}`);
});

test('a revoking owner\'s Muse does not resume on its own after revoke', () => {
  for (const sc of flows.scenarios) for (const st of sc.steps.filter(s => /revoke/.test(s.id))) {
    const after = [st.next, ...(st.choices ?? []).map(c => c.goto)].filter(Boolean).map(id => sc.steps.find(s => s.id === id));
    for (const n of after) assert.notEqual(n.id, 'return', `${sc.id}/${st.id} → shared return`);
  }
});

test('every On screen cue uses a real clip and item, on a side that exists', () => {
  const manifest = JSON.parse(readFileSync(new URL('../character-kit/runtime/animations/manifest.json', import.meta.url)));
  const raw = manifest.clips ?? manifest, clips = new Set(Array.isArray(raw) ? raw.map(c => c.name) : Object.keys(raw));
  let n = 0;
  for (const sc of flows.scenarios) for (const st of sc.steps) for (const c of st.scene ?? []) {
    n++; assert.ok(sc[c.side], `${sc.id}/${st.id}: side ${c.side}`);
    if (c.clip) assert.ok(clips.has(c.clip), `${sc.id}/${st.id}: clip ${c.clip}`);
    if (c.item) assert.ok(items.has(c.item), `${sc.id}/${st.id}: item ${c.item}`);
  }
  assert.ok(n >= 10, 'cues exist');
});

test('reward-trade-limits: every refusal on screen is the engine\'s own reason (P-07)', async () => {
  const {checkTrade, discover, emptyLedger, RULES} = await import('../src/engine/items.ts');
  const {PLACES, distanceM} = await import('../src/engine/places.ts');
  const sc = flows.scenarios.find(s => s.id === 'reward-trade-limits'), step = id => sc.steps.find(s => s.id === id);
  const offer = step('offer').inventory, give = offer.a[0], want = offer.b[0], day = '2026-11-02';
  const home = PLACES.find(p => p.id === 'commons:cafe'), far = PLACES.find(p => distanceM(home, p) > RULES.tradeRangeM + 50), near = PLACES.find(p => p.id !== home.id && distanceM(home, p) < RULES.tradeRangeM - 20);
  assert.ok(home && far && near, 'two places within 100 m and one beyond');
  const a = place => ({id: sc.a.muse, place: place.id, inventory: offer.a}), b = place => ({id: sc.b.muse, place: place.id, inventory: offer.b});
  // The screens say: no ability change / too far apart (100 m) / one trade per pair per day.
  assert.deepEqual(checkTrade(emptyLedger(), day, a(home), b(near), give, want), {ok: false, reason: 'no_ability_change'}, 'no-change');
  assert.deepEqual(checkTrade(emptyLedger(), day, a(home), b(far), give, want), {ok: false, reason: 'too_far'}, 'too-far');
  const traded = emptyLedger(); traded.trades[day] = {[[sc.a.muse, sc.b.muse].sort().join('|')]: RULES.pairTradesPerDay};
  assert.deepEqual(checkTrade(traded, day, a(home), b(near), give, want), {ok: false, reason: 'pair_limit'}, 'pair-limit');
  assert.match(step('too-far').text + step('too-far').checks.join(' '), new RegExp(`${RULES.tradeRangeM} m`));
  assert.equal(RULES.pairTradesPerDay, 1); assert.match(step('pair-limit').text + step('pair-limit').checks.join(' '), /once a day|1 of 1/);
  // Finds: one per place per day, ten a day.
  const finds = emptyLedger(), rand = () => 0;
  assert.equal(discover(finds, day, sc.a.muse, home, [], rand, 1).ok, true);
  assert.deepEqual(discover(finds, day, sc.a.muse, home, [], rand, 2), {ok: false, reason: 'place_limit'}, 'place-limit');
  const ten = emptyLedger(); ten.finds[day] = {[sc.a.muse]: Array.from({length: RULES.perDay}, (_, i) => ({place: 'x' + i, item: 'i', kind: 'k'}))};
  assert.deepEqual(discover(ten, day, sc.a.muse, home, [], rand, 3), {ok: false, reason: 'daily_limit'}, 'daily-cap');
  assert.match(step('daily-cap').checks.join(' '), new RegExp(`${RULES.perDay} of ${RULES.perDay}`));
  assert.equal(RULES.perPlacePerDay, 1);
});
