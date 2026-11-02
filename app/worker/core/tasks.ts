// Shared workflow Tasks (C06): a version 2 view over the agent inbox Tasks in src/engine/inbox.ts.
// I-03A owns this facade; I-07 (trade and meetup approval) and I-13 (help, campfire) build on it. It changes no
// existing behavior: the MCP tools and the engine still read and write inbox Tasks directly, and nothing here is
// stored. A TaskRecord is computed from a Task each time it is asked for.
//
// Status names (C06, A2A Task states) and the v1 Task status they come from:
//   submitted       pending, nobody has answered yet (only the opening `propose` in the history)
//   input-required  pending after at least one answer or counter: the side in `awaiting` must answer next
//   completed       completed
//   rejected        rejected
//   expired         expired
//   cancelled       cancelled, and failed (C06 maps failed to cancelled; no current path writes failed)
// The v1 `help` kind does not exist yet (I-13); TaskKind lists it so the record type is the one I-13 fills.
import {canonicalize} from '../../src/identity/jcs.ts';
import {sha256Hex} from '../../src/engine/sha256.ts';
import type {Inbox, Task} from '../../src/engine/inbox.ts';
import type {WorldEvent} from '../../src/engine/world.ts';

export const TASK_RECORD_VERSION = 2;
export const TASK_KINDS = ['trade', 'meetup', 'help'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_STATUSES = ['submitted', 'input-required', 'completed', 'rejected', 'expired', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TERMINAL_STATUSES: readonly TaskStatus[] = ['completed', 'rejected', 'expired', 'cancelled'];
type V1Status = Task['status'];
type HistoryAction = Task['history'][number]['action'];

export type TaskRecord = {
  version: typeof TASK_RECORD_VERSION;
  id: string;
  kind: TaskKind;
  /** [opener, other side]: the v1 `from` and `to`. */
  participants: [string, string];
  status: TaskStatus;
  /** Who must answer next (input-required and submitted), else null. */
  awaiting: string | null;
  /** Steps taken so far (the length of the v1 history): it grows with every proposal, counter, answer, expiry and cancel. */
  revision: number;
  /** Hex SHA-256 of the JCS form of what an approval binds to: kind, participants and the current offer or candidate. */
  contentHash: string;
  /** The v1 deadline (ms since epoch). */
  expiresAt: number;
  payload: TaskPayload;
  /** Owner approvals bound to this revision and contentHash. v1 Tasks keep none; I-07 adds them. */
  approvalRefs: string[];
  /** Ids of world events about this Task, when the caller passes the events (taskRecord's `events`). */
  eventIds: string[];
  createdAt: number;
  updatedAt: number;
};
export type TaskPayload =
  | {kind: 'trade'; offer: {by: string; give: string; want: string} | null; counters: number}
  | {kind: 'meetup'; candidate: {time: string; place: string; public_basis: string} | null; answers: Record<string, 'accept' | 'reject'>}
  | {kind: 'help'};

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

const payloadOf = (t: Task): TaskPayload => t.kind === 'trade'
  ? {kind: 'trade', offer: t.offer ? {...t.offer} : null, counters: t.round}
  : {kind: 'meetup', candidate: t.candidate ? {...t.candidate} : null, answers: {...(t.answers ?? {})}};

/** What an approval binds to (C04): the proposal's content and parties. Answers, times and deadlines are not part of it. */
export const contentOf = (t: Task) => ({kind: t.kind, participants: [t.from, t.to], ...(t.kind === 'trade' ? {offer: t.offer ?? null} : {candidate: t.candidate ?? null})});
export const taskContentHash = (t: Task) => sha256Hex(canonicalize(contentOf(t)));

/** A version 2 record of an inbox Task. Pass `events` (any slice of the world log) to fill eventIds. */
export function taskRecord(t: Task, opts: {events?: readonly Pick<WorldEvent, 'id' | 'data'>[]} = {}): TaskRecord {
  const status = statusOf(t);
  return {
    version: TASK_RECORD_VERSION, id: t.id, kind: t.kind, participants: [t.from, t.to], status,
    awaiting: TERMINAL_STATUSES.includes(status) ? null : t.awaiting,
    revision: t.history.length, contentHash: taskContentHash(t), expiresAt: t.deadline,
    payload: payloadOf(t), approvalRefs: [],
    eventIds: (opts.events ?? []).filter(e => (e.data as {task_id?: unknown} | undefined)?.task_id === t.id).map(e => e.id),
    createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
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
  'submitted': [], 'input-required': ['counter', 'answer'], 'completed': ['accept', 'answer'], 'rejected': ['reject', 'answer'],
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
 * callers (commands.ts, I-07, I-13). A refused move changes nothing.
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
