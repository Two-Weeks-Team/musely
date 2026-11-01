// P-03 fixture invariants: real catalog ids, reachable steps, and private reasons never in any public bubble.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {ITEMS} = await import('../src/engine/items.ts');
const {HARNESS_IDS} = await import('../src/engine/harness.ts');
const flows = JSON.parse(readFileSync(new URL('../fixtures/preview-flows.json', import.meta.url)));
const items = new Set(ITEMS.map(i => i.id));
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
