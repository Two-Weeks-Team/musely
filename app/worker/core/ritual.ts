// Welcome ritual (direction v2, 6.4): the server chooses three random actions for a session; the browser sends
// three webcam frames; Muse Spark judges each step. Steps are single-use and expire in three minutes, so a
// prepared video cannot know them in advance. Frames are never stored: only per-step verdicts and the request id.
// The goal is "costlier for a bot than for a person", not "impossible for a bot".
import type {Sql} from './ledger.ts';
import {CHALLENGE_STEPS, type ChallengeStep} from './actions.ts';

export const RITUAL_TTL_MS = 3 * 60_000;
export type RitualVerdict = {step: string; passed: boolean; confidence: number};
export type RitualRecord = {at: number; passed: boolean; results: RitualVerdict[]; requestId: string | null; model: string | null; tier: string};

export class RitualStore {
  private sql: Sql;
  constructor(sql: Sql) { this.sql = sql; }
  init() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS rituals (id TEXT PRIMARY KEY, session TEXT NOT NULL, steps TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS ritual_record (id INTEGER PRIMARY KEY CHECK (id = 1), record TEXT NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS rituals_expires ON rituals (expires)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS rituals_session ON rituals (session, used, expires)');
  }
  /** At most this many open (unused, unexpired) rituals per session; starting more is refused. */
  static MAX_OPEN = 2;
  start(session: string, now = Date.now(), rand: () => number = Math.random) {
    this.sql.exec('DELETE FROM rituals WHERE expires < ?', now - RITUAL_TTL_MS);
    const open = Number(this.sql.exec('SELECT count(*) AS n FROM rituals WHERE session = ? AND used = 0 AND expires >= ?', session, now).toArray()[0].n);
    if (open >= RitualStore.MAX_OPEN) return null;
    const pool = Object.keys(CHALLENGE_STEPS) as ChallengeStep[];
    const steps: ChallengeStep[] = [];
    while (steps.length < 3) { const s = pool[Math.floor(rand() * pool.length)]; if (!steps.includes(s)) steps.push(s); }
    const id = crypto.randomUUID();
    this.sql.exec('INSERT INTO rituals (id, session, steps, expires) VALUES (?, ?, ?, ?)', id, session, JSON.stringify(steps), now + RITUAL_TTL_MS);
    return {id, steps: steps.map(s => ({id: s, text: CHALLENGE_STEPS[s]})), expiresAt: now + RITUAL_TTL_MS};
  }
  /** Returns the server-chosen steps once, for the session that started the ritual, before it expires. */
  take(id: string, session: string, now = Date.now()): ChallengeStep[] | null {
    const r = this.sql.exec('SELECT steps, expires, used FROM rituals WHERE id = ? AND session = ?', String(id), session).toArray()[0];
    if (!r || Number(r.used) || Number(r.expires) < now) return null;
    this.sql.exec('UPDATE rituals SET used = 1 WHERE id = ?', String(id));
    return JSON.parse(String(r.steps));
  }
  /** The owner's recorded ritual (judge-link run) is kept as the default replay; it never authenticates anyone else. */
  saveOwnerRecord(rec: RitualRecord) { this.sql.exec('INSERT OR REPLACE INTO ritual_record (id, record) VALUES (1, ?)', JSON.stringify(rec)); }
  ownerRecord(): RitualRecord | null { const r = this.sql.exec('SELECT record FROM ritual_record WHERE id = 1').toArray()[0]; return r ? JSON.parse(String(r.record)) : null; }
}
