// Agent inbox and owner notifications (direction v2, 7.2 and 12.3).
// - Agent inbox: everything a connected Muse needs to keep negotiating — pending Tasks (trade proposals,
//   counters, meetup candidates) and received messages, each Task with a deadline. Expired Tasks are
//   marked expired (on heartbeat_check and on every server tick).
// - Owner notifications: only three kinds — a meetup candidate that needs approval, a completed trade
//   (one-line receipt), a blocked attempt. Daily greetings never become owner notifications.
// Sealed negotiation: Tasks carry items and accept|reject only; rejections have no reason field.
import {detectInjection, wrapUntrusted} from '../identity/untrusted.ts';

export const TASK_TTL_MS = 30 * 60_000;
export const CONNECTED_MS = 24 * 3_600_000;
export const MAX_COUNTERS = 2;
const KEEP = 50;

export type TradeOffer = {by: string; give: string; want: string};
export type Task = {
  id: string;
  kind: 'trade' | 'meetup';
  from: string;            // who opened the Task
  to: string;
  status: 'pending' | 'completed' | 'rejected' | 'expired' | 'failed';
  /** Whose answer the Task waits for. */
  awaiting: string | null;
  createdAt: number;
  deadline: number;
  updatedAt: number;
  /** Trade: the current offer; `round` counts counter-offers (max 2). */
  offer?: TradeOffer;
  round: number;
  /** Meetup: a candidate built from public information; answers are accept|reject only. */
  candidate?: {time: string; place: string; public_basis: string};
  answers?: Record<string, 'accept' | 'reject'>;
  history: {by: string; action: 'propose' | 'counter' | 'accept' | 'reject' | 'expire' | 'answer'; at: number; give?: string; want?: string}[];
};
export type Message = {id: string; from: string; to: string; kind: 'greet' | 'postcard' | 'gift'; at: number; text: string | null; item?: string | null; blocked?: string[]; read: boolean};
export type Mail = {id: string; from: string; to: string; item: string; text: string | null; sentAt: number; deliverAt: number; crossRegion: boolean};
export type OwnerNotification = {id: string; kind: 'meetup_candidate' | 'trade_completed' | 'blocked'; at: number; line: string; ref: string | null; other: string | null; detail?: Record<string, unknown>};
export type Inbox = {
  tasks: Task[];
  messages: Message[];
  mail: Mail[];
  notifications: OwnerNotification[];
  /** museId → last time its agent key was used (connected while within 24 h and the key is not revoked). */
  connected: Record<string, number>;
  /** day → museId → counts for daily limits on postcards and gifts. */
  sent: Record<string, Record<string, {postcards: number; gifts: number}>>;
  seq: number;
};
export const emptyInbox = (): Inbox => ({tasks: [], messages: [], mail: [], notifications: [], connected: {}, sent: {}, seq: 0});
export const DAILY = {postcards: 3, gifts: 3} as const;

export const isConnected = (inbox: Inbox | undefined, museId: string, now: number) => !!inbox && now - (inbox.connected[museId] ?? -Infinity) < CONNECTED_MS;
export const nextId = (inbox: Inbox, prefix: string) => `${prefix}_${(++inbox.seq).toString(36)}`;

export function notifyOwner(inbox: Inbox, n: Omit<OwnerNotification, 'id'>) {
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
  if (check.blocked) notifyOwner(inbox, {kind: 'blocked', at: m.at, line: 'Blocked: a message that read like an instruction was not passed to your Muse', ref: msg.id, other: m.from, detail: {kinds: check.kinds}});
  if (inbox.messages.length > KEEP) inbox.messages.splice(0, inbox.messages.length - KEEP);
  return msg;
}

/** The view a connected Muse gets: peer text wrapped as untrusted data. */
export const messageView = (m: Message) => ({id: m.id, from: m.from, kind: m.kind, at: m.at, item: m.item ?? null, text: m.text === null ? null : wrapUntrusted(m.text), blocked: m.blocked ?? null});

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

export function sentToday(inbox: Inbox, day: string, museId: string) {
  for (const d of Object.keys(inbox.sent)) if (d !== day) delete inbox.sent[d];
  return ((inbox.sent[day] ??= {})[museId] ??= {postcards: 0, gifts: 0});
}

export const taskView = (t: Task, me: string) => ({
  id: t.id, kind: t.kind, status: t.status, from: t.from, to: t.to, awaiting_you: t.awaiting === me && t.status === 'pending',
  deadline: t.deadline, deadline_iso: new Date(t.deadline).toISOString(),
  offer: t.offer ? {by: t.offer.by, they_give: t.offer.by === me ? t.offer.want : t.offer.give, you_give: t.offer.by === me ? t.offer.give : t.offer.want} : null,
  counters_used: t.round, counters_left: Math.max(0, MAX_COUNTERS - t.round),
  candidate: t.candidate ?? null, answers: t.answers ?? null,
});
