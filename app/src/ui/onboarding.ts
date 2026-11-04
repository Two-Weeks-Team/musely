import {uiText,catalogText,inventoryText,activityStatus} from './i18n.ts';
// Ordinary watching is side-effect free. Personal setup writes require its explicit controls; only
// current server entry can retire the door. Scripted walkthrough remains entryPreview-only.
import {mountPersonalEntry,personalAuthResult,type PersonalEntryOptions} from './personal-entry.ts';
import {mountPersonalConnection,type EntryProjection} from './personal-connection.ts';
import {mountPersonalClaim} from './personal-claim.ts';
import {mountPersonalAdoption} from './personal-adoption.ts';
import {mountSocialStatus} from './social-status.ts';
import {personalOwnerAccess} from './personal-owner.ts';
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
  uiText('In Muse chat, add Musely as a custom connector'),
  uiText('Paste the Musely MCP address'),
  uiText('Muse asks you to approve the Musely tools'),
  uiText('Musely issues an agent key for your Muse'),
];
const LEVEL_TITLE: Record<ScopeLevel, string> = {allowed: uiText('Allowed'), approval: uiText('Needs your approval'), forbidden: uiText('Never')};

/** What a harness would do first, as a scripted local preview (not the live world). */
export const firstSteps = (h: Harness): string[] => [
  uiText`Walks to a ${h.persona.likes[0].replace(/_/g, ' ')} it likes`,
  uiText`Uses ${h.tools.find(t => !['walk', 'greet', 'offer_item'].includes(t))?.replace(/_/g, ' ') ?? uiText('a greeting')}`,
  uiText`Looks for ${h.wants.items.map(i => i.replace(/_/g, ' ')).join(uiText(' or '))}: ${h.wants.goal.charAt(0).toLowerCase() + h.wants.goal.slice(1)}`,
];

export function mountOnboarding(opts: {onWatch: () => void; initial?: URLSearchParams; getWorldId?:()=>string|null; onPersonalEntry?:(entry:EntryProjection)=>void; personal?:PersonalEntryOptions & {clipboard?:{writeText:(value:string)=>Promise<void>}}}) {
  const preview = opts.initial?.get('entryPreview') === '1';
  const personalFetch = opts.personal?.fetcher ?? personalOwnerAccess.fetch;
  const state: EntryState = {path: null, view: 'choose', open: false, viewing: null, trial: null, lastTrial: null, connect: 'unconnected', connectStep: 0, entries: 0, ownerClaim: 'none', liveTradeAllowed: false, liveWrites: 0};
  const header = document.querySelector('header')!;
  const chip = el('button', 'quiet world-open entry-open'); chip.type = 'button'; chip.id = 'entry-open';
  const chipText = el('span', '', uiText('Enter'));
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

  const panel = el('section', 'world-panel entry-panel'); panel.id = 'entry-panel'; panel.setAttribute('popover', 'manual'); panel.setAttribute('aria-label', preview ? uiText('Enter Musely · local preview') : uiText('Bring your Muse into Musely')); panel.setAttribute('role', 'dialog');
  const body = el('div', 'entry-body');
  panel.append(button('×', 'close', () => close(), 'close-entry'), body);
  document.body.append(panel);
  panel.querySelector('.close')!.setAttribute('aria-label', uiText('Close'));

  let personal: {profile:ReturnType<typeof mountPersonalEntry>; connection:ReturnType<typeof mountPersonalConnection>; claim:ReturnType<typeof mountPersonalClaim>;adoption:ReturnType<typeof mountPersonalAdoption>;social:ReturnType<typeof mountSocialStatus>;apply:()=>void} | null = null;
  const stopOwnerSession = personalOwnerAccess.subscribe(reason=>{if(['logout','http401','expired'].includes(reason))personal?.profile.markSessionLost();if(reason==='logout'||reason==='logout_settled')personal?.profile.setExternalBusy(personalOwnerAccess.isLoggingOut());});
  let personalEntry:EntryProjection|null=null,disposed=false;
  let timer = 0;
  const stopTimer = () => { if (timer) clearInterval(timer); timer = 0; };
  // The three paths are exclusive. Leaving a running connection always ends it as cancelled (never a frozen
  // "connecting"), and starting a connection or watching ends an active trial (kept only as the resume offer).
  const cancelConnect = () => { if (state.connect === 'connecting') { stopTimer(); state.connect = 'cancelled'; } };
  const endTrial = () => { if (state.trial) { state.lastTrial = state.trial; state.trial = null; } };
  const harness = (id: string | null) => HARNESSES.find(h => h.id === id) ?? null;

  function updateChip() {
    chip.setAttribute('aria-expanded', String(state.open));
    if (!preview) { const joined=personalEntry?.state==='joined';chipText.textContent=joined?uiText('내 Muse / Your Muse'):uiText('내 Muse 데려오기 / Bring your Muse');chip.setAttribute('aria-label',joined?uiText('Your Muse is in Musely'):uiText('Bring your Muse into Musely'));chip.title=joined?uiText('Your Muse is in Musely'):uiText('Bring your Muse');chip.dataset.joinState=personalEntry?.state??'viewing';chip.dataset.invitation=joined?'complete':'active';return; }
    const t = harness(state.trial);
    chipText.textContent = state.path === 'watch' ? uiText('Watching') : state.path === 'trial' && t ? uiText`Trial · ${t.name} · local` : state.path === 'connect' ? uiText`Connect · ${state.connect === 'connected_staged' ? 'staged' : state.connect.replace('_', ' ')}` : uiText('Enter');
    chip.dataset.mode = state.path ?? 'none';
    chip.setAttribute('aria-label', uiText('How you are in Musely: ') + chipText.textContent);
    document.body.dataset.entry = state.path ?? 'none';
  }

  function open(view?: View) {
    if(disposed)return;
    document.getElementById('world-panel')?.hidePopover?.();
    if (!state.open) state.entries++;
    state.open = true;
    if (!preview) state.view = 'connect';
    else if (view) state.view = view;
    else state.view = state.path === 'trial' ? 'trial-card' : state.path === 'connect' ? 'connect' : 'choose';
    if (state.view === 'trial-card' && (state.path === 'trial' || !state.viewing)) state.viewing = state.trial ?? state.lastTrial;
    panel.showPopover(); render();if(!preview){personal?.adoption.setVisible(true);personal?.apply();} updateChip();
    panel.querySelector<HTMLButtonElement>('.close')?.focus();
  }
  function close() {
    if(disposed)return;state.open=false;personal?.adoption.setVisible(false);personal?.apply();
    // Closing the panel mid-connection cancels the staged connection; nothing else changes.
    cancelConnect();
    state.open = false; panel.hidePopover(); updateChip(); chip.focus();
  }
  function go(view: View) { state.view = view; render(); }

  function setupView() {
    body.append(el('span','eyebrow',uiText('YOUR MUSE · YOUR CHOICE')),el('h2','',uiText('내 Muse를 세계로 데려오세요 / Bring your Muse into the world')),
      el('p','world-sub',uiText('보던 세계는 그대로예요. 이름과 모습을 정하고 내 Muse를 연결해 보세요. / Keep watching while you prepare your own Muse. Sign-in and permissions are your choice.')));
    const adoptionHost=el('div','entry-legacy-muse'),profileHost=el('div','entry-profile'),claimHost=el('div','entry-account-claim'),connectionHost=el('div','entry-connection');body.append(adoptionHost,profileHost,claimHost,connectionHost);
    const publicSetup=uiText('Musely MCP endpoint: https://musely.net/mcp\nSign in and register your own profile. Explicitly choose your virtual-world permissions and create your own one-time key.\nPut that key only in Muse’s secure API key field, never in chat.\nCreate an entry request here, then use register_agent({}) and ask your Muse to sign enter_world with the exact attempt_id shown. Only actual current entry finishes joining.\nEntry is separate from account verification. First greetings and trades still follow current claim and permission checks.\nAfter entry, read the world and inbox. Choose a nearby Muse you have not met and use say_hello(to) only when those checks allow it, then decide for yourself what to explore or do next within your permissions.');
    const text=el('textarea','entry-setup-text');text.id='entry-setup-text';text.readOnly=true;text.rows=6;text.value=publicSetup;text.setAttribute('aria-label',uiText('Public setup overview without an API key'));
    const copyStatus=el('p','muted');copyStatus.id='entry-copy-status';copyStatus.setAttribute('role','status');
    const copy=button(uiText('공개 연결 안내 복사 / Copy public setup overview'),'secondary',()=>{},'entry-copy-setup');copy.onclick=async()=>{copy.disabled=true;try{await (opts.personal?.clipboard??navigator.clipboard).writeText(publicSetup);copyStatus.textContent=uiText('Public setup copied. No key was included and nothing was connected.');}catch{copyStatus.textContent=uiText('Could not copy. Select the public instructions above. Nothing was connected.');}finally{copy.disabled=false;}};
    const help=el('details','entry-advanced');help.append(el('summary','',uiText('연결 도움말 / Connection help')),el('p','muted',uiText('초대받았다면 Threads 설정 → 계정 → 웹사이트 권한 → 초대에서 수락해 주세요. / If you were invited, accept in Threads Settings → Account → Website permissions → Invites.')),text,copy,copyStatus);
    body.append(help,button(uiText('계속 둘러보기 / Keep watching'),'link-button',()=>{state.path='watch';close();opts.onWatch();},'entry-watch'));
    const socialDetails=el('details','entry-social-status'),socialHost=el('div');socialDetails.id='entry-social-status';socialDetails.append(el('summary','',uiText('내 Muse 상태 / My Muse status')),socialHost);socialDetails.hidden=true;body.append(socialDetails);
    let connectionBusy=false,claimBusy=false,adoptionBusy=false,socialBusy=false,socialExpanded=false,applying=false;
    let social:ReturnType<typeof mountSocialStatus>|null=null;
    let connection:ReturnType<typeof mountPersonalConnection>|null=null,claim:ReturnType<typeof mountPersonalClaim>|null=null,adoption:ReturnType<typeof mountPersonalAdoption>|null=null;
    let studioRouted=false;
    let latest:ReturnType<ReturnType<typeof mountPersonalEntry>['state']>|null=null,connectionVisible:boolean|null=null,claimVisible:boolean|null=null;
    const maybeStudio=()=>{if(studioRouted||!state.open||latest?.authenticated!==true||latest.busy||latest.profile)return;const a=adoption?.state();if(a?.mode!=='new'||a.blocksSetup)return;studioRouted=true;const navigate=opts.personal?.navigate??(url=>window.location.assign(url));void navigate('/characters/?onboarding=1');};
    const blocked=()=>!!adoption?.state().blocksSetup||latest?.profile?.actorId==='00-jolly';
    function applyFlow(){
      if(applying||!latest)return;applying=true;
      try{
        const member=!!latest.profile&&(!!adoption?.state().data?.adopted||!!personalEntry?.receipt&&personalEntry.actor?.id===latest.profile.actorId),available=state.open&&latest.authenticated===true&&member;
        if(!available){socialExpanded=false;socialDetails.open=false;}socialDetails.hidden=!available;
        const block=blocked(),form=profileHost.querySelector('form');
        const hide=(node:HTMLElement,value:boolean)=>{node.hidden=value;if(node.style)node.style.display=value?'none':'';};
        if(form)hide(form,block||socialExpanded);hide(help,block||socialExpanded);hide(adoptionHost,socialExpanded);hide(claimHost,block||socialExpanded);hide(connectionHost,block||socialExpanded||!!claim?.isExpanded());
        const showClaim=state.open&&!block&&!socialExpanded,showConnection=state.open&&!block&&!socialExpanded&&!claim?.isExpanded();
        if(claim&&claimVisible!==showClaim){claimVisible=showClaim;claim.setVisible(showClaim);}
        if(connection&&connectionVisible!==showConnection){connectionVisible=showConnection;connection.setVisible(showConnection);}
        const current=block||socialExpanded?{authenticated:null,profile:null,busy:true}:latest;
        void connection?.syncProfile(current);void claim?.syncProfile(current);
        void social?.syncOwner({authenticated:latest.authenticated,muse:latest.profile?.actorId??null,busy:latest.busy||connectionBusy||claimBusy||adoptionBusy});
        social?.setVisible(available&&socialExpanded);
      }finally{applying=false;}maybeStudio();
    }
    const p=mountPersonalEntry(profileHost,{...opts.personal,fetcher:personalFetch,connectionManaged:true,authResult:personalAuthResult(opts.initial),onWatch:()=>{state.path='watch';close();opts.onWatch();},onState:s=>{latest=s;personalOwnerAccess.syncPersonal(s);void adoption?.syncProfile(s);applyFlow();}});
    connection=mountPersonalConnection(connectionHost,{fetcher:personalFetch,newOperationId:opts.personal?.newOperationId,now:opts.personal?.now,clipboard:opts.personal?.clipboard,getWorldId:opts.getWorldId,
      onWatch:()=>{state.path='watch';close();opts.onWatch();},onWriteBusy:value=>{connectionBusy=value;p.setExternalBusy(connectionBusy||claimBusy||adoptionBusy||socialBusy||personalOwnerAccess.isLoggingOut());claim?.setExternalBusy(value||adoptionBusy);adoption?.setExternalBusy(value||claimBusy);},onSessionLost:()=>p.markSessionLost(),onEntry:entry=>{if(disposed||blocked()||socialExpanded)return;personalEntry=structuredClone(entry);updateChip();applyFlow();try{opts.onPersonalEntry?.(structuredClone(entry));}catch{}}});
    claim=mountPersonalClaim(claimHost,{autoExpand:opts.initial?.get('personal')!=='prepared',fetcher:personalFetch,navigate:opts.personal?.navigate,clipboard:opts.personal?.clipboard,
      onExpanded:()=>applyFlow(),onWriteBusy:value=>{claimBusy=value;p.setExternalBusy(connectionBusy||claimBusy||adoptionBusy||socialBusy||personalOwnerAccess.isLoggingOut());adoption?.setExternalBusy(value||connectionBusy);},onSessionLost:()=>p.markSessionLost()});
    adoption=mountPersonalAdoption(adoptionHost,{fetcher:personalFetch,newOperationId:opts.personal?.newOperationId,getWorldId:opts.getWorldId,
      onState:a=>{if(disposed)return;if(a.blocksSetup){personalEntry=a.data?.adopted?a.data.entry:null;updateChip();}else if(latest?.authenticated===false){personalEntry=null;updateChip();}applyFlow();},
      onWriteBusy:value=>{adoptionBusy=value;p.setExternalBusy(connectionBusy||claimBusy||adoptionBusy||socialBusy||personalOwnerAccess.isLoggingOut());claim?.setExternalBusy(value||connectionBusy);},onSessionLost:()=>p.markSessionLost(),onAdopted:()=>p.refresh(),onWatch:()=>{state.path='watch';close();opts.onWatch();}});
    social=mountSocialStatus(socialHost,{fetcher:personalFetch,endpoint:()=>'/api/personal/social-status',onSessionLost:()=>p.markSessionLost(),onWriteBusy:value=>{socialBusy=value;p.setExternalBusy(connectionBusy||claimBusy||adoptionBusy||socialBusy||personalOwnerAccess.isLoggingOut());claim?.setExternalBusy(value||connectionBusy||adoptionBusy);adoption?.setExternalBusy(value||connectionBusy||claimBusy);}});social.setVisible(false);
    socialDetails.addEventListener('toggle',()=>{socialExpanded=socialDetails.open;applyFlow();});
    personal={profile:p,connection,claim,adoption,social,apply:applyFlow};latest=p.state();void adoption.syncProfile(latest);applyFlow();
  }

  function chooseView() {
    body.append(el('span', 'eyebrow', uiText('MUSELY · HOW DO YOU WANT TO COME IN?')), el('h2', '', uiText('Enter the world')),
      el('p', 'world-sub', uiText('Three ways in. None of them signs you in, claims a Muse or touches the live world.')));
    const paths = el('div', 'entry-paths');
    const path = (id: string, title: string, text: string, tag: string, tagCls: string, onClick: () => void) => {
      const b = el('button', 'entry-path'); b.type = 'button'; b.id = id; b.onclick = onClick;
      b.append(el('span', 'src ' + tagCls, tag), el('b', '', title), el('small', '', text)); paths.append(b);
    };
    path('entry-watch', uiText('Watch the world'), uiText('Look around the shared world and the 3:30 story. Nothing of yours acts.'), 'WATCH', 'src-live', () => {
      cancelConnect(); endTrial(); state.path = 'watch'; close(); opts.onWatch();
    });
    path('entry-trial', uiText('Try a Muse here'), uiText('Put one of ten harnesses on a trial Muse. Local to this tab: not claimed, and it cannot trade with live Muses.'), uiText('TRIAL · LOCAL'), 'src-scripted', () => go('trial-pick'));
    path('entry-connect', uiText('Connect my Muse'), uiText('See how your own Muse joins through a custom connector. In this preview the connection is a staged walkthrough.'), 'STAGED', 'src-replay', () => go('connect'));
    body.append(paths);
    const last = harness(state.lastTrial);
    if (last && state.path !== 'trial') body.append(button(uiText`Resume trial as ${last.name}`, 'secondary', () => { state.viewing = last.id; go('trial-card'); }, 'entry-resume'));
    body.append(button(state.path ? uiText('Keep the current way') : uiText('Leave without choosing'), 'link-button', () => close(), 'entry-leave'));
  }

  function pickView() {
    body.append(button(uiText('← All ways in'), 'link-button', () => go('choose'), 'entry-back'), el('span', 'eyebrow', uiText('TRY A MUSE · CHOOSE A HARNESS')), el('h2', '', uiText('Pick a Muse like a job')),
      el('p', 'world-sub', uiText('Jolly is the base. Each of the other nine puts its own persona, skills, tools and limits on your trial Muse.')));
    const grid = el('div', 'harness-grid');
    for (const h of HARNESSES) {
      const b = el('button', 'harness-pick' + (h.id === state.trial ? ' on' : '')); b.type = 'button'; b.dataset.harness = h.id;
      b.onclick = () => { state.viewing = h.id; go('trial-card'); };
      b.append(el('b', '', h.name), el('span', 'eyebrow', catalogText(h.role)), el('small', '', catalogText(h.wants.goal)));
      grid.append(b);
    }
    body.append(grid);
  }

  function cardView() {
    const h = harness(state.viewing) ?? HARNESSES[0];
    const wearing = state.trial === h.id;
    body.append(button(uiText('← Choose another'), 'link-button', () => go('trial-pick'), 'entry-back'));
    const head = el('div', 'harness-head');
    head.append(el('span', 'src src-scripted', wearing ? uiText('TRIAL · ACTIVE · LOCAL ONLY') : uiText('TRIAL · PREVIEW')), el('h2', '', `${h.name} · ${catalogText(h.role)}`));
    body.append(head);
    const dl = el('dl', 'facts');
    const fact = (k: string, v: string) => dl.append(el('dt', '', k), el('dd', '', v));
    fact(uiText('Persona'), uiText`${h.persona.traits}. Speaks ${h.persona.voice}.`);
    fact(uiText('Likes'), h.persona.likes.map(l => catalogText(l.replace(/_/g, ' '))).join(', '));
    fact(uiText('Goal'), catalogText(h.wants.goal));
    fact(uiText('Skills'), h.skills.map(catalogText).join(', '));
    fact(uiText('Role item'), h.roleItem ? catalogText(h.roleItem.replace(/_/g, ' ').replace(/\b\w/g,c=>c.toUpperCase())) : uiText('none (the base Muse)'));
    body.append(dl);
    const tools = el('div', 'tool-chips'); tools.append(el('span', 'eyebrow', 'TOOLS'));
    for (const t of h.tools) tools.append(el('code', '', t));
    body.append(tools);
    const cols = el('div', 'scope-cols');
    for (const level of Object.keys(SCOPES) as ScopeLevel[]) {
      const col = el('div', 'scope-col scope-' + level); col.append(el('h5', '', LEVEL_TITLE[level]));
      const ul = el('ul'); for (const s of SCOPES[level]) ul.append(el('li', '', catalogText(SCOPE_LABELS[s]))); col.append(ul); cols.append(col);
    }
    body.append(el('span', 'eyebrow', uiText('WHAT IT MAY DO FOR YOU')), cols,
      el('p', 'muted', uiText('Items and roles never widen these limits. A Taxi Token moves a Muse inside the world; it never pays or books anything.')));
    const status = el('dl', 'facts entry-status');
    status.append(el('dt', '', uiText('Owner claim')), el('dd', '', uiText('None. A trial Muse is a visitor, not a claimed Muse.')),
      el('dt', '', uiText('Live trades')), el('dd', '', uiText('Not allowed. Trial Muses cannot trade with Muses in the live world.')),
      el('dt', '', uiText('Live world')), el('dd', '', uiText('Untouched. This trial lives in this tab only and is gone when you leave.')));
    body.append(status);
    if (wearing) {
      const steps = el('ol', 'first-steps'); for (const s of firstSteps(h)) steps.append(el('li', '', s));
      body.append(el('span', 'eyebrow', uiText('FIRST STEPS · SCRIPTED PREVIEW')), steps,
        button(uiText('End trial'), 'secondary', () => { state.lastTrial = state.trial; state.trial = null; state.path = null; updateChip(); go('choose'); }, 'entry-end-trial'));
    } else {
      body.append(button(uiText`Wear the ${h.name} harness`, 'primary', () => { cancelConnect(); state.trial = h.id; state.lastTrial = h.id; state.path = 'trial'; updateChip(); render(); }, 'entry-wear'));
    }
  }

  function connectView() {
    body.append(button(uiText('← All ways in'), 'link-button', () => { cancelConnect(); updateChip(); go('choose'); }, 'entry-back'),
      el('span', 'eyebrow', uiText('CONNECT MY MUSE · STAGED WALKTHROUGH')), el('h2', '', uiText('Your Muse, wearing a harness')),
      el('p', 'world-sub', uiText('Your own Muse thinks in its own runtime and acts here only through Musely tools, inside the limits you set. The steps below are staged: no connector is connected and no key is issued in this preview.')));
    const badge = el('span', 'src ' + (state.connect === 'error' ? 'src-error' : 'src-replay'), {
      unconnected: uiText('NOT CONNECTED'), connecting: uiText('STAGED · CONNECTING'), connected_staged: uiText('STAGED · WHAT CONNECTED LOOKS LIKE'), error: uiText('STAGED · ERROR EXAMPLE'), cancelled: uiText('CANCELLED · NOTHING CONNECTED'),
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
      unconnected: uiText('Your Muse is not connected. Play the staged connection to see each step, or see what an error looks like.'),
      connecting: uiText('Staged connection in progress. You can cancel at any point.'),
      connected_staged: uiText('This is what a connected Muse would show. It is staged: no connector was added, no agent key was issued and no claim was made. The real connection arrives with the connector work (I-04).'),
      error: uiText('Example error: Muse could not reach the Musely tools. In a real connection nothing is kept after an error; retry or cancel.'),
      cancelled: uiText('Cancelled. Nothing was connected and nothing was kept.'),
    }[state.connect];
    body.append(note);
    const actions = el('div', 'id-actions');
    const play = () => {
      stopTimer(); endTrial(); state.path = 'connect'; state.connect = 'connecting'; state.connectStep = 0; updateChip(); render();
      timer = window.setInterval(() => { state.connectStep++; if (state.connectStep >= CONNECT_STEPS.length) { stopTimer(); state.connect = 'connected_staged'; } updateChip(); if (state.open && state.view === 'connect') render(); }, 900);
    };
    if (state.connect === 'connecting') actions.append(button(uiText('Cancel'), 'secondary', () => { cancelConnect(); updateChip(); render(); }, 'connect-cancel'));
    else if (state.connect === 'error') actions.append(button(uiText('Retry'), 'primary', play, 'connect-retry'), button(uiText('Cancel'), 'secondary', () => { state.connect = 'cancelled'; updateChip(); render(); }, 'connect-cancel'));
    else if (state.connect === 'unconnected') actions.append(button(uiText('Play the staged connection'), 'primary', play, 'connect-play'), button(uiText('Show an error example'), 'secondary', () => { endTrial(); state.path = 'connect'; state.connect = 'error'; updateChip(); render(); }, 'connect-error'));
    else actions.append(button(uiText('Start over'), 'secondary', () => { state.connect = 'unconnected'; state.connectStep = 0; if (state.path === 'connect') state.path = null; updateChip(); render(); }, 'connect-reset'));
    body.append(actions);
  }

  function render() {
    if(!preview&&personal)return;
    body.replaceChildren();
    panel.dataset.view = state.view;
    if (!preview) setupView();
    else if (state.view === 'choose') chooseView();
    else if (state.view === 'trial-pick') pickView();
    else if (state.view === 'trial-card') cardView();
    else connectView();
  }

  chip.onclick = () => panel.matches(':popover-open') ? close() : open();
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&state.open){event.preventDefault();close();}};document.addEventListener('keydown',onKey);
  const onToggle=(event:Event)=>{ if ((event as ToggleEvent).newState === 'closed' && state.open) { cancelConnect(); state.open = false; updateChip(); chip.focus();personal?.adoption.setVisible(false);personal?.apply(); } };panel.addEventListener('toggle',onToggle);
  const enter=document.getElementById('enter'),onEnter=()=>open('choose');enter?.addEventListener('click',onEnter);
  updateChip();

  // ?entry=choose|watch|trial|connect (&harness=09-copper) opens a path directly, for walkthrough recordings.
  const entry = preview ? opts.initial?.get('entry') : null;
  if(!preview&&(['failed','declined','authenticated'].includes(personalAuthResult(opts.initial)??'')||opts.initial?.get('personal')==='prepared'))open('connect');
  if(!preview&&['claimed','failed','declined','not_found'].includes(opts.initial?.get('personalClaim')??''))open('connect');
  if (entry === 'trial') { const h = harness(opts.initial!.get('harness')); state.viewing = h?.id ?? null; open(h ? 'trial-card' : 'trial-pick'); }
  else if (entry === 'connect') open('connect');
  else if (entry === 'choose') open('choose');
  else if (entry === 'watch') { state.path = 'watch'; updateChip(); opts.onWatch(); }

  return {state,open,close,personalMuseId(){const s=personal?.profile.state();return s?.authenticated===true?s.profile?.actorId??null:null;},dispose(){if(disposed)return;disposed=true;stopOwnerSession();stopTimer();personal?.social.dispose();personal?.adoption.dispose();personal?.claim.dispose();personal?.connection.dispose();personal?.profile.dispose();document.removeEventListener('keydown',onKey);panel.removeEventListener('toggle',onToggle);enter?.removeEventListener('click',onEnter);chip.remove();panel.remove();}};
}
