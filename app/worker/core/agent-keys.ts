// Musely agent keys (direction v2, 4-2 and 7.2): a bearer credential a connected Muse stores in its custom
// connector. The key is shown once; this object keeps only its SHA-256. A key maps to one Muse and the
// server_custodial executor: the Worker signs envelopes for that Muse inside the owner's delegation, so
// the owner's revocation (Trust.revoke) also stops every action taken under the key.
import type {Sql} from './ledger.ts';

export const KEY_PREFIX = 'msly_';
export type AgentKeyRow = {id: string; muse: string; signerKind: 'server_custodial'; createdAt: number; lastUsedAt: number | null; revokedAt: number | null};

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 (hex) of a presented bearer string. Computed in the Worker so the raw key never reaches storage. */
export const hashAgentKey = async (key: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
/** Shape check before hashing: prefix + 43 base64url characters (32 random bytes). */
export const looksLikeAgentKey = (key: string) => /^msly_[A-Za-z0-9_-]{43}$/.test(key);

export class AgentKeys {
  private sql: Sql;
  constructor(sql: Sql) { this.sql = sql; }

  init() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS agent_keys (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, muse TEXT NOT NULL, signer_kind TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER)');
  }

  /** Issues a new key. The returned `key` is the only copy; it is never stored or logged. */
  async issue(muse: string, now: number, commit?:(insert:()=>void,row:AgentKeyRow)=>void): Promise<{key: string; row: AgentKeyRow}> {
    const key = KEY_PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));
    const id = 'ak_' + b64url(crypto.getRandomValues(new Uint8Array(9)));
    const hash=await hashAgentKey(key),row:AgentKeyRow={id,muse,signerKind:'server_custodial',createdAt:now,lastUsedAt:null,revokedAt:null};
    const insert=()=>{this.sql.exec('INSERT INTO agent_keys (id, hash, muse, signer_kind, created_at) VALUES (?, ?, ?, ?, ?)', id, hash, muse, 'server_custodial', now);};
    if(commit)commit(insert,row);else insert();
    return {key, row: this.byId(id)!};
  }

  byId(id: string): AgentKeyRow | null {
    const r = this.sql.exec('SELECT id, muse, signer_kind, created_at, last_used_at, revoked_at FROM agent_keys WHERE id = ?', id).toArray()[0];
    return r ? toRow(r) : null;
  }

  /** The active key for a presented hash, or null (unknown or revoked). */
  findActive(hash: string): AgentKeyRow | null {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    const r = this.sql.exec('SELECT id, muse, signer_kind, created_at, last_used_at, revoked_at FROM agent_keys WHERE hash = ? AND revoked_at IS NULL', hash).toArray()[0];
    return r ? toRow(r) : null;
  }

  /** Records use at most once a minute (the connected flag needs only coarse freshness). */
  touch(id: string, now: number) {
    this.sql.exec('UPDATE agent_keys SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)', now, id, now - 60_000);
  }

  revoke(id: string, now: number): AgentKeyRow | null {
    this.sql.exec('UPDATE agent_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, id);
    return this.byId(id);
  }

  /** After a purge: the record keeps its id, Muse and times of creation and revocation; the hash and last use go. */
  forget(id: string) {
    this.sql.exec("UPDATE agent_keys SET hash = 'purged:' || id, last_used_at = NULL WHERE id = ? AND revoked_at IS NOT NULL", id);
  }

  list(muse: string): AgentKeyRow[] {
    return this.sql.exec('SELECT id, muse, signer_kind, created_at, last_used_at, revoked_at FROM agent_keys WHERE muse = ? ORDER BY created_at DESC LIMIT 20', muse).toArray().map(toRow);
  }

  /** Latest use of any unrevoked key for this Muse (null when none). */
  lastActiveUse(muse: string): number | null {
    const r = this.sql.exec('SELECT MAX(last_used_at) AS t FROM agent_keys WHERE muse = ? AND revoked_at IS NULL', muse).toArray()[0];
    return r?.t == null ? null : Number(r.t);
  }
}

const toRow = (r: Record<string, unknown>): AgentKeyRow => ({id: String(r.id), muse: String(r.muse), signerKind: 'server_custodial', createdAt: Number(r.created_at), lastUsedAt: r.last_used_at == null ? null : Number(r.last_used_at), revokedAt: r.revoked_at == null ? null : Number(r.revoked_at)});
