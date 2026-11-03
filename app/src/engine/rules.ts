import {participantName} from './participants.ts';
// Engine hooks for the item and reward rules (direction v2, 9, 9.1, 12.2, 12.3).
// Offline the engine resolves trades with a simple rule (accept when the item changes the receiver's
// abilities); the world Durable Object replaces this with a live Muse Spark negotiation when budget allows.
import type {Hooks, MuseState, WorldEvent, WorldState} from './world.ts';
import {discover, receiveDiscovery, grantItem, checkTrade, commitTrade, speedFor, abilityGain, itemName, canCraftTransitPass, historyFault, type Ledger} from './items.ts';
import {harnessById, HARNESSES} from './harness.ts';
import type {Place} from './places.ts';
import {isRuntimeControlled, nextId, deliverMessage, notifyOwner, TASK_TTL_MS, emptyInbox} from './inbox.ts';
import {teleportCheck, sameArea} from './location.ts';

type E = Omit<WorldEvent, 'id' | 'tick'>;

/** Desires (9.1) now live in each Muse's `wants` (harness default, updatable); kept as a lookup for tests. */
export const DESIRES: Record<string, string[]> = Object.fromEntries(HARNESSES.map(h => [h.id, [...h.wants.items]]));
const wantsOf = (m: MuseState) => m.wants?.items ?? DESIRES[m.id] ?? [];

/** Hooks read the item ledger from the world state, so it persists with every committed tick. */
export function makeHooks(): Hooks {
  return {
    // Taxi only for a verified teleport (13.1): the owner's Muse into its owner's verified cell. Residents walk or ride the bus.
    speedFor: (m, from, to, s) => sameArea(from, to) ? 'walk' : speedFor(m.inventory, from, to, !!s && teleportCheck(s.owner, m, to) === null),
    onArrive: (s, m, place, rand, at) => {
      const out: E[] = [];
      const ledger = s.items;
      // A tampered item history stops finds (I-06); the Muse still arrives.
      if (historyFault(ledger, false, at)) return out;
      const d = discover(ledger, s.day, m.id, place, m.inventory, rand, at);
      if (!d.ok) return out;
      receiveDiscovery(ledger, m, d, at);
      const tags = [d.relic ? 'relic_found' : null, d.reward === 'curiosity' ? 'curiosity_reward' : null].filter(Boolean) as string[];
      out.push({at, source: 'rule', kind: 'discover', muse: m.id, place: place.id, line: `Found ${itemName(d.item)} at ${place.name}`, data: {item: d.item, stamp: d.stamp, postcard: d.postcard, relic: d.relic, reward: d.reward, spent: d.spent}, tags: d.spent ? [...tags, 'ability_change'] : tags});
      if (canCraftTransitPass(ledger, s.day, m.id) && !m.inventory.includes('transit_pass')) {
        grantItem(ledger, m, 'transit_pass', at, place.id, 'craft');
        out.push({at, source: 'rule', kind: 'craft', muse: m.id, place: place.id, line: 'Three bus stops visited: Transit Pass crafted', data: {item: 'transit_pass', rule: 'three different bus stops today'}, tags: ['ability_change']});
      }
      return out;
    },
    onEncounter: (s, a, b, place, rand, at) => resolveMeeting(s.items, s, a, b, place, rand, at),
  };
}

function pickTrade(a: MuseState, b: MuseState): {give: string; want: string} | null {
  const want = wantsOf(a).find(i => b.inventory.includes(i) && !a.inventory.includes(i));
  if (!want) return null;
  const give = wantsOf(b).find(i => a.inventory.includes(i)) ?? a.inventory.find(i => abilityGain(i, b.inventory, [], b.id));
  return give ? {give, want} : null;
}

/** Meeting stages 3–8 (12.3) for the offline rule path: greet → propose → negotiate → lock/swap → ability → reflect. */
export function resolveMeeting(ledger: Ledger, s: WorldState, a: MuseState, b: MuseState, place: Place, rand: () => number, at: number): E[] {
  const out: E[] = [];
  // A connected Muse (7.2, 8.8) thinks in its owner's runtime: the rule engine never decides for it.
  // Its initiations come only through MCP tools, and proposals to it wait in its inbox as Tasks.
  const inbox = (s.inbox ??= emptyInbox());
  if (isRuntimeControlled(s, a.id, at)) return out;
  const greeting = `Hi ${participantName(s,b.id)}!`;
  out.push({at, source: 'rule', kind: 'greet', muse: a.id, other: b.id, place: place.id, line: greeting, data: {stage: 'greet', public: true}, tags: []});
  const toConnected = isRuntimeControlled(s, b.id, at);
  if (toConnected) deliverMessage(inbox, {from: a.id, to: b.id, kind: 'greet', at, text: greeting});
  const t = a.intent?.kind === 'trade' && a.intent.target === b.id && a.intent.give && a.intent.want ? {give: a.intent.give, want: a.intent.want} : pickTrade(a, b);
  if (!t) return out;
  // A tampered item history stops trades (I-06); the greeting above still happens.
  if (historyFault(ledger, false, at)) return out;
  const check = checkTrade(ledger, s.day, a, b, t.give, t.want, 0, at);
  out.push({at, source: 'rule', kind: 'trade_proposed', muse: a.id, other: b.id, place: place.id, line: `${itemName(t.give)} for your ${itemName(t.want)}?`, data: {give: t.give, want: t.want, stage: 'propose', check: check.ok ? 'ok' : check.reason}, tags: []});
  if (!check.ok) {
    out.push({at, source: 'rule', kind: 'trade_rejected', muse: b.id, other: a.id, place: place.id, line: 'Not this time.', data: {reason_public: check.reason === 'relic' ? 'relics stay with their place' : null, stage: 'negotiate'}, tags: ['trade_rejected']});
    return out;
  }
  if (toConnected) {
    // Inbox model: the proposal becomes a pending Task with a deadline instead of an automatic answer.
    const id = nextId(inbox, 'task');
    inbox.tasks.push({id, kind: 'trade', from: a.id, to: b.id, status: 'pending', awaiting: b.id, createdAt: at, deadline: at + TASK_TTL_MS, updatedAt: at, offer: {by: a.id, give: t.give, want: t.want}, round: 0, history: [{by: a.id, action: 'propose', at, give: t.give, want: t.want}]});
    out[out.length - 1].data = {...out[out.length - 1].data, task_id: id, inbox: true, deadline: at + TASK_TTL_MS};
    return out;
  }
  // The responder accepts when what it receives changes its abilities (layer 1) or serves its desire.
  const accept = abilityGain(t.give, b.inventory, wantsOf(b), b.id) && (wantsOf(b).includes(t.give) || rand() < .55);
  if (!accept) {
    out.push({at, source: 'rule', kind: 'trade_rejected', muse: b.id, other: a.id, place: place.id, line: 'I will keep mine for now.', data: {reason_public: null, stage: 'negotiate'}, tags: ['trade_rejected']});
    return out;
  }
  const first = ledger.history.filter(h => h.via === 'trade').length === 0;
  commitTrade(ledger, s.day, a, b, t.give, t.want, at);
  const ownerMuse = s.owner?.muse;
  if (ownerMuse && (a.id === ownerMuse || b.id === ownerMuse)) {
    const other = a.id === ownerMuse ? b.id : a.id, got = a.id === ownerMuse ? t.want : t.give, gave = a.id === ownerMuse ? t.give : t.want;
    notifyOwner(inbox, {kind: 'trade_completed', at, line: `Your Muse traded ${itemName(gave)} for ${participantName(s,other)}'s ${itemName(got)}`, ref: null, other, muse: ownerMuse});
  }
  out.push({at, source: 'rule', kind: 'trade_completed', muse: a.id, other: b.id, place: place.id, line: `Traded ${itemName(t.give)} ↔ ${itemName(t.want)}`, data: {give: t.give, want: t.want, stage: 'swap', receipt: true}, tags: first ? ['first_trade', 'ability_change'] : ['ability_change']});
  a.reflection = `Traded with ${participantName(s,b.id)}: got ${itemName(t.want)}`;
  b.reflection = `Traded with ${participantName(s,a.id)}: got ${itemName(t.give)}`;
  return out;
}
