// Server-side recount of the six autonomy measures (direction v2, 2.2; contract C09), written apart from the panel's
// src/ui/autonomy.ts so the two can check each other (scripts/run-log.test.mjs compares them on the same events).
// Pure: no I/O. Counts are numbers; `values()` renders them in the panel's words for the comparison.
// - One sample: the events of one world over one period (and run, when given). Each event id counts once (the first
//   delivery); an encounter counts once per encounterId, a signature check once per verificationId (when recorded).
// - A measure with no denominator, or whose evidence is not recorded, is unmeasured (null), never zero.
// - Model calls are unique request ids, live and replay apart; events without a model call are not model calls.
// - Every count is also split by source (live / rule / scripted / replay) and by actorOrigin (system / connected / trial).
import {ACTOR_ORIGINS, type ActorOrigin} from './run-log.ts';

export type OracleEvent = {id: string; kind: string; source: string; at: number; tags: string[]; data?: Record<string, any> | null; muse?: string | null; runId?: string | null};
export type OracleScope = {worldId: string | null; runIds: string[]; from: number | null; to: number | null; day: string | null; complete: boolean; partialReason?: string | null};
type Sources = Record<'live' | 'rule' | 'scripted' | 'replay', number>;
type Origins = Record<ActorOrigin | 'unrecorded', number>;
const SOURCES = ['live', 'rule', 'scripted', 'replay'] as const;
const zeroSources = (): Sources => ({live: 0, rule: 0, scripted: 0, replay: 0});
const zeroOrigins = (): Origins => ({system: 0, connected: 0, trial: 0, unrecorded: 0});
const originOf = (e: OracleEvent): ActorOrigin | 'unrecorded' => (ACTOR_ORIGINS as readonly string[]).includes(e.data?.actorOrigin) ? e.data!.actorOrigin : 'unrecorded';

export type OracleResult = {
  scope: OracleScope;
  sample: {received: number; events: number; duplicateIds: number; duplicateEncounters: number; duplicateVerifications: number; firstAt: number | null; lastAt: number | null};
  sources: Sources; origins: Origins;
  starts: {meetings: number; recorded: number; byIntent: number; ratePct: number | null; bySource: Sources; byOrigin: Record<ActorOrigin | 'unrecorded', {meetings: number; byIntent: number; ratePct: number | null}>};
  interventions: {requests: number; events: number; candidates: number};
  signatures: {passed: number; refused: number; unrecorded: number; measured: boolean};
  models: {live: number | null; replay: number; scenario: number; liveWithoutId: number; replayWithoutId: number; measured: boolean};
  abilities: {tagged: number; hashed: number; changes: number | null};
  blocks: {injections: number; outOfScope: number};
};

export function recountAutonomy(input: readonly OracleEvent[], scope: OracleScope): OracleResult {
  // 1. Each event id once: the first delivery is the record (the log is append-only).
  const ids = new Set<string>(), events: OracleEvent[] = [];
  for (const e of input) if (!ids.has(e.id)) { ids.add(e.id); events.push(e); }
  const sources = zeroSources(), origins = zeroOrigins();
  for (const e of events) { if ((SOURCES as readonly string[]).includes(e.source)) sources[e.source as keyof Sources] += 1; origins[originOf(e)] += 1; }
  const byKind = (k: string) => events.filter(e => e.kind === k);

  // 2. Encounters: once per encounterId (C09: one per sorted pair + meeting).
  const seenMeet = new Set<string>(), meetings: OracleEvent[] = [];
  for (const e of byKind('encounter')) { const key = String(e.data?.encounterId ?? 'event:' + e.id); if (!seenMeet.has(key)) { seenMeet.add(key); meetings.push(e); } }
  const rate = (n: number, d: number) => (d ? Math.round(n / d * 100) : null);
  const recorded = meetings.filter(e => typeof e.data?.initiatedByIntent === 'boolean'), byIntent = meetings.filter(e => e.data?.initiatedByIntent === true).length;
  const bySource = zeroSources(); for (const e of meetings) if ((SOURCES as readonly string[]).includes(e.source)) bySource[e.source as keyof Sources] += 1;
  const byOrigin = Object.fromEntries((['system', 'connected', 'trial', 'unrecorded'] as const).map(o => {
    const list = meetings.filter(e => originOf(e) === o), yes = list.filter(e => e.data?.initiatedByIntent === true).length;
    return [o, {meetings: list.length, byIntent: yes, ratePct: list.some(e => typeof e.data?.initiatedByIntent === 'boolean') ? rate(yes, list.length) : null}];
  })) as OracleResult['starts']['byOrigin'];

  // 3. Owner interventions: unique approval request ids; meeting candidates are not a second request.
  const approvals = byKind('approval_requested');
  const requests = new Set(approvals.map(e => String(e.data?.requestId || 'event:' + e.id))).size;

  // 4. Signature checks: both card directions, each verification id once.
  const seenCheck = new Set<string>(); let passed = 0, refusedN = 0, unrecorded = 0, dupChecks = 0;
  const once = (e: OracleEvent) => { const v = e.data?.verificationId; if (!v) return true; if (seenCheck.has(String(v))) { dupChecks++; return false; } seenCheck.add(String(v)); return true; };
  for (const e of events) {
    if (e.kind === 'cards_verified' && once(e)) for (const d of [e.data?.aVerifiesB, e.data?.bVerifiesA]) { if (d?.ok === true) passed++; else if (d?.ok === false) refusedN++; else unrecorded++; }
    if (e.kind === 'a2a_verified' && once(e)) passed++;
    if ((e.kind === 'a2a_refused' || e.kind === 'impostor_rejected') && once(e)) refusedN++;
  }

  // 5. Model calls: unique request ids. A live model answer without an id is unknown, not zero.
  const live = new Set<string>(), replay = new Set<string>(); let liveWithoutId = 0, replayWithoutId = 0, scenario = 0;
  for (const e of events) {
    const ev = e.data?.evidence;
    if (e.source === 'live') {
      if (ev?.requestId) live.add(String(ev.requestId));
      else if (e.kind === 'spotlight' || ev?.model || ev?.responseId) liveWithoutId++;
    } else if (e.source === 'replay') {
      const r = ev?.replayOf, id = typeof r === 'string' ? r : r?.requestId;
      if (id) replay.add(String(id)); else replayWithoutId++;
    } else if (e.source === 'scripted' && e.kind === 'spotlight') scenario++;
  }
  const liveCount = !live.size && liveWithoutId ? null : live.size;

  // 6. Ability changes: tagged events whose state hash differs before and after.
  const tagged = events.filter(e => e.tags.includes('ability_change')), hashed = tagged.filter(e => e.data?.beforeHash && e.data?.afterHash);

  const ats = events.map(e => e.at);
  return {
    scope: {...scope, runIds: [...scope.runIds]},
    sample: {received: input.length, events: events.length, duplicateIds: input.length - events.length, duplicateEncounters: byKind('encounter').length - meetings.length, duplicateVerifications: dupChecks, firstAt: ats.length ? Math.min(...ats) : null, lastAt: ats.length ? Math.max(...ats) : null},
    sources, origins,
    starts: {meetings: meetings.length, recorded: recorded.length, byIntent, ratePct: recorded.length ? rate(byIntent, meetings.length) : null, bySource, byOrigin},
    interventions: {requests, events: approvals.length, candidates: byKind('meetup_candidate').length},
    signatures: {passed, refused: refusedN, unrecorded, measured: unrecorded === 0},
    models: {live: liveCount, replay: replay.size, scenario, liveWithoutId, replayWithoutId, measured: liveCount !== null || replay.size > 0 || scenario > 0},
    abilities: {tagged: tagged.length, hashed: hashed.length, changes: hashed.length ? hashed.filter(e => e.data!.beforeHash !== e.data!.afterHash).length : null},
    blocks: {injections: byKind('injection_blocked').length, outOfScope: byKind('decision_rejected').length},
  };
}

/** The six values in the panel's words ('Not measured' when there is no sample or no evidence), keyed like its rows. */
export function values(r: OracleResult): Record<'starts' | 'interventions' | 'signatures' | 'models' | 'abilities' | 'blocks', {value: string; measured: boolean}> {
  const any = r.sample.events > 0;
  const v = (measured: boolean, text: string) => ({value: any && measured ? text : 'Not measured', measured: any && measured});
  return {
    starts: v(r.starts.ratePct !== null, `${r.starts.ratePct}%`),
    interventions: v(true, String(r.interventions.requests)),
    signatures: v(r.signatures.measured, `${r.signatures.passed} passed · ${r.signatures.refused} refused`),
    models: v(r.models.measured, `${r.models.live === null ? 'live not measured' : r.models.live + ' live'} · ${r.models.replay} replay · ${r.models.scenario} scenario`),
    abilities: v(r.abilities.changes !== null, `${r.abilities.changes} changes`),
    blocks: v(true, `${r.blocks.injections} instructions blocked · ${r.blocks.outOfScope} out-of-scope decisions refused`),
  };
}
