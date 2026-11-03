// Profile preparation only: never proves world entry and is not mounted by the live door yet.
import {MUSE_VARIANTS} from '../character-kit/catalog.ts';
import type {ActorProfile} from '../identity/participant.ts';

export type PersonalEntryPhase = 'observer' | 'authenticated' | 'pending' | 'registered' | 'error';
export type PersonalEntryState = {phase: PersonalEntryPhase; authenticated: boolean | null; profile: ActorProfile | null; busy: boolean; joined: false};
export type PersonalEntryOptions = {connectionManaged?: boolean; onState?: (state: PersonalEntryState) => void; fetcher?: typeof fetch; navigate?: (url: string) => void | Promise<void>; newOperationId?: () => string; now?: () => number};
class Failure extends Error { readonly status: number; readonly invalid: boolean; constructor(status = 0, invalid = false) { super('personal_entry_unavailable'); this.status = status; this.invalid = invalid; } }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const entry = (v: unknown, state: string) => exact(v, ['state']) && v.state === state;
const publicName = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && [...v.trim()].length <= 40 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v);
const appearance = (v: unknown) => MUSE_VARIANTS.find(x => x.id === v);
function parseProfile(v: unknown): ActorProfile {
 if (!exact(v, ['actorId', 'displayName', 'appearanceId', 'revision']) || typeof v.actorId !== 'string' || !(/^pm_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.actorId) || appearance(v.actorId)) || !publicName(v.displayName) || v.displayName !== v.displayName.trim() || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1) throw new Failure(0, true);
 const variant = appearance(v.appearanceId); if (!variant) throw new Failure(0, true);
 return {actorId: v.actorId, displayName: v.displayName, appearanceId: variant.id, revision: Number(v.revision)};
}
function parseProfileAnswer(v: unknown): ActorProfile | null {
 if (!exact(v, ['profile', 'entry'])) throw new Failure(0, true);
 if (v.profile === null) { if (!entry(v.entry, 'viewing')) throw new Failure(0, true); return null; }
 if (!entry(v.entry, 'registered')) throw new Failure(0, true);
 return parseProfile(v.profile);
}
function authorization(v: unknown): string {
 if (!exact(v, ['authorizationUrl']) || typeof v.authorizationUrl !== 'string' || !/^https:\/\/threads\.com\/oauth\/authorize(?:\?[^#]*)?$/.test(v.authorizationUrl)) throw new Failure(0, true);
 const url = new URL(v.authorizationUrl);
 if (url.origin !== 'https://threads.com' || url.pathname !== '/oauth/authorize' || url.username || url.password || url.hash) throw new Failure(0, true);
 return url.href;
}

/** Explicit mount performs me/profile reads only. All writes require the component's user controls. */
export function mountPersonalEntry(host: HTMLElement, options: PersonalEntryOptions = {}) {
 const fetcher = options.fetcher ?? fetch, navigate = options.navigate ?? (url => window.location.assign(url));
 const now = options.now ?? Date.now, operationId = options.newOperationId ?? (() => crypto.randomUUID());
 const root = document.createElement('section'); root.className = 'personal-entry'; host.append(root);
 let phase: PersonalEntryPhase = 'pending', authenticated: boolean | null = null, profile: ActorProfile | null = null, expiresAt = 0;
 let logoutPending = false, externalBusy = false;
 let busy = false, disposed = false, generation = 0, controller: AbortController | null = null, actorBinding: string | null = null, needsRefresh = false;
 let message = 'Checking your profile…', draft = {displayName: '', appearanceId: MUSE_VARIANTS[0].id as string};
 let pendingDraft: {intent: string; operationId: string} | null = null;
 type Context = {generation: number; controller: AbortController};
 const current = (c: Context) => !disposed && generation === c.generation && !c.controller.signal.aborted;
 const state = (): PersonalEntryState => ({phase, authenticated, profile: profile ? {...profile} : null, busy, joined: false});
 const resetProfile = (keepOperation = false) => { profile = null; draft = {displayName: '', appearanceId: MUSE_VARIANTS[0].id}; if (!keepOperation) pendingDraft = null; };
 const signedOut = (text = 'Keep watching, or sign in to prepare your own Muse.') => { authenticated = false; expiresAt = 0; actorBinding = null; resetProfile(); needsRefresh = false; phase = 'observer'; busy = false; message = text; };
 const usable = () => { if (authenticated === true && expiresAt > now()) return true; signedOut('Your session ended. You can keep watching or sign in again.'); render(); return false; };
 function begin(text: string, force = false): Context | null {
  if (disposed || externalBusy || busy && !force) return null;
  controller?.abort(); controller = new AbortController(); generation++; busy = true; phase = 'pending'; message = text; render();
  return {generation, controller};
 }
 async function request(path: string, method: string, c: Context, body?: unknown): Promise<unknown> {
  const timeout = setTimeout(() => c.controller.abort(), 12000);
  try {
   const r = await fetcher(path, {method, mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: c.controller.signal, ...(body === undefined ? {} : {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})});
   if (!r.ok) throw new Failure(r.status);
   if (r.redirected) throw new Failure(0, true);
   let data: unknown; try { data = await r.json(); } catch { throw new Failure(0, true); }
   if (c.controller.signal.aborted) throw new Failure(); return data;
  } finally { clearTimeout(timeout); }
 }
 function fail(error: unknown, c: Context, text: string, uncertain = false) {
  // Abort caused by refresh/dispose belongs to the old generation. A timeout in the current one still shows an error.
  if (disposed || generation !== c.generation) return;
  busy = false;
  if (error instanceof Failure && error.status === 401) signedOut('Your session ended. Sign in again when you are ready.');
  else { phase = 'error'; needsRefresh = uncertain || error instanceof Failure && (error.invalid || error.status === 409); message = error instanceof Failure && error.status === 409 ? 'Your profile changed. Refresh before saving again.' : text; }
  render();
 }
 function accept(p: ActorProfile | null) {
  if (actorBinding && (!p || p.actorId !== actorBinding)) throw new Failure(0, true);
  profile = p;
  if (p) { actorBinding = p.actorId; pendingDraft = null; draft = {displayName: p.displayName, appearanceId: p.appearanceId}; }
  else draft = {displayName: '', appearanceId: MUSE_VARIANTS[0].id};
 }
 async function refresh() {
  if (disposed || logoutPending || externalBusy) return;
  // Keep an unconfirmed operation across read-only checks; logout/dispose/signed-out always discard it.
  authenticated = null; expiresAt = 0; resetProfile(true); needsRefresh = false;
  const c = begin('Checking your profile…', true)!;
  try {
   const me = await request('/api/personal/me', 'GET', c); if (!current(c)) return;
   if (!object(me) || typeof me.authenticated !== 'boolean' || !entry(me.entry, 'viewing') || !exact(me, me.authenticated ? ['authenticated', 'expiresAt', 'entry'] : ['authenticated', 'entry'])) throw new Failure(0, true);
   if (!me.authenticated) { signedOut(); render(); return; }
   if (!Number.isSafeInteger(me.expiresAt) || Number(me.expiresAt) <= now()) { signedOut('Your session ended. Sign in again when you are ready.'); render(); return; }
   authenticated = true; expiresAt = Number(me.expiresAt);
   const answer = await request('/api/personal/profile', 'GET', c); if (!current(c)) return;
   if (!usable()) return;
   accept(parseProfileAnswer(answer)); phase = profile ? 'registered' : 'authenticated'; busy = false; message = ''; render();
  } catch (e) { fail(e, c, 'Could not check your profile. Refresh to try again.', true); }
 }
 async function login() {
  const c = begin('Opening Threads sign-in…'); if (!c) return;
  try {
   const answer = await request('/api/personal/auth/threads/start', 'POST', c); if (!current(c)) return;
   const url = authorization(answer); await navigate(url); if (!current(c)) return;
   // Navigation is pending, not authentication/entry success. Refresh on return/remount, never a timer.
   message = 'Continue in Threads, then return here to check your profile.'; render();
  } catch (e) { fail(e, c, 'Could not open sign-in. Try again when you are ready.'); }
 }
 async function save(nameInput: string, appearanceInput: string) {
  if (disposed || busy || externalBusy || needsRefresh || !usable()) return;
  draft = {displayName: nameInput, appearanceId: appearanceInput};
  if (!publicName(nameInput) || !appearance(appearanceInput)) { phase = 'error'; message = 'Use a public name of 1–40 characters and choose an appearance.'; render(); return; }
  const name = nameInput.trim(), variant = appearance(appearanceInput)!;
  const previous = profile ? {...profile} : null;
  const intent = JSON.stringify([name, variant.id]);
  if (!previous && pendingDraft?.intent !== intent) {
   try { const id = operationId(); if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || id.startsWith('msly_')) throw new Failure(); pendingDraft = {intent, operationId: id}; }
   catch { phase = 'error'; message = 'Could not prepare your profile. Please try again.'; render(); return; }
  }
  const body = previous ? {expectedRevision: previous.revision, displayName: name, ...(previous.appearanceId === variant.id ? {} : {appearanceId: variant.id})} : {operationId: pendingDraft!.operationId, displayName: name, appearanceId: variant.id};
  const c = begin(previous ? 'Saving your profile…' : 'Registering your profile…'); if (!c) return;
  try {
   const answer = await request(previous ? '/api/personal/profile' : '/api/personal/draft', previous ? 'PATCH' : 'POST', c, body); if (!current(c)) return;
   if (!usable()) return;
   const p = parseProfileAnswer(answer);
   // A repeated draft operation returns the server's current profile, including later edits in another window.
   if (!p || previous && (p.actorId !== previous.actorId || p.revision !== previous.revision + 1 || p.displayName !== name || p.appearanceId !== variant.id)) throw new Failure(0, true);
   accept(p); pendingDraft = null; phase = 'registered'; busy = false; message = ''; render();
  } catch (e) { fail(e, c, 'Could not confirm the profile change. Try again or refresh.'); }
 }
 async function logout() {
  const c = begin('Signing out…'); if (!c) return;
  // A sent logout can still commit after a client abort. Reads cannot supersede it while pending.
  logoutPending = true; authenticated = null; resetProfile(); render();
  try {
   const result = await request('/api/personal/session', 'DELETE', c); if (!current(c)) return;
   if (!exact(result, ['authenticated', 'entry']) || result.authenticated !== false || !entry(result.entry, 'viewing')) throw new Failure(0, true);
   signedOut('Signed out. You can keep watching.'); render();
  } catch (e) { if (!disposed && generation === c.generation) authenticated = null; fail(e, c, 'Sign out could not be confirmed. Refresh to check your session.', true); }
  finally { logoutPending = false; if (!disposed && generation === c.generation) render(); }
 }
 function render() {
  if (disposed) return;
  root.replaceChildren(); root.dataset.state = phase; root.dataset.joined = 'false';
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  root.append(element('h2', '1 · 내 Muse의 이름과 모습 / Your Muse’s name and appearance'));
  const detail=element('details');detail.className='entry-advanced';detail.append(element('summary','이름·모습·로그인 관리 / Manage name, appearance and sign-in'));
  const translated:Record<string,string>={
   'Checking your profile…':'이름과 모습을 확인하고 있어요…',
   'Opening Threads sign-in…':'Threads 로그인을 열고 있어요…',
   'Continue in Threads, then return here to check your profile.':'Threads에서 로그인한 뒤 돌아와 확인해 주세요.',
   'Your session ended. Sign in again when you are ready.':'로그인이 끝났어요. 준비되면 다시 로그인해 주세요.',
   'Could not open sign-in. Try again when you are ready.':'로그인을 열지 못했어요. 다시 눌러 주세요.',
   'Could not check your profile. Refresh to try again.':'이름과 모습을 확인하지 못했어요. 다시 확인해 주세요.',
   'Use a public name of 1–40 characters and choose an appearance.':'공개할 이름을 1~40자로 적고 모습을 골라 주세요.',
   'Signed out. You can keep watching.':'로그아웃했어요. 세계 관람은 계속할 수 있어요.'};
  const normal=profile?(options.connectionManaged?'이름과 모습이 준비됐어요. 연결과 입장은 아래에서 확인해 주세요. / Your name and appearance are ready. Check connection and entry below.':'이름과 모습이 준비됐어요. 아직 세계 입장 완료는 아니에요. / Your name and appearance are ready. Your Muse has not entered the world yet.'):'내 Muse의 공개 이름과 모습을 골라 주세요. 관람은 로그인 없이도 할 수 있어요. / Choose your Muse’s name and appearance. You can keep watching without signing in.';
  const status = element('p', message?(translated[message]??'안내를 확인하고 다음 버튼을 눌러 주세요.')+' / '+message:normal); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.append(status);
  const button = (action: string, text: string, fn: () => Promise<void>) => { const b = element('button', text); b.type = 'button'; b.className = 'secondary'; b.dataset.action = action; b.disabled = busy || externalBusy; b.onclick = fn; return b; };
  if (profile && authenticated) root.append(element('p', profile.displayName));
  if (authenticated === false) {const b=button('login','Threads로 로그인 / Sign in with Threads',login);b.className='primary';root.append(b);}
  if (authenticated === true && !needsRefresh) {
   const f = element('form'), label = element('label', '공개할 Muse 이름 / Public Muse name'), input = element('input'); input.type = 'text'; input.name = 'displayName'; input.value = draft.displayName; input.maxLength = 80; input.disabled = busy || externalBusy; input.setAttribute('aria-label', '공개할 Muse 이름 / Public Muse name'); label.append(input);
   const appearanceLabel = element('label', '모습 / Appearance'), select = element('select'); select.name = 'appearanceId'; select.setAttribute('aria-label', '모습 / Appearance'); select.disabled = busy || externalBusy;
   for (const v of MUSE_VARIANTS) { const option = element('option', v.name); option.value = v.id; select.append(option); }
   select.value = draft.appearanceId; appearanceLabel.append(select);
   const submit = element('button', profile ? '이름·모습 저장 / Save name and appearance' : '내 Muse 만들기 / Create my Muse'); submit.type = 'submit'; submit.className = profile?'secondary':'primary'; submit.disabled = busy || externalBusy;
   f.onsubmit = async event => { event.preventDefault(); await save(input.value, select.value); }; f.append(label, appearanceLabel, submit);(profile?detail:root).append(f);
  }
  const refreshButton=button('refresh','다시 확인 / Check again',refresh);refreshButton.disabled=logoutPending||externalBusy;
  if(needsRefresh||authenticated===null&&phase==='error'){refreshButton.className='primary';root.append(refreshButton);}else detail.append(refreshButton);
  if (authenticated === true) detail.append(button('logout', '로그아웃 / Sign out', logout));
  root.append(detail);
  try { options.onState?.(state()); } catch {}
 }

 const ready = refresh();
 return {ready, refresh, state, markSessionLost() { if (disposed) return; generation++; controller?.abort(); signedOut('Your session ended. Sign in again when you are ready.'); render(); }, setExternalBusy(value: boolean) { if (disposed || externalBusy === value) return; externalBusy = value; render(); }, dispose() { if (disposed) return; disposed = true; generation++; controller?.abort(); resetProfile(); authenticated = false; busy = false; actorBinding = null; try { options.onState?.(state()); } catch {} root.remove(); }};
}
