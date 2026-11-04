import {apiFetch,apiRequestInit} from './api-fetch.ts';
import {uiText,catalogText,inventoryText,activityStatus} from './i18n.ts';
import {resolveMuse} from './personal-profile.ts';
// Owner inbox (contract C06, direction v2 12.3; I-07). Separate from the Muse's agent inbox (heartbeat_check): it shows
// only the meetups waiting for this owner's decision, the recent decisions and the three owner notification kinds
// (meetup candidate, completed trade, blocked attempt), for the owner session's own Muse.
//  - Private conditions (times the owner cannot make, places to skip) are typed here and evaluated here, against the
//    candidates the server built from public information. They stay on this device (localStorage) and are never part
//    of any request: a decision sends only {taskId, revision, contentHash, decision, candidate?} (approvalBody).
//  - A decline has no reason field. The server refuses any field it does not know.
//  - Everything is built with textContent; nothing from the server is parsed as HTML.
// The functions above ownerInboxCard need no DOM, so scripts/tasks.test.mjs runs them directly.
import {PLACES} from '../engine/places.ts';

export type Candidate = {id: string; time: string; place: string; place_id: string | null; public_basis: string};
type Side = {decision: 'approve' | 'reject'; candidate: string | null; source: 'owner' | 'rule'; at: number; approval_ref: string} | null;
export type OwnerTask = {task_id: string; kind: string; muse: string; other: string; other_side: string | null; status: string; stage: string; revision: number; content_hash: string; deadline: number; deadline_iso: string; candidates: Candidate[]; yours: Side; theirs: Side; confirmed: {candidate: string; at: number} | null};
type Notification = {id: string; kind: 'meetup_candidate' | 'trade_completed' | 'blocked'; at: number; line: string; muse: string; other: string | null};
type InboxAnswer = {owner: {label: string; demo: boolean}; demo_limits: string | null; approvals: OwnerTask[]; recent: OwnerTask[]; notifications: Notification[]; approval_window_min: number};

export type OwnerInboxSession = {principal: string; ownerId: string; expiresAt: number};

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
    const r = await f(path, {...apiRequestInit(),method,cache:'no-store',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
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
  owner_session_required: uiText('The owner session ended. Start it again in the Identity tab.'),
  not_your_muse: uiText('This owner session does not control that Muse. Nothing changed.'),
  origin_not_allowed: uiText('Refused: the request did not come from this site. Nothing changed.'),
  stale_approval: uiText('The candidates changed since you looked (a new revision). Nothing was approved; the list is refreshed.'),
  task_expired: uiText('The approval window closed. Nothing was confirmed.'),
  task_cancelled: uiText('The meetup was cancelled (a delegation was revoked). Nothing was confirmed.'),
  task_rejected: uiText('The meetup was declined. Nothing was confirmed.'),
  task_completed: uiText('This meetup is already confirmed.'),
  candidate_mismatch: uiText('The other owner approved a different candidate. Choose that one, or decline.'),
  candidate_required: uiText('Choose one candidate first.'),
  not_ready_for_approval: uiText('The Muses are still answering. It comes here when both say yes.'),
  delegation_revoked: uiText('Your Muse\'s delegation is revoked. Delegate it again first.'),
  already_decided: uiText('You already decided on this revision.'),
  history_tamper: uiText('The item history failed its check, so nothing can be issued. Nothing was approved.'),
};
export const decisionText = (r: {status: number; data: any}) => DECISION_REASONS[r.data?.error] ?? (r.status ? uiText`HTTP ${r.status}${r.data?.error ? ' · ' + r.data.error : ''}` : uiText('network error'));

// ---------- the card (DOM) ----------
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const at = (ms: number) => new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(ms));
const defaultName = (id: string) => resolveMuse({id}).name;
const KIND_LABEL: Record<Notification['kind'], string> = {meetup_candidate: uiText('Meetup candidate'), trade_completed: uiText('Trade completed'), blocked: uiText('Blocked attempt')};
const COMMONS = PLACES.filter(p => p.zone === 'commons');

/** The mounted card can refresh without remounting its private editor or unchanged approval controls. */
export function ownerInboxCard(onChange: () => void, f: FetchLike = (u, i) => apiFetch(u, i), active: () => boolean = () => true, name: (id:string)=>string = defaultName) {
  const box = el('div', 'id-card owner-inbox');
  const result = el('p', 'muted'); result.setAttribute('role', 'status');
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  let cond = loadConditions(store), request = 0, sessionGeneration = 0, disposed = false;
  let session: OwnerInboxSession | null | undefined; // undefined: one preflight; null: no automatic retries.
  let pending: Promise<void> | null = null;
  let view: {owner: string; waiting: HTMLElement; approvals: HTMLElement; recent: HTMLElement; notifications: HTMLElement; status: HTMLElement} | null = null;
  const cards = new Map<string, {key: string; node: HTMLElement & {updateOther(side: Side): void;updateNames():void}}>();
  const refreshButton = () => { const b = el('button', 'secondary', uiText('Refresh owner inbox')); b.type = 'button'; b.onclick = () => void recheckSession(); return b; };
  // Keep nodes that already occupy the right slot connected: removing and re-appending an editor blurs it in browsers.
  const reconcile = (parent: HTMLElement, nodes: HTMLElement[]) => {
    nodes.forEach((node, i) => { if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null); });
    while (parent.children.length > nodes.length) parent.children[parent.children.length - 1].remove();
  };

  const sessionValue = (value: unknown): OwnerInboxSession | null => {
    if (!value || typeof value !== 'object') return null;
    const v = value as OwnerInboxSession;
    return typeof v.principal === 'string' && !!v.principal && typeof v.ownerId === 'string' && !!v.ownerId && Number.isSafeInteger(v.expiresAt) && v.expiresAt > Date.now() ? {principal:v.principal,ownerId:v.ownerId,expiresAt:v.expiresAt} : null;
  };
  function signedOut(message = uiText('Start the owner session (owner control above) to see the meetups waiting for your approval.')) {
    view = null; cards.clear(); result.textContent = '';
    box.replaceChildren(el('span', 'eyebrow', uiText('OWNER INBOX · YOUR APPROVALS')), el('h4', '', uiText('Owner inbox')), el('p', 'muted', message), refreshButton(), result);
  }
  function setOwnerSession(value: unknown) {
    if (disposed) return;
    const next = sessionValue(value);
    if (session !== undefined && JSON.stringify(session) === JSON.stringify(next)) return;
    sessionGeneration++; request++; pending = null; session = next;
    signedOut();
    if (next) void paint();
  }
  function recheckSession() {
    if (disposed || !active()) return Promise.resolve();
    sessionGeneration++; request++; pending = null; session = undefined; signedOut(uiText('Checking the owner session…'));
    return paint();
  }
  function paint(force = false): Promise<void> {
    if (disposed) return Promise.resolve();
    if (!active()) { request++; pending = null; return Promise.resolve(); }
    if (session === null) return Promise.resolve();
    if (session && session.expiresAt <= Date.now()) { setOwnerSession(null); return Promise.resolve(); }
    if (pending) return pending;
    const task = paintOnce(force); pending = task;
    void task.finally(() => { if (pending === task) pending = null; });
    return task;
  }
  async function paintOnce(force: boolean) {
    const mine = ++request, generation = sessionGeneration;
    const current = () => !disposed && mine === request && generation === sessionGeneration && active();
    if (session === undefined) {
      const check = await call(f, 'GET', '/api/owner/session');
      if (!current()) return;
      session = check.ok ? sessionValue(check.data?.owner) : null;
      if (!session) { signedOut(check.ok || check.status === 401 ? undefined : uiText('The owner session could not be confirmed. Check owner control above or refresh explicitly.')); return; }
    }
    const r = await loadOwnerInbox(f);
    if (!current()) return;
    if (!session || session.expiresAt <= Date.now() || r.status === 401) { setOwnerSession(null); return; }
    const head = el('span', 'eyebrow', uiText('OWNER INBOX · YOUR APPROVALS'));
    if (!r.ok || !r.data) {
      const message = uiText`It could not be read (${decisionText(r)}). This is not the same as an empty inbox.`;
      if (view) { view.status.textContent = uiText`Owner inbox is not updating. ${message} Showing the last successful answer.`; return; }
      box.replaceChildren(head, el('h4', '', uiText('Owner inbox unavailable')), el('p', 'muted', message), refreshButton(), result); return;
    }
    const d = r.data as InboxAnswer, owner = JSON.stringify(d.owner);
    if (!view || view.owner !== owner) {
      cards.clear();
      const waiting = el('h4'), approvals = el('div'), recent = el('div'), notifications = el('div'), status = el('p', 'muted');
      status.setAttribute('role', 'status');
      const parts: HTMLElement[] = [head, el('h4', '', uiText`Owner inbox · ${d.owner.label}`),
        el('p', 'muted', uiText('This is not your Muse\'s agent inbox. Only meetups waiting for you, completed trades and blocked attempts come here. Nothing is confirmed until both sides approve the same candidates.'))];
      if (d.demo_limits) parts.push(el('span', 'src src-scripted', uiText('DEMO PRINCIPAL · team-controlled')), el('p', 'muted', d.demo_limits));
      parts.push(conditionsBlock(() => void paint(true)), refreshButton(), status, waiting, approvals, recent, el('h4', '', uiText('Notifications')), notifications, result);
      box.replaceChildren(...parts);
      view = {owner, waiting, approvals, recent, notifications, status};
    }
    view.status.textContent = '';
    const waiting = d.approvals.filter(t => !t.yours).length;
    view.waiting.textContent = uiText`Waiting for your decision (${waiting})`;
    const nodes = d.approvals.map(t => {
      const key = JSON.stringify([{...t, theirs: null}, d.approval_window_min]), old = cards.get(t.task_id);
      if (!force && old?.key === key) { old.node.updateOther(t.theirs);old.node.updateNames(); return old.node; }
      const selected = force ? undefined : old?.node.querySelector<HTMLInputElement>('input[type=radio]:checked')?.value;
      const node = approvalBlock(t, d.approval_window_min, selected);
      cards.set(t.task_id, {key, node}); return node;
    });
    for (const id of cards.keys()) if (!d.approvals.some(t => t.task_id === id)) cards.delete(id);
    reconcile(view.approvals, nodes.length ? nodes : [el('p', 'muted', uiText('Nothing is waiting for you.'))]);
    view.recent.replaceChildren();
    if (d.recent.length) {
      const ul = el('ul', 'ev-list');
      for (const t of d.recent) ul.append(el('li', '', `${name(t.other)} · ${t.confirmed ? uiText`confirmed (${t.confirmed.candidate})` : t.status === 'input-required' ? uiText('approval window closed') : t.status}`));
      view.recent.append(el('h4', '', uiText('Recent')), ul);
    }
    const nl = el('ul', 'ev-list');
    for (const n of d.notifications.slice(0, 20)) nl.append(el('li', '', `${at(n.at)} · ${KIND_LABEL[n.kind]} · ${n.line}`));
    view.notifications.replaceChildren(nl.childNodes.length ? nl : el('p', 'muted', uiText('No notifications yet.')));
  }

  function conditionsBlock(repaint: () => void) {
    const wrap = el('div', 'owner-private');
    wrap.append(el('p', 'muted', uiText('Your private conditions stay on this device. They are checked here against the candidates and are never sent to Musely, to your Muse or to anyone.')));
    const lab = el('label', 'fld'); lab.append(el('span', '', uiText('Times you cannot make (commons time, e.g. 17:00-19:00, 21:30-22:00)')));
    const input = el('input'); input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false; input.value = windowText(cond.busy); input.setAttribute('aria-label', uiText('Times you cannot make'));
    lab.append(input);
    const places = el('fieldset', 'owner-avoid'); places.append(el('legend', '', uiText('Places to skip')));
    const boxes = COMMONS.map(p => { const l = el('label', ''); const c = el('input'); c.type = 'checkbox'; c.value = p.id; c.checked = cond.avoid.includes(p.id); l.append(c, document.createTextNode(' ' + p.name)); places.append(l); return c; });
    const save = el('button', 'secondary', uiText('Check candidates on this device')); save.type = 'button';
    save.onclick = () => { cond = {busy: parseBusy(input.value), avoid: boxes.filter(b => b.checked).map(b => b.value)}; saveConditions(store, cond); repaint(); };
    wrap.append(lab, places, save);
    return wrap;
  }

  function approvalBlock(t: OwnerTask, windowMin: number, selected?: string) {
    const card = el('div', 'owner-approval');
    const dl = el('dl', 'facts');
    const g = (k: string, v: string) => { const value = el('dd', '', v); dl.append(el('dt', '', k), value); return value; };
    const meetupName=g(uiText('Meetup'), uiText`${name(t.muse)} with ${name(t.other)}`);
    g(uiText('Other side'), t.other_side ?? '—');
    g(uiText('Decide by'), uiText`${at(t.deadline)} (a ${windowMin}-minute window, server time)`);
    g(uiText('Revision'), `${t.revision} · ${t.content_hash.slice(0, 12)}`);
    g(uiText('Your decision'), t.yours ? `${t.yours.decision === 'approve' ? 'approved' : 'declined'}${t.yours.candidate ? ' ' + t.yours.candidate : ''}` : uiText('not yet'));
    const otherValue = g(uiText('Their decision'), '');
    const node = Object.assign(card, {updateNames(){meetupName.textContent=uiText`${name(t.muse)} with ${name(t.other)}`;},updateOther(side: Side) { otherValue.textContent = side ? `${side.decision === 'approve' ? 'approved' : 'declined'}${side.candidate ? ' ' + side.candidate : side.source === 'rule' ? uiText(' (by rule, any candidate)') : ''}` : uiText('not yet'); }});
    node.updateOther(t.theirs);
    if (t.yours) {
      const chosen = t.candidates.find(c => c.id === t.yours!.candidate);
      if (chosen) g(uiText('Chosen candidate'), `${chosen.id} · ${chosen.time} · ${chosen.place}`);
      card.append(dl, el('p', 'muted', t.yours.decision === 'approve' ? uiText('Waiting for the other side. Your decision on this revision is already recorded.') : uiText('You declined this revision. Nothing is confirmed.')));
      return node;
    }
    const verdicts = evaluateCandidates(t.candidates, cond);
    const pick = selected && t.candidates.some(c => c.id === selected) ? selected : suggestCandidate(t, verdicts);
    const list = el('fieldset', 'owner-candidates'); list.append(el('legend', '', uiText('Candidates (from public information)')));
    const radios = t.candidates.map(c => {
      const v = verdicts.find(x => x.id === c.id)!;
      const l = el('label', v.fits ? '' : 'muted'); const r = el('input'); r.type = 'radio'; r.name = 'cand-' + t.task_id; r.value = c.id; r.checked = c.id === pick;
      l.append(r, document.createTextNode(` ${c.id} · ${c.time} · ${c.place} — ${c.public_basis} · ${v.fits ? uiText('fits your private conditions') : v.clash === 'busy' ? uiText('clashes with a time you cannot make (checked here only)') : uiText('a place you skip (checked here only)')}`));
      list.append(l); return r;
    });
    const actions = el('div', 'id-actions');
    const approve = el('button', 'secondary', uiText('Approve the chosen candidate')); approve.type = 'button';
    const decline = el('button', 'secondary', uiText('Decline')); decline.type = 'button';
    const send = async (decision: 'approve' | 'reject') => {
      if (disposed || !active() || !session || session.expiresAt <= Date.now() || approve.disabled || decline.disabled) return;
      const generation = sessionGeneration;
      approve.disabled = decline.disabled = true; result.textContent = decision === 'approve' ? uiText('Approving…') : uiText('Declining…');
      try {
        const res = await submitDecision(f, t, decision, decision === 'approve' ? radios.find(r => r.checked)?.value ?? null : null);
        if (disposed || !active() || generation !== sessionGeneration) return;
        if (res.status === 401 || !session || session.expiresAt <= Date.now()) { setOwnerSession(null); return; }
        result.textContent = res.ok ? (res.data.confirmed ? uiText`Confirmed: both sides approved. ${name(t.muse)} and ${name(t.other)} each got a Meetup Ember.` : decision === 'approve' ? uiText('Approved. Waiting for the other side.') : uiText('Declined. Nothing is confirmed and no reason was sent.')) : decisionText(res);
        request++; pending = null; await paint();
        if (!disposed && active() && generation === sessionGeneration) onChange();
      } finally {
        // A refresh reuses an unchanged undecided card, including its disabled buttons. Release that in-flight state;
        // a settled decision or a lost session removed this card, so it must not bring the old controls back.
        if (cards.get(t.task_id)?.node === node) approve.disabled = decline.disabled = false;
      }
    };
    approve.onclick = () => void send('approve');
    decline.onclick = () => void send('reject');
    actions.append(approve, decline);
    card.append(dl, list, actions);
    return node;
  }

  box.append(el('span', 'eyebrow', uiText('OWNER INBOX · YOUR APPROVALS')), el('p', 'muted', uiText('Checking the owner inbox…')));
  void paint();
  return Object.assign(box, {refresh: () => paint(), setOwnerSession, dispose() { if (disposed) return; disposed = true; sessionGeneration++; request++; pending = null; session = null; view = null; cards.clear(); result.textContent = ''; box.replaceChildren(); }});
}
