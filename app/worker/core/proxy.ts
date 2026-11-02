// POST /api/muse: session → burst limit → atomic reservation → live call (8 s) → settle, or replay.
// 429, quota or budget exhaustion, 5xx, timeouts and malformed output all fall back to replay and say so.
import {ACTIONS, InputError, validate, buildMessages, maxCostUsd, actualCostUsd, failureCostUsd, checkOutput, type Action} from './actions.ts';
import {callModel, type ModelConfig} from './model.ts';
import {replayFor} from './replay.ts';
import type {ReserveRequest, ReserveResult, Outcome, Tier} from './ledger.ts';
import type {Session} from './session.ts';

export interface LedgerClient {
  reserve(r: ReserveRequest): Promise<ReserveResult> | ReserveResult;
  settle(id: string, costUsd: number, outcome: Outcome): Promise<unknown> | unknown;
}

export type ProxyDeps = {
  ledger: LedgerClient;
  model: Omit<ModelConfig, 'key'> & {key: string | undefined};
  burst?: (key: string) => Promise<boolean>;
  newId?: () => string;
};

export type MuseResponse = {
  source: 'live' | 'replay' | 'scripted';
  action: Action;
  output: unknown;
  reason?: string;
  evidence?: {model: string; responseId: string | null; requestId: string | null; latencyMs: number; reasoningTokens?: number; costUsd: number; reservationId: string};
  recorded?: unknown;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});

export async function handleMuse(body: unknown, session: Session | null, ipHash: string, deps: ProxyDeps): Promise<Response> {
  if (!session) return json({error: 'session_required'}, 401);
  const b = (body && typeof body === 'object' ? body : {}) as {action?: unknown; input?: unknown};
  if (!ACTIONS.includes(b.action as Action)) return json({error: 'action_not_allowed', allowed: ACTIONS}, 400);
  const action = b.action as Action;
  let input;
  try { input = validate(action, b.input); } catch (e) {
    if (e instanceof InputError) return json({error: 'invalid_input', detail: e.message}, 400);
    throw e;
  }
  const fallback = (reason: string, extra: Partial<MuseResponse> = {}) => {
    const r = replayFor(action, input);
    return json({source: r.source, action, output: r.output, reason, recorded: r.recorded, ...extra} satisfies MuseResponse);
  };
  if (!deps.model.key) return fallback('not_connected');
  if (deps.burst && !(await deps.burst(session.sid))) return fallback('burst_limited');

  const messages = buildMessages(action, input);
  const id = deps.newId ? deps.newId() : crypto.randomUUID();
  const reservation = await deps.ledger.reserve({id, tier: session.tier as Tier, session: session.sid, ip: ipHash, action, maxCostUsd: maxCostUsd(action, messages)});
  if (!reservation.ok) return fallback(reservation.reason);

  const result = await callModel({...deps.model, key: deps.model.key}, action, messages);
  if (!result.ok) {
    // Possibly billed failures with unknown usage keep the full reservation (see failureCostUsd).
    await deps.ledger.settle(id, failureCostUsd(result), result.kind === 'timeout' ? 'timeout' : 'error');
    return fallback(result.kind, {evidence: undefined});
  }
  const cost = actualCostUsd(result.usage);
  const problem = checkOutput(action, input, result.output);
  await deps.ledger.settle(id, cost, problem ? 'rejected' : 'live');
  const evidence = {model: deps.model.model, responseId: result.responseId, requestId: result.requestId, latencyMs: result.latencyMs, reasoningTokens: result.usage?.completion_tokens_details?.reasoning_tokens, costUsd: Math.round(cost * 1e6) / 1e6, reservationId: id};
  if (problem) return fallback('output_rejected:' + problem, {evidence});
  return json({source: 'live', action, output: result.output, evidence} satisfies MuseResponse);
}
