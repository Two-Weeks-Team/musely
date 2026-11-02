// Shared-state write commands (C03, C04). Every agent write (MCP tools, the owner's Muse trade) runs here:
//   1. wrapper ↔ signed fields: commandId = message_id, actorId = agent_id, action, worldId, and the signed
//      content is exactly {worldId, expectedVersion, action, payload}
//   2. the envelope signature (no registry writes yet), so only the proven actor can reach its stored results
//   3. stored result for (actor, commandId): same payload → that result again, nothing re-applied;
//      a different payload → command_conflict
//   4. recipient, delegation, scope, expiry, content, approval and nonce (verifyEnvelope), then the
//      counterparty's card and delegation when the action has one
//   5. expectedVersion against the current world → stale_world
//   6. optional work outside the transaction (a model call). The commit point re-checks the world version
//      and both delegations: a late answer is logged and discarded, never committed
//   7. apply, version bump, events and the result row in one synchronous block.
// A refusal changes no inventory, place, Task or reward: it leaves a refusal event (at a commit that does
// not move the world version) and is not stored. Once step 4 passed, the nonce and message id are spent, so
// re-planning after stale_world needs a new commandId.
import {canonicalize} from '../../src/identity/jcs.ts';
import {signEnvelope, verifySignature, verifyEnvelope, contentHash, type Signed} from '../../src/identity/envelope.ts';
import type {ScopeId} from '../../src/engine/harness.ts';
import type {WorldState, WorldEvent} from '../../src/engine/world.ts';
import type {WorldRuntime} from './world-runtime.ts';
import type {Trust, Executor} from './trust.ts';

export const COMMANDS_TABLE = 'CREATE TABLE IF NOT EXISTS commands (actor_id TEXT NOT NULL, command_id TEXT NOT NULL, payload_hash TEXT NOT NULL, action TEXT NOT NULL, result TEXT NOT NULL, output TEXT, at INTEGER NOT NULL, PRIMARY KEY (actor_id, command_id))';

export type WorldCommand = {commandId: string; worldId: string; expectedVersion: number; actorId: string; action: string; payload: Record<string, unknown>; signed: Signed};
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
  /** Work outside the transaction. It settles its own model cost before returning (C05), so a discarded answer is still paid for. */
  think?: () => Promise<T>;
  apply: (st: WorldState, emit: Emit, at: number, thought: T | undefined) => Applied;
  /** Logs a refusal (the default is one command_refused event). Owner notifications may be added here. */
  refused?: (st: WorldState, emit: Emit, r: Refused, at: number) => void;
};
export type CommandOutcome = {result: CommandResult; output: unknown; duplicate: boolean; verified: boolean; refused: Refused | null};
export type CommandCtx = {trust: Trust; runtime: WorldRuntime};

const RETRYABLE = new Set(['stale_world']);
export const worldHandler = (worldId: string) => `musely:world:${worldId}`;
export const commandContent = (c: Pick<WorldCommand, 'worldId' | 'expectedVersion' | 'action' | 'payload'>) => ({worldId: c.worldId, expectedVersion: c.expectedVersion, action: c.action, payload: c.payload});
/** The command's identity for duplicates: a retry may be re-signed against a newer version, so the version is not part of it. */
export const payloadHash = (c: Pick<WorldCommand, 'worldId' | 'action' | 'payload'>) => contentHash({worldId: c.worldId, action: c.action, payload: c.payload});

/** Signs a command with an executor; the envelope's message id is the command id. */
export async function signCommand(exec: Executor, m: {worldId: string; expectedVersion: number; action: string; payload: Record<string, unknown>; recipient: string; scope: ScopeId | string; ownerClaimed: boolean; now: number; commandId?: string; approvalRef?: string | null; taskId?: string | null; ttlMs?: number}): Promise<WorldCommand> {
  const signed = await signEnvelope(exec.key, exec.delegation, exec.d, {recipient: m.recipient, action: m.action, scope: m.scope, content: commandContent(m), ownerClaimed: m.ownerClaimed, now: m.now, messageId: m.commandId, approvalRef: m.approvalRef, taskId: m.taskId, ttlMs: m.ttlMs});
  return {commandId: signed.envelope.message_id, worldId: m.worldId, expectedVersion: m.expectedVersion, actorId: signed.envelope.agent_id, action: m.action, payload: m.payload, signed};
}

const bound = (c: CommandCtx, cmd: WorldCommand) => {
  const e = cmd?.signed?.envelope;
  if (!e || typeof cmd.commandId !== 'string' || !Number.isInteger(cmd.expectedVersion)) return false;
  if (cmd.commandId !== e.message_id || cmd.actorId !== e.agent_id || cmd.action !== e.action || cmd.worldId !== c.runtime.worldId) return false;
  try { return canonicalize(cmd.signed.content) === canonicalize(commandContent(cmd)); } catch { return false; }
};

export async function executeCommand<T>(c: CommandCtx, cmd: WorldCommand, h: CommandHandler<T>, now = Date.now()): Promise<CommandOutcome> {
  const id = String(cmd?.commandId ?? '').slice(0, 64);
  const refuse = (step: string, code: string, opts: {verified?: boolean; event?: Omit<WorldEvent, 'id' | 'tick'>} = {}): CommandOutcome => {
    const r: Refused = {step, code, retryable: RETRYABLE.has(code)};
    // Each refusal is its own record: repeated refusals of one id in the same millisecond must not collide.
    const events = c.runtime.commitRefusal(now, `cmd-refused-${id}-${Math.random().toString(36).slice(2, 8)}`, (st, emit) => {
      if (opts.event) emit(opts.event);
      else if (h.refused) h.refused(st, emit, r, now);
      else emit({at: now, source: 'live', kind: 'command_refused', muse: null, data: {step, reason: code, action: cmd?.action ?? null, command_id: id}, tags: []});
    });
    return {result: {ok: false, commandId: id, worldVersion: c.runtime.state().version, eventIds: events.map(x => x.id), error: {code, retryable: r.retryable}}, output: null, duplicate: false, verified: !!opts.verified, refused: r};
  };
  // 1–2. The wrapper says what was signed, and the actor really signed it.
  if (!bound(c, cmd)) return refuse('binding', 'bad_command');
  const sig = await verifySignature(cmd.signed, c.trust);
  if (!sig.ok) return refuse(sig.step, sig.reason);
  // 3. The first result for this actor and id.
  const hash = await payloadHash(cmd);
  const prior = c.runtime.commandRow(cmd.actorId, cmd.commandId);
  if (prior) return prior.payloadHash === hash ? {result: prior.result, output: prior.output, duplicate: true, verified: true, refused: null} : refuse('replay', 'command_conflict');
  // 4. A new request: the full envelope check, then the other side of a peer action.
  const verdict = await verifyEnvelope(cmd.signed, c.trust, now, {recipient: h.recipient});
  if (!verdict.ok) {
    // A concurrent retry of the same id loses the nonce race; once the first has committed it gets that result.
    const first = verdict.reason === 'replay' ? c.runtime.commandRow(cmd.actorId, cmd.commandId) : null;
    if (first?.payloadHash === hash) return {result: first.result, output: first.output, duplicate: true, verified: true, refused: null};
    return refuse(verdict.step, verdict.reason);
  }
  const peer = h.counterparty ? await h.counterparty() : null;
  if (peer && !peer.ok) return refuse('counterparty', peer.reason, {verified: true});
  // 5. The world the actor planned against.
  if (c.runtime.state().version !== cmd.expectedVersion) return refuse('version', 'stale_world', {verified: true});
  // 6. Outside the transaction.
  let thought: T | undefined;
  if (h.think) { try { thought = await h.think(); } catch { return refuse('think', 'decision_unavailable', {verified: true}); } }
  // Commit point: synchronous from here on.
  const e = cmd.signed.envelope, d = verdict.delegation;
  const actorCurrent = !c.trust.isRevoked(e.delegation_ref) && c.trust.delegationVersion(e.agent_id) === d.version;
  const late = c.runtime.state().version !== cmd.expectedVersion ? {code: 'stale_world', reason: 'world changed while the model was answering'}
    : !actorCurrent || (peer?.ok && !peer.current(now)) ? {code: 'delegation_revoked', reason: 'delegation revoked before commit'} : null;
  if (late) return refuse('commit', late.code, {verified: true, event: {at: now, source: 'live', kind: 'decision_discarded', muse: null, data: {reason: late.reason, action: cmd.action, command_id: id, thought: h.think ? 'discarded' : null}, tags: []}});
  // 7. Apply, bump, log and store together.
  const box: {applied: Applied} = {applied: {ok: false, code: 'not_applied'}};
  const done = c.runtime.commitCommand(now, `cmd-${id}`, (st, emit) => { box.applied = h.apply(st, emit, now, thought); }, (version, events) => {
    const a = box.applied;
    const result: CommandResult = {ok: a.ok, commandId: cmd.commandId, worldVersion: version, eventIds: events.map(x => x.id), ...(a.ok ? {} : {error: {code: a.code, retryable: false}})};
    return {actorId: cmd.actorId, commandId: cmd.commandId, action: cmd.action, row: {payloadHash: hash, result, output: a.output ?? null}};
  });
  return {result: done.row.result, output: done.row.output, duplicate: false, verified: true, refused: null};
}
