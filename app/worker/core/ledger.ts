// Budget and quota ledger kept in the world Durable Object's SQLite storage (direction v2, 8.7 and 15).
// A call first reserves its maximum cost atomically; the answer settles the real cost. Durable Object
// methods run one at a time and the SQL API is synchronous, so reserve() cannot interleave and the
// daily cap cannot be overshot by concurrent callers.

export interface Sql {
  exec(query: string, ...bindings: unknown[]): {toArray(): Record<string, unknown>[]};
}

export type Tier = 'visitor' | 'judge' | 'world';
export type DenyReason = 'budget' | 'session_quota' | 'ip_quota';
export type ReserveRequest = {id: string; tier: Tier; session: string; ip: string; action: string; maxCostUsd: number};
export type ReserveResult = {ok: true; id: string} | {ok: false; reason: DenyReason};
export type Outcome = 'live' | 'timeout' | 'error' | 'rejected';

// Unconnected visitors get a 3-per-hour trial of their harness run by the team key (direction v2, 8.8/15).
// The liveness challenge is a system use and is counted separately so a trial does not block the ritual.
export const HOURLY_LIMITS: Record<Tier, number> = {visitor: 3, judge: 120, world: Number.POSITIVE_INFINITY};
export const CHALLENGE_HOURLY_LIMIT = 3;
export const IP_HOURLY_LIMIT = 40;
// A reservation that is never settled (crashed request) counts at its full amount after this long.
export const STALE_RESERVATION_MS = 60_000;

const HOUR = 3_600_000;
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class Ledger {
  private sql: Sql;
  private opts: {dailyCapUsd: number; now?: () => number};
  constructor(sql: Sql, opts: {dailyCapUsd: number; now?: () => number}) {
    this.sql = sql;
    this.opts = opts;
  }
  private now() { return this.opts.now ? this.opts.now() : Date.now(); }

  init() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS budget (day TEXT PRIMARY KEY, spent REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, day TEXT NOT NULL, tier TEXT NOT NULL, session TEXT NOT NULL, ip TEXT NOT NULL, action TEXT NOT NULL, amount REAL NOT NULL, created INTEGER NOT NULL, settled INTEGER, cost REAL, outcome TEXT)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS reservations_session ON reservations (session, created)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS reservations_ip ON reservations (ip, created)');
  }

  private row(day: string) {
    this.sql.exec('INSERT OR IGNORE INTO budget (day) VALUES (?)', day);
    const r = this.sql.exec('SELECT spent, reserved, calls FROM budget WHERE day = ?', day).toArray()[0];
    return {spent: Number(r.spent), reserved: Number(r.reserved), calls: Number(r.calls)};
  }

  // Settles abandoned reservations at their full amount so a crash never frees budget.
  private expireStale(now: number) {
    const stale = this.sql.exec('SELECT id FROM reservations WHERE settled IS NULL AND created < ?', now - STALE_RESERVATION_MS).toArray();
    for (const r of stale) this.settle(String(r.id), Number.NaN, 'error');
  }

  reserve(req: ReserveRequest): ReserveResult {
    const now = this.now(), day = dayKey(now);
    if (!(req.maxCostUsd > 0) || !Number.isFinite(req.maxCostUsd)) throw new Error('maxCostUsd must be positive');
    this.expireStale(now);
    const existing = this.sql.exec('SELECT id FROM reservations WHERE id = ?', req.id).toArray();
    if (existing.length) return {ok: true, id: req.id}; // idempotent retry of the same action
    const b = this.row(day);
    if (b.spent + b.reserved + req.maxCostUsd > this.opts.dailyCapUsd) return {ok: false, reason: 'budget'};
    if (req.tier !== 'world') {
      const challenge = req.action === 'challenge';
      const perSession = Number(this.sql.exec(`SELECT count(*) AS n FROM reservations WHERE session = ? AND created > ? AND (outcome IS NULL OR outcome != ?) AND action ${challenge ? '=' : '!='} 'challenge'`, req.session, now - HOUR, 'rejected').toArray()[0].n);
      if (perSession >= (challenge && req.tier === 'visitor' ? CHALLENGE_HOURLY_LIMIT : HOURLY_LIMITS[req.tier])) return {ok: false, reason: 'session_quota'};
      if (req.tier === 'visitor') {
        const perIp = Number(this.sql.exec('SELECT count(*) AS n FROM reservations WHERE ip = ? AND created > ? AND tier = ?', req.ip, now - HOUR, 'visitor').toArray()[0].n);
        if (perIp >= IP_HOURLY_LIMIT) return {ok: false, reason: 'ip_quota'};
      }
    }
    this.sql.exec('INSERT INTO reservations (id, day, tier, session, ip, action, amount, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', req.id, day, req.tier, req.session, req.ip, req.action, req.maxCostUsd, now);
    this.sql.exec('UPDATE budget SET reserved = reserved + ? WHERE day = ?', req.maxCostUsd, day);
    return {ok: true, id: req.id};
  }

  // costUsd NaN means "unknown": charge the full reservation (e.g. a timed-out call that may still bill).
  settle(id: string, costUsd: number, outcome: Outcome): {ok: boolean; already?: boolean; chargedUsd?: number} {
    const r = this.sql.exec('SELECT day, amount, settled FROM reservations WHERE id = ?', id).toArray()[0];
    if (!r) return {ok: false};
    if (r.settled !== null && r.settled !== undefined) return {ok: true, already: true};
    const amount = Number(r.amount), charged = Number.isNaN(costUsd) ? amount : Math.max(0, costUsd);
    this.sql.exec('UPDATE reservations SET settled = ?, cost = ?, outcome = ? WHERE id = ?', this.now(), charged, outcome, id);
    this.sql.exec('UPDATE budget SET reserved = max(0, reserved - ?), spent = spent + ?, calls = calls + ? WHERE day = ?', amount, charged, outcome === 'live' ? 1 : 0, String(r.day));
    return {ok: true, chargedUsd: charged};
  }

  status() {
    const now = this.now(), day = dayKey(now), b = this.row(day);
    return {day, capUsd: this.opts.dailyCapUsd, spentUsd: round(b.spent), reservedUsd: round(b.reserved), liveCalls: b.calls, remainingUsd: round(Math.max(0, this.opts.dailyCapUsd - b.spent - b.reserved))};
  }

  quotaFor(session: string, tier: Tier) {
    const used = Number(this.sql.exec("SELECT count(*) AS n FROM reservations WHERE session = ? AND created > ? AND (outcome IS NULL OR outcome != ?) AND action != 'challenge'", session, this.now() - HOUR, 'rejected').toArray()[0].n);
    return {perHour: HOURLY_LIMITS[tier], usedThisHour: used};
  }

  prune(olderThanMs = 3 * 24 * HOUR) {
    this.sql.exec('DELETE FROM reservations WHERE created < ? AND settled IS NOT NULL', this.now() - olderThanMs);
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
