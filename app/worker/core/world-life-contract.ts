/** Integration-01 prototype. No production caller, command dispatcher, model or IO.
 * Inputs labelled authoritative must be built inside the server after authentication,
 * from the same transaction snapshot. A client asserting these fields is NOT authority.
 */
export const DEFAULT_CAMPFIRE = 'commons:campfire';
export const INTEGRATION_ENABLED = false;
export const ACTIVATION_BLOCKERS = Object.freeze([
  'world-and-life-dependencies-unmerged',
  'craft-fix-unmerged-and-live-unverified',
  'joint-world-life-transaction-unwired',
  'real-render-and-muse-validation-pending',
]);
/** No environment variable or model output can turn this prototype into production execution. */
export function activationStatus() { return {enabled: INTEGRATION_ENABLED, blockers: [...ACTIVATION_BLOCKERS]}; }

export type AuthorityView = {
  worldId: string; version: number; now: number; residentTurnAllowed: boolean;
  actors: readonly {id: string; personal: boolean; connected: boolean; paused: boolean; busy: boolean}[];
  placeIds: readonly string[];
};
export type ResidentSuggestion = {
  id: string; worldId: string; actorId: string; expectedVersion: number;
  createdAt: number; expiresAt: number; action: 'move' | 'invite' | 'request_activity';
  placeId?: string;
};
const id = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 160;
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
/** Fixture/prototype validation only. Success means a suggestion is well-scoped, NOT executed.
 * The existing signed tool must still revalidate authority, resources, consent and version
 * atomically at commit. Never use success to accept a personal Muse's invitation/trade.
 */
export function inspectResidentSuggestion(p: ResidentSuggestion, view: AuthorityView):
  {ok: false; reason: string} | {ok: true; stage: 'proposal_only'; placeId: string} {
  const no = (reason: string) => ({ok: false as const, reason});
  if (!id(p.id) || !id(p.worldId) || !id(p.actorId) || !integer(p.expectedVersion) ||
      !integer(view.version) || ![p.createdAt,p.expiresAt,view.now].every(Number.isFinite)) return no('invalid_envelope');
  if (p.worldId !== view.worldId || p.expectedVersion !== view.version) return no('stale_or_foreign_world');
  if (p.createdAt > view.now || p.expiresAt <= view.now || p.expiresAt <= p.createdAt) return no('expired_or_future');
  if (view.residentTurnAllowed !== true) return no('resident_budget_denied');
  const actor = view.actors.find(a => a.id === p.actorId);
  if (!actor || actor.personal !== false || actor.connected !== false || actor.paused !== false) return no('owner_authority_required');
  if (actor.busy !== false) return no('actor_busy');
  if (!['move','invite','request_activity'].includes(p.action)) return no('unsupported_action');
  const placeId = p.placeId ?? (p.action === 'invite' ? DEFAULT_CAMPFIRE : '');
  if (!id(placeId) || !view.placeIds.includes(placeId)) return no('unknown_place');
  return {ok: true, stage: 'proposal_only', placeId};
}

export type InviteReceipt = {
  receiptId: string; worldId: string; worldVersion: number; at: number;
  inviteId: string; revision: number; placeId: string; host: string; invitees: string[];
  expiresAt: number; status: 'open' | 'gathered' | 'expired' | 'cancelled';
  /** Existing server's token spend receipt, not a new token or permission to consume it. */
  spentTokenReceiptId: string;
  /** Explicit committed acceptance only, never inferred from arrival/proximity. */
  accepted: string[];
  present: {id: string; placeId: string; travelling: boolean; paused: boolean}[];
};
export type Projection = {
  schema: 1; worldId: string; placeIds: string[]; version: number;
  receipts: InviteReceipt[];
};
/** Deliberately separate from WorldState and its replay log; no migration or new server events. */
export function createProjection(worldId: string, placeIds: readonly string[]): Projection {
  if (!id(worldId) || !placeIds.length || placeIds.length > 64 || placeIds.some(x => !id(x)) || new Set(placeIds).size !== placeIds.length) throw Error('invalid_scope');
  return {schema:1, worldId, placeIds:[...placeIds], version:0, receipts:[]};
}
function normalized(r: InviteReceipt): InviteReceipt {
  // Explicit allowlist excludes private notes, raw location, credentials, model/peer instructions.
  return {receiptId:r.receiptId,worldId:r.worldId,worldVersion:r.worldVersion,at:r.at,inviteId:r.inviteId,
    revision:r.revision,placeId:r.placeId,host:r.host,invitees:[...r.invitees],expiresAt:r.expiresAt,
    status:r.status,spentTokenReceiptId:r.spentTokenReceiptId,accepted:[...r.accepted],
    present:r.present.map(p=>({id:p.id,placeId:p.placeId,travelling:p.travelling,paused:p.paused}))};
}
/** Trusted committed server receipt -> display projection; never creates invitations or spends items.
 * This function is not an authentication boundary. Do not expose it to untrusted network input.
 */
export function projectInvite(state: Projection, input: InviteReceipt): Projection {
  const r = normalized(input);
  if (![r.receiptId,r.inviteId,r.host,r.spentTokenReceiptId].every(id) ||
      r.worldId !== state.worldId || !integer(r.worldVersion) || !integer(r.revision) || r.revision < 1 ||
      ![r.at,r.expiresAt].every(Number.isFinite) || !state.placeIds.includes(r.placeId) ||
      !['open','gathered','expired','cancelled'].includes(r.status)) throw Error('invalid_receipt');
  if (!r.invitees.length || r.invitees.length > 8 || new Set(r.invitees).size !== r.invitees.length ||
      r.invitees.some(x=>!id(x)||x===r.host) || new Set(r.accepted).size !== r.accepted.length ||
      r.accepted.some(x=>!r.invitees.includes(x)) || new Set(r.present.map(x=>x.id)).size !== r.present.length ||
      r.present.some(x=>!id(x.id)||!state.placeIds.includes(x.placeId)||typeof x.travelling!=='boolean'||typeof x.paused!=='boolean'||(x.id!==r.host&&!r.invitees.includes(x.id)))) throw Error('invalid_participants');
  const existing = state.receipts.find(x=>x.receiptId===r.receiptId);
  if (existing) {
    if (JSON.stringify(existing)!==JSON.stringify(r)) throw Error('idempotency_conflict');
    return state;
  }
  if (state.receipts.length >= 4096) throw Error('projection_capacity_requires_checkpoint');
  if (r.worldVersion < state.version) throw Error('stale_world_version');
  const previous = state.receipts.filter(x=>x.inviteId===r.inviteId).at(-1);
  if (previous) {
    // Multiple receipts may belong to one committed world version; invite revision orders them.
    if (r.revision !== previous.revision+1 || r.worldVersion < previous.worldVersion || r.at < previous.at) throw Error('stale_invite_revision');
    if (previous.status !== 'open') throw Error('terminal_invite');
    if (r.placeId!==previous.placeId || r.host!==previous.host || r.expiresAt!==previous.expiresAt ||
        r.spentTokenReceiptId!==previous.spentTokenReceiptId || JSON.stringify(r.invitees)!==JSON.stringify(previous.invitees)) throw Error('invite_scope_changed');
  } else {
    if (r.revision!==1 || !['open','gathered'].includes(r.status) || r.expiresAt<=r.at || r.expiresAt-r.at>30*60_000) throw Error('invalid_initial_invite');
    if (state.receipts.some(x=>x.spentTokenReceiptId===r.spentTokenReceiptId)) throw Error('token_receipt_reused');
  }
  if ((r.status==='open'||r.status==='gathered') && r.at>=r.expiresAt) throw Error('expired_invite');
  if (r.status==='expired' && r.at<r.expiresAt) throw Error('premature_expiry');
  if (r.status==='gathered' && attendees(r).length<3) throw Error('insufficient_consented_attendance');
  return {...state,version:r.worldVersion,receipts:[...state.receipts,r]};
}
/** Arrival is not acceptance. Other places, travelling and paused actors never count. */
export function attendees(r: InviteReceipt): string[] {
  return r.present.filter(p=>p.placeId===r.placeId&&!p.travelling&&!p.paused&&(p.id===r.host||r.accepted.includes(p.id))).map(p=>p.id);
}
export function visibleInvites(state: Projection, placeId: string, now: number): InviteReceipt[] {
  if (!Number.isFinite(now) || !state.placeIds.includes(placeId)) return [];
  const latest = new Map<string,InviteReceipt>();
  for (const r of state.receipts) latest.set(r.inviteId,r);
  return structuredClone([...latest.values()].filter(r=>r.placeId===placeId&&r.status==='open'&&r.at<=now&&r.expiresAt>now));
}
export function saveProjection(state: Projection): string { return JSON.stringify(state); }
export function restoreProjection(raw: string): Projection {
  if (raw.length>4_000_000) throw Error('snapshot_too_large');
  const data = JSON.parse(raw);
  if (data.schema!==1 || !Array.isArray(data.receipts) || data.receipts.length>4096 || !Array.isArray(data.placeIds)) throw Error('invalid_snapshot');
  let state=createProjection(data.worldId,data.placeIds);
  for (const receipt of data.receipts) state=projectInvite(state,receipt);
  if (state.version!==data.version) throw Error('invalid_snapshot_version');
  return state;
}
