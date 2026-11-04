// Budget and quota ledger kept in the world Durable Object's SQLite storage (direction v2, 8.7 and 15).
// A call first reserves its maximum cost atomically; the answer settles the real cost. Durable Object
// methods run one at a time and the SQL API is synchronous, so reserve() cannot interleave and the
// daily cap cannot be overshot by concurrent callers.

export interface Sql {
  exec(query: string, ...bindings: unknown[]): {toArray(): Record<string, unknown>[]};
}

export type Tier = 'visitor' | 'judge' | 'world';
export type DenyReason = 'budget' | 'session_quota' | 'ip_quota' | 'resident_disabled' | 'budget_window' | 'period_budget' | 'resident_daily_budget' | 'interactive_daily_budget' | 'resident_hourly_budget' | 'resident_priority_budget';
export type ResidentKind = 'action' | 'chat' | 'trade' | 'personal' | 'reflection';
export type ResidentBudgetOptions = {enabled: boolean; residentDailyCapUsd: number; interactiveDailyCapUsd: number; residentHourlyCapUsd: number; periodStartAt: number; periodEndAt: number; periodCapUsd: number; residentEnabled: boolean};
type LedgerOptions = {dailyCapUsd: number; now?: () => number; residentBudget?: ResidentBudgetOptions};
export type ReserveRequest = {id: string; tier: Tier; session: string; ip: string; action: string; maxCostUsd: number; residentKind?: ResidentKind};
/** `existing`: this id was reserved before (a retry); the caller must not spend it again. */
export type ReserveResult = {ok: true; id: string; existing?: true} | {ok: false; reason: DenyReason};
export type Outcome = 'live' | 'timeout' | 'error' | 'rejected' | 'abandoned';

// Unconnected visitors get a 3-per-hour trial of their harness run by the team key (direction v2, 8.8/15).
// The liveness challenge is a system use and is counted separately so a trial does not block the ritual.
export const HOURLY_LIMITS: Record<Tier, number> = {visitor: 3, judge: 120, world: Number.POSITIVE_INFINITY};
export const CHALLENGE_HOURLY_LIMIT = 3;
export const IP_HOURLY_LIMIT = 40;
// A reservation that is never settled (crashed request) counts at its full amount after this long.
export const STALE_RESERVATION_MS = 60_000;

const HOUR = 3_600_000;
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Priority cutoffs are policy choices, applied to projected rolling-hour AND resident-day cost.
// They reserve headroom, not calls: no call-count cap is introduced.
export const RESIDENT_PRIORITY_CUTOFFS: Record<ResidentKind, number> = {action: .60, reflection: .60, chat: .80, trade: .95, personal: 1};
const KST = 9 * HOUR, DAY = 24 * HOUR;
const residentSQL = "(tier = 'world' AND action != 'challenge')";
const costSQL = 'CASE WHEN settled IS NULL THEN amount ELSE coalesce(cost, amount) END';
const kindSQL = `CASE
  WHEN action LIKE 'rb:personal:%' THEN 'personal'
  WHEN action LIKE 'rb:reflection:%' OR action = 'reflection' THEN 'reflection'
  WHEN action LIKE 'rb:chat:%' OR action = 'encounter' THEN 'chat'
  WHEN action LIKE 'rb:trade:%' OR action IN ('trade', 'negotiate') THEN 'trade'
  ELSE 'action' END`;
// Unknown pre-feature world actions are conservatively action-tier, never elevated to personal priority.
function residentKind(req: ReserveRequest): ResidentKind {
  if (req.residentKind !== undefined) {
    if (typeof req.residentKind !== 'string' || !Object.hasOwn(RESIDENT_PRIORITY_CUTOFFS, req.residentKind)) throw new Error('invalid residentKind');
    return req.residentKind;
  }
  return req.action === 'encounter' ? 'chat' : req.action === 'trade' || req.action === 'negotiate' ? 'trade' : req.action === 'reflection' ? 'reflection' : 'action';
}

export class Ledger {
  private sql: Sql;
  private opts: LedgerOptions;
  constructor(sql: Sql, opts: LedgerOptions) {
    this.sql = sql;
    this.opts = opts;
    this.residentPolicy();
  }
  private now() { return this.opts.now ? this.opts.now() : Date.now(); }
  private residentPolicy() {
    const p = this.opts.residentBudget;
    if (!p?.enabled) return null;
    if (![this.opts.dailyCapUsd, p.residentDailyCapUsd, p.interactiveDailyCapUsd, p.residentHourlyCapUsd, p.periodCapUsd].every(n => Number.isFinite(n) && n >= 0)
      || !Number.isSafeInteger(p.periodStartAt) || !Number.isSafeInteger(p.periodEndAt) || p.periodStartAt >= p.periodEndAt
      || typeof p.residentEnabled !== 'boolean') throw new Error('invalid resident budget');
    return p;
  }
  private aggregate(where: string, bindings: number[]) {
    const r = this.sql.exec(`SELECT coalesce(sum(${costSQL}),0) cost,
      coalesce(sum(CASE WHEN settled IS NULL THEN amount ELSE 0 END),0) reserved,
      coalesce(sum(CASE WHEN settled IS NOT NULL THEN coalesce(cost,amount) ELSE 0 END),0) spent,
      coalesce(sum(CASE WHEN outcome = 'live' THEN 1 ELSE 0 END),0) live
      FROM reservations WHERE ${where}`, ...bindings).toArray()[0];
    return {cost: Number(r.cost), reserved: Number(r.reserved), spent: Number(r.spent), live: Number(r.live)};
  }
  private residentAccounting(now: number, p: ResidentBudgetOptions) {
    const start = Math.floor((now + KST) / DAY) * DAY - KST;
    const daily = 'created >= ? AND created < ?', period = this.aggregate(daily, [p.periodStartAt, p.periodEndAt]);
    const all = this.aggregate(daily, [start, start + DAY]);
    const resident = this.aggregate(`${daily} AND ${residentSQL}`, [start, start + DAY]);
    const interactive = this.aggregate(`${daily} AND NOT ${residentSQL}`, [start, start + DAY]);
    const hour = this.aggregate(`created > ? AND ${residentSQL}`, [now - HOUR]);
    return {start, day: dayKey(now + KST), period, all, resident, interactive, hour};
  }
  private residentDenial(req: ReserveRequest, now: number, p: ResidentBudgetOptions): DenyReason | null {
    if (now < p.periodStartAt || now >= p.periodEndAt) return 'budget_window';
    const resident = req.tier === 'world' && req.action !== 'challenge';
    if (resident && !p.residentEnabled) return 'resident_disabled';
    const a = this.residentAccounting(now, p), cost = req.maxCostUsd;
    if (a.all.cost + cost > this.opts.dailyCapUsd) return 'budget';
    if (a.period.cost + cost > p.periodCapUsd) return 'period_budget';
    if (!resident) return a.interactive.cost + cost > p.interactiveDailyCapUsd ? 'interactive_daily_budget' : null;
    if (a.resident.cost + cost > p.residentDailyCapUsd) return 'resident_daily_budget';
    if (a.hour.cost + cost > p.residentHourlyCapUsd) return 'resident_hourly_budget';
    const cutoff = RESIDENT_PRIORITY_CUTOFFS[residentKind(req)];
    if (a.resident.cost + cost > p.residentDailyCapUsd * cutoff || a.hour.cost + cost > p.residentHourlyCapUsd * cutoff) return 'resident_priority_budget';
    return null;
  }

  init() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS budget (day TEXT PRIMARY KEY, spent REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, day TEXT NOT NULL, tier TEXT NOT NULL, session TEXT NOT NULL, ip TEXT NOT NULL, action TEXT NOT NULL, amount REAL NOT NULL, created INTEGER NOT NULL, settled INTEGER, cost REAL, outcome TEXT)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS reservations_session ON reservations (session, created)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS reservations_ip ON reservations (ip, created)');
    if (this.residentPolicy()) this.sql.exec('CREATE INDEX IF NOT EXISTS reservations_created ON reservations (created)');
  }

  private row(day: string) {
    this.sql.exec('INSERT OR IGNORE INTO budget (day) VALUES (?)', day);
    const r = this.sql.exec('SELECT spent, reserved, calls FROM budget WHERE day = ?', day).toArray()[0];
    return {spent: Number(r.spent), reserved: Number(r.reserved), calls: Number(r.calls)};
  }

  // Settles abandoned reservations at their full amount so a crash never frees budget.
  private expireStale(now: number) {
    const stale = this.sql.exec('SELECT id FROM reservations WHERE settled IS NULL AND created < ?', now - STALE_RESERVATION_MS).toArray();
    for (const r of stale) this.settle(String(r.id), Number.NaN, this.residentPolicy() ? 'abandoned' : 'error');
  }

  reserve(req: ReserveRequest): ReserveResult {
    const now = this.now(), day = dayKey(now);
    if (!(req.maxCostUsd > 0) || !Number.isFinite(req.maxCostUsd)) throw new Error('maxCostUsd must be positive');
    this.expireStale(now);
    const existing = this.sql.exec('SELECT id FROM reservations WHERE id = ?', req.id).toArray();
    if (existing.length) return {ok: true, id: req.id, existing: true}; // idempotent retry of the same action
    const policy = this.residentPolicy();
    if (policy && req.residentKind !== undefined) residentKind(req);
    const b = this.row(day);
    if (policy) {
      const reason = this.residentDenial(req, now, policy);
      if (reason) return {ok: false, reason};
    } else if (b.spent + b.reserved + req.maxCostUsd > this.opts.dailyCapUsd) return {ok: false, reason: 'budget'};
    if (req.tier !== 'world') {
      const challenge = req.action === 'challenge';
      // Only visitors have a separate ritual allowance; judges share one quota across every action.
      const actionFilter = req.tier === 'visitor' ? ` AND action ${challenge ? '=' : '!='} 'challenge'` : '';
      const perSession = Number(this.sql.exec(`SELECT count(*) AS n FROM reservations WHERE session = ? AND created > ? AND (outcome IS NULL OR outcome != ?)${actionFilter}`, req.session, now - HOUR, 'rejected').toArray()[0].n);
      if (perSession >= (challenge && req.tier === 'visitor' ? CHALLENGE_HOURLY_LIMIT : HOURLY_LIMITS[req.tier])) return {ok: false, reason: 'session_quota'};
      if (req.tier === 'visitor') {
        const perIp = Number(this.sql.exec('SELECT count(*) AS n FROM reservations WHERE ip = ? AND created > ? AND tier = ?', req.ip, now - HOUR, 'visitor').toArray()[0].n);
        if (perIp >= IP_HOURLY_LIMIT) return {ok: false, reason: 'ip_quota'};
      }
    }
    this.sql.exec('INSERT INTO reservations (id, day, tier, session, ip, action, amount, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', req.id, day, req.tier, req.session, req.ip, policy && req.tier === 'world' && req.action !== 'challenge' ? `rb:${residentKind(req)}:${req.action}` : req.action, req.maxCostUsd, now);
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
    const policy = this.residentPolicy();
    if (policy) {
      const a = this.residentAccounting(now, policy);
      // calls counts reservations; knownModelCalls counts settled, non-abandoned attempts (not successful LIVE answers).
      const kinds = Object.fromEntries(Object.keys(RESIDENT_PRIORITY_CUTOFFS).map(kind => [kind, {calls: 0, knownModelCalls: 0, costUsd: 0, spentUsd: 0, reservedUsd: 0, pending: 0, abandoned: 0}]));
      for (const r of this.sql.exec(`SELECT ${kindSQL} kind, count(*) calls, sum(CASE WHEN settled IS NOT NULL AND outcome != 'abandoned' THEN 1 ELSE 0 END) known_calls, sum(${costSQL}) cost,
        sum(CASE WHEN settled IS NOT NULL THEN coalesce(cost,amount) ELSE 0 END) spent,
        sum(CASE WHEN settled IS NULL THEN amount ELSE 0 END) reserved,
        sum(CASE WHEN settled IS NULL THEN 1 ELSE 0 END) pending,
        sum(CASE WHEN outcome = 'abandoned' THEN 1 ELSE 0 END) abandoned
        FROM reservations WHERE created > ? AND ${residentSQL} GROUP BY ${kindSQL}`, now - HOUR).toArray()) {
        kinds[String(r.kind)] = {calls: Number(r.calls), knownModelCalls: Number(r.known_calls), costUsd: round(Number(r.cost)), spentUsd: round(Number(r.spent)), reservedUsd: round(Number(r.reserved)), pending: Number(r.pending), abandoned: Number(r.abandoned)};
      }
      return {day: a.day, capUsd: this.opts.dailyCapUsd, spentUsd: round(a.all.spent), reservedUsd: round(a.all.reserved), liveCalls: a.all.live, remainingUsd: round(Math.max(0, this.opts.dailyCapUsd - a.all.cost)),
        residentBudget: {timezone: 'Asia/Seoul', residentEnabled: policy.residentEnabled,
          period: {startAt: policy.periodStartAt, endAt: policy.periodEndAt, capUsd: policy.periodCapUsd, costUsd: round(a.period.cost), remainingUsd: round(Math.max(0, policy.periodCapUsd - a.period.cost))},
          resident: {dailyCapUsd: policy.residentDailyCapUsd, hourlyCapUsd: policy.residentHourlyCapUsd, dayCostUsd: round(a.resident.cost), hourCostUsd: round(a.hour.cost), byKind: kinds},
          interactive: {dailyCapUsd: policy.interactiveDailyCapUsd, dayCostUsd: round(a.interactive.cost)}, priorityCutoffs: {...RESIDENT_PRIORITY_CUTOFFS}}};
    }
    return {day, capUsd: this.opts.dailyCapUsd, spentUsd: round(b.spent), reservedUsd: round(b.reserved), liveCalls: b.calls, remainingUsd: round(Math.max(0, this.opts.dailyCapUsd - b.spent - b.reserved))};
  }

  quotaFor(session: string, tier: Tier) {
    const actionFilter = tier === 'judge' ? '' : " AND action != 'challenge'";
    const used = Number(this.sql.exec(`SELECT count(*) AS n FROM reservations WHERE session = ? AND created > ? AND (outcome IS NULL OR outcome != ?)${actionFilter}`, session, this.now() - HOUR, 'rejected').toArray()[0].n);
    return {perHour: HOURLY_LIMITS[tier], usedThisHour: used};
  }

  prune(olderThanMs = 3 * 24 * HOUR) {
    const now = this.now(), policy = this.residentPolicy();
    let cutoff = now - olderThanMs;
    // Retain the complete configured period even after end-stop. Pruning must not reset the hard cap.
    if (policy) cutoff = Math.min(cutoff, policy.periodStartAt, Math.floor((now + KST) / DAY) * DAY - KST, now - HOUR);
    this.sql.exec('DELETE FROM reservations WHERE created < ? AND settled IS NOT NULL', cutoff);
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
