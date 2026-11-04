import {JUDGE_MUSE} from '../../src/engine/judge-muse.ts';
// Reviewer Muse reset (G-08): POST /api/owner/reset, reviewer session only (checked by the Worker route).
// The reviewer's Muse goes back to its review start state in one world commit: its place and inventory (with items a
// nearby resident can trade for, the garden pass on a fresh 24-hour clock), its public wants, no trip, beat or intent,
// an empty memory, no queued extra turn; its pending Tasks close
// as cancelled; its own inbox messages and owner notifications are dropped; its share of today's counters (finds,
// postcards, gifts, pair trades it takes part in) is cleared. Other Muses' state is not touched, mail in transit is
// left as it is, and a revoked Muse is refused (the owner re-delegates first; nothing re-delegates on its own).
import type {ControlCtx} from './owner-control.ts';
import {REVIEWER_MUSE} from './owner-session.ts';
import {harnessWants} from '../../src/engine/world.ts';
import {PLACES} from '../../src/engine/places.ts';
import {postcardId, stampAcquired} from '../../src/engine/items.ts';
import {cancelTasksFor, emptyInbox, notificationMuse} from '../../src/engine/inbox.ts';

const POSTCARD_PLACE = PLACES.find(p => p.id === 'osm:node/4869055832') ?? PLACES.find(p => p.zone === 'neighborhood')!;
/**
 * The review start state. The Campfire is a commons spot; every commons spot is within 20 m of it, so residents in the
 * commons are inside the 100 m trade range. The gifts are items residents want (Sunny: fruit, coffee; Bloom and Ink:
 * tea; Moss: wildflower, garden_pass) and change abilities, so a trade passes the rules; clover seed and the garden pass
 * craft a Bloom at the Garden; a postcard and a Postage Stamp make send_postcard possible.
 */
export const START_STATE: Record<string, {place: string; inventory: readonly string[]}> = {
 [JUDGE_MUSE.id]:{place:'commons:campfire',inventory:['sun_badge']},
  [REVIEWER_MUSE]: {place: 'commons:campfire', inventory: ['brass_lantern', 'coffee', 'tea', 'fruit', 'wildflower', 'clover_seed', 'garden_pass', 'postage_stamp', postcardId(POSTCARD_PLACE)]},
};

export type ResetResult =
  | {ok: true; muse: string; place: string; inventory: string[]; cancelledTasks: string[]; cleared: {messages: number; notifications: number; counters: string[]; queued_turns: number}}
  | {ok: false; reason: 'unknown_muse' | 'delegation_revoked'};

const uniq = () => Math.random().toString(36).slice(2, 8);

export function resetMuse(c: ControlCtx, museId: string, by: string,authorize?:()=>void): ResetResult {
  authorize?.();
  const start = START_STATE[museId];
  if (!start || !c.trust.agentByMuse(museId) || !c.runtime.state().muses.some(m => m.id === museId)) return {ok: false, reason: 'unknown_muse'};
  if (c.trust.suspended(museId)) return {ok: false, reason: 'delegation_revoked'};
  const now = c.now ? c.now() : Date.now();
  let out: Extract<ResetResult, {ok: true}> | null = null;
  c.runtime.commitExternal(now, `muse-reset-${museId}-${uniq()}`, (st, emit) => {
    authorize?.();
    const m = st.muses.find(x => x.id === museId)!, inbox = (st.inbox ??= emptyInbox());
    const cancelled: string[] = [];
    for (const t of cancelTasksFor(inbox, museId, now, by)) {
      cancelled.push(t.id);
      emit({at: now, source: 'rule', kind: 'task_cancelled', muse: museId, other: t.from === museId ? t.to : t.from, line: 'A pending Task was cancelled: the Muse was reset', data: {task_id: t.id, task: t.kind, reason: 'muse_reset'}, tags: []});
    }
    // Its own inbox only: messages addressed to it and its owner notifications.
    const messages = inbox.messages.length, notifications = inbox.notifications.length;
    inbox.messages = inbox.messages.filter(x => x.to !== museId);
    inbox.notifications = inbox.notifications.filter(n => notificationMuse(n) !== museId);
    // Its share of the daily counters; other Muses' counts and pair trades between others stay.
    const counters: string[] = [];
    for (const [day, byMuse] of Object.entries(st.items.finds)) if (byMuse[museId]) { delete byMuse[museId]; counters.push(`finds:${day}`); }
    for (const [day, pairs] of Object.entries(st.items.trades)) for (const pair of Object.keys(pairs)) if (pair.split('|').includes(museId)) { delete pairs[pair]; counters.push(`trades:${day}:${pair}`); }
    for (const [day, byMuse] of Object.entries(inbox.sent)) if (byMuse[museId]) { delete byMuse[museId]; counters.push(`sent:${day}`); }
    m.place = start.place; m.travel = null; m.beat = null; m.intent = null;
    m.inventory = [...start.inventory]; m.memory = []; m.reflection = ''; m.lastMet = {};
    // Pass clocks (I-06): the old records go with the old inventory; each start pass gets a fresh 24 hours from now.
    if (st.items.expiry) delete st.items.expiry[museId];
    for (const item of start.inventory) stampAcquired(st.items, museId, item, now);
    // A queued extra turn (Spotlight Ticket) belonged to the old state.
    const queued = st.spotlight.visitorQueue.length;
    st.spotlight.visitorQueue = st.spotlight.visitorQueue.filter(id => id !== museId);
    m.wants = harnessWants(museId, now);
    delete m.anchor;
    const cleared = {messages: messages - inbox.messages.length, notifications: notifications - inbox.notifications.length, counters, queued_turns: queued - st.spotlight.visitorQueue.length};
    emit({at: now, source: 'live', kind: 'muse_reset', muse: museId, place: start.place, line: 'Reset to its review start state by the operators', data: {by, place: start.place, inventory: [...start.inventory], cancelled_tasks: cancelled, cleared}, tags: []});
    out = {ok: true, muse: museId, place: start.place, inventory: [...start.inventory], cancelledTasks: cancelled, cleared};
  });
  return out!;
}
