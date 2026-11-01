// C09 aggregation over an explicit sample. Missing evidence remains missing.
export type AutoEvent = {id: string; kind: string; source: 'live' | 'rule' | 'scripted' | 'replay'; muse: string | null; other?: string | null; at: number; tags: string[]; data: any};
export type AutoScope = {label: string; day: string; worldId?: string | null; runId?: string | null; complete: boolean; partialReason?: string | null};
export type AutoRow = {key: 'starts' | 'interventions' | 'signatures' | 'models' | 'abilities' | 'blocks'; label: string; value: string; sample: string; measured: boolean; note?: string};
export type AutoResult = {scope: AutoScope; period: string; eventCount: number; duplicates: number; sources: Record<'live' | 'rule' | 'scripted' | 'replay', number>; rows: AutoRow[]};

export function computeAutonomy(events: AutoEvent[], scope: AutoScope): AutoResult {
  const unique = [...new Map(events.map(e => [e.id, e])).values()];
  const sources = {live: 0, rule: 0, scripted: 0, replay: 0};
  for (const e of unique) sources[e.source]++;
  const ofKind = (kind: string) => unique.filter(e => e.kind === kind);
  const meetings = ofKind('encounter');
  const knownStarts = meetings.filter(e => typeof e.data?.initiatedByIntent === 'boolean');
  const origins = ['muse', 'person'].map(origin => `${origin}: ${meetings.filter(e => e.data?.actorOrigin === origin).length}`).join(' · ');
  const approvals = ofKind('approval_requested');
  let passed = 0, refused = 0, missingChecks = 0;
  for (const e of ofKind('cards_verified')) {
    for (const check of [e.data?.aVerifiesB, e.data?.bVerifiesA]) {
      if (check?.ok === true) passed++; else if (check?.ok === false) refused++; else missingChecks++;
    }
  }
  passed += ofKind('a2a_verified').length;
  refused += ofKind('a2a_refused').length + ofKind('impostor_rejected').length;
  const live = new Set<string>(), replay = new Set<string>();
  let missingReplay = 0, missingLive = 0;
  for (const e of unique) {
    const ev = e.data?.evidence;
    if (e.source === 'live') { if (ev?.requestId) live.add(String(ev.requestId)); else if (e.kind === 'spotlight') missingLive++; }
    if (e.source === 'replay') {
      // The Worker stores the whole recorded answer in replayOf; older data and fixtures may carry just its request id.
      const ref = ev?.replayOf, id = typeof ref === 'string' ? ref : ref?.requestId;
      if (id) replay.add(String(id)); else missingReplay++;
    }
  }
  const tagged = unique.filter(e => e.tags.includes('ability_change'));
  const hashed = tagged.filter(e => e.data?.beforeHash && e.data?.afterHash);
  const observations = tagged.length - hashed.length;
  const row = (key: AutoRow['key'], label: string, value: string, sample: string, measured = true, notes: string[] = []): AutoRow => {
    const note = [...notes.filter(Boolean), ...(!scope.complete ? [`Partial sample${scope.partialReason ? ': ' + scope.partialReason : ''}`] : [])].join(' · ');
    const hasSample = unique.length > 0 && measured;
    return {key, label, value: hasSample ? value : 'Not measured', sample, measured: hasSample, ...(note ? {note} : {})};
  };
  const rows: AutoRow[] = [
    row('starts', 'Autonomous starts', `${meetings.length ? Math.round(knownStarts.filter(e => e.data.initiatedByIntent === true).length / meetings.length * 100) : 0}%`, `n=${meetings.length} meetings`, knownStarts.length > 0, [
      knownStarts.length ? `${meetings.length - knownStarts.length} meeting starts not recorded` : 'origin of each start is not recorded in this log',
      meetings.some(e => e.data?.actorOrigin) ? origins : 'Actor origins not recorded',
    ]),
    row('interventions', 'Owner interventions', String(new Set(approvals.map(e => e.data?.requestId || e.id)).size), `n=${approvals.length} events`, true, [`${ofKind('meetup_candidate').length} meeting candidates (not counted as approval requests)`]),
    row('signatures', 'Signature checks', `${passed} passed · ${refused} refused`, `n=${passed + refused} checks`, missingChecks === 0, ['Check ids are not recorded; card directions and check events counted', ...(missingChecks ? [`${missingChecks} card check outcomes not recorded`] : [])]),
    row('models', 'Muse Spark calls', `${live.size} live · ${replay.size} replay · ${unique.filter(e => e.source === 'scripted' && e.kind === 'spotlight').length} scenario`, `n=${live.size + replay.size} unique requests`, !(live.size === 0 && missingLive > 0), [...(missingLive ? [`${missingLive} live model answers without request id (not counted)`] : []), ...(missingReplay ? [`${missingReplay} replay events without original request id`] : [])]),
    row('abilities', 'Ability changes', `${hashed.filter(e => e.data.beforeHash !== e.data.afterHash).length} changes`, `n=${tagged.length} events`, hashed.length > 0, observations || !hashed.length ? [`${observations} tagged observations (before/after state not recorded)`] : []),
    row('blocks', 'Blocks', `${ofKind('injection_blocked').length} instructions blocked · ${ofKind('decision_rejected').length} out-of-scope decisions refused`, `n=${ofKind('injection_blocked').length + ofKind('decision_rejected').length} events`),
  ];
  const period = `${scope.label} · ${scope.day} (Menlo Park day) · ${unique.length} events · ${sources.live} live / ${sources.rule} rule / ${sources.scripted} scripted / ${sources.replay} replay · worldId: ${scope.worldId || 'not recorded'} · runId: ${scope.runId || 'not recorded'}${!scope.complete ? ` · partial sample${scope.partialReason ? ': ' + scope.partialReason : ''}` : ''}`;
  return {scope: {...scope}, period, eventCount: unique.length, duplicates: events.length - unique.length, sources, rows};
}
