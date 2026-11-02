// Source badge and model-call note for one world event (direction v2, 8.6 source labels). Kept apart from the panel
// so the wording can be tested without a DOM.
type LabelEv = {kind: string; source: 'live' | 'rule' | 'scripted' | 'replay'; data: any};

export function sourceLabel(e: Pick<LabelEv, 'source' | 'data'> & {kind?: string}): {text: string; cls: string} {
  if (e.source === 'live' && e.data?.actor === 'your Muse') return {text: 'LIVE · your Muse', cls: 'src-live'};
  if (e.source === 'live' && e.data?.evidence?.requestId) return {text: 'LIVE · Muse Spark', cls: 'src-live'};
  if (e.source === 'live' && e.data?.actorOrigin === 'connected') return {text: 'LIVE · your Muse · connected', cls: 'src-live'};
  // A visitor's own request (a spotlight turn). A check a visitor's button started (P0, impostor, injection) is a verification.
  if (e.source === 'live' && e.data?.actorOrigin === 'trial' && e.kind === 'spotlight_requested') return {text: 'LIVE · visitor', cls: 'src-live'};
  if (e.source === 'live') return {text: 'LIVE · verified', cls: 'src-live'};
  if (e.source === 'replay') return {text: 'REPLAY', cls: 'src-replay'};
  if (e.source === 'rule') return {text: 'RULE', cls: 'src-rule'};
  return {text: 'SCRIPTED', cls: 'src-scripted'};
}

/** What to say about the model call behind an event that carries no request id: not applicable, or evidence that is missing. */
export function modelNote(e: LabelEv): string {
  if (e.kind === 'spotlight' && (e.source === 'live' || e.source === 'replay')) return e.source === 'replay' ? 'Missing evidence — this replayed answer has no original request id recorded' : 'Missing evidence — no request id was recorded for this model answer';
  if (e.source === 'scripted') return 'Not applicable — scripted, no model call';
  if (e.source === 'rule') return 'Not applicable — rule, no model call';
  if (e.data?.actorOrigin === 'connected') return "Not applicable — your connected Muse's own request, no model call";
  if (e.data?.actorOrigin === 'trial' && e.kind === 'spotlight_requested') return 'Not applicable — a visitor request, no model call';
  return 'Not applicable — verification only, no model call';
}
