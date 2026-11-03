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

export type RevokeResult = {ok: true; muse: string; already: boolean; repaired: boolean; version: number; cancelledTasks: string[]; stopped: {trip: string | null; beat: string | null; intent: string | null} | null} | {ok: false; reason: 'unknown_muse'};
export type RedelegateResult = {ok: true; muse: string; already: boolean; repaired: boolean; version: number} | {ok: false; reason: 'unknown_muse'};
type Emit = Parameters<Parameters<WorldRuntime['commitExternal']>[2]>[1];
type State = ReturnType<WorldRuntime['state']>;

const revoking = new WeakMap<Trust, Set<string>>();
const hasPending = (s: State, museId: string) => (s.inbox?.tasks ?? []).some(t => t.status === 'pending' && (t.from === museId || t.to === museId));
const hasOpenInvite = (s: State, museId: string) => (s.inbox?.invites ?? []).some(i => i.status === 'open' && (i.from === museId || (i.to.includes(museId) && i.answers[museId]?.answer !== 'unavailable')));
/** Does the world still show a revoked Muse as active (not paused, or with pending Tasks)? */
const needsStop = (s: State, museId: string) => !s.paused?.[museId] || hasPending(s, museId) || hasOpenInvite(s, museId);

/**
 * The world side of a revocation, idempotent: every pending Task of the Muse closes as cancelled, and the Muse is paused
 * once (a Muse already paused keeps its pause record and place). Runs inside one world commit.
 */
/**
 * Events of the owner's own act (revoke, re-delegate and what they stop or resume). C03 has no actorOrigin for an owner
 * (system / connected / trial are a resident, a person's Muse, a visitor), so these keep `data.actor: 'owner'` and no
 * actorOrigin; the run log does not fill one in.
 */
const byOwner = (emit: Emit): Emit => e => emit({...e, data: {...(e.data ?? {}), actor: 'owner'}});

export function stopInWorld(st: State, emit: Emit, museId: string, version: number, by: string, now: number, repaired: boolean) {
  const cancelled: string[] = [];
  for (const t of cancelTasksFor((st.inbox ??= emptyInbox()), museId, now, by)) {
    cancelled.push(t.id);
    emit({at: now, source: 'rule', kind: 'task_cancelled', muse: museId, other: t.from === museId ? t.to : t.from, line: 'A pending Task was cancelled: the owner revoked the delegation', data: {task_id: t.id, task: t.kind, reason: 'delegation_revoked'}, tags: []});
  }
  // Cancel in this same commit: a re-delegation before the next tick must not revive old consent.
  for (const inv of st.inbox?.invites ?? []) {
    if (inv.status !== 'open') continue;
    if (inv.from === museId) {
      inv.status = 'cancelled'; inv.closedAt = now;
      emit({at: now, source: 'rule', kind: 'campfire_invite_cancelled', muse: museId, place: inv.place, line: 'A campfire invite was cancelled: the owner revoked the delegation', data: {invite_id: inv.id, reason: 'delegation_revoked'}, tags: []});
    } else if (inv.to.includes(museId) && inv.answers[museId]?.answer !== 'unavailable') {
      inv.answers[museId] = {answer: 'unavailable', via: null, at: now};
      emit({at: now, source: 'rule', kind: 'campfire_invite_answer', muse: museId, other: inv.from, place: inv.place, line: null, data: {invite_id: inv.id, answer: 'unavailable', reason: 'delegation_revoked'}, tags: []});
    }
  }
  let stopped: ReturnType<typeof pauseMuse> = null;
  if (!st.paused?.[museId]) {
    stopped = pauseMuse(st, museId, {at: now, version, by});
    emit({at: now, source: 'rule', kind: 'muse_paused', muse: museId, line: 'Paused until the owner delegates again', data: {reason: 'delegation_revoked', stopped, repaired}, tags: []});
  }
  return {cancelled, stopped};
}

export async function revokeMuse(c: ControlCtx, museId: string, by: string): Promise<RevokeResult> {
  const agent = c.trust.agentByMuse(museId);
  if (!agent) return {ok: false, reason: 'unknown_muse'};
  // A concurrent second revoke of the same Muse (both before the first finished) is the same as "already revoked".
  const busy = revoking.get(c.trust) ?? new Set<string>();
  revoking.set(c.trust, busy);
  if (busy.has(museId)) return {ok: true, muse: museId, already: true, repaired: false, version: c.trust.delegationVersion(agent.agentId), cancelledTasks: [], stopped: null};
  if (c.trust.suspended(museId)) {
    // Already revoked in the registry: the version does not move again. If an earlier attempt failed after the registry
    // write (the world commit threw), the world is stopped now; when it already is, nothing changes.
    const version = c.trust.delegationVersion(agent.agentId);
    if (!needsStop(c.runtime.state(), museId)) return {ok: true, muse: museId, already: true, repaired: false, version, cancelledTasks: [], stopped: null};
    const now = nowOf(c);
    let out = {cancelled: [] as string[], stopped: null as ReturnType<typeof pauseMuse>};
    c.runtime.commitExternal(now, `owner-revoke-repair-${museId}-${uniq()}`, (st, emit) => { out = stopInWorld(st, byOwner(emit), museId, version, by, now, true); });
    return {ok: true, muse: museId, already: true, repaired: true, version, cancelledTasks: out.cancelled, stopped: out.stopped};
  }
  busy.add(museId);
  let version: number;
  try { version = await c.trust.revoke(museId); } finally { busy.delete(museId); }
  // Synchronous from here: the revocation and its world effects are committed together, before any other request runs.
  const now = nowOf(c);
  let out = {cancelled: [] as string[], stopped: null as ReturnType<typeof pauseMuse>};
  c.runtime.commitExternal(now, `owner-revoke-${museId}-${uniq()}`, (st, put) => {
    const emit = byOwner(put);
    emit({at: now, source: 'live', kind: 'delegation_revoked', muse: museId, line: 'Owner revoked the delegation', data: {newVersion: version, by}, tags: ['revocation']});
    out = stopInWorld(st, emit, museId, version, by, now, false);
  });
  return {ok: true, muse: museId, already: false, repaired: false, version, cancelledTasks: out.cancelled, stopped: out.stopped};
}

export function redelegateMuse(c: ControlCtx, museId: string, by: string): RedelegateResult {
  const agent = c.trust.agentByMuse(museId);
  if (!agent) return {ok: false, reason: 'unknown_muse'};
  if (!c.trust.suspended(museId)) {
    // Delegated in the registry already. If an earlier attempt failed before the world resumed the Muse, resume it now.
    const version = c.trust.delegationVersion(agent.agentId);
    if (!c.runtime.state().paused?.[museId]) return {ok: true, muse: museId, already: true, repaired: false, version};
    const now = nowOf(c);
    c.runtime.commitExternal(now, `owner-redelegate-repair-${museId}-${uniq()}`, (st, put) => {
      const emit = byOwner(put);
      resumeMuse(st, museId);
      emit({at: now, source: 'live', kind: 'muse_resumed', muse: museId, line: 'Resumed: the owner\'s re-delegation is now applied to the world', data: {reason: 'redelegation_completed', version, by}, tags: []});
    });
    return {ok: true, muse: museId, already: true, repaired: true, version};
  }
  const version = c.trust.redelegate(museId);
  const now = nowOf(c);
  c.runtime.commitExternal(now, `owner-redelegate-${museId}-${uniq()}`, (st, put) => {
    const emit = byOwner(put);
    resumeMuse(st, museId);
    emit({at: now, source: 'live', kind: 'delegation_issued', muse: museId, line: 'Owner delegated again', data: {version, by}, tags: []});
  });
  return {ok: true, muse: museId, already: false, repaired: false, version};
}

/**
 * Keeps the world equal to the trust registry (at start-up). A Muse revoked in the registry is paused with its pending
 * Tasks cancelled; a Muse whose delegation is current is not paused. Normally both change together in revokeMuse /
 * redelegateMuse, so neither branch runs; when one does, it leaves an event saying so.
 */
export function reconcilePaused(c: ControlCtx) {
  const s = c.runtime.state(), now = nowOf(c);
  const pause = s.muses.filter(m => c.trust.suspended(m.id) && needsStop(s, m.id)).map(m => m.id);
  const resume = s.muses.filter(m => !c.trust.suspended(m.id) && s.paused?.[m.id]).map(m => m.id);
  if (!pause.length && !resume.length) return {pause, resume};
  c.runtime.commitExternal(now, 'reconcile-paused', (st, emit) => {
    for (const id of pause) stopInWorld(st, emit, id, c.trust.delegationVersion(c.trust.agentByMuse(id)!.agentId), 'musely', now, true);
    for (const id of resume) {
      resumeMuse(st, id);
      emit({at: now, source: 'rule', kind: 'muse_resumed', muse: id, line: 'Resumed: the registry shows a current delegation', data: {reason: 'registry_not_revoked'}, tags: []});
    }
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
