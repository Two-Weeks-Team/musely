// Shared-state write commands (C03, C04). Every agent write (MCP tools, the owner's Muse trade) runs here:
//   1. wrapper ↔ signed fields: commandId = message_id, actorId = agent_id, action, worldId, and the signed
//      content is exactly {worldId, expectedVersion, action, payload}
//   2. the envelope signature, then revocation (a revoked actor reaches no stored result), so only the proven,
//      current actor can read its results
//   3. stored result for (actor, commandId): same payload → that result again, nothing re-applied;
//      a different payload → command_conflict; the same id still in flight → in_progress (retryable)
//   4. recipient, delegation, scope, expiry, content, approval and an unused nonce (verifyEnvelope with
//      claim: false), then the counterparty's card and delegation when the action has one
//   5. expectedVersion against the current world → stale_world (null: the caller did not plan against a
//      version, so none is checked here or at the commit)
//   6. optional work outside the transaction (a model call); its settle() always runs
//   7. one storage transaction: the stored row again, the world version and both delegations (a late answer is
//      discarded), the nonce claim, then apply, version, events and the result row.
// A refusal changes no inventory, place, Task or reward and spends no nonce, so the same id can be retried
// once the cause is gone. It leaves one refusal event per (actor, code, step) and window; repeats are counted.
import {canonicalize} from '../../src/identity/jcs.ts';
import {signEnvelope, verifySignature, verifyEnvelope, contentHash, type Signed} from '../../src/identity/envelope.ts';
import type {ScopeId} from '../../src/engine/harness.ts';
import type {WorldState, WorldEvent} from '../../src/engine/world.ts';
import type {WorldRuntime, CommandRow} from './world-runtime.ts';
import type {Trust, Executor} from './trust.ts';

export const COMMANDS_TABLE = 'CREATE TABLE IF NOT EXISTS commands (actor_id TEXT NOT NULL, command_id TEXT NOT NULL, payload_hash TEXT NOT NULL, action TEXT NOT NULL, result TEXT NOT NULL, output TEXT, at INTEGER NOT NULL, PRIMARY KEY (actor_id, command_id))';

export type WorldCommand = {commandId: string; worldId: string; expectedVersion: number | null; actorId: string; action: string; payload: Record<string, unknown>; signed: Signed};
export type CommandError = {code: string; retryable: boolean};
export type CommandResult = {ok: boolean; commandId: string; worldVersion: number; eventIds: string[]; error?: CommandError};
export type Refused = CommandError & {step: string};
type Emit = (e: Omit<WorldEvent, 'id' | 'tick'>) => void;
export type Applied = {ok: true; output?: unknown} | {ok: false; code: string; output?: unknown};
/** A counterparty checked before the commit; `current` re-checks its delegation synchronously at the commit point. */
export type PeerCheck = {ok: true; current: (at: number) => boolean} | {ok: false; reason: string};

export type CommandHandler<T = unknown> = {
  /** Who this command must be addressed to, decided by the verifier: the peer agent, or worldHandler(worldId). */
  recipient: string;
  counterparty?: () => Promise<PeerCheck>;
  /**
   * Work outside the transaction, bounded by the deadline. executeCommand calls the returned settle()
   * whatever happens next (C05), so a discarded answer is still paid for. think must settle its own
   * reservation before it throws: a throw (or a missed deadline) returns no settle().
   */
  think?: () => Promise<{thought: T; settle?: () => void}>;
  apply: (st: WorldState, emit: Emit, at: number, thought: T | undefined) => Applied;
  /** Logs a refusal (the default is one command_refused event). Owner notifications may be added here. */
  refused?: (st: WorldState, emit: Emit, r: Refused, at: number) => void;
  /** false: log every refusal (evidence flows such as P0); by default repeats inside the window are only counted. */
  dedup?: boolean;
};
export type CommandOutcome = {result: CommandResult; output: unknown; duplicate: boolean; verified: boolean; refused: Refused | null};
/** deadlineMs bounds think and counterparty (default STEP_DEADLINE_MS). */
export type CommandCtx = {trust: Trust; runtime: WorldRuntime; deadlineMs?: number; now?: () => number; authorize?: () => string | null};
export const STEP_DEADLINE_MS = 15_000;
const within = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('step deadline passed')), ms); })]).finally(() => clearTimeout(timer ?? null));
};

const RETRYABLE = new Set(['stale_world', 'in_progress']);
/** Refusals that are about timing or retries, not about the actor's authority: no owner Blocked notice, no p0_refused tag. */
export const quietRefusal = (code: string) => ['stale_world', 'command_conflict', 'replay', 'in_progress'].includes(code);
const LATE: Record<string, string> = {stale_world: 'world changed while the model was answering', delegation_revoked: 'delegation revoked before commit'};
export const worldHandler = (worldId: string) => `musely:world:${worldId}`;
export const commandContent = (c: Pick<WorldCommand, 'worldId' | 'expectedVersion' | 'action' | 'payload'>) => ({worldId: c.worldId, expectedVersion: c.expectedVersion, action: c.action, payload: c.payload});
/** The command's identity for duplicates: a retry may be re-signed against a newer version, so the version is not part of it. */
export const payloadHash = (c: Pick<WorldCommand, 'worldId' | 'action' | 'payload'>) => contentHash({worldId: c.worldId, action: c.action, payload: c.payload});

/** Signs a command with an executor; the envelope's message id is the command id. */
export async function signCommand(exec: Executor, m: {worldId: string; expectedVersion: number | null; action: string; payload: Record<string, unknown>; recipient: string; scope: ScopeId | string; ownerClaimed: boolean; now: number; commandId?: string; approvalRef?: string | null; taskId?: string | null; ttlMs?: number}): Promise<WorldCommand> {
  const signed = await signEnvelope(exec.key, exec.delegation, exec.d, {recipient: m.recipient, action: m.action, scope: m.scope, content: commandContent(m), ownerClaimed: m.ownerClaimed, now: m.now, messageId: m.commandId, approvalRef: m.approvalRef, taskId: m.taskId, ttlMs: m.ttlMs});
  return {commandId: signed.envelope.message_id, worldId: m.worldId, expectedVersion: m.expectedVersion, actorId: signed.envelope.agent_id, action: m.action, payload: m.payload, signed};
}

const bound = (c: CommandCtx, cmd: WorldCommand) => {
  const e = cmd?.signed?.envelope;
  if (!e || typeof cmd.commandId !== 'string' || !(cmd.expectedVersion === null || Number.isInteger(cmd.expectedVersion))) return false;
  if (cmd.commandId !== e.message_id || cmd.actorId !== e.agent_id || cmd.action !== e.action || cmd.worldId !== c.runtime.worldId) return false;
  try { return canonicalize(cmd.signed.content) === canonicalize(commandContent(cmd)); } catch { return false; }
};

export async function executeCommand<T>(c: CommandCtx, cmd: WorldCommand, h: CommandHandler<T>, now = Date.now()): Promise<CommandOutcome> {
  const id = String(cmd?.commandId ?? '').slice(0, 64);
  let proven = false;
  const refuse = (step: string, code: string, opts: {verified?: boolean; event?: Omit<WorldEvent, 'id' | 'tick'>} = {}): CommandOutcome => {
    const r: Refused = {step, code, retryable: RETRYABLE.has(code)};
    // An unproven actor id is attacker-chosen, so it is not used as a key. The key names the other side too.
    const actor = proven ? cmd.actorId : 'unverified', key = `${actor}>${h.recipient}:${code}:${step}`;
    const events = c.runtime.commitRefusal(now, `cmd-refused-${actor}-${id}-${Math.random().toString(36).slice(2, 8)}`, key, (st, emit) => {
      if (opts.event) emit(opts.event);
      else if (h.refused) h.refused(st, emit, r, now);
      else emit({at: now, source: 'live', kind: 'command_refused', muse: null, data: {step, reason: code, action: cmd?.action ?? null, command_id: id}, tags: []});
    }, h.dedup !== false);
    return {result: {ok: false, commandId: id, worldVersion: c.runtime.state().version, eventIds: events.map(x => x.id), error: {code, retryable: r.retryable}}, output: null, duplicate: false, verified: !!opts.verified, refused: r};
  };
  const stored = (row: CommandRow): CommandOutcome => ({result: row.result, output: row.output, duplicate: true, verified: true, refused: null});
  // 1–2. The wrapper says what was signed, the actor really signed it, and its delegation is current.
  if (!bound(c, cmd)) return refuse('binding', 'bad_command');
  const sig = await verifySignature(cmd.signed, c.trust);
  if (!sig.ok) return refuse(sig.step, sig.reason);
  proven = true;
  const e = cmd.signed.envelope;
  const current = () => !c.trust.isRevoked(e.delegation_ref) && c.trust.delegationVersion(e.agent_id) === sig.delegation.version;
  if (!current()) return refuse('delegation', 'delegation_revoked');
  // 3. The first result for this actor and id, or the same id still running.
  const hash = await payloadHash(cmd);
  const unauthorized = c.authorize?.();
  if (unauthorized) return refuse('credential', unauthorized);
  const prior = c.runtime.commandRow(cmd.actorId, cmd.commandId);
  if (prior) return prior.payloadHash === hash ? stored(prior) : refuse('replay', 'command_conflict');
  const flight = `${cmd.actorId}:${cmd.commandId}`;
  if (c.runtime.pending.has(flight)) return refuse('replay', 'in_progress');
  c.runtime.pending.add(flight);
  let settle: (() => void) | undefined;
  try {
    // 4. A new request: the full envelope check without spending the nonce, then the peer's side.
    const verdict = await verifyEnvelope(cmd.signed, c.trust, now, {recipient: h.recipient, claim: false});
    if (!verdict.ok) return refuse(verdict.step, verdict.reason);
    const deadline = c.deadlineMs ?? STEP_DEADLINE_MS;
    let peer: PeerCheck | null = null;
    if (h.counterparty) { try { peer = await within(h.counterparty(), deadline); } catch { return refuse('counterparty', 'counterparty_unavailable', {verified: true}); } }
    if (peer && !peer.ok) return refuse('counterparty', peer.reason, {verified: true});
    // 5. The world the actor planned against (if it named one).
    const stale = () => cmd.expectedVersion !== null && c.runtime.state().version !== cmd.expectedVersion;
    if (stale()) return refuse('version', 'stale_world', {verified: true});
    // 6. Outside the transaction.
    let thought: T | undefined;
    if (h.think) {
      try { const t = await within(h.think(), deadline); thought = t.thought; settle = t.settle; } catch { return refuse('think', 'decision_unavailable', {verified: true}); }
    }
    // 7. Commit point: one storage transaction.
    // MCP supplies a live server clock. Peer/model awaits may cross a Task or credential deadline;
    // the request-start timestamp must never grant extra time to the mutation or its nonce claim.
    const atCommit = c.now ? c.now() : now;
    const box: {applied: Applied} = {applied: {ok: false, code: 'not_applied'}};
    const label = `cmd-${cmd.actorId}-${id}`;
    const done = c.runtime.commitCommand(atCommit, label, {
      guard: () => {
        const unauthorized = c.authorize?.();
        if (unauthorized) return unauthorized;
        const again = c.runtime.commandRow(cmd.actorId, cmd.commandId);
        if (again) return again.payloadHash === hash ? 'duplicate' : 'command_conflict';
        if (stale()) return 'stale_world';
        if (!current() || (peer?.ok && !peer.current(atCommit))) return 'delegation_revoked';
        if (sig.delegation.exp <= atCommit) return 'delegation_expired';
        if (e.expires_at <= atCommit) return 'expired';
        // Last: the nonce is spent only by the commit that uses it (rolled back with it on a throw).
        return c.trust.claimNonce(e.agent_id, e.nonce, e.message_id, e.expires_at) ? null : 'replay';
      },
      mutate: (st, emit) => (box.applied = h.apply(st, emit, atCommit, thought)),
      record: (version, events) => {
        const a = box.applied;
        const result: CommandResult = {ok: a.ok, commandId: cmd.commandId, worldVersion: version, eventIds: events.map(x => x.id), ...(a.ok ? {} : {error: {code: a.code, retryable: false}})};
        return {actorId: cmd.actorId, commandId: cmd.commandId, action: cmd.action, payload: cmd.payload, row: {payloadHash: hash, result, output: a.output ?? null}};
      },
    });
    if (done.aborted === 'duplicate') return stored(c.runtime.commandRow(cmd.actorId, cmd.commandId)!);
    // decision_discarded is for a late model answer; without think, a commit-time refusal is an ordinary one.
    if (done.aborted !== null) return refuse('commit', done.aborted, {verified: true, event: h.think && LATE[done.aborted] ? {at: now, source: 'live', kind: 'decision_discarded', muse: null, data: {reason: LATE[done.aborted], action: cmd.action, command_id: id, thought: 'discarded'}, tags: []} : undefined});
    return {result: done.row.result, output: done.row.output, duplicate: false, verified: true, refused: null};
  } finally {
    c.runtime.pending.delete(flight);
    try { settle?.(); } catch (err) { console.error('command settle failed', err); }
  }
}

