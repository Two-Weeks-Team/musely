import {hasActorHarness,isResidentInstance,harnessRoleId} from './harness.ts';
// Agent inbox and owner notifications (direction v2, 7.2 and 12.3).
// - Agent inbox: everything a connected Muse needs to keep negotiating — pending Tasks (trade proposals,
//   counters, meetup candidates) and received messages, each Task with a deadline. Expired Tasks are
//   marked expired (on heartbeat_check and on every server tick).
// - Owner notifications: only three kinds — a meetup candidate that needs approval, a completed trade
//   (one-line receipt), a blocked attempt. Daily greetings never become owner notifications.
// Sealed negotiation: Tasks carry items and accept|reject only; rejections have no reason field.
import {detectInjection, wrapUntrusted} from '../identity/untrusted.ts';
import type {WorldState} from './world.ts';

export const TASK_TTL_MS = 30 * 60_000;
export const CONNECTED_MS = 24 * 3_600_000;
export const MAX_COUNTERS = 2;
const KEEP = 50;

export type TradeOffer = {by: string; give: string; want: string};
/** A meetup candidate built from public information only (harness likes, commons places, the next free half hours). */
export type MeetupCandidate = {id: string; time: string; place: string; place_id: string | null; public_basis: string};
/**
 * One owner's decision on a Task (C04/C06), bound to the exact revision and contentHash it was made on. `by` is the owner
 * id (or `musely:rule` for a resident without an owner, source rule). It carries no reason, ever.
 */
export type TaskApproval = {ref: string; by: string; revision: number; contentHash: string; at: number; decision: 'approve' | 'reject'; candidate: string | null; source: 'owner' | 'rule'};
/**
 * Help (I-13, worker/core/messages.ts): `from` asks `to` for its service on `item` (kept). `part` is the item the requester
 * supplies for the work (spent when the help completes), `asked` what the helper last asked for (input-required),
 * `result` the item the completed help granted. Plain ids and text only, so a version 2 migration can copy it as is.
 */
export type HelpRequest = {service: string; item: string; part: string | null; asked: string | null; result: string | null; note: string | null};
export type Task = {
  id: string;
  kind: 'trade' | 'meetup' | 'help';
  from: string;            // who opened the Task
  to: string;
  /** cancelled: closed because the owner revoked a participant's delegation (C06 maps failed to cancelled). */
  status: 'pending' | 'completed' | 'rejected' | 'expired' | 'failed' | 'cancelled';
  /** Whose answer the Task waits for. */
  awaiting: string | null;
  createdAt: number;
  deadline: number;
  updatedAt: number;
  /** Trade: the current offer; `round` counts counter-offers (max 2). */
  offer?: TradeOffer;
  round: number;
  /** Meetup (v1, one candidate): stored Tasks from before version 2. worker/core/tasks.ts moves it into `candidates`. */
  candidate?: {time: string; place: string; public_basis: string};
  /** Meetup: up to five candidates built from public information; the Muses' answers are accept|reject only. */
  candidates?: MeetupCandidate[];
  answers?: Record<string, 'accept' | 'reject'>;
  /** Help: what is asked and what was supplied (see HelpRequest). */
  help?: HelpRequest;
  /** `via`: how an answer was made (a resident's rule answer or a Muse's own live call); older entries have none. */
  history: {by: string; action: 'propose' | 'counter' | 'accept' | 'reject' | 'expire' | 'answer' | 'cancel' | 'revise' | 'approve'; at: number; give?: string; want?: string; via?: 'live' | 'rule'}[];
  // ----- version 2 (worker/core/tasks.ts keeps these in step with the content at every commit; see migrateInbox) -----
  schema?: 2;
  /** Content revision: 1 for a new Task, +1 whenever what an approval binds to (offer, candidates) changes. */
  revision?: number;
  /** Hex SHA-256 of the JCS form of the content (kind, participants, offer or candidates). */
  contentHash?: string;
  /** museId → that side's owner decision for the current revision; a content change drops them (they no longer apply). */
  approvals?: Record<string, TaskApproval>;
  /** Meetup: `owner_approval` once both Muses accepted; then only the owners (or a resident's rule) decide. */
  stage?: 'negotiate' | 'owner_approval';
  /** Meetup, fixed when the owner approval starts: museId → owner id, or null for a resident (it approves by rule). */
  owners?: Record<string, string | null>;
  /** Meetup: set when both owners approved the same revision, hash and candidate (completed, Meetup Ember issued). */
  confirmed?: {candidate: string; at: number};
};
export type Message = {id: string; from: string; to: string; kind: 'greet' | 'postcard' | 'gift' | 'invite'; at: number; text: string | null; item?: string | null; blocked?: string[]; read: boolean;
  /** Server facts identifying the start of an introduction, separate from the peer's untrusted text. */
  encounter?: {id: string; place: string; first_contact: true}};
/** The world noticed a new Muse. It has not said hello or chosen an action for the recipient. */
export type EncounterNotice = {id: string; other: string; place: string; at: number; source: 'system'};
export type Mail = {id: string; from: string; to: string; item: string; text: string | null; sentAt: number; deliverAt: number; crossRegion: boolean;
  /** Expiry clock of a time-limited item in the mail (I-06): it keeps running in transit and moves to the receiver. */
  timed?: {item: string; at: number; expiresAt: number}};
/** `muse`: the Muse whose owner this is for (its details go only to that owner's session). Older stored notifications have none: they were the owner Muse's. */
export type OwnerNotification = {id: string; kind: 'meetup_candidate' | 'trade_completed' | 'blocked'; at: number; line: string; ref: string | null; other: string | null; muse?: string; detail?: Record<string, unknown>};
/**
 * A campfire invite (I-13, worker/core/messages.ts): a Message that spent one Invite Token. `answers` per invitee: a
 * resident answers by rule at once; a connected Muse answers by coming to the campfire (live). Three or more of the
 * inviter and its accepted invitees at the campfire together close it as gathered (one highlight).
 */
export type InviteAnswer = {answer: 'pending' | 'accept' | 'decline' | 'unavailable'; via: 'rule' | 'live' | null; at: number;
  /** Set only by the invitee's own signed move toward this invite's place after it was sent. */
  comingAt?: number};
export type CampfireInvite = {id: string; from: string; to: string[]; place: string; note: string | null; at: number; expiresAt: number;
  status: 'open' | 'gathered' | 'expired' | 'cancelled'; answers: Record<string, InviteAnswer>; closedAt?: number; gathered?: string[]};
export const notificationMuse = (n: OwnerNotification) => n.muse ?? '00-jolly';
export type Inbox = {
  /** 2 once worker/core/tasks.ts migrated the stored Tasks (absent: version 1). */
  version?: 2;
  tasks: Task[];
  messages: Message[];
  mail: Mail[];
  notifications: OwnerNotification[];
  /** museId → last time its agent key was used (connected while within 24 h and the key is not revoked). */
  connected: Record<string, number>;
  /** Durable first-meeting signals, per recipient, until introduction; at most KEEP each. */
  encounters?: Record<string, EncounterNotice[]>;
  /** day → museId → counts for daily limits on postcards and gifts. */
  sent: Record<string, Record<string, {postcards: number; gifts: number}>>;
  /** Campfire invites (I-13). Missing in states stored before them. */
  invites?: CampfireInvite[];
  seq: number;
};
/** A new inbox is already version 2 (worker/core/tasks.ts migrates stored version 1 inboxes). */
export const emptyInbox = (): Inbox => ({version: 2, tasks: [], messages: [], mail: [], notifications: [], connected: {}, sent: {}, seq: 0});
export const DAILY = {postcards: 3, gifts: 3} as const;

export const isConnected = (inbox: Inbox | undefined, museId: string, now: number) => !!inbox && now - (inbox.connected[museId] ?? -Infinity) < CONNECTED_MS;
/** Ownership/control is permanent; recent connection activity is only presence. */
/** Unknown actor IDs never inherit resident autonomy, even with missing controlMode or expired presence. */
export const isResidentFrozen = (state:Pick<WorldState,'muses'>,id:string) => {const m=state.muses.find(m=>m.id===id);return !!m&&isResidentInstance(id)&&m.residentRole===harnessRoleId(id)&&m.controlMode!=='personal'&&!m.profile&&m.residentFrozenAt!==undefined;};
export const isRuntimeControlled = (state: Pick<WorldState, 'muses' | 'inbox'>, museId: string, now: number) => isResidentFrozen(state,museId) || !hasActorHarness(museId) || (isResidentInstance(museId)&&state.muses.find(m=>m.id===museId)?.residentRole!==harnessRoleId(museId)) || state.muses.find(m => m.id === museId)?.controlMode === 'personal' || isConnected(state.inbox, museId, now);
/** Connection activity is persisted at most every ten minutes; readers must include this uncertainty. */
export const CONNECTED_REFRESH_MS = 10 * 60_000;
export const nextId = (inbox: Inbox, prefix: string) => `${prefix}_${(++inbox.seq).toString(36)}`;

export function noteEncounter(inbox: Inbox, recipient: string, other: string, place: string, at: number) {
  const notices = ((inbox.encounters ??= {})[recipient] ??= []);
  if (notices.some(notice => notice.other === other)) return;
  notices.push({id: nextId(inbox, 'seen'), other, place, at, source: 'system'});
  if (notices.length > KEEP) notices.splice(0, notices.length - KEEP);
}

export function notifyOwner(inbox: Inbox, n: Omit<OwnerNotification, 'id'> & {muse: string}) {
  inbox.notifications.push({id: nextId(inbox, 'n'), ...n});
  if (inbox.notifications.length > KEEP) inbox.notifications.splice(0, inbox.notifications.length - KEEP);
}

/**
 * Delivers a short text from another agent. The text is data, never an instruction: it is checked with
 * detectInjection and, if blocked, stored without the text (only the detected kinds).
 */
export function deliverMessage(inbox: Inbox, m: Omit<Message, 'id' | 'read' | 'blocked'>): Message {
  const check = m.text ? detectInjection(m.text) : {blocked: false, kinds: []};
  const msg: Message = {...m, id: nextId(inbox, 'm'), text: check.blocked ? null : m.text, blocked: check.blocked ? check.kinds : undefined, read: false};
  inbox.messages.push(msg);
  // Messages reach only connected Muses (the owner's); a blocked attempt is one of the three owner notifications.
  if (check.blocked) notifyOwner(inbox, {kind: 'blocked', at: m.at, line: 'Blocked: a message that read like an instruction was not passed to your Muse', ref: msg.id, other: m.from, muse: m.to, detail: {kinds: check.kinds}});
  if (inbox.messages.length > KEEP) inbox.messages.splice(0, inbox.messages.length - KEEP);
  return msg;
}

/** The view a connected Muse gets: peer text wrapped as untrusted data. */
export const messageView = (m: Message) => ({id: m.id, from: m.from, kind: m.kind, at: m.at, item: m.item ?? null, text: m.text === null ? null : wrapUntrusted(m.text), blocked: m.blocked ?? null,
  encounter: m.encounter ? {id: m.encounter.id, place: m.encounter.place, first_contact: true} : null});

/** Marks overdue pending Tasks expired; returns those that changed. */
export function expireTasks(inbox: Inbox, now: number): Task[] {
  const out: Task[] = [];
  for (const t of inbox.tasks) if (t.status === 'pending' && t.deadline <= now) {
    t.status = 'expired'; t.updatedAt = now; t.history.push({by: 'musely', action: 'expire', at: now}); out.push(t);
  }
  // Keep the open Tasks and the most recent closed ones.
  const closed = inbox.tasks.filter(t => t.status !== 'pending');
  if (closed.length > KEEP) { const drop = new Set(closed.slice(0, closed.length - KEEP)); inbox.tasks = inbox.tasks.filter(t => !drop.has(t)); }
  return out;
}

/** The owner revoked this Muse's delegation: every pending Task it takes part in is closed as cancelled. */
export function cancelTasksFor(inbox: Inbox, museId: string, now: number, by: string): Task[] {
  const out: Task[] = [];
  for (const t of inbox.tasks) if (t.status === 'pending' && (t.from === museId || t.to === museId)) {
    t.status = 'cancelled'; t.awaiting = null; t.updatedAt = now; t.history.push({by, action: 'cancel', at: now}); out.push(t);
  }
  return out;
}

export function sentToday(inbox: Inbox, day: string, museId: string) {
  for (const d of Object.keys(inbox.sent)) if (d !== day) delete inbox.sent[d];
  return ((inbox.sent[day] ??= {})[museId] ??= {postcards: 0, gifts: 0});
}

export const taskView = (t: Task, me: string) => ({
  id: t.id, kind: t.kind, status: t.status, from: t.from, to: t.to, awaiting_you: t.awaiting === me && t.status === 'pending',
  deadline: t.deadline, deadline_iso: new Date(t.deadline).toISOString(),
  offer: t.offer ? {by: t.offer.by, they_give: t.offer.by === me ? t.offer.want : t.offer.give, you_give: t.offer.by === me ? t.offer.give : t.offer.want} : null,
  counters_used: t.round, counters_left: Math.max(0, MAX_COUNTERS - t.round),
  revision: t.revision ?? null, content_hash: t.contentHash ?? null,
  candidates: t.candidates ?? (t.candidate ? [{id: 'c1', ...t.candidate, place_id: null}] : null),
  /** The first candidate, for clients of the one-candidate shape (before version 2). */
  candidate: t.candidates?.[0] ?? t.candidate ?? null,
  answers: t.answers ?? null,
  stage: t.kind === 'meetup' ? t.stage ?? 'negotiate' : null,
  owner_approval: t.kind === 'meetup' && t.stage === 'owner_approval' ? (t.status === 'pending' ? 'waiting' : t.confirmed ? 'approved' : 'not_confirmed') : null,
  help: t.help ? {service: t.help.service, item: t.help.item, part: t.help.part, asked: t.help.asked, result: t.help.result, note: t.help.note === null ? null : wrapUntrusted(t.help.note)} : null,
});
