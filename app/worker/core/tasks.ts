// Shared workflow Tasks (C06): the version 2 Task record, its migration, and the meetup owner approval (I-07).
// I-03A made the facade; I-07 owns the stored version 2 fields, the migration, trade and meetup; I-13 adds help through
// registerTaskKind (see "kinds" below) without editing this file's workflow.
//
// Storage: Tasks stay in the agent inbox (src/engine/inbox.ts, inside the world state) in their v1 shape, so every
// existing path (MCP tools, the engine, revocation, reset, purge) keeps working. Version 2 adds, on the same object:
//   schema 2 · revision (content revision) · contentHash · approvals {museId → TaskApproval} · meetup candidates/stage/owners
// syncTask keeps revision and contentHash in step with the content; WorldRuntime runs it at every commit point, so a
// content change anywhere (a counter, a new candidate list) moves the revision and drops the approvals made on the old one.
//
// Storage migration is not done here: inbox Tasks stay stored in the v1 shape and a record is computed per read. The
// version 2 storage migration (keep id/deadline/offer/history, equal counts before and after, idempotent on restart) is I-07.
//
// C06: "pending은 응답 전 submitted/응답 대기 input-required로" (pending is submitted before any answer, input-required
// while an answer is awaited). Read as: only the opening `propose` in the history → submitted; any later step (a
// counter, or a meetup answer) → input-required, and the side in `awaiting` owes the next answer.
//
// Status names (C06, A2A Task states) and the v1 Task status they come from:
//   submitted       pending, nobody has answered yet (only the opening `propose` in the history)
//   input-required  pending after at least one answer or counter (or waiting for the owners' approval)
//   completed       completed
//   rejected        rejected
//   expired         expired
//   cancelled       cancelled, and failed (the migration rewrites a stored failed as cancelled)
//
// Meetup (direction v2 12.2/12.3, C06): propose_meetup builds up to five candidates from public information only; each
// Muse answers accept|reject; when both accept, the owners decide (POST /api/owner/approvals) on the exact revision and
// contentHash, choosing one candidate. A resident (a Muse no owner can sign in for) approves by rule. Only when both
// sides approved the same revision, hash and candidate is the Task completed and a Meetup Ember issued to both (through
// grantItem and the item history chain). A rejection, the deadline, a revocation or a candidate change confirms nothing.
// The owners' private conditions are evaluated in their own browser (src/ui/owner-inbox.ts) and never sent; a decision
// carries no reason, and the route refuses any field it does not know.
import {canonicalize} from '../../src/identity/jcs.ts';
import {sha256Hex} from '../../src/engine/sha256.ts';
import {emptyInbox, nextId, notifyOwner, notificationMuse, TASK_TTL_MS, type Inbox, type Task, type MeetupCandidate, type TaskApproval} from '../../src/engine/inbox.ts';
import {localClock, type WorldEvent, type WorldState} from '../../src/engine/world.ts';
import {harnessById} from '../../src/engine/harness.ts';
import {placeById} from '../../src/engine/places.ts';
import {grantItem, historyFault} from '../../src/engine/items.ts';
import {PRINCIPALS} from './owner-session.ts';

export const TASK_RECORD_VERSION = 2;
export const TASK_KINDS = ['trade', 'meetup', 'help'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_STATUSES = ['submitted', 'input-required', 'completed', 'rejected', 'expired', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TERMINAL_STATUSES: readonly TaskStatus[] = ['completed', 'rejected', 'expired', 'cancelled'];
type V1Status = Task['status'];
type HistoryAction = Task['history'][number]['action'];
type Emit = (e: Omit<WorldEvent, 'id' | 'tick'>) => void;

export type TaskRecord = {
  version: typeof TASK_RECORD_VERSION;
  id: string;
  kind: TaskKind;
  /** [opener, other side]: the v1 `from` and `to`. */
  participants: [string, string];
  status: TaskStatus;
  /** Who must answer next (input-required and submitted), else null (also while the owners decide). */
  awaiting: string | null;
  /** Content revision: 1 for a new Task, +1 each time what an approval binds to changes (a counter, new candidates). */
  revision: number;
  /** Hex SHA-256 of the JCS form of what an approval binds to: kind, participants and the current offer or candidates. */
  contentHash: string;
  /** The deadline (ms since epoch): the answer deadline, or the owner approval deadline once the owners decide. */
  expiresAt: number;
  payload: TaskPayload;
  /** museId → that side's owner decision, only those made on this revision and contentHash. */
  approvals: Record<string, TaskApproval>;
  /** The refs of `approvals` (C04 approval_ref). */
  approvalRefs: string[];
  /** Ids of world events about this Task, when the caller passes the events (taskRecord's `events`). */
  eventIds: string[];
  createdAt: number;
  updatedAt: number;
};
export type TaskPayload =
  | {kind: 'trade'; offer: {by: string; give: string; want: string} | null; counters: number}
  | {kind: 'meetup'; candidates: MeetupCandidate[]; answers: Record<string, 'accept' | 'reject'>; stage: 'negotiate' | 'owner_approval'; confirmed: {candidate: string; at: number} | null}
  | {kind: 'help'; [k: string]: unknown};

// ---------- kinds (the extension point: I-13 registers help) ----------
export type KindSpec = {
  /** What an approval binds to besides kind and participants (part of contentHash). Answers, times and deadlines are not. */
  content: (t: Task) => Record<string, unknown>;
  payload: (t: Task) => TaskPayload;
  /** The revision a stored version 1 Task migrates to (1 + how many times its content changed). */
  firstRevision: (t: Task) => number;
  /** True when the Task completes only through owner approval (POST /api/owner/approvals). */
  ownerApproval: boolean;
};
const KIND_SPECS: Partial<Record<TaskKind, KindSpec>> = {};
/** Adds a Task kind's content, payload and approval rule (I-13: help). Each kind is registered once. */
export function registerTaskKind(kind: TaskKind, spec: KindSpec) {
  if (KIND_SPECS[kind]) throw new Error(`task kind already registered: ${kind}`);
  KIND_SPECS[kind] = spec;
}
/** A kind nobody registered yet: its content is only kind and participants, and it needs no owner approval. */
const UNREGISTERED: KindSpec = {content: () => ({}), payload: t => ({kind: t.kind as 'help'}), firstRevision: () => 1, ownerApproval: false};
export const kindSpec = (kind: string): KindSpec => KIND_SPECS[kind as TaskKind] ?? UNREGISTERED;

/** A meetup's candidates; a stored version 1 meetup (one `candidate`) reads as a one-candidate list. */
export const candidatesOf = (t: Task): MeetupCandidate[] => t.candidates ?? (t.candidate ? [{id: 'c1', time: t.candidate.time, place: t.candidate.place, place_id: null, public_basis: t.candidate.public_basis}] : []);

registerTaskKind('trade', {
  content: t => ({offer: t.offer ?? null}),
  payload: t => ({kind: 'trade', offer: t.offer ? {...t.offer} : null, counters: t.round}),
  firstRevision: t => 1 + t.round,
  ownerApproval: false,
});
registerTaskKind('meetup', {
  content: t => ({candidates: candidatesOf(t)}),
  payload: t => ({kind: 'meetup', candidates: candidatesOf(t).map(c => ({...c})), answers: {...(t.answers ?? {})}, stage: t.stage ?? 'negotiate', confirmed: t.confirmed ? {...t.confirmed} : null}),
  firstRevision: () => 1,
  ownerApproval: true,
});

/** The v1 status of a Task in the version 2 names (see the table at the top). */
export function statusOf(t: Pick<Task, 'status' | 'history'>): TaskStatus {
  switch (t.status) {
    case 'pending': return t.history.some(h => h.action !== 'propose') ? 'input-required' : 'submitted';
    case 'failed': return 'cancelled';
    default: return t.status;
  }
}

/** The v1 status a version 2 status is stored as. */
export const v1Status = (s: TaskStatus): V1Status => (s === 'submitted' || s === 'input-required' ? 'pending' : s);

/** What an approval binds to (C04): the proposal's content and parties. */
export const contentOf = (t: Task) => ({kind: t.kind, participants: [t.from, t.to], ...kindSpec(t.kind).content(t)});
export const taskContentHash = (t: Task) => sha256Hex(canonicalize(contentOf(t)));

/** The revision the Task has (or will have after the next sync, when its content changed since the last one). */
export function revisionOf(t: Task, hash = taskContentHash(t)) {
  if (t.schema !== 2 || typeof t.revision !== 'number') return kindSpec(t.kind).firstRevision(t);
  return t.contentHash === hash ? t.revision : t.revision + 1;
}
/** The approvals that still apply: made on the current revision and contentHash. */
export function validApprovals(t: Task, revision = revisionOf(t), hash = taskContentHash(t)): Record<string, TaskApproval> {
  return Object.fromEntries(Object.entries(t.approvals ?? {}).filter(([, a]) => a.revision === revision && a.contentHash === hash));
}

/** A version 2 record of an inbox Task. Pass `events` (any slice of the world log) to fill eventIds. Changes nothing. */
export function taskRecord(t: Task, opts: {events?: readonly Pick<WorldEvent, 'id' | 'data'>[]} = {}): TaskRecord {
  const status = statusOf(t), hash = taskContentHash(t), revision = revisionOf(t, hash), approvals = validApprovals(t, revision, hash);
  return {
    version: TASK_RECORD_VERSION, id: t.id, kind: t.kind, participants: [t.from, t.to], status,
    awaiting: TERMINAL_STATUSES.includes(status) ? null : t.awaiting,
    revision, contentHash: hash, expiresAt: t.deadline,
    payload: kindSpec(t.kind).payload(t), approvals, approvalRefs: Object.values(approvals).map(a => a.ref),
    eventIds: (opts.events ?? []).filter(e => (e.data as {task_id?: unknown} | undefined)?.task_id === t.id).map(e => e.id),
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

// ---------- version 2 storage: sync and migration ----------
/**
 * Brings one stored Task to version 2, in place, and keeps it there: a version 1 meetup's `candidate` becomes
 * `candidates`, a stored `failed` becomes `cancelled` (C06), and revision/contentHash follow the content. When the
 * content changed since the last sync the revision moves up by one and every approval is dropped (they were made on
 * the old content). Idempotent; returns whether anything changed.
 */
export function syncTask(t: Task): boolean {
  let changed = false;
  if (t.kind === 'meetup' && !t.candidates) { t.candidates = candidatesOf(t); delete t.candidate; changed = true; }
  if (t.status === 'failed') { t.status = 'cancelled'; t.awaiting = null; changed = true; }
  const hash = taskContentHash(t);
  if (t.schema !== 2 || typeof t.revision !== 'number' || typeof t.contentHash !== 'string') {
    t.revision = kindSpec(t.kind).firstRevision(t); t.contentHash = hash; t.approvals ??= {}; t.schema = 2;
    return true;
  }
  t.approvals ??= {};
  if (t.contentHash !== hash) { t.revision += 1; t.contentHash = hash; t.approvals = {}; return true; }
  return changed;
}
/** syncTask over the inbox; the commit points call it. Returns how many Tasks changed. */
export function syncTasks(inbox: Inbox | undefined): number {
  let n = 0;
  for (const t of inbox?.tasks ?? []) if (syncTask(t)) n += 1;
  return n;
}

export type InboxCounts = {tasks: number; tasks_by_kind: Record<string, number>; messages: number; mail: number; notifications: number; connected: number; sent_days: number};
export const inboxCounts = (i: Inbox): InboxCounts => ({
  tasks: i.tasks.length, tasks_by_kind: i.tasks.reduce<Record<string, number>>((m, t) => ((m[t.kind] = (m[t.kind] ?? 0) + 1), m), {}),
  messages: i.messages.length, mail: i.mail.length, notifications: i.notifications.length, connected: Object.keys(i.connected).length, sent_days: Object.keys(i.sent).length,
});
const needsSync = (t: Task) => t.schema !== 2 || typeof t.revision !== 'number' || typeof t.contentHash !== 'string' || t.status === 'failed' || (t.kind === 'meetup' && !t.candidates);
export const needsMigration = (inbox: Inbox | undefined) => !inbox || inbox.version !== 2 || inbox.tasks.some(needsSync);

export type MigrationReport = {from: 1 | 2; to: 2; migrated: number; failedToCancelled: number; candidatesMoved: number; before: InboxCounts; after: InboxCounts};
/**
 * Migrates a stored inbox to version 2 in place: every Task is kept (same id, deadline, offer, history), only gains the
 * version 2 fields; messages, mail, notifications, connected flags and daily counters are not touched. Running it again
 * changes nothing.
 */
export function migrateInbox(inbox: Inbox): MigrationReport {
  const before = inboxCounts(inbox), from = inbox.version === 2 ? 2 : 1;
  let migrated = 0, failedToCancelled = 0, candidatesMoved = 0;
  for (const t of inbox.tasks) {
    if (!needsSync(t)) continue;
    if (t.status === 'failed') failedToCancelled += 1;
    if (t.kind === 'meetup' && !t.candidates && t.candidate) candidatesMoved += 1;
    syncTask(t); migrated += 1;
  }
  inbox.version = 2;
  return {from, to: 2, migrated, failedToCancelled, candidatesMoved, before, after: inboxCounts(inbox)};
}
type MigrationHost = {state(): WorldState; commitExternal(now: number, label: string, mutate: (s: WorldState, emit: Emit) => void): unknown};
/** At start-up (WorldDO): migrates the stored inbox once, in one commit with a `tasks_migrated` event; a restart after that writes nothing. */
export function migrateTaskStore(runtime: MigrationHost, now: number): MigrationReport | null {
  if (!needsMigration(runtime.state().inbox)) return null;
  let report: MigrationReport | null = null;
  runtime.commitExternal(now, 'tasks-v2-migrate', (st, emit) => {
    report = migrateInbox((st.inbox ??= emptyInbox()));
    emit({at: now, source: 'rule', kind: 'tasks_migrated', muse: null, line: null, data: {from: report.from, to: report.to, migrated: report.migrated, failed_to_cancelled: report.failedToCancelled, candidates_moved: report.candidatesMoved, tasks: report.after.tasks}, tags: []});
  });
  return report;
}

// ---------- lookups ----------
export const findTask = (inbox: Inbox | undefined, id: string): Task | null => inbox?.tasks.find(t => t.id === id) ?? null;
export const getTaskRecord = (inbox: Inbox | undefined, id: string, opts?: Parameters<typeof taskRecord>[1]): TaskRecord | null => {
  const t = findTask(inbox, id);
  return t ? taskRecord(t, opts) : null;
};
/** Tasks a Muse takes part in, oldest first; `status` narrows them. */
export function tasksFor(inbox: Inbox | undefined, museId: string, filter: {status?: readonly TaskStatus[]; kind?: TaskKind} = {}): TaskRecord[] {
  return (inbox?.tasks ?? []).filter(t => (t.from === museId || t.to === museId) && (!filter.kind || t.kind === filter.kind))
    .map(t => taskRecord(t)).filter(r => !filter.status || filter.status.includes(r.status));
}
/** Tasks waiting for this Muse's answer (submitted or input-required, and it is its turn). */
export const awaitingAnswerFrom = (inbox: Inbox | undefined, museId: string) =>
  tasksFor(inbox, museId, {status: ['submitted', 'input-required']}).filter(r => r.awaiting === museId);

// ---------- transitions ----------
/** Allowed version 2 transitions. Terminal states never move; a fresh Task is created as submitted, not by a transition. */
export const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  'submitted': ['input-required', 'completed', 'rejected', 'expired', 'cancelled'],
  'input-required': ['input-required', 'completed', 'rejected', 'expired', 'cancelled'],
  'completed': [], 'rejected': [], 'expired': [], 'cancelled': [],
};
export const canTransition = (from: TaskStatus, to: TaskStatus) => TRANSITIONS[from].includes(to);

/** The history actions each target status may be recorded with (the v1 history vocabulary). */
const ACTIONS_FOR: Readonly<Record<TaskStatus, readonly HistoryAction[]>> = {
  'submitted': [], 'input-required': ['counter', 'answer', 'revise'], 'completed': ['accept', 'answer', 'approve'], 'rejected': ['reject', 'answer'],
  'expired': ['expire'], 'cancelled': ['cancel'],
};

export type TransitionStep = {
  by: string; at: number; action: HistoryAction;
  /** input-required: whose answer is next (required). */
  awaiting?: string;
  /** input-required: the new deadline (required). */
  deadline?: number;
  via?: 'live' | 'rule';
};
export type TransitionResult = {ok: true; from: TaskStatus; record: TaskRecord} | {ok: false; from: TaskStatus; reason: 'terminal' | 'not_allowed' | 'wrong_action' | 'awaiting_required' | 'not_a_participant'};

/**
 * Moves an inbox Task to a version 2 status, in place, if the move is allowed: sets the v1 status, whose turn it is,
 * the deadline and updatedAt, and appends one history entry. Call it inside a world commit (WorldRuntime) so the change
 * is stored with its events. It checks the state machine only; trade rules, signatures and approvals stay with the
 * callers. A refused move changes nothing.
 */
export function transitionTask(t: Task, to: TaskStatus, step: TransitionStep): TransitionResult {
  const from = statusOf(t);
  if (TERMINAL_STATUSES.includes(from)) return {ok: false, from, reason: 'terminal'};
  if (!canTransition(from, to)) return {ok: false, from, reason: 'not_allowed'};
  if (!ACTIONS_FOR[to].includes(step.action)) return {ok: false, from, reason: 'wrong_action'};
  if (step.by !== 'musely' && step.by !== t.from && step.by !== t.to) return {ok: false, from, reason: 'not_a_participant'};
  if (to === 'input-required' && (!step.awaiting || step.deadline === undefined || (step.awaiting !== t.from && step.awaiting !== t.to))) return {ok: false, from, reason: 'awaiting_required'};
  t.status = v1Status(to);
  t.awaiting = to === 'input-required' ? step.awaiting! : null;
  if (to === 'input-required') t.deadline = step.deadline!;
  t.updatedAt = step.at;
  t.history.push({by: step.by, action: step.action, at: step.at, ...(step.via ? {via: step.via} : {})});
  return {ok: true, from, record: taskRecord(t)};
}

// ---------- meetup candidates (public information only) ----------
export const MAX_CANDIDATES = 5;
/** C06: the owner approval window is the Task deadline (30 minutes), shown on screen. */
export const OWNER_APPROVAL_TTL_MS = TASK_TTL_MS;
/** The approver id of a resident's rule approval. */
export const RULE_APPROVER = 'musely:rule';
const COMMONS = ['commons:cafe', 'commons:campfire', 'commons:garden', 'commons:benches', 'commons:bookshelf', 'commons:workbench', 'commons:hq'];
const museName = (id: string) => harnessById(id).name;
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * Up to five candidates for two Muses from public information only: both harnesses' liked place kinds (places both
 * like first, then places either likes) and the next half-hour slots at least an hour away in the commons' local time.
 * `shift` moves the slots on by that many half hours (a revision never repeats the list it replaces). Nothing private
 * (an owner's schedule, constraints or reasons) is an input.
 */
export function meetupCandidates(a: string, b: string, at: number, shift = 0): MeetupCandidate[] {
  const likesA = harnessById(a).persona.likes as readonly string[], likesB = harnessById(b).persona.likes as readonly string[];
  const places = COMMONS.map(placeById);
  const both = places.filter(p => likesA.includes(p.kind) && likesB.includes(p.kind));
  const either = places.filter(p => !both.includes(p) && (likesA.includes(p.kind) || likesB.includes(p.kind)));
  const ranked = [...both, ...either];
  if (!ranked.length) ranked.push(placeById('commons:campfire'));
  const basis = (p: (typeof places)[number]) => both.includes(p) ? `both like ${p.kind} spots` : likesB.includes(p.kind) ? `${museName(b)} likes ${p.kind} spots` : likesA.includes(p.kind) ? `${museName(a)} likes ${p.kind} spots` : 'an open spot in the commons';
  const c = localClock(at + 60 * 60_000), first = Math.ceil((c.hour * 60 + c.minute) / 30) * 30;
  return Array.from({length: MAX_CANDIDATES}, (_, i) => {
    const p = ranked[i % ranked.length];
    return {id: `c${i + 1}`, time: hhmm((first + 30 * (shift + i)) % (24 * 60)), place: p.name, place_id: p.id, public_basis: basis(p)};
  });
}

/**
 * Replaces an open meetup's candidates (the opener asked again): a new revision and contentHash, the Muses' answers and
 * every owner approval cleared (they were made on the old list), back to the negotiation with a fresh deadline.
 */
export function reviseMeetup(t: Task, candidates: MeetupCandidate[], at: number): {from: number; to: number; invalidated: number} {
  syncTask(t);
  const from = t.revision!, invalidated = Object.keys(t.approvals ?? {}).length;
  t.candidates = candidates.slice(0, MAX_CANDIDATES); t.answers = {}; t.stage = 'negotiate'; delete t.owners; t.approvals = {};
  t.awaiting = t.to; t.deadline = at + TASK_TTL_MS; t.updatedAt = at;
  t.history.push({by: t.from, action: 'revise', at});
  syncTask(t);
  // A revision is always a new revision, even if the list came out the same.
  if (t.revision === from) t.revision = from + 1;
  return {from, to: t.revision!, invalidated};
}

/** Who decides for a Muse: its owner's id (a principal that can sign in on this deployment), or null for a resident. */
export type OwnerOf = (museId: string) => string | null;
/** The default: every Muse a principal is defined for (worker/index.ts passes the deployment's configured ones). */
export const definedOwnerOf: OwnerOf = museId => Object.values(PRINCIPALS).find(p => p.muses.includes(museId))?.ownerId ?? null;

/**
 * Both Muses accepted: the meetup waits for the owners (stage owner_approval, a new 30-minute deadline). A resident's side
 * is approved by rule at once, bound to this revision and hash (it accepted the whole list, so any candidate). Each owned
 * side gets the meetup_candidate notification (one of the three owner notifications).
 */
export function startOwnerApproval(inbox: Inbox, t: Task, at: number, ownerOf: OwnerOf, emit: Emit) {
  syncTask(t);
  t.stage = 'owner_approval'; t.awaiting = null; t.deadline = at + OWNER_APPROVAL_TTL_MS; t.updatedAt = at;
  t.owners = {[t.from]: ownerOf(t.from), [t.to]: ownerOf(t.to)};
  t.approvals = {};
  for (const m of [t.from, t.to]) {
    const other = m === t.from ? t.to : t.from;
    if (t.owners[m] === null) {
      t.approvals[m] = {ref: nextId(inbox, 'ap'), by: RULE_APPROVER, revision: t.revision!, contentHash: t.contentHash!, at, decision: 'approve', candidate: null, source: 'rule'};
      emit({at, source: 'rule', kind: 'owner_decision', muse: m, other, line: `${museName(m)} has no owner here: approved by rule`, data: {task_id: t.id, decision: 'approve', revision: t.revision, approval_ref: t.approvals[m].ref, actor: 'rule', candidate: 'private (owner only)'}, tags: []});
    } else {
      notifyOwner(inbox, {kind: 'meetup_candidate', at, line: `A meetup candidate with ${museName(other)} needs your approval`, ref: t.id, other, muse: m, detail: {candidates: candidatesOf(t).map(c => ({...c})), revision: t.revision, content_hash: t.contentHash, deadline: t.deadline}});
    }
  }
}

// ---------- owner decisions (POST /api/owner/approvals) ----------
export type DecisionInput = {taskId: string; muse: string; ownerId: string; revision: number; contentHash: string; decision: 'approve' | 'reject'; candidate: string | null};
export type DecisionOutcome =
  | {ok: true; duplicate: boolean; confirmed: boolean; changed: boolean; task: OwnerTaskView}
  | {ok: false; status: 404 | 409; code: string; retryable: boolean; changed: boolean; extra?: Record<string, unknown>};

export type OwnerTaskView = ReturnType<typeof ownerTaskView>;
/** A Task as its owner sees it in the owner inbox: candidates, revision and hash to approve, each side's decision. */
export function ownerTaskView(t: Task, muse: string) {
  const other = t.from === muse ? t.to : t.from, r = taskRecord(t), mine = r.approvals[muse], theirs = r.approvals[other];
  const side = (a: TaskApproval | undefined) => (a ? {decision: a.decision, candidate: a.candidate, source: a.source, at: a.at, approval_ref: a.ref} : null);
  return {
    task_id: t.id, kind: t.kind, muse, other, other_side: t.owners ? (t.owners[other] === null ? 'resident (approves by rule)' : 'owner') : null,
    status: r.status, stage: t.stage ?? 'negotiate', revision: r.revision, content_hash: r.contentHash,
    deadline: t.deadline, deadline_iso: new Date(t.deadline).toISOString(),
    candidates: candidatesOf(t).map(c => ({...c})), yours: side(mine), theirs: side(theirs), confirmed: t.confirmed ? {...t.confirmed} : null,
  };
}

const refuse = (status: 404 | 409, code: string, extra?: Record<string, unknown>, opts: {retryable?: boolean; changed?: boolean} = {}): DecisionOutcome => ({ok: false, status, code, retryable: !!opts.retryable, changed: !!opts.changed, ...(extra ? {extra} : {})});
const sameDecision = (a: TaskApproval | undefined, i: DecisionInput) => !!a && a.revision === i.revision && a.contentHash === i.contentHash && a.decision === i.decision && (i.candidate === null || a.candidate === i.candidate);

/**
 * One owner's decision on a meetup, applied in place on the world state (call it inside one world commit). In order:
 * the Task is the owner's Muse's and needs owner approval; an overdue Task expires now; it must still be open and waiting
 * for the owners; the revision and contentHash must be the current ones; then reject closes it, and approve records the
 * approval and, when both sides approved the same revision, hash and candidate, completes it and issues a Meetup Ember to
 * both (grantItem through the item history chain). A tampered item history refuses before anything is recorded.
 * Repeating a decision already made returns it again (duplicate) and issues nothing more.
 */
export function decideApproval(st: WorldState, i: DecisionInput, at: number, emit: Emit): DecisionOutcome {
  const inbox = (st.inbox ??= emptyInbox());
  const t = inbox.tasks.find(x => x.id === i.taskId);
  if (!t || (t.from !== i.muse && t.to !== i.muse)) return refuse(404, 'unknown_task');
  if (!kindSpec(t.kind).ownerApproval) return refuse(409, 'approval_not_required');
  syncTask(t);
  const other = t.from === i.muse ? t.to : t.from;
  if (t.status === 'pending' && t.deadline <= at) {
    t.status = 'expired'; t.awaiting = null; t.updatedAt = at; t.history.push({by: 'musely', action: 'expire', at});
    emit({at, source: 'rule', kind: 'task_expired', muse: i.muse, other, data: {task_id: t.id, task: t.kind, via: 'owner_approval'}, tags: []});
    return refuse(409, 'task_expired', undefined, {changed: true});
  }
  // A retry of a decision this owner already made returns the same answer: while the Task waits, or after this very
  // decision closed it (a confirmation, or this owner's decline). After an expiry or a revocation it is refused below.
  const closedByIt = (t.status === 'completed' && !!t.confirmed) || (t.status === 'rejected' && i.decision === 'reject');
  if (sameDecision(t.approvals?.[i.muse], i) && (t.status === 'pending' || closedByIt)) return {ok: true, duplicate: true, confirmed: !!t.confirmed, changed: false, task: ownerTaskView(t, i.muse)};
  if (t.status !== 'pending') return refuse(409, 'task_' + t.status);
  // The exact content first: a decision made on an older revision (the candidates changed) never applies.
  if (i.revision !== t.revision || i.contentHash !== t.contentHash) return refuse(409, 'stale_approval', {revision: t.revision, content_hash: t.contentHash}, {retryable: true});
  if (t.stage !== 'owner_approval') return refuse(409, 'not_ready_for_approval', {stage: t.stage ?? 'negotiate'});
  if (t.approvals?.[i.muse]) return refuse(409, 'already_decided');
  const approval = (candidate: string | null): TaskApproval => ({ref: nextId(inbox, 'ap'), by: i.ownerId, revision: t.revision!, contentHash: t.contentHash!, at, decision: i.decision, candidate, source: 'owner'});
  const decided = (a: TaskApproval) => emit({at, source: 'live', kind: 'owner_decision', muse: i.muse, other, line: a.decision === 'approve' ? `${museName(i.muse)}'s owner approved a meetup with ${museName(other)}` : `${museName(i.muse)}'s owner declined a meetup with ${museName(other)}`, data: {task_id: t.id, decision: a.decision, revision: a.revision, approval_ref: a.ref, actor: 'owner', candidate: 'private (owner only)'}, tags: []});

  if (i.decision === 'reject') {
    const a = approval(null);
    (t.approvals ??= {})[i.muse] = a;
    t.status = 'rejected'; t.awaiting = null; t.updatedAt = at; t.history.push({by: i.muse, action: 'reject', at});
    decided(a);
    return {ok: true, duplicate: false, confirmed: false, changed: true, task: ownerTaskView(t, i.muse)};
  }

  const cands = candidatesOf(t), theirs = t.approvals?.[other];
  const chosen = theirs?.decision === 'approve' ? theirs.candidate : null;
  const candidate = i.candidate ?? chosen ?? (cands.length === 1 ? cands[0].id : null);
  if (!candidate) return refuse(409, 'candidate_required', {candidates: cands.map(c => c.id)});
  if (!cands.some(c => c.id === candidate)) return refuse(409, 'unknown_candidate', {candidates: cands.map(c => c.id)});
  if (chosen && chosen !== candidate) return refuse(409, 'candidate_mismatch', {chosen});
  const both = theirs?.decision === 'approve' && theirs.revision === t.revision && theirs.contentHash === t.contentHash;
  if (both && historyFault(st.items, false, at)) return refuse(409, 'history_tamper');
  const a = approval(candidate);
  (t.approvals ??= {})[i.muse] = a;
  t.updatedAt = at;
  decided(a);
  if (!both) return {ok: true, duplicate: false, confirmed: false, changed: true, task: ownerTaskView(t, i.muse)};

  // Both sides approved this revision, hash and candidate: completed, and one Meetup Ember each (item history chain).
  const place = cands.find(c => c.id === candidate)?.place_id ?? null;
  for (const m of [t.from, t.to]) grantItem(st.items, st.muses.find(x => x.id === m)!, 'meetup_ember', at, place, 'meetup');
  t.confirmed = {candidate, at}; t.status = 'completed'; t.awaiting = null; t.history.push({by: 'musely', action: 'approve', at});
  emit({at, source: 'live', kind: 'meetup_confirmed', muse: t.from, other: t.to, line: `${museName(t.from)} and ${museName(t.to)} agreed to meet (both sides approved)`, data: {task_id: t.id, revision: t.revision, approval_refs: [t.approvals[t.from].ref, t.approvals[t.to].ref], approvals: {[t.from]: t.approvals[t.from].source, [t.to]: t.approvals[t.to].source}, candidate: 'private (owner only)', granted: 'meetup_ember', stage: 'confirm'}, tags: ['meetup_confirmed']});
  return {ok: true, duplicate: false, confirmed: true, changed: true, task: ownerTaskView(t, i.muse)};
}

// ---------- the owner inbox (GET /api/owner/inbox) ----------
export const OWNER_NOTIFICATION_KINDS = ['meetup_candidate', 'trade_completed', 'blocked'] as const;
/**
 * What an owner sees, apart from the agent inbox (heartbeat_check): the meetups waiting for this owner's decision, the
 * last few it decided, and the three kinds of owner notification, all only for the owner's own Muses. No agent
 * messages, mail or answer-waiting Tasks are in it.
 */
export function ownerInbox(st: WorldState, muses: readonly string[], now: number) {
  const inbox = st.inbox ?? emptyInbox();
  const mine = (t: Task) => muses.find(m => m === t.from || m === t.to);
  const meetups = inbox.tasks.filter(t => kindSpec(t.kind).ownerApproval && t.stage === 'owner_approval' && mine(t));
  return {
    muses: [...muses],
    approvals: meetups.filter(t => t.status === 'pending' && t.deadline > now).map(t => ownerTaskView(t, mine(t)!)),
    recent: meetups.filter(t => t.status !== 'pending' || t.deadline <= now).slice(-5).reverse().map(t => ownerTaskView(t, mine(t)!)),
    notification_kinds: [...OWNER_NOTIFICATION_KINDS],
    notifications: [...inbox.notifications].reverse().filter(n => muses.includes(notificationMuse(n)) && (OWNER_NOTIFICATION_KINDS as readonly string[]).includes(n.kind)).map(n => ({...n, muse: notificationMuse(n)})),
    approval_window_min: OWNER_APPROVAL_TTL_MS / 60_000, now,
  };
}
