// The connected-Muse surface of the world Durable Object (direction v2, 7.2, 8.8, 12.3, 13.1):
// agent keys, the owner location source, owner notifications and the MCP tool dispatch. Kept outside
// world-do.ts so tests can run the exact same logic over node:sqlite.
import type {Sql} from './ledger.ts';
import type {WorldRuntime} from './world-runtime.ts';
import type {Trust} from './trust.ts';
import type {Hooks} from '../../src/engine/world.ts';
import {OWNER_MUSE} from '../../src/engine/world.ts';
import {AgentKeys} from './agent-keys.ts';
import {runTool, toolList, ownerView, InvalidParams, TOOLS, type ToolCtx} from './mcp-tools.ts';
import {dispatch, type McpOutcome} from './mcp-server.ts';
import {defaultOwner, nextOwnerLocation, ownerLabel, tagLocation, PRESETS} from '../../src/engine/location.ts';
import {followOwner} from '../../src/engine/travel.ts';
import {emptyInbox, notificationMuse, CONNECTED_MS} from '../../src/engine/inbox.ts';
import {REVIEWER_MUSE} from './owner-session.ts';
import {purgeKeyData} from './data-retention.ts';
import {decideApproval, ownerInbox, definedOwnerOf, type DecisionInput, type DecisionOutcome, type OwnerOf} from './tasks.ts';

export type ConnectedDeps = {
  sql: Sql; trust: Trust; runtime: WorldRuntime; hooks: Hooks; baseUrl: string;
  ownerRoot: () => JsonWebKey | null; ownerClaimed: () => boolean; now?: () => number;
  /** Who decides a meetup for a Muse (its owner id, when that owner can sign in here), or null for a resident (rule). */
  ownerOf?: OwnerOf;
};
const CONNECTED_REFRESH_MS = 10 * 60_000;
/** World actions (not reads or inbox polling): a connected Muse that acts asks for a priority spotlight turn (8.2). */
const ACTION_TOOLS = new Set(TOOLS.filter(t => t.write && t.name !== 'heartbeat_check').map(t => t.name));
const uniq = () => Math.random().toString(36).slice(2, 10);

export class ConnectedHost {
  readonly keys: AgentKeys;
  private d: ConnectedDeps;
  constructor(d: ConnectedDeps) { this.d = d; this.keys = new AgentKeys(d.sql); }
  init() { this.keys.init(); }
  private now() { return this.d.now ? this.d.now() : Date.now(); }

  // ----- owner location (13.1) -----
  ownerLocation() {
    const s = this.d.runtime.state(), now = this.now();
    const owner = s.owner ?? defaultOwner(OWNER_MUSE, s.lastTickAt);
    return {...ownerView(owner, s.muses.find(m => m.id === owner.muse), now), presets: PRESETS.map(p => ({id: p.id, label: p.label}))};
  }

  /** Owner session only (checked by the Worker route). Only catalog neighborhood ids are accepted; raw coordinates are refused. */
  setOwnerLocation(input: unknown) {
    const now = this.now(), s = this.d.runtime.state();
    const next = nextOwnerLocation(s.owner ?? defaultOwner(OWNER_MUSE, now), input, now);
    if (!next.ok) return {ok: false as const, reason: next.reason};
    let follow: ReturnType<typeof followOwner> = null;
    this.d.runtime.commitExternal(now, 'owner-location-' + uniq(), (st, emit) => {
      st.owner = next.owner;
      const e = (x: Parameters<typeof emit>[0]) => emit(tagLocation(st.owner, x));
      e({at: now, source: 'live', kind: 'owner_location_set', muse: next.owner.muse, line: `Owner location: ${ownerLabel(next.owner)}${next.owner.source === 'virtual' ? ' (virtual, demo)' : ''}`, data: {source: next.owner.source, preset: next.owner.preset, cell_label: ownerLabel(next.owner), neighborhood_verified: next.owner.verified, ...(next.owner.source === 'gps' ? {phase: 'phase 2: permission flow only'} : {cell: next.owner.cell})}, tags: []});
      follow = followOwner(st, now, e, this.d.hooks);
    });
    return {ok: true as const, location: this.ownerLocation(), follow};
  }

  // ----- agent keys -----
  async issueKey(muse = OWNER_MUSE) {
    const now = this.now();
    const {key, row} = await this.keys.issue(muse, now);
    this.d.runtime.commitExternal(now, 'agent-key-' + uniq(), (_s, emit) => emit({at: now, source: 'live', kind: 'agent_key_issued', muse, line: 'A Musely agent key was issued for a custom connector', data: {key_id: row.id, signer_kind: row.signerKind}, tags: []}));
    return {key, id: row.id, muse, signer_kind: row.signerKind, created_at: row.createdAt, shown_once: true};
  }

  revokeKey(id: string) {
    const now = this.now();
    const row = this.keys.byId(id);
    if (!row) return null;
    const after = this.keys.revoke(id, now)!;
    const last = this.keys.lastActiveUse(row.muse);
    this.d.runtime.commitExternal(now, 'agent-key-revoke-' + uniq(), (st, emit) => {
      const inbox = (st.inbox ??= emptyInbox());
      if (last !== null && now - last < CONNECTED_MS) inbox.connected[row.muse] = last; else delete inbox.connected[row.muse];
      emit({at: now, source: 'live', kind: 'agent_key_revoked', muse: row.muse, line: 'A Musely agent key was revoked', data: {key_id: id}, tags: []});
    });
    return {id: after.id, revoked_at: after.revokedAt, muse: after.muse};
  }

  /**
   * Revokes the key (if not yet) and anonymizes what was made under it (G-09, data-retention.ts). The owner route has
   * checked that the session owns the key's Muse. Repeating it is safe: nothing linked is left the second time.
   */
  purgeKey(id: string, by: string) {
    const row = this.keys.byId(id);
    if (!row) return null;
    if (row.revokedAt === null) this.revokeKey(id);
    const report = purgeKeyData({sql: this.d.sql, runtime: this.d.runtime, trust: this.d.trust, keys: this.keys}, {id, muse: row.muse, createdAt: row.createdAt}, by, this.now());
    const after = this.keys.byId(id)!;
    return {id, muse: row.muse, revoked_at: after.revokedAt, purged: true, ...report};
  }

  /** The Muse a key belongs to (for the owner route's ownership check), or null. */
  keyMuse(id: string) { return this.keys.byId(id)?.muse ?? null; }

  listKeys(muse = OWNER_MUSE) { return this.keys.list(muse).map(k => ({id: k.id, created_at: k.createdAt, last_used_at: k.lastUsedAt, revoked_at: k.revokedAt, signer_kind: k.signerKind})); }

  // ----- owner notifications (12.3: three kinds only) -----
  /** Every notification in its public form; the details only for the Muses in `detailFor` (the asking owner's own). */
  notifications(detailFor: readonly string[] = []) {
    const list = [...(this.d.runtime.state().inbox?.notifications ?? [])].reverse();
    return {kinds: ['meetup_candidate', 'trade_completed', 'blocked'], notifications: list.map(n => {
      const muse = notificationMuse(n);
      return detailFor.includes(muse) ? {...n, muse} : {id: n.id, kind: n.kind, at: n.at, line: n.line, other: n.other, muse};
    })};
  }

  // ----- owner approvals and the owner inbox (C06, I-07) -----
  /**
   * One owner decision (the Worker route checked the owner session, its Origin and that `muse` is the session's own
   * participant of the Task). The decision is tried on a copy first: a refusal that changes nothing writes nothing
   * (no commit, no world version change); otherwise it runs again inside one world commit, which is the result.
   */
  ownerApprove(i: DecisionInput): DecisionOutcome {
    const now = this.now();
    // A revoked Muse's Tasks are cancelled already; its owner's decisions are refused before anything is read for writing.
    if (this.d.trust.suspended(i.muse)) return {ok: false, status: 409, code: 'delegation_revoked', retryable: false, changed: false};
    const task = this.d.runtime.state().inbox?.tasks.find(t => t.id === i.taskId);
    if (i.decision === 'approve' && task) {
      const parties = [task.from, task.to];
      if (parties.some(m => this.d.trust.suspended(m))) return {ok: false, status: 409, code: 'delegation_revoked', retryable: false, changed: false};
      // A peer's final decision cannot confirm an owned Muse whose account claim was revoked while waiting.
      if (parties.includes(OWNER_MUSE) && !this.d.ownerClaimed()) return {ok: false, status: 409, code: 'pending_claim', retryable: false, changed: false};
    }
    const dry = decideApproval(structuredClone(this.d.runtime.state()), i, now, () => {});
    if (!dry.changed) return dry;
    let out: DecisionOutcome = dry;
    this.d.runtime.commitExternal(now, 'owner-approval-' + uniq(), (st, emit) => { out = decideApproval(st, i, now, e => emit(tagLocation(st.owner, e))); }, () => ({action: 'owner_approval', payload: {taskId: i.taskId, museId: i.muse, decision: i.decision, revision: i.revision, approvalRef: out.ok ? out.task.yours?.approval_ref ?? null : null}}));
    return out;
  }
  /** The owner inbox of these Muses (the session's own): approvals waiting, recent decisions, the three notification kinds. */
  ownerInbox(muses: readonly string[]) { return ownerInbox(this.d.runtime.state(), muses, this.now()); }
  ownerOf(museId: string) { return (this.d.ownerOf ?? definedOwnerOf)(museId); }

  // ----- MCP -----
  /** Key check only (active, not revoked): no last-use, no connected flag. The transport asks before it refuses a message it will not dispatch. */
  authenticate(keyHash: string) { return this.keys.findActive(keyHash) !== null; }

  async mcp(keyHash: string, method: string, params: unknown, isNotification: boolean): Promise<McpOutcome> {
    const key = this.keys.findActive(keyHash);
    if (!key) return {status: 'unauthorized'};
    // A message without an id runs nothing but notifications (the transport already answers 400; this is the second fence).
    if (isNotification && method && !method.startsWith('notifications/')) return {status: 'ok', error: {code: -32600, message: 'Invalid Request: only notifications may omit the id'}};
    const now = this.now();
    this.keys.touch(key.id, now);
    // A revoked Muse may still read, but its calls do not change the world (not even the connected flag).
    if (!this.d.trust.suspended(key.muse)) this.markConnected(key.muse, now);
    if (!method) return {status: 'ok', result: {}};
    // The Threads claim proves the real owner's Muse. The reviewer's Muse is a team-controlled resident whose Agent Card
    // already says owner_claimed (like every resident), so its own actions do not wait on the owner's claim. The real
    // claim value stays in ownerClaimed for Agent Cards and credential checks.
    const ctx: ToolCtx = {trust: this.d.trust, runtime: this.d.runtime, hooks: this.d.hooks, ownerRoot: this.d.ownerRoot(), ownerClaimed: this.d.ownerClaimed(), ownerClaimedNow: () => this.d.ownerClaimed(), claimExempt: key.muse === REVIEWER_MUSE, baseUrl: this.d.baseUrl, key, now: () => this.now(), ownerOf: m => this.ownerOf(m), authorize: () => this.keys.byId(key.id)?.revokedAt === null ? null : 'agent_key_revoked'};
    try {
      const out = await dispatch(method, params, {list: toolList, call: (n, a) => runTool(ctx, n, a), isInvalidParams: e => e instanceof InvalidParams});
      // A successful world action puts the Muse in the priority queue (deduplicated, 3 per hour); a revoked Muse never.
      const tool = method === 'tools/call' ? String((params as {name?: unknown} | null)?.name ?? '') : '';
      if (ACTION_TOOLS.has(tool) && (out.result as {isError?: boolean} | undefined)?.isError === false && !this.d.trust.suspended(key.muse)) this.d.runtime.requestSpotlight(key.muse, this.now(), {origin: 'connected', requester: 'connected:' + key.muse});
      return {status: 'ok', ...out};
    } catch (e) {
      console.error('mcp tool error', method, e);
      return {status: 'ok', error: {code: -32603, message: 'Internal error'}};
    }
  }

  /** A Muse is connected while an unrevoked key was used in the last 24 h. Refreshed at most every 10 minutes. */
  private markConnected(muse: string, now: number) {
    const s = this.d.runtime.state();
    const last = s.inbox?.connected[muse];
    if (last !== undefined && now - last < CONNECTED_REFRESH_MS) return;
    const fresh = last === undefined || now - last >= CONNECTED_MS;
    this.d.runtime.commitExternal(now, 'connected-' + uniq(), (st, emit) => {
      (st.inbox ??= emptyInbox()).connected[muse] = now;
      if (fresh) emit(tagLocation(st.owner, {at: now, source: 'live', kind: 'agent_connected', muse, line: 'Connected: this Muse now thinks in its owner\'s runtime (live · your Muse)', data: {via: 'mcp'}, tags: []}));
    });
  }
}
