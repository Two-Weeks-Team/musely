import {uiText} from './i18n.ts';
// C09 aggregation over an explicit sample. Missing evidence remains missing. worker/core/autonomy-oracle.ts recounts the
// same six measures on the server, written separately; scripts/run-log.test.mjs checks that the two agree.
export type AutoEvent = {id: string; kind: string; source: 'live' | 'rule' | 'scripted' | 'replay'; muse: string | null; other?: string | null; at: number; tags: string[]; data: any; runId?: string | null};
export type AutoScope = {label: string; day: string; worldId?: string | null; runId?: string | null; complete: boolean; partialReason?: string | null};
export type AutoRow = {key: 'starts' | 'interventions' | 'signatures' | 'models' | 'abilities' | 'blocks'; label: string; value: string; comparisonValue: string; sample: string; measured: boolean; note?: string};
/** C03 actor origins; an event without one is counted as unrecorded. */
export const ORIGINS = ['system', 'connected', 'trial'] as const;
export type AutoResult = {scope: AutoScope; period: string; eventCount: number; duplicates: number; sources: Record<'live' | 'rule' | 'scripted' | 'replay', number>; origins: Record<(typeof ORIGINS)[number] | 'unrecorded', number>; rows: AutoRow[]};

export function computeAutonomy(events: AutoEvent[], scope: AutoScope): AutoResult {
  // The first delivery of an event id is the record; a later copy is a duplicate.
  const seen = new Set<string>(), unique = events.filter(e => !seen.has(e.id) && !!seen.add(e.id));
  const sources = {live: 0, rule: 0, scripted: 0, replay: 0};
  const origins = {system: 0, connected: 0, trial: 0, unrecorded: 0};
  const originOf = (e: AutoEvent) => ((ORIGINS as readonly string[]).includes(e.data?.actorOrigin) ? e.data.actorOrigin as (typeof ORIGINS)[number] : 'unrecorded');
  for (const e of unique) { sources[e.source]++; origins[originOf(e)]++; }
  const ofKind = (kind: string) => unique.filter(e => e.kind === kind);
  // One encounter per encounterId (C09), whatever number of events carried it.
  const meetIds = new Set<string>(), meetings = ofKind('encounter').filter(e => { const k = String(e.data?.encounterId ?? 'event:' + e.id); return !meetIds.has(k) && !!meetIds.add(k); });
  const knownStarts = meetings.filter(e => typeof e.data?.initiatedByIntent === 'boolean');
  // Autonomous starts by who started them (C09): the rule engine's residents apart from connected Muses and visitors.
  const originText = [...ORIGINS.map(o => { const list = meetings.filter(e => e.data?.actorOrigin === o); return `${o}: ${list.length}${list.length ? uiText` (${list.filter(e => e.data?.initiatedByIntent === true).length} by intent)` : ''}`; }), ...(meetings.some(e => originOf(e) === 'unrecorded') ? [uiText`${meetings.filter(e => originOf(e) === 'unrecorded').length} without origin`] : [])].join(' · ');
  const approvals = ofKind('approval_requested');
  let passed = 0, refused = 0, missingChecks = 0;
  // A signature check with a verificationId counts once (C09), at its first event in log order; older checks have none
  // and count per event.
  const checkIds = new Set<string>(), once = (e: AutoEvent) => !e.data?.verificationId || (!checkIds.has(String(e.data.verificationId)) && !!checkIds.add(String(e.data.verificationId)));
  for (const e of unique) {
    if (e.kind === 'cards_verified' && once(e)) {
      for (const check of [e.data?.aVerifiesB, e.data?.bVerifiesA]) {
        if (check?.ok === true) passed++; else if (check?.ok === false) refused++; else missingChecks++;
      }
    }
    if (e.kind === 'a2a_verified' && once(e)) passed++;
    if ((e.kind === 'a2a_refused' || e.kind === 'impostor_rejected') && once(e)) refused++;
  }
  const live = new Set<string>(), replay = new Set<string>();
  let missingReplay = 0, missingLive = 0;
  for (const e of unique) {
    const ev = e.data?.evidence;
    if (e.source === 'live') { if (ev?.requestId) live.add(String(ev.requestId)); else if (e.kind === 'spotlight' || ev?.model || ev?.responseId) missingLive++; } // a model answer whose request id is missing
    if (e.source === 'replay') {
      // The Worker stores the whole recorded answer in replayOf; older data and fixtures may carry just its request id.
      const ref = ev?.replayOf, id = typeof ref === 'string' ? ref : ref?.requestId;
      if (id) replay.add(String(id)); else missingReplay++;
    }
  }
  // Live answers without any request id cannot be counted: that part is unknown, but replay and scenario counts stay.
  const liveUnknown = live.size === 0 && missingLive > 0, scenario = unique.filter(e => e.source === 'scripted' && e.kind === 'spotlight').length;
  // beforeHash/afterHash: the ability state (inventory and item clocks) of the event's Muses before and after its commit.
  const tagged = unique.filter(e => e.tags.includes('ability_change'));
  const hashed = tagged.filter(e => e.data?.beforeHash && e.data?.afterHash);
  const observations = tagged.length - hashed.length;
  const row = (key: AutoRow['key'], label: string, value: string, sample: string, measured = true, notes: string[] = [], comparisonValue=value): AutoRow => {
    const note = [...notes.filter(Boolean), ...(!scope.complete ? [uiText`Partial sample${scope.partialReason ? ': ' + scope.partialReason : ''}`] : [])].join(' · ');
    const hasSample = unique.length > 0 && measured;
    return {key, label, value: hasSample ? value : uiText('Not measured'), comparisonValue:hasSample?comparisonValue:'Not measured', sample, measured: hasSample, ...(note ? {note} : {})};
  };
  const rows: AutoRow[] = [
    row('starts', uiText('Autonomous starts'), `${meetings.length ? Math.round(knownStarts.filter(e => e.data.initiatedByIntent === true).length / meetings.length * 100) : 0}%`, uiText`n=${meetings.length} meetings`, knownStarts.length > 0, [
      knownStarts.length ? uiText`${meetings.length - knownStarts.length} meeting starts not recorded` : uiText('origin of each start is not recorded in this log'),
      meetings.some(e => originOf(e) !== 'unrecorded') ? originText : uiText('Actor origins not recorded'),
    ]),
    row('interventions', uiText('Owner interventions'), String(new Set(approvals.map(e => e.data?.requestId || e.id)).size), uiText`n=${approvals.length} events`, true, [uiText`${ofKind('meetup_candidate').length} meeting candidates (not counted as approval requests)`]),
    row('signatures', uiText('Signature checks'), uiText`${passed} passed · ${refused} refused`, uiText`n=${passed + refused} checks`, missingChecks === 0, [uiText('Check ids are not recorded; card directions and check events counted'), ...(missingChecks ? [uiText`${missingChecks} card check outcomes not recorded`] : [])], `${passed} passed · ${refused} refused`),
    row('models', uiText('Muse Spark calls'), uiText`${liveUnknown ? uiText('live not measured') : live.size + uiText(' live')} · ${replay.size} replay · ${scenario} scenario`, uiText`n=${live.size + replay.size} unique requests`, !liveUnknown || replay.size > 0 || scenario > 0, [...(missingLive ? [uiText`${missingLive} live model answers without request id (not counted)`] : []), ...(missingReplay ? [uiText`${missingReplay} replay events without original request id`] : [])], `${liveUnknown?'live not measured':live.size+' live'} · ${replay.size} replay · ${scenario} scenario`),
    row('abilities', uiText('Ability changes'), uiText`${hashed.filter(e => e.data.beforeHash !== e.data.afterHash).length} changes`, uiText`n=${tagged.length} events`, hashed.length > 0, observations || !hashed.length ? [uiText`${observations} tagged observations (before/after state not recorded)`] : [], `${hashed.filter(e => e.data.beforeHash !== e.data.afterHash).length} changes`),
    row('blocks', uiText('Blocks'), uiText`${ofKind('injection_blocked').length} instructions blocked · ${ofKind('decision_rejected').length} out-of-scope decisions refused`, uiText`n=${ofKind('injection_blocked').length + ofKind('decision_rejected').length} events`, true, [], `${ofKind('injection_blocked').length} instructions blocked · ${ofKind('decision_rejected').length} out-of-scope decisions refused`),
  ];
  const period = uiText`${scope.label} · ${scope.day} (Menlo Park world day) · ${unique.length} events · ${sources.live} live / ${sources.rule} rule / ${sources.scripted} scripted / ${sources.replay} replay · actors: ${origins.system} system / ${origins.connected} connected / ${origins.trial} trial${origins.unrecorded ? uiText` / ${origins.unrecorded} unrecorded` : ''} · worldId: ${scope.worldId || uiText('not recorded')} · runId: ${scope.runId || uiText('not recorded')}${!scope.complete ? uiText` · partial sample${scope.partialReason ? ': ' + scope.partialReason : ''}` : ''}`;
  return {scope: {...scope}, period, eventCount: unique.length, duplicates: events.length - unique.length, sources, origins, rows};
}
