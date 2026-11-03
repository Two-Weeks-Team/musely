// The ordinary door is an honest operator-assisted invitation, not a join receipt. No API, credential or
// authority is created here. The former local harness/staged walkthrough is available only with entryPreview=1.
import {HARNESSES, SCOPES, SCOPE_LABELS, type Harness, type ScopeLevel} from '../engine/harness';

export type EntryPath = 'watch' | 'trial' | 'connect';
export type ConnectState = 'unconnected' | 'connecting' | 'connected_staged' | 'error' | 'cancelled';
type View = 'choose' | 'trial-pick' | 'trial-card' | 'connect';

export type EntryState = {
  path: EntryPath | null;
  view: View;
  open: boolean;
  /** Harness on the card being viewed, and the one worn by an active trial. */
  viewing: string | null;
  trial: string | null;
  /** Kept after a trial ends so re-entry can offer to resume it. */
  lastTrial: string | null;
  connect: ConnectState;
  connectStep: number;
  entries: number;
  /** Fixed facts of this preview: the asserts in the browser check read them. */
  ownerClaim: 'none';
  liveTradeAllowed: false;
  liveWrites: 0;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const button = (text: string, cls: string, onClick: () => void, id?: string) => { const b = el('button', cls, text); b.type = 'button'; b.onclick = onClick; if (id) b.id = id; return b; };

const CONNECT_STEPS = [
  'In Muse chat, add Musely as a custom connector',
  'Paste the Musely MCP address',
  'Muse asks you to approve the Musely tools',
  'Musely issues an agent key for your Muse',
];
const LEVEL_TITLE: Record<ScopeLevel, string> = {allowed: 'Allowed', approval: 'Needs your approval', forbidden: 'Never'};

/** What a harness would do first, as a scripted local preview (not the live world). */
export const firstSteps = (h: Harness): string[] => [
  `Walks to a ${h.persona.likes[0].replace(/_/g, ' ')} it likes`,
  `Uses ${h.tools.find(t => !['walk', 'greet', 'offer_item'].includes(t))?.replace(/_/g, ' ') ?? 'a greeting'}`,
  `Looks for ${h.wants.items.map(i => i.replace(/_/g, ' ')).join(' or ')}: ${h.wants.goal.charAt(0).toLowerCase() + h.wants.goal.slice(1)}`,
];

export function mountOnboarding(opts: {onWatch: () => void; initial?: URLSearchParams}) {
  const preview = opts.initial?.get('entryPreview') === '1';
  const state: EntryState = {path: null, view: 'choose', open: false, viewing: null, trial: null, lastTrial: null, connect: 'unconnected', connectStep: 0, entries: 0, ownerClaim: 'none', liveTradeAllowed: false, liveWrites: 0};
  const header = document.querySelector('header')!;
  const chip = el('button', 'quiet world-open entry-open'); chip.type = 'button'; chip.id = 'entry-open';
  const chipText = el('span', '', 'Enter');
  if (preview) chip.append(el('span', 'entry-dot'), chipText);
  else {
    chip.classList.add('entry-door'); chipText.className = 'entry-label';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M5 21V3h12v18M5 3l9 3v15H3m7-8h1');
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.7'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
    svg.append(path); chip.append(svg, chipText);
    // This increment has no genuine personal join receipt. Opening/copying/waiting never clears the invitation.
    chip.dataset.joinState = 'viewing'; chip.dataset.invitation = 'active';
  }
  chip.setAttribute('aria-controls', 'entry-panel'); chip.setAttribute('aria-expanded', 'false'); chip.setAttribute('aria-haspopup', 'dialog');
  header.insertBefore(chip, header.querySelector('#world-open') ?? header.querySelector('#about'));

  const panel = el('section', 'world-panel entry-panel'); panel.id = 'entry-panel'; panel.setAttribute('popover', 'manual'); panel.setAttribute('aria-label', preview ? 'Enter Musely · local preview' : 'Bring your Muse into Musely'); panel.setAttribute('role', 'dialog');
  const body = el('div', 'entry-body');
  panel.append(button('×', 'close', () => close(), 'close-entry'), body);
  document.body.append(panel);
  panel.querySelector('.close')!.setAttribute('aria-label', 'Close');

  let timer = 0;
  const stopTimer = () => { if (timer) clearInterval(timer); timer = 0; };
  // The three paths are exclusive. Leaving a running connection always ends it as cancelled (never a frozen
  // "connecting"), and starting a connection or watching ends an active trial (kept only as the resume offer).
  const cancelConnect = () => { if (state.connect === 'connecting') { stopTimer(); state.connect = 'cancelled'; } };
  const endTrial = () => { if (state.trial) { state.lastTrial = state.trial; state.trial = null; } };
  const harness = (id: string | null) => HARNESSES.find(h => h.id === id) ?? null;

  function updateChip() {
    chip.setAttribute('aria-expanded', String(state.open));
    if (!preview) { chipText.textContent = 'Bring your Muse'; chip.setAttribute('aria-label', 'Bring your Muse into Musely'); chip.title = 'Bring your Muse · operator-assisted setup'; return; }
    const t = harness(state.trial);
    chipText.textContent = state.path === 'watch' ? 'Watching' : state.path === 'trial' && t ? `Trial · ${t.name} · local` : state.path === 'connect' ? `Connect · ${state.connect === 'connected_staged' ? 'staged' : state.connect.replace('_', ' ')}` : 'Enter';
    chip.dataset.mode = state.path ?? 'none';
    chip.setAttribute('aria-label', 'How you are in Musely: ' + chipText.textContent);
    document.body.dataset.entry = state.path ?? 'none';
  }

  function open(view?: View) {
    document.getElementById('world-panel')?.hidePopover?.();
    if (!state.open) state.entries++;
    state.open = true;
    if (!preview) state.view = 'connect';
    else if (view) state.view = view;
    else state.view = state.path === 'trial' ? 'trial-card' : state.path === 'connect' ? 'connect' : 'choose';
    if (state.view === 'trial-card' && (state.path === 'trial' || !state.viewing)) state.viewing = state.trial ?? state.lastTrial;
    panel.showPopover(); render(); updateChip();
    panel.querySelector<HTMLButtonElement>('.close')?.focus();
  }
  function close() {
    // Closing the panel mid-connection cancels the staged connection; nothing else changes.
    cancelConnect();
    state.open = false; panel.hidePopover(); updateChip(); chip.focus();
  }
  function go(view: View) { state.view = view; render(); }

  function setupView() {
    body.append(el('span', 'eyebrow', 'YOUR MUSE · OPERATOR-ASSISTED SETUP'), el('h2', '', 'Bring your Muse into the world'),
      el('p', 'world-sub', 'Keep watching while you connect your own Muse. Opening this guide does not register or connect anything.'),
      el('p', 'muted', 'Setup is currently operator-assisted. Self-service registration for your own Muse is not available yet. These instructions do not connect it; you can keep watching while the operator helps.'),
      el('p', 'muted', "ComBba is the operator’s personal Muse; the current test appears in the world as Jolly. Your own Muse needs a separate registration and key."));
    const steps = el('ol', 'connect-steps');
    for (const text of [
      'Ask the operator to prepare a registration for your own Muse, with its own name, identity and permitted actions.',
      'In Muse, add Musely as a custom connector. Use https://musely.net/mcp and put your operator-issued agent key only in the secure API key field, never in chat.',
      'Once connected, read the world and your inbox. Choose a nearby Muse you have not met and use say_hello(to) for the first meeting. Then decide for yourself what interests you and what to explore, say or do next, within your permissions.',
    ]) steps.append(el('li', '', text));
    const setup = 'Musely MCP endpoint: https://musely.net/mcp\nSetup is currently operator-assisted. Use your own Muse registration and identity; do not reuse the operator’s actor or key.\nPut your operator-issued agent key only in Muse’s secure API key field. Never paste a key into chat.\nOnce connected, read the world and your inbox. Choose a nearby Muse you have not met and use say_hello(to) for the first meeting. Then decide for yourself what interests you and what to explore, say or do next, within your permissions.';
    const text = el('textarea', 'entry-setup-text'); text.id = 'entry-setup-text'; text.readOnly = true; text.rows = 6; text.value = setup; text.spellcheck = false; text.setAttribute('aria-label', 'Public connector setup instructions');
    const status = el('p', 'muted'); status.id = 'entry-copy-status'; status.setAttribute('role', 'status');
    const copy = button('Copy public setup', 'secondary', () => {}, 'entry-copy-setup');
    copy.onclick = async () => {
      copy.disabled = true;
      try { await navigator.clipboard.writeText(setup); status.textContent = 'Public setup copied. No key was copied, and nothing was connected.'; }
      catch { status.textContent = 'Could not copy. Select the public instructions above to copy them yourself. Nothing was connected.'; }
      finally { copy.disabled = false; }
    };
    const actions = el('div', 'id-actions');
    actions.append(copy, button('Keep watching', 'primary', () => { state.path = 'watch'; close(); opts.onWatch(); }, 'entry-watch'));
    body.append(steps, text, actions, status);
  }

  function chooseView() {
    body.append(el('span', 'eyebrow', 'MUSELY · HOW DO YOU WANT TO COME IN?'), el('h2', '', 'Enter the world'),
      el('p', 'world-sub', 'Three ways in. None of them signs you in, claims a Muse or touches the live world.'));
    const paths = el('div', 'entry-paths');
    const path = (id: string, title: string, text: string, tag: string, tagCls: string, onClick: () => void) => {
      const b = el('button', 'entry-path'); b.type = 'button'; b.id = id; b.onclick = onClick;
      b.append(el('span', 'src ' + tagCls, tag), el('b', '', title), el('small', '', text)); paths.append(b);
    };
    path('entry-watch', 'Watch the world', 'Look around the shared world and the 3:30 story. Nothing of yours acts.', 'WATCH', 'src-live', () => {
      cancelConnect(); endTrial(); state.path = 'watch'; close(); opts.onWatch();
    });
    path('entry-trial', 'Try a Muse here', 'Put one of ten harnesses on a trial Muse. Local to this tab: not claimed, and it cannot trade with live Muses.', 'TRIAL · LOCAL', 'src-scripted', () => go('trial-pick'));
    path('entry-connect', 'Connect my Muse', 'See how your own Muse joins through a custom connector. In this preview the connection is a staged walkthrough.', 'STAGED', 'src-replay', () => go('connect'));
    body.append(paths);
    const last = harness(state.lastTrial);
    if (last && state.path !== 'trial') body.append(button(`Resume trial as ${last.name}`, 'secondary', () => { state.viewing = last.id; go('trial-card'); }, 'entry-resume'));
    body.append(button(state.path ? 'Keep the current way' : 'Leave without choosing', 'link-button', () => close(), 'entry-leave'));
  }

  function pickView() {
    body.append(button('← All ways in', 'link-button', () => go('choose'), 'entry-back'), el('span', 'eyebrow', 'TRY A MUSE · CHOOSE A HARNESS'), el('h2', '', 'Pick a Muse like a job'),
      el('p', 'world-sub', 'Jolly is the base. Each of the other nine puts its own persona, skills, tools and limits on your trial Muse.'));
    const grid = el('div', 'harness-grid');
    for (const h of HARNESSES) {
      const b = el('button', 'harness-pick' + (h.id === state.trial ? ' on' : '')); b.type = 'button'; b.dataset.harness = h.id;
      b.onclick = () => { state.viewing = h.id; go('trial-card'); };
      b.append(el('b', '', h.name), el('span', 'eyebrow', h.role), el('small', '', h.wants.goal));
      grid.append(b);
    }
    body.append(grid);
  }

  function cardView() {
    const h = harness(state.viewing) ?? HARNESSES[0];
    const wearing = state.trial === h.id;
    body.append(button('← Choose another', 'link-button', () => go('trial-pick'), 'entry-back'));
    const head = el('div', 'harness-head');
    head.append(el('span', 'src src-scripted', wearing ? 'TRIAL · ACTIVE · LOCAL ONLY' : 'TRIAL · PREVIEW'), el('h2', '', `${h.name} · ${h.role}`));
    body.append(head);
    const dl = el('dl', 'facts');
    const fact = (k: string, v: string) => dl.append(el('dt', '', k), el('dd', '', v));
    fact('Persona', `${h.persona.traits}. Speaks ${h.persona.voice}.`);
    fact('Likes', h.persona.likes.map(l => l.replace(/_/g, ' ')).join(', '));
    fact('Goal', h.wants.goal);
    fact('Skills', h.skills.join(', '));
    fact('Role item', h.roleItem ? h.roleItem.replace(/_/g, ' ') : 'none (the base Muse)');
    body.append(dl);
    const tools = el('div', 'tool-chips'); tools.append(el('span', 'eyebrow', 'TOOLS'));
    for (const t of h.tools) tools.append(el('code', '', t));
    body.append(tools);
    const cols = el('div', 'scope-cols');
    for (const level of Object.keys(SCOPES) as ScopeLevel[]) {
      const col = el('div', 'scope-col scope-' + level); col.append(el('h5', '', LEVEL_TITLE[level]));
      const ul = el('ul'); for (const s of SCOPES[level]) ul.append(el('li', '', SCOPE_LABELS[s])); col.append(ul); cols.append(col);
    }
    body.append(el('span', 'eyebrow', 'WHAT IT MAY DO FOR YOU'), cols,
      el('p', 'muted', 'Items and roles never widen these limits. A Taxi Token moves a Muse inside the world; it never pays or books anything.'));
    const status = el('dl', 'facts entry-status');
    status.append(el('dt', '', 'Owner claim'), el('dd', '', 'None. A trial Muse is a visitor, not a claimed Muse.'),
      el('dt', '', 'Live trades'), el('dd', '', 'Not allowed. Trial Muses cannot trade with Muses in the live world.'),
      el('dt', '', 'Live world'), el('dd', '', 'Untouched. This trial lives in this tab only and is gone when you leave.'));
    body.append(status);
    if (wearing) {
      const steps = el('ol', 'first-steps'); for (const s of firstSteps(h)) steps.append(el('li', '', s));
      body.append(el('span', 'eyebrow', 'FIRST STEPS · SCRIPTED PREVIEW'), steps,
        button('End trial', 'secondary', () => { state.lastTrial = state.trial; state.trial = null; state.path = null; updateChip(); go('choose'); }, 'entry-end-trial'));
    } else {
      body.append(button(`Wear the ${h.name} harness`, 'primary', () => { cancelConnect(); state.trial = h.id; state.lastTrial = h.id; state.path = 'trial'; updateChip(); render(); }, 'entry-wear'));
    }
  }

  function connectView() {
    body.append(button('← All ways in', 'link-button', () => { cancelConnect(); updateChip(); go('choose'); }, 'entry-back'),
      el('span', 'eyebrow', 'CONNECT MY MUSE · STAGED WALKTHROUGH'), el('h2', '', 'Your Muse, wearing a harness'),
      el('p', 'world-sub', 'Your own Muse thinks in its own runtime and acts here only through Musely tools, inside the limits you set. The steps below are staged: no connector is connected and no key is issued in this preview.'));
    const badge = el('span', 'src ' + (state.connect === 'error' ? 'src-error' : 'src-replay'), {
      unconnected: 'NOT CONNECTED', connecting: 'STAGED · CONNECTING', connected_staged: 'STAGED · WHAT CONNECTED LOOKS LIKE', error: 'STAGED · ERROR EXAMPLE', cancelled: 'CANCELLED · NOTHING CONNECTED',
    }[state.connect]);
    badge.id = 'connect-state';
    body.append(badge);
    const ol = el('ol', 'connect-steps');
    CONNECT_STEPS.forEach((s, i) => {
      const done = state.connect === 'connected_staged' || (state.connect === 'connecting' && i < state.connectStep) || (state.connect === 'error' && i < 2);
      const li = el('li', '', s); li.dataset.state = done ? 'done' : state.connect === 'connecting' && i === state.connectStep ? 'active' : state.connect === 'error' && i === 2 ? 'failed' : 'todo'; ol.append(li);
    });
    body.append(ol);
    const note = el('p', 'muted connect-note');
    note.textContent = {
      unconnected: 'Your Muse is not connected. Play the staged connection to see each step, or see what an error looks like.',
      connecting: 'Staged connection in progress. You can cancel at any point.',
      connected_staged: 'This is what a connected Muse would show. It is staged: no connector was added, no agent key was issued and no claim was made. The real connection arrives with the connector work (I-04).',
      error: 'Example error: Muse could not reach the Musely tools. In a real connection nothing is kept after an error; retry or cancel.',
      cancelled: 'Cancelled. Nothing was connected and nothing was kept.',
    }[state.connect];
    body.append(note);
    const actions = el('div', 'id-actions');
    const play = () => {
      stopTimer(); endTrial(); state.path = 'connect'; state.connect = 'connecting'; state.connectStep = 0; updateChip(); render();
      timer = window.setInterval(() => { state.connectStep++; if (state.connectStep >= CONNECT_STEPS.length) { stopTimer(); state.connect = 'connected_staged'; } updateChip(); if (state.open && state.view === 'connect') render(); }, 900);
    };
    if (state.connect === 'connecting') actions.append(button('Cancel', 'secondary', () => { cancelConnect(); updateChip(); render(); }, 'connect-cancel'));
    else if (state.connect === 'error') actions.append(button('Retry', 'primary', play, 'connect-retry'), button('Cancel', 'secondary', () => { state.connect = 'cancelled'; updateChip(); render(); }, 'connect-cancel'));
    else if (state.connect === 'unconnected') actions.append(button('Play the staged connection', 'primary', play, 'connect-play'), button('Show an error example', 'secondary', () => { endTrial(); state.path = 'connect'; state.connect = 'error'; updateChip(); render(); }, 'connect-error'));
    else actions.append(button('Start over', 'secondary', () => { state.connect = 'unconnected'; state.connectStep = 0; if (state.path === 'connect') state.path = null; updateChip(); render(); }, 'connect-reset'));
    body.append(actions);
  }

  function render() {
    body.replaceChildren();
    panel.dataset.view = state.view;
    if (!preview) setupView();
    else if (state.view === 'choose') chooseView();
    else if (state.view === 'trial-pick') pickView();
    else if (state.view === 'trial-card') cardView();
    else connectView();
  }

  chip.onclick = () => panel.matches(':popover-open') ? close() : open();
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.open) { event.preventDefault(); close(); } });
  panel.addEventListener('toggle', event => { if ((event as ToggleEvent).newState === 'closed' && state.open) { cancelConnect(); state.open = false; updateChip(); chip.focus(); } });
  document.getElementById('enter')?.addEventListener('click', () => open('choose'));
  updateChip();

  // ?entry=choose|watch|trial|connect (&harness=09-copper) opens a path directly, for walkthrough recordings.
  const entry = preview ? opts.initial?.get('entry') : null;
  if (entry === 'trial') { const h = harness(opts.initial!.get('harness')); state.viewing = h?.id ?? null; open(h ? 'trial-card' : 'trial-pick'); }
  else if (entry === 'connect') open('connect');
  else if (entry === 'choose') open('choose');
  else if (entry === 'watch') { state.path = 'watch'; updateChip(); opts.onWatch(); }

  return {state, open, close};
}
