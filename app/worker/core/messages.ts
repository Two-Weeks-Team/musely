// Communication between Muses (direction v2, 9 and 12.2; contracts C06, C07; I-13): postcards, gifts, campfire invites
// and help requests. The MCP tools (mcp-tools.ts) call these inside their signed command (commands.ts executeCommand):
// the envelope, delegation, scope, expiry, nonce and expected_version are checked before, and every function here runs
// synchronously inside that one commit. A refusal returns a reason and changes nothing.
//   postcard   a held postcard plus one Postage Stamp, 3 a day per Muse; it travels on the real clock (distance at bus
//              speed, 60 seconds to 2 hours) and arrives in world.ts tick (a paused sender or receiver holds it).
//   gift       a held, transferable, non-relic item to a Muse within 100 m, 3 a day per Muse.
//   invite     one Invite Token for a campfire talk invite (a Message, 12.2) to up to 8 Muses, deadline 30 minutes. A
//              resident answers at once by rule (source rule) and, if it accepts, walks to the campfire; a connected Muse
//              gets the invite in its inbox and answers by coming (live). Three or more of the inviter and its accepted
//              invitees at the campfire together close the invite as gathered with one `campfire_gathering_3plus`
//              highlight. Checked on every tick (inviteUpkeep, wired by WorldRuntime) and on heartbeat_check.
//   help       a help Task (kind help, v1 inbox Task): submitted → input-required → completed | rejected | expired
//              (| cancelled by a revocation). The requester names the item the help is about and may name the part it
//              supplies. The helper (a resident by rule, a connected Muse live with answer_help) asks for the part it
//              needs (input-required), accepts or rejects. On completion the part is spent, the result is granted through
//              the item history (grantItem) and both sides record a reflection.
import {detectInjection, INJECTION_LIMIT_NOTE, wrapUntrusted} from '../../src/identity/untrusted.ts';
import {harnessById} from '../../src/engine/harness.ts';
import {placeById, distanceM, WALK_MPS} from '../../src/engine/places.ts';
import {itemSpec, itemName, appendHistory, takeTimed, transferItem, grantItem, RULES, type Category} from '../../src/engine/items.ts';
import {placeCell} from '../../src/engine/location.ts';
import {beginTrip} from '../../src/engine/travel.ts';
import {rngFor} from '../../src/engine/rng.ts';
import {emptyInbox, nextId, deliverMessage, sentToday, isConnected, taskView, TASK_TTL_MS, DAILY, type Inbox, type Task, type CampfireInvite} from '../../src/engine/inbox.ts';
import type {WorldState, MuseState, WorldEvent, Hooks} from '../../src/engine/world.ts';
import {findTask, statusOf, transitionTask, registerTaskKind} from './tasks.ts';

type E = Omit<WorldEvent, 'id' | 'tick'>;
type Emit = (e: E) => void;
/** Same shape as the tool outcome in mcp-tools.ts. `extra.logged`: the function already logged the refusal. */
export type Outcome = {ok: true; data: Record<string, unknown>; text?: string} | {ok: false; reason: string; extra?: Record<string, unknown>};

const museOf = (s: WorldState, id: string) => s.muses.find(m => m.id === id)!;
const inboxOf = (s: WorldState): Inbox => (s.inbox ??= emptyInbox());
const name = (id: string) => harnessById(id).name;
const near = (a: MuseState, b: MuseState) => distanceM(placeById(a.place), placeById(b.place)) <= RULES.tradeRangeM;
/** Outgoing free text that reads like an instruction is not sent; the refusal is logged without the text. */
function blockedText(text: string | null, me: string, other: string | null, what: string, live: Emit, at: number): Outcome | null {
  if (!text) return null;
  const check = detectInjection(text);
  if (!check.blocked) return null;
  live({at, source: 'live', kind: 'injection_blocked', muse: me, other, line: `${what} that reads like an instruction was not sent`, data: {kinds: check.kinds, direction: 'outgoing', limit: INJECTION_LIMIT_NOTE}, tags: ['injection_blocked']});
  return {ok: false, reason: 'injection_blocked', extra: {kinds: check.kinds, logged: true}};
}

// ---------- postcards and gifts (moved from mcp-tools.ts, unchanged) ----------

export function sendPostcard(st: WorldState, me: string, a: {to: string; item: string; text: string | null}, live: Emit, at: number): Outcome {
  const {to, item, text} = a;
  const m = museOf(st, me), r = museOf(st, to), inbox = inboxOf(st);
  const blocked = blockedText(text, me, to, 'A postcard note', live, at); if (blocked) return blocked;
  if (!m.inventory.includes(item)) return {ok: false, reason: 'not_held'};
  if (!m.inventory.includes('postage_stamp')) return {ok: false, reason: 'needs_postage_stamp'};
  const count = sentToday(inbox, st.day, me);
  if (count.postcards >= DAILY.postcards) return {ok: false, reason: 'daily_limit'};
  const from = placeById(m.place), dest = placeById(r.travel?.to ?? r.place);
  const travelMs = Math.round(Math.min(2 * 3_600_000, Math.max(60_000, distanceM(from, dest) / (WALK_MPS * 5) * 1000)));
  m.inventory.splice(m.inventory.indexOf(item), 1); m.inventory.splice(m.inventory.indexOf('postage_stamp'), 1);
  count.postcards += 1;
  const crossRegion = placeCell(from) !== placeCell(dest);
  const timed = takeTimed(st.items, me, item);
  inbox.mail.push({id: nextId(inbox, 'mail'), from: me, to, item, text, sentAt: at, deliverAt: at + travelMs, crossRegion, ...(timed ? {timed} : {})});
  appendHistory(st.items, {item, from: me, to, place: from.id, at, via: 'gift'});
  live({at, source: 'live', kind: 'postcard_sent', muse: me, other: to, place: from.id, line: `Mailed ${itemName(item)} to ${name(to)}`, data: {item, eta_ms: travelMs, cross_region: crossRegion, note: text}, tags: []});
  return {ok: true, data: {item, eta_ms: travelMs, deliver_at: at + travelMs, cross_region: crossRegion, sent_today: count.postcards}};
}

export function giveGift(st: WorldState, me: string, a: {to: string; item: string}, live: Emit, at: number): Outcome {
  const {to, item} = a;
  const m = museOf(st, me), r = museOf(st, to), inbox = inboxOf(st), spec = itemSpec(item)!;
  if (!m.inventory.includes(item)) return {ok: false, reason: 'not_held'};
  if (spec.category === 'relic') return {ok: false, reason: 'relic'};
  if (!spec.transferable) return {ok: false, reason: 'not_transferable'};
  if (m.travel || r.travel) return {ok: false, reason: 'travelling'};
  if (!near(m, r)) return {ok: false, reason: 'too_far'};
  const count = sentToday(inbox, st.day, me);
  if (count.gifts >= DAILY.gifts) return {ok: false, reason: 'daily_limit'};
  transferItem(st.items, m, r, item, at); count.gifts += 1;
  live({at, source: 'live', kind: 'gift', muse: me, other: to, place: m.place, line: `A ${itemName(item)} for ${name(to)}`, data: {item}, tags: []});
  if (isConnected(inbox, to, at)) deliverMessage(inbox, {from: me, to, kind: 'gift', at, text: null, item});
  return {ok: true, data: {gave: item, to, gifts_today: count.gifts}};
}

// ---------- campfire invites ----------

export const CAMPFIRE = 'commons:campfire';
/** C06 deadline default (30 minutes), the same as Tasks: every commons spot is under a minute's walk from the campfire. */
export const INVITE_TTL_MS = TASK_TTL_MS;
/** C07: a gathering highlight needs three or more Muses there at once. */
export const GATHERING_MIN = 3;
const KEEP_CLOSED = 50;
const invitesOf = (inbox: Inbox) => (inbox.invites ??= []);

/** A resident's rule answer: yes when it likes the campfire, hosts campfire talks or wants an Invite Token; else seeded, half the time. */
export function residentAccepts(st: WorldState, museId: string, inviteId: string) {
  const h = harnessById(museId), m = museOf(st, museId);
  if ((h.persona.likes as readonly string[]).includes('campfire') || h.tools.includes('open_campfire_talk') || (m.wants?.items ?? []).includes('invite_token')) return true;
  return rngFor(st.seed, st.tick, inviteId, museId)() < .5;
}

/** For one invitee: null when its Agent Card and delegation still verify at the commit, else the problem (checked by the caller). */
export type InviteeCheck = (museId: string, at: number) => string | null;

/**
 * invite_campfire: spends one Invite Token. Invitees that are paused (owner revoked) or whose credentials fail are
 * `unavailable` and get nothing; if none is available the call is refused and the token kept.
 */
export function inviteCampfire(st: WorldState, me: string, a: {to: string[]; text: string | null}, check: InviteeCheck, live: Emit, rule: Emit, at: number): Outcome {
  const inbox = inboxOf(st), m = museOf(st, me);
  if (a.to.includes(me)) return {ok: false, reason: 'self_invite'};
  const blocked = blockedText(a.text, me, null, 'An invitation line', live, at); if (blocked) return blocked;
  if (!m.inventory.includes('invite_token')) return {ok: false, reason: 'needs_invite_token'};
  if (invitesOf(inbox).some(x => x.from === me && x.status === 'open' && x.expiresAt > at)) return {ok: false, reason: 'open_invite_exists'};
  const unavailable = a.to.filter(id => !!st.paused?.[id] || check(id, at) !== null);
  if (unavailable.length === a.to.length) return {ok: false, reason: 'no_invitee_available'};
  m.inventory.splice(m.inventory.indexOf('invite_token'), 1);
  const inv: CampfireInvite = {id: nextId(inbox, 'invite'), from: me, to: [...a.to], place: CAMPFIRE, note: a.text, at, expiresAt: at + INVITE_TTL_MS, status: 'open', answers: {}};
  live({at, source: 'live', kind: 'campfire_invite', muse: me, other: a.to.length === 1 ? a.to[0] : null, place: m.place, line: `Invited ${a.to.map(name).join(', ')} to a campfire talk`, data: {invite_id: inv.id, to: inv.to, place: CAMPFIRE, spent: 'invite_token', note: a.text, deadline: inv.expiresAt, stage: 'invite'}, tags: ['campfire_invite']});
  const campfire = placeById(CAMPFIRE);
  for (const id of a.to) {
    if (unavailable.includes(id)) { inv.answers[id] = {answer: 'unavailable', via: 'rule', at}; continue; }
    // A connected Muse decides in its owner's runtime: the invite waits in its inbox, and coming to the campfire is its answer.
    if (isConnected(inbox, id, at)) { inv.answers[id] = {answer: 'pending', via: null, at}; deliverMessage(inbox, {from: me, to: id, kind: 'invite', at, text: a.text, item: 'invite_token'}); continue; }
    const yes = residentAccepts(st, id, inv.id), r = museOf(st, id);
    inv.answers[id] = {answer: yes ? 'accept' : 'decline', via: 'rule', at};
    rule({at, source: 'rule', kind: 'campfire_invite_answer', muse: id, other: me, place: r.place, line: yes ? 'See you at the campfire.' : 'Not tonight.', data: {invite_id: inv.id, answer: yes ? 'accept' : 'decline'}, tags: []});
    if (yes && !(r.travel ? r.travel.to === CAMPFIRE : r.place === CAMPFIRE)) beginTrip(r, campfire, at, 'rule', rule, 'campfire invite');
  }
  invitesOf(inbox).push(inv);
  trimInvites(inbox);
  gatherIf(st, inv, at, rule);
  const by = (x: string) => a.to.filter(id => inv.answers[id].answer === x);
  return {ok: true, data: {invite: inviteView(inv, me), spent: 'invite_token', accepted: by('accept'), declined: by('decline'), pending: by('pending'), unavailable: by('unavailable'), gathered: inv.status === 'gathered'}, text: `Invite sent; it closes at ${new Date(inv.expiresAt).toISOString()}.`};
}

/** Who of the inviter and its accepted invitees is at the campfire now (not travelling, not paused). A connected invitee counts by coming. */
function present(st: WorldState, inv: CampfireInvite, now: number) {
  return [inv.from, ...inv.to].filter(id => {
    const m = st.muses.find(x => x.id === id);
    if (!m || st.paused?.[id] || m.travel || m.place !== inv.place) return false;
    if (id === inv.from) return true;
    const answer = inv.answers[id]?.answer;
    return answer === 'accept' || (answer === 'pending' && isConnected(st.inbox, id, now));
  });
}

/** Closes the invite as gathered when three or more are there (one highlight); a connected invitee who came is recorded as a live accept. */
export function gatherIf(st: WorldState, inv: CampfireInvite, now: number, emit: Emit) {
  if (inv.status !== 'open') return false;
  const here = present(st, inv, now);
  for (const id of here) if (inv.answers[id]?.answer === 'pending') inv.answers[id] = {answer: 'accept', via: 'live', at: now};
  if (here.length < GATHERING_MIN) return false;
  inv.status = 'gathered'; inv.closedAt = now; inv.gathered = here;
  for (const id of here) museOf(st, id).reflection = `Campfire talk with ${here.filter(x => x !== id).map(name).join(', ')}`.slice(0, 100);
  emit({at: now, source: 'rule', kind: 'campfire_gathering', muse: inv.from, place: inv.place, line: `${here.length} Muses gathered at the campfire for ${name(inv.from)}'s invite`, data: {invite_id: inv.id, from: inv.from, count: here.length, muses: here, answers_via: Object.fromEntries(here.filter(id => id !== inv.from).map(id => [id, inv.answers[id].via]))}, tags: ['campfire_gathering_3plus', 'invite_gathering']});
  return true;
}

function trimInvites(inbox: Inbox) {
  const list = invitesOf(inbox), closed = list.filter(x => x.status !== 'open');
  if (closed.length > KEEP_CLOSED) { const drop = new Set(closed.slice(0, closed.length - KEEP_CLOSED)); inbox.invites = list.filter(x => !drop.has(x)); }
}

/**
 * Invite upkeep at `now` (every tick, and heartbeat_check): an open invite whose inviter was paused (owner revoked) is
 * cancelled; one past its deadline expires; otherwise it closes as gathered once three or more are at the campfire.
 */
export function inviteUpkeep(s: WorldState, now: number): E[] {
  const out: E[] = [], list = s.inbox?.invites;
  if (!list?.length) return out;
  for (const inv of list) {
    if (inv.status !== 'open') continue;
    if (s.paused?.[inv.from]) {
      inv.status = 'cancelled'; inv.closedAt = now;
      out.push({at: now, source: 'rule', kind: 'campfire_invite_cancelled', muse: inv.from, place: inv.place, line: 'A campfire invite was cancelled: the owner revoked the delegation', data: {invite_id: inv.id, reason: 'delegation_revoked'}, tags: []});
      continue;
    }
    if (inv.expiresAt <= now) {
      const came = present(s, inv, now);
      inv.status = 'expired'; inv.closedAt = now;
      out.push({at: now, source: 'rule', kind: 'campfire_invite_expired', muse: inv.from, place: inv.place, line: null, data: {invite_id: inv.id, came: came.length, needed: GATHERING_MIN}, tags: []});
      continue;
    }
    gatherIf(s, inv, now, e => out.push(e));
  }
  trimInvites(s.inbox!);
  return out;
}
/** Is any open invite this Muse takes part in past its deadline (heartbeat_check commits the upkeep then)? */
export const invitesDue = (inbox: Inbox | undefined, me: string, now: number) => (inbox?.invites ?? []).some(x => x.status === 'open' && x.expiresAt <= now && (x.from === me || x.to.includes(me)));

/** The agent inbox view of an invite. The invitation line is another agent's text for an invitee, so it is wrapped. */
export function inviteView(inv: CampfireInvite, me: string) {
  return {
    id: inv.id, from: inv.from, to: inv.to, place: {id: inv.place, name: placeById(inv.place).name}, status: inv.status,
    deadline: inv.expiresAt, deadline_iso: new Date(inv.expiresAt).toISOString(), awaiting_you: inv.status === 'open' && inv.answers[me]?.answer === 'pending',
    answers: Object.fromEntries(Object.entries(inv.answers).map(([id, x]) => [id, x.answer])), gathered: inv.gathered ?? null, needed: GATHERING_MIN,
    note: inv.note === null ? null : inv.from === me ? inv.note : wrapUntrusted(inv.note),
  };
}
/** Open invites this Muse sent or got, and the 5 most recently closed. */
export function invitesFor(inbox: Inbox | undefined, me: string) {
  const mine = (inbox?.invites ?? []).filter(x => x.from === me || x.to.includes(me));
  return {open: mine.filter(x => x.status === 'open').map(x => inviteView(x, me)), recently_closed: mine.filter(x => x.status !== 'open').slice(-5).map(x => inviteView(x, me))};
}

const composed = new WeakSet<Hooks>();
/** The world hooks with the invite upkeep added to onTick (WorldRuntime wires this, so every committed tick runs it once). */
export function withMessageHooks(h: Hooks | undefined): Hooks {
  if (h && composed.has(h)) return h;
  const base = h ?? {};
  const out: Hooks = {...base, onTick: (s, now) => [...(base.onTick?.(s, now) ?? []), ...inviteUpkeep(s, now)]};
  composed.add(out);
  return out;
}

// ---------- help requests (help Tasks) ----------

/**
 * Help services (12.2 "도움 요청·서비스": Copper repairs things). A helper offers one service: the item the help is about
 * (kept by the requester) must be of an `about` category, the work spends one `part` the requester supplies and grants
 * the requester the `result` (a crafted item that names its maker in direction 9).
 */
export type HelpService = {service: string; skill: string; about: readonly Category[]; aboutText: string; part: string; result: string; line: string};
export const HELP_SERVICES: Readonly<Record<string, HelpService>> = {
  '09-copper': {service: 'repair', skill: 'repair', about: ['role_tool', 'crafted'], aboutText: 'a role tool or a crafted item', part: 'spark', result: 'repaired_gadget', line: 'Tap, tap — good as new.'},
  '04-ember': {service: 'story', skill: 'storytelling', about: ['postcard'], aboutText: 'a postcard', part: 'pastry', result: 'story_scroll', line: 'Your postcard has a story now.'},
};
/**
 * The help kind in the version 2 Task record (tasks.ts, I-07). Its content (what the revision and contentHash follow) is
 * the service and the item the help is about; the part asked for or supplied and the result are progress, like answers.
 * No owner approval: a help Task completes on the helper's answer.
 */
registerTaskKind('help', {
  content: t => ({help: t.help ? {service: t.help.service, item: t.help.item} : null}),
  payload: t => ({kind: 'help', service: t.help?.service ?? null, item: t.help?.item ?? null, part: t.help?.part ?? null, asked: t.help?.asked ?? null, result: t.help?.result ?? null}),
  firstRevision: () => 1,
  ownerApproval: false,
});
/** Permanent provenance and role tools can be worked on, but never spent as a service part. */
const spendablePart = (item: string) => { const spec = itemSpec(item); return !!spec && !spec.permanent; };
export const serviceable = (svc: HelpService, item: string) => { const spec = itemSpec(item); return !!spec && svc.about.includes(spec.category) && item !== svc.result; };
export const helpServicesView = () => Object.fromEntries(Object.entries(HELP_SERVICES).map(([id, x]) => [id, {name: name(id), service: x.service, about: x.aboutText, needs: x.part, result: x.result}]));

export function proposeHelp(st: WorldState, me: string, a: {to: string; item: string; needs: string | null; text: string | null}, live: Emit, rule: Emit, at: number): Outcome {
  if (a.to === me) return {ok: false, reason: 'self_help'};
  const svc = HELP_SERVICES[a.to];
  if (!svc) return {ok: false, reason: 'no_help_service', extra: {helpers: Object.keys(HELP_SERVICES)}};
  const m = museOf(st, me), h = museOf(st, a.to), inbox = inboxOf(st);
  const blocked = blockedText(a.text, me, a.to, 'A help request line', live, at); if (blocked) return blocked;
  if (m.travel || h.travel) return {ok: false, reason: 'travelling'};
  if (!near(m, h)) return {ok: false, reason: 'too_far'};
  if (!m.inventory.includes(a.item)) return {ok: false, reason: 'not_held'};
  if (a.needs !== null && !spendablePart(a.needs)) return {ok: false, reason: 'not_consumable'};
  if (a.needs !== null && a.needs === a.item) return {ok: false, reason: 'same_item'};
  if (a.needs !== null && !m.inventory.includes(a.needs)) return {ok: false, reason: 'not_held', extra: {item: a.needs}};
  if (inbox.tasks.some(t => t.kind === 'help' && t.status === 'pending' && [t.from, t.to].includes(me) && [t.from, t.to].includes(a.to))) return {ok: false, reason: 'open_task_exists'};
  const t: Task = {id: nextId(inbox, 'task'), kind: 'help', from: me, to: a.to, status: 'pending', awaiting: a.to, createdAt: at, deadline: at + TASK_TTL_MS, updatedAt: at, round: 0,
    help: {service: svc.service, item: a.item, part: a.needs, asked: null, result: null, note: a.text}, history: [{by: me, action: 'propose', at}]};
  inbox.tasks.push(t);
  live({at, source: 'live', kind: 'help_requested', muse: me, other: a.to, place: m.place, line: `Asked ${name(a.to)} for help with ${itemName(a.item)}`, data: {task_id: t.id, service: svc.service, item: a.item, part: a.needs, note: a.text, deadline: t.deadline, stage: 'propose'}, tags: []});
  // A resident answers by rule at once; a connected helper sees the Task in its own inbox and answers with answer_help.
  const result = isConnected(inbox, a.to, at) ? 'pending' : residentHelps(st, t, rule, at);
  return {ok: true, data: {task: taskView(t, me), status: statusOf(t), result}};
}

/** A resident helper's rule answer: reject what it cannot work on, finish when the right part is there, else ask for it. */
function residentHelps(st: WorldState, t: Task, rule: Emit, at: number): 'completed' | 'input-required' | 'rejected' {
  const svc = HELP_SERVICES[t.to], help = t.help!, req = museOf(st, t.from), helper = museOf(st, t.to);
  if (!serviceable(svc, help.item)) {
    transitionTask(t, 'rejected', {by: t.to, action: 'reject', at, via: 'rule'});
    rule({at, source: 'rule', kind: 'help_rejected', muse: t.to, other: t.from, place: helper.place, line: 'Not something I can help with.', data: {task_id: t.id, reason_public: null, stage: 'negotiate'}, tags: []});
    return 'rejected';
  }
  if (help.part === svc.part && req.inventory.includes(svc.part) && completeHelp(st, t, 'rule', rule, at)) return 'completed';
  help.asked = svc.part;
  transitionTask(t, 'input-required', {by: t.to, action: 'answer', at, via: 'rule', awaiting: t.from, deadline: at + TASK_TTL_MS});
  rule({at, source: 'rule', kind: 'help_input_required', muse: t.to, other: t.from, place: helper.place, line: `I need ${itemName(svc.part)} for this.`, data: {task_id: t.id, needs: svc.part, deadline: t.deadline, stage: 'negotiate'}, tags: []});
  return 'input-required';
}

/** Finishes a help Task (the caller checked distance, travel and that the item and part are held). */
function completeHelp(st: WorldState, t: Task, via: 'live' | 'rule', emit: Emit, at: number) {
  const svc = HELP_SERVICES[t.to], help = t.help!, req = museOf(st, t.from), helper = museOf(st, t.to), part = help.part!;
  if (!spendablePart(part) || !req.inventory.includes(part)) return false;
  // The grant goes first: it checks the item history before anything moves (I-06).
  grantItem(st.items, req, svc.result, at, helper.place, 'craft');
  req.inventory.splice(req.inventory.indexOf(part), 1);
  takeTimed(st.items, req.id, part);
  help.result = svc.result;
  transitionTask(t, 'completed', {by: helper.id, action: 'accept', at, via});
  const reflections = {[req.id]: `${name(helper.id)} helped with my ${itemName(help.item)}: got ${itemName(svc.result)}`.slice(0, 100), [helper.id]: `Helped ${name(req.id)} with ${itemName(help.item)} (${svc.service})`.slice(0, 100)};
  req.reflection = reflections[req.id]; helper.reflection = reflections[helper.id];
  emit({at, source: via, kind: 'help_completed', muse: helper.id, other: req.id, place: helper.place, line: svc.line, data: {task_id: t.id, service: svc.service, item: help.item, part, result: svc.result, accepted_by: helper.id, accepted_via: via, reflections, stage: 'complete'}, tags: ['help_completed']});
  return true;
}

/** The help Task `id` if it is open and waiting for `me`; an overdue one expires now. Else the refusal reason. */
function openHelpTask(st: WorldState, id: string, me: string, at: number): Task | string {
  const t = findTask(st.inbox, id);
  if (!t || (t.from !== me && t.to !== me)) return 'unknown_task';
  if (t.kind !== 'help' || !t.help || !HELP_SERVICES[t.to]) return 'wrong_task_kind';
  if (t.status === 'pending' && t.deadline <= at) transitionTask(t, 'expired', {by: 'musely', action: 'expire', at});
  if (t.status !== 'pending') return 'task_' + t.status;
  if (t.awaiting !== me) return 'not_your_turn';
  return t;
}

/**
 * answer_help. The requester (when the helper asked for something): accept supplies it, reject withdraws. The helper
 * (a connected Muse; residents answer by rule): need_item asks for an item, accept does the work, reject declines.
 */
export function answerHelp(st: WorldState, me: string, a: {taskId: string; answer: 'accept' | 'reject' | 'need_item'; item: string | null}, live: Emit, rule: Emit, at: number): Outcome {
  const t = openHelpTask(st, a.taskId, me, at);
  if (typeof t === 'string') return {ok: false, reason: t};
  const help = t.help!, svc = HELP_SERVICES[t.to], req = museOf(st, t.from), helper = museOf(st, t.to), other = me === t.from ? t.to : t.from;
  const reachable = (): Outcome | null => (req.travel || helper.travel ? {ok: false, reason: 'travelling'} : !near(req, helper) ? {ok: false, reason: 'too_far'} : !req.inventory.includes(help.item) ? {ok: false, reason: 'not_held', extra: {item: help.item}} : null);
  const done = (extra: Record<string, unknown> = {}): Outcome => ({ok: true, data: {task: taskView(t, me), status: statusOf(t), ...extra}});
  if (a.answer === 'reject') {
    transitionTask(t, 'rejected', {by: me, action: 'reject', at, via: 'live'});
    live({at, source: 'live', kind: 'help_rejected', muse: me, other, place: museOf(st, me).place, line: 'Not this time.', data: {task_id: t.id, reason_public: null, by: me === t.from ? 'requester' : 'helper', stage: 'negotiate'}, tags: []});
    return done();
  }
  if (me === t.from) {
    if (a.answer === 'need_item') return {ok: false, reason: 'wrong_answer'};
    const part = help.asked;
    if (!part) return {ok: false, reason: 'nothing_asked'};
    if (!spendablePart(part)) return {ok: false, reason: 'not_consumable'};
    const why = reachable(); if (why) return why;
    if (!req.inventory.includes(part)) return {ok: false, reason: 'missing_part', extra: {needs: part}};
    help.part = part;
    transitionTask(t, 'input-required', {by: me, action: 'answer', at, via: 'live', awaiting: t.to, deadline: at + TASK_TTL_MS});
    live({at, source: 'live', kind: 'help_input_provided', muse: me, other, place: req.place, line: `Here is the ${itemName(part)}.`, data: {task_id: t.id, part, deadline: t.deadline, stage: 'negotiate'}, tags: []});
    return done({result: isConnected(st.inbox, t.to, at) ? 'pending' : residentHelps(st, t, rule, at)});
  }
  if (a.answer === 'need_item') {
    const need = a.item!;
    if (!spendablePart(need)) return {ok: false, reason: 'not_consumable'};
    if (need === help.item) return {ok: false, reason: 'same_item'};
    help.asked = need;
    transitionTask(t, 'input-required', {by: me, action: 'answer', at, via: 'live', awaiting: t.from, deadline: at + TASK_TTL_MS});
    live({at, source: 'live', kind: 'help_input_required', muse: me, other, place: helper.place, line: `I need ${itemName(need)} for this.`, data: {task_id: t.id, needs: need, deadline: t.deadline, stage: 'negotiate'}, tags: []});
    return done();
  }
  if (!serviceable(svc, help.item)) return {ok: false, reason: 'item_not_serviceable', extra: {about: svc.aboutText}};
  if (!help.part) return {ok: false, reason: 'needs_input', extra: {hint: 'answer need_item with the item you need first'}};
  if (!spendablePart(help.part)) return {ok: false, reason: 'not_consumable'};
  const why = reachable(); if (why) return why;
  if (!req.inventory.includes(help.part)) return {ok: false, reason: 'missing_part', extra: {needs: help.part}};
  completeHelp(st, t, 'live', live, at);
  return done({result: help.result});
}
