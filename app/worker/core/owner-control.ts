// Owner revocation and re-delegation (direction v2, 7 "철회"; contracts C04, C06; I-02). These are owner actions only
// (the Worker route requires an owner session for the Muse). Nothing in the product re-delegates on its own.
//   revoke:     the delegation version moves up and every issued delegation is revoked (Trust.revoke); then, in one
//               world commit, every pending Task of the Muse is closed as cancelled and the Muse is paused (no
//               spotlight turn, beat, trip or meeting; a trip in progress stops), with the events that say so.
//   redelegate: the owner's explicit, separate action. New executors may be issued again and the Muse resumes.
import type {Trust} from './trust.ts';
import type {WorldRuntime} from './world-runtime.ts';
import {pauseMuse, resumeMuse} from '../../src/engine/world.ts';
import {cancelTasksFor, emptyInbox} from '../../src/engine/inbox.ts';

export type ControlCtx = {trust: Trust; runtime: WorldRuntime; now?: () => number};
const nowOf = (c: ControlCtx) => (c.now ? c.now() : Date.now());
const uniq = () => Math.random().toString(36).slice(2, 8);

export type RevokeResult = {ok: true; muse: string; already: boolean; version: number; cancelledTasks: string[]; stopped: {trip: string | null; beat: string | null; intent: string | null} | null} | {ok: false; reason: 'unknown_muse'};
export type RedelegateResult = {ok: true; muse: string; already: boolean; version: number} | {ok: false; reason: 'unknown_muse'};

const revoking = new WeakMap<Trust, Set<string>>();

export async function revokeMuse(c: ControlCtx, museId: string, by: string): Promise<RevokeResult> {
  const agent = c.trust.agentByMuse(museId);
  if (!agent) return {ok: false, reason: 'unknown_muse'};
  // Already revoked and not delegated again: nothing moves (a second revoke does not bump the version again).
  // A concurrent second revoke of the same Muse (both before the first finished) is the same as "already revoked".
  const busy = revoking.get(c.trust) ?? new Set<string>();
  revoking.set(c.trust, busy);
  if (c.trust.suspended(museId) || busy.has(museId)) return {ok: true, muse: museId, already: true, version: c.trust.delegationVersion(agent.agentId), cancelledTasks: [], stopped: null};
  busy.add(museId);
  let version: number;
  try { version = await c.trust.revoke(museId); } finally { busy.delete(museId); }
  // Synchronous from here: the revocation and its world effects are committed together, before any other request runs.
  const now = nowOf(c);
  const out: {cancelled: string[]; stopped: ReturnType<typeof pauseMuse>} = {cancelled: [], stopped: null};
  c.runtime.commitExternal(now, `owner-revoke-${museId}-${uniq()}`, (st, emit) => {
    emit({at: now, source: 'live', kind: 'delegation_revoked', muse: museId, line: 'Owner revoked the delegation', data: {newVersion: version, by}, tags: ['revocation']});
    for (const t of cancelTasksFor((st.inbox ??= emptyInbox()), museId, now, by)) {
      out.cancelled.push(t.id);
      emit({at: now, source: 'rule', kind: 'task_cancelled', muse: museId, other: t.from === museId ? t.to : t.from, line: 'A pending Task was cancelled: the owner revoked the delegation', data: {task_id: t.id, task: t.kind, reason: 'delegation_revoked'}, tags: []});
    }
    out.stopped = pauseMuse(st, museId, {at: now, version, by});
    emit({at: now, source: 'rule', kind: 'muse_paused', muse: museId, line: 'Paused until the owner delegates again', data: {reason: 'delegation_revoked', stopped: out.stopped}, tags: []});
  });
  return {ok: true, muse: museId, already: false, version, cancelledTasks: out.cancelled, stopped: out.stopped};
}

export function redelegateMuse(c: ControlCtx, museId: string, by: string): RedelegateResult {
  const agent = c.trust.agentByMuse(museId);
  if (!agent) return {ok: false, reason: 'unknown_muse'};
  if (!c.trust.suspended(museId)) return {ok: true, muse: museId, already: true, version: c.trust.delegationVersion(agent.agentId)};
  const version = c.trust.redelegate(museId);
  const now = nowOf(c);
  c.runtime.commitExternal(now, `owner-redelegate-${museId}-${uniq()}`, (st, emit) => {
    resumeMuse(st, museId);
    emit({at: now, source: 'live', kind: 'delegation_issued', muse: museId, line: 'Owner delegated again', data: {version, by}, tags: []});
  });
  return {ok: true, muse: museId, already: false, version};
}

/**
 * Keeps the world's paused set equal to the trust registry (at start-up): a Muse revoked in the registry is paused,
 * and a Muse whose delegation is current is not. Normally both change together in revokeMuse / redelegateMuse.
 */
export function reconcilePaused(c: ControlCtx) {
  const s = c.runtime.state(), now = nowOf(c);
  const pause = s.muses.filter(m => c.trust.suspended(m.id) && !s.paused?.[m.id]).map(m => m.id);
  const resume = s.muses.filter(m => !c.trust.suspended(m.id) && s.paused?.[m.id]).map(m => m.id);
  if (!pause.length && !resume.length) return {pause, resume};
  c.runtime.commitExternal(now, 'reconcile-paused', (st, emit) => {
    for (const id of pause) {
      const version = c.trust.delegationVersion(c.trust.agentByMuse(id)!.agentId);
      for (const t of cancelTasksFor((st.inbox ??= emptyInbox()), id, now, 'musely')) emit({at: now, source: 'rule', kind: 'task_cancelled', muse: id, other: t.from === id ? t.to : t.from, data: {task_id: t.id, task: t.kind, reason: 'delegation_revoked'}, tags: []});
      emit({at: now, source: 'rule', kind: 'muse_paused', muse: id, line: 'Paused until the owner delegates again', data: {reason: 'delegation_revoked', stopped: pauseMuse(st, id, {at: now, version, by: 'musely'})}, tags: []});
    }
    for (const id of resume) resumeMuse(st, id);
  });
  return {pause, resume};
}

/** Delegation state of the given Muses, for the owner's own screen. */
export function delegationStatus(c: ControlCtx, muses: string[]) {
  const s = c.runtime.state();
  return muses.map(id => {
    const agent = c.trust.agentByMuse(id);
    return {muse: id, status: agent && c.trust.suspended(id) ? 'revoked' as const : 'active' as const, version: agent ? c.trust.delegationVersion(agent.agentId) : null, paused: s.paused?.[id] ?? null, pendingTasks: (s.inbox?.tasks ?? []).filter(t => t.status === 'pending' && (t.from === id || t.to === id)).length};
  });
}
