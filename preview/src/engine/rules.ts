// Engine hooks for the item and reward rules (direction v2, 9, 9.1, 12.2, 12.3).
// Offline the engine resolves trades with a simple rule (accept when the item changes the receiver's
// abilities); the world Durable Object replaces this with a live Muse Spark negotiation when budget allows.
import type {Hooks, MuseState, WorldEvent, WorldState} from './world.ts';
import {discover, checkTrade, commitTrade, speedFor, abilityGain, itemName, emptyLedger, canCraftTransitPass, type Ledger} from './items.ts';
import {harnessById} from './harness.ts';
import type {Place} from './places.ts';

type E = Omit<WorldEvent, 'id' | 'tick'>;

/** Desires (9.1): an item matters when it serves the harness goal. */
export const DESIRES: Record<string, string[]> = {
  '03-ripple': ['transit_pass', 'taxi_token', 'route_map'], '02-moss': ['clover_seed', 'garden_pass', 'wildflower'], '01-sunny': ['fruit', 'invite_token', 'coffee'],
  '07-tempo': ['mixtape', 'event_pass', 'snack_box'], '08-orbit': ['night_pass', 'star_chart'], '06-ink': ['reading_list', 'postage_stamp', 'tea'],
  '04-ember': ['invite_token', 'story_scroll', 'pastry'], '05-bloom': ['tea', 'wildflower', 'comfort_note'], '09-copper': ['pocket_gadget', 'coffee', 'repaired_gadget'], '00-jolly': ['coffee', 'postcard'],
};

export function makeHooks(ledger: Ledger = emptyLedger()): Hooks & {ledger: Ledger} {
  return {
    ledger,
    speedFor: (m, from, to) => speedFor(m.inventory, from, to),
    onArrive: (s, m, place, rand, at) => {
      const out: E[] = [];
      // Taxi Tokens are spent on arrival (in-world teleport after neighborhood verification; not a payment).
      const last = m.travel === null ? null : m.travel;
      void last;
      const d = discover(ledger, s.day, m.id, place, m.inventory, rand, at);
      if (!d.ok) return out;
      for (const got of [d.item, d.stamp, d.postcard, d.relic]) if (got && !(m.inventory.includes(got) && !got.startsWith('postcard:') && got !== d.item)) m.inventory.push(got);
      const tags = [d.relic ? 'relic_found' : null, d.reward === 'curiosity' ? 'curiosity_reward' : null].filter(Boolean) as string[];
      out.push({at, source: 'rule', kind: 'discover', muse: m.id, place: place.id, line: `Found ${itemName(d.item)} at ${place.name}`, data: {item: d.item, stamp: d.stamp, postcard: d.postcard, relic: d.relic, reward: d.reward}, tags});
      if (canCraftTransitPass(ledger, s.day, m.id) && !m.inventory.includes('transit_pass')) {
        m.inventory.push('transit_pass');
        ledger.history.push({item: 'transit_pass', from: null, to: m.id, place: place.id, at, via: 'craft'});
        out.push({at, source: 'rule', kind: 'craft', muse: m.id, place: place.id, line: 'Three bus stops visited: Transit Pass crafted', data: {item: 'transit_pass', rule: 'three different bus stops today'}, tags: ['ability_change']});
      }
      return out;
    },
    onEncounter: (s, a, b, place, rand, at) => resolveMeeting(ledger, s, a, b, place, rand, at),
  };
}

function pickTrade(a: MuseState, b: MuseState): {give: string; want: string} | null {
  const want = (DESIRES[a.id] ?? []).find(i => b.inventory.includes(i) && !a.inventory.includes(i));
  if (!want) return null;
  const give = (DESIRES[b.id] ?? []).find(i => a.inventory.includes(i)) ?? a.inventory.find(i => abilityGain(i, b.inventory));
  return give ? {give, want} : null;
}

/** Meeting stages 3–8 (12.3) for the offline rule path: greet → propose → negotiate → lock/swap → ability → reflect. */
export function resolveMeeting(ledger: Ledger, s: WorldState, a: MuseState, b: MuseState, place: Place, rand: () => number, at: number): E[] {
  const out: E[] = [];
  out.push({at, source: 'rule', kind: 'greet', muse: a.id, other: b.id, place: place.id, line: `Hi ${harnessById(b.id).name}!`, data: {stage: 'greet', public: true}, tags: []});
  const t = a.intent?.kind === 'trade' && a.intent.target === b.id && a.intent.give && a.intent.want ? {give: a.intent.give, want: a.intent.want} : pickTrade(a, b);
  if (!t) return out;
  const check = checkTrade(ledger, s.day, a, b, t.give, t.want);
  out.push({at, source: 'rule', kind: 'trade_proposed', muse: a.id, other: b.id, place: place.id, line: `${itemName(t.give)} for your ${itemName(t.want)}?`, data: {give: t.give, want: t.want, stage: 'propose', check: check.ok ? 'ok' : check.reason}, tags: []});
  if (!check.ok) {
    out.push({at, source: 'rule', kind: 'trade_rejected', muse: b.id, other: a.id, place: place.id, line: 'Not this time.', data: {reason_public: check.reason === 'relic' ? 'relics stay with their place' : null, stage: 'negotiate'}, tags: ['trade_rejected']});
    return out;
  }
  // The responder accepts when what it receives changes its abilities (layer 1) or serves its desire.
  const accept = abilityGain(t.give, b.inventory) && ((DESIRES[b.id] ?? []).includes(t.give) || rand() < .55);
  if (!accept) {
    out.push({at, source: 'rule', kind: 'trade_rejected', muse: b.id, other: a.id, place: place.id, line: 'I will keep mine for now.', data: {reason_public: null, stage: 'negotiate'}, tags: ['trade_rejected']});
    return out;
  }
  const first = ledger.history.filter(h => h.via === 'trade').length === 0;
  commitTrade(ledger, s.day, a, b, t.give, t.want, at);
  out.push({at, source: 'rule', kind: 'trade_completed', muse: a.id, other: b.id, place: place.id, line: `Traded ${itemName(t.give)} ↔ ${itemName(t.want)}`, data: {give: t.give, want: t.want, stage: 'swap', receipt: true}, tags: first ? ['first_trade', 'ability_change'] : ['ability_change']});
  a.reflection = `Traded with ${harnessById(b.id).name}: got ${itemName(t.want)}`;
  b.reflection = `Traded with ${harnessById(a.id).name}: got ${itemName(t.give)}`;
  return out;
}
