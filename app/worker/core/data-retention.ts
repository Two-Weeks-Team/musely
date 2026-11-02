// Data deletion and retention (G-09; direction v2, 15).
//   purge (DELETE /api/agent-keys/{id}?purge=1, the key holder's owner session): after the key is revoked, one world
//     commit anonymizes what was made under that key and can be linked to it, and logs one `data_deleted` event:
//     - public events that carry the key id (every MCP write, refusal and key issue/revoke records it in data.key_id):
//       the row stays (id, tick, time, source, kind, Muse ids, place, tags, task and item ids keep the counts and the
//       sequence intact), while the key id, the envelope evidence (agent id, nonce, delegation ref, hashes), the call
//       content, the command id and the free text (greeting line, postcard note, wants goal) become "[deleted]".
//     - command result rows of those calls (matched by command id = envelope message id, or by their event ids).
//     - inbox messages and mail in transit sent by those calls, and owner notifications that point at them: text
//       becomes "[deleted]", notification details are dropped (only the key's Muse's notifications). The Muse's public
//       wants go back to its harness wants when their current goal is text this key wrote.
//     - rule events committed with those calls (a resident's answer carries the call's envelope): the envelope becomes
//       "[deleted]"; the rest of the rule event stays.
//     - the key record keeps its id, Muse, creation and revocation times; its hash and last-use time are removed.
//     The search is bounded to events of the key's Muse (as actor or other side) since the key was created.
//     Not linked to a key, so not removed: `agent_connected` events (they name the Muse only), rule events written later
//     by the world (an arrival, a delivered postcard, an expiry), the item history, messages other agents sent to the
//     Muse, and the Muse's in-world state (place, inventory). Logs held by Cloudflare follow Cloudflare's schedule.
//     A purge that finds nothing writes no `data_deleted` event.
//   retention: command result rows are deleted 7 days after they were written (checked at most hourly from the alarm).
//     After that a retried command id is a new command. Public events are kept as before.
import type {Sql} from './ledger.ts';
import type {WorldRuntime} from './world-runtime.ts';
import type {Trust} from './trust.ts';
import type {AgentKeys} from './agent-keys.ts';
import {harnessWants} from '../../src/engine/world.ts';
import {emptyInbox, notificationMuse} from '../../src/engine/inbox.ts';

export const REDACTED = '[deleted]';
export const COMMAND_RETENTION_MS = 7 * 24 * 3_600_000;
export const RETENTION_CHECK_MS = 3_600_000;
/** Event kinds whose `line` is text the caller wrote (greet: the greeting; wants_updated: the goal). */
const FREE_TEXT_LINE = new Set(['greet', 'wants_updated']);
/** Fields in event data that identify the key or carry what the caller sent. */
const CALL_FIELDS = ['key_id', 'envelope', 'content', 'command_id'];

export function initRetention(sql: Sql) { sql.exec('CREATE INDEX IF NOT EXISTS commands_at ON commands (at)'); }

/** Deletes command result rows written more than 7 days before `now` (a row exactly 7 days old is kept). */
export function pruneCommands(sql: Sql, now: number) {
  const cutoff = now - COMMAND_RETENTION_MS;
  const n = Number(sql.exec('SELECT COUNT(*) AS n FROM commands WHERE at < ?', cutoff).toArray()[0]?.n ?? 0);
  if (n) sql.exec('DELETE FROM commands WHERE at < ?', cutoff);
  return n;
}

type Row = {id: string; kind: string; at: number; muse: string | null; other: string | null; line: string | null; data: Record<string, unknown>};
export type PurgeCounts = {events_anonymized: number; rule_events_anonymized: number; commands_deleted: number; messages_redacted: number; mail_redacted: number; notifications_redacted: number; wants_reset: boolean; key_record: 'hash_and_last_use_removed'};
export type PurgeKept = {events: number; key_record: 'id_muse_created_revoked'; unlinked: {agent_connected_events: number; messages_to_muse: number}};
export type PurgeReport = {deleted: PurgeCounts; kept: PurgeKept};

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const parse = (v: unknown): Record<string, unknown> => { try { const x = JSON.parse(String(v ?? '{}')); return x && typeof x === 'object' ? x : {}; } catch { return {}; } };

function redactData(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {...data};
  for (const k of CALL_FIELDS) if (out[k] !== undefined && out[k] !== null) out[k] = REDACTED;
  if (typeof out.note === 'string') out.note = REDACTED;
  if (out.wants && typeof out.wants === 'object') out.wants = {...(out.wants as Record<string, unknown>), goal: REDACTED};
  out.redacted = true;
  return out;
}

export type PurgeDeps = {sql: Sql; runtime: WorldRuntime; trust: Trust; keys: AgentKeys};

/** Anonymizes everything linked to the (already revoked) key in one world commit. Idempotent: a second run finds nothing. */
export function purgeKeyData(d: PurgeDeps, key: {id: string; muse: string; createdAt: number}, by: string, now: number): PurgeReport {
  const museId = key.muse, agentId = d.trust.agentByMuse(museId)?.agentId ?? null;
  let report: PurgeReport | null = null;
  d.runtime.commitExternal(now, `data-deleted-${Math.random().toString(36).slice(2, 10)}`, (st, emit) => {
    // 1. Events that carry the key id. Every one names the key's Muse as actor or other side (a trade the Muse accepts
    // is logged under the proposer) and comes after the key was issued (the issue event has the key's creation time).
    const toRow = (r: Record<string, unknown>): Row => ({id: String(r.id), kind: String(r.kind), at: Number(r.at), muse: str(r.muse), other: str(r.other), line: str(r.line), data: parse(r.data)});
    const rows: Row[] = d.sql.exec("SELECT id, kind, at, muse, other, line, data FROM events WHERE (muse = ? OR other = ?) AND at >= ? AND json_extract(data, '$.key_id') = ?", museId, museId, key.createdAt, key.id).toArray().map(toRow);
    const eventIds = new Set(rows.map(r => r.id)), commandIds = new Set<string>(), taskAt = new Set<string>(), refusedAt = new Set<number>();
    const greets: Row[] = [], postcards: Row[] = [], goals = new Set<string>();
    for (const r of rows) {
      const env = r.data.envelope as {message_id?: unknown} | null | undefined;
      for (const id of [str(env?.message_id), str(r.data.command_id)]) if (id) commandIds.add(id);
      // A Task notification is written in the same commit as the call's event about that Task.
      if (str(r.data.task_id)) taskAt.add(`${r.data.task_id}@${r.at}`);
      if (r.kind === 'a2a_refused') refusedAt.add(r.at);
      if (r.kind === 'greet') greets.push(r);
      if (r.kind === 'postcard_sent') postcards.push(r);
      if (r.kind === 'wants_updated') for (const g of [str((r.data.wants as {goal?: unknown} | undefined)?.goal), r.line]) if (g) goals.add(g);
    }
    for (const r of rows) d.sql.exec('UPDATE events SET line = ?, data = ? WHERE id = ?', FREE_TEXT_LINE.has(r.kind) && r.line !== null ? REDACTED : r.line, JSON.stringify(redactData(r.data)), r.id);
    // Rule events committed under those calls (a resident's answer) carry the call's envelope but no key id.
    const ruleRows: Row[] = [];
    for (const id of commandIds) ruleRows.push(...d.sql.exec("SELECT id, kind, at, muse, other, line, data FROM events WHERE at >= ? AND json_extract(data, '$.envelope.message_id') = ?", key.createdAt, id).toArray().map(toRow));
    for (const r of ruleRows) { eventIds.add(r.id); d.sql.exec('UPDATE events SET data = ? WHERE id = ?', JSON.stringify(redactData(r.data)), r.id); }

    // 2. Command result rows of those calls.
    let commands = 0;
    if (agentId) for (const c of d.sql.exec('SELECT command_id, result FROM commands WHERE actor_id = ?', agentId).toArray()) {
      const id = String(c.command_id), ids = (parse(c.result).eventIds as unknown[] | undefined) ?? [];
      if (commandIds.has(id) || ids.some(x => eventIds.has(String(x)))) { d.sql.exec('DELETE FROM commands WHERE actor_id = ? AND command_id = ?', agentId, id); commands += 1; }
    }

    // 3. Inbox: what those calls sent, and notifications that point at it.
    const inbox = (st.inbox ??= emptyInbox());
    const delivered = postcards.length ? d.sql.exec("SELECT at, muse, data FROM events WHERE kind = 'postcard_delivered' AND other = ?", museId).toArray().map(r => ({at: Number(r.at), to: str(r.muse), data: parse(r.data)})) : [];
    const fromKey = (m: {from: string; to: string; kind: string; at: number; item?: string | null}) => {
      if (m.from !== museId) return false;
      if (m.kind === 'greet') return greets.some(g => g.at === m.at && g.other === m.to);
      if (m.kind === 'postcard') return postcards.some(p => p.other === m.to && p.data.item === m.item && delivered.some(x => x.at === m.at && x.to === m.to && x.data.item === m.item && x.data.sentAt === p.at));
      return false;
    };
    const redactedMessages = new Set<string>();
    for (const m of inbox.messages) if (m.text !== null && fromKey(m)) { m.text = REDACTED; redactedMessages.add(m.id); }
    let mail = 0;
    for (const x of inbox.mail) if (x.from === museId && x.text !== null && postcards.some(p => p.at === x.sentAt && p.other === x.to && p.data.item === x.item)) { x.text = REDACTED; mail += 1; }
    let notifications = 0;
    for (const n of inbox.notifications) {
      const mine = notificationMuse(n) === museId;
      const linked = (n.ref !== null && ((commandIds.has(n.ref) && mine) || redactedMessages.has(n.ref) || (taskAt.has(`${n.ref}@${n.at}`) && mine)))
        || (n.ref === null && n.kind === 'blocked' && notificationMuse(n) === museId && refusedAt.has(n.at));
      if (linked && n.line !== REDACTED) { n.line = REDACTED; delete n.detail; notifications += 1; }
    }
    // The Muse's current public wants, when their goal is text this key wrote (whatever changed the items or source since).
    const m = st.muses.find(x => x.id === museId);
    const wantsReset = !!m && !!m.wants && goals.has(m.wants.goal);
    if (m && wantsReset) m.wants = harnessWants(museId, now);

    // 4. The key record: no hash, no last use.
    d.keys.forget(key.id);

    const deleted: PurgeCounts = {events_anonymized: rows.length, rule_events_anonymized: ruleRows.length, commands_deleted: commands, messages_redacted: redactedMessages.size, mail_redacted: mail, notifications_redacted: notifications, wants_reset: wantsReset, key_record: 'hash_and_last_use_removed'};
    const kept: PurgeKept = {events: rows.length + ruleRows.length, key_record: 'id_muse_created_revoked', unlinked: {
      agent_connected_events: Number(d.sql.exec("SELECT COUNT(*) AS n FROM events WHERE kind = 'agent_connected' AND muse = ?", museId).toArray()[0]?.n ?? 0),
      messages_to_muse: inbox.messages.filter(x => x.to === museId).length,
    }};
    report = {deleted, kept};
    // Who and how much, never which key (the key id is what was just removed). Nothing found: nothing to record.
    const found = rows.length + ruleRows.length + commands + redactedMessages.size + mail + notifications > 0 || wantsReset;
    if (found) emit({at: now, source: 'live', kind: 'data_deleted', muse: museId, line: 'Data made under a revoked agent key was deleted or anonymized', data: {by, scope: 'agent_key', deleted, kept}, tags: []});
  });
  return report!;
}
