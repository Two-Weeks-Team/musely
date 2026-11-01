// State previews for identity, rewards, meet-ups and owner intervention (P-03; direction v2 chapters 6, 9, 12, 14;
// contracts C02/C04/C06/C07). Scenes come from preview/fixtures/preview-flows.json and run only in this module:
// no /api calls, no signatures, no claims. Each owner's private reasons are shown only when viewing as that owner,
// never in the other side's bubble.
import data from '../../fixtures/preview-flows.json';
import {ITEMS} from '../engine/items';
import {HARNESSES} from '../engine/harness';

type Side = {bubble?: string; private?: string};
type Step = {
  id: string; title: string; text: string;
  status?: Record<string, string>;
  a?: Side; b?: Side;
  inventory?: {a?: string[]; b?: string[]};
  metrics?: [string, string, string][];
  checks?: string[];
  ownerInbox?: {owner: 'a' | 'b'; kind: string; text: string}[];
  next?: string; choices?: {label: string; goto: string}[];
  /** What the item change looks like on the commons character (P-05): clip, prop item and bubble. */
  scene?: {side: 'a' | 'b'; clip?: string; item?: string; line?: string}[];
};
type Party = {muse: string; name: string; owner: string};
export type Scenario = {id: string; short: string; experience: string; title: string; summary: string; a: Party; b?: Party; start: string; steps: Step[]};
export type ViewAs = 'public' | 'a' | 'b';

export const FLOWS = data as {label: string; scenarios: Scenario[]};
const itemName = (id: string) => ITEMS.find(i => i.id === id)?.name ?? id;
const harnessName = (id: string) => HARNESSES.find(h => h.id === id)?.name ?? id;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const button = (text: string, cls: string, onClick: () => void) => { const b = el('button', cls, text); b.type = 'button'; b.onclick = onClick; return b; };

function cueText(r: CueResult) {
  if (!r.shown) return r.reason === 'not_in_commons' ? 'Fallback: this Muse does not live in the commons scene, so the change is shown on this card only.' : r.reason === 'characters_loading' ? 'The commons characters are still loading. Try again in a moment.' : 'The 3D scene is not available here.';
  return r.results.map(x => `${harnessName(x.variant)}: ${x.shown ? (x.visual === 'complete' ? (x.prop ? `clip with its 3D ${x.prop}` : 'clip, item shown as a card') : x.reason === 'prop_unavailable' ? 'clip plays, its 3D prop is not available here · item card shown' : 'fallback item card shown') : 'not in the commons (card only)'}`).join(' · ') + '. The world is paused while it plays.';
}

/** Inventories carried forward: a step without an inventory shows the latest one before it on the visited path. */
function inventoryAt(path: Step[]) {
  const inv: {a?: string[]; b?: string[]} = {};
  for (const s of path) { if (s.inventory?.a) inv.a = s.inventory.a; if (s.inventory?.b) inv.b = s.inventory.b; }
  return inv;
}

type CueEntry = {variant: string; clip?: string | null; item?: string | null; line?: string | null; label: string};
type CueResult = {shown: boolean; reason?: string; results: {variant: string; shown: boolean; visual: string; prop?: string | null; reason?: string}[]};
let cue: ((entries: CueEntry[]) => CueResult) | null = null;
/** main.ts hands over the commons cue player; without it (tests, no 3D) the On screen box still describes the change. */
export function setFlowCue(fn: (entries: CueEntry[]) => CueResult) { cue = fn; }
export let lastCue: CueResult | null = null;

export const flowState = {scenario: FLOWS.scenarios[0].id, path: [FLOWS.scenarios[0].start] as string[], viewAs: 'public' as ViewAs};

export function renderFlows(body: HTMLElement) {
  const draw = () => renderFlows(body);
  const sc = FLOWS.scenarios.find(s => s.id === flowState.scenario) ?? FLOWS.scenarios[0];
  const steps = flowState.path.map(id => sc.steps.find(s => s.id === id)!).filter(Boolean);
  const step = steps[steps.length - 1];
  body.replaceChildren();
  body.append(el('p', 'muted', 'Every state, stepped through by hand: identity, rewards, meet-ups and owner choices. ' + FLOWS.label));
  const bar = el('div', 'filter flow-list');
  for (const s of FLOWS.scenarios) {
    const b = button(s.short, 'tag' + (s.id === sc.id ? ' on' : ''), () => { flowState.scenario = s.id; flowState.path = [s.start]; flowState.viewAs = 'public'; draw(); });
    b.dataset.flow = s.id; b.title = s.title; bar.append(b);
  }
  body.append(bar);

  const card = el('div', 'id-card flow-card'); card.dataset.flow = sc.id; card.dataset.step = step.id;
  card.append(el('span', 'src src-scripted', 'SCRIPTED · PREVIEW FIXTURE'), el('span', 'eyebrow flow-exp', ' ' + sc.experience), el('h4', '', sc.title), el('p', 'muted', sc.summary));
  const view = el('div', 'flow-viewas'); view.append(el('span', 'eyebrow', 'VIEW AS'));
  const viewers: [ViewAs, string][] = [['public', 'Public'], ['a', sc.a.owner.replace(/ \(.*\)$/, '')], ...(sc.b ? [['b', sc.b.owner.replace(/ \(.*\)$/, '')] as [ViewAs, string]] : [])];
  for (const [v, label] of viewers) { const b = button(label, 'tag' + (flowState.viewAs === v ? ' on' : ''), () => { flowState.viewAs = v; draw(); }); b.dataset.viewas = v; view.append(b); }
  card.append(view);

  card.append(el('p', 'flow-path', `Step ${steps.length} · ` + steps.map(s => s.title).join(' → ')));
  card.append(el('h5', 'flow-step-title', step.title), el('p', 'flow-text', step.text));
  if (step.status) { const chips = el('div', 'flow-status'); for (const [k, v] of Object.entries(step.status)) { const c = el('span', 'tag flow-chip', `${k}: ${v}`); c.dataset.key = k; c.dataset.value = v; chips.append(c); } card.append(chips); }

  const sides = el('div', 'flow-sides');
  const inv = inventoryAt(steps);
  for (const key of ['a', 'b'] as const) {
    const party = sc[key]; if (!party) continue;
    const side = step[key] ?? {};
    const col = el('div', 'flow-side'); col.dataset.side = key;
    col.append(el('b', '', party.name), el('small', '', `${harnessName(party.muse)} · ${party.owner}`));
    if (side.bubble) col.append(el('p', 'flow-bubble', side.bubble));
    // Private conditions stay on their owner's device: shown only when viewing as that owner, never on the other side.
    if (side.private && flowState.viewAs === key) { const p = el('p', 'flow-private'); p.append(el('span', 'eyebrow', `PRIVATE · ONLY ON ${party.owner.replace(/ \(.*\)$/, '').toUpperCase()}'S DEVICE`), el('span', '', side.private)); col.append(p); }
    if (inv[key]) { const ul = el('ul', 'flow-inv'); for (const i of inv[key]!) ul.append(el('li', '', itemName(i))); col.append(el('span', 'eyebrow', 'INVENTORY'), ul); }
    sides.append(col);
  }
  card.append(sides);
  if (step.checks) { const ul = el('ul', 'flow-checks'); for (const c of step.checks) ul.append(el('li', c.includes('✕') ? 'fail' : '', c)); card.append(el('span', 'eyebrow', 'CHECKS BEFORE ANY CHANGE'), ul); }
  if (step.metrics) {
    const t = el('table', 'data'); const head = el('tr'); for (const h of ['', 'before', 'after']) head.append(el('th', '', h)); t.append(head);
    for (const [k, b, a] of step.metrics) { const tr = el('tr', a ? 'after' : ''); for (const c of [k, b, a || '—']) tr.append(el('td', '', c)); t.append(tr); }
    card.append(t);
  }
  if (step.ownerInbox) {
    const box = el('div', 'flow-inbox'); box.append(el('span', 'eyebrow', 'OWNER INBOX · CANDIDATE / TRADE DONE / BLOCKED ONLY'));
    for (const n of step.ownerInbox) {
      const party = sc[n.owner]; if (!party) continue;
      if (flowState.viewAs !== 'public' && flowState.viewAs !== n.owner) continue;
      box.append(el('p', 'flow-note', `${party.owner.replace(/ \(.*\)$/, '')} · ${n.kind.replace(/_/g, ' ')}: ${n.text}`));
    }
    if (box.childElementCount === 1) box.append(el('p', 'flow-note muted', 'Nothing for this viewer.'));
    card.append(box);
  }
  if (step.scene?.length) {
    const box = el('div', 'flow-scene'); box.append(el('span', 'eyebrow', 'ON SCREEN · IN THE COMMONS'));
    const entries: CueEntry[] = step.scene.map(sc0 => ({variant: sc[sc0.side]!.muse, clip: sc0.clip ?? null, item: sc0.item ?? null, line: sc0.line ?? null, label: sc[sc0.side]!.name}));
    for (const e of entries) box.append(el('p', 'flow-note', `${harnessName(e.variant)} ${e.clip ? `plays ${e.clip.replace(/_/g, ' ')}` : 'has no clip for this'}${e.item ? ` with ${itemName(e.item)}` : ''}${e.line ? ` · “${e.line}”` : ''}`));
    const result = el('p', 'flow-note muted flow-cue-result');
    if (lastCue && (lastCue as any).step === `${sc.id}/${step.id}`) result.textContent = cueText(lastCue);
    const show = button('Show in the commons', 'secondary', () => { lastCue = cue ? cue(entries) : {shown: false, reason: 'no_scene', results: []}; (lastCue as any).step = `${sc.id}/${step.id}`; result.textContent = cueText(lastCue); });
    show.classList.add('flow-show');
    box.append(show, result); card.append(box);
  }
  const controls = el('div', 'id-actions flow-controls');
  if (steps.length > 1) controls.append(button('← Back', 'secondary', () => { flowState.path.pop(); draw(); }));
  if (step.choices) for (const c of step.choices) { const b = button(c.label, 'primary', () => { flowState.path.push(c.goto); draw(); }); b.dataset.goto = c.goto; controls.append(b); }
  else if (step.next) { const b = button('Next →', 'primary', () => { flowState.path.push(step.next!); draw(); }); b.dataset.goto = step.next; controls.append(b); }
  controls.append(button('Restart', 'secondary', () => { flowState.path = [sc.start]; draw(); }));
  card.append(controls);
  body.append(card);
}
