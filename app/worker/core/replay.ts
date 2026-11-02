// Fallback when a live call is not possible (direction v2, 15): play back a recorded real response.
// Replay is a read-only projection: it never calls the model, grants rewards or changes live state.
// If no recording exists for an action, a clearly labelled scripted answer is returned instead.
import library from '../../fixtures/replay-library.json' with {type: 'json'};
import {harnessById, type Harness} from '../../src/engine/harness.ts';
import type {Action, ActionInput} from './actions.ts';

export type ReplayEntry = {action: Action; muse: string | null; recordedAt: string; model: string; requestId: string | null; responseId: string | null; output: unknown};
const ENTRIES = (library as {entries: ReplayEntry[]}).entries;

export function replayFor(action: Action, input: ActionInput): {source: 'replay' | 'scripted'; output: unknown; recorded: Omit<ReplayEntry, 'output'> | null} {
  const museId = typeof (input as any).muse === 'string' ? (input as any).muse : null;
  const candidates = ENTRIES.filter(e => e.action === action);
  const pick = candidates.find(e => e.muse === museId) ?? candidates[0];
  if (pick) {
    const {output, ...recorded} = pick;
    return {source: 'replay', output, recorded};
  }
  return {source: 'scripted', output: scripted(action, input), recorded: null};
}

function scripted(action: Action, input: ActionInput): unknown {
  const i = input as any, h: Harness | null = i.muse ? harnessById(i.muse) : null;
  switch (action) {
    case 'spotlight': return {freedom: i.freedom, decision: 'stay and look around', target_place: i.place, target_agent: '', offer_item: '', want_item: '', public_reason: 'Scripted fallback: no live decision was made.', line: `${h?.name ?? 'Muse'} takes a quiet look around.`};
    case 'encounter': return {intent: 'greet', item: '', line: 'Hello, neighbor.', public_reason: 'Scripted fallback.', injection_suspected: false};
    case 'trade': return {decision: 'reject', counter_give: '', counter_want: '', line: 'Not today, thank you.'};
    case 'negotiate': return {candidates: []};
    case 'challenge': return {results: []};
  }
}
