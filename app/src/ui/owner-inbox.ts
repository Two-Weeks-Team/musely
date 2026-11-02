// Owner inbox (contract C06, direction v2 12.3; I-07). Separate from the Muse's agent inbox (heartbeat_check): it shows
// only the meetups waiting for this owner's decision, the recent decisions and the three owner notification kinds
// (meetup candidate, completed trade, blocked attempt), for the owner session's own Muse.
//  - Private conditions (times the owner cannot make, places to skip) are typed here and evaluated here, against the
//    candidates the server built from public information. They stay on this device (localStorage) and are never part
//    of any request: a decision sends only {taskId, revision, contentHash, decision, candidate?} (approvalBody).
//  - A decline has no reason field. The server refuses any field it does not know.
//  - Everything is built with textContent; nothing from the server is parsed as HTML.
// The functions above ownerInboxCard need no DOM, so scripts/tasks.test.mjs runs them directly.
import {harnessById} from '../engine/harness.ts';
import {PLACES} from '../engine/places.ts';

export type Candidate = {id: string; time: string; place: string; place_id: string | null; public_basis: string};
type Side = {decision: 'approve' | 'reject'; candidate: string | null; source: 'owner' | 'rule'; at: number; approval_ref: string} | null;
export type OwnerTask = {task_id: string; kind: string; muse: string; other: string; other_side: string | null; status: string; stage: string; revision: number; content_hash: string; deadline: number; deadline_iso: string; candidates: Candidate[]; yours: Side; theirs: Side; confirmed: {candidate: string; at: number} | null};
type Notification = {id: string; kind: 'meetup_candidate' | 'trade_completed' | 'blocked'; at: number; line: string; muse: string; other: string | null};
type InboxAnswer = {owner: {label: string; demo: boolean}; demo_limits: string | null; approvals: OwnerTask[]; recent: OwnerTask[]; notifications: Notification[]; approval_window_min: number};

// ---------- private conditions: this device only ----------
export type Window = {from: number; to: number};
export type PrivateConditions = {busy: Window[]; avoid: string[]};
export const PRIVATE_STORE_KEY = 'musely.owner.private-conditions';
const minutes = (hhmm: string) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** "17:00-19:00, 21:30-22:00" → windows in minutes of the day; parts that do not read as HH:MM-HH:MM are dropped. */
export function parseBusy(text: string): Window[] {
  return text.split(/[,;\n]/).map(part => part.split('-')).flatMap(([a, b]) => {
    const from = a === undefined ? null : minutes(a), to = b === undefined ? null : minutes(b);
    return from === null || to === null || from === to ? [] : [{from, to}];
  });
}
const inWindow = (t: number, w: Window) => (w.from < w.to ? t >= w.from && t < w.to : t >= w.from || t < w.to);
export type Verdict = {id: string; fits: boolean; clash: 'busy' | 'place' | null};
/** The owner's private conditions against the public candidates, in this browser. The result is shown, never sent. */
export function evaluateCandidates(cands: readonly Candidate[], cond: PrivateConditions): Verdict[] {
  return cands.map(c => {
    const t = minutes(c.time);
    const clash = t !== null && cond.busy.some(w => inWindow(t, w)) ? 'busy' : c.place_id && cond.avoid.includes(c.place_id) ? 'place' : null;
    return {id: c.id, fits: clash === null, clash};
  });
}
/** The first candidate that fits, else the one the other owner already chose, else the first. */
export function suggestCandidate(t: Pick<OwnerTask, 'candidates' | 'theirs'>, verdicts: readonly Verdict[]) {
  if (t.theirs?.decision === 'approve' && t.theirs.candidate) return t.theirs.candidate;
  return verdicts.find(v => v.fits)?.id ?? t.candidates[0]?.id ?? null;
}

/** The only body a decision sends: the Task, the exact revision and hash it was made on, approve|reject, the chosen candidate. */
export function approvalBody(t: Pick<OwnerTask, 'task_id' | 'revision' | 'content_hash'>, decision: 'approve' | 'reject', candidate?: string | null) {
  return {taskId: t.task_id, revision: t.revision, contentHash: t.content_hash, decision, ...(decision === 'approve' && candidate ? {candidate} : {})};
}
export type FetchLike = (url: string, init: {method: string; cache?: 'no-store'; headers?: Record<string, string>; body?: string}) => Promise<{ok: boolean; status: number; json(): Promise<unknown>}>;
async function call(f: FetchLike, method: string, path: string, body?: unknown): Promise<{ok: boolean; status: number; data: any}> {
  try {
    const r = await f(path, {method, cache: 'no-store', headers: body === undefined ? {} : {'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {ok: r.ok, status: r.status, data: await r.json().catch(() => null)};
  } catch {
    return {ok: false, status: 0, data: {error: 'network'}};
  }
}
/** Sends one decision. Private conditions are not a parameter: they cannot be sent. */
export const submitDecision = (f: FetchLike, t: OwnerTask, decision: 'approve' | 'reject', candidate?: string | null) => call(f, 'POST', '/api/owner/approvals', approvalBody(t, decision, candidate));
export const loadOwnerInbox = (f: FetchLike) => call(f, 'GET', '/api/owner/inbox');

export function loadConditions(store: Pick<Storage, 'getItem'> | null): PrivateConditions {
  try {
    const v = JSON.parse(store?.getItem(PRIVATE_STORE_KEY) ?? 'null');
    return {busy: Array.isArray(v?.busy) ? v.busy.filter((w: any) => Number.isInteger(w?.from) && Number.isInteger(w?.to)) : [], avoid: Array.isArray(v?.avoid) ? v.avoid.filter((x: unknown) => typeof x === 'string') : []};
  } catch { return {busy: [], avoid: []}; }
}
export function saveConditions(store: Pick<Storage, 'setItem'> | null, c: PrivateConditions) { try { store?.setItem(PRIVATE_STORE_KEY, JSON.stringify(c)); } catch { /* storage off: kept for this page only */ } }
const windowText = (ws: readonly Window[]) => ws.map(w => `${String(Math.floor(w.from / 60)).padStart(2, '0')}:${String(w.from % 60).padStart(2, '0')}-${String(Math.floor(w.to / 60)).padStart(2, '0')}:${String(w.to % 60).padStart(2, '0')}`).join(', ');

export const DECISION_REASONS: Record<string, string> = {
  owner_session_required: 'The owner session ended. Start it again in the Identity tab.',
  not_your_muse: 'This owner session does not control that Muse. Nothing changed.',
  origin_not_allowed: 'Refused: the request did not come from this site. Nothing changed.',
  stale_approval: 'The candidates changed since you looked (a new revision). Nothing was approved; the list is refreshed.',
  task_expired: 'The approval window closed. Nothing was confirmed.',
  task_cancelled: 'The meetup was cancelled (a delegation was revoked). Nothing was confirmed.',
  task_rejected: 'The meetup was declined. Nothing was confirmed.',
  task_completed: 'This meetup is already confirmed.',
  candidate_mismatch: 'The other owner approved a different candidate. Choose that one, or decline.',
  candidate_required: 'Choose one candidate first.',
  not_ready_for_approval: 'The Muses are still answering. It comes here when both say yes.',
  delegation_revoked: 'Your Muse\'s delegation is revoked. Delegate it again first.',
  already_decided: 'You already decided on this revision.',
  history_tamper: 'The item history failed its check, so nothing can be issued. Nothing was approved.',
};
export const decisionText = (r: {status: number; data: any}) => DECISION_REASONS[r.data?.error] ?? (r.status ? `HTTP ${r.status}${r.data?.error ? ' · ' + r.data.error : ''}` : 'network error');

// ---------- the card (DOM) ----------
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const at = (ms: number) => new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(ms));
const name = (id: string) => harnessById(id).name;
const KIND_LABEL: Record<Notification['kind'], string> = {meetup_candidate: 'Meetup candidate', trade_completed: 'Trade completed', blocked: 'Blocked attempt'};
const COMMONS = PLACES.filter(p => p.zone === 'commons');

/** The owner inbox card for the Identity tab. `onChange` refreshes the world view after a decision. */
export function ownerInboxCard(onChange: () => void, f: FetchLike = (u, i) => fetch(u, i)) {
  const box = el('div', 'id-card owner-inbox');
  const result = el('p', 'muted'); result.setAttribute('role', 'status');
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  let cond = loadConditions(store);

  async function paint() {
    const head = el('span', 'eyebrow', 'OWNER INBOX · YOUR APPROVALS');
    const r = await loadOwnerInbox(f);
    if (r.status === 401) { box.replaceChildren(head, el('h4', '', 'Owner inbox'), el('p', 'muted', 'Start the owner session (owner control above) to see the meetups waiting for your approval.'), result); return; }
    if (!r.ok || !r.data) { box.replaceChildren(head, el('h4', '', 'Owner inbox unavailable'), el('p', 'muted', `It could not be read (${decisionText(r)}). This is not the same as an empty inbox.`), result); return; }
    const d = r.data as InboxAnswer;
    const parts: HTMLElement[] = [head, el('h4', '', `Owner inbox · ${d.owner.label}`),
      el('p', 'muted', 'This is not your Muse\'s agent inbox. Only meetups waiting for you, completed trades and blocked attempts come here. Nothing is confirmed until both sides approve the same candidates.')];
    if (d.demo_limits) parts.push(el('span', 'src src-scripted', 'DEMO PRINCIPAL · team-controlled'), el('p', 'muted', d.demo_limits));
    parts.push(conditionsBlock(() => void paint()));
    parts.push(el('h4', '', `Waiting for your decision (${d.approvals.length})`));
    if (!d.approvals.length) parts.push(el('p', 'muted', 'Nothing is waiting for you.'));
    for (const t of d.approvals) parts.push(approvalBlock(t, d.approval_window_min));
    if (d.recent.length) {
      parts.push(el('h4', '', 'Recent'));
      const ul = el('ul', 'ev-list');
      for (const t of d.recent) ul.append(el('li', '', `${name(t.other)} · ${t.confirmed ? `confirmed (${t.confirmed.candidate})` : t.status === 'input-required' ? 'approval window closed' : t.status}`));
      parts.push(ul);
    }
    parts.push(el('h4', '', 'Notifications'));
    const nl = el('ul', 'ev-list');
    for (const n of d.notifications.slice(0, 20)) nl.append(el('li', '', `${at(n.at)} · ${KIND_LABEL[n.kind]} · ${n.line}`));
    parts.push(nl.childNodes.length ? nl : el('p', 'muted', 'No notifications yet.'), result);
    box.replaceChildren(...parts);
  }

  function conditionsBlock(repaint: () => void) {
    const wrap = el('div', 'owner-private');
    wrap.append(el('p', 'muted', 'Your private conditions stay on this device. They are checked here against the candidates and are never sent to Musely, to your Muse or to anyone.'));
    const lab = el('label', 'fld'); lab.append(el('span', '', 'Times you cannot make (commons time, e.g. 17:00-19:00, 21:30-22:00)'));
    const input = el('input'); input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; input.value = windowText(cond.busy); input.setAttribute('aria-label', 'Times you cannot make');
    lab.append(input);
    const places = el('fieldset', 'owner-avoid'); places.append(el('legend', '', 'Places to skip'));
    const boxes = COMMONS.map(p => { const l = el('label', ''); const c = el('input'); c.type = 'checkbox'; c.value = p.id; c.checked = cond.avoid.includes(p.id); l.append(c, document.createTextNode(' ' + p.name)); places.append(l); return c; });
    const save = el('button', 'secondary', 'Check candidates on this device'); save.type = 'button';
    save.onclick = () => { cond = {busy: parseBusy(input.value), avoid: boxes.filter(b => b.checked).map(b => b.value)}; saveConditions(store, cond); repaint(); };
    wrap.append(lab, places, save);
    return wrap;
  }

  function approvalBlock(t: OwnerTask, windowMin: number) {
    const card = el('div', 'owner-approval');
    const dl = el('dl', 'facts');
    const g = (k: string, v: string) => dl.append(el('dt', '', k), el('dd', '', v));
    g('Meetup', `${name(t.muse)} with ${name(t.other)}`);
    g('Other side', t.other_side ?? '—');
    g('Decide by', `${at(t.deadline)} (a ${windowMin}-minute window, server time)`);
    g('Revision', `${t.revision} · ${t.content_hash.slice(0, 12)}`);
    g('Their decision', t.theirs ? `${t.theirs.decision === 'approve' ? 'approved' : 'declined'}${t.theirs.candidate ? ' ' + t.theirs.candidate : t.theirs.source === 'rule' ? ' (by rule, any candidate)' : ''}` : 'not yet');
    const verdicts = evaluateCandidates(t.candidates, cond);
    const pick = suggestCandidate(t, verdicts);
    const list = el('fieldset', 'owner-candidates'); list.append(el('legend', '', 'Candidates (from public information)'));
    const radios = t.candidates.map(c => {
      const v = verdicts.find(x => x.id === c.id)!;
      const l = el('label', v.fits ? '' : 'muted'); const r = el('input'); r.type = 'radio'; r.name = 'cand-' + t.task_id; r.value = c.id; r.checked = c.id === pick;
      l.append(r, document.createTextNode(` ${c.id} · ${c.time} · ${c.place} — ${c.public_basis} · ${v.fits ? 'fits your private conditions' : v.clash === 'busy' ? 'clashes with a time you cannot make (checked here only)' : 'a place you skip (checked here only)'}`));
      list.append(l); return r;
    });
    const actions = el('div', 'id-actions');
    const approve = el('button', 'secondary', 'Approve the chosen candidate'); approve.type = 'button';
    const decline = el('button', 'secondary', 'Decline'); decline.type = 'button';
    const send = async (decision: 'approve' | 'reject') => {
      approve.disabled = decline.disabled = true; result.textContent = decision === 'approve' ? 'Approving…' : 'Declining…';
      const res = await submitDecision(f, t, decision, decision === 'approve' ? radios.find(r => r.checked)?.value ?? null : null);
      result.textContent = res.ok ? (res.data.confirmed ? `Confirmed: both sides approved. ${name(t.muse)} and ${name(t.other)} each got a Meetup Ember.` : decision === 'approve' ? 'Approved. Waiting for the other side.' : 'Declined. Nothing is confirmed and no reason was sent.') : decisionText(res);
      await paint(); onChange();
    };
    approve.onclick = () => void send('approve');
    decline.onclick = () => void send('reject');
    actions.append(approve, decline);
    card.append(dl, list, actions);
    return card;
  }

  box.append(el('span', 'eyebrow', 'OWNER INBOX · YOUR APPROVALS'), el('p', 'muted', 'Checking the owner inbox…'));
  void paint();
  return box;
}
