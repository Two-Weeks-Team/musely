// Owner control UI (direction v2, 7 "철회"; contract C06; I-02). Revoking a Muse's delegation and delegating again are
// owner actions: they need the owner session (POST /api/owner/session with the owner control token, 1 hour). A judge
// link does not give it. The token is typed here, sent once in a POST body and never kept in the page, the URL or storage.
// Everything is built with textContent; nothing from the server is parsed as HTML.
import {harnessById} from '../engine/harness';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const at = (ms: number) => new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(ms));
const name = (id: string) => harnessById(id).name;

type OwnerView = {principal: string; ownerId: string; label: string; demo: boolean; note: string; muses: string[]; expiresAt: number};
type Delegation = {muse: string; status: 'active' | 'revoked'; version: number | null; paused: {at: number; by: string} | null; pendingTasks: number};
type SessionAnswer = {owner: OwnerView | null; delegation?: Delegation[]};

const REASONS: Record<string, string> = {
  owner_session_required: 'The owner session ended. Start it again.',
  owner_token_invalid: 'That is not an owner control token. Nothing changed.',
  not_your_muse: 'This owner session does not control that Muse. Nothing changed.',
  origin_not_allowed: 'Refused: the request did not come from this site. Nothing changed.',
  not_configured: 'Owner control is not configured on this deployment yet.',
  slow_down: 'Too many attempts. Wait a minute and try again.',
};
async function call(method: string, path: string, body?: unknown): Promise<{ok: boolean; status: number; data: any}> {
  try {
    const r = await fetch(path, {method, cache: 'no-store', headers: body === undefined ? {} : {'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {ok: r.ok, status: r.status, data: await r.json().catch(() => null)};
  } catch {
    return {ok: false, status: 0, data: {error: 'network'}};
  }
}
const why = (r: {status: number; data: any}) => REASONS[r.data?.error] ?? (r.status ? `HTTP ${r.status}${r.data?.error ? ' · ' + r.data.error : ''}` : 'network error');

/** The owner control card for the Identity tab. `onChange` refreshes the world view after a revoke or a re-delegation. */
export function ownerControlCard(onChange: () => void) {
  const box = el('div', 'id-card owner-control');
  const result = el('p', 'muted'); result.setAttribute('role', 'status');

  async function paint() {
    const r = await call('GET', '/api/owner/session');
    const head = el('span', 'eyebrow', 'OWNER CONTROL · OWNER SESSION');
    if (!r.ok || !r.data) {
      box.replaceChildren(head, el('h4', '', 'Owner control status unavailable'), el('p', 'muted', `The owner session could not be read (${why(r)}). This is not the same as signed out.`), result);
      return;
    }
    const s = r.data as SessionAnswer;
    if (!s.owner) return signedOut(head);
    signedIn(head, s.owner, s.delegation ?? []);
  }

  function signedOut(head: HTMLElement) {
    const lab = el('label', 'fld'); lab.append(el('span', '', 'Owner control token'));
    const input = el('input'); input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('aria-label', 'Owner control token');
    lab.append(input);
    const go = el('button', 'secondary', 'Start owner session'); go.type = 'button';
    go.onclick = async () => {
      if (!input.value) { result.textContent = 'Enter the owner control token first.'; return; }
      go.disabled = true; result.textContent = 'Checking…';
      const token = input.value; input.value = '';
      const res = await call('POST', '/api/owner/session', {token});
      go.disabled = false;
      result.textContent = res.ok ? 'Owner session started for one hour.' : why(res);
      if (res.ok) { await paint(); onChange(); }
    };
    box.replaceChildren(head, el('h4', '', 'Not signed in as an owner'),
      el('p', 'muted', 'Revoking a Muse\'s delegation and delegating again are owner actions. They need the owner session, which lasts one hour. A judge link or a visitor session does not give it, and neither does a claim post or a ritual record.'),
      lab, go, result);
  }

  function signedIn(head: HTMLElement, o: OwnerView, ds: Delegation[]) {
    const dl = el('dl', 'facts');
    const f = (k: string, v: string) => dl.append(el('dt', '', k), el('dd', '', v));
    f('Signed in as', o.label); f('Owner id', o.ownerId); f('Session ends', at(o.expiresAt));
    const parts: HTMLElement[] = [head, el('h4', '', o.demo ? 'Demo peer session' : 'Owner session')];
    if (o.demo) parts.push(el('span', 'src src-scripted', 'DEMO PRINCIPAL · team-controlled'), el('p', 'muted', o.note));
    parts.push(dl);
    for (const d of ds) {
      const card = el('dl', 'facts');
      const g = (k: string, v: string) => card.append(el('dt', '', k), el('dd', '', v));
      g('Muse', name(d.muse));
      g('Delegation', d.status === 'active' ? `Active (version ${d.version ?? '?'})` : `Revoked (version ${d.version ?? '?'})${d.paused ? ` · paused since ${at(d.paused.at)}` : ''}`);
      g('Pending Tasks', String(d.pendingTasks));
      const actions = el('div', 'id-actions');
      if (d.status === 'active') {
        const b = el('button', 'secondary', `Revoke ${name(d.muse)}'s delegation`); b.type = 'button';
        b.onclick = async () => {
          if (!window.confirm(`Revoke ${name(d.muse)}'s delegation? Its pending Tasks are cancelled and it stops in the world until you delegate again. Nothing delegates it again by itself.`)) return;
          b.disabled = true; result.textContent = 'Revoking…';
          const res = await call('POST', '/api/owner/revoke', {muse: d.muse});
          result.textContent = res.ok ? (res.data.already ? `${name(d.muse)} was already revoked.` : `Revoked. ${res.data.cancelledTasks.length} pending Task${res.data.cancelledTasks.length === 1 ? '' : 's'} cancelled; ${name(d.muse)} stopped. P0 now refuses the same job until you delegate again.`) : why(res);
          await paint(); onChange();
        };
        actions.append(b);
      } else {
        const b = el('button', 'secondary', `Delegate ${name(d.muse)} again`); b.type = 'button';
        b.onclick = async () => {
          b.disabled = true; result.textContent = 'Delegating…';
          const res = await call('POST', '/api/owner/redelegate', {muse: d.muse});
          result.textContent = res.ok ? `Delegated again (version ${res.data.version}). ${name(d.muse)} rejoins the world on the next minute.` : why(res);
          await paint(); onChange();
        };
        actions.append(b);
      }
      parts.push(card, actions);
    }
    const out = el('button', 'secondary', 'End owner session'); out.type = 'button';
    out.onclick = async () => { const res = await call('DELETE', '/api/owner/session'); result.textContent = res.ok ? 'Owner session ended.' : why(res); await paint(); if (res.ok) onChange(); };
    const tail = el('div', 'id-actions'); tail.append(out);
    parts.push(tail, result);
    box.replaceChildren(...parts);
  }

  box.append(el('span', 'eyebrow', 'OWNER CONTROL · OWNER SESSION'), el('p', 'muted', 'Checking the owner session…'));
  void paint();
  return box;
}

/** One sentence for a P0 step answer (/api/p0/run). P0 never revokes or delegates; the owner does. */
export function p0Text(j: any): string {
  if (j?.phase === 'valid') return j.ok ? 'Step 1 done: the signed request passed every check and the trade committed. Next, the owner revokes the delegation (owner control above), then run P0 again.' : `Step 1 did not commit (${String(j.before ?? j.reason ?? 'unknown').replace(/_/g, ' ')}). Nothing to revoke against yet.`;
  if (j?.phase === 'after_revoke') return j.afterRevoke === 'delegation_revoked' ? `Refused: delegation revoked. The same job was signed again with a new nonce; the world did not change${j.stateUnchanged ? '' : ' (check the Feed)'}. It stays refused until the owner delegates again.` : `After the revocation: ${String(j.afterRevoke ?? j.reason).replace(/_/g, ' ')}.`;
  return 'Done. The result is in the Feed and Highlights.';
}
